// FILE: electron/tray.js
// DOES: System tray icon with context menu and graph stats
// USES: electron (Tray, Menu, nativeImage, app), http
// EXPOSES: createTray(getWindow), destroyTray()

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const http = require('http');

let tray = null;

function createTray(getWindow) {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');

  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('empty');
    if (process.platform !== 'darwin') icon = icon.resize({ width: 16, height: 16 });
  } catch {
    // Fallback: 16×16 transparent icon (avoids crash if assets/icon.png is missing)
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('NeuralGraph');

  function rebuildMenu(statsLabel) {
    return Menu.buildFromTemplate([
      { label: 'NeuralGraph', enabled: false },
      { type: 'separator' },
      {
        label: 'Open',
        click() {
          const w = getWindow();
          if (w) { w.show(); w.focus(); }
        },
      },
      {
        label: statsLabel || 'Fetching stats…',
        enabled: false,
      },
      { type: 'separator' },
      { label: 'Quit', click() { app.quit(); } },
    ]);
  }

  tray.setContextMenu(rebuildMenu());

  // Double-click → show/focus window
  tray.on('double-click', () => {
    const w = getWindow();
    if (w) { w.show(); w.focus(); }
  });

  // Refresh stats every time the tray menu is opened
  tray.on('right-click', () => {
    fetchStats()
      .then((label) => tray.setContextMenu(rebuildMenu(label)))
      .catch(() => tray.setContextMenu(rebuildMenu('Stats unavailable')));
  });
}

/* ── Fetch node/edge counts from FastAPI ────────────────── */
function fetchStats() {
  const { getPort } = require('./pythonBridge');
  const port = getPort();

  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/graph/load`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const n = (data.nodes || []).length;
          const e = (data.edges || []).length;
          resolve(`${n} nodes \u00b7 ${e} edges`);
        } catch { reject(new Error('parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function destroyTray() {
  if (tray) { tray.destroy(); tray = null; }
}

module.exports = { createTray, destroyTray };
