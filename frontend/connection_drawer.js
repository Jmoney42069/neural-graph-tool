/**
 * connection_drawer.js
 * ─────────────────────────────────────────────────────────────────────────
 * Interactive connection-drawing mode for NeuralGraph.
 *
 * Activated by document event "ng:addConnectionFrom" { nodeId }
 *
 * Flow:
 *   1. Source node glows.
 *   2. A dashed SVG line follows the cursor from source to mouse.
 *   3. Hovering another node snaps the line and highlights the target.
 *   4. Click a target node → relationship-label popup at midpoint.
 *   5. Confirm → POST /graph/edge/add → addEdge in 3D scene.
 *   6. ESC or right-click → cancel.
 */

(function () {
    "use strict";

    // ─── CSS ───────────────────────────────────────────────────────────────
    const CSS = `
        #ng-cd-banner {
            position: absolute;
            top: 0; left: 0; right: 0;
            z-index: 700;
            padding: 9px 16px;
            background: #1a1408;
            border-bottom: 1px solid #3a2e10;
            font-family: 'IBM Plex Mono', monospace;
            font-size: 11px;
            color: #f7a04f;
            letter-spacing: 0.06em;
            display: none;
            align-items: center;
            gap: 14px;
            pointer-events: none;
            user-select: none;
        }
        #ng-cd-banner.active { display: flex; }
        #ng-cd-banner .ng-cd-esc {
            margin-left: auto;
            padding: 3px 8px;
            border: 1px solid #3a2e10;
            border-radius: 2px;
            font-size: 10px;
            pointer-events: all;
            cursor: pointer;
            transition: border-color 0.1s;
        }
        #ng-cd-banner .ng-cd-esc:hover { border-color: #f7a04f; }

        #ng-cd-svg {
            position: absolute;
            inset: 0;
            pointer-events: none;
            z-index: 600;
            display: none;
        }
        #ng-cd-svg.active { display: block; }

        /* Relationship popup */
        #ng-cd-popup {
            position: fixed;
            background: #0d0d18;
            border: 1px solid #1e1e2e;
            border-radius: 4px;
            padding: 14px 16px;
            width: 300px;
            z-index: 8300;
            font-family: 'IBM Plex Mono', monospace;
            box-shadow: 0 10px 36px rgba(0,0,0,0.65);
            display: none;
        }
        #ng-cd-popup.active { display: block; }
        #ng-cd-popup .ng-cd-pop-label {
            font-size: 10px; color: #4a4a6a;
            letter-spacing: 0.1em; text-transform: uppercase;
            margin-bottom: 8px;
        }
        #ng-cd-popup .ng-cd-pop-nodes {
            font-size: 11px; color: #8080a0;
            margin-bottom: 10px;
            display: flex; align-items: center; gap: 6px;
        }
        #ng-cd-popup .ng-cd-pop-arrow { color: #4f8ef7; }
        #ng-cd-rel-input {
            width: 100%; box-sizing: border-box;
            background: #111122; border: 1px solid #1e1e2e;
            color: #e2e2f0; font-family: 'IBM Plex Mono', monospace;
            font-size: 12px; padding: 8px 10px; border-radius: 2px;
            outline: none; margin-bottom: 10px;
            transition: border-color 0.15s;
        }
        #ng-cd-rel-input:focus { border-color: #4f8ef7; }
        #ng-cd-rel-input::placeholder { color: #2a2a4a; }
        #ng-cd-popup .ng-cd-pop-btns {
            display: flex; gap: 8px; justify-content: flex-end;
        }
        .ng-cd-pop-btn {
            padding: 7px 14px; border: 1px solid #1e1e2e;
            background: transparent; font-family: 'IBM Plex Mono', monospace;
            font-size: 11px; cursor: pointer; border-radius: 2px;
            transition: background 0.1s, color 0.1s;
        }
        .ng-cd-pop-btn-cancel { color: #5a5a7a; }
        .ng-cd-pop-btn-cancel:hover { color: #e2e2f0; background: #141428; }
        .ng-cd-pop-btn-confirm {
            background: #0e1f40; border-color: #4f8ef7;
            color: #4f8ef7; font-weight: 500;
        }
        .ng-cd-pop-btn-confirm:hover { background: #142a55; }
        .ng-cd-pop-btn-confirm:disabled { opacity: 0.4; cursor: not-allowed; }
    `;

    // ─── State ─────────────────────────────────────────────────────────────
    let _active         = false;
    let _sourceId       = null;
    let _hoveredTarget  = null;
    let _canvas         = null;
    let _banner         = null;
    let _svg            = null;
    let _dashLine       = null;
    let _popup          = null;
    let _rafId          = null;

    // Mouse position (window coords)
    let _mx = 0;
    let _my = 0;

    // ─── Listeners (kept so we can remove them on cancel) ─────────────────
    let _onMouseMove = null;
    let _onClick     = null;
    let _onKeyDown   = null;
    let _onCtxMenu   = null;

    // ─── Init ──────────────────────────────────────────────────────────────
    function setup() {
        // Inject CSS
        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        _canvas = document.getElementById("graph-canvas");
        if (!_canvas) return;

        // Banner (overlay inside canvas element)
        _banner = document.createElement("div");
        _banner.id = "ng-cd-banner";
        _banner.innerHTML = `
            <span>⬦ CONNECTION MODE</span>
            <span style="opacity:0.6">— click a node to connect to →</span>
            <span class="ng-cd-esc">ESC to cancel</span>`;
        _canvas.appendChild(_banner);
        _banner.querySelector(".ng-cd-esc").addEventListener("click", _cancel);

        // SVG overlay (inside canvas, pointer-events: none normally)
        _svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        _svg.id = "ng-cd-svg";
        _canvas.appendChild(_svg);

        // Dashed line element
        _dashLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        _dashLine.setAttribute("stroke",            "#f7a04f");
        _dashLine.setAttribute("stroke-width",      "1.5");
        _dashLine.setAttribute("stroke-dasharray",  "6 4");
        _dashLine.setAttribute("stroke-linecap",    "round");
        _dashLine.setAttribute("opacity",           "0.75");
        _svg.appendChild(_dashLine);

        // Relationship popup
        _popup = document.createElement("div");
        _popup.id = "ng-cd-popup";
        _popup.innerHTML = `
            <div class="ng-cd-pop-label">Relationship label</div>
            <div class="ng-cd-pop-nodes" id="ng-cd-pop-nodes"></div>
            <input id="ng-cd-rel-input" placeholder="e.g. levert, is onderdeel van" autocomplete="off" />
            <div class="ng-cd-pop-btns">
                <button class="ng-cd-pop-btn ng-cd-pop-btn-cancel" id="ng-cd-pop-cancel">CANCEL</button>
                <button class="ng-cd-pop-btn ng-cd-pop-btn-confirm" id="ng-cd-pop-confirm">CONFIRM</button>
            </div>`;
        document.body.appendChild(_popup);

        // Listen for activation event
        document.addEventListener("ng:addConnectionFrom", function (e) {
            _begin(e.detail.nodeId);
        });
    }

    // ─── Begin connection mode ─────────────────────────────────────────────
    function _begin(sourceId) {
        if (_active) _cancel();
        _active    = true;
        _sourceId  = sourceId;
        _hoveredTarget = null;

        // Show UI
        _banner.classList.add("active");
        _svg.classList.add("active");

        // Flash source node
        if (window.NeuralGraph && window.NeuralGraph.highlightNode)
            window.NeuralGraph.highlightNode(sourceId);

        // Mouse tracker
        _onMouseMove = function (e) {
            _mx = e.clientX;
            _my = e.clientY;
        };

        // Intercept clicks in capturing phase so NeuralGraph's click handler doesn't run
        _onClick = function (e) {
            if (!_active) return;
            e.stopImmediatePropagation();
            e.preventDefault();
            const hit = _getNodeAt(e.clientX, e.clientY);
            if (!hit || hit.id === _sourceId) return;
            _showPopup(hit, e.clientX, e.clientY);
        };

        // Escape or right-click cancels
        _onKeyDown = function (e) { if (e.key === "Escape") _cancel(); };
        _onCtxMenu = function (e) {
            if (!_active) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            _cancel();
        };

        _canvas.addEventListener("mousemove", _onMouseMove);
        _canvas.addEventListener("click",       _onClick,  true);  // capture
        document.addEventListener("keydown",    _onKeyDown);
        _canvas.addEventListener("contextmenu", _onCtxMenu, true);

        // Animation loop for the SVG line
        _rafId = requestAnimationFrame(_drawLine);
    }

    // ─── Draw the dashed line each frame ──────────────────────────────────
    function _drawLine() {
        if (!_active) return;
        _rafId = requestAnimationFrame(_drawLine);

        const src = _sourceScreenPos();
        if (!src) return;

        // Check hover
        const rect    = _canvas.getBoundingClientRect();
        const cx      = _mx;
        const cy      = _my;
        const hitNode = _getNodeAt(cx, cy);

        let tx = cx - rect.left;
        let ty = cy - rect.top;

        if (hitNode && hitNode.id !== _sourceId) {
            _hoveredTarget = hitNode;
            const sp = _nodeScreenCoords(hitNode.id);
            if (sp) { tx = sp.x; ty = sp.y; }
        } else {
            _hoveredTarget = null;
        }

        _dashLine.setAttribute("x1", src.x);
        _dashLine.setAttribute("y1", src.y);
        _dashLine.setAttribute("x2", tx);
        _dashLine.setAttribute("y2", ty);
        _dashLine.setAttribute("stroke", _hoveredTarget ? "#4ff7a0" : "#f7a04f");
    }

    // ─── Show relationship label popup ────────────────────────────────────
    function _showPopup(targetNode, clickX, clickY) {
        // Position popup at midpoint between screen click and edge of canvas
        const src = _sourceScreenPos();
        const tgt = _nodeScreenCoords(targetNode.id);
        const rect = _canvas.getBoundingClientRect();

        let px = clickX + 16;
        let py = clickY + 16;
        if (src && tgt) {
            px = rect.left + (src.x + tgt.x) / 2 + 8;
            py = rect.top  + (src.y + tgt.y) / 2 + 8;
        }

        // Adjust to stay within viewport
        if (px + 320 > window.innerWidth  - 8) px = window.innerWidth  - 328;
        if (py + 140 > window.innerHeight - 8) py = window.innerHeight - 148;

        _popup.style.left = px + "px";
        _popup.style.top  = py + "px";

        // Source / target names
        const srcNode = _getAllNodes().find(function (n) { return n.id === _sourceId; });
        const srcLabel = srcNode ? srcNode.label : _sourceId;
        _popup.querySelector("#ng-cd-pop-nodes").innerHTML =
            `<span>${_esc(srcLabel)}</span>
             <span class="ng-cd-pop-arrow">→</span>
             <span>${_esc(targetNode.label)}</span>`;

        const relInput = _popup.querySelector("#ng-cd-rel-input");
        relInput.value = "";
        _popup.classList.add("active");
        relInput.focus();

        // Confirm button
        const confirmBtn = _popup.querySelector("#ng-cd-pop-confirm");
        confirmBtn.disabled = false;

        const doConfirm = async function () {
            const label = relInput.value.trim();
            confirmBtn.disabled = true;
            await _confirm(targetNode.id, label);
        };

        // Replace old listeners cleanly
        const newConfirm = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
        newConfirm.addEventListener("click", doConfirm);

        const cancelBtn = _popup.querySelector("#ng-cd-pop-cancel");
        const newCancel = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
        newCancel.addEventListener("click", function () {
            _popup.classList.remove("active");
        });

        relInput.addEventListener("keydown", function (e) {
            if (e.key === "Enter") doConfirm();
            if (e.key === "Escape") {
                e.stopPropagation();
                _popup.classList.remove("active");
            }
        });
    }

    // ─── Confirm connection ────────────────────────────────────────────────
    async function _confirm(targetId, label) {
        _popup.classList.remove("active");

        try {
            const r = await fetch("/graph/edge/add", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ from_id: _sourceId, to_id: targetId, label }),
            });
            if (!r.ok) {
                const err = await r.json().catch(function () { return {}; });
                throw new Error(err.detail || "HTTP " + r.status);
            }

            if (window.NeuralGraph && window.NeuralGraph.addEdge)
                window.NeuralGraph.addEdge({ from: _sourceId, to: targetId, label });

            if (window.NeuralGraphState) window.NeuralGraphState.markDirty();
            _toast("Connection created", "success");
        } catch (err) {
            _toast("Failed: " + err.message, "error");
        } finally {
            _cancel();
        }
    }

    // ─── Cancel ────────────────────────────────────────────────────────────
    function _cancel() {
        if (!_active) return;
        _active        = false;
        _sourceId      = null;
        _hoveredTarget = null;

        cancelAnimationFrame(_rafId);
        _rafId = null;

        _banner.classList.remove("active");
        _svg.classList.remove("active");
        _popup.classList.remove("active");

        // Clear dashed line
        _dashLine.setAttribute("x1", "0"); _dashLine.setAttribute("y1", "0");
        _dashLine.setAttribute("x2", "0"); _dashLine.setAttribute("y2", "0");

        // Remove transient listeners
        if (_onMouseMove) _canvas.removeEventListener("mousemove",   _onMouseMove);
        if (_onClick)     _canvas.removeEventListener("click",       _onClick, true);
        if (_onKeyDown)   document.removeEventListener("keydown",    _onKeyDown);
        if (_onCtxMenu)   _canvas.removeEventListener("contextmenu", _onCtxMenu, true);

        _onMouseMove = null;
        _onClick     = null;
        _onKeyDown   = null;
        _onCtxMenu   = null;
    }

    // ─── Helpers ───────────────────────────────────────────────────────────
    /** Source node position in canvas-local px. */
    function _sourceScreenPos() {
        if (!_sourceId || !_canvas) return null;
        const sp = _nodeScreenCoords(_sourceId);
        return sp;
    }

    /** Screen position of a node in canvas-local px (SVG coordinate space). */
    function _nodeScreenCoords(id) {
        if (!window.NeuralGraph || !window.NeuralGraph.getNodeScreenPos) return null;
        const sp = window.NeuralGraph.getNodeScreenPos(id);
        if (!sp) return null;
        // getNodeScreenPos returns coords relative to the canvas element's top-left
        return { x: sp.x, y: sp.y };
    }

    function _getNodeAt(cx, cy) {
        if (!window.NeuralGraph || !window.NeuralGraph.getNodeAtScreen) return null;
        return window.NeuralGraph.getNodeAtScreen(cx, cy);
    }

    function _getAllNodes() {
        if (!window.NeuralGraph || !window.NeuralGraph.getAllNodes) return [];
        return window.NeuralGraph.getAllNodes();
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
