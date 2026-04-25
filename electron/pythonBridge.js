// FILE: electron/pythonBridge.js
// DOES: Spawns & manages the FastAPI Python process (dev: uvicorn, prod: PyInstaller binary)
// USES: child_process, net, http, path, fs, electron.app
// EXPOSES: startBackend(opts), stopBackend(), getPort()

const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const http = require('http');
const fs = require('fs');

let pythonProcess = null;
let currentPort = 8000;

/* ── Port scanner ───────────────────────────────────────── */
function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

async function findFreePort(start = 8000) {
  for (let p = start; p < start + 20; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error('No free port found (8000-8019 all in use)');
}

/* ── Health check poller ────────────────────────────────── */
function waitForHealth(port, timeout = 30000, onTick) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    let ticks = 0;

    const iv = setInterval(() => {
      const elapsed = Date.now() - t0;
      if (elapsed > timeout) {
        clearInterval(iv);
        reject(new Error('Backend did not respond within 30 s'));
        return;
      }

      ticks++;
      if (onTick) onTick(Math.min(ticks / 40, 1));

      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.status === 'ok') {
              clearInterval(iv);
              resolve(port);
            }
          } catch { /* not ready yet */ }
        });
      });
      req.on('error', () => {}); // expected during startup
      req.setTimeout(2000, () => req.destroy());
    }, 500);
  });
}

/* ── Start backend ──────────────────────────────────────── */
async function startBackend(opts = {}) {
  const { onLog, onProgress } = opts;

  const port = await findFreePort();
  currentPort = port;

  const isDev = !require('electron').app.isPackaged;

  let cmd, args, cwd, env;

  if (isDev) {
    /* ── Development: spawn uvicorn from project root ──── */
    const root = path.join(__dirname, '..');

    // Prefer .venv Python, fall back to PATH
    const venvPy = process.platform === 'win32'
      ? path.join(root, '.venv', 'Scripts', 'python.exe')
      : path.join(root, '.venv', 'bin', 'python');

    cmd  = fs.existsSync(venvPy) ? venvPy : 'python';
    args = ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(port)];
    cwd  = root;
    env  = { ...process.env };
  } else {
    /* ── Production: run PyInstaller binary ─────────────── */
    const ext = process.platform === 'win32' ? '.exe' : '';
    cmd  = path.join(process.resourcesPath, 'backend', `neuralgraph-server${ext}`);
    args = [];
    cwd  = path.join(process.resourcesPath, 'backend');
    env  = { ...process.env, NEURALGRAPH_PORT: String(port) };
  }

  if (onLog) onLog(`Spawning: ${cmd} ${args.join(' ')}`);

  pythonProcess = spawn(cmd, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pythonProcess.stdout.on('data', (chunk) => {
    const msg = chunk.toString().trim();
    if (msg && onLog) onLog(msg);
  });

  pythonProcess.stderr.on('data', (chunk) => {
    const msg = chunk.toString().trim();
    if (msg && onLog) onLog(msg);
  });

  pythonProcess.on('error', (err) => {
    if (onLog) onLog(`Process error: ${err.message}`);
  });

  pythonProcess.on('exit', (code) => {
    if (onLog) onLog(`Process exited (code ${code})`);
    pythonProcess = null;
  });

  return waitForHealth(port, 30000, onProgress);
}

/* ── Stop backend ───────────────────────────────────────── */
function stopBackend() {
  if (!pythonProcess) return;
  const pid = pythonProcess.pid;

  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(pid), '/f', '/t']); } catch { /* best-effort */ }
  } else {
    try { pythonProcess.kill('SIGTERM'); } catch { /* best-effort */ }
  }

  pythonProcess = null;
}

function getPort() {
  return currentPort;
}

module.exports = { startBackend, stopBackend, getPort };
