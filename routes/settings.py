"""
routes/settings.py
─────────────────────────────────────────────────────────────────────────────
Settings endpoints for NeuralGraph.

Endpoints:
  GET  /settings/load     — Return current settings (API key NEVER returned)
  POST /settings/save     — Persist settings; API key is encrypted at rest
  GET  /settings/validate — Live-test the stored API key against OpenRouter
  GET  /settings/models   — Fetch & filter available OpenRouter models
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from utils.encryption import decrypt_key, encrypt_key, validate_api_key as _validate_key_format
from cryptography.fernet import InvalidToken

_log = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])

# ── Paths ─────────────────────────────────────────────────────────────────
_DATA_DIR      = Path(__file__).parent.parent / "data"
_SETTINGS_FILE = _DATA_DIR / "settings.json"
_OPENROUTER    = "https://openrouter.ai/api/v1"

# ── Defaults ──────────────────────────────────────────────────────────────
_DEFAULTS: Dict[str, Any] = {
    "graph_model": "anthropic/claude-sonnet-4-6",
    "chat_model":  "meta-llama/llama-3.3-70b-instruct",
    "physics": {
        "repulsion_strength": 1200,
        "spring_length":      45,
        "damping":            0.88,
    },
}


# ── Pydantic models ────────────────────────────────────────────────────────

class PhysicsSettings(BaseModel):
    repulsion_strength: float = 1200
    spring_length:      float = 45
    damping:            float = 0.88


class SettingsSaveRequest(BaseModel):
    openrouter_api_key: Optional[str] = None
    graph_model:        str = "anthropic/claude-sonnet-4-6"
    chat_model:         str = "meta-llama/llama-3.3-70b-instruct"
    physics:            PhysicsSettings = PhysicsSettings()


# ── Internal helpers ───────────────────────────────────────────────────────

def _read_raw() -> Dict[str, Any]:
    """Read /data/settings.json, returning {} if the file doesn't exist."""
    if not _SETTINGS_FILE.exists():
        return {}
    with _SETTINGS_FILE.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _write_raw(data: Dict[str, Any]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    with _SETTINGS_FILE.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)


def _load_api_key() -> Optional[str]:
    """Decrypt and return the stored API key, or None if absent / corrupt."""
    raw = _read_raw()
    ciphertext = raw.get("openrouter_api_key_encrypted", "")
    if not ciphertext:
        return None
    return decrypt_key(ciphertext)  # returns None on failure — no exceptions raised


def _key_preview(key: Optional[str]) -> str:
    """Return a safe preview like 'sk-or-...abc' — never exposes the full key."""
    if not key or len(key) < 12:
        return ""
    return key[:7] + "..." + key[-4:]


# ── GET /settings/load ─────────────────────────────────────────────────────

@router.get("/load")
async def load_settings() -> Dict[str, Any]:
    """
    Return saved settings.
    The API key itself is NEVER included in the response —
    only a boolean flag and a short preview (first 7 + last 4 chars).
    """
    raw         = _read_raw()
    api_key     = _load_api_key()
    has_key     = api_key is not None
    physics_raw = raw.get("physics", _DEFAULTS["physics"])

    _log.info("[Settings] Loaded — key present: %s", has_key)

    return {
        "api_key_saved": has_key,   # backward-compat alias
        "has_api_key":   has_key,
        "key_preview":   _key_preview(api_key),
        "model_extract": raw.get("graph_model", _DEFAULTS["graph_model"]),
        "model_chat":    raw.get("chat_model",  _DEFAULTS["chat_model"]),
        "graph_model":   raw.get("graph_model", _DEFAULTS["graph_model"]),
        "chat_model":    raw.get("chat_model",  _DEFAULTS["chat_model"]),
        "physics": {
            "repulsion_strength": physics_raw.get("repulsion_strength", 1200),
            "spring_length":      physics_raw.get("spring_length",      45),
            "damping":            physics_raw.get("damping",            0.88),
        },
    }


# ── POST /settings/save ────────────────────────────────────────────────────

@router.post("/save")
async def save_settings(body: SettingsSaveRequest) -> Dict[str, Any]:
    """
    Persist settings to /data/settings.json.
    * If openrouter_api_key is supplied and non-empty, encrypt it with Fernet
      and store only the ciphertext — the plaintext key is never written to disk.
    * Physics and model prefs are stored as plain JSON (not sensitive).
    """
    raw = _read_raw()

    # ── API key ──────────────────────────────────────────────────────────
    provided_key = (body.openrouter_api_key or "").strip()
    if provided_key:
        if not _validate_key_format(provided_key):
            raise HTTPException(
                status_code=422,
                detail={"error": "Ongeldige API key notatie — keys starten met 'sk-or-'"},
            )
        raw["openrouter_api_key_encrypted"] = encrypt_key(provided_key)

    # ── Model preferences ─────────────────────────────────────────────────
    raw["graph_model"] = body.graph_model
    raw["chat_model"]  = body.chat_model

    # ── Physics ──────────────────────────────────────────────────────────
    raw["physics"] = body.physics.model_dump()

    _write_raw(raw)
    _log.info("[Settings] Saved to disk: %s", _SETTINGS_FILE)

    api_key = _load_api_key()
    has_key = api_key is not None

    return {
        "success":       True,
        "status":        "saved",
        "api_key_saved": has_key,
        "has_api_key":   has_key,
        "key_preview":   _key_preview(api_key),
    }


# ── GET /settings/validate ─────────────────────────────────────────────────

@router.get("/validate")
async def validate_api_key() -> Dict[str, Any]:
    """
    Decrypt the stored key and make a real test call to OpenRouter.
    Returns {"valid": true/false} — the key is never echoed back.
    """
    key = _load_api_key()
    if not key:
        return {"valid": False, "error": "No API key configured"}

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{_OPENROUTER}/models",
                headers={"Authorization": f"Bearer {key}"},
            )

        if resp.status_code == 200:
            model_count = len(resp.json().get("data", []))
            return {"valid": True, "model_count": model_count}

        if resp.status_code in (401, 403):
            return {"valid": False, "error": "Invalid API key"}

        return {"valid": False, "error": f"Unexpected status {resp.status_code}"}

    except httpx.TimeoutException:
        return {"valid": False, "error": "Connection timed out"}
    except Exception:
        return {"valid": False, "error": "Connection failed"}


# ── GET /settings/models ───────────────────────────────────────────────────

@router.get("/models")
async def list_models() -> Dict[str, Any]:
    """
    Fetch models from OpenRouter using the stored key.
    Filters to models with context_length >= 16 000.
    Sort order: free models first (pricing.prompt == 0), then by
    context_length descending.
    """
    key = _load_api_key()
    if not key:
        raise HTTPException(status_code=401, detail="No API key configured")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{_OPENROUTER}/models",
                headers={"Authorization": f"Bearer {key}"},
            )
        resp.raise_for_status()

    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail="OpenRouter returned an error",
        )
    except Exception:
        raise HTTPException(status_code=502, detail="Could not reach OpenRouter")

    raw_models = resp.json().get("data", [])
    filtered: list[Dict[str, Any]] = []

    for m in raw_models:
        ctx = m.get("context_length", 0) or 0
        if ctx < 16_000:
            continue

        pricing    = m.get("pricing") or {}
        prompt_str = pricing.get("prompt", "0") or "0"
        try:
            prompt_price = float(prompt_str)
        except (TypeError, ValueError):
            prompt_price = 0.0

        filtered.append({
            "id":             m.get("id", ""),
            "name":           m.get("name") or m.get("id", ""),
            "context_length": ctx,
            "pricing_prompt": prompt_price,
        })

    # Free first, then longest context
    filtered.sort(key=lambda x: (x["pricing_prompt"] != 0, -x["context_length"]))

    return {"models": filtered, "total": len(filtered)}

