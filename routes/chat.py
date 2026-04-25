"""
routes/chat.py
────────────────────────────────────────────────────────────────────────────
Chat endpoints for NeuralGraph.

Endpoints
─────────
  POST /chat/query   — synchronous RAG query, full response JSON
  GET  /chat/stream  — SSE streaming version, tokens + events
"""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter, Query
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from utils.encryption import decrypt_key
from utils.graph_query import extract_keywords, find_relevant_context
from routes.memory import load_memory_graph

router = APIRouter(prefix="/chat", tags=["chat"])


# ============================================================================
# Paths and constants
# ============================================================================

_DATA_DIR      = Path(__file__).parent.parent / "data"
_GRAPH_FILE    = _DATA_DIR / "graph.json"
_SETTINGS_FILE = _DATA_DIR / "settings.json"
_OPENROUTER    = "https://openrouter.ai/api/v1/chat/completions"


# ============================================================================
# Request / response models
# ============================================================================

class ConversationMessage(BaseModel):
    role:    str
    content: str


class ChatRequest(BaseModel):
    message:              str
    conversation_history: List[ConversationMessage] = []
    highlight_nodes:      bool = True


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


def _load_settings() -> Dict[str, Any]:
    return _load_json(_SETTINGS_FILE, {})


def _load_graph() -> Dict[str, Any]:
    g = _load_json(_GRAPH_FILE, {"nodes": [], "edges": []})
    g.setdefault("nodes", [])
    g.setdefault("edges", [])
    return g


def _resolve_api_key_and_model() -> Tuple[Optional[str], str]:
    settings = _load_settings()
    model    = settings.get("chat_model", "meta-llama/llama-3.3-70b-instruct")
    ciphertext = settings.get("openrouter_api_key_encrypted", "")
    if not ciphertext:
        return None, model
    try:
        return decrypt_key(ciphertext), model
    except Exception:
        return None, model


def _build_system_prompt(context: Dict[str, Any], world: str = "demo") -> str:
    subgraph_json = json.dumps(
        {
            "nodes": context["relevant_nodes"],
            "edges": context["relevant_edges"],
        },
        ensure_ascii=False,
        indent=2,
    )
    if world == "memory":
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
- End every response with: SOURCES: [comma-separated node ids used]
- Respond in the same language as the question (Dutch or English).

MEMORY GRAPH CONTEXT:
{subgraph_json}"""
    return f"""You are NeuralGraph Assistant — a retrieval system that reads a company knowledge graph for Voltera.

CRITICAL RULES — follow these without exception:
1. You ONLY use information that is explicitly present in the GRAPH CONTEXT below.
2. You do NOT use your own training knowledge, general knowledge, or assumptions about Voltera or solar panels.
3. If the answer cannot be found in the graph context, respond with: “Dit staat niet in de graph. Upload meer documentatie om deze vraag te kunnen beantwoorden.”
4. Do NOT fill in gaps with plausible-sounding information. Absence of data = absence of answer.
5. When referencing a node, wrap its label in [[double brackets]]. Example: [[Warmtepomp]] connects to [[Offerte]].
6. End every response with: SOURCES: [comma-separated node ids used]
7. Respond in the same language as the question (Dutch or English).

GRAPH CONTEXT:
{subgraph_json}"""


def _build_user_prompt(
    message: str,
    conversation_history: List[Dict[str, str]],
) -> str:
    history_text = ""
    if conversation_history:
        lines = []
        for msg in conversation_history[-10:]:
            role = msg.get("role", "user").capitalize()
            lines.append(f"{role}: {msg.get('content', '')}")
        history_text = "\n".join(lines)

    if history_text:
        return f"Conversation so far:\n{history_text}\n\nQuestion: {message}"
    return f"Question: {message}"


def _extract_bracketed_refs(text: str) -> List[str]:
    return re.findall(r"\[\[([^\]]+)\]\]", text)


def _find_node_id_for_label(label: str, nodes: List[Dict[str, Any]]) -> Optional[str]:
    label_lower = label.strip().lower()
    for node in nodes:
        if (node.get("label") or "").lower() == label_lower:
            return node.get("id")
    for node in nodes:
        if (node.get("id") or "").lower() == label_lower:
            return node.get("id")
    return None


def _parse_sources_line(text: str) -> Tuple[str, List[str]]:
    pattern = re.compile(r"\n?SOURCES:\s*([^\n]*)$", re.IGNORECASE)
    match = pattern.search(text)
    if not match:
        return text.strip(), []
    raw_ids = [s.strip() for s in match.group(1).split(",") if s.strip()]
    clean = text[: match.start()].strip()
    return clean, raw_ids


def _build_sources_list(
    node_ids: List[str],
    all_nodes: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    id_to_node = {n.get("id"): n for n in all_nodes}
    result: List[Dict[str, Any]] = []
    seen: set = set()
    for nid in node_ids:
        if nid in seen or nid not in id_to_node:
            continue
        seen.add(nid)
        node = id_to_node[nid]
        result.append({
            "id":          node.get("id", ""),
            "label":       node.get("label", ""),
            "category":    node.get("category", "concept"),
            "description": node.get("description", ""),
        })
    return result


def _post_process_response(
    raw_text: str,
    graph_nodes: List[Dict[str, Any]],
) -> Tuple[str, List[str], List[Dict[str, Any]]]:
    refs = _extract_bracketed_refs(raw_text)
    highlighted: List[str] = []
    for ref in refs:
        nid = _find_node_id_for_label(ref, graph_nodes)
        if nid and nid not in highlighted:
            highlighted.append(nid)

    display_text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", raw_text)
    display_text, source_ids = _parse_sources_line(display_text)

    all_ids = list(highlighted)
    for sid in source_ids:
        if sid not in all_ids:
            all_ids.append(sid)

    sources = _build_sources_list(all_ids, graph_nodes)
    return display_text, all_ids, sources


# ============================================================================
# OpenRouter calls
# ============================================================================

async def _call_openrouter(
    *,
    api_key: str,
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = 45.0,
) -> str:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json",
    }
    payload = {"model": model, "temperature": 0.3, "messages": messages}
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(_OPENROUTER, headers=headers, json=payload)
    resp.raise_for_status()
    data = resp.json()
    return data.get("choices", [{}])[0].get("message", {}).get("content", "")


async def _stream_openrouter(
    *,
    api_key: str,
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = 60.0,
) -> AsyncIterator[str]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json",
    }
    payload = {"model": model, "temperature": 0.3, "stream": True, "messages": messages}
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", _OPENROUTER, headers=headers, json=payload) as resp:
            resp.raise_for_status()
            async for raw_line in resp.aiter_lines():
                if not raw_line.startswith("data:"):
                    continue
                data_str = raw_line[5:].strip()
                if data_str == "[DONE]":
                    return
                try:
                    chunk = json.loads(data_str)
                    content = (
                        chunk.get("choices", [{}])[0]
                             .get("delta", {})
                             .get("content", "")
                    ) or ""
                    if content:
                        yield content
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue


# ============================================================================
# POST /chat/query  — synchronous
# ============================================================================

@router.post("/query")
async def chat_query(body: ChatRequest) -> Dict[str, Any]:
    graph = _load_graph()

    if not graph.get("nodes"):
        return {
            "response":          "Your network is empty. Upload some company data first to build your knowledge graph.",
            "highlighted_nodes": [],
            "sources":           [],
            "context_used":      {"node_count": 0, "edge_count": 0, "keywords": []},
        }

    api_key, model = _resolve_api_key_and_model()
    if not api_key:
        return {
            "response":          "No API key configured. Please add your OpenRouter key in Settings.",
            "highlighted_nodes": [],
            "sources":           [],
            "context_used":      {"node_count": 0, "edge_count": 0, "keywords": []},
        }

    context = find_relevant_context(body.message, graph)
    system_prompt = _build_system_prompt(context)
    history = [{"role": m.role, "content": m.content} for m in body.conversation_history[-18:]]
    user_msg = _build_user_prompt(body.message, [])

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_msg})

    try:
        raw_response = await _call_openrouter(api_key=api_key, model=model, messages=messages)
    except httpx.HTTPStatusError as exc:
        return {
            "response":     f"AI service error ({exc.response.status_code}). Please check your API key.",
            "highlighted_nodes": [], "sources": [],
            "context_used": {"node_count": len(context["relevant_nodes"]), "edge_count": len(context["relevant_edges"]), "keywords": context["keywords"]},
        }
    except Exception as exc:
        return {
            "response":     f"Could not reach the AI service: {type(exc).__name__}.",
            "highlighted_nodes": [], "sources": [],
            "context_used": {"node_count": len(context["relevant_nodes"]), "edge_count": len(context["relevant_edges"]), "keywords": context["keywords"]},
        }

    clean_text, highlighted_nodes, sources = _post_process_response(raw_response, graph["nodes"])

    return {
        "response":          clean_text,
        "highlighted_nodes": highlighted_nodes,
        "sources":           sources,
        "context_used": {
            "node_count": len(context["relevant_nodes"]),
            "edge_count": len(context["relevant_edges"]),
            "keywords":   context["keywords"],
        },
    }


# ============================================================================
# GET /chat/stream  — SSE streaming
# ============================================================================

@router.get("/stream")
async def chat_stream(
    message:              str  = Query(...),
    conversation_history: str  = Query(default="[]"),
    highlight_nodes:      bool = Query(default=True),
    world:                str  = Query(default="demo"),
) -> EventSourceResponse:
    """
    SSE streaming chat endpoint.

    Events
    ──────
        {"type": "token",     "content": "..."}
        {"type": "highlight", "node_ids": ["id1", ...]}
        {"type": "sources",   "sources": [...], "context_used": {...}}
        {"type": "done"}
        {"type": "error",     "message": "..."}
    """

    async def event_generator():
        _world = (world or "demo").strip().lower()
        graph = load_memory_graph() if _world == "memory" else _load_graph()

        if not graph.get("nodes"):
            yield {"data": json.dumps({"type": "token", "content": "Your network is empty. Upload some company data first."})}
            yield {"data": json.dumps({"type": "done"})}
            return

        api_key, model = _resolve_api_key_and_model()
        if not api_key:
            yield {"data": json.dumps({"type": "error", "message": "No API key configured. Please add your OpenRouter key in Settings."})}
            return

        try:
            raw_history = json.loads(conversation_history) or []
        except (json.JSONDecodeError, ValueError):
            raw_history = []

        context = find_relevant_context(message, graph)
        system_prompt = _build_system_prompt(context, world=_world)
        user_msg = _build_user_prompt(message, raw_history[-18:])

        messages: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}]
        for m in raw_history[-18:]:
            if isinstance(m, dict) and m.get("role") and m.get("content"):
                messages.append({"role": m["role"], "content": m["content"]})
        messages.append({"role": "user", "content": user_msg})

        # Streaming with real-time [[bracket]] processing
        raw_buffer   = ""
        full_text    = ""
        pending_high: List[str] = []
        graph_nodes  = graph["nodes"]

        try:
            async for token in _stream_openrouter(api_key=api_key, model=model, messages=messages):
                raw_buffer += token
                full_text  += token

                while raw_buffer:
                    open_pos = raw_buffer.find("[[")

                    if open_pos == -1:
                        # Guard trailing "[" (might be start of "[[")
                        if raw_buffer.endswith("["):
                            safe, raw_buffer = raw_buffer[:-1], raw_buffer[-1:]
                        else:
                            safe, raw_buffer = raw_buffer, ""
                        if safe:
                            yield {"data": json.dumps({"type": "token", "content": safe})}
                        break

                    if open_pos > 0:
                        yield {"data": json.dumps({"type": "token", "content": raw_buffer[:open_pos]})}
                        raw_buffer = raw_buffer[open_pos:]

                    close_pos = raw_buffer.find("]]")
                    if close_pos == -1:
                        break  # incomplete reference — await next token

                    ref = raw_buffer[2:close_pos]
                    raw_buffer = raw_buffer[close_pos + 2:]

                    if ref:
                        yield {"data": json.dumps({"type": "token", "content": ref})}

                    nid = _find_node_id_for_label(ref, graph_nodes)
                    if nid and nid not in pending_high:
                        pending_high.append(nid)
                        yield {"data": json.dumps({"type": "highlight", "node_ids": [nid]})}

            # Flush leftover buffer
            if raw_buffer:
                clean = re.sub(r"\[\[([^\]]*)", r"\1", raw_buffer).replace("]]", "")
                if clean:
                    yield {"data": json.dumps({"type": "token", "content": clean})}

        except httpx.HTTPStatusError as exc:
            yield {"data": json.dumps({"type": "error", "message": f"AI service error ({exc.response.status_code})."})}
            return
        except Exception as exc:
            yield {"data": json.dumps({"type": "error", "message": f"Stream failed: {type(exc).__name__}"})}
            return

        # Post-process SOURCES line from full accumulated text
        _, source_ids = _parse_sources_line(full_text)

        all_ids = list(pending_high)
        for sid in source_ids:
            if sid not in all_ids:
                all_ids.append(sid)

        sources = _build_sources_list(all_ids, graph_nodes)

        if all_ids:
            yield {"data": json.dumps({"type": "highlight", "node_ids": all_ids})}

        yield {
            "data": json.dumps({
                "type":    "sources",
                "sources": sources,
                "context_used": {
                    "node_count": len(context["relevant_nodes"]),
                    "edge_count": len(context["relevant_edges"]),
                    "keywords":   context["keywords"],
                },
            })
        }
        yield {"data": json.dumps({"type": "done"})}

    return EventSourceResponse(event_generator())
