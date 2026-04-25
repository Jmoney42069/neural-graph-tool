/**
 * node_editor.js
 * ─────────────────────────────────────────────────────────────────────────
 * Modal editor for existing graph nodes.
 *
 * Opens on:
 *   - document event "ng:editNode"  { nodeId }
 *   - Double-click on a node (handled by graph_context_menu.js)
 *
 * Features:
 *   - Live label preview in the 3D scene while typing
 *   - Coloured category select with dot indicator
 *   - Description textarea with char counter
 *   - Connection list with per-edge delete and inline add-connection search
 *   - PATCH /graph/node/{id} on save
 *   - Input history cycle (Up/Down arrows)
 */

(function () {
    "use strict";

    // ─── Category palette (mirrors neuralGraph3D.js CAT_COLOR) ────────────
    const CAT_COLORS = {
        product:    "#4f8ef7",
        customer:   "#b44ff7",
        process:    "#f7a04f",
        compliance: "#f74f6a",
        finance:    "#4ff7a0",
        person:     "#f7f74f",
        system:     "#4ff7e0",
        location:   "#f7a0d0",
        concept:    "#9090b0",
    };
    const CATEGORIES = Object.keys(CAT_COLORS);

    // ─── CSS ───────────────────────────────────────────────────────────────
    const CSS = `
        #ng-ne-backdrop {
            position: fixed; inset: 0;
            background: rgba(9,9,15,0.75);
            z-index: 8500;
            display: flex; align-items: center; justify-content: center;
        }
        #ng-ne-modal {
            background: #0d0d18;
            border: 1px solid #1e1e2e;
            border-radius: 4px;
            width: 480px;
            max-width: calc(100vw - 32px);
            max-height: calc(100vh - 48px);
            display: flex; flex-direction: column;
            font-family: 'IBM Plex Mono', monospace;
            box-shadow: 0 20px 60px rgba(0,0,0,0.8);
        }
        .ng-ne-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 16px 20px 14px;
            border-bottom: 1px solid #1e1e2e;
            flex-shrink: 0;
        }
        .ng-ne-title {
            font-size: 11px; font-weight: 600;
            color: #e2e2f0; letter-spacing: 0.12em; text-transform: uppercase;
        }
        .ng-ne-node-id {
            font-size: 10px; color: #3a3a5a;
            letter-spacing: 0.06em; margin-top: 2px;
        }
        .ng-ne-close {
            width: 26px; height: 26px;
            background: transparent; border: 1px solid #1e1e2e;
            border-radius: 2px; cursor: pointer;
            color: #4a4a6a; font-size: 16px; line-height: 1;
            display: flex; align-items: center; justify-content: center;
            transition: color 0.1s, border-color 0.1s;
        }
        .ng-ne-close:hover { color: #e2e2f0; border-color: #3a3a5a; }

        .ng-ne-body {
            padding: 18px 20px;
            overflow-y: auto;
            flex: 1;
            display: flex; flex-direction: column; gap: 16px;
        }

        .ng-ne-field { display: flex; flex-direction: column; gap: 6px; }
        .ng-ne-label {
            font-size: 10px; color: #4a4a6a;
            letter-spacing: 0.1em; text-transform: uppercase;
        }
        .ng-ne-label-row {
            display: flex; justify-content: space-between; align-items: baseline;
        }
        .ng-ne-counter { font-size: 10px; color: #3a3a5a; }
        .ng-ne-counter.near-limit { color: #f7a04f; }

        .ng-ne-input, .ng-ne-textarea {
            background: #111122; border: 1px solid #1e1e2e;
            color: #e2e2f0; font-family: 'IBM Plex Mono', monospace;
            font-size: 12px; border-radius: 2px;
            padding: 8px 10px; outline: none;
            transition: border-color 0.15s;
        }
        .ng-ne-input:focus, .ng-ne-textarea:focus { border-color: #4f8ef7; }
        .ng-ne-input::placeholder, .ng-ne-textarea::placeholder { color: #2a2a4a; }
        .ng-ne-textarea { resize: vertical; min-height: 64px; line-height: 1.5; }

        /* Category select */
        .ng-ne-cat-row {
            display: flex; align-items: center; gap: 10px;
        }
        .ng-ne-cat-dot {
            width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
            transition: background 0.2s;
        }
        .ng-ne-cat-select {
            flex: 1;
            background: #111122; border: 1px solid #1e1e2e;
            color: #e2e2f0; font-family: 'IBM Plex Mono', monospace;
            font-size: 12px; border-radius: 2px;
            padding: 8px 10px; outline: none; cursor: pointer;
            transition: border-color 0.15s;
        }
        .ng-ne-cat-select:focus { border-color: #4f8ef7; }

        /* Connections */
        .ng-ne-section-title {
            font-size: 10px; color: #3a3a5a;
            letter-spacing: 0.1em; text-transform: uppercase;
            margin-bottom: 4px;
        }
        .ng-ne-conn-list { display: flex; flex-direction: column; gap: 4px; }
        .ng-ne-conn-item {
            display: flex; align-items: center; gap: 8px;
            padding: 6px 8px;
            background: #111122; border: 1px solid #1e1e2e;
            border-radius: 2px; font-size: 11px; color: #8080a0;
        }
        .ng-ne-conn-item .ng-ne-conn-node { color: #c8c8e0; flex: 1; }
        .ng-ne-conn-del {
            background: transparent; border: none;
            color: #3a3a5a; cursor: pointer; font-size: 14px; line-height: 1;
            padding: 0 2px; transition: color 0.1s;
        }
        .ng-ne-conn-del:hover { color: #f74f6a; }

        /* Inline add-connection */
        .ng-ne-add-conn-btn {
            background: transparent; border: 1px dashed #1e1e2e;
            color: #4a4a6a; font-family: 'IBM Plex Mono', monospace;
            font-size: 11px; padding: 6px 10px; border-radius: 2px;
            cursor: pointer; text-align: left; width: 100%;
            transition: border-color 0.1s, color 0.1s;
        }
        .ng-ne-add-conn-btn:hover { border-color: #4f8ef7; color: #4f8ef7; }

        .ng-ne-conn-search-wrap {
            position: relative; margin-top: 4px;
        }
        .ng-ne-conn-search {
            width: 100%; box-sizing: border-box;
            background: #111122; border: 1px solid #4f8ef7;
            color: #e2e2f0; font-family: 'IBM Plex Mono', monospace;
            font-size: 11px; padding: 7px 10px; border-radius: 2px;
            outline: none;
        }
        .ng-ne-conn-rel-input {
            width: 100%; box-sizing: border-box;
            background: #111122; border: 1px solid #1e1e2e;
            color: #e2e2f0; font-family: 'IBM Plex Mono', monospace;
            font-size: 11px; padding: 7px 10px; border-radius: 2px;
            outline: none; margin-top: 4px;
            transition: border-color 0.15s;
        }
        .ng-ne-conn-rel-input:focus { border-color: #4f8ef7; }
        .ng-ne-conn-dropdown {
            position: absolute; top: 100%; left: 0; right: 0;
            background: #0d0d18; border: 1px solid #1e1e2e;
            border-top: none; border-radius: 0 0 2px 2px;
            max-height: 140px; overflow-y: auto; z-index: 100;
        }
        .ng-ne-conn-opt {
            padding: 7px 10px; font-size: 11px; cursor: pointer;
            color: #c8c8e0; transition: background 0.08s;
            display: flex; align-items: center; gap: 8px;
        }
        .ng-ne-conn-opt:hover { background: #141428; }
        .ng-ne-conn-opt-dot {
            width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
        }

        /* Footer */
        .ng-ne-footer {
            display: flex; justify-content: flex-end; gap: 8px;
            padding: 14px 20px 16px;
            border-top: 1px solid #1e1e2e;
            flex-shrink: 0;
        }
        .ng-ne-btn {
            padding: 8px 18px; border: 1px solid #1e1e2e;
            background: transparent; font-family: 'IBM Plex Mono', monospace;
            font-size: 11px; letter-spacing: 0.05em; cursor: pointer;
            border-radius: 2px; transition: background 0.1s, color 0.1s, border-color 0.1s;
        }
        .ng-ne-btn-cancel { color: #5a5a7a; }
        .ng-ne-btn-cancel:hover { color: #e2e2f0; background: #141428; }
        .ng-ne-btn-save {
            background: #0e1f40; border-color: #4f8ef7; color: #4f8ef7;
            font-weight: 500;
        }
        .ng-ne-btn-save:hover { background: #142a55; }
        .ng-ne-btn-save:disabled { opacity: 0.45; cursor: not-allowed; }
    `;

    // ─── Pending edits (connections to add/remove) ─────────────────────────
    let _backdrop = null;
    let _currentNodeId = null;
    let _pendingConnDel = [];   // [{from, to}]
    let _pendingConnAdd = [];   // [{from, to, label}]

    // ─── Init ──────────────────────────────────────────────────────────────
    function setup() {
        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        document.addEventListener("ng:editNode", function (e) {
            openEditor(e.detail.nodeId);
        });
    }

    // ─── Open ──────────────────────────────────────────────────────────────
    function openEditor(nodeId) {
        if (_backdrop) _backdrop.remove();

        const allNodes = window.NeuralGraph ? window.NeuralGraph.getAllNodes() : [];
        const allEdges = window.NeuralGraph ? window.NeuralGraph.getAllEdges() : [];
        const node     = allNodes.find(function (n) { return n.id === nodeId; });
        if (!node) return;

        _currentNodeId  = nodeId;
        _pendingConnDel = [];
        _pendingConnAdd = [];

        const connections = allEdges
            .filter(function (e) { return e.from === nodeId || e.to === nodeId; })
            .map(function (e) {
                const otherId    = e.from === nodeId ? e.to   : e.from;
                const otherLabel = (allNodes.find(function (n) { return n.id === otherId; }) || {}).label || otherId;
                const dir        = e.from === nodeId ? "→" : "←";
                return { from: e.from, to: e.to, label: e.label, dir, otherId, otherLabel };
            });

        _backdrop = document.createElement("div");
        _backdrop.id = "ng-ne-backdrop";
        _backdrop.innerHTML = _buildModalHTML(node, connections);
        document.body.appendChild(_backdrop);

        _wireEvents(node, connections, allNodes, allEdges);
        _backdrop.querySelector(".ng-ne-input").focus();
    }

    // ─── HTML builder ─────────────────────────────────────────────────────
    function _buildModalHTML(node, connections) {
        const catDotColor = CAT_COLORS[node.category] || "#9090b0";
        const catOptions  = CATEGORIES.map(function (c) {
            const sel = c === node.category ? " selected" : "";
            return `<option value="${c}"${sel}>${c}</option>`;
        }).join("");

        const connItems = connections.length === 0
            ? `<div style="font-size:11px;color:#3a3a5a;padding:6px 0;">No connections yet</div>`
            : connections.map(function (c) {
                return `<div class="ng-ne-conn-item" data-from="${_esc(c.from)}" data-to="${_esc(c.to)}">
                    <span style="color:#3a3a5a">${c.dir}</span>
                    <span style="color:#4a4a6a;font-size:10px;">${_esc(c.label || "")}</span>
                    <span class="ng-ne-conn-node">${_esc(c.otherLabel)}</span>
                    <button class="ng-ne-conn-del" title="Remove edge" aria-label="Remove connection">&times;</button>
                </div>`;
            }).join("");

        const descLen = (node.description || "").length;

        return `<div id="ng-ne-modal" role="dialog" aria-modal="true">
            <div class="ng-ne-header">
                <div>
                    <div class="ng-ne-title">Edit Node</div>
                    <div class="ng-ne-node-id">${_esc(node.id)}</div>
                </div>
                <button class="ng-ne-close" aria-label="Close">&times;</button>
            </div>
            <div class="ng-ne-body">

                <!-- Label -->
                <div class="ng-ne-field">
                    <div class="ng-ne-label-row">
                        <label class="ng-ne-label" for="ng-ne-label-input">Label</label>
                        <span class="ng-ne-counter" id="ng-ne-label-count">${_esc(String(node.label || "").length)}/50</span>
                    </div>
                    <input id="ng-ne-label-input" class="ng-ne-input"
                        type="text" value="${_esc(node.label || "")}"
                        maxlength="50" placeholder="Node label" autocomplete="off" />
                </div>

                <!-- Category -->
                <div class="ng-ne-field">
                    <label class="ng-ne-label">Category</label>
                    <div class="ng-ne-cat-row">
                        <div class="ng-ne-cat-dot" id="ng-ne-cat-dot"
                             style="background:${catDotColor}"></div>
                        <select class="ng-ne-cat-select" id="ng-ne-cat-select">
                            ${catOptions}
                        </select>
                    </div>
                </div>

                <!-- Description -->
                <div class="ng-ne-field">
                    <div class="ng-ne-label-row">
                        <label class="ng-ne-label" for="ng-ne-desc-input">Description</label>
                        <span class="ng-ne-counter ${descLen > 180 ? "near-limit" : ""}"
                              id="ng-ne-desc-count">${descLen}/200</span>
                    </div>
                    <textarea id="ng-ne-desc-input" class="ng-ne-textarea"
                        rows="3" maxlength="200"
                        placeholder="Brief description of this node">${_esc(node.description || "")}</textarea>
                </div>

                <!-- Connections -->
                <div class="ng-ne-field">
                    <div class="ng-ne-section-title">Connections</div>
                    <div class="ng-ne-conn-list" id="ng-ne-conn-list">${connItems}</div>
                    <button class="ng-ne-add-conn-btn" id="ng-ne-add-conn-btn">＋ Add connection</button>
                    <div id="ng-ne-conn-search-wrap" class="ng-ne-conn-search-wrap" style="display:none">
                        <input class="ng-ne-conn-search" id="ng-ne-conn-search"
                            placeholder="Search nodes to connect…" autocomplete="off" />
                        <div class="ng-ne-conn-dropdown" id="ng-ne-conn-dd"></div>
                        <input class="ng-ne-conn-rel-input" id="ng-ne-conn-rel"
                            placeholder="Relationship label (e.g. levert, gebruikt)" autocomplete="off" />
                    </div>
                </div>
            </div>

            <div class="ng-ne-footer">
                <button class="ng-ne-btn ng-ne-btn-cancel" id="ng-ne-cancel">CANCEL</button>
                <button class="ng-ne-btn ng-ne-btn-save" id="ng-ne-save">SAVE CHANGES</button>
            </div>
        </div>`;
    }

    // ─── Wire up events ────────────────────────────────────────────────────
    function _wireEvents(node, connections, allNodes) {
        const modal   = _backdrop.querySelector("#ng-ne-modal");
        const labelIn = _backdrop.querySelector("#ng-ne-label-input");
        const catSel  = _backdrop.querySelector("#ng-ne-cat-select");
        const catDot  = _backdrop.querySelector("#ng-ne-cat-dot");
        const descIn  = _backdrop.querySelector("#ng-ne-desc-input");
        const connList= _backdrop.querySelector("#ng-ne-conn-list");
        const addBtn  = _backdrop.querySelector("#ng-ne-add-conn-btn");
        const srchWrap= _backdrop.querySelector("#ng-ne-conn-search-wrap");
        const srchIn  = _backdrop.querySelector("#ng-ne-conn-search");
        const srchDd  = _backdrop.querySelector("#ng-ne-conn-dd");
        const relIn   = _backdrop.querySelector("#ng-ne-conn-rel");

        // Close modal
        function close() { if (_backdrop) { _backdrop.remove(); _backdrop = null; } }
        _backdrop.querySelector(".ng-ne-close").onclick = close;
        _backdrop.querySelector("#ng-ne-cancel").onclick = close;
        _backdrop.addEventListener("click", function (e) { if (e.target === _backdrop) close(); });
        document.addEventListener("keydown", function escL(e) {
            if (e.key === "Escape") { close(); document.removeEventListener("keydown", escL); }
        });

        // Stop click inside modal from dismissing backdrop
        modal.addEventListener("click", function (e) { e.stopPropagation(); });

        // Label — live preview + counter
        labelIn.addEventListener("input", function () {
            const val = labelIn.value;
            _backdrop.querySelector("#ng-ne-label-count").textContent =
                val.length + "/50";
            // Live 3D preview
            if (window.NeuralGraph && window.NeuralGraph.updateNode)
                window.NeuralGraph.updateNode({ id: node.id, label: val });
        });

        // Category — update dot colour
        catSel.addEventListener("change", function () {
            catDot.style.background = CAT_COLORS[catSel.value] || "#9090b0";
            // Live 3D preview
            if (window.NeuralGraph && window.NeuralGraph.updateNode)
                window.NeuralGraph.updateNode({ id: node.id, category: catSel.value });
        });

        // Description counter
        descIn.addEventListener("input", function () {
            const len = descIn.value.length;
            const counter = _backdrop.querySelector("#ng-ne-desc-count");
            counter.textContent = len + "/200";
            counter.className   = "ng-ne-counter" + (len > 180 ? " near-limit" : "");
        });

        // Connection delete buttons
        connList.addEventListener("click", function (e) {
            const btn = e.target.closest(".ng-ne-conn-del");
            if (!btn) return;
            const item = btn.closest(".ng-ne-conn-item");
            _pendingConnDel.push({ from: item.dataset.from, to: item.dataset.to });
            item.style.opacity   = "0.3";
            item.style.textDecoration = "line-through";
            btn.disabled = true;
        });

        // Inline connection add
        let _selectedTarget = null;
        addBtn.addEventListener("click", function () {
            srchWrap.style.display = "block";
            addBtn.style.display   = "none";
            srchIn.focus();
        });

        srchIn.addEventListener("input", function () {
            const q = srchIn.value.toLowerCase().trim();
            const matches = allNodes
                .filter(function (n) {
                    return n.id !== node.id && n.label.toLowerCase().includes(q);
                })
                .slice(0, 8);
            srchDd.innerHTML = matches.map(function (n) {
                const col = CAT_COLORS[n.category] || "#9090b0";
                return `<div class="ng-ne-conn-opt" data-id="${_esc(n.id)}">
                    <div class="ng-ne-conn-opt-dot" style="background:${col}"></div>
                    <span>${_esc(n.label)}</span>
                    <span style="color:#3a3a5a;font-size:10px;margin-left:auto">${_esc(n.id)}</span>
                </div>`;
            }).join("");
        });

        srchDd.addEventListener("click", function (e) {
            const opt = e.target.closest(".ng-ne-conn-opt");
            if (!opt) return;
            _selectedTarget = opt.dataset.id;
            const lbl = allNodes.find(function (n) { return n.id === _selectedTarget; });
            srchIn.value = lbl ? lbl.label : _selectedTarget;
            srchDd.innerHTML = "";
            relIn.focus();
        });

        // Confirm add connection on Enter in relationship input
        relIn.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && _selectedTarget) {
                _pendingConnAdd.push({
                    from:  node.id,
                    to:    _selectedTarget,
                    label: relIn.value.trim(),
                });
                // Show in the list immediately
                const targetNode = allNodes.find(function (n) { return n.id === _selectedTarget; });
                const row = document.createElement("div");
                row.className = "ng-ne-conn-item";
                row.innerHTML = `<span style="color:#3a3a5a">→</span>
                    <span style="color:#4a4a6a;font-size:10px;">${_esc(relIn.value.trim())}</span>
                    <span class="ng-ne-conn-node">${_esc(targetNode ? targetNode.label : _selectedTarget)}</span>
                    <span style="font-size:10px;color:#4f8ef7">(pending)</span>`;
                connList.appendChild(row);
                // Reset search UI
                srchWrap.style.display = "none";
                addBtn.style.display   = "";
                srchIn.value = "";
                relIn.value  = "";
                _selectedTarget = null;
            }
            if (e.key === "Escape") {
                srchWrap.style.display = "none";
                addBtn.style.display   = "";
                _selectedTarget = null;
            }
        });

        // Save
        _backdrop.querySelector("#ng-ne-save").addEventListener("click", function () {
            _save(node, labelIn, catSel, descIn);
        });
    }

    // ─── Save ──────────────────────────────────────────────────────────────
    async function _save(node, labelIn, catSel, descIn) {
        const saveBtn = _backdrop && _backdrop.querySelector("#ng-ne-save");
        if (saveBtn) saveBtn.disabled = true;

        const newLabel = labelIn.value.trim();
        if (!newLabel) {
            _toast("Label cannot be empty", "error");
            if (saveBtn) saveBtn.disabled = false;
            return;
        }

        try {
            // PATCH node properties
            const resp = await fetch(`/graph/node/${encodeURIComponent(node.id)}`, {
                method:  "PATCH",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({
                    label:       newLabel,
                    category:    catSel.value,
                    description: descIn.value.trim(),
                }),
            });
            if (!resp.ok) throw new Error("HTTP " + resp.status);

            // Apply connection deletions
            for (const del of _pendingConnDel) {
                await fetch(
                    `/graph/edge?from=${encodeURIComponent(del.from)}&to=${encodeURIComponent(del.to)}`,
                    { method: "DELETE" }
                ).catch(function () {});
                if (window.NeuralGraph && window.NeuralGraph.removeEdge)
                    window.NeuralGraph.removeEdge(del.from, del.to);
            }

            // Apply connection additions
            for (const add of _pendingConnAdd) {
                const er = await fetch("/graph/edge/add", {
                    method:  "POST",
                    headers: { "Content-Type": "application/json" },
                    body:    JSON.stringify({ from_id: add.from, to_id: add.to, label: add.label }),
                }).catch(function () { return { ok: false }; });
                if (er.ok && window.NeuralGraph && window.NeuralGraph.addEdge)
                    window.NeuralGraph.addEdge({ from: add.from, to: add.to, label: add.label });
            }

            // Final 3D update (already live-previewing, confirm with saved values)
            if (window.NeuralGraph && window.NeuralGraph.updateNode) {
                window.NeuralGraph.updateNode({
                    id:          node.id,
                    label:       newLabel,
                    category:    catSel.value,
                    description: descIn.value.trim(),
                });
            }

            if (window.NeuralGraphState) window.NeuralGraphState.markDirty();
            _toast("Node saved", "success");
            if (_backdrop) { _backdrop.remove(); _backdrop = null; }

        } catch (err) {
            _toast("Save failed: " + err.message, "error");
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    // ─── Helpers ───────────────────────────────────────────────────────────
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
