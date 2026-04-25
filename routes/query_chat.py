"""
routes/query_chat.py
────────────────────────────────────────────────────────────────────────────
Network Query endpoint — POST /api/query/ask

SSE event stream:
    {"type": "thinking",  "keywords": [...], "node_count": N}
    {"type": "chunk",     "content": "..."}
    {"type": "highlight", "node_id": "id"}
    {"type": "sources",   "sources": [{id, label, category, description}]}
    {"type": "done"}
    {"type": "error",     "message": "..."}
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from utils.encryption import decrypt_key
from utils.graph_query import find_relevant_context
from utils.md_loader import load_node_md, load_nodes_md, build_route_summary
from routes.memory import load_memory_graph

router = APIRouter(prefix="/api/query", tags=["query"])

# ============================================================================
# Paths
# ============================================================================

_DATA_DIR      = Path(__file__).parent.parent / "data"
_GRAPH_FILE    = _DATA_DIR / "graph.json"
_SETTINGS_FILE = _DATA_DIR / "settings.json"
_OPENROUTER       = "https://openrouter.ai/api/v1/chat/completions"
_BOTTLENECK_FILE  = _DATA_DIR / "bottlenecks.json"
_INTELLIGENCE_FILE = _DATA_DIR / "intelligence.json"


# ============================================================================
# Models
# ============================================================================

class AskBody(BaseModel):
    question: str
    world: str = "demo"


# ============================================================================
# Internal helpers
# ============================================================================

def _load_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return fallback


def _load_graph() -> Dict[str, Any]:
    g = _load_json(_GRAPH_FILE, {"nodes": [], "edges": []})
    g.setdefault("nodes", [])
    g.setdefault("edges", [])
    return g


def _load_settings() -> Dict[str, Any]:
    return _load_json(_SETTINGS_FILE, {})


def _resolve_key_model() -> Tuple[Optional[str], str]:
    settings = _load_settings()
    model    = settings.get("chat_model", "meta-llama/llama-3.3-70b-instruct")
    cipher   = settings.get("openrouter_api_key_encrypted", "")
    if not cipher:
        return None, model
    try:
        return decrypt_key(cipher), model
    except Exception:
        return None, model


def _build_system_prompt(context: Dict[str, Any], world: str = "demo") -> str:
    subgraph = json.dumps(
        {"nodes": context["relevant_nodes"], "edges": context["relevant_edges"]},
        ensure_ascii=False,
        indent=2,
    )

    # ── Memory world: personal prompt, no demo sections ───────────────────
    if world == "memory":
        md_section = load_nodes_md(context["relevant_nodes"], max_nodes=8, max_chars_per_file=500)
        extra = f"\n\n{md_section}" if md_section else ""
        return f"""You are NeuralGraph Memory Assistant — an analytical assistant that reads and reasons over the user's personal neural memory graph.

Your purpose is twofold:
1. Retrieve specific facts from the graph nodes
2. Analyze patterns, behaviours, and connections ACROSS nodes and segments to produce insights

RULES:
- All conclusions and insights must be grounded in the graph data provided below.
- You may reason across multiple nodes to identify patterns, contradictions, growth areas, and behavioural tendencies.
- You may derive insights that are not stated explicitly but logically follow from combining multiple nodes.
- You do NOT introduce facts from outside the graph (no assumptions based on general knowledge).
- If a specific fact is missing, say so and suggest which segment to enrich.
- When referencing a node, wrap its label in [[double brackets]].
- End every response with exactly: SOURCES: [comma-separated node ids used]
- Respond in the same language as the question (Dutch or English).

MEMORY GRAPH CONTEXT:
{subgraph}{extra}"""

    # ── Demo world: load all relevant sections ────────────────────────────
    main_md_content = load_node_md("main.md") or ""
    main_section = f"\n\nMAIN KNOWLEDGE BASE (always authoritative):\n{main_md_content}" if main_md_content else ""

    md_section = load_nodes_md(context["relevant_nodes"], max_nodes=8, max_chars_per_file=500)

    route_section = ""
    if context["relevant_edges"]:
        route_section = build_route_summary(
            context["relevant_nodes"],
            context["relevant_edges"],
        )

    bn_section = ""
    bn_data = _load_json(_BOTTLENECK_FILE, {})
    bottlenecks = bn_data.get("bottlenecks", [])
    if bottlenecks:
        top5 = sorted(bottlenecks, key=lambda x: x.get("severity", 0), reverse=True)[:5]
        bn_lines = [
            f"  - {b.get('label', b.get('node_id', '?'))} "
            f"[{b.get('type', '?')}] severity={b.get('severity', 0):.2f} — {b.get('reason', '')}"
            for b in top5
        ]
        bn_section = "\n\nBOTTLENECK CONTEXT (top 5):\n" + "\n".join(bn_lines)

    intel_section = ""
    intel_data = _load_json(_INTELLIGENCE_FILE, {})
    metrics_list = [{"id": k, **v} for k, v in intel_data.items() if isinstance(v, dict)]
    if metrics_list:
        top_bridges = sorted(metrics_list, key=lambda x: x.get("betweenness", 0), reverse=True)[:5]
        il = [
            f"  - {m.get('id', '?')} betweenness={m.get('betweenness', 0):.3f} "
            f"in={m.get('in_degree', 0)} out={m.get('out_degree', 0)} role={m.get('role', '?')}"
            for m in top_bridges
        ]
        intel_section = "\n\nINTELLIGENCE METRICS (top 5 bridge nodes):\n" + "\n".join(il)

    extra_sections = ""
    if main_section:
        extra_sections += main_section
    if route_section:
        extra_sections += f"\n\n{route_section}"
    if md_section:
        extra_sections += f"\n\n{md_section}"
    if bn_section:
        extra_sections += bn_section
    if intel_section:
        extra_sections += intel_section

    return f"""You are NeuralGraph Assistant — a retrieval system that reads a company knowledge graph for Voltera.

CRITICAL RULES — follow these without exception:
1. You ONLY use information that is explicitly present in the GRAPH CONTEXT below.
2. You do NOT use your own training knowledge, general knowledge, or assumptions about Voltera or solar panels.
3. If the answer cannot be found in the graph context, respond with: “Dit staat niet in de graph. Upload meer documentatie om deze vraag te kunnen beantwoorden.”
4. Do NOT fill in gaps with plausible-sounding information. Absence of data = absence of answer.
5. When referencing a node, wrap its label in [[double brackets]].
   Example: [[Financieringsvorm]] leidt naar [[SVN Aanvraag]] via het SVN pad.
6. For route questions: beschrijf de exacte stappen in volgorde en benoem beslissingspunten.
7. End every response with exactly: SOURCES: [comma-separated node ids used]
8. Respond in the same language as the question (Dutch or English).

GRAPH CONTEXT:
{subgraph}{extra_sections}"""


def _find_node_id(ref: str, nodes: List[Dict[str, Any]]) -> Optional[str]:
    low = ref.strip().lower()
    for n in nodes:
        if (n.get("label") or "").lower() == low:
            return n["id"]
    for n in nodes:
        if (n.get("id") or "").lower() == low:
            return n["id"]
    return None


def _parse_sources(full_text: str, nodes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    m = re.search(r"SOURCES:\s*(.+)", full_text, re.IGNORECASE)
    if not m:
        return []
    node_map = {n["id"]: n for n in nodes}
    result: List[Dict[str, Any]] = []
    for part in m.group(1).split(","):
        pid = part.strip()
        if not pid:
            continue
        pid_low = pid.lower()
        node = node_map.get(pid) or next(
            (n for n in nodes if (n.get("label") or "").lower() == pid_low),
            None,
        )
        if node and node not in result:
            result.append(node)
    return result


async def _stream_openrouter(
    api_key: str,
    model:   str,
    messages: List[Dict[str, str]],
) -> AsyncIterator[str]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json",
        "HTTP-Referer":  "https://neuralgraph.local",
        "X-Title":       "NeuralGraph",
    }
    payload = {
        "model":    model,
        "stream":   True,
        "messages": messages,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        async with client.stream(
            "POST", _OPENROUTER, headers=headers, json=payload
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                raw = line[6:]
                if raw.strip() == "[DONE]":
                    return
                try:
                    obj = json.loads(raw)
                    tok = obj["choices"][0]["delta"].get("content", "")
                    if tok:
                        yield tok
                except Exception:
                    continue


# ============================================================================
# POST /api/query/ask
# ============================================================================

@router.post("/ask")
async def query_ask(body: AskBody) -> EventSourceResponse:
    """
    POST /api/query/ask
    Body: { "question": string }
    Returns: text/event-stream
    """

    async def event_generator():
        world = (body.world or "demo").strip().lower()
        graph = load_memory_graph() if world == "memory" else _load_graph()

        if not graph.get("nodes"):
            yield {"data": json.dumps({"type": "chunk", "content": "Your network is empty — upload some data first."})}
            yield {"data": json.dumps({"type": "done"})}
            return

        api_key, model = _resolve_key_model()
        if not api_key:
            yield {
                "data": json.dumps({
                    "type":    "error",
                    "message": "No API key configured. Add your OpenRouter key in Settings.",
                })
            }
            return

        # Memory world: more nodes needed to cover 23 segments; no route detection
        if world == "memory":
            max_ctx = 20
        else:
            _ROUTE_KEYWORDS = {"route", "snelste", "shortest", "pad", "path", "stappen",
                               "steps", "van", "naar", "from", "to", "doorloop", "flow",
                               "kritiek", "critical", "hoe kom", "hoe werkt", "process"}
            q_lower = body.question.lower()
            max_ctx = 20 if any(kw in q_lower for kw in _ROUTE_KEYWORDS) else 12

        context = find_relevant_context(body.question, graph, max_nodes=max_ctx)

        # ── thinking event ────────────────────────────────────────────────────
        yield {
            "data": json.dumps({
                "type":       "thinking",
                "keywords":   context["keywords"],
                "node_count": len(context["relevant_nodes"]),
            })
        }

        messages = [
            {"role": "system", "content": _build_system_prompt(context, world=world)},
            {"role": "user",   "content": body.question},
        ]

        raw_buf     = ""
        full_txt    = ""
        highlighted: List[str] = []
        graph_nodes = graph["nodes"]

        try:
            async for tok in _stream_openrouter(api_key, model, messages):
                raw_buf  += tok
                full_txt += tok

                # ── process [[bracket]] refs inline ──────────────────────────
                while raw_buf:
                    open_pos = raw_buf.find("[[")

                    if open_pos == -1:
                        # Guard trailing "[" that might start a "[["
                        if raw_buf.endswith("["):
                            safe, raw_buf = raw_buf[:-1], raw_buf[-1:]
                        else:
                            safe, raw_buf = raw_buf, ""
                        if safe:
                            yield {"data": json.dumps({"type": "chunk", "content": safe})}
                        break

                    if open_pos > 0:
                        yield {"data": json.dumps({"type": "chunk", "content": raw_buf[:open_pos]})}
                        raw_buf = raw_buf[open_pos:]

                    close_pos = raw_buf.find("]]")
                    if close_pos == -1:
                        break  # incomplete reference — wait for next token

                    ref     = raw_buf[2:close_pos]
                    raw_buf = raw_buf[close_pos + 2:]

                    if ref:
                        yield {"data": json.dumps({"type": "chunk", "content": ref})}

                    nid = _find_node_id(ref, graph_nodes)
                    if nid and nid not in highlighted:
                        highlighted.append(nid)
                        yield {"data": json.dumps({"type": "highlight", "node_id": nid})}

        except httpx.HTTPStatusError as exc:
            yield {"data": json.dumps({"type": "error", "message": f"AI service error ({exc.response.status_code})."})}
            return
        except Exception as exc:
            yield {"data": json.dumps({"type": "error", "message": f"Stream failed: {type(exc).__name__}"})}
            return

        # Flush leftover buffer
        if raw_buf:
            clean = re.sub(r"\[\[([^\]]*)", r"\1", raw_buf).replace("]]", "")
            if clean:
                yield {"data": json.dumps({"type": "chunk", "content": clean})}

        # ── sources event ─────────────────────────────────────────────────────
        sources = _parse_sources(full_txt, graph_nodes)
        yield {"data": json.dumps({"type": "sources", "sources": sources})}

        yield {"data": json.dumps({"type": "done"})}

    return EventSourceResponse(event_generator())


# ============================================================================
# GET /api/query/smart-questions
# ============================================================================

@router.get("/smart-questions")
async def smart_questions():
    """
    GET /api/query/smart-questions
    Returns up to 5 contextual questions based on the current graph + bottlenecks.
    Falls back to structural questions when no API key is available.
    """
    graph = _load_graph()
    nodes = graph.get("nodes", [])

    if not nodes:
        return {"questions": [
            "Welke processen zijn het meest afhankelijk van elkaar?",
            "Waar zitten de grootste risico's in het netwerk?",
            "Welke knopen hebben de meeste verbindingen?",
            "Hoe is de flow van begin tot einde?",
            "Welke stappen vormen de kritieke route?",
        ]}

    api_key, model = _resolve_key_model()

    # Build concise graph summary for the prompt
    node_labels = [n.get("label", n.get("id", "")) for n in nodes[:30]]
    bn_data = _load_json(_BOTTLENECK_FILE, {})
    bottlenecks = bn_data.get("bottlenecks", [])
    bn_labels = [b.get("label", b.get("node_id", "")) for b in bottlenecks[:5]]

    summary_lines = [
        f"Graph has {len(nodes)} nodes and {len(graph.get('edges', []))} edges.",
        f"Sample nodes: {', '.join(node_labels[:15])}",
    ]
    if bn_labels:
        summary_lines.append(f"Bottleneck nodes: {', '.join(bn_labels)}")

    summary = "\n".join(summary_lines)

    if not api_key:
        # Structural fallback based on graph content
        questions = [
            f"Welke rol speelt {node_labels[0]} in het netwerk?" if node_labels else "Wat zijn de centrale processen?",
            "Welke knopen hebben de meeste inkomende verbindingen?",
            "Hoe verloopt de kritieke route door het netwerk?",
        ]
        if bn_labels:
            questions.append(f"Waarom is {bn_labels[0]} een bottleneck?")
        questions.append("Welke processen kunnen parallel worden uitgevoerd?")
        return {"questions": questions[:5]}

    # Ask OpenRouter for 5 smart questions
    messages = [
        {
            "role": "system",
            "content": (
                "You are a business analyst. Given a graph summary, generate exactly 5 short, "
                "insightful questions a manager might want to ask about this process network. "
                "Questions should be in Dutch. Return ONLY a JSON array of 5 strings, nothing else."
            ),
        },
        {
            "role": "user",
            "content": f"Graph summary:\n{summary}\n\nGenerate 5 smart questions as JSON array.",
        },
    ]

    collected = ""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                _OPENROUTER,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type":  "application/json",
                    "HTTP-Referer":  "https://neuralgraph.local",
                    "X-Title":       "NeuralGraph",
                },
                json={
                    "model":      model,
                    "stream":     False,
                    "max_tokens": 400,
                    "messages":   messages,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            collected = data["choices"][0]["message"]["content"].strip()
    except Exception:
        pass

    # Parse JSON array from response
    try:
        # Strip markdown fences if present
        clean = re.sub(r"```(?:json)?", "", collected).replace("```", "").strip()
        questions = json.loads(clean)
        if isinstance(questions, list):
            return {"questions": [str(q) for q in questions[:5]]}
    except Exception:
        pass

    # Last-resort fallback
    return {"questions": [
        "Welke processen vormen de kritieke route?",
        "Waar zitten de grootste bottlenecks?",
        "Welke knopen zijn het meest verbonden?",
        "Hoe kan de doorlooptijd worden verkort?",
        "Welke stappen kunnen worden geoptimaliseerd?",
    ]}
