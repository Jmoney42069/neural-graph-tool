# NeuralGraph — Desktop App Setup

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| **Node.js** | ≥ 18.x | `node -v` |
| **npm** | ≥ 9.x | `npm -v` |
| **Python** | 3.11+ | `python --version` |
| **pip** | latest | `pip --version` |

---

## 1. Install Dependencies

```bash
# JavaScript (Electron + builder)
npm install

# Python (FastAPI backend) — use your existing venv
pip install -r requirements.txt
```

---

## 2. Run in Development

```bash
npm run dev
```

This does three things automatically:
1. Opens a frameless Electron window with the loading screen
2. Spawns the FastAPI backend (`uvicorn main:app`) using your `.venv` Python
3. Once `/health` responds OK, navigates to `http://127.0.0.1:<port>`

The backend port is chosen dynamically (8000–8019) to avoid conflicts.

**DevTools:** Press `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (macOS) in the app window. Python logs appear in the console prefixed with `[Python]`.

---

## 3. Build an Installer

### Step A — Compile the Python backend

```bash
# Windows
scripts\build-backend.bat

# macOS / Linux
bash scripts/build-backend.sh
```

This uses PyInstaller to create a single binary at `backend-dist/neuralgraph-server(.exe)`.

**Requires:** `pip install pyinstaller`

### Step B — Package the Electron app

```bash
# Windows NSIS installer
npm run build:win

# macOS .dmg
npm run build:mac

# Linux AppImage + .deb
npm run build:linux
```

Output goes to `dist/`.

---

## 4. App Icons

Place your icons in the `assets/` directory:

| File | Platform | Size |
|------|----------|------|
| `icon.png` | Linux + development | 512×512 |
| `icon.ico` | Windows | 256×256 multi-res |
| `icon.icns` | macOS | 512×512 + 1024×1024 |

You can generate all formats from a single 1024×1024 PNG using [electron-icon-builder](https://www.npmjs.com/package/electron-icon-builder):

```bash
npx electron-icon-builder --input=assets/icon-source.png --output=assets/
```

---

## Project Structure

```
neuralgraph/
├── electron/
│   ├── main.js            ← Electron entry point
│   ├── preload.js         ← Secure IPC bridge (contextIsolation)
│   ├── pythonBridge.js    ← Spawns FastAPI, health check, port scan
│   └── tray.js            ← System tray icon + menu
├── frontend/              ← Existing (served by FastAPI, unchanged)
│   ├── index.html         ← + custom titlebar for Electron
│   ├── loading.html       ← Loading screen while Python boots
│   └── ...
├── routes/                ← Existing FastAPI routers (unchanged)
├── utils/                 ← Existing utilities (unchanged)
├── scripts/
│   ├── build-backend.sh   ← PyInstaller build (Unix)
│   ├── build-backend.bat  ← PyInstaller build (Windows)
│   └── server_entry.py    ← PyInstaller entry point
├── assets/                ← App icons (you provide these)
├── package.json
├── electron-builder.yml
├── main.py                ← FastAPI app (unchanged)
└── requirements.txt
```

---

## Architecture

```
┌──────────────────────────────────────────┐
│           ELECTRON (desktop shell)       │
│  ┌────────────────────────────────────┐  │
│  │  Chromium (Three.js + vanilla JS)  │  │
│  └──────────────┬─────────────────────┘  │
│                 │ http://127.0.0.1:PORT  │
│  ┌──────────────▼─────────────────────┐  │
│  │  FastAPI (child process / binary)  │  │
│  └────────────────────────────────────┘  │
│  Electron spawns Python as child process │
│  Everything ships as a single installer  │
└──────────────────────────────────────────┘
```

- **Development:** Electron spawns `python -m uvicorn main:app`
- **Production:** Electron launches the PyInstaller binary from `resources/backend/`
- **Security:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- **Platform:** Frameless window on Windows/Linux, `hiddenInset` titlebar on macOS

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "No free port found" | Kill processes on 8000–8019 or restart |
| "Backend did not respond within 30 s" | Check Python dependencies, run `uvicorn main:app` manually to see errors |
| White flash on startup | Ensure `backgroundColor: '#000000'` is set (already done in main.js) |
| Titlebar not showing | Only appears inside Electron, not in a regular browser |
| PyInstaller missing modules | Add `--hidden-import` for the missing module in build scripts |
