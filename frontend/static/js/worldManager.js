// FILE: static/js/worldManager.js
// DOES: World switching (Demo Network ↔ My Memory), segment filter panel,
//       floating title overlay in the 3D canvas, globe button in toolbar.
// DEPENDS ON: window.NeuralGraph (renderer.js), #ng-toolbar (toolbar.js)
// EXPOSES: window.WorldManager

(function () {
    "use strict";

    // ── World registry ────────────────────────────────────────────────────────
    var WORLDS = {
        demo: {
            id:       "demo",
            name:     "Demo Network",
            dot:      "#4f8ef7",
            endpoint: "/graph/load",
        },
        memory: {
            id:       "memory",
            name:     "My Memory",
            dot:      "#00BFFF",
            endpoint: "/memory/load",
        },
    };

    // ── Segment palette — mirrors memory.json segment colours ──────────────
    var SEGMENTS = [
        { id: "identity",           label: "Identity",          color: "#00BFFF" },
        { id: "psychology",         label: "Psychology",        color: "#FF6B6B" },
        { id: "motivations",        label: "Motivations",       color: "#FFD700" },
        { id: "personality",        label: "Personality",       color: "#E67E22" },
        { id: "philosophy",         label: "Philosophy",        color: "#E74C3C" },
        { id: "health_mind",        label: "Mind & Health",     color: "#8E44AD" },
        { id: "social",             label: "Social",            color: "#1ABC9C" },
        { id: "career",             label: "Career",            color: "#7CFC00" },
        { id: "voltera_compliance", label: "Compliance",        color: "#FF4500" },
        { id: "voltera_rag",        label: "RAG Chatbot",       color: "#FF6347" },
        { id: "voltera_scripts",    label: "Sales Scripts",     color: "#FFA07A" },
        { id: "project_jarvis",     label: "JARVIS",            color: "#DA70D6" },
        { id: "project_tools",      label: "Tools",             color: "#BA55D3" },
        { id: "project_neural",     label: "Neural Network",    color: "#9370DB" },
        { id: "tech_stack",         label: "Tech Stack",        color: "#9B59B6" },
        { id: "ai_models",          label: "AI Models",         color: "#6A5ACD" },
        { id: "prompt_engineering", label: "Prompt Eng.",       color: "#4169E1" },
        { id: "goals",              label: "Goals",             color: "#00CED1" },
        { id: "financial",          label: "Financial",         color: "#2ECC71" },
        { id: "trading",            label: "Trading",           color: "#20B2AA" },
        { id: "learning",           label: "Learning",          color: "#F39C12" },
        { id: "history",            label: "History",           color: "#95A5A6" },
        { id: "winners_center",     label: "Winners Center",    color: "#CD853F" },
    ];

    // ── Module state ──────────────────────────────────────────────────────────
    var _current   = "demo";
    var _segPanel  = null;
    var _activeSeg = null;
    var _titleEl   = null;
    var _dropEl    = null;

    // ── Switch world ──────────────────────────────────────────────────────────
    function _switch(worldId) {
        var world = WORLDS[worldId];
        if (!world) return;
        if (_dropEl) _dropEl.style.display = "none";
        _current = worldId;

        fetch(world.endpoint)
            .then(function (r) {
                if (!r.ok) throw new Error("HTTP " + r.status);
                return r.json();
            })
            .then(function (data) {
                if (window.NeuralGraph) window.NeuralGraph.loadData(data);
                // Clear chat history for the new world
                var label = worldId === "memory" ? "My Memory" : "Demo Network";
                if (window.NeuralGraphChat && window.NeuralGraphChat.clearChat) {
                    window.NeuralGraphChat.clearChat(label);
                }
                // Globe button active state
                var globe = document.getElementById("wm-tb-globe");
                if (globe) globe.classList.toggle("active", worldId === "memory");
                if (worldId === "memory") {
                    _showTitle("MY  MEMORY");
                    _showSegPanel();
                } else {
                    _hideTitle();
                    _hideSegPanel();
                }
            })
            .catch(function (err) {
                console.error("[WorldManager] Failed to load world:", worldId, err);
            });
    }

    // ── Floating world title ──────────────────────────────────────────────────
    function _showTitle(text) {
        var canvas = document.getElementById("graph-canvas");
        if (!canvas) return;
        if (!_titleEl) {
            _titleEl = document.createElement("div");
            _titleEl.id = "wm-world-title";
            _titleEl.style.cssText = [
                "position:absolute",
                "top:14px",
                "left:50%",
                "transform:translateX(-50%)",
                "font-family:'IBM Plex Mono',monospace",
                "font-size:10px",
                "font-weight:500",
                "letter-spacing:0.42em",
                "color:rgba(0,191,255,0.25)",
                "text-transform:uppercase",
                "pointer-events:none",
                "z-index:100",
                "opacity:0",
                "transition:opacity 0.9s ease",
                "white-space:nowrap",
            ].join(";");
            canvas.style.position = "relative";
            canvas.appendChild(_titleEl);
        }
        _titleEl.textContent = text;
        // Small delay so CSS transition fires
        setTimeout(function () { _titleEl.style.opacity = "1"; }, 60);
    }

    function _hideTitle() {
        if (!_titleEl) return;
        _titleEl.style.opacity = "0";
    }

    // ── Segment filter panel ──────────────────────────────────────────────────
    function _showSegPanel() {
        _hideSegPanel();
        _activeSeg = null;

        var panel = document.createElement("div");
        panel.id = "wm-seg-panel";
        panel.style.cssText = [
            "position:absolute",
            "left:12px",
            "top:50%",
            "transform:translateY(-50%)",
            "z-index:200",
            "display:flex",
            "flex-direction:column",
            "gap:2px",
            "background:rgba(4,4,20,0.80)",
            "border:1px solid rgba(255,255,255,0.06)",
            "border-radius:10px",
            "padding:10px 8px",
            "backdrop-filter:blur(16px)",
            "-webkit-backdrop-filter:blur(16px)",
            "box-shadow:0 4px 40px rgba(0,0,0,0.55)",
            "opacity:0",
            "transition:opacity 0.4s ease",
            "max-height:calc(100% - 40px)",
            "overflow-y:auto",
        ].join(";");

        // Scrollbar styling
        panel.style.scrollbarWidth = "thin";
        panel.style.scrollbarColor = "rgba(255,255,255,0.1) transparent";

        // Panel header — contains drag handle
        var hdr = document.createElement("div");
        hdr.style.cssText = [
            "font-family:'IBM Plex Mono',monospace",
            "font-size:9px",
            "letter-spacing:0.2em",
            "color:rgba(255,255,255,0.22)",
            "text-transform:uppercase",
            "padding:0 4px 7px 4px",
            "border-bottom:1px solid rgba(255,255,255,0.05)",
            "margin-bottom:4px",
            "user-select:none",
            "cursor:grab",
            "display:flex",
            "align-items:center",
            "gap:6px",
        ].join(";");
        hdr.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="rgba(255,255,255,0.3)">' +
            '<rect x="1" y="1" width="3" height="3" rx="1"/><rect x="6" y="1" width="3" height="3" rx="1"/>' +
            '<rect x="1" y="6" width="3" height="3" rx="1"/><rect x="6" y="6" width="3" height="3" rx="1"/>' +
            '</svg><span>SEGMENTS</span>';
        panel.appendChild(hdr);

        // ── Drag-to-move logic ──────────────────────────────────────────────
        (function _makeDraggable(el, handle) {
            var dragging = false, ox = 0, oy = 0, startX = 0, startY = 0;

            handle.addEventListener("mousedown", function (e) {
                if (e.button !== 0) return;
                dragging = true;
                handle.style.cursor = "grabbing";
                // Reset transform so we can use left/top freely
                var rect = el.getBoundingClientRect();
                el.style.transform = "none";
                el.style.left = rect.left + "px";
                el.style.top  = rect.top  + "px";
                ox = rect.left;
                oy = rect.top;
                startX = e.clientX;
                startY = e.clientY;
                e.preventDefault();
                e.stopPropagation();
            });

            document.addEventListener("mousemove", function (e) {
                if (!dragging) return;
                el.style.left = (ox + e.clientX - startX) + "px";
                el.style.top  = (oy + e.clientY - startY) + "px";
            });

            document.addEventListener("mouseup", function () {
                if (dragging) { dragging = false; handle.style.cursor = "grab"; }
            });
        }(panel, hdr));

        // "All" reset button
        panel.appendChild(_makeSegBtn("All", "all", "rgba(255,255,255,0.5)"));

        // One button per segment
        SEGMENTS.forEach(function (seg) {
            panel.appendChild(_makeSegBtn(seg.label, seg.id, seg.color));
        });

        var canvas = document.getElementById("graph-canvas");
        if (canvas) {
            canvas.style.position = "relative";
            canvas.appendChild(panel);
        }
        _segPanel = panel;
        setTimeout(function () { panel.style.opacity = "1"; }, 60);
    }

    function _hideSegPanel() {
        if (_segPanel && _segPanel.parentNode) {
            _segPanel.parentNode.removeChild(_segPanel);
        }
        _segPanel  = null;
        _activeSeg = null;
        if (window.NeuralGraph) window.NeuralGraph.resetHighlights();
    }

    function _makeSegBtn(label, segId, color) {
        var btn = document.createElement("button");
        btn.setAttribute("data-wm-seg", segId);
        btn.style.cssText = [
            "display:flex",
            "align-items:center",
            "gap:7px",
            "background:none",
            "border:none",
            "cursor:pointer",
            "padding:4px 6px",
            "border-radius:5px",
            "transition:background 0.12s",
            "width:100%",
            "text-align:left",
        ].join(";");

        var dot = document.createElement("span");
        dot.style.cssText = [
            "width:6px",
            "height:6px",
            "border-radius:50%",
            "background:" + color,
            "flex-shrink:0",
            "transition:transform 0.15s",
        ].join(";");
        btn.appendChild(dot);

        var lbl = document.createElement("span");
        lbl.className = "wm-seg-lbl";
        lbl.style.cssText = [
            "font-family:'IBM Plex Mono',monospace",
            "font-size:10px",
            "color:rgba(255,255,255,0.50)",
            "white-space:nowrap",
            "transition:color 0.12s",
        ].join(";");
        lbl.textContent = label;
        btn.appendChild(lbl);

        btn.addEventListener("mouseenter", function () {
            if (_activeSeg !== segId) {
                btn.style.background = "rgba(255,255,255,0.04)";
                dot.style.transform  = "scale(1.4)";
            }
        });
        btn.addEventListener("mouseleave", function () {
            if (_activeSeg !== segId) {
                btn.style.background = "none";
                dot.style.transform  = "scale(1)";
            }
        });
        btn.addEventListener("click", function (e) {
            e.stopPropagation();
            _filterSeg(segId);
        });
        return btn;
    }

    function _applySegBtnActive(segId, active) {
        if (!_segPanel) return;
        var btn = _segPanel.querySelector("[data-wm-seg='" + segId + "']");
        if (!btn) return;
        var dot = btn.querySelector("span:first-child");
        var lbl = btn.querySelector(".wm-seg-lbl");
        if (active) {
            btn.style.background = "rgba(255,255,255,0.07)";
            if (dot) dot.style.transform = "scale(1.6)";
            if (lbl) lbl.style.color = "rgba(255,255,255,0.95)";
        } else {
            btn.style.background = "none";
            if (dot) dot.style.transform = "scale(1)";
            if (lbl) lbl.style.color = "rgba(255,255,255,0.50)";
        }
    }

    function _filterSeg(segId) {
        if (!window.NeuralGraph) return;

        // Deactivate all first
        SEGMENTS.concat([{ id: "all" }]).forEach(function (s) {
            _applySegBtnActive(s.id, false);
        });

        // Toggle off
        if (segId === "all" || segId === _activeSeg) {
            _activeSeg = null;
            window.NeuralGraph.resetHighlights();
            return;
        }

        _activeSeg = segId;
        _applySegBtnActive(segId, true);

        var nodes   = window.NeuralGraph.getAllNodes();
        var matches = nodes.filter(function (n) { return n.segment === segId; });
        var ids     = matches.map(function (n) { return n.id; });

        window.NeuralGraph.resetHighlights();
        if (ids.length) {
            window.NeuralGraph.highlightNodes(ids);
            // Focus on the middle node of the cluster
            window.NeuralGraph.focusNode(ids[Math.floor(ids.length / 2)]);
        }
    }

    // ── Toolbar globe button ──────────────────────────────────────────────────
    function _addToolbarButton() {
        var toolbar = document.getElementById("ng-toolbar");
        if (!toolbar) {
            setTimeout(_addToolbarButton, 300);
            return;
        }

        // Separator
        var sep = document.createElement("div");
        sep.className = "ng-tb-sep";
        toolbar.appendChild(sep);

        // Globe button
        var btn = document.createElement("button");
        btn.id        = "wm-tb-globe";
        btn.className = "ng-tb-btn";
        btn.title     = "Switch World";
        btn.setAttribute("data-tooltip", "Switch World");
        btn.style.cssText = "position:relative;";

        var icon = document.createElement("i");
        icon.setAttribute("data-lucide", "globe");
        btn.appendChild(icon);

        // Dropdown
        var drop = document.createElement("div");
        drop.id = "wm-tb-drop";
        drop.style.cssText = [
            "position:absolute",
            "top:calc(100% + 8px)",
            "left:0",
            "min-width:178px",
            "background:#0b0b1c",
            "border:1px solid rgba(255,255,255,0.09)",
            "border-radius:9px",
            "padding:5px",
            "box-shadow:0 10px 40px rgba(0,0,0,0.7)",
            "z-index:99999",
            "display:none",
            "flex-direction:column",
            "gap:2px",
        ].join(";");

        // Section label
        var secLbl = document.createElement("div");
        secLbl.style.cssText = [
            "font-family:'IBM Plex Mono',monospace",
            "font-size:9px",
            "letter-spacing:0.16em",
            "color:rgba(255,255,255,0.25)",
            "padding:4px 8px 5px 8px",
            "user-select:none",
        ].join(";");
        secLbl.textContent = "WORLDS";
        drop.appendChild(secLbl);

        Object.keys(WORLDS).forEach(function (id) {
            var w    = WORLDS[id];
            var item = document.createElement("button");
            item.setAttribute("data-wm-world", id);
            item.style.cssText = [
                "display:flex",
                "align-items:center",
                "gap:9px",
                "background:none",
                "border:none",
                "cursor:pointer",
                "padding:8px 10px",
                "border-radius:6px",
                "transition:background 0.12s",
                "width:100%",
                "text-align:left",
            ].join(";");

            var dot = document.createElement("span");
            dot.style.cssText = "width:7px;height:7px;border-radius:50%;background:" + w.dot + ";flex-shrink:0;";

            var lbl = document.createElement("span");
            lbl.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:11px;color:rgba(255,255,255,0.7);";
            lbl.textContent = w.name;

            item.appendChild(dot);
            item.appendChild(lbl);

            item.addEventListener("mouseenter", function () {
                item.style.background = "rgba(255,255,255,0.06)";
            });
            item.addEventListener("mouseleave", function () {
                item.style.background = (_current === id) ? "rgba(255,255,255,0.04)" : "none";
            });
            item.addEventListener("click", function (e) {
                e.stopPropagation();
                drop.style.display = "none";
                _switch(id);
            });

            drop.appendChild(item);
        });

        _dropEl = drop;
        btn.appendChild(drop);

        btn.addEventListener("click", function (e) {
            e.stopPropagation();
            drop.style.display = drop.style.display === "none" ? "flex" : "none";
        });

        document.addEventListener("click", function () {
            if (drop) drop.style.display = "none";
        });

        toolbar.appendChild(btn);
        if (typeof lucide !== "undefined") lucide.createIcons();
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    function _init() {
        _addToolbarButton();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", _init);
    } else {
        _init();
    }

    // ── Public API ────────────────────────────────────────────────────────────
    window.WorldManager = {
        switchTo:   _switch,
        getCurrent: function () { return _current; },
        filterSeg:  _filterSeg,
    };

})();
