#!/usr/bin/env python3
"""
FILE: scripts/server_entry.py
DOES: PyInstaller entry point — boots uvicorn with the FastAPI app
USES: uvicorn, main (FastAPI app), routes.*
EXPOSES: nothing (standalone process)
"""

import os
import sys

# When running as a PyInstaller bundle, the extracted files live in sys._MEIPASS.
# FastAPI's StaticFiles(directory="frontend") needs to resolve relative to CWD,
# so we chdir into the bundle root.
if getattr(sys, "frozen", False):
    os.chdir(sys._MEIPASS)

# Explicit imports so PyInstaller traces the full dependency tree.
# (uvicorn.run("main:app") uses a string reference PyInstaller can't follow.)
import main  # noqa: F401
import routes.graph  # noqa: F401
import routes.chat  # noqa: F401
import routes.settings  # noqa: F401
import routes.query_chat  # noqa: F401

import uvicorn

port = int(os.environ.get("NEURALGRAPH_PORT", "8000"))
uvicorn.run("main:app", host="127.0.0.1", port=port)
