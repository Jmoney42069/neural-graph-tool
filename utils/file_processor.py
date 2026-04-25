"""
utils/file_processor.py
────────────────────────────────────────────────────────────────────────────
Ingestion helpers that convert uploaded files or pasted text into clean
plain text, plus chunking logic for long documents.
"""

from __future__ import annotations

import csv
import io
import re
from pathlib import Path
from typing import Any, Dict, List

import fitz  # PyMuPDF
import pandas as pd
from langdetect import LangDetectException, detect


# ============================================================================
# Constants
# ============================================================================

SUPPORTED_EXTENSIONS = {".txt", ".pdf", ".csv"}
ALLOWED_LANGUAGES = {"nl", "en"}

CHUNK_TRIGGER = 6000
CHUNK_SIZE = 5000
CHUNK_OVERLAP = 500


# ============================================================================
# Text cleanup helpers
# ============================================================================


def normalize_whitespace(text: str) -> str:
    """Normalize newlines and excessive whitespace while preserving paragraphs."""
    if not text:
        return ""

    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[\t\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ ]{2,}", " ", text)
    return text.strip()



def clean_pdf_text(text: str) -> str:
    """Repair common PDF extraction issues like hyphenated line wraps."""
    if not text:
        return ""

    # Merge words split across line breaks: eco-\nsystem -> ecosystem
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)

    # Flatten single newlines into spaces but keep paragraph breaks.
    text = re.sub(r"(?<!\n)\n(?!\n)", " ", text)
    return normalize_whitespace(text)



def detect_language_code(text: str) -> str:
    """Best-effort language detection; returns 'unknown' on failure."""
    try:
        return detect(text)
    except (LangDetectException, Exception):
        return "unknown"


# ============================================================================
# Input processors
# ============================================================================


def process_txt_file(file_path: Path) -> str:
    with file_path.open("r", encoding="utf-8", errors="replace") as handle:
        return normalize_whitespace(handle.read())



def process_pdf_file(file_path: Path) -> str:
    pages: List[str] = []

    with fitz.open(file_path) as doc:
        for i, page in enumerate(doc, start=1):
            raw = page.get_text("text") or ""
            cleaned = clean_pdf_text(raw)
            if not cleaned:
                cleaned = f"[Page {i}: image only, no text extracted]"

            pages.append(f"--- PAGE {i} ---\n\n{cleaned}")

    return normalize_whitespace("\n\n".join(pages))



def _detect_csv_delimiter(sample: str) -> str:
    """Detect delimiter among comma, semicolon and tab."""
    sniff_candidates = [",", ";", "\t"]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters="".join(sniff_candidates))
        if dialect.delimiter in sniff_candidates:
            return dialect.delimiter
    except Exception:
        pass

    counts = {sep: sample.count(sep) for sep in sniff_candidates}
    return max(counts, key=counts.get)



def process_csv_file(file_path: Path) -> str:
    with file_path.open("r", encoding="utf-8", errors="replace") as handle:
        raw = handle.read()

    delimiter = _detect_csv_delimiter(raw[:4096])
    data = pd.read_csv(io.StringIO(raw), sep=delimiter, dtype=str, keep_default_na=False)

    data.columns = [str(col).strip() for col in data.columns]
    row_count = len(data)
    col_count = len(data.columns)
    column_names = ", ".join(data.columns)

    lines: List[str] = [
        "CSV SUMMARY",
        f"Rows: {row_count}",
        f"Columns: {col_count}",
        f"Column names: {column_names}",
        "",
        "CSV ROWS",
    ]

    if row_count > 500:
        head = data.head(250)
        tail = data.tail(250)
        omitted = row_count - 500
        render_frames = [(1, head), (row_count - 249, tail)]
    else:
        omitted = 0
        render_frames = [(1, data)]

    for start_index, frame in render_frames:
        for offset, (_, row) in enumerate(frame.iterrows()):
            row_index = start_index + offset
            pairs = []
            for col in data.columns:
                value = str(row[col]).strip() if row[col] is not None else ""
                value = re.sub(r"\s+", " ", value)
                pairs.append(f"{col}={value}")
            lines.append(f"Row {row_index}: " + ", ".join(pairs))

        if omitted and start_index == 1:
            lines.append(f"[... {omitted} rows truncated ...]")

    return normalize_whitespace("\n".join(lines))



def process_pasted_text(raw_text: str) -> Dict[str, Any]:
    cleaned = normalize_whitespace(raw_text)
    language = detect_language_code(cleaned) if cleaned else "unknown"

    warning = None
    if language not in ALLOWED_LANGUAGES and language != "unknown":
        warning = (
            f"[Warning: text appears to be in {language} — extraction quality may be reduced]"
        )
        cleaned = f"{warning}\n\n{cleaned}" if cleaned else warning

    return {
        "text": cleaned,
        "language": language,
        "warning": warning,
        "file_type": "text",
    }


# ============================================================================
# Chunking
# ============================================================================


def _find_sentence_boundary(text: str, start: int, target_end: int) -> int:
    """
    Pick a nearby sentence boundary so chunks avoid cutting in the middle.
    Falls back to target_end if no punctuation boundary is found.
    """
    if target_end >= len(text):
        return len(text)

    search_window_start = max(start + 1000, target_end - 400)
    window = text[search_window_start:target_end + 1]
    matches = list(re.finditer(r"[.!?]\s+|\n\n", window))
    if matches:
        return search_window_start + matches[-1].end()

    return target_end



def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[Dict[str, Any]]:
    """Split long text into overlapping chunks, preferring sentence boundaries."""
    text = normalize_whitespace(text)
    if not text:
        return []

    if len(text) <= CHUNK_TRIGGER:
        return [{"index": 1, "total": 1, "text": text}]

    chunks: List[str] = []
    start = 0

    while start < len(text):
        naive_end = min(start + chunk_size, len(text))
        end = _find_sentence_boundary(text, start, naive_end)
        if end <= start:
            end = naive_end

        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)

        if end >= len(text):
            break

        start = max(0, end - overlap)

    total = len(chunks)
    return [{"index": i + 1, "total": total, "text": chunk} for i, chunk in enumerate(chunks)]


# ============================================================================
# Public entry points
# ============================================================================


def process_file(file_path: str | Path) -> Dict[str, Any]:
    """Extract and normalize text from txt/pdf/csv inputs and chunk if needed."""
    path = Path(file_path)
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"File not found: {path}")

    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {suffix}")

    if suffix == ".txt":
        text = process_txt_file(path)
        file_type = "txt"
    elif suffix == ".pdf":
        text = process_pdf_file(path)
        file_type = "pdf"
    else:
        text = process_csv_file(path)
        file_type = "csv"

    chunks = chunk_text(text)
    return {
        "text": text,
        "chunks": chunks,
        "character_count": len(text),
        "chunk_count": len(chunks),
        "file_type": file_type,
    }



def process_input_text(raw_text: str) -> Dict[str, Any]:
    """Normalize pasted/raw text input and chunk if needed."""
    payload = process_pasted_text(raw_text)
    chunks = chunk_text(payload["text"])

    return {
        "text": payload["text"],
        "chunks": chunks,
        "character_count": len(payload["text"]),
        "chunk_count": len(chunks),
        "file_type": payload["file_type"],
        "language": payload["language"],
        "warning": payload["warning"],
    }
