"""
routes/graph.py
────────────────────────────────────────────────────────────────────────────
Graph endpoints for upload, extraction, persistence, and SSE progress events.
"""

from __future__ import annotations

import json
import asyncio
import math
import random
import re
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from utils.encryption import decrypt_key
from utils.file_processor import detect_language_code, process_file, process_input_text
from utils.graph_extractor import deduplicate_graph, extract_chunk_graph, merge_graph_data

router = APIRouter(prefix="/graph", tags=["graph"])


# ============================================================================
# Paths and defaults
# ============================================================================

DATA_DIR = Path(__file__).parent.parent / "data"
GRAPH_FILE = DATA_DIR / "graph.json"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
SETTINGS_FILE = DATA_DIR / "settings.json"

EMPTY_GRAPH = {
    "nodes": [],
    "edges": [],
    "meta": {
        "created": "",
        "source_files": [],
    },
}


# ============================================================================
# Request models
# ============================================================================


class ExtractRequest(BaseModel):
    text: Optional[str] = None
    file_id: Optional[str] = None
    mode: str = "append"  # append | replace


# ============================================================================
# Internal helpers
# ============================================================================


def _ensure_data_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)


def _read_json(path: Path, fallback: Dict[str, Any]) -> Dict[str, Any]:
    if not path.exists():
        return json.loads(json.dumps(fallback))
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return json.loads(json.dumps(fallback))


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def _safe_file_id(file_id: str) -> str:
    if not file_id:
        return ""
    cleaned = re.sub(r"[^a-zA-Z0-9._-]", "_", file_id)
    return cleaned.strip(".")


def _load_graph() -> Dict[str, Any]:
    graph = _read_json(GRAPH_FILE, EMPTY_GRAPH)
    graph.setdefault("nodes", [])
    graph.setdefault("edges", [])
    graph.setdefault("meta", {})
    graph["meta"].setdefault("source_files", [])
    return graph


def _load_settings() -> Dict[str, Any]:
    return _read_json(SETTINGS_FILE, {})


def _load_api_key_and_model() -> tuple[Optional[str], str]:
    settings = _load_settings()
    model = settings.get("graph_model", "anthropic/claude-sonnet-4-6")
    encrypted = settings.get("openrouter_api_key_encrypted", "")

    if not encrypted:
        return None, model

    try:
        return decrypt_key(encrypted), model
    except Exception:
        return None, model


def _resolve_file_path(file_id: str) -> Path:
    safe = _safe_file_id(file_id)
    if not safe:
        raise HTTPException(status_code=400, detail="Invalid file_id")

    candidate = RAW_DIR / safe
    if candidate.exists() and candidate.is_file():
        return candidate

    raise HTTPException(status_code=404, detail="file_id not found")


def _get_input_text(text: Optional[str], file_id: Optional[str]) -> Dict[str, Any]:
    if text and text.strip():
        return process_input_text(text)

    if not file_id:
        raise HTTPException(status_code=400, detail="Provide either text or file_id")

    file_path = _resolve_file_path(file_id)
    return process_file(file_path)


async def _maybe_emit(
    emit_fn: Optional[Callable[[str, str, int, Optional[Dict[str, Any]]], Awaitable[None]]],
    step: str,
    message: str,
    progress: int,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    if emit_fn is None:
        return
    await emit_fn(step, message, progress, extra)


async def _run_extraction_pipeline(
    *,
    text: Optional[str],
    file_id: Optional[str],
    mode: str,
    api_key: str,
    model: str,
    emit_fn: Optional[Callable[[str, str, int, Optional[Dict[str, Any]]], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    start_time = time.perf_counter()

    await _maybe_emit(emit_fn, "loading_file", "Loading your data...", 5)
    processed = _get_input_text(text, file_id)

    chunks = processed.get("chunks", [])
    total_chunks = len(chunks)
    await _maybe_emit(
        emit_fn,
        "chunking",
        f"Splitting into {total_chunks} chunks...",
        10,
        {"chunk_count": total_chunks},
    )

    existing_graph = _load_graph() if mode == "append" else json.loads(json.dumps(EMPTY_GRAPH))
    baseline_node_ids = {node.get("id") for node in existing_graph.get("nodes", [])}
    baseline_edge_keys = {
        (edge.get("from"), edge.get("to"), str(edge.get("label", "")).strip().lower())
        for edge in existing_graph.get("edges", [])
    }

    confidence_values: list[float] = []
    extracted_entities = 0
    extracted_relationships = 0

    for chunk in chunks:
        chunk_index = int(chunk.get("index", 1))
        progress = 20 + int((chunk_index / max(1, total_chunks)) * 60)
        await _maybe_emit(
            emit_fn,
            "extracting",
            f"Analyzing chunk {chunk_index} of {total_chunks}...",
            progress,
            {"chunk_index": chunk_index, "total_chunks": total_chunks},
        )

        result = await extract_chunk_graph(
            text_chunk=chunk.get("text", ""),
            existing_graph=existing_graph,
            model=model,
            api_key=api_key,
            chunk_index=chunk_index,
            total_chunks=total_chunks,
        )
        merge_graph_data(existing_graph, result)

        meta = result.get("extraction_meta", {})
        extracted_entities += int(meta.get("entities_found", 0) or 0)
        extracted_relationships += int(meta.get("relationships_found", 0) or 0)
        try:
            confidence_values.append(float(meta.get("confidence", 0.0) or 0.0))
        except (TypeError, ValueError):
            confidence_values.append(0.0)

    await _maybe_emit(emit_fn, "deduplicating", "Cleaning up duplicates...", 85)
    dedup_result = await deduplicate_graph(graph=existing_graph, model=model, api_key=api_key)
    updated_graph = dedup_result.get("graph", existing_graph)
    nodes_merged = int(dedup_result.get("nodes_merged", 0))

    await _maybe_emit(emit_fn, "saving", "Saving to graph...", 95)
    _write_json(GRAPH_FILE, updated_graph)

    final_node_ids = {node.get("id") for node in updated_graph.get("nodes", [])}
    final_edge_keys = {
        (edge.get("from"), edge.get("to"), str(edge.get("label", "")).strip().lower())
        for edge in updated_graph.get("edges", [])
    }

    if mode == "replace":
        nodes_added = len(updated_graph.get("nodes", []))
        edges_added = len(updated_graph.get("edges", []))
    else:
        nodes_added = len(final_node_ids - baseline_node_ids)
        edges_added = len(final_edge_keys - baseline_edge_keys)

    result = {
        "status": "success",
        "nodes_added": nodes_added,
        "edges_added": edges_added,
        "nodes_merged": nodes_merged,
        "total_nodes": len(updated_graph.get("nodes", [])),
        "total_edges": len(updated_graph.get("edges", [])),
        "graph": updated_graph,
        "processing_time_ms": int((time.perf_counter() - start_time) * 1000),
        "extraction_meta": {
            "entities_found": extracted_entities,
            "relationships_found": extracted_relationships,
            "language_detected": detect_language_code(processed.get("text", "")),
            "confidence": (sum(confidence_values) / len(confidence_values)) if confidence_values else 0.0,
        },
    }

    return result


# ============================================================================
# Endpoints
# ============================================================================


@router.post("/extract")
async def extract_graph(body: ExtractRequest) -> Dict[str, Any]:
    _ensure_data_dirs()

    mode = (body.mode or "append").strip().lower()
    if mode not in {"append", "replace"}:
        raise HTTPException(status_code=400, detail="mode must be 'append' or 'replace'")

    api_key, model = _load_api_key_and_model()
    if not api_key:
        return {"error": "no_api_key", "message": "Configure API key in settings"}

    return await _run_extraction_pipeline(
        text=body.text,
        file_id=body.file_id,
        mode=mode,
        api_key=api_key,
        model=model,
    )


@router.get("/extract/stream")
async def extract_graph_stream(
    text: Optional[str] = Query(default=None),
    file_id: Optional[str] = Query(default=None),
    mode: str = Query(default="append"),
) -> EventSourceResponse:
    _ensure_data_dirs()
    mode = (mode or "append").strip().lower()

    async def event_generator():
        if mode not in {"append", "replace"}:
            payload = {"step": "error", "message": "mode must be append or replace", "progress": 0}
            yield {"data": json.dumps(payload)}
            return

        api_key, model_name = _load_api_key_and_model()
        if not api_key:
            payload = {
                "step": "error",
                "message": "Configure API key in settings",
                "progress": 0,
                "error": "no_api_key",
            }
            yield {"data": json.dumps(payload)}
            return

        queue: asyncio.Queue[Optional[Dict[str, Any]]] = asyncio.Queue()

        async def emit(step: str, message: str, progress: int, extra: Optional[Dict[str, Any]] = None) -> None:
            payload = {"step": step, "message": message, "progress": progress}
            if extra:
                payload.update(extra)
            await queue.put(payload)

        async def run_pipeline() -> None:
            try:
                result = await _run_extraction_pipeline(
                    text=text,
                    file_id=file_id,
                    mode=mode,
                    api_key=api_key,
                    model=model_name,
                    emit_fn=emit,
                )

                final_payload = {
                    "step": "complete",
                    "message": (
                        f"Done! {result['nodes_added']} nodes, {result['edges_added']} edges added."
                    ),
                    "progress": 100,
                    "result": result,
                }
                await queue.put(final_payload)
            except HTTPException as exc:
                await queue.put({"step": "error", "message": str(exc.detail), "progress": 0})
            except Exception as exc:
                await queue.put(
                    {
                        "step": "error",
                        "message": f"Extraction failed: {type(exc).__name__}",
                        "progress": 0,
                    }
                )
            finally:
                await queue.put(None)

        task = asyncio.create_task(run_pipeline())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield {"data": json.dumps(event, ensure_ascii=False)}
        finally:
            if not task.done():
                task.cancel()

    return EventSourceResponse(event_generator())


@router.post("/upload")
async def upload_data_source(
    file: Optional[UploadFile] = File(default=None),
    text: Optional[str] = Form(default=None),
) -> Dict[str, Any]:
    _ensure_data_dirs()

    if file is None and not (text and text.strip()):
        raise HTTPException(status_code=400, detail="Provide a file or text")

    timestamp = int(time.time() * 1000)

    if file is not None:
        original_name = Path(file.filename or "upload.bin").name
        safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", original_name)
        file_id = f"{timestamp}_{safe_name}"
        raw_path = RAW_DIR / file_id

        raw_bytes = await file.read()
        raw_path.write_bytes(raw_bytes)

        try:
            processed = process_file(raw_path)
        except Exception as exc:
            raw_path.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail=f"Unable to process file: {exc}")

        file_type = processed.get("file_type", raw_path.suffix.lower().lstrip("."))
    else:
        original_name = "pasted_text"
        file_id = f"{timestamp}_pasted_text.txt"
        raw_path = RAW_DIR / file_id
        raw_path.write_text(text or "", encoding="utf-8")
        processed = process_input_text(text or "")
        file_type = "text"

    processed_path = PROCESSED_DIR / f"{file_id}.txt"
    processed_path.write_text(processed.get("text", ""), encoding="utf-8")

    return {
        "file_id": file_id,
        "original_name": original_name,
        "file_type": file_type,
        "character_count": int(processed.get("character_count", 0)),
        "chunk_count": int(processed.get("chunk_count", 0)),
        "preview": processed.get("text", "")[:200],
    }


@router.get("/load")
async def load_graph() -> Dict[str, Any]:
    _ensure_data_dirs()
    return _load_graph()


@router.post("/save")
async def save_graph(graph_payload: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_data_dirs()

    if not isinstance(graph_payload, dict):
        raise HTTPException(status_code=400, detail="Graph payload must be an object")
    if "nodes" not in graph_payload or "edges" not in graph_payload:
        raise HTTPException(status_code=400, detail="Graph must contain nodes and edges arrays")
    if not isinstance(graph_payload.get("nodes"), list) or not isinstance(graph_payload.get("edges"), list):
        raise HTTPException(status_code=400, detail="nodes and edges must be arrays")

    graph_payload.setdefault("meta", {"source_files": []})
    _write_json(GRAPH_FILE, graph_payload)

    return {
        "status": "saved",
        "nodes": len(graph_payload["nodes"]),
        "edges": len(graph_payload["edges"]),
    }


@router.delete("/reset")
async def reset_graph() -> Dict[str, Any]:
    _ensure_data_dirs()

    _write_json(GRAPH_FILE, json.loads(json.dumps(EMPTY_GRAPH)))

    for folder in (RAW_DIR, PROCESSED_DIR):
        for path in folder.glob("*"):
            if path.is_file():
                path.unlink(missing_ok=True)

    return {"status": "reset"}


# ============================================================================
# NEW — Node / Edge editing endpoints
# ============================================================================


def _slugify(text: str) -> str:
    """Convert a label to a safe node id slug."""
    slug = text.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_-]+", "_", slug)
    return slug[:60].strip("_") or "node"


def _unique_id(base: str, existing_ids: set) -> str:
    if base not in existing_ids:
        return base
    counter = 2
    while f"{base}_{counter}" in existing_ids:
        counter += 1
    return f"{base}_{counter}"


class NodeUpdateBody(BaseModel):
    label:       Optional[str] = None
    category:    Optional[str] = None
    description: Optional[str] = None


class AddNodeBody(BaseModel):
    node:     Dict[str, Any]
    edges:    List[Dict[str, Any]] = []
    position: Any = "auto"  # "auto" | {x, y, z}


class AddEdgeBody(BaseModel):
    from_id: str
    to_id:   str
    label:   str = ""
    weight:  float = 1.0


class SuggestBody(BaseModel):
    description:     str
    context_node_id: Optional[str] = None


@router.patch("/node/{node_id}")
async def update_node(node_id: str, body: NodeUpdateBody) -> Dict[str, Any]:
    """Update a node's mutable properties. Only provided fields are changed."""
    _ensure_data_dirs()
    graph = _load_graph()
    node_map = {n["id"]: n for n in graph["nodes"]}
    if node_id not in node_map:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")

    node = node_map[node_id]
    if body.label is not None:
        node["label"] = body.label.strip()
    if body.category is not None:
        node["category"] = body.category
    if body.description is not None:
        node["description"] = body.description

    _write_json(GRAPH_FILE, graph)
    return {"status": "updated", "node": node}


@router.post("/node/add")
async def add_node(body: AddNodeBody) -> Dict[str, Any]:
    """Add a new node (and optional edges) to the graph."""
    _ensure_data_dirs()
    graph = _load_graph()
    existing_ids = {n["id"] for n in graph["nodes"]}

    # Resolve ID
    raw_id = str(body.node.get("id") or _slugify(body.node.get("label", "node")))
    new_id = _unique_id(raw_id, existing_ids)

    # Resolve position
    if isinstance(body.position, dict):
        pos = {
            "x": float(body.position.get("x", 0)),
            "y": float(body.position.get("y", 0)),
            "z": float(body.position.get("z", 0)),
        }
    else:
        # Auto: if a parent edge is given, place near that parent
        parent_id = next(
            (e.get("from") or e.get("to") for e in body.edges
             if (e.get("from") == new_id or e.get("to") == new_id)),
            None,
        )
        parent_node = next((n for n in graph["nodes"] if n["id"] == parent_id), None)
        if parent_node:
            spread = 30.0
            pos = {
                "x": float(parent_node.get("x", 0)) + random.uniform(-spread, spread),
                "y": float(parent_node.get("y", 0)) + random.uniform(-spread, spread),
                "z": float(parent_node.get("z", 0)) + random.uniform(-spread, spread),
            }
        else:
            bound = 80.0
            pos = {
                "x": random.uniform(-bound, bound),
                "y": random.uniform(-bound, bound),
                "z": random.uniform(-bound, bound),
            }

    new_node: Dict[str, Any] = {
        "id":          new_id,
        "label":       str(body.node.get("label", new_id)).strip(),
        "category":    str(body.node.get("category", "concept")),
        "description": str(body.node.get("description", "")),
        **pos,
    }
    graph["nodes"].append(new_node)

    edges_added: List[Dict[str, Any]] = []
    for edge in body.edges:
        from_id = str(edge.get("from", "")).replace(raw_id, new_id)
        to_id   = str(edge.get("to",   "")).replace(raw_id, new_id)
        if not from_id or not to_id:
            continue
        # Validate both endpoints exist
        all_ids = {n["id"] for n in graph["nodes"]}
        if from_id not in all_ids or to_id not in all_ids:
            continue
        # Deduplicate
        already = any(
            e.get("from") == from_id and e.get("to") == to_id
            for e in graph["edges"]
        )
        if not already:
            new_edge = {"from": from_id, "to": to_id, "label": str(edge.get("label", ""))}
            graph["edges"].append(new_edge)
            edges_added.append(new_edge)

    _write_json(GRAPH_FILE, graph)
    return {
        "status":         "added",
        "node":           new_node,
        "edges_added":    edges_added,
        "final_position": pos,
    }


@router.delete("/node/{node_id}")
async def delete_node(node_id: str) -> Dict[str, Any]:
    """Remove a node and all its edges from the graph."""
    _ensure_data_dirs()
    graph = _load_graph()

    target = next((n for n in graph["nodes"] if n["id"] == node_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")

    graph["nodes"] = [n for n in graph["nodes"] if n["id"] != node_id]
    before = len(graph["edges"])
    graph["edges"] = [
        e for e in graph["edges"]
        if e.get("from") != node_id and e.get("to") != node_id
    ]
    edges_removed = before - len(graph["edges"])

    _write_json(GRAPH_FILE, graph)
    return {
        "status":             "deleted",
        "deleted_node_id":    node_id,
        "edges_removed_count": edges_removed,
    }


# ============================================================================
# Node position persistence (used by dragNodes.js after each drag)
# ============================================================================

class NodePositionRequest(BaseModel):
    node_id: str
    x: float
    y: float
    z: float


@router.post("/node-position")
async def update_node_position(body: NodePositionRequest) -> Dict[str, Any]:
    """
    Persist the 3D position of a single node without rewriting the whole graph.

    Called by the frontend drag module after every completed drag gesture.
    On the next graph load, the stored position is used as the physics start
    position so the user's manual arrangement is preserved.
    """
    _ensure_data_dirs()
    graph = _load_graph()

    node = next((n for n in graph["nodes"] if n["id"] == body.node_id), None)
    if node is None:
        raise HTTPException(status_code=404, detail=f"Node '{body.node_id}' not found")

    node["x"] = body.x
    node["y"] = body.y
    node["z"] = body.z

    _write_json(GRAPH_FILE, graph)
    return {
        "status":  "updated",
        "node_id": body.node_id,
        "x": body.x,
        "y": body.y,
        "z": body.z,
    }


@router.post("/edge/add")
async def add_edge(body: AddEdgeBody) -> Dict[str, Any]:
    """Add a directed edge. Validates both nodes exist and rejects duplicates."""
    _ensure_data_dirs()
    graph = _load_graph()
    node_ids = {n["id"] for n in graph["nodes"]}

    if body.from_id not in node_ids:
        raise HTTPException(status_code=404, detail=f"Source node '{body.from_id}' not found")
    if body.to_id not in node_ids:
        raise HTTPException(status_code=404, detail=f"Target node '{body.to_id}' not found")

    already = any(
        e.get("from") == body.from_id and e.get("to") == body.to_id
        for e in graph["edges"]
    )
    if already:
        raise HTTPException(status_code=409, detail="Edge already exists")

    new_edge: Dict[str, Any] = {
        "from":   body.from_id,
        "to":     body.to_id,
        "label":  body.label,
        "weight": body.weight,
    }
    graph["edges"].append(new_edge)
    _write_json(GRAPH_FILE, graph)
    return {"status": "added", "edge": new_edge}


@router.delete("/edge")
async def delete_edge(
    from_id: str = Query(..., alias="from"),
    to_id:   str = Query(..., alias="to"),
) -> Dict[str, Any]:
    """Remove a directed edge identified by ?from=X&to=Y query params."""
    _ensure_data_dirs()
    graph = _load_graph()
    before = len(graph["edges"])
    graph["edges"] = [
        e for e in graph["edges"]
        if not (e.get("from") == from_id and e.get("to") == to_id)
    ]
    if len(graph["edges"]) == before:
        raise HTTPException(status_code=404, detail="Edge not found")
    _write_json(GRAPH_FILE, graph)
    return {"deleted": True, "from": from_id, "to": to_id}


@router.post("/suggest")
async def suggest_nodes(body: SuggestBody) -> Dict[str, Any]:
    """
    AI-powered node/edge suggestion.
    Given a natural-language description and optional context node,
    returns a list of suggested nodes and edges for the user to review.
    """
    _ensure_data_dirs()
    graph = _load_graph()

    api_key, model = _load_api_key_and_model()
    if not api_key:
        return {"error": "no_api_key", "message": "Configure API key in settings"}

    # Build a compact graph summary for the prompt
    node_summaries = [
        f"- {n['id']}: {n.get('label', n['id'])} ({n.get('category', 'concept')})"
        for n in graph["nodes"][:60]
    ]
    graph_summary = "\n".join(node_summaries) if node_summaries else "(empty graph)"

    context_hint = ""
    if body.context_node_id:
        context_node = next((n for n in graph["nodes"] if n["id"] == body.context_node_id), None)
        if context_node:
            context_hint = (
                f"\nThe user is adding something related to the node: "
                f"{context_node.get('label', body.context_node_id)} "
                f"(category: {context_node.get('category', 'concept')})."
            )

    system_prompt = (
        "You are a knowledge graph assistant. "
        "Given a description and an existing graph, propose nodes and edges to add. "
        "Return ONLY valid JSON with this structure:\n"
        "{\n"
        "  \"nodes\": [{\"id\": \"snake_case_id\", \"label\": \"Human Label\", "
        "\"category\": \"product|process|compliance|finance|customer|person|system|location|concept\", "
        "\"description\": \"brief description\"}],\n"
        "  \"edges\": [{\"from\": \"existing_or_new_id\", \"to\": \"existing_or_new_id\", "
        "\"label\": \"relationship\"}]\n"
        "}\n"
        "Rules:\n"
        "- Suggest 1-5 nodes and their connecting edges\n"
        "- IDs must be lowercase snake_case\n"
        "- Only use existing node IDs for edges if the node is already in the graph\n"
        "- Return only the JSON object, no prose, no markdown fences"
    )

    user_msg = (
        f"Current graph nodes:\n{graph_summary}"
        f"{context_hint}\n\n"
        f"Description of what to add: {body.description}"
    )

    import httpx
    from utils.encryption import decrypt_key  # already imported above, but safe

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model":       model,
        "temperature": 0.4,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_msg},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=40.0) as client:
            resp = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json=payload,
            )
        resp.raise_for_status()
        raw_content = resp.json()["choices"][0]["message"]["content"]

        # Strip markdown fences if present
        raw_content = re.sub(r"```(?:json)?", "", raw_content).strip().rstrip("`").strip()
        suggestion = json.loads(raw_content)

        # Validate structure
        if not isinstance(suggestion.get("nodes"), list):
            suggestion["nodes"] = []
        if not isinstance(suggestion.get("edges"), list):
            suggestion["edges"] = []

        return {"status": "ok", "suggestion": suggestion}

    except (json.JSONDecodeError, KeyError, IndexError):
        return {"status": "error", "message": "AI returned unparseable suggestion"}
    except Exception as exc:
        return {"status": "error", "message": f"AI service error: {type(exc).__name__}"}
