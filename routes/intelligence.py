"""
routes/intelligence.py
────────────────────────────────────────────────────────────────────────────
Node Intelligence Engine

POST /api/intelligence/analyze   — analyse volledige graph, sla intelligence.json op
GET  /api/intelligence/node/{id} — metrics voor één node
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/intelligence", tags=["intelligence"])

_DATA_DIR          = Path(__file__).parent.parent / "data"
_GRAPH_FILE        = _DATA_DIR / "graph.json"
_INTELLIGENCE_FILE = _DATA_DIR / "intelligence.json"


# ============================================================================
# Helpers
# ============================================================================

def _load_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return fallback


def _save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)


def _analyze_graph(nodes: List[Dict], edges: List[Dict]) -> Dict[str, Any]:
    """
    Pure-Python graph analysis — geen externe afhankelijkheden nodig.
    Berekent per node: in_degree, out_degree, betweenness (approximation),
    structural role, health score.
    """
    # Voorwaartse edges (geen feedback)
    fwd = [e for e in edges if e.get("type") != "feedback"]

    # Adjacency opbouwen
    adj_out: Dict[str, List[str]] = {n["id"]: [] for n in nodes}
    adj_in:  Dict[str, List[str]] = {n["id"]: [] for n in nodes}
    for e in fwd:
        src, tgt = e.get("from"), e.get("to")
        if src in adj_out and tgt in adj_in:
            adj_out[src].append(tgt)
            adj_in[tgt].append(src)

    node_ids = list(adj_out.keys())

    # BFS/DFS reachability helper
    def _reachable(start: str, graph: Dict[str, List[str]]) -> set:
        visited, queue = set(), [start]
        while queue:
            cur = queue.pop()
            if cur in visited:
                continue
            visited.add(cur)
            queue.extend(graph.get(cur, []))
        return visited

    # Betweenness approximation: voor kleinere graphs brute-force
    # Voor grote graphs: sample 30 random source nodes
    import random
    sample_size = min(30, len(node_ids))
    sampled = random.sample(node_ids, sample_size) if len(node_ids) > 30 else node_ids

    between: Dict[str, float] = {nid: 0.0 for nid in node_ids}

    for src in sampled:
        # Topo-sort vanaf src via BFS
        visited: Dict[str, int] = {src: 1}
        preds:   Dict[str, List[str]] = {nid: [] for nid in node_ids}
        dist:    Dict[str, float]     = {nid: -1 for nid in node_ids}
        dist[src] = 0
        queue = [src]
        order = []
        while queue:
            v = queue.pop(0)
            order.append(v)
            for w in adj_out.get(v, []):
                if dist[w] < 0:
                    dist[w] = dist[v] + 1
                    queue.append(w)
                if dist[w] == dist[v] + 1:
                    visited[w] = visited.get(w, 0) + visited[v]
                    preds[w].append(v)

        dep: Dict[str, float] = {nid: 0.0 for nid in node_ids}
        for w in reversed(order):
            for v in preds[w]:
                if visited[w] > 0:
                    dep[v] += (visited[v] / visited[w]) * (1 + dep[w])

        for nid in node_ids:
            if nid != src:
                between[nid] += dep[nid]

    # Normalize
    n = len(node_ids)
    norm = (n - 1) * (n - 2) / 2 if n > 2 else 1
    scale = len(node_ids) / sample_size if sample_size > 0 else 1
    for nid in between:
        between[nid] = round((between[nid] * scale) / max(norm, 1), 4)

    # Role bepaling
    def _determine_role(nid: str) -> str:
        out_count = len(adj_out.get(nid, []))
        in_count  = len(adj_in.get(nid, []))
        bt        = between.get(nid, 0)
        if in_count == 0:
            return "start"
        if out_count == 0:
            return "end"
        if bt > 0.15 or (in_count >= 3 and out_count >= 2):
            return "bottleneck"
        if out_count >= 3:
            return "hub"
        if in_count >= 3:
            return "bridge"
        return "normal"

    # Health score: gebaseerd op connectivity
    max_bt = max(between.values()) if between else 1

    def _health(nid: str) -> int:
        in_c  = len(adj_in.get(nid, []))
        out_c = len(adj_out.get(nid, []))
        bt    = between.get(nid, 0)
        # Healthy = moderate connections, nicht isolated
        score = 100
        if in_c == 0 and out_c == 0:
            score = 30   # isolated
        elif in_c == 0 or out_c == 0:
            score = 75   # terminal
        elif bt > 0.3:
            score = 55   # over-belast bottleneck
        elif bt > 0.15:
            score = 70   # mogelijk knelpunt
        return score

    result = {}
    for n_obj in nodes:
        nid = n_obj["id"]
        result[nid] = {
            "id":             nid,
            "in_degree":      len(adj_in.get(nid, [])),
            "out_degree":     len(adj_out.get(nid, [])),
            "betweenness":    between.get(nid, 0),
            "role":           _determine_role(nid),
            "health":         _health(nid),
            "is_bridge":      len(adj_in.get(nid, [])) >= 2 and len(adj_out.get(nid, [])) >= 2,
            "is_isolated":    len(adj_in.get(nid, [])) == 0 and len(adj_out.get(nid, [])) == 0,
        }

    return result


# ============================================================================
# Routes
# ============================================================================

@router.post("/analyze")
async def analyze() -> Dict[str, Any]:
    """Analyseer de volledige graph en sla intelligentie op in intelligence.json."""
    g = _load_json(_GRAPH_FILE, {"nodes": [], "edges": []})
    nodes = g.get("nodes", [])
    edges = g.get("edges", [])

    if not nodes:
        raise HTTPException(status_code=404, detail="Graph is leeg. Laad een graph of demo eerst.")

    metrics = _analyze_graph(nodes, edges)

    # Sla op
    _save_json(_INTELLIGENCE_FILE, {"metrics": metrics, "node_count": len(nodes), "edge_count": len(edges)})

    return {
        "ok": True,
        "analyzed": len(metrics),
        "metrics": metrics,
    }


@router.get("/node/{node_id}")
async def get_node_intelligence(node_id: str) -> Dict[str, Any]:
    """Geef intelligentie-metrics voor één node."""
    data = _load_json(_INTELLIGENCE_FILE, {})
    metrics = data.get("metrics", {})
    if node_id not in metrics:
        # Probeer live te berekenen
        g = _load_json(_GRAPH_FILE, {"nodes": [], "edges": []})
        if not g.get("nodes"):
            raise HTTPException(status_code=404, detail="Node niet gevonden en geen graph beschikbaar.")
        all_metrics = _analyze_graph(g["nodes"], g["edges"])
        if node_id not in all_metrics:
            raise HTTPException(status_code=404, detail=f"Node '{node_id}' niet gevonden.")
        return all_metrics[node_id]
    return metrics[node_id]


@router.get("/all")
async def get_all_intelligence() -> Dict[str, Any]:
    """Geef alle gecachte intelligentie metrics."""
    data = _load_json(_INTELLIGENCE_FILE, {"metrics": {}, "node_count": 0, "edge_count": 0})
    return data
