"""
routes/memory.py
────────────────────────────────────────────────────────────────────────────
Memory world — reads a user-supplied neural-memory JSON file, converts it
to the NeuralGraph graph format (nodes + edges + meta) and streams back
the result.

Nodes are pre-positioned so that each segment forms its own visible cluster
in 3D space.  Positions are deterministic (seeded RNG).
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path
from typing import Any, Dict, List, Tuple

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/memory", tags=["memory"])

# Path to the user's neural-memory JSON.
# Place your memory file at  data/memory.json  or update this path.
MEMORY_FILE = Path(__file__).parent.parent / "data" / "memory.json"

# Segment colours — mirrors worldManager.js SEGMENTS palette
_SEGMENT_COLORS: Dict[str, str] = {
    "identity":           "#00BFFF",
    "psychology":         "#FF6B6B",
    "motivations":        "#FFD700",
    "personality":        "#E67E22",
    "philosophy":         "#E74C3C",
    "health_mind":        "#8E44AD",
    "social":             "#1ABC9C",
    "career":             "#7CFC00",
    "voltera_compliance": "#FF4500",
    "voltera_rag":        "#FF6347",
    "voltera_scripts":    "#FFA07A",
    "project_jarvis":     "#DA70D6",
    "project_tools":      "#BA55D3",
    "project_neural":     "#9370DB",
    "tech_stack":         "#9B59B6",
    "ai_models":          "#6A5ACD",
    "prompt_engineering": "#4169E1",
    "goals":              "#00CED1",
    "financial":          "#2ECC71",
    "trading":            "#20B2AA",
    "learning":           "#F39C12",
    "history":            "#95A5A6",
    "winners_center":     "#CD853F",
}

# 23 segments — v2 (display order)
_SEGMENTS: List[str] = [
    "identity",
    "psychology",
    "motivations",
    "personality",
    "philosophy",
    "health_mind",
    "social",
    "career",
    "voltera_compliance",
    "voltera_rag",
    "voltera_scripts",
    "project_jarvis",
    "project_tools",
    "project_neural",
    "tech_stack",
    "ai_models",
    "prompt_engineering",
    "goals",
    "financial",
    "trading",
    "learning",
    "history",
    "winners_center",
]


# ── Spatial helpers ────────────────────────────────────────────────────────────


def _fibonacci_sphere(segments: List[str], radius: float = 120.0) -> Dict[str, Dict[str, float]]:
    """Spread segment cluster centres evenly on a sphere via Fibonacci lattice."""
    n = len(segments)
    golden = (1.0 + math.sqrt(5.0)) / 2.0
    out: Dict[str, Dict[str, float]] = {}
    for i, seg in enumerate(segments):
        theta = 2.0 * math.pi * i / golden
        phi = math.acos(max(-1.0, min(1.0, 1.0 - 2.0 * (i + 0.5) / n)))
        out[seg] = {
            "x": radius * math.sin(phi) * math.cos(theta),
            "y": radius * math.cos(phi),
            "z": radius * math.sin(phi) * math.sin(theta),
        }
    return out


def _random_in_sphere(rng: random.Random, r: float) -> Tuple[float, float, float]:
    """Uniform random point inside a sphere of radius r."""
    theta = rng.uniform(0.0, 2.0 * math.pi)
    phi = math.acos(rng.uniform(-1.0, 1.0))
    d = r * (rng.random() ** (1.0 / 3.0))  # cube-root sampling for uniform density
    return (
        d * math.sin(phi) * math.cos(theta),
        d * math.cos(phi),
        d * math.sin(phi) * math.sin(theta),
    )


# ── Transformation ─────────────────────────────────────────────────────────────


def _transform(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a neural-memory JSON file → NeuralGraph graph format."""
    clusters = _fibonacci_sphere(_SEGMENTS)
    rng = random.Random(42)  # deterministic — same positions every load

    # ── nodes ──────────────────────────────────────────────────────────────────
    nodes: List[Dict[str, Any]] = []
    for node in raw.get("nodes", []):
        seg = node.get("segment", "identity")
        center = clusters.get(seg, {"x": 0.0, "y": 0.0, "z": 0.0})
        jx, jy, jz = _random_in_sphere(rng, 28.0)
        weight = float(node.get("weight", 5))
        # weight 5–10  →  size 0.8–2.2
        size = round(0.8 + max(0.0, weight - 5.0) / 5.0 * 1.4, 2)

        nodes.append(
            {
                "id": f"mem-{node['id']}",
                "label": node.get("label", str(node["id"])),
                "category": seg,       # used by nodes.js for fallback colour
                "segment": seg,        # preserved for filter panel
                "color": node.get("color") or _SEGMENT_COLORS.get(seg, "#7fcfff"),
                "size": size,
                "weight": weight,
                "role": "normal",
                "health": 100,
                "kpis": [],
                "measurements": [],
                "onCriticalPath": weight >= 9.0,
                "x": round(center["x"] + jx, 2),
                "y": round(center["y"] + jy, 2),
                "z": round(center["z"] + jz, 2),
            }
        )

    # ── edges ──────────────────────────────────────────────────────────────────
    edges: List[Dict[str, Any]] = []

    # Explicit semantic edges from the JSON
    explicit_pairs: set = set()
    for edge in raw.get("edges", []):
        src = f"mem-{edge['source']}"
        tgt = f"mem-{edge['target']}"
        edges.append(
            {
                "from": src,
                "to": tgt,
                "label": "",
                "type": "semantic",
                "weight": float(edge.get("strength", 0.5)),
            }
        )
        explicit_pairs.add((src, tgt))
        explicit_pairs.add((tgt, src))

    # Auto-generate intra-segment ring edges so every node is connected
    # (sorted by weight descending so heavier nodes sit earlier in the chain)
    seg_nodes: Dict[str, List[Dict[str, Any]]] = {}
    for n in nodes:
        seg = n.get("segment", "identity")
        seg_nodes.setdefault(seg, []).append(n)

    for seg, seg_list in seg_nodes.items():
        sorted_seg = sorted(seg_list, key=lambda n: -n["weight"])
        for i, n in enumerate(sorted_seg):
            next_n = sorted_seg[(i + 1) % len(sorted_seg)]
            pair = (n["id"], next_n["id"])
            if pair not in explicit_pairs and len(sorted_seg) > 1:
                edges.append({
                    "from": n["id"],
                    "to": next_n["id"],
                    "label": "",
                    "type": "segment_ring",
                    "weight": 0.3,
                })
                explicit_pairs.add(pair)
                explicit_pairs.add((next_n["id"], n["id"]))

    # ── Brain Core — central hub at origin ────────────────────────────────────
    brain_core_node: Dict[str, Any] = {
        "id":          "__brain_core__",
        "label":       "BRAIN CORE",
        "category":    "brain_core",
        "segment":     "brain_core",
        "color":       "#e8c840",
        "size":        4.5,
        "weight":      10,
        "role":        "brain_core",
        "health":      100,
        "description": "Central hub of your personal neural network.",
        "source_file": "",
        "kpis": [], "measurements": [],
        "x": 0.0, "y": 0.0, "z": 0.0,
    }
    nodes.insert(0, brain_core_node)

    # Connect brain-core to the highest-weight node of every segment
    seg_best: Dict[str, Dict[str, Any]] = {}
    for n in nodes:
        if n["id"] == "__brain_core__":
            continue
        seg = n.get("segment", "identity")
        if seg not in seg_best or n["weight"] > seg_best[seg]["weight"]:
            seg_best[seg] = n
    for seg, n in seg_best.items():
        edges.append({
            "from": "__brain_core__",
            "to":   n["id"],
            "label": seg,
            "type": "core_link",
            "weight": 1.0,
        })

    # ── segment metadata (passed to frontend for filter panel) ─────────────────
    seg_counts: Dict[str, int] = {}
    for node in raw.get("nodes", []):
        s = node.get("segment", "identity")
        seg_counts[s] = seg_counts.get(s, 0) + 1

    segments_meta = [
        {
            "id": seg,
            "label": seg.replace("_", " ").title(),
            "count": seg_counts.get(seg, 0),
            "center": clusters[seg],
        }
        for seg in _SEGMENTS
    ]

    return {
        "nodes": nodes,
        "edges": edges,
        "meta": {
            "world": "memory",
            "subject": raw.get("meta", {}).get("subject", "My Memory"),
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "segments": segments_meta,
            "source": "memory.json",
        },
    }


# ── Route ──────────────────────────────────────────────────────────────────────


@router.get("/load")
async def load_memory() -> Dict[str, Any]:
    """Load My Memory JSON and return it as a NeuralGraph-compatible graph."""
    if not MEMORY_FILE.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Memory file not found at: {MEMORY_FILE}",
        )
    try:
        with MEMORY_FILE.open("r", encoding="utf-8") as fh:
            raw = json.load(fh)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to parse memory file: {exc}",
        ) from exc

    return _transform(raw)


def load_memory_graph() -> Dict[str, Any]:
    """Return the transformed memory graph, or an empty graph on failure."""
    if not MEMORY_FILE.exists():
        return {"nodes": [], "edges": []}
    try:
        with MEMORY_FILE.open("r", encoding="utf-8") as fh:
            raw = json.load(fh)
        return _transform(raw)
    except Exception:
        return {"nodes": [], "edges": []}
