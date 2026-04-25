"""
utils/graph_query.py
────────────────────────────────────────────────────────────────────────────
RAG-style graph context retrieval for NeuralGraph chat.

Public API:
    find_relevant_context(question, graph, max_nodes=12) -> dict
    extract_keywords(question) -> list[str]
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Set


# ============================================================================
# 1. Stop words — English + Dutch combined
# ============================================================================

STOPWORDS: Set[str] = {
    # English
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "must", "shall",
    "and", "or", "but", "if", "because", "as", "until", "while",
    "of", "at", "by", "for", "with", "about", "against", "between",
    "through", "during", "before", "after", "above", "below",
    "from", "up", "down", "in", "on", "to", "into", "then", "than",
    "that", "this", "these", "those", "it", "its", "itself",
    "what", "which", "who", "whom", "where", "when", "how", "why",
    "all", "both", "each", "every", "more", "most", "some", "any",
    "such", "so", "yet", "not", "no", "nor", "very", "just",
    "also", "we", "us", "our", "you", "your", "he", "she", "they",
    "them", "their", "i", "me", "my", "tell", "show", "give", "get",
    # Dutch (as specified)
    "de", "het", "een", "en", "van", "is", "dat", "zijn", "op", "te",
    "in", "met", "voor", "aan", "er", "maar", "ook", "om", "dan", "als",
    "nog", "wel", "niet", "door", "dit", "heeft", "wordt", "naar", "ze",
    "hij", "we", "ik", "je", "jij", "bij", "zo", "uit", "worden",
    "was", "hebben", "kan", "zal", "mag", "moet", "na", "over",
    "geen", "meer", "al", "nu", "tot", "elk", "ieder", "alle",
    "hun", "hen", "mijn", "jouw", "onze", "ons", "die", "deze",
    "zich", "haar", "mij", "uw", "wie", "wat", "hoe", "waarom",
    "wanneer", "waar", "welk", "welke", "toch", "ja", "nee",
}

# ============================================================================
# 2. Category signal words: question keywords → category boosts
# ============================================================================

_CATEGORY_SIGNALS: Dict[str, Set[str]] = {
    # ── Demo-world categories ─────────────────────────────────────────────
    "product":    {"product", "products", "producten", "service", "services",
                   "dienst", "diensten", "aanbod", "offering"},
    "process":    {"process", "processes", "workflow", "step", "procedure",
                   "stap", "stappen", "proces", "hoe", "werkt", "how"},
    "compliance": {"compliance", "rule", "rules", "regulation", "wet", "wft",
                   "afm", "regel", "regels", "vereiste", "vereisten", "vergunning",
                   "license", "legal"},
    "finance":    {"finance", "financial", "payment", "cost", "costs", "price",
                   "pricing", "financieel", "betaling", "prijs", "kosten",
                   "tarief", "fee", "revenue", "opbrengst"},
    "customer":   {"customer", "customers", "client", "clients", "user", "users",
                   "klant", "klanten", "gebruiker", "afnemer"},
    "person":     {"person", "people", "employee", "employees", "manager",
                   "persoon", "medewerker", "medewerkers", "directeur", "team"},
    "system":     {"system", "systems", "tool", "platform", "software", "crm",
                   "systeem", "applicatie", "app", "portal"},
    "location":   {"location", "locations", "office", "city", "place",
                   "stad", "kantoor", "locatie", "vestiging"},
    "concept":    {"concept", "idea", "begrip", "definitie", "definition",
                   "term", "meaning", "betekenis"},
    # ── Memory-world segments ─────────────────────────────────────────────
    "identity":           {"identity", "identiteit", "wie ben ik", "who am i", "zelf", "self"},
    "psychology":         {"psychology", "psychologie", "gedrag", "behavior", "mentaal", "mental"},
    "motivations":        {"motivations", "motivatie", "drijfveren", "waarom", "driven", "why"},
    "personality":        {"personality", "persoonlijkheid", "karakter", "character", "traits"},
    "philosophy":         {"philosophy", "filosofie", "visie", "vision", "waarden", "values",
                           "overtuiging", "beliefs"},
    "health_mind":        {"health", "gezondheid", "mind", "welzijn", "wellness", "energie",
                           "energy", "sport", "fitness"},
    "social":             {"social", "sociaal", "relaties", "relationships", "vrienden",
                           "friends", "netwerk", "network", "mensen", "people"},
    "career":             {"career", "carriere", "werk", "work", "job", "baan", "professioneel",
                           "professional", "functie"},
    "goals":              {"goals", "doelen", "doel", "goal", "ambities", "ambitions",
                           "targets", "plannen", "plans", "toekomst", "future"},
    "financial":          {"financial", "financieel", "geld", "money", "inkomen", "income",
                           "budget", "vermogen", "wealth", "sparen", "savings"},
    "trading":            {"trading", "traden", "handel", "beurs", "market", "investeren",
                           "invest", "aandelen", "stocks", "crypto", "forex"},
    "learning":           {"learning", "leren", "studie", "study", "kennis", "knowledge",
                           "skills", "vaardigheden", "cursus", "course"},
    "tech_stack":         {"tech", "stack", "technology", "technologie", "developer",
                           "code", "coding", "programmeren", "devtools"},
    "ai_models":          {"ai", "models", "llm", "gpt", "claude", "gemini", "openai",
                           "anthropic", "model", "language model"},
    "prompt_engineering": {"prompt", "prompting", "engineering", "instructies", "instructions",
                           "system prompt", "few-shot"},
    "project_jarvis":     {"jarvis", "ai assistant", "personal assistant"},
    "project_tools":      {"automation", "automatisering", "scripts", "tools", "workflow"},
    "project_neural":     {"neural", "network", "neuraal", "netwerk", "mindmap", "graph"},
    "voltera_compliance": {"voltera", "compliance", "solar", "zonnepanelen", "wft"},
    "voltera_rag":        {"rag", "chatbot", "knowledge base", "retrieval"},
    "voltera_scripts":    {"scripts", "sales", "verkoop", "cold call", "pitch"},
    "history":            {"history", "geschiedenis", "verleden", "past", "ervaring",
                           "experience", "achtergrond", "background"},
    "winners_center":     {"winners", "winnaar", "success", "succes", "mindset",
                           "discipline", "focus", "groeien", "growth"},
}


# ============================================================================
# 3. Helpers
# ============================================================================

def _levenshtein(a: str, b: str) -> int:
    """Levenshtein edit distance with an early-exit on large length diffs."""
    if abs(len(a) - len(b)) > 3:
        return 99  # fast-path: can't possibly be within edit distance 2

    m, n = len(a), len(b)
    prev = list(range(n + 1))
    curr = [0] * (n + 1)

    for i in range(1, m + 1):
        curr[0] = i
        for j in range(1, n + 1):
            if a[i - 1] == b[j - 1]:
                curr[j] = prev[j - 1]
            else:
                curr[j] = 1 + min(prev[j], curr[j - 1], prev[j - 1])
        prev, curr = curr, prev

    return prev[n]


def extract_keywords(question: str) -> List[str]:
    """
    Lowercase, tokenize, strip stop words.

    Returns ordered unique keywords, longest first so more specific
    terms are tried first during scoring.
    """
    words = re.findall(
        r"[a-zA-ZàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿÀ-Öà-ÿ0-9]+",
        question.lower(),
    )
    seen: Set[str] = set()
    keywords: List[str] = []
    for w in words:
        if w not in STOPWORDS and len(w) >= 2 and w not in seen:
            seen.add(w)
            keywords.append(w)

    # Sort longest first so multi-character matches score higher in tie-breaks.
    keywords.sort(key=lambda x: -len(x))
    return keywords


def _detect_category_boosts(question_lower: str) -> Dict[str, float]:
    """Return per-category score boosts based on question vocabulary."""
    boosts: Dict[str, float] = {}
    for category, signals in _CATEGORY_SIGNALS.items():
        if any(s in question_lower for s in signals):
            boosts[category] = 2.0
    return boosts


def _score_node(
    node: Dict[str, Any],
    keywords: List[str],
    category_boosts: Dict[str, float],
) -> float:
    """
    Compute relevance score for a single node against extracted keywords.

    Scoring:
      keyword in node label       → +3.0
      keyword in node description → +2.0
      keyword in node id          → +1.0
      keyword within edit-dist 2
        of a label word           → +1.5  (fuzzy, only for kw len ≥ 4)
      category boost              → +2.0 if question matches category signals
    """
    label       = (node.get("label")       or "").lower()
    desc        = (node.get("description") or "").lower()
    node_id     = (node.get("id")          or "").lower()
    category    = (node.get("category")   or "concept").lower()
    source_text = (node.get("source_text") or "").lower()

    # Pre-compute label token set for fuzzy matching
    label_tokens: Set[str] = set(re.findall(r"[a-z0-9]+", label))

    score = 0.0
    for kw in keywords:
        if kw in label:
            score += 3.0
        if kw in desc:
            score += 2.0
        if kw in node_id:
            score += 1.0
        if kw in source_text:
            score += 1.5

        # Fuzzy match: only worthwhile for keywords of length ≥ 4
        if len(kw) >= 4:
            for lt in label_tokens:
                if lt != kw and len(lt) >= 3 and _levenshtein(kw, lt) <= 2:
                    score += 1.5
                    break  # one fuzzy bonus per keyword

    score += category_boosts.get(category, 0.0)
    return score


# ============================================================================
# 4. Public API
# ============================================================================

def find_relevant_context(
    question: str,
    graph: Dict[str, Any],
    max_nodes: int = 12,
) -> Dict[str, Any]:
    """
    RAG retrieval over the NeuralGraph knowledge graph.

    Steps
    ─────
    1.  Keyword extraction (stop-word filtered).
    2.  Node scoring with fuzzy matching + category boosts.
    3.  Graph traversal — add immediate neighbours of top-scored nodes.
    4.  Subgraph construction — edges where both endpoints are included.

    Returns
    ───────
    {
        "relevant_nodes":  list[dict],   # top matched nodes
        "relevant_edges":  list[dict],   # edges within the subgraph
        "node_ids":        list[str],    # id of every included node
        "keywords":        list[str],    # extracted keywords
        "context_summary": str,          # human-readable summary line
    }
    """
    nodes: List[Dict[str, Any]] = graph.get("nodes", [])
    edges: List[Dict[str, Any]] = graph.get("edges", [])

    # ── Empty graph fast-path ─────────────────────────────────────────────
    if not nodes:
        return {
            "relevant_nodes":  [],
            "relevant_edges":  [],
            "node_ids":        [],
            "keywords":        [],
            "context_summary": "Graph is empty",
        }

    # ── Step 1: Keyword extraction ────────────────────────────────────────
    keywords = extract_keywords(question)
    category_boosts = _detect_category_boosts(question.lower())

    if not keywords:
        # Fallback: return a balanced spread when no useful keywords found
        sample = nodes[:max_nodes]
        sample_ids = [n.get("id", "") for n in sample if n.get("id")]
        return {
            "relevant_nodes": sample,
            "relevant_edges": [
                e for e in edges
                if e.get("from") in sample_ids and e.get("to") in sample_ids
            ],
            "node_ids":        sample_ids,
            "keywords":        [],
            "context_summary": f"{len(sample)} nodes (no keywords extracted)",
        }

    # ── Step 2: Score every node ──────────────────────────────────────────
    scored: List[tuple[float, Dict[str, Any]]] = []
    for node in nodes:
        s = _score_node(node, keywords, category_boosts)
        if s > 0.0:
            scored.append((s, node))

    scored.sort(key=lambda x: -x[0])

    # Seed set = top half-of-cap nodes with positive scores
    seed_count = max(1, max_nodes // 2)
    top_nodes: List[Dict[str, Any]] = [n for _, n in scored[:seed_count]]
    top_ids: Set[str] = {n.get("id", "") for n in top_nodes}

    # ── Step 3: Graph traversal — add immediate neighbours ────────────────
    id_to_node: Dict[str, Dict[str, Any]] = {n.get("id", ""): n for n in nodes}
    neighbor_candidates: List[str] = []

    for edge in edges:
        frm = edge.get("from", "")
        to  = edge.get("to",   "")
        if frm in top_ids and to not in top_ids:
            neighbor_candidates.append(to)
        elif to in top_ids and frm not in top_ids:
            neighbor_candidates.append(frm)

    seen_neighbors: Set[str] = set()
    for nid in neighbor_candidates:
        if len(top_ids) >= max_nodes:
            break
        if nid in seen_neighbors or nid in top_ids:
            continue
        seen_neighbors.add(nid)
        neighbor_node = id_to_node.get(nid)
        if neighbor_node:
            top_nodes.append(neighbor_node)
            top_ids.add(nid)

    # Deduplicate while preserving order
    seen_ids: Set[str] = set()
    deduped: List[Dict[str, Any]] = []
    for node in top_nodes:
        nid = node.get("id", "")
        if nid and nid not in seen_ids:
            seen_ids.add(nid)
            deduped.append(node)

    deduped = deduped[:max_nodes]
    final_ids: Set[str] = {n.get("id", "") for n in deduped}

    # Always include the brain-core instruction node (it holds the main.md context)
    brain_core = id_to_node.get("__brain_core__")
    if brain_core and "__brain_core__" not in final_ids:
        deduped.insert(0, brain_core)
        final_ids.add("__brain_core__")

    # ── Step 4: Subgraph construction ─────────────────────────────────────
    relevant_edges = [
        e for e in edges
        if e.get("from", "") in final_ids and e.get("to", "") in final_ids
    ]

    top_kws = keywords[:3]
    context_summary = (
        f"{len(deduped)} nodes, {len(relevant_edges)} edges relevant to: "
        f"{', '.join(top_kws)}"
    )

    return {
        "relevant_nodes":  deduped,
        "relevant_edges":  relevant_edges,
        "node_ids":        list(final_ids),
        "keywords":        keywords,
        "context_summary": context_summary,
    }
