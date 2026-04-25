/**
 * graph_context_menu.js
 * ─────────────────────────────────────────────────────────────────────────
 * Right-click context menus for the NeuralGraph 3D canvas.
 *
 * Right-click on a NODE  → node context menu
 * Right-click on an EDGE → edge mini-menu
 * Right-click on empty   → canvas context menu
 * Double-click on a node → opens node editor
 *
 * Custom events dispatched on `document`:
 *   ng:editNode         { nodeId }
 *   ng:addConnectionFrom{ nodeId }
 *   ng:addRelatedNode   { parentNodeId, parentLabel }
 *   ng:openAddNode      {}
 */

(function () {
    "use strict";

    // ─── CSS ───────────────────────────────────────────────────────────────
    const CSS = `
        #ng-cm {
            position: fixed;
            background: #0d0d18;
            border: 1px solid #1e1e2e;
            border-radius: 4px;
            padding: 4px 0;
            min-width: 186px;
            z-index: 8000;
            box-shadow: 0 12px 40px rgba(0,0,0,0.7);
            font-family: 'IBM Plex Mono', monospace;
            font-size: 12px;
            user-select: none;
            outline: none;
        }
        .ng-cm-item {
            display: flex;
            align-items: center;
            gap: 9px;
            padding: 8px 16px;
            color: #c8c8e0;
            cursor: pointer;
            border-left: 2px solid transparent;
            transition: background 0.08s, border-color 0.08s;
            white-space: nowrap;
        }
        .ng-cm-item:hover {
            background: #141428;
            border-left-color: #4f8ef7;
            color: #e2e2f0;
        }
        .ng-cm-item.ng-cm-danger { color: #f74f6a; }
        .ng-cm-item.ng-cm-danger:hover { border-left-color: #f74f6a; background: #180a0f; }
        .ng-cm-icon { font-size: 13px; width: 15px; text-align: center; flex-shrink: 0; }
        .ng-cm-sep  { border: none; border-top: 1px solid #1e1e2e; margin: 4px 0; }

        /* Confirm dialog */
        #ng-confirm-backdrop {
            position: fixed;
            inset: 0;
            background: rgba(9,9,15,0.72);
            z-index: 9200;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        #ng-confirm-box {
            background: #0d0d18;
            border: 1px solid #1e1e2e;
            border-radius: 4px;
            padding: 26px 28px 22px;
            min-width: 320px;
            max-width: 420px;
            font-family: 'IBM Plex Mono', monospace;
        }
        #ng-confirm-box .ng-cb-title {
            font-size: 11px;
            font-weight: 600;
            color: #e2e2f0;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            margin-bottom: 10px;
        }
        #ng-confirm-box .ng-cb-msg {
            font-size: 11px;
            color: #5a5a7a;
            line-height: 1.65;
            margin-bottom: 22px;
        }
        #ng-confirm-box .ng-cb-btns {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
        }
        .ng-cb-btn {
            padding: 7px 16px;
            border: 1px solid #1e1e2e;
            background: transparent;
            font-family: 'IBM Plex Mono', monospace;
            font-size: 11px;
            cursor: pointer;
            border-radius: 2px;
            letter-spacing: 0.04em;
            transition: background 0.1s;
        }
        .ng-cb-btn-cancel { color: #6b6b8a; }
        .ng-cb-btn-cancel:hover { color: #e2e2f0; background: #141428; }
        .ng-cb-btn-danger  { background: #1a060c; border-color: #f74f6a; color: #f74f6a; }
        .ng-cb-btn-danger:hover  { background: #280810; }
    `;

    // ─── State ─────────────────────────────────────────────────────────────
    let _menu     = null;
    let _downX    = 0;
    let _downY    = 0;

    // ─── Init ──────────────────────────────────────────────────────────────
    function setup() {
        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        _menu = document.createElement("div");
        _menu.id = "ng-cm";
        _menu.setAttribute("tabindex", "-1");
        _menu.style.display = "none";
        document.body.appendChild(_menu);

        const canvas = document.getElementById("graph-canvas");
        if (!canvas) return;

        // Track mousedown position to distinguish right-click from right-drag
        canvas.addEventListener("mousedown", function (e) {
            if (e.button === 2) { _downX = e.clientX; _downY = e.clientY; }
        });

        // Context menu: fires after mousedown+mouseup on right button
        canvas.addEventListener("contextmenu", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const dx = Math.abs(e.clientX - _downX);
            const dy = Math.abs(e.clientY - _downY);
            // Suppress menu if the user right-dragged (panned)
            if (dx > 5 || dy > 5) return;
            _onContextMenu(e);
        });

        // Double-click → edit node
        canvas.addEventListener("dblclick", function (e) {
            const hit = _getNode(e.clientX, e.clientY);
            if (!hit) return;
            e.stopImmediatePropagation();
            _hide();
            _dispatch("ng:editNode", { nodeId: hit.id });
        });

        // Dismiss on outside click or Escape
        document.addEventListener("click",   _hide);
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") _hide(); });
        document.addEventListener("scroll",  _hide, true);
    }

    // ─── Context-menu handler ──────────────────────────────────────────────
    function _onContextMenu(e) {
        _hide();

        const hitNode = _getNode(e.clientX, e.clientY);
        if (hitNode) { _showNodeMenu(e, hitNode); return; }

        const hitEdge = _getEdge(e.clientX, e.clientY);
        if (hitEdge) { _showEdgeMenu(e, hitEdge); return; }

        _showCanvasMenu(e);
    }

    // ─── Menus ─────────────────────────────────────────────────────────────
    function _showNodeMenu(e, node) {
        _menu.innerHTML =
            _item("✏", "Edit Node",         "ng-cm-edit")   +
            _item("＋", "Add Connection",    "ng-cm-conn")   +
            _item("⬡", "Add Related Node",  "ng-cm-related")+
            "<hr class='ng-cm-sep'/>"                        +
            _item("◎", "Focus View",        "ng-cm-focus")  +
            "<hr class='ng-cm-sep'/>"                        +
            _item("⊘", "Delete Node",       "ng-cm-del ng-cm-danger");

        _on("ng-cm-edit",    function () { _dispatch("ng:editNode",
            { nodeId: node.id }); });
        _on("ng-cm-conn",    function () { _dispatch("ng:addConnectionFrom",
            { nodeId: node.id }); });
        _on("ng-cm-related", function () { _dispatch("ng:addRelatedNode",
            { parentNodeId: node.id, parentLabel: node.label }); });
        _on("ng-cm-focus",   function () {
            if (window.NeuralGraph && window.NeuralGraph.focusNode)
                window.NeuralGraph.focusNode(node.id);
        });
        _on("ng-cm-del", function () {
            _confirm(
                "DELETE NODE",
                `Remove "${_esc(node.label)}" and all its connections? This cannot be undone.`,
                function () { _deleteNode(node.id, node.label); }
            );
        });

        _position(e);
    }

    function _showEdgeMenu(e, edge) {
        _menu.innerHTML =
            _item("✎", "Edit Label",  "ng-cm-edge-label")  +
            "<hr class='ng-cm-sep'/>"+
            _item("⊘", "Delete Edge", "ng-cm-edge-del ng-cm-danger");

        _on("ng-cm-edge-label", function () {
            _hide();
            _promptEdgeLabel(edge);
        });
        _on("ng-cm-edge-del", function () {
            _deleteEdge(edge.from, edge.to);
        });

        _position(e);
    }

    function _showCanvasMenu(e) {
        _menu.innerHTML =
            _item("＋", "Add New Node",  "ng-cm-add-node")      +
            "<hr class='ng-cm-sep'/>"                            +
            _item("⟳", "Reset Layout",  "ng-cm-reset-layout")  +
            _item("⤡", "Fit All Nodes", "ng-cm-fit")           +
            "<hr class='ng-cm-sep'/>"                            +
            _item("✕", "Clear Graph",   "ng-cm-clear ng-cm-danger");

        _on("ng-cm-add-node",     function () { _dispatch("ng:openAddNode", {}); });
        _on("ng-cm-reset-layout", function () {
            if (window.NeuralGraph && window.NeuralGraph.resetPhysics)
                window.NeuralGraph.resetPhysics();
        });
        _on("ng-cm-fit", function () {
            if (window.NeuralGraph && window.NeuralGraph.fitAll)
                window.NeuralGraph.fitAll();
        });
        _on("ng-cm-clear", function () {
            _confirm(
                "CLEAR GRAPH",
                "This will permanently erase all nodes, edges, and uploaded data. Are you sure?",
                _clearGraph
            );
        });

        _position(e);
    }

    // ─── Actions ───────────────────────────────────────────────────────────
    async function _deleteNode(nodeId, label) {
        try {
            const r = await fetch(`/graph/node/${encodeURIComponent(nodeId)}`, { method: "DELETE" });
            if (!r.ok) throw new Error("HTTP " + r.status);
            if (window.NeuralGraph && window.NeuralGraph.removeNode)
                window.NeuralGraph.removeNode(nodeId);
            if (window.NeuralGraphState) window.NeuralGraphState.markDirty();
            _toast(`"${label}" deleted`, "success");
        } catch (err) { _toast("Delete failed: " + err.message, "error"); }
    }

    async function _deleteEdge(fromId, toId) {
        try {
            const url = `/graph/edge?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`;
            const r   = await fetch(url, { method: "DELETE" });
            if (!r.ok) throw new Error("HTTP " + r.status);
            if (window.NeuralGraph && window.NeuralGraph.removeEdge)
                window.NeuralGraph.removeEdge(fromId, toId);
            if (window.NeuralGraphState) window.NeuralGraphState.markDirty();
            _toast("Edge removed", "success");
        } catch (err) { _toast("Delete failed: " + err.message, "error"); }
    }

    function _promptEdgeLabel(edge) {
        const label = window.prompt("Edge relationship label:", edge.label || "");
        if (label === null) return;
        if (window.NeuralGraph && window.NeuralGraph.updateEdgeLabel)
            window.NeuralGraph.updateEdgeLabel(edge.from, edge.to, label.trim());
        if (window.NeuralGraphState) window.NeuralGraphState.markDirty();
        _toast("Label updated", "success");
    }

    async function _clearGraph() {
        try {
            const r = await fetch("/graph/reset", { method: "DELETE" });
            if (!r.ok) throw new Error("HTTP " + r.status);
            if (window.NeuralGraph && window.NeuralGraph.loadData)
                window.NeuralGraph.loadData([], []);
            if (window.NeuralGraphState) window.NeuralGraphState.clear();
            _toast("Graph cleared", "info");
        } catch (err) { _toast("Clear failed: " + err.message, "error"); }
    }

    // ─── Utilities ─────────────────────────────────────────────────────────
    function _getNode(cx, cy) {
        if (!window.NeuralGraph || !window.NeuralGraph.getNodeAtScreen) return null;
        return window.NeuralGraph.getNodeAtScreen(cx, cy);
    }

    function _getEdge(cx, cy) {
        if (!window.NeuralGraph || !window.NeuralGraph.getEdgeAtScreen) return null;
        return window.NeuralGraph.getEdgeAtScreen(cx, cy, 8);
    }

    function _dispatch(name, detail) {
        _hide();
        document.dispatchEvent(new CustomEvent(name, { detail: detail }));
    }

    function _item(icon, label, classes) {
        return `<div class="ng-cm-item ${classes}">
            <span class="ng-cm-icon">${icon}</span>
            <span>${label}</span>
        </div>`;
    }

    function _on(cls, fn) {
        const el = _menu.querySelector("." + cls.split(" ")[0]);
        if (el) el.addEventListener("click", function (e) { e.stopPropagation(); fn(); _hide(); });
    }

    function _position(e) {
        _menu.style.display = "block";
        _menu.style.opacity = "0";
        const mw = _menu.offsetWidth  || 200;
        const mh = _menu.offsetHeight || 200;
        let x = e.clientX;
        let y = e.clientY;
        if (x + mw > window.innerWidth  - 8) x = window.innerWidth  - mw - 8;
        if (y + mh > window.innerHeight - 8) y = window.innerHeight - mh - 8;
        _menu.style.left    = x + "px";
        _menu.style.top     = y + "px";
        _menu.style.opacity = "1";
        _menu.focus();
    }

    function _hide() {
        if (_menu) _menu.style.display = "none";
    }

    function _confirm(title, msg, onYes) {
        const bd = document.createElement("div");
        bd.id = "ng-confirm-backdrop";
        bd.innerHTML = `
            <div id="ng-confirm-box">
                <div class="ng-cb-title">${_esc(title)}</div>
                <div class="ng-cb-msg">${_esc(msg)}</div>
                <div class="ng-cb-btns">
                    <button class="ng-cb-btn ng-cb-btn-cancel">Cancel</button>
                    <button class="ng-cb-btn ng-cb-btn-danger">Confirm</button>
                </div>
            </div>`;
        document.body.appendChild(bd);

        bd.querySelector(".ng-cb-btn-cancel").onclick  = function () { bd.remove(); };
        bd.querySelector(".ng-cb-btn-danger").onclick  = function () { bd.remove(); onYes(); };
        bd.addEventListener("click", function (e) { if (e.target === bd) bd.remove(); });
        document.addEventListener("keydown", function esc(e) {
            if (e.key === "Escape") { bd.remove(); document.removeEventListener("keydown", esc); }
        });
    }

    function _esc(s) {
        return String(s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function _toast(msg, type) {
        if (window.NeuralGraphUI && window.NeuralGraphUI.showToast)
            window.NeuralGraphUI.showToast(msg, type);
    }

    // Boot
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", setup);
    } else {
        setup();
    }

})();
