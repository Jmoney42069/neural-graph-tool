// FILE: electron/main.js
// DOES: Electron entry — frameless window, Python lifecycle, IPC handlers
// USES: electron, ./pythonBridge, ./tray
// EXPOSES: nothing (main process entry point)

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { startBackend, stopBackend, getPort } = require('./pythonBridge');
const { createTray } = require('./tray');

/* ── Single instance lock ───────────────────────────────── */
if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow = null;

// Suppress harmless MaxListenersExceeded during health-check polling
require('events').EventEmitter.defaultMaxListeners = 30;

/* ── Window factory ─────────────────────────────────────── */
function createWindow() {
  const isMac = process.platform === 'darwin';

  const opts = {
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#000000',
    show: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };

  if (isMac) {
    opts.titleBarStyle = 'hiddenInset';
    opts.trafficLightPosition = { x: 12, y: 10 };
  } else {
    opts.frame = false;
  }

  mainWindow = new BrowserWindow(opts);

  // Load loading screen first (local file — no server needed)
  mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'loading.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Relay maximize/unmaximize state to renderer for titlebar icon toggle
  mainWindow.on('maximize',   () => mainWindow.webContents.send('maximize-change', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('maximize-change', false));

  // Security: block new windows, open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Boot Python backend
  bootBackend();
}

/* ── Python boot sequence ───────────────────────────────── */
async function bootBackend() {
  try {
    setLoading('Finding available port…', 10);

    const port = await startBackend({
      onLog(msg) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents
            .executeJavaScript(`console.log('[Python]', ${JSON.stringify(msg)});`)
            .catch(() => {});
        }
      },
      onProgress(fraction) {
        setLoading('Starting engine…', 15 + Math.round(fraction * 75));
      },
    });

    setLoading('Server ready — launching…', 95);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(`http://127.0.0.1:${port}`);
    }
  } catch (err) {
    setLoading(`Failed: ${err.message}`, -1);
  }
}

function setLoading(text, pct) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents
    .executeJavaScript(`if(window.updateLoading)window.updateLoading(${JSON.stringify(text)},${pct});`)
    .catch(() => {});
}

/* ── IPC handlers ───────────────────────────────────────── */
ipcMain.handle('get-port',            () => getPort());
ipcMain.handle('window-minimize',     () => mainWindow?.minimize());
ipcMain.handle('window-maximize',     () => {
  if (mainWindow?.isMaximized()) mainWindow.restore();
  else mainWindow?.maximize();
});
ipcMain.handle('window-close',        () => mainWindow?.close());
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);
ipcMain.handle('open-external', (_, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    return shell.openExternal(url);
  }
});

/* ── App lifecycle ──────────────────────────────────────── */
app.whenReady().then(() => {
  createWindow();
  createTray(() => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  stopBackend();
});
