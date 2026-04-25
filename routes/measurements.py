"""
routes/measurements.py
────────────────────────────────────────────────────────────────────────────
0-Meting Baseline & Maandelijkse Metingen

POST /api/measurements/create    — maak nieuwe meetronde aan
POST /api/measurements/save      — sla meetresultaten op
GET  /api/measurements/all       — alle meetrondes
GET  /api/measurements/{id}      — specifieke meetronde
DELETE /api/measurements/{id}    — verwijder meetronde
"""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/measurements", tags=["measurements"])

_DATA_DIR           = Path(__file__).parent.parent / "data"
_MEASUREMENTS_FILE  = _DATA_DIR / "measurements.json"


# ============================================================================
# Models
# ============================================================================

class MeasurementValue(BaseModel):
    node_id:   str
    kpi_name:  str
    value:     float
    unit:      Optional[str] = None
    notes:     Optional[str] = None
    measured_by: Optional[str] = "backoffice"


class CreateMeasurementBody(BaseModel):
    title:  str
    period: str          # bijv. "2024-Q1", "2024-01", "baseline"
    type:   str = "baseline"  # baseline | monthly | quarterly


class SaveMeasurementBody(BaseModel):
    measurement_id: str
    values: List[MeasurementValue]
    notes: Optional[str] = None
    status: str = "draft"  # draft | final


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


# ============================================================================
# Routes
# ============================================================================

@router.post("/create")
async def create_measurement(body: CreateMeasurementBody) -> Dict[str, Any]:
    """Maak een nieuwe meetronde aan."""
    data = _load_json(_MEASUREMENTS_FILE, {"measurements": []})
    measurements: List[Dict] = data.get("measurements", [])

    new_entry = {
        "id":         str(uuid.uuid4())[:8],
        "title":      body.title,
        "period":     body.period,
        "type":       body.type,
        "status":     "draft",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "values":     [],
        "notes":      None,
        "completeness": 0.0,
    }

    measurements.append(new_entry)
    data["measurements"] = measurements
    _save_json(_MEASUREMENTS_FILE, data)

    return {"ok": True, "measurement": new_entry}


@router.post("/save")
async def save_measurement(body: SaveMeasurementBody) -> Dict[str, Any]:
    """Sla meetresultaten op voor een bestaande meetronde."""
    data = _load_json(_MEASUREMENTS_FILE, {"measurements": []})
    measurements: List[Dict] = data.get("measurements", [])

    entry = next((m for m in measurements if m["id"] == body.measurement_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Meetronde '{body.measurement_id}' niet gevonden.")

    values_dicts = [v.model_dump() for v in body.values]
    entry["values"]     = values_dicts
    entry["status"]     = body.status
    entry["notes"]      = body.notes
    entry["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")

    # Bereken compleetheid (percentage ingevulde waarden)
    if values_dicts:
        filled = sum(1 for v in values_dicts if v.get("value") is not None)
        entry["completeness"] = round(filled / len(values_dicts) * 100, 1)

    data["measurements"] = measurements
    _save_json(_MEASUREMENTS_FILE, data)

    return {"ok": True, "measurement_id": body.measurement_id, "completeness": entry["completeness"]}


@router.get("/all")
async def get_all_measurements() -> Dict[str, Any]:
    """Alle meetrondes gesorteerd op datum."""
    data = _load_json(_MEASUREMENTS_FILE, {"measurements": []})
    measurements = sorted(data.get("measurements", []), key=lambda m: m.get("created_at", ""), reverse=True)
    return {"ok": True, "measurements": measurements, "total": len(measurements)}


@router.get("/{measurement_id}")
async def get_measurement(measurement_id: str) -> Dict[str, Any]:
    """Geef één meetronde."""
    data = _load_json(_MEASUREMENTS_FILE, {"measurements": []})
    entry = next((m for m in data.get("measurements", []) if m["id"] == measurement_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Meetronde '{measurement_id}' niet gevonden.")
    return {"ok": True, "measurement": entry}


@router.delete("/{measurement_id}")
async def delete_measurement(measurement_id: str) -> Dict[str, Any]:
    """Verwijder een meetronde."""
    data = _load_json(_MEASUREMENTS_FILE, {"measurements": []})
    before = len(data.get("measurements", []))
    data["measurements"] = [m for m in data.get("measurements", []) if m["id"] != measurement_id]
    if len(data["measurements"]) == before:
        raise HTTPException(status_code=404, detail=f"Meetronde '{measurement_id}' niet gevonden.")
    _save_json(_MEASUREMENTS_FILE, data)
    return {"ok": True, "deleted": measurement_id}
