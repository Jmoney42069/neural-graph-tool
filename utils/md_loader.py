"""
utils/md_loader.py
──────────────────────────────────────────────────────────────────────────────
Laadt de originele MD step-bestanden op basis van het source_file veld in nodes.

De bestanden zitten in: Demo/steps/<mapnaam>/<mapnaam>.md
waarbij <mapnaam> overeen komt met het source_file veld (zonder .md extensie).

Public API:
    load_node_md(source_file: str) -> str | None
    load_nodes_md(nodes: list[dict], max_nodes: int = 8) -> str
    find_md_path(source_file: str) -> Path | None
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional

# Root of the project (one level above utils/)
_PROJECT_ROOT = Path(__file__).parent.parent

# Known search locations for MD files
_SEARCH_DIRS = [
    _PROJECT_ROOT / "Demo" / "steps",
    _PROJECT_ROOT / "Demo",
    _PROJECT_ROOT / "data",
]


@lru_cache(maxsize=200)
def find_md_path(source_file: str) -> Optional[Path]:
    """
    Look up the physical path of an MD file based on its source_file name.

    Tries in order:
    1. Demo/steps/<name>/<name>.md   (standard structure)
    2. Recursive search in all _SEARCH_DIRS
    3. Returns None if not found
    """
    if not source_file:
        return None

    # Strip .md extensie voor zoeken op mapnaam
    base = source_file.removesuffix(".md")

    # Strategie 1: standaard mapstructuur Demo/steps/<base>/<base>.md
    candidate = _PROJECT_ROOT / "Demo" / "steps" / base / source_file
    if candidate.exists():
        return candidate

    # Strategie 2: subfolder structuur (annulering, chase_flow etc.)
    for search_dir in _SEARCH_DIRS:
        if not search_dir.exists():
            continue
        # Zoek recursief naar bestand met deze naam
        matches = list(search_dir.rglob(source_file))
        if matches:
            return matches[0]
        # Probeer ook zonder .md extensie als bestandsnaam
        matches_no_ext = list(search_dir.rglob(base + ".md"))
        if matches_no_ext:
            return matches_no_ext[0]

    return None


def load_node_md(source_file: str) -> Optional[str]:
    """
    Laad de inhoud van een MD step-bestand.
    Geeft None terug als bestand niet gevonden / leesfout.
    """
    path = find_md_path(source_file)
    if path is None:
        return None
    try:
        content = path.read_text(encoding="utf-8").strip()
        if not content:
            return None
        return content
    except Exception:
        return None


def load_nodes_md(
    nodes: List[Dict],
    max_nodes: int = 8,
    max_chars_per_file: int = 600,
) -> str:
    """
    Laad de MD inhoud van een lijst nodes en combineer tot één context string.
    
    Gebruikt source_file veld van elke node.
    Neemt maximaal max_nodes bestanden mee (om token limiet te respecteren).
    Knipt elk bestand af op max_chars_per_file tekens.
    """
    sections: List[str] = []
    seen_files: set = set()

    for node in nodes[:max_nodes]:
        source_file = node.get("source_file", "")
        if not source_file or source_file in seen_files:
            continue
        seen_files.add(source_file)

        content = load_node_md(source_file)
        if not content:
            continue

        # Knip af en markeer truncatie
        if len(content) > max_chars_per_file:
            content = content[:max_chars_per_file] + "\n... [afgekapt]"

        label = node.get("label", source_file)
        node_id = node.get("id", "?")
        sections.append(
            f"### [{node_id}] {label}\n"
            f"**Bestand:** {source_file}\n\n"
            f"{content}"
        )

    if not sections:
        return ""

    return "## STAP DOCUMENTATIE (uit MD bestanden):\n\n" + "\n\n---\n\n".join(sections)


def build_route_summary(nodes: List[Dict], edges: List[Dict]) -> str:
    """
    Bouw een leesbare tekst van de route (nodes op volgorde) met stap-details.
    Handig voor vragen als 'wat is de snelste route van A naar B'.
    """
    if not nodes:
        return ""

    lines = ["## ROUTE ANALYSE:\n"]
    node_map = {n["id"]: n for n in nodes}

    # Bouw adjacency voor volgorde detectie
    outgoing: Dict[str, List[str]] = {n["id"]: [] for n in nodes}
    for e in edges:
        frm, to = e.get("from", ""), e.get("to", "")
        if frm in outgoing:
            outgoing[frm].append(to)

    # Vind startnode (geen inkomende edges in deze subgraph)
    incoming_ids = {e.get("to") for e in edges}
    start_candidates = [n["id"] for n in nodes if n["id"] not in incoming_ids]

    # Doorloop route in volgorde
    visited = set()
    queue = start_candidates[:1] if start_candidates else [nodes[0]["id"]]
    ordered = []
    while queue:
        cur = queue.pop(0)
        if cur in visited:
            continue
        visited.add(cur)
        ordered.append(cur)
        for nxt in outgoing.get(cur, []):
            if nxt not in visited and nxt in node_map:
                queue.append(nxt)

    for i, nid in enumerate(ordered, 1):
        node = node_map.get(nid, {})
        label = node.get("label", nid)
        cat = node.get("category", "")
        desc = (node.get("description") or "")[:120]
        lines.append(f"{i}. **{label}** [{cat}] — {desc}")

    return "\n".join(lines)
