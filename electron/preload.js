// FILE: electron/preload.js
// DOES: Secure IPC bridge between renderer and main process
// USES: electron (contextBridge, ipcRenderer)
// EXPOSES: window.electronAPI

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /* ── Window controls ──────────────────────────────────── */
  minimize:    () => ipcRenderer.invoke('window-minimize'),
  maximize:    () => ipcRenderer.invoke('window-maximize'),
  close:       () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  /* ── Backend port ─────────────────────────────────────── */
  getPort: () => ipcRenderer.invoke('get-port'),

  /* ── External links ───────────────────────────────────── */
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  /* ── Platform identifier ──────────────────────────────── */
  platform: process.platform,

  /* ── Maximize state listener (for titlebar icon toggle) ─ */
  onMaximizeChange: (cb) => {
    ipcRenderer.on('maximize-change', (_event, isMaximized) => cb(isMaximized));
  },
});
