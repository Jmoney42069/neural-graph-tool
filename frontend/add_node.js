/**
 * add_node.js
 * ─────────────────────────────────────────────────────────────────────────
 * Modal for adding new nodes to the NeuralGraph.
 *
 * Opens on:
 *   - document event "ng:openAddNode"    {}
 *   - document event "ng:addRelatedNode" { parentNodeId, parentLabel }
 *
 * Tabs:
 *   MANUAL   — type label / category / description, optional parent
 *   AI SUGGEST — describe it in plain language, AI proposes nodes+edges
 *
 * After creation:
 *   - POST /graph/node/add
 *   - window.NeuralGraph.addNode() for each node
 *   - window.NeuralGraph.addEdge() for each edge
 *   - window.NeuralGraphState.markDirty()
 */

(function () {
    "use strict";

    // ─── Category data ─────────────────────────────────────────────────────
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
        #ng-an-backdrop {
            position: fixed; inset: 0;
            background: rgba(9,9,15,0.75);
            z-index: 8500;
            display: flex; align-items: center; justify-content: center;
        }
        #ng-an-modal {
            background: #0d0d18;
            border: 1px solid #1e1e2e;
            border-radius: 4px;
            width: 500px;
            max-width: calc(100vw - 32px);
            max-height: calc(100vh - 48px);
            display: flex; flex-direction: column;
            font-family: 'IBM Plex Mono', monospace;
            box-shadow: 0 20px 60px rgba(0,0,0,0.8);
        }
        .ng-an-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 16px 20px 14px;
            border-bottom: 1px solid #1e1e2e;
            flex-shrink: 0;
        }
        .ng-an-title {
            font-size: 11px; font-weight: 600;
            color: #e2e2f0; letter-spacing: 0.12em; text-transform: uppercase;
        }
        .ng-an-close {
            width: 26px; height: 26px;
            background: transparent; border: 1px solid #1e1e2e;
            border-radius: 2px; cursor: pointer;
            color: #4a4a6a; font-size: 16px; line-height: 1;
            display: flex; align-items: center; justify-content: center;
            transition: color 0.1s, border-color 0.1s;
        }
        .ng-an-close:hover { color: #e2e2f0; border-color: #3a3a5a; }

        /* Tabs */
        .ng-an-tabs {
            display: flex; border-bottom: 1px solid #1e1e2e;
            flex-shrink: 0;
        }
        .ng-an-tab {
            padding: 10px 20px;
            font-size: 10px; font-weight: 500;
            letter-spacing: 0.1em; text-transform: uppercase;
            color: #4a4a6a; cursor: pointer;
            border-bottom: 2px solid transparent;
            transition: color 0.15s, border-color 0.15s;
        }
        .ng-an-tab.active { color: #4f8ef7; border-bottom-color: #4f8ef7; }
        .ng-an-tab:hover:not(.active) { color: #8080a0; }

        /* Body */
        .ng-an-body {
            padding: 18px 20px;
            overflow-y: auto; flex: 1;
            display: flex; flex-direction: column; gap: 14px;
        }
        .ng-an-pane { display: none; flex-direction: column; gap: 14px; }
        .ng-an-pane.active { display: flex; }

        /* Fields */
        .ng-an-field { display: flex; flex-direction: column; gap: 6px; }
        .ng-an-label {
            font-size: 10px; color: #4a4a6a;
            letter-spacing: 0.1em; text-transform: uppercase;
        }
        .ng-an-label-row {
            display: flex; justify-content: space-between; align-items: baseline;
        }
        .ng-an-counter { font-size: 10px; color: #3a3a5a; }
        .ng-an-counter.near-limit { color: #f7a04f; }
        .ng-an-input, .ng-an-textarea {
            background: #111122; border: 1px solid #1e1e2e;
            color: #e2e2f0; font-family: 'IBM Plex Mono', monospace;
            font-size: 12px; border-radius: 2px; padding: 8px 10px; outline: none;
            transition: border-color 0.15s;
        }
        .ng-an-input:focus, .ng-an-textarea:focus { border-color: #4f8ef7; }
        .ng-an-input::placeholder, .ng-an-textarea::placeholder { color: #2a2a4a; }
        .ng-an-textarea { resize: vertical; min-height: 64px; line-height: 1.5; }
        .ng-an-input.error { border-color: #f74f6a; }

        /* Category select */
        .ng-an-cat-row { display: flex; align-items: center; gap: 10px; }
        .ng-an-cat-dot {
            width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
            transition: background 0.2s;
        }
        .ng-an-cat-select {
            flex: 1;
            background: #111122; border: 1px solid #1e1e2e;
            color: #e2e2f0; font-family: 'IBM Plex Mono', monospace;
            font-size: 12px; border-radius: 2px; padding: 8px 10px;
            outline: none; cursor: pointer; transition: border-color 0.15s;
        }
        .ng-an-cat-select:focus { border-color: #4f8ef7; }

        /* Parent banner */
        .ng-an-parent-banner {
            display: flex; align-items: center; gap: 8px;
            padding: 8px 12px;
            background: #111122; border: 1px solid #1e1e2e;
            border-radius: 2px; font-size: 11px;
        }
        .ng-an-parent-dot { width: 7px; height: 7px; border-radius: 50%; background: #4f8ef7; }
        .ng-an-parent-label { color: #e2e2f0; }
        .ng-an-parent-hint { color: #3a3a5a; margin-left: auto; font-size: 10px; }

        /* AI suggest pane */
        .ng-an-gen-btn {
            padding: 9px 18px; border: 1px solid #4f8ef7;
            background: #0e1f40; color: #4f8ef7;
            font-family: 'IBM Plex Mono', monospace;
            font-size: 11px; cursor: pointer; border-radius: 2px;
            letter-spacing: 0.05em; align-self: flex-start;
            transition: background 0.1s;
        }
        .ng-an-gen-btn:hover { background: #142a55; }
        .ng-an-gen-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .ng-an-spinner {
            display: none; font-size: 10px; color: #4f8ef7;
            letter-spacing: 0.06em; padding: 6px 0;
        }
        .ng-an-spinner.active { display: block; }

        /* Suggestion preview */
        .ng-an-suggestion {
            display: flex; flex-direction: column; gap: 6px;
        }
        .ng-an-sug-node {
            display: flex; align-items: center; gap: 10px;
            padding: 8px 10px;
            background: #111122; border: 1px solid #1e1e2e;
            border-radius: 2px; cursor: pointer;
            transition: border-color 0.1s, background 0.1s;
        }
        .ng-an-sug-node.selected { border-color: #4f8ef7; background: #0e1530; }
        .ng-an-sug-node-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .ng-an-sug-node-label { font-size: 12px; color: #c8c8e0; flex: 1; }
        .ng-an-sug-node-cat { font-size: 10px; color: #3a3a5a; }
        .ng-an-sug-check {
            width: 14px; height: 14px; border: 1px solid #1e1e2e;
            border-radius: 2px; flex-shrink: 0; display: flex;
            align-items: center; justify-content: center; font-size: 10px; color: #4f8ef7;
        }
        .ng-an-sug-node.selected .ng-an-sug-check { background: #4f8ef7; border-color: #4f8ef7; color: #0d0d18; }
        .ng-an-sug-edge-list {
            font-size: 10px; color: #4a4a6a; padding: 4px 6px;
            border-left: 2px solid #1e1e2e;
        }

        /* Footer */
        .ng-an-footer {
            display: flex; justify-content: flex-end; gap: 8px;
            padding: 14px 20px 16px;
            border-top: 1px solid #1e1e2e; flex-shrink: 0;
        }
        .ng-an-btn {
            padding: 8px 18px; border: 1px solid #1e1e2e;
            background: transparent; font-family: 'IBM Plex Mono', monospace;
            font-size: 11px; letter-spacing: 0.05em; cursor: pointer;
            border-radius: 2px; transition: background 0.1s, color 0.1s;
        }
        .ng-an-btn-cancel { color: #5a5a7a; }
        .ng-an-btn-cancel:hover { color: #e2e2f0; background: #141428; }
        .ng-an-btn-add {
            background: #0e1f40; border-color: #4f8ef7;
            color: #4f8ef7; font-weight: 500;
        }
        .ng-an-btn-add:hover { background: #142a55; }
        .ng-an-btn-add:disabled { opacity: 0.4; cursor: not-allowed; }
    `;

    // ─── State ─────────────────────────────────────────────────────────────
    let _backdrop   = null;
    let _parentNodeId   = null;
    let _parentLabel    = "";
    let _suggestedNodes = [];   // from AI suggestion
    let _selectedSugIds = new Set();

    // ─── Init ──────────────────────────────────────────────────────────────
    function setup() {
        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        document.addEventListener("ng:openAddNode",    function ()  { openModal(null, null); });
        document.addEventListener("ng:addRelatedNode", function (e) {
            openModal(e.detail.parentNodeId, e.detail.parentLabel);
        });
    }

    // ─── Open ──────────────────────────────────────────────────────────────
    function openModal(parentNodeId, parentLabel) {
        if (_backdrop) _backdrop.remove();

        _parentNodeId    = parentNodeId  || null;
        _parentLabel     = parentLabel   || "";
        _suggestedNodes  = [];
        _selectedSugIds  = new Set();

        _backdrop = document.createElement("div");
        _backdrop.id = "ng-an-backdrop";
        _backdrop.innerHTML = _buildHTML();
        document.body.appendChild(_backdrop);
        _wireEvents();

        _backdrop.querySelector("#ng-an-label-input").focus();
    }

    // ─── HTML ──────────────────────────────────────────────────────────────
    function _buildHTML() {
        const catOptions = CATEGORIES.map(function (c) {
            return `<option value="${c}">${c}</option>`;
        }).join("");

        const parentBanner = _parentNodeId
            ? `<div class="ng-an-field">
                <label class="ng-an-label">Connected to</label>
                <div class="ng-an-parent-banner">
                    <div class="ng-an-parent-dot"></div>
                    <span class="ng-an-parent-label">${_esc(_parentLabel || _parentNodeId)}</span>
                    <span class="ng-an-parent-hint">parent node</span>
                </div>
                <input class="ng-an-input" id="ng-an-rel-input"
                    placeholder="Relationship label (e.g. levert, is onderdeel van)"
                    autocomplete="off" style="margin-top:6px" />
               </div>`
            : "";

        return `<div id="ng-an-modal" role="dialog" aria-modal="true">
            <div class="ng-an-header">
                <div class="ng-an-title">Add Node to Network</div>
                <button class="ng-an-close" aria-label="Close">&times;</button>
            </div>

            <div class="ng-an-tabs">
                <div class="ng-an-tab active" data-tab="manual">MANUAL</div>
                <div class="ng-an-tab" data-tab="ai">AI SUGGEST</div>
            </div>

            <div class="ng-an-body">
                <!-- MANUAL tab -->
                <div class="ng-an-pane active" id="ng-an-pane-manual">
                    ${parentBanner}

                    <div class="ng-an-field">
                        <div class="ng-an-label-row">
                            <label class="ng-an-label" for="ng-an-label-input">Label <span style="color:#f74f6a">*</span></label>
                            <span class="ng-an-counter" id="ng-an-label-count">0/50</span>
                        </div>
                        <input id="ng-an-label-input" class="ng-an-input"
                            type="text" maxlength="50"
                            placeholder="e.g. Warmtepomp Pro 3000" autocomplete="off" />
                    </div>

                    <div class="ng-an-field">
                        <label class="ng-an-label">Category <span style="color:#f74f6a">*</span></label>
                        <div class="ng-an-cat-row">
                            <div class="ng-an-cat-dot" id="ng-an-cat-dot"
                                 style="background:${CAT_COLORS.concept}"></div>
                            <select class="ng-an-cat-select" id="ng-an-cat-select">
                                ${catOptions}
                            </select>
                        </div>
                    </div>

                    <div class="ng-an-field">
                        <div class="ng-an-label-row">
                            <label class="ng-an-label" for="ng-an-desc-input">Description</label>
                            <span class="ng-an-counter" id="ng-an-desc-count">0/200</span>
                        </div>
                        <textarea id="ng-an-desc-input" class="ng-an-textarea"
                            rows="3" maxlength="200"
                            placeholder="Brief description…"></textarea>
                    </div>
                </div>

                <!-- AI SUGGEST tab -->
                <div class="ng-an-pane" id="ng-an-pane-ai">
                    <div class="ng-an-field">
                        <label class="ng-an-label" for="ng-an-ai-desc">Describe what to add</label>
                        <textarea id="ng-an-ai-desc" class="ng-an-textarea" rows="3"
                            placeholder="e.g. We also sell 5-year maintenance contracts after installation…"></textarea>
                    </div>
                    <button class="ng-an-gen-btn" id="ng-an-gen-btn">GENERATE</button>
                    <div class="ng-an-spinner" id="ng-an-spinner">● Thinking…</div>
                    <div id="ng-an-suggestion-area" class="ng-an-suggestion"></div>
                </div>
            </div>

            <div class="ng-an-footer">
                <button class="ng-an-btn ng-an-btn-cancel" id="ng-an-cancel">CANCEL</button>
                <button class="ng-an-btn ng-an-btn-add"    id="ng-an-add">ADD TO NETWORK</button>
            </div>
        </div>`;
    }

    // ─── Wire events ───────────────────────────────────────────────────────
    function _wireEvents() {
        const modal    = _backdrop.querySelector("#ng-an-modal");
        const labelIn  = _backdrop.querySelector("#ng-an-label-input");
        const catSel   = _backdrop.querySelector("#ng-an-cat-select");
        const catDot   = _backdrop.querySelector("#ng-an-cat-dot");
        const descIn   = _backdrop.querySelector("#ng-an-desc-input");

        function close() { if (_backdrop) { _backdrop.remove(); _backdrop = null; } }
        _backdrop.querySelector(".ng-an-close").onclick      = close;
        _backdrop.querySelector("#ng-an-cancel").onclick     = close;
        _backdrop.addEventListener("click", function (e) { if (e.target === _backdrop) close(); });
        document.addEventListener("keydown", function escL(e) {
            if (e.key === "Escape") { close(); document.removeEventListener("keydown", escL); }
        });
        modal.addEventListener("click", function (e) { e.stopPropagation(); });

        // Tabs
        _backdrop.querySelectorAll(".ng-an-tab").forEach(function (tab) {
            tab.addEventListener("click", function () {
                _backdrop.querySelectorAll(".ng-an-tab").forEach(function (t) {
                    t.classList.remove("active");
                });
                _backdrop.querySelectorAll(".ng-an-pane").forEach(function (p) {
                    p.classList.remove("active");
                });
                tab.classList.add("active");
                _backdrop.querySelector("#ng-an-pane-" + tab.dataset.tab).classList.add("active");
            });
        });

        // Label counter
        labelIn.addEventListener("input", function () {
            _backdrop.querySelector("#ng-an-label-count").textContent =
                labelIn.value.length + "/50";
            labelIn.classList.remove("error");
        });

        // Category dot
        catSel.addEventListener("change", function () {
            catDot.style.background = CAT_COLORS[catSel.value] || "#9090b0";
        });

        // Description counter
        if (descIn) {
            descIn.addEventListener("input", function () {
                const len = descIn.value.length;
                const counter = _backdrop.querySelector("#ng-an-desc-count");
                counter.textContent = len + "/200";
                counter.className   = "ng-an-counter" + (len > 180 ? " near-limit" : "");
            });
        }

        // AI generate
        const genBtn  = _backdrop.querySelector("#ng-an-gen-btn");
        const spinner = _backdrop.querySelector("#ng-an-spinner");
        if (genBtn) {
            genBtn.addEventListener("click", async function () {
                const aiDesc = (_backdrop.querySelector("#ng-an-ai-desc") || {}).value || "";
                if (!aiDesc.trim()) { _toast("Enter a description first", "error"); return; }
                genBtn.disabled     = true;
                spinner.classList.add("active");
                _backdrop.querySelector("#ng-an-suggestion-area").innerHTML = "";
                _suggestedNodes  = [];
                _selectedSugIds  = new Set();
                try {
                    const r = await fetch("/graph/suggest", {
                        method:  "POST",
                        headers: { "Content-Type": "application/json" },
                        body:    JSON.stringify({
                            description:     aiDesc.trim(),
                            context_node_id: _parentNodeId || null,
                        }),
                    });
                    const data = await r.json();
                    if (data.status !== "ok") throw new Error(data.message || "Unknown error");
                    _renderSuggestion(data.suggestion);
                } catch (err) {
                    _toast("AI suggestion failed: " + err.message, "error");
                } finally {
                    genBtn.disabled = false;
                    spinner.classList.remove("active");
                }
            });
        }

        // Add button
        _backdrop.querySelector("#ng-an-add").addEventListener("click", function () {
            const activeTab = _backdrop.querySelector(".ng-an-tab.active").dataset.tab;
            if (activeTab === "manual") {
                _saveManual(labelIn, catSel, descIn);
            } else {
                _saveAI();
            }
        });
    }

    // ─── AI suggestion renderer ────────────────────────────────────────────
    function _renderSuggestion(suggestion) {
        const nodes = (suggestion.nodes || []);
        const edges = (suggestion.edges || []);
        _suggestedNodes = nodes;

        // Pre-select all
        _selectedSugIds = new Set(nodes.map(function (n) { return n.id; }));

        const area = _backdrop.querySelector("#ng-an-suggestion-area");
        if (!nodes.length) {
            area.innerHTML = `<div style="font-size:11px;color:#3a3a5a">No nodes suggested.</div>`;
            return;
        }

        // Collect edges per node
        const edgesByNode = {};
        edges.forEach(function (e) {
            [e.from, e.to].forEach(function (nid) {
                if (!edgesByNode[nid]) edgesByNode[nid] = [];
                edgesByNode[nid].push(e);
            });
        });

        area.innerHTML = `<div style="font-size:10px;color:#3a3a5a;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">Suggested nodes — click to select</div>` +
            nodes.map(function (n) {
                const col  = CAT_COLORS[n.category] || "#9090b0";
                const edgs = (edgesByNode[n.id] || []).map(function (e) {
                    return `<div>${_esc(e.from)} → ${_esc(e.label || "")} → ${_esc(e.to)}</div>`;
                }).join("");
                return `<div class="ng-an-sug-node selected" data-id="${_esc(n.id)}">
                    <div class="ng-an-sug-node-dot" style="background:${col}"></div>
                    <span class="ng-an-sug-node-label">${_esc(n.label)}</span>
                    <span class="ng-an-sug-node-cat">${_esc(n.category)}</span>
                    <div class="ng-an-sug-check">✓</div>
                </div>
                ${edgs ? `<div class="ng-an-sug-edge-list">${edgs}</div>` : ""}`;
            }).join("");

        // Toggle selection on click
        area.querySelectorAll(".ng-an-sug-node").forEach(function (el) {
            el.addEventListener("click", function () {
                const id = el.dataset.id;
                if (_selectedSugIds.has(id)) {
                    _selectedSugIds.delete(id);
                    el.classList.remove("selected");
                } else {
                    _selectedSugIds.add(id);
                    el.classList.add("selected");
                }
            });
        });
    }

    // ─── Save: manual ──────────────────────────────────────────────────────
    async function _saveManual(labelIn, catSel, descIn) {
        const label = labelIn.value.trim();
        if (!label) {
            labelIn.classList.add("error");
            _toast("Label is required", "error");
            return;
        }

        const addBtn = _backdrop && _backdrop.querySelector("#ng-an-add");
        if (addBtn) addBtn.disabled = true;

        const relInput  = _backdrop && _backdrop.querySelector("#ng-an-rel-input");
        const relLabel  = relInput ? relInput.value.trim() : "";

        const edges = [];
        if (_parentNodeId) {
            edges.push({ from: _parentNodeId, to: "_NEW_", label: relLabel });
        }

        const parentPos = _parentNodeId && window.NeuralGraph && window.NeuralGraph.getNodeWorldPos
            ? window.NeuralGraph.getNodeWorldPos(_parentNodeId)
            : null;

        const position = parentPos
            ? {
                x: parentPos.x + (Math.random() - 0.5) * 40,
                y: parentPos.y + (Math.random() - 0.5) * 40,
                z: parentPos.z + (Math.random() - 0.5) * 40,
            }
            : "auto";

        await _addNodes(
            [{ label, category: catSel.value, description: (descIn ? descIn.value.trim() : "") }],
            edges,
            position
        );
    }

    // ─── Save: AI suggestion ───────────────────────────────────────────────
    async function _saveAI() {
        if (!_suggestedNodes.length) { _toast("Generate a suggestion first", "info"); return; }
        if (!_selectedSugIds.size)   { _toast("Select at least one node",    "info"); return; }

        const addBtn = _backdrop && _backdrop.querySelector("#ng-an-add");
        if (addBtn) addBtn.disabled = true;

        const selectedNodes = _suggestedNodes.filter(function (n) {
            return _selectedSugIds.has(n.id);
        });
        await _addNodes(selectedNodes, [], "auto");
    }

    // ─── Core add logic ────────────────────────────────────────────────────
    async function _addNodes(nodesToAdd, extraEdges, position) {
        let added = 0;
        for (const n of nodesToAdd) {
            const edgesForNode = extraEdges.map(function (e) {
                return {
                    from:  e.from  === "_NEW_" ? n.id : e.from,
                    to:    e.to    === "_NEW_" ? n.id : e.to,
                    label: e.label || "",
                };
            });

            try {
                const r = await fetch("/graph/node/add", {
                    method:  "POST",
                    headers: { "Content-Type": "application/json" },
                    body:    JSON.stringify({
                        node: {
                            label:       n.label,
                            category:    n.category    || "concept",
                            description: n.description || "",
                        },
                        edges:    edgesForNode,
                        position: position || "auto",
                    }),
                });
                if (!r.ok) throw new Error("HTTP " + r.status);
                const data = await r.json();

                // Add to live scene
                if (window.NeuralGraph && window.NeuralGraph.addNode) {
                    window.NeuralGraph.addNode(
                        data.node,
                        data.final_position || undefined
                    );
                }
                // Add edges to live scene
                (data.edges_added || []).forEach(function (e) {
                    if (window.NeuralGraph && window.NeuralGraph.addEdge)
                        window.NeuralGraph.addEdge(e);
                });
                // Focus new node
                if (window.NeuralGraph && window.NeuralGraph.focusNode)
                    window.NeuralGraph.focusNode(data.node.id);

                added++;
            } catch (err) {
                _toast("Failed to add " + (n.label || "node") + ": " + err.message, "error");
            }
        }

        if (added > 0) {
            if (window.NeuralGraphState) window.NeuralGraphState.markDirty();
            _toast(added === 1 ? "Node added" : added + " nodes added", "success");
            if (_backdrop) { _backdrop.remove(); _backdrop = null; }
        } else {
            const btn = _backdrop && _backdrop.querySelector("#ng-an-add");
            if (btn) btn.disabled = false;
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
