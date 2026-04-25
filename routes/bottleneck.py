"""
routes/bottleneck.py
────────────────────────────────────────────────────────────────────────────
Bottleneck Detectie Dashboard

POST /api/bottleneck/detect   — detecteer bottlenecks in de graph
GET  /api/bottleneck/report   — gecachte bottleneck rapport
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter

router = APIRouter(prefix="/api/bottleneck", tags=["bottleneck"])

_DATA_DIR         = Path(__file__).parent.parent / "data"
_GRAPH_FILE       = _DATA_DIR / "graph.json"
_BOTTLENECK_FILE  = _DATA_DIR / "bottlenecks.json"
_MEASUREMENTS_FILE = _DATA_DIR / "measurements.json"
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


def _detect_structural_bottlenecks(
    nodes: List[Dict], edges: List[Dict], metrics: Dict
) -> List[Dict]:
    """
    Type 1 — Structurele bottlenecks:
    Nodes met hoge betweenness EN veel inkomende edges (convergentiepunten).
    """
    result = []
    for n in nodes:
        nid = n["id"]
        m = metrics.get(nid, {})
        in_d  = m.get("in_degree",   0)
        bt    = m.get("betweenness", 0)
        out_d = m.get("out_degree",  0)
        if in_d >= 2 and (bt > 0.05 or in_d >= 3):
            severity = min(100, int(
                (in_d / max(1, len(nodes)) * 500) +
                (bt * 200) +
                (10 if out_d >= 2 else 0)
            ))
            result.append({
                "node_id":    nid,
                "label":      n.get("label", nid),
                "type":       "structural",
                "reason":     f"{in_d} inkomende verbindingen, betweenness={bt:.3f}",
                "severity":   severity,
                "in_degree":  in_d,
                "out_degree": out_d,
                "betweenness": bt,
            })
    return result


def _detect_temporal_bottlenecks(
    nodes: List[Dict], measurements_data: Dict
) -> List[Dict]:
    """
    Type 2 — Temporele bottlenecks:
    Nodes waarbij gemeten doorlooptijd consequent boven target ligt.
    """
    result = []
    node_map = {n["id"]: n for n in nodes}
    for m in measurements_data.get("measurements", []):
        for v in m.get("values", []):
            nid      = v.get("node_id")
            kpi_name = v.get("kpi_name", "")
            value    = v.get("value")
            if not nid or value is None:
                continue
            # Zoek target in KPI naam (heuristiek: waarden boven 48 uur als doorlooptijd)
            if "doorlooptijd" in kpi_name.lower() and value > 48:
                node = node_map.get(nid, {})
                result.append({
                    "node_id":  nid,
                    "label":    node.get("label", nid),
                    "type":     "temporal",
                    "reason":   f"{kpi_name}: {value} gemeten (boven drempel 48)",
                    "severity": min(100, int(value / 48 * 40)),
                    "kpi_name": kpi_name,
                    "measured": value,
                })
    return result


def _detect_hidden_bottlenecks(
    nodes: List[Dict], edges: List[Dict]
) -> List[Dict]:
    """
    Type 3 — Verborgen bottlenecks:
    Bridge nodes: nodes waarbij verwijdering de graph in twee disconnected
    componenten splitst. Detectie via DFS edge bridges.
    """
    # Bouw ongerichte adjacency (voor bridge detectie)
    adj: Dict[str, List[str]] = {n["id"]: [] for n in nodes}
    for e in edges:
        src, tgt = e.get("from"), e.get("to")
        if src in adj and tgt in adj:
            adj[src].append(tgt)
            adj[tgt].append(src)

    node_map = {n["id"]: n for n in nodes}
    nids = list(adj.keys())
    disc: Dict[str, int]    = {}
    low:  Dict[str, int]    = {}
    timer = [0]
    bridges: List[str] = []

    def dfs(u: str, parent: Optional[str]):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        for v in adj[u]:
            if v not in disc:
                dfs(v, u)
                low[u] = min(low[u], low[v])
                if low[v] > disc[u]:
                    # Edge (u,v) is a bridge — u is critical
                    bridges.append(u)
            elif v != parent:
                low[u] = min(low[u], disc[v])

    import sys
    sys.setrecursionlimit(max(sys.getrecursionlimit(), len(nids) * 2 + 100))

    for nid in nids:
        if nid not in disc:
            try:
                dfs(nid, None)
            except RecursionError:
                break

    result = []
    seen: set = set()
    for nid in bridges:
        if nid in seen:
            continue
        seen.add(nid)
        node = node_map.get(nid, {})
        result.append({
            "node_id":  nid,
            "label":    node.get("label", nid),
            "type":     "hidden",
            "reason":   "Bridge node — verwijdering disconnecteert de graph",
            "severity": 60,
        })
    return result


def _detect_performance_bottlenecks(
    nodes: List[Dict], metrics: Dict
) -> List[Dict]:
    """
    Type 4 — Performance bottlenecks:
    Geïsoleerde of slecht verbonden nodes die de flow onderbreken.
    """
    result = []
    for n in nodes:
        nid = n["id"]
        m = metrics.get(nid, {})
        if m.get("is_isolated"):
            result.append({
                "node_id":  nid,
                "label":    n.get("label", nid),
                "type":     "performance",
                "reason":   "Geïsoleerde node — geen verbindingen in of uit",
                "severity": 40,
            })
        elif m.get("in_degree", 0) == 0 and n.get("role") not in ("start",):
            result.append({
                "node_id":  nid,
                "label":    n.get("label", nid),
                "type":     "performance",
                "reason":   "Geen inkomende verbindingen — mogelijk onbereikbaar",
                "severity": 35,
            })
    return result


# ============================================================================
# Routes
# ============================================================================

@router.post("/detect")
async def detect_bottlenecks() -> Dict[str, Any]:
    """Detecteer alle bottleneck types en sla rapport op."""
    g           = _load_json(_GRAPH_FILE, {"nodes": [], "edges": []})
    nodes       = g.get("nodes", [])
    edges       = g.get("edges", [])
    metrics     = _load_json(_INTELLIGENCE_FILE, {}).get("metrics", {})
    meas_data   = _load_json(_MEASUREMENTS_FILE, {"measurements": []})

    if not nodes:
        return {"ok": False, "error": "Graph is leeg."}

    structural  = _detect_structural_bottlenecks(nodes, edges, metrics)
    temporal    = _detect_temporal_bottlenecks(nodes, meas_data)
    hidden      = _detect_hidden_bottlenecks(nodes, edges)
    performance = _detect_performance_bottlenecks(nodes, metrics)

    all_bn = structural + temporal + hidden + performance
    # Dedupliceer: per node_id, hoogste severity behouden
    dedup: Dict[str, Dict] = {}
    for b in all_bn:
        nid = b["node_id"]
        if nid not in dedup or b["severity"] > dedup[nid]["severity"]:
            dedup[nid] = b

    bottlenecks = sorted(dedup.values(), key=lambda x: -x["severity"])

    report = {
        "bottlenecks":   bottlenecks,
        "counts": {
            "structural":  len(structural),
            "temporal":    len(temporal),
            "hidden":      len(hidden),
            "performance": len(performance),
            "total":       len(bottlenecks),
        },
        "critical": [b for b in bottlenecks if b["severity"] >= 60],
    }

    _save_json(_BOTTLENECK_FILE, report)
    return {"ok": True, **report}


@router.get("/report")
async def get_bottleneck_report() -> Dict[str, Any]:
    """Gecachte bottleneck rapport."""
    data = _load_json(_BOTTLENECK_FILE, None)
    if data is None:
        return {"ok": False, "error": "Nog geen rapport gegenereerd. Gebruik POST /detect eerst."}
    return {"ok": True, **data}
