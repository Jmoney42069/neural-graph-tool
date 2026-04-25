/**
 * autosave.js
 * ─────────────────────────────────────────────────────────────────────────
 * Auto-save and UI utility layer for NeuralGraph.
 *
 * Exports
 * ───────
 *   window.NeuralGraphState  — { markDirty, forceSave, clear }
 *   window.NeuralGraphUI     — { showToast }
 *
 * Auto-save behaviour
 * ───────────────────
 *   - Debounces saves: 2 s after last markDirty() call
 *   - Ctrl/Cmd+S forces immediate save
 *   - beforeunload warns if there are unsaved changes
 *   - Status indicator injected into #topbar .topbar-right
 */

(function () {
    "use strict";

    // ─── Styles ────────────────────────────────────────────────────────────
    const CSS = `
        /* ── Toast ── */
        #ng-toast-container {
            position: fixed;
            bottom: 28px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 9999;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            pointer-events: none;
        }
        .ng-toast {
            font-family: 'IBM Plex Mono', monospace;
            font-size: 11px;
            padding: 8px 18px;
            border-radius: 3px;
            border: 1px solid;
            letter-spacing: 0.04em;
            white-space: nowrap;
            pointer-events: none;
            animation: ng-toast-in 0.18s ease;
        }
        .ng-toast-success { background: #071210; border-color: #4ff7a0; color: #4ff7a0; }
        .ng-toast-error   { background: #120709; border-color: #f74f6a; color: #f74f6a; }
        .ng-toast-info    { background: #070c1a; border-color: #4f8ef7; color: #4f8ef7; }
        @keyframes ng-toast-in {
            from { opacity: 0; transform: translateY(6px); }
            to   { opacity: 1; transform: translateY(0);   }
        }

        /* ── Save status ── */
        #ng-save-status {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-family: 'IBM Plex Mono', monospace;
            font-size: 10px;
            letter-spacing: 0.06em;
            padding: 0 10px;
            opacity: 0;
            transition: opacity 0.25s;
            pointer-events: none;
            user-select: none;
        }
        #ng-save-status.ng-ss-visible { opacity: 1; }
        #ng-save-status .ng-ss-dot {
            width: 6px; height: 6px;
            border-radius: 50%;
            flex-shrink: 0;
            transition: background 0.2s;
        }

        #ng-save-status.ng-ss-dirty .ng-ss-dot  { background: #f7a04f; }
        #ng-save-status.ng-ss-dirty .ng-ss-text { color: #f7a04f; }

        #ng-save-status.ng-ss-saving .ng-ss-dot {
            background: #4f8ef7;
            animation: ng-ss-spin 0.75s linear infinite;
        }
        #ng-save-status.ng-ss-saving .ng-ss-text { color: #4f8ef7; }

        #ng-save-status.ng-ss-saved .ng-ss-dot  { background: #4ff7a0; }
        #ng-save-status.ng-ss-saved .ng-ss-text { color: #4ff7a0; }

        #ng-save-status.ng-ss-failed .ng-ss-dot  { background: #f74f6a; }
        #ng-save-status.ng-ss-failed .ng-ss-text { color: #f74f6a; }

        @keyframes ng-ss-spin {
            from { transform: rotate(0deg);   }
            to   { transform: rotate(360deg); }
        }
    `;

    // ─── State ─────────────────────────────────────────────────────────────
    let _dirty        = false;
    let _saving       = false;
    let _saveTimer    = null;
    let _fadeTimer    = null;
    let _statusEl     = null;

    const DEBOUNCE_MS = 2000;

    // ─── Bootstrap ─────────────────────────────────────────────────────────
    function setup() {
        // Inject CSS
        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        // Toast container
        const toastWrap = document.createElement("div");
        toastWrap.id = "ng-toast-container";
        document.body.appendChild(toastWrap);

        // Save-status indicator — inserted before the first button in .topbar-right
        const topbarRight = document.querySelector(".topbar-right");
        if (topbarRight) {
            _statusEl = document.createElement("span");
            _statusEl.id = "ng-save-status";
            _statusEl.innerHTML =
                `<span class="ng-ss-dot"></span><span class="ng-ss-text"></span>`;
            topbarRight.insertBefore(_statusEl, topbarRight.firstChild);
        }

        // Keyboard: Ctrl/Cmd+S → immediate save
        document.addEventListener("keydown", function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                forceSave();
            }
        });

        // Warn before navigating away if unsaved
        window.addEventListener("beforeunload", function (e) {
            if (_dirty) {
                e.preventDefault();
                e.returnValue = "NeuralGraph has unsaved changes.";
                return e.returnValue;
            }
        });
    }

    // ─── Status helpers ────────────────────────────────────────────────────
    function _setState(state, text) {
        if (!_statusEl) return;
        clearTimeout(_fadeTimer);
        _statusEl.className = "ng-ss-visible ng-ss-" + state;
        _statusEl.querySelector(".ng-ss-text").textContent = text;
        if (state === "saved") {
            _fadeTimer = setTimeout(function () {
                _statusEl.classList.remove("ng-ss-visible");
            }, 2200);
        }
    }

    // ─── Public: markDirty ─────────────────────────────────────────────────
    function markDirty() {
        _dirty = true;
        _setState("dirty", "● Unsaved changes");
        clearTimeout(_saveTimer);
        _saveTimer = setTimeout(_performSave, DEBOUNCE_MS);
    }

    // ─── Public: forceSave ─────────────────────────────────────────────────
    function forceSave() {
        clearTimeout(_saveTimer);
        _performSave();
    }

    // ─── Public: clear ─────────────────────────────────────────────────────
    function clear() {
        _dirty = false;
        clearTimeout(_saveTimer);
        if (_statusEl) _statusEl.classList.remove("ng-ss-visible");
    }

    // ─── Internal: save ────────────────────────────────────────────────────
    async function _performSave() {
        if (_saving || !_dirty) return;
        if (!window.NeuralGraph || !window.NeuralGraph.getAllNodes) return;

        _saving = true;
        _setState("saving", "Saving...");

        try {
            const payload = {
                nodes: window.NeuralGraph.getAllNodes(),
                edges: window.NeuralGraph.getAllEdges(),
                meta:  { source_files: [] },
            };
            const resp = await fetch("/graph/save", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify(payload),
            });
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            _dirty = false;
            _setState("saved", "✓ Saved");
        } catch (err) {
            _setState("failed", "✗ Save failed");
            console.error("[NeuralGraph] Auto-save error:", err);
        } finally {
            _saving = false;
        }
    }

    // ─── Public: showToast ─────────────────────────────────────────────────
    function showToast(message, type) {
        const cls = { success: "ng-toast-success", error: "ng-toast-error", info: "ng-toast-info" };
        const container = document.getElementById("ng-toast-container");
        if (!container) return;

        const el = document.createElement("div");
        el.className = "ng-toast " + (cls[type] || "ng-toast-info");
        el.textContent = message;
        container.appendChild(el);

        setTimeout(function () {
            el.style.transition = "opacity 0.3s";
            el.style.opacity    = "0";
            setTimeout(function () { el.remove(); }, 340);
        }, 2600);
    }

    // ─── Exports ───────────────────────────────────────────────────────────
    window.NeuralGraphState = { markDirty, forceSave, clear };
    window.NeuralGraphUI    = { showToast };

    // Init
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", setup);
    } else {
        setup();
    }

})();
