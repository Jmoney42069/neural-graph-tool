import json
import pathlib

p = pathlib.Path("data/graph.json")
g = json.loads(p.read_text(encoding="utf-8"))

main_node = {
    "id": "main",
    "label": "Voltera Backoffice",
    "category": "process",
    "description": (
        "Centrale kennisknoop — Voltera zonnepanelen backoffice procesflow. "
        "76 nodes, 100 edges, 14 swimlanes, 70 processtappen. "
        "Bevat AI-instructies, rol- en systeemoverzicht, bottleneck-aanpak en routeringslogica."
    ),
    "source_text": (
        "Central hub node — always injected into AI context. "
        "Contains process overview, swimlanes, node conventions, AI behavior rules."
    ),
    "source_file": "main.md",
    "role": "bridge",
    "health": 100,
    "kpis": [],
    "measurements": [],
    "onCriticalPath": True,
    "x": 0,
    "y": 0,
    "z": 0,
    "isPinned": True,
    "color": "#a78bfa",
    "size": 1.6,
}

# Remove any old main node, then insert at front
g["nodes"] = [n for n in g["nodes"] if n.get("id") != "main"]
g["nodes"].insert(0, main_node)

p.write_text(json.dumps(g, ensure_ascii=False, indent=2), encoding="utf-8")
print("Done. Nodes:", len(g["nodes"]), " Edges:", len(g["edges"]))
