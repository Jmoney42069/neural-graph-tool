"""
routes/recommendations.py
────────────────────────────────────────────────────────────────────────────
AI Aanbevelingen + PDF Export

POST /api/recommendations/generate     — SSE stream: AI consultant aanbevelingen
POST /api/recommendations/export-pdf   — genereer PDF rapport
GET  /api/recommendations/latest       — meest recente aanbevelingen
"""

from __future__ import annotations

import json
import io
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from utils.encryption import decrypt_key

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])

_DATA_DIR              = Path(__file__).parent.parent / "data"
_GRAPH_FILE            = _DATA_DIR / "graph.json"
_SETTINGS_FILE         = _DATA_DIR / "settings.json"
_BOTTLENECK_FILE       = _DATA_DIR / "bottlenecks.json"
_MEASUREMENTS_FILE     = _DATA_DIR / "measurements.json"
_RECOMMENDATIONS_FILE  = _DATA_DIR / "recommendations.json"
_OPENROUTER            = "https://openrouter.ai/api/v1/chat/completions"


# ============================================================================
# Models
# ============================================================================

class GenerateBody(BaseModel):
    focus: Optional[str] = None   # bijv. "doorlooptijd", "kwaliteit", "bottlenecks"

class ExportPDFBody(BaseModel):
    title:        str = "NeuralGraph Procesrapport"
    include_kpis: bool = True
    include_bottlenecks: bool = True
    include_recommendations: bool = True


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


def _build_recommendation_prompt(
    graph: Dict, bottlenecks: Dict, measurements: Dict, focus: Optional[str]
) -> str:
    nodes = graph.get("nodes", [])
    bn_list = bottlenecks.get("bottlenecks", [])[:10]  # Top 10
    meas_count = len(measurements.get("measurements", []))

    focus_line = f"\nFOCUS GEBIED: {focus}" if focus else ""

    return f"""Je bent een senior bedrijfsprocesconsultant gespecialiseerd in backoffice-optimalisatie.{focus_line}

PROCESOVERZICHT:
- {len(nodes)} processtappen in kaart gebracht
- {meas_count} meetrondes beschikbaar

TOP BOTTLENECKS (tot 10):
{json.dumps(bn_list, ensure_ascii=False, indent=2)}

GRAPH METADATA:
{json.dumps({"nodes": [{"id": n["id"], "label": n.get("label"), "category": n.get("category"), "role": n.get("role")} for n in nodes[:30]], "edge_count": len(graph.get("edges", []))}, ensure_ascii=False, indent=2)}

Jouw taak:
Geef 5 concrete, implementeerbare aanbevelingen om de procesefficiency te verbeteren.
Richt je op de gedetecteerde bottlenecks.

Format je antwoord exact als JSON:
{{
  "executive_summary": "1-2 zinnen overall assessment",
  "recommendations": [
    {{
      "priority": 1,
      "title": "Naam aanbeveling",
      "description": "Gedetailleerde uitleg",
      "affected_nodes": ["node_id1", "node_id2"],
      "expected_impact": "Verwacht effect (doorlooptijd, kosten, kwaliteit)",
      "effort": "laag|middel|hoog",
      "timeframe": "bijv. 2 weken",
      "category": "process|technology|people|governance"
    }}
  ],
  "risk_areas": ["risico 1", "risico 2"],
  "quick_wins": ["quick win 1", "quick win 2"]
}}

Antwoord UITSLUITEND in het Nederlands. ALLEEN geldige JSON — geen uitleg, geen markdown."""


def _fallback_recommendations() -> Dict[str, Any]:
    return {
        "executive_summary": "Automatisch gegenereerde basisaanbevelingen — voeg een AI sleutel toe voor consultant-grade analyse.",
        "recommendations": [
            {
                "priority": 1,
                "title": "Bottleneck nodes monitoren",
                "description": "Stel concrete doorlooptijd-KPIs in voor nodes met hoge betweenness centrality.",
                "affected_nodes": [],
                "expected_impact": "20-30% doorlooptijdverkorting",
                "effort": "laag",
                "timeframe": "1 week",
                "category": "process",
            },
            {
                "priority": 2,
                "title": "Communicatiesilo's verminderen",
                "description": "Nodes met meerdere inkomende verbindingen zijn kwetsbaar; voeg directe routes toe.",
                "affected_nodes": [],
                "expected_impact": "Betere parallellisatie",
                "effort": "middel",
                "timeframe": "2 weken",
                "category": "process",
            },
        ],
        "risk_areas": ["Externe afhankelijkheden (SVN, WF, L&S)", "Handmatige stappen zonder SLA"],
        "quick_wins": ["KPI's instellen voor top-5 bottleneck nodes", "Dagelijkse standup voor kritieke route"],
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "ai_generated": False,
    }


async def _stream_openrouter(api_key: str, model: str, messages: List[Dict]) -> Any:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json",
        "HTTP-Referer":  "https://neuralgraph.local",
        "X-Title":       "NeuralGraph Recommendations",
    }
    payload = {
        "model":      model,
        "stream":     True,
        "max_tokens": 2000,
        "messages":   messages,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream("POST", _OPENROUTER, headers=headers, json=payload) as resp:
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
# Routes
# ============================================================================

@router.post("/generate")
async def generate_recommendations(body: GenerateBody) -> EventSourceResponse:
    """SSE stream — genereer AI aanbevelingen."""

    async def event_gen():
        graph       = _load_json(_GRAPH_FILE,        {"nodes": [], "edges": []})
        bottlenecks = _load_json(_BOTTLENECK_FILE,   {"bottlenecks": []})
        measurements = _load_json(_MEASUREMENTS_FILE, {"measurements": []})

        api_key, model = _resolve_key_model()

        if not api_key:
            rec = _fallback_recommendations()
            yield {"data": json.dumps({"type": "done", "recommendations": rec})}
            return

        yield {"data": json.dumps({"type": "thinking", "message": "Analyseren processtructuur..."})}

        prompt = _build_recommendation_prompt(graph, bottlenecks, measurements, body.focus)
        messages = [
            {"role": "system", "content": "Je bent een senior bedrijfsprocesconsultant. Antwoord ALTIJD als geldige JSON."},
            {"role": "user",   "content": prompt},
        ]

        full_text = ""
        try:
            async for tok in _stream_openrouter(api_key, model, messages):
                full_text += tok
                yield {"data": json.dumps({"type": "chunk", "content": tok})}
        except Exception as e:
            rec = _fallback_recommendations()
            yield {"data": json.dumps({"type": "done", "recommendations": rec, "error": str(e)})}
            return

        # Parse JSON uit full_text
        import re
        cleaned = re.sub(r"^```json\s*", "", full_text.strip())
        cleaned = re.sub(r"```\s*$", "", cleaned)
        try:
            rec = json.loads(cleaned)
            rec["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            rec["ai_generated"]  = True
        except Exception:
            rec = _fallback_recommendations()

        _save_json(_RECOMMENDATIONS_FILE, rec)
        yield {"data": json.dumps({"type": "done", "recommendations": rec})}

    return EventSourceResponse(event_gen())


@router.get("/latest")
async def get_latest_recommendations() -> Dict[str, Any]:
    """Meest recente aanbevelingen."""
    data = _load_json(_RECOMMENDATIONS_FILE, None)
    if data is None:
        return {"ok": False, "error": "Nog geen aanbevelingen gegenereerd."}
    return {"ok": True, "recommendations": data}


@router.post("/export-pdf")
async def export_pdf(body: ExportPDFBody) -> StreamingResponse:
    """Genereer PDF rapport met reportlab."""
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.lib import colors
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
        )
        _RL_AVAILABLE = True
    except ImportError:
        _RL_AVAILABLE = False

    graph    = _load_json(_GRAPH_FILE,           {"nodes": [], "edges": []})
    bottlenecks = _load_json(_BOTTLENECK_FILE,   {"bottlenecks": [], "counts": {}})
    recs     = _load_json(_RECOMMENDATIONS_FILE, {"recommendations": [], "executive_summary": ""})

    buf = io.BytesIO()

    if not _RL_AVAILABLE:
        # Fallback: eenvoudige tekst-PDF
        lines = [
            f"{body.title}",
            f"Gegenereerd: {time.strftime('%Y-%m-%d %H:%M')}",
            "",
            f"Graph: {len(graph.get('nodes', []))} nodes, {len(graph.get('edges', []))} edges",
            "",
            "BOTTLENECKS:",
        ]
        for b in bottlenecks.get("bottlenecks", [])[:10]:
            lines.append(f"  - {b.get('label', b.get('node_id'))}: {b.get('reason', '')} (severity={b.get('severity', 0)})")
        lines += ["", "AANBEVELINGEN:"]
        for r in recs.get("recommendations", []):
            lines.append(f"  {r.get('priority','')}. {r.get('title','')}: {r.get('description','')}")

        content = "\n".join(lines).encode("utf-8")
        buf.write(content)
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="text/plain",
            headers={"Content-Disposition": f'attachment; filename="neuralgraph_report.txt"'},
        )

    # ReportLab beschikbaar
    doc    = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20*mm, rightMargin=20*mm, topMargin=20*mm, bottomMargin=20*mm)
    styles = getSampleStyleSheet()
    story  = []

    title_style = ParagraphStyle("Title", parent=styles["Title"], fontSize=20, spaceAfter=6*mm)
    h1_style    = ParagraphStyle("H1",    parent=styles["Heading1"], fontSize=14, spaceAfter=3*mm, spaceBefore=5*mm)
    body_style  = ParagraphStyle("Body",  parent=styles["BodyText"], fontSize=10, spaceAfter=2*mm)

    # Cover
    story.append(Paragraph(body.title, title_style))
    story.append(Paragraph(f"Gegenereerd op {time.strftime('%d-%m-%Y %H:%M')}", styles["Normal"]))
    story.append(Spacer(1, 8*mm))

    # Executive summary
    if recs.get("executive_summary"):
        story.append(Paragraph("Executive Summary", h1_style))
        story.append(Paragraph(recs["executive_summary"], body_style))
        story.append(Spacer(1, 4*mm))

    # Graph stats
    story.append(Paragraph("Graph Overzicht", h1_style))
    stats_data = [
        ["Metric", "Waarde"],
        ["Nodes", str(len(graph.get("nodes", [])))],
        ["Edges", str(len(graph.get("edges", [])))],
        ["Bottlenecks (totaal)", str(bottlenecks.get("counts", {}).get("total", 0))],
        ["Kritieke bottlenecks", str(len(bottlenecks.get("critical", [])))],
    ]
    t = Table(stats_data, colWidths=[80*mm, 60*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND",  (0, 0), (-1, 0), colors.HexColor("#1a1a2e")),
        ("TEXTCOLOR",   (0, 0), (-1, 0), colors.white),
        ("FONTSIZE",    (0, 0), (-1, -1), 9),
        ("GRID",        (0, 0), (-1, -1), 0.5, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f5f5")]),
    ]))
    story.append(t)
    story.append(Spacer(1, 4*mm))

    # Bottlenecks
    if body.include_bottlenecks and bottlenecks.get("bottlenecks"):
        story.append(Paragraph("Gedetecteerde Bottlenecks", h1_style))
        bn_data = [["Node", "Type", "Reden", "Severity"]]
        for b in bottlenecks["bottlenecks"][:15]:
            bn_data.append([
                b.get("label", b.get("node_id", ""))[:30],
                b.get("type", ""),
                (b.get("reason", ""))[:50],
                str(b.get("severity", 0)),
            ])
        t2 = Table(bn_data, colWidths=[50*mm, 25*mm, 70*mm, 20*mm])
        t2.setStyle(TableStyle([
            ("BACKGROUND",  (0, 0), (-1, 0), colors.HexColor("#e74c3c")),
            ("TEXTCOLOR",   (0, 0), (-1, 0), colors.white),
            ("FONTSIZE",    (0, 0), (-1, -1), 8),
            ("GRID",        (0, 0), (-1, -1), 0.5, colors.grey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fff5f5")]),
        ]))
        story.append(t2)
        story.append(Spacer(1, 4*mm))

    # Aanbevelingen
    if body.include_recommendations and recs.get("recommendations"):
        story.append(PageBreak())
        story.append(Paragraph("Aanbevelingen", h1_style))
        for r in recs["recommendations"]:
            p = r.get("priority", "")
            story.append(Paragraph(f"{p}. {r.get('title', '')}", ParagraphStyle("RH", parent=styles["Heading3"], fontSize=11, spaceBefore=3*mm)))
            story.append(Paragraph(r.get("description", ""), body_style))
            meta = f"Effort: {r.get('effort','')} | Tijdlijn: {r.get('timeframe','')} | Impact: {r.get('expected_impact','')}"
            story.append(Paragraph(meta, ParagraphStyle("Meta", parent=styles["Italic"], fontSize=8, textColor=colors.grey)))
            story.append(Spacer(1, 2*mm))

    doc.build(story)
    buf.seek(0)
    filename = f"neuralgraph_rapport_{time.strftime('%Y%m%d')}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
