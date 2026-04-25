"""
utils/graph_extractor.py
────────────────────────────────────────────────────────────────────────────
LLM prompt-engineered graph extraction helpers for NeuralGraph.
"""

from __future__ import annotations

import ast
import json
import re
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Tuple

import httpx

from utils.file_processor import chunk_text, detect_language_code


# ============================================================================
# Prompt templates (required exact extraction prompt)
# ============================================================================

SYSTEM_PROMPT = """You are a knowledge graph extraction engine.
Your only job is to analyze text and extract
entities and relationships to build a
knowledge graph. You output valid JSON only.
No explanations. No markdown.
Just the raw JSON object.

EXTRACTION RULES:
1. Extract ENTITIES (become nodes):
   - Products, services, features
   - Business processes and steps
   - People, roles, departments
   - Rules, regulations, compliance items
   - Financial concepts, payment methods
   - Locations, systems, tools
   - Key concepts specific to this business

2. Extract RELATIONSHIPS (become edges):
   - Only extract relationships explicitly
     stated or strongly implied in the text
   - Do not invent relationships
   - Each relationship needs:
     source entity, target entity,
     relationship label (max 4 words,
     active verb phrase)

3. CATEGORIZE each node as exactly one of:
   product, process, compliance,
   finance, customer, person,
   system, location, concept

4. DEDUPLICATION:
   You will receive the existing graph nodes.
   Do NOT create a new node if a very similar
   one already exists.
   Instead reference the existing node's id.

5. NODE IDs:
   Create clean snake_case ids.
   Max 30 characters.
   Must be unique.
   Examples: warmtepomp,
   afm_compliance_check, klant_intake

6. OUTPUT FORMAT — return exactly this:
{
  "nodes": [
    {
      "id": "snake_case_id",
      "label": "Human Readable Label",
      "category": "one of the 9 categories",
      "description": "one sentence description",
      "source_chunk": "first 60 chars of
        source text this came from"
    }
  ],
  "edges": [
    {
      "from": "existing_or_new_node_id",
      "to": "existing_or_new_node_id",
      "label": "relationship label",
      "weight": 1.0
    }
  ],
  "extraction_meta": {
    "entities_found": 0,
    "relationships_found": 0,
    "language_detected": "nl/en",
    "confidence": 0.0 to 1.0
  }
}
"""

USER_PROMPT_TEMPLATE = """EXISTING GRAPH NODES (do not duplicate these):
{existing_nodes_json}

TEXT TO ANALYZE (chunk {chunk_index} of {total_chunks}):
---
{text_chunk}
---

Extract all entities and relationships
from this text. Follow all rules exactly.
Return only valid JSON.
"""

DEDUP_SYSTEM_PROMPT = "You are a graph deduplication engine. You output valid JSON only."
DEDUP_USER_PROMPT_TEMPLATE = """Review these nodes and identify
any duplicates or near-duplicates
(same concept, different labels).
Return a merge map:
{
  "merges": [
    {
      "keep": "node_id_to_keep",
      "remove": ["list", "of",
        "duplicate_ids"],
      "reason": "why these are duplicates"
    }
  ]
}
Nodes: {all_nodes_json}
"""

VALID_CATEGORIES = {
    "product",
    "process",
    "compliance",
    "finance",
    "customer",
    "person",
    "system",
    "location",
    "concept",
}


# ============================================================================
# JSON and normalization helpers
# ============================================================================


def _extract_json_block(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        return ""

    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last != -1 and last > first:
        return text[first : last + 1]
    return text



def _parse_json_maybe_loose(raw: str) -> Dict[str, Any]:
    candidate = _extract_json_block(raw)
    if not candidate:
        raise ValueError("Empty model response")

    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass

    try:
        parsed = ast.literal_eval(candidate)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    raise ValueError("Model response was not valid JSON")



def _normalize_id(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9]+", "_", (value or "").strip().lower())
    text = re.sub(r"_+", "_", text).strip("_")
    if not text:
        text = "entity"
    return text[:30]



def _ensure_unique_id(base_id: str, existing_ids: Iterable[str]) -> str:
    existing = set(existing_ids)
    if base_id not in existing:
        return base_id

    index = 2
    while True:
        suffix = f"_{index}"
        candidate = f"{base_id[: max(1, 30 - len(suffix))]}{suffix}"
        if candidate not in existing:
            return candidate
        index += 1



def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()



def _sanitize_graph_fragment(payload: Dict[str, Any], existing_graph: Dict[str, Any]) -> Dict[str, Any]:
    existing_ids = {str(node.get("id", "")) for node in existing_graph.get("nodes", [])}
    normalized_nodes: List[Dict[str, Any]] = []
    local_new_ids = set()

    for raw_node in payload.get("nodes", []):
        label = str(raw_node.get("label", "")).strip()
        description = str(raw_node.get("description", "")).strip()
        category = str(raw_node.get("category", "concept")).strip().lower()
        source_chunk = str(raw_node.get("source_chunk", "")).strip()[:60]

        if not label:
            continue
        if category not in VALID_CATEGORIES:
            category = "concept"

        suggested = _normalize_id(str(raw_node.get("id") or label))
        node_id = _ensure_unique_id(suggested, existing_ids | local_new_ids)
        local_new_ids.add(node_id)

        normalized_nodes.append(
            {
                "id": node_id,
                "label": label[:120],
                "category": category,
                "description": description[:240] or f"{label} extracted from source text.",
                "source_chunk": source_chunk,
            }
        )

    valid_ids = existing_ids | {node["id"] for node in normalized_nodes}
    normalized_edges: List[Dict[str, Any]] = []
    seen_edges = set()

    for raw_edge in payload.get("edges", []):
        frm = str(raw_edge.get("from", "")).strip()
        to = str(raw_edge.get("to", "")).strip()
        label = re.sub(r"\s+", " ", str(raw_edge.get("label", "")).strip())[:64]

        if not frm or not to or not label:
            continue
        if frm not in valid_ids or to not in valid_ids:
            continue
        if frm == to:
            continue

        words = label.split()
        if len(words) > 4:
            label = " ".join(words[:4])

        try:
            weight = float(raw_edge.get("weight", 1.0))
        except (TypeError, ValueError):
            weight = 1.0

        edge_key = (frm, to, label.lower())
        if edge_key in seen_edges:
            continue
        seen_edges.add(edge_key)

        normalized_edges.append({"from": frm, "to": to, "label": label, "weight": max(0.1, min(weight, 5.0))})

    language_detected = payload.get("extraction_meta", {}).get("language_detected", "unknown")
    if language_detected not in {"nl", "en"}:
        language_detected = detect_language_code(" ".join(node["label"] for node in normalized_nodes))

    try:
        confidence = float(payload.get("extraction_meta", {}).get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0

    return {
        "nodes": normalized_nodes,
        "edges": normalized_edges,
        "extraction_meta": {
            "entities_found": len(normalized_nodes),
            "relationships_found": len(normalized_edges),
            "language_detected": language_detected,
            "confidence": max(0.0, min(confidence, 1.0)),
        },
    }


# ============================================================================
# OpenRouter calls
# ============================================================================


async def _call_openrouter_json(
    *,
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    timeout_seconds: float = 45.0,
) -> Dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json=payload,
        )

    response.raise_for_status()
    response_json = response.json()
    content = response_json.get("choices", [{}])[0].get("message", {}).get("content", "")
    return _parse_json_maybe_loose(content)


# ============================================================================
# Chunk extraction and merge
# ============================================================================


async def extract_chunk_graph(
    *,
    text_chunk: str,
    existing_graph: Dict[str, Any],
    model: str,
    api_key: str,
    chunk_index: int,
    total_chunks: int,
) -> Dict[str, Any]:
    existing_nodes_json = json.dumps(existing_graph.get("nodes", []), ensure_ascii=False)
    user_prompt = USER_PROMPT_TEMPLATE.format(
        existing_nodes_json=existing_nodes_json,
        chunk_index=chunk_index,
        total_chunks=total_chunks,
        text_chunk=text_chunk,
    )

    last_exc: Exception | None = None
    for _attempt in range(2):
        try:
            raw_payload = await _call_openrouter_json(
                api_key=api_key,
                model=model,
                system_prompt=SYSTEM_PROMPT,
                user_prompt=user_prompt,
            )
            return _sanitize_graph_fragment(raw_payload, existing_graph)
        except Exception as exc:  # retry once on malformed JSON or network hiccup
            last_exc = exc

    # Graceful degradation after retry
    return {
        "nodes": [],
        "edges": [],
        "extraction_meta": {
            "entities_found": 0,
            "relationships_found": 0,
            "language_detected": detect_language_code(text_chunk),
            "confidence": 0.0,
            "warning": f"Chunk {chunk_index} extraction failed: {type(last_exc).__name__}",
        },
    }



def merge_graph_data(base_graph: Dict[str, Any], additions: Dict[str, Any]) -> Tuple[int, int]:
    """Merge nodes and edges into base graph; returns (nodes_added, edges_added)."""
    base_graph.setdefault("nodes", [])
    base_graph.setdefault("edges", [])

    node_by_id = {node.get("id"): node for node in base_graph["nodes"]}
    nodes_added = 0

    for node in additions.get("nodes", []):
        node_id = node.get("id")
        if not node_id:
            continue

        if node_id not in node_by_id:
            base_graph["nodes"].append(node)
            node_by_id[node_id] = node
            nodes_added += 1
            continue

        # If same id already exists, enrich missing fields instead of overriding.
        existing = node_by_id[node_id]
        if not existing.get("description") and node.get("description"):
            existing["description"] = node["description"]

    existing_edge_keys = {
        (edge.get("from"), edge.get("to"), str(edge.get("label", "")).strip().lower())
        for edge in base_graph["edges"]
    }
    valid_ids = set(node_by_id.keys())
    edges_added = 0

    for edge in additions.get("edges", []):
        frm = edge.get("from")
        to = edge.get("to")
        label = str(edge.get("label", "")).strip().lower()
        if not frm or not to or not label:
            continue
        if frm not in valid_ids or to not in valid_ids:
            continue

        edge_key = (frm, to, label)
        if edge_key in existing_edge_keys:
            continue

        base_graph["edges"].append(edge)
        existing_edge_keys.add(edge_key)
        edges_added += 1

    return nodes_added, edges_added


# ============================================================================
# Deduplication pass
# ============================================================================


async def deduplicate_graph(
    *, graph: Dict[str, Any], model: str, api_key: str
) -> Dict[str, Any]:
    """
    Run AI-assisted deduplication and apply merges. Includes local fallback
    similarity matching for obvious duplicates if AI output is malformed.
    """
    graph.setdefault("nodes", [])
    graph.setdefault("edges", [])

    merges: List[Dict[str, Any]] = []
    try:
        user_prompt = DEDUP_USER_PROMPT_TEMPLATE.format(
            all_nodes_json=json.dumps(graph["nodes"], ensure_ascii=False)
        )
        payload = await _call_openrouter_json(
            api_key=api_key,
            model=model,
            system_prompt=DEDUP_SYSTEM_PROMPT,
            user_prompt=user_prompt,
        )
        merges = payload.get("merges", []) if isinstance(payload, dict) else []
    except Exception:
        merges = []

    # Fallback local near-duplicate detection by label similarity.
    if not merges:
        nodes = graph["nodes"]
        for i in range(len(nodes)):
            for j in range(i + 1, len(nodes)):
                a = nodes[i]
                b = nodes[j]
                if a.get("id") == b.get("id"):
                    continue
                if _similarity(str(a.get("label", "")), str(b.get("label", ""))) >= 0.93:
                    merges.append(
                        {
                            "keep": a.get("id"),
                            "remove": [b.get("id")],
                            "reason": "labels are near-identical",
                        }
                    )

    keep_to_remove: Dict[str, set[str]] = {}
    for merge in merges:
        keep = str(merge.get("keep", "")).strip()
        remove_ids = [str(x).strip() for x in merge.get("remove", []) if str(x).strip()]
        if not keep or not remove_ids:
            continue
        keep_to_remove.setdefault(keep, set()).update(remove_ids)

    if not keep_to_remove:
        return {"nodes_merged": 0, "graph": graph}

    remove_to_keep: Dict[str, str] = {}
    for keep_id, remove_ids in keep_to_remove.items():
        for remove_id in remove_ids:
            if remove_id != keep_id:
                remove_to_keep[remove_id] = keep_id

    merged_count = len(remove_to_keep)
    if merged_count == 0:
        return {"nodes_merged": 0, "graph": graph}

    # Update edges to kept ids.
    for edge in graph["edges"]:
        edge["from"] = remove_to_keep.get(edge.get("from"), edge.get("from"))
        edge["to"] = remove_to_keep.get(edge.get("to"), edge.get("to"))

    # Remove duplicate node ids.
    graph["nodes"] = [node for node in graph["nodes"] if node.get("id") not in remove_to_keep]

    # Remove now-duplicate edges.
    seen = set()
    unique_edges: List[Dict[str, Any]] = []
    for edge in graph["edges"]:
        key = (edge.get("from"), edge.get("to"), str(edge.get("label", "")).strip().lower())
        if key in seen:
            continue
        seen.add(key)
        unique_edges.append(edge)
    graph["edges"] = unique_edges

    return {"nodes_merged": merged_count, "graph": graph}


# ============================================================================
# High-level API
# ============================================================================


async def extract_graph_from_text(
    text: str,
    existing_graph: Dict[str, Any],
    model: str,
    api_key: str,
) -> Dict[str, Any]:
    """Extract graph additions from text; includes chunked processing + dedup pass."""
    chunks = chunk_text(text)
    if not chunks:
        return {
            "nodes": [],
            "edges": [],
            "extraction_meta": {
                "entities_found": 0,
                "relationships_found": 0,
                "language_detected": "unknown",
                "confidence": 0.0,
            },
            "nodes_merged": 0,
        }

    running_graph = {
        "nodes": list(existing_graph.get("nodes", [])),
        "edges": list(existing_graph.get("edges", [])),
    }

    total_entities = 0
    total_relationships = 0
    confidence_values: List[float] = []

    for chunk in chunks:
        result = await extract_chunk_graph(
            text_chunk=chunk["text"],
            existing_graph=running_graph,
            model=model,
            api_key=api_key,
            chunk_index=chunk["index"],
            total_chunks=chunk["total"],
        )
        merge_graph_data(running_graph, result)

        meta = result.get("extraction_meta", {})
        total_entities += int(meta.get("entities_found", 0) or 0)
        total_relationships += int(meta.get("relationships_found", 0) or 0)
        confidence_values.append(float(meta.get("confidence", 0.0) or 0.0))

    dedup_result = await deduplicate_graph(graph=running_graph, model=model, api_key=api_key)
    running_graph = dedup_result["graph"]

    return {
        "nodes": running_graph.get("nodes", []),
        "edges": running_graph.get("edges", []),
        "extraction_meta": {
            "entities_found": total_entities,
            "relationships_found": total_relationships,
            "language_detected": detect_language_code(text),
            "confidence": (sum(confidence_values) / len(confidence_values)) if confidence_values else 0.0,
        },
        "nodes_merged": int(dedup_result.get("nodes_merged", 0)),
    }
