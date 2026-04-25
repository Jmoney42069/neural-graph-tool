"""
routes/trends.py
────────────────────────────────────────────────────────────────────────────
Maandelijkse Meting & Trend Analyse

GET  /api/trends/node/{node_id}  — trends voor één node
POST /api/trends/analyze         — analyseer trends over alle meetrondes
GET  /api/trends/summary         — globale trend samenvatting
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/trends", tags=["trends"])

_DATA_DIR          = Path(__file__).parent.parent / "data"
_MEASUREMENTS_FILE = _DATA_DIR / "measurements.json"
_KPI_FILE          = _DATA_DIR / "kpis.json"
_TRENDS_FILE       = _DATA_DIR / "trends.json"


# ============================================================================
# Models
# ============================================================================

class AnalyzeTrendsBody(BaseModel):
    node_ids: Optional[List[str]] = None  # None = alle nodes


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


def _trend_direction(values: List[float]) -> str:
    """Berekent trend richting op basis van regressielijn."""
    if len(values) < 2:
        return "stable"
    n = len(values)
    x_mean = (n - 1) / 2
    y_mean = sum(values) / n
    numerator = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
    denominator = sum((i - x_mean) ** 2 for i in range(n))
    if denominator == 0:
        return "stable"
    slope = numerator / denominator
    # Relatief aan gemiddelde
    rel = slope / abs(y_mean) if y_mean != 0 else slope
    if rel > 0.05:
        return "improving"
    elif rel < -0.05:
        return "declining"
    return "stable"


def _momentum_score(values: List[float]) -> float:
    """Momentum: gewogen gemiddelde van recente vs vroegere waarden (0-100)."""
    if len(values) < 2:
        return 50.0
    half = len(values) // 2
    early = sum(values[:half]) / half
    recent = sum(values[half:]) / len(values[half:])
    if early == 0:
        return 50.0
    ratio = recent / early
    momentum = min(100, max(0, 50 * ratio))
    return round(momentum, 1)


def _analyze_node_trends(node_id: str, measurements: List[Dict], kpi_data: Dict) -> Dict[str, Any]:
    """Bereken trends voor één node op basis van meethistorie."""
    node_kpis = kpi_data.get(node_id, {}).get("kpis", [])
    kpi_names = [k["name"] for k in node_kpis]

    kpi_trends: Dict[str, Any] = {}

    for kpi_name in kpi_names:
        series: List[Dict] = []
        for m in sorted(measurements, key=lambda x: x.get("created_at", "")):
            val_entry = next(
                (v for v in m.get("values", [])
                 if v.get("node_id") == node_id and v.get("kpi_name") == kpi_name),
                None
            )
            if val_entry and val_entry.get("value") is not None:
                series.append({
                    "period":  m.get("period", ""),
                    "date":    m.get("created_at", "")[:10],
                    "value":   val_entry["value"],
                    "unit":    val_entry.get("unit", ""),
                })

        if series:
            vals = [s["value"] for s in series]
            kpi_trends[kpi_name] = {
                "series":    series,
                "trend":     _trend_direction(vals),
                "momentum":  _momentum_score(vals),
                "avg":       round(sum(vals) / len(vals), 2),
                "last":      vals[-1] if vals else None,
                "delta_pct": round((vals[-1] - vals[0]) / vals[0] * 100, 1) if len(vals) >= 2 and vals[0] != 0 else 0,
            }

    return {
        "node_id":   node_id,
        "kpi_count": len(kpi_names),
        "measured":  len(kpi_trends),
        "kpis":      kpi_trends,
    }


# ============================================================================
# Routes
# ============================================================================

@router.get("/node/{node_id}")
async def get_node_trends(node_id: str) -> Dict[str, Any]:
    """Trends voor één node."""
    measurements = _load_json(_MEASUREMENTS_FILE, {"measurements": []}).get("measurements", [])
    kpi_data     = _load_json(_KPI_FILE, {})

    result = _analyze_node_trends(node_id, measurements, kpi_data)
    return {"ok": True, "trends": result}


@router.post("/analyze")
async def analyze_trends(body: AnalyzeTrendsBody) -> Dict[str, Any]:
    """Analyseer en sla trends op voor alle (of opgegeven) nodes."""
    measurements = _load_json(_MEASUREMENTS_FILE, {"measurements": []}).get("measurements", [])
    kpi_data     = _load_json(_KPI_FILE, {})

    target_ids = body.node_ids or list(kpi_data.keys())
    results: Dict[str, Any] = {}

    for nid in target_ids:
        results[nid] = _analyze_node_trends(nid, measurements, kpi_data)

    trends_output = {"nodes": results, "analyzed": len(results)}
    _save_json(_TRENDS_FILE, trends_output)

    return {"ok": True, "analyzed": len(results), "trends": results}


@router.get("/summary")
async def get_trends_summary() -> Dict[str, Any]:
    """Globale trend samenvatting."""
    data = _load_json(_TRENDS_FILE, {"nodes": {}, "analyzed": 0})
    nodes = data.get("nodes", {})

    improving = sum(
        1 for n in nodes.values()
        for kpi in n.get("kpis", {}).values()
        if kpi.get("trend") == "improving"
    )
    declining = sum(
        1 for n in nodes.values()
        for kpi in n.get("kpis", {}).values()
        if kpi.get("trend") == "declining"
    )
    stable = sum(
        1 for n in nodes.values()
        for kpi in n.get("kpis", {}).values()
        if kpi.get("trend") == "stable"
    )

    return {
        "ok":          True,
        "total_nodes": len(nodes),
        "improving":   improving,
        "declining":   declining,
        "stable":      stable,
        "nodes":       nodes,
    }
