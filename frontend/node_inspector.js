/*!
 * node_inspector.js  ─  NeuralGraph sidebar node inspector
 *
 * Sets window.onNodeSelect (overrides the inline IIFE stub).
 * Renders a rich node panel into #node-detail when a node is clicked.
 *
 * Features:
 *  - Category badge with accent colour
 *  - Description text
 *  - Connection list (click to focus node)
 *  - Collapsible source-chunk excerpt
 *  - "ASK ABOUT THIS" button → NeuralGraphChat.send()
 */
(function () {
    "use strict";

    // ── constants ─────────────────────────────────────────────────────────────
    var CACHE_TTL_MS = 5000;

    var CAT_LABEL = {
        product:    "Product",
        customer:   "Customer",
        process:    "Process",
        compliance: "Compliance",
        finance:    "Finance",
    };

    var CAT_COLOR = {
        product:    "#4f8ef7",
        customer:   "#b44ff7",
        process:    "#f7a04f",
        compliance: "#f74f6a",
        finance:    "#4ff7a0",
    };

    // ── graph edge cache ──────────────────────────────────────────────────────
    var _graphCache   = null;
    var _cacheAt      = 0;
    var _cachePromise = null;

    function _loadGraph() {
        var now = Date.now();
        if (_graphCache && (now - _cacheAt) < CACHE_TTL_MS) {
            return Promise.resolve(_graphCache);
        }
        if (_cachePromise) return _cachePromise;

        _cachePromise = fetch("/graph/load")
            .then(function (r) { return r.json(); })
            .then(function (data) {
                _graphCache   = data;
                _cacheAt      = Date.now();
                _cachePromise = null;
                return data;
            })
            .catch(function () {
                _cachePromise = null;
                return _graphCache || { nodes: [], edges: [] };
            });

        return _cachePromise;
    }

    // ── CSS ───────────────────────────────────────────────────────────────────
    function _injectStyles() {
        if (document.getElementById("ng-inspector-styles")) return;
        var el = document.createElement("style");
        el.id = "ng-inspector-styles";
        el.textContent = [
            ".ng-ni-label {",
            "  font-size:13px; font-weight:600; color:#e2e2f0;",
            "  margin-bottom:4px; word-break:break-word;",
            "}",
            ".ng-ni-badge {",
            "  display:inline-block; font-size:9px; letter-spacing:.1em;",
            "  text-transform:uppercase; padding:2px 7px; border-radius:3px;",
            "  margin-bottom:8px; border:1px solid;",
            "}",
            ".ng-ni-desc {",
            "  font-size:11px; color:#8a8aba; line-height:1.5;",
            "  margin-bottom:8px; white-space:pre-wrap; word-break:break-word;",
            "}",
            ".ng-ni-section {",
            "  font-size:9px; letter-spacing:.1em; text-transform:uppercase;",
            "  color:#4a4a6a; margin:8px 0 4px;",
            "}",
            ".ng-ni-conn {",
            "  display:flex; flex-direction:column; gap:3px;",
            "  max-height:140px; overflow-y:auto;",
            "}",
            ".ng-ni-conn-item {",
            "  display:flex; align-items:center; gap:6px;",
            "  font-size:11px; color:#8a8aba; cursor:pointer;",
            "  padding:3px 4px; border-radius:3px;",
            "  transition:background .12s, color .12s;",
            "}",
            ".ng-ni-conn-item:hover { background:#141428; color:#c8c8e8; }",
            ".ng-ni-conn-dir { font-size:9px; color:#4a4a6a; min-width:18px; text-align:center; }",
            ".ng-ni-conn-rel { font-size:9px; color:#4a4a6a; font-style:italic; margin-left:auto; }",
            ".ng-ni-chunk-toggle {",
            "  font-size:9px; letter-spacing:.08em; text-transform:uppercase;",
            "  color:#4a4a6a; cursor:pointer; user-select:none; margin-top:6px;",
            "}",
            ".ng-ni-chunk-toggle:hover { color:#8a8aba; }",
            ".ng-ni-chunk {",
            "  margin:4px 0 0; font-size:10px; color:#5a5a7a;",
            "  background:#0a0a14; border:1px solid #1a1a2e;",
            "  border-radius:4px; padding:6px 8px;",
            "  max-height:80px; overflow-y:auto;",
            "  white-space:pre-wrap; word-break:break-word; font-family:inherit;",
            "}",
            ".ng-ni-ask-btn {",
            "  margin-top:10px; width:100%; padding:7px 0;",
            "  background:#0f0f1e; border:1px solid #4f8ef7;",
            "  border-radius:4px; color:#4f8ef7;",
            "  font-size:11px; letter-spacing:.06em;",
            "  cursor:pointer; font-family:inherit;",
            "  transition:background .15s, color .15s;",
            "}",
            ".ng-ni-ask-btn:hover { background:#141428; color:#8ab8f7; }",
        ].join("\n");
        document.head.appendChild(el);
    }

    // ── render ────────────────────────────────────────────────────────────────
    function _render(nodeData) {
        var container = document.getElementById("node-detail");
        if (!container) return;

        var color = CAT_COLOR[nodeData.category] || "#8a8aba";
        var label = CAT_LABEL[nodeData.category] || (nodeData.category || "node");

        var frag = document.createElement("div");

        // Label
        var labelEl = document.createElement("div");
        labelEl.className   = "ng-ni-label";
        labelEl.textContent = nodeData.label || nodeData.id;
        frag.appendChild(labelEl);

        // Category badge
        var badge = document.createElement("span");
        badge.className         = "ng-ni-badge";
        badge.textContent       = label;
        badge.style.color       = color;
        badge.style.borderColor = color + "44";
        badge.style.background  = color + "11";
        frag.appendChild(badge);

        // Description
        if (nodeData.description) {
            var desc = document.createElement("div");
            desc.className   = "ng-ni-desc";
            desc.textContent = nodeData.description;
            frag.appendChild(desc);
        }

        // Connections section header
        var connSection = document.createElement("div");
        connSection.className   = "ng-ni-section";
        connSection.textContent = "Connections";
        frag.appendChild(connSection);

        // Connections list (async-filled)
        var connList = document.createElement("div");
        connList.className   = "ng-ni-conn";
        connList.innerHTML   = "<span style=\"font-size:10px;color:#3a3a5a\">loading\u2026</span>";
        frag.appendChild(connList);

        // Source chunk (collapsible)
        if (nodeData.source_chunk) {
            var chunkTog  = document.createElement("div");
            chunkTog.className = "ng-ni-chunk-toggle";
            var chunkOpen = false;
            chunkTog.textContent = "\u25b8 source excerpt";

            var chunkPre = document.createElement("pre");
            chunkPre.className    = "ng-ni-chunk";
            chunkPre.style.display = "none";
            chunkPre.textContent  = nodeData.source_chunk;

            chunkTog.addEventListener("click", function () {
                chunkOpen = !chunkOpen;
                chunkPre.style.display = chunkOpen ? "block" : "none";
                chunkTog.textContent   = (chunkOpen ? "\u25be " : "\u25b8 ") + "source excerpt";
            });

            frag.appendChild(chunkTog);
            frag.appendChild(chunkPre);
        }

        // Ask button
        var askBtn = document.createElement("button");
        askBtn.className   = "ng-ni-ask-btn";
        askBtn.textContent = "\u2b26 ASK ABOUT THIS";
        askBtn.addEventListener("click", function () {
            var prompt = "Tell me about " + (nodeData.label || nodeData.id) + " and its connections.";
            if (window.NeuralGraphChat && window.NeuralGraphChat.send) {
                window.NeuralGraphChat.send(prompt);
            } else {
                var chatInput = document.getElementById("chat-input");
                var chatSend  = document.getElementById("chat-send");
                if (chatInput) {
                    chatInput.value = prompt;
                    chatInput.focus();
                    if (chatSend) chatSend.click();
                }
            }
        });
        frag.appendChild(askBtn);

        container.innerHTML = "";
        container.appendChild(frag);

        // Async: populate connections
        _loadGraph().then(function (graph) {
            var edges   = graph.edges  || [];
            var nodes   = graph.nodes  || [];
            var nodeMap = {};
            nodes.forEach(function (n) { nodeMap[n.id] = n; });

            var conns = [];
            edges.forEach(function (e) {
                if (e.from === nodeData.id) {
                    conns.push({ dir: "\u2192", otherId: e.to,   rel: e.label });
                } else if (e.to === nodeData.id) {
                    conns.push({ dir: "\u2190", otherId: e.from, rel: e.label });
                }
            });

            connList.innerHTML = "";

            if (conns.length === 0) {
                connList.innerHTML = "<span style=\"font-size:10px;color:#3a3a5a\">No connections</span>";
                return;
            }

            conns.forEach(function (c) {
                var other = nodeMap[c.otherId];
                if (!other) return;

                var item = document.createElement("div");
                item.className = "ng-ni-conn-item";
                item.title     = "Focus: " + (other.label || other.id);

                var dirSpan  = document.createElement("span");
                dirSpan.className   = "ng-ni-conn-dir";
                dirSpan.textContent = c.dir;

                var nameSpan = document.createElement("span");
                nameSpan.textContent = other.label || other.id;

                item.appendChild(dirSpan);
                item.appendChild(nameSpan);

                if (c.rel) {
                    var relSpan = document.createElement("span");
                    relSpan.className   = "ng-ni-conn-rel";
                    relSpan.textContent = c.rel;
                    item.appendChild(relSpan);
                }

                item.addEventListener("click", function () {
                    if (!window.NeuralGraph) return;
                    if (window.NeuralGraph.focusNode)       window.NeuralGraph.focusNode(other.id);
                    else if (window.NeuralGraph.highlightNode) window.NeuralGraph.highlightNode(other.id);
                });

                connList.appendChild(item);
            });
        }).catch(function () {
            connList.innerHTML = "<span style=\"font-size:10px;color:#3a3a5a\">Could not load connections</span>";
        });
    }

    // ── bootstrap ─────────────────────────────────────────────────────────────
    document.addEventListener("DOMContentLoaded", function () {
        _injectStyles();

        // Override the inline IIFE stub
        window.onNodeSelect = function (nodeData) {
            if (!nodeData) {
                var container = document.getElementById("node-detail");
                if (container) {
                    container.innerHTML = "<p class=\"node-placeholder\">Click a node to inspect</p>";
                }
                // Invalidate cache so fresh data is fetched next time
                _graphCache = null;
                return;
            }
            _render(nodeData);
            // Warm cache in background
            _loadGraph();
        };

        // Warm-up the cache on load
        _loadGraph();
    });

})();
