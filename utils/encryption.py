"""
utils/encryption.py
─────────────────────────────────────────────────────────────────────────────
Fernet symmetric encryption helpers for secure API key storage.

A per-installation key is generated on first run and persisted to
/data/.secret.key (mode 0o600 on Unix). Every subsequent run loads
that key so previously encrypted values can be decrypted.

Usage:
    from utils.encryption import encrypt_key, decrypt_key
    ciphertext = encrypt_key("sk-or-mykey")
    plaintext  = decrypt_key(ciphertext)
"""

import logging
import os
import re
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken  # noqa: F401 – re-exported for callers

_log = logging.getLogger(__name__)

# ── Paths ─────────────────────────────────────────────────────────────────
_DATA_DIR = Path(__file__).parent.parent / "data"
_KEY_FILE  = _DATA_DIR / ".secret.key"

# Module-level cache so we only read the key file once per process
_fernet_instance: "Fernet | None" = None


# ── Internal helpers ──────────────────────────────────────────────────────

def _get_fernet() -> Fernet:
    """Return a cached Fernet instance, creating and persisting the key if needed."""
    global _fernet_instance
    if _fernet_instance is not None:
        return _fernet_instance

    _DATA_DIR.mkdir(parents=True, exist_ok=True)

    if _KEY_FILE.exists():
        key = _KEY_FILE.read_bytes().strip()
    else:
        key = Fernet.generate_key()
        _KEY_FILE.write_bytes(key)
        # Restrict permissions on POSIX systems; harmless no-op on Windows
        try:
            os.chmod(_KEY_FILE, 0o600)
        except (AttributeError, NotImplementedError, OSError):
            pass

    _fernet_instance = Fernet(key)
    return _fernet_instance


# ── Public API ────────────────────────────────────────────────────────────

def encrypt_key(plaintext: str) -> str:
    """
    Encrypt *plaintext* and return a URL-safe base64-encoded ciphertext string.

    Args:
        plaintext: The secret value to encrypt (e.g. an API key).

    Returns:
        A base64-encoded UTF-8 string that can be stored safely in JSON.
    """
    if not isinstance(plaintext, str):
        raise TypeError(f"encrypt_key expects str, got {type(plaintext).__name__}")
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_key(ciphertext: str) -> Optional[str]:
    """
    Decrypt a ciphertext string previously produced by :func:`encrypt_key`.

    Args:
        ciphertext: Base64-encoded ciphertext string.

    Returns:
        The original plaintext string, or ``None`` if decryption fails
        (e.g. tampered data, rotated key file, or wrong input type).
    """
    if not isinstance(ciphertext, str):
        _log.warning(
            "[encryption] decrypt_key called with non-str type: %s",
            type(ciphertext).__name__,
        )
        return None
    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        _log.warning(
            "[encryption] decrypt_key: InvalidToken — "
            "key file may have changed or ciphertext is corrupt"
        )
        return None
    except Exception as exc:
        _log.error("[encryption] decrypt_key unexpected error: %s", exc, exc_info=True)
        return None


def validate_api_key(key: str) -> bool:
    """
    Return True if *key* matches the expected OpenRouter API key format.

    OpenRouter keys start with ``sk-or-`` followed by at least 10
    alphanumeric / underscore / hyphen characters.

    Args:
        key: The plaintext API key supplied by the user.

    Returns:
        ``True`` if the format looks valid, ``False`` otherwise.
    """
    if not isinstance(key, str):
        return False
    key = key.strip()
    return bool(key and re.match(r"^sk-or-[A-Za-z0-9_-]{10,}$", key))
