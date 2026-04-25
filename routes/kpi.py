"""
routes/kpi.py
────────────────────────────────────────────────────────────────────────────
KPI Generatie & Goedkeuring

POST /api/kpi/generate         — genereer KPIs voor één node (JSON)
GET  /api/kpi/generate-all     — SSE stream: genereer KPIs voor alle nodes
POST /api/kpi/save             — sla goedgekeurde KPIs op
GET  /api/kpi/all              — alle opgeslagen KPIs
GET  /api/kpi/node/{node_id}   — KPIs voor één node
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

router = APIRouter(prefix="/api/kpi", tags=["kpi"])

_DATA_DIR      = Path(__file__).parent.parent / "data"
_GRAPH_FILE    = _DATA_DIR / "graph.json"
_SETTINGS_FILE = _DATA_DIR / "settings.json"
_KPI_FILE      = _DATA_DIR / "kpis.json"
_OPENROUTER    = "https://openrouter.ai/api/v1/chat/completions"


# ============================================================================
# Models
# ============================================================================

class GenerateKPIBody(BaseModel):
    node_id: str

class SaveKPIBody(BaseModel):
    node_id: str
    kpis: List[Dict[str, Any]]


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


def _resolve_key_model() -> Tuple[Optional[str], str]:
    settings = _load_json(_SETTINGS_FILE, {})
    model    = settings.get("chat_model", "meta-llama/llama-3.3-70b-instruct")
    cipher   = settings.get("openrouter_api_key_encrypted", "")
    if not cipher:
        return None, model
    try:
        return decrypt_key(cipher), model
    except Exception:
        return None, model


def _kpi_system_prompt() -> str:
    return """Je bent een bedrijfsproces-KPI expert. Analyseer het opgegeven proceselement en genereer 2-3 meetbare KPIs.

Geef altijd JSON terug in dit exacte formaat (geen extra tekst, geen markdown, alleen geldige JSON):
{
  "kpis": [
    {
      "name": "Naam van de KPI",
      "description": "Wat wordt gemeten en waarom",
      "unit": "bijv. uren, %, stuks, euro's",
      "target": "streefwaarde (realistisch)",
      "frequency": "dagelijks|wekelijks|maandelijks",
      "category": "doorlooptijd|kwaliteit|efficiency|klanttevredenheid|financieel"
    }
  ]
}

Regels:
- Maak KPIs specifiek voor dit proceselement
- Gebruik realistische streefwaarden voor een backoffice verkoopproces
- Kies minimaal 1 doorlooptijd-KPI voor procesnodes
- Maximum 3 KPIs per node
- Antwoord ALTIJD in het Nederlands
- ALLEEN geldige JSON — geen uitleg"""


def _fallback_kpis(node: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Genereer basis KPIs zonder AI als fallback."""
    cat = node.get("category", "process")
    label = node.get("label", "Stap")
    kpis = []
    if cat in ("process", "compliance"):
        kpis.append({
            "name": f"Doorlooptijd {label}",
            "description": f"Gemiddelde tijd om {label} te voltooien",
            "unit": "uren",
            "target": "24",
            "frequency": "dagelijks",
            "category": "doorlooptijd",
            "approved": True,
            "auto_generated": True,
        })
    if cat == "customer":
        kpis.append({
            "name": f"Klantrespons {label}",
            "description": f"Percentage klanten dat tijdig reageert bij {label}",
            "unit": "%",
            "target": "85",
            "frequency": "wekelijks",
            "category": "klanttevredenheid",
            "approved": True,
            "auto_generated": True,
        })
    if cat == "finance":
        kpis.append({
            "name": f"Doorlooptijd {label}",
            "description": f"Verwerkingstijd financieel element {label}",
            "unit": "werkdagen",
            "target": "5",
            "frequency": "dagelijks",
            "category": "doorlooptijd",
            "approved": True,
            "auto_generated": True,
        })
    if not kpis:
        kpis.append({
            "name": f"Voltooiingspercentage {label}",
            "description": f"Percentage succesvolle doorloop van {label}",
            "unit": "%",
            "target": "90",
            "frequency": "wekelijks",
            "category": "efficiency",
            "approved": True,
            "auto_generated": True,
        })
    return kpis


async def _generate_kpis_for_node(
    node: Dict[str, Any],
    api_key: str,
    model: str,
) -> List[Dict[str, Any]]:
    """Roep OpenRouter aan voor KPI generatie. Geeft fallback bij fout."""
    prompt = f"""Proceselement: {node.get('label', 'Onbekend')}
Categorie: {node.get('category', 'process')}
Beschrijving: {node.get('description', 'Geen beschrijving beschikbaar')}
Bronbestand: {node.get('source_file', '')}

Genereer 2-3 relevante KPIs voor dit proceselement."""

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json",
        "HTTP-Referer":  "https://neuralgraph.local",
        "X-Title":       "NeuralGraph KPI Engine",
    }
    payload = {
        "model":      model,
        "stream":     False,
        "max_tokens": 600,
        "messages": [
            {"role": "system", "content": _kpi_system_prompt()},
            {"role": "user",   "content": prompt},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(_OPENROUTER, headers=headers, json=payload)
            resp.raise_for_status()
            obj = resp.json()
            raw = obj["choices"][0]["message"]["content"].strip()
            # Strip markdown code blocks if any
            raw = re.sub(r"^```json\s*", "", raw)
            raw = re.sub(r"```\s*$", "", raw)
            parsed = json.loads(raw)
            kpis = parsed.get("kpis", [])
            for kpi in kpis:
                kpi["approved"] = False
                kpi["auto_generated"] = True
            return kpis
    except Exception:
        return _fallback_kpis(node)


# ============================================================================
# Routes
# ============================================================================

@router.post("/generate")
async def generate_kpi(body: GenerateKPIBody) -> Dict[str, Any]:
    """Genereer KPIs voor één node."""
    g = _load_json(_GRAPH_FILE, {"nodes": [], "edges": []})
    nodes = {n["id"]: n for n in g.get("nodes", [])}
    node = nodes.get(body.node_id)
    if not node:
        return {"ok": False, "error": f"Node '{body.node_id}' niet gevonden."}

    api_key, model = _resolve_key_model()
    if not api_key:
        kpis = _fallback_kpis(node)
    else:
        kpis = await _generate_kpis_for_node(node, api_key, model)

    return {"ok": True, "node_id": body.node_id, "kpis": kpis}


@router.get("/generate-all")
async def generate_all_kpis() -> EventSourceResponse:
    """SSE stream — genereer KPIs voor alle nodes en sla op."""

    async def event_gen():
        g = _load_json(_GRAPH_FILE, {"nodes": [], "edges": []})
        nodes = g.get("nodes", [])
        if not nodes:
            yield {"data": json.dumps({"type": "error", "message": "Graph is leeg."})}
            return

        api_key, model = _resolve_key_model()

        existing = _load_json(_KPI_FILE, {})
        total = len(nodes)

        for i, node in enumerate(nodes):
            nid = node["id"]
            yield {"data": json.dumps({
                "type":     "progress",
                "current":  i + 1,
                "total":    total,
                "node_id":  nid,
                "label":    node.get("label", nid),
            })}

            if api_key:
                kpis = await _generate_kpis_for_node(node, api_key, model)
            else:
                kpis = _fallback_kpis(node)

            existing[nid] = {"node_id": nid, "label": node.get("label"), "kpis": kpis}

            yield {"data": json.dumps({
                "type":    "node_done",
                "node_id": nid,
                "kpis":    kpis,
            })}

        _save_json(_KPI_FILE, existing)
        yield {"data": json.dumps({"type": "done", "total": total})}

    return EventSourceResponse(event_gen())


@router.post("/save")
async def save_kpis(body: SaveKPIBody) -> Dict[str, Any]:
    """Sla goedgekeurde KPIs op voor een node."""
    existing = _load_json(_KPI_FILE, {})
    existing[body.node_id] = {
        "node_id": body.node_id,
        "kpis":    body.kpis,
    }
    _save_json(_KPI_FILE, existing)
    return {"ok": True, "saved": len(body.kpis)}


@router.get("/all")
async def get_all_kpis() -> Dict[str, Any]:
    """Geef alle opgeslagen KPIs."""
    data = _load_json(_KPI_FILE, {})
    return {"ok": True, "kpis": data, "total_nodes": len(data)}


@router.get("/node/{node_id}")
async def get_node_kpis(node_id: str) -> Dict[str, Any]:
    """Geef KPIs voor één node."""
    data = _load_json(_KPI_FILE, {})
    entry = data.get(node_id)
    if not entry:
        return {"ok": False, "node_id": node_id, "kpis": []}
    return {"ok": True, "node_id": node_id, "kpis": entry.get("kpis", [])}
