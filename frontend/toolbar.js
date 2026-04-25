/*!
 * toolbar.js — NeuralGraph Step 10: Floating Toolbar
 *
 * Injects a floating button bar into #graph-canvas (top-right).
 * Handles: fullscreen, labels toggle, physics pause, reset camera,
 *          export JSON, export PNG, keyboard shortcuts overlay,
 *          onboarding card, keyboard shortcut bindings.
 *
 * Globals used:
 *   window.NeuralGraph  (setLabelsVisible, setPhysicsPaused, resetCamera,
 *                        getAllNodes, getAllEdges, getNodeScreenPos,
 *                        getRendererCanvas, getLabelsVisible)
 *   window.NeuralGraphState   (markDirty)
 *   window.NeuralGraphTestData (load)
 *   lucide  (CDN — optional, falls back gracefully)
 *
 * Globals exposed:
 *   window.NeuralGraphToolbar = { getLabelsState, getPhysicsState }
 */
(function () {
    "use strict";

    // ── module state ──────────────────────────────────────────────────────────
    var _labelsOn  = false;
    var _physicsOn = true;
    var _edgesOn   = false;  // edges hidden by default

    // ── icon helper ───────────────────────────────────────────────────────────
    // Builds a <button> with a Lucide <i> element.
    function _btn(id, iconName, title, handler) {
        var b = document.createElement("button");
        b.id        = id;
        b.className = "ng-tb-btn";
        b.title     = title;
        b.setAttribute("data-tooltip", title);
        // Lucide icon element — lucide.createIcons() will replace this with SVG
        var i = document.createElement("i");
        i.setAttribute("data-lucide", iconName);
        b.appendChild(i);
        b.addEventListener("click", function (e) { e.stopPropagation(); handler(); });
        return b;
    }

    function _sep() {
        var d = document.createElement("div");
        d.className = "ng-tb-sep";
        return d;
    }

    function _refreshIcons() {
        if (typeof lucide !== "undefined") lucide.createIcons();
    }

    function _setIcon(btnId, iconName) {
        var el = document.querySelector("#" + btnId + " [data-lucide]");
        if (el) {
            el.setAttribute("data-lucide", iconName);
            _refreshIcons();
        }
    }

    // ── actions ───────────────────────────────────────────────────────────────

    function _toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(function () {});
        } else {
            document.exitFullscreen();
        }
    }

    function _toggleLabels() {
        if (!window.NeuralGraph) return;
        _labelsOn = !_labelsOn;
        window.NeuralGraph.setLabelsVisible(_labelsOn);
        _setIcon("ng-tb-labels", _labelsOn ? "eye-off" : "eye");
        var b = document.getElementById("ng-tb-labels");
        if (b) b.classList.toggle("active", _labelsOn);
    }

    function _toggleEdges() {
        if (!window.EdgeManager) return;
        _edgesOn = !_edgesOn;
        window.EdgeManager.setVisible(_edgesOn);
        _setIcon("ng-tb-edges", _edgesOn ? "link" : "link");
        var b = document.getElementById("ng-tb-edges");
        if (b) b.classList.toggle("active", _edgesOn);
    }

    function _togglePhysics() {
        if (!window.NeuralGraph) return;
        _physicsOn = !_physicsOn;
        window.NeuralGraph.setPhysicsPaused(!_physicsOn);
        _setIcon("ng-tb-physics", _physicsOn ? "pause" : "play");
        var b = document.getElementById("ng-tb-physics");
        if (b) {
            b.classList.toggle("active",           !_physicsOn);
            b.classList.toggle("ng-phys-paused",   !_physicsOn);
        }
    }

    function _resetCamera() {
        if (window.NeuralGraph) window.NeuralGraph.resetCamera();
    }

    // ── export JSON ───────────────────────────────────────────────────────────
    function _exportJSON() {
        if (!window.NeuralGraph) return;
        var nodes = window.NeuralGraph.getAllNodes();
        var edges = window.NeuralGraph.getAllEdges();
        var payload = {
            meta: {
                exported_at: new Date().toISOString(),
                node_count:  nodes.length,
                edge_count:  edges.length,
                version:     "1.0",
            },
            nodes: nodes,
            edges: edges,
        };
        var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement("a");
        a.href     = url;
        a.download = "neuralgraph-export.json";
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    // ── export PNG  (WebGL canvas + composited labels) ────────────────────────
    function _exportPNG() {
        if (!window.NeuralGraph) return;
        var threeCanvas = window.NeuralGraph.getRendererCanvas();
        if (!threeCanvas) {
            console.warn("[NeuralGraph] getRendererCanvas() returned null — PNG skipped.");
            return;
        }

        var W = threeCanvas.width;
        var H = threeCanvas.height;

        var off = document.createElement("canvas");
        off.width  = W;
        off.height = H;
        var ctx = off.getContext("2d");

        // Draw the Three.js WebGL canvas (preserveDrawingBuffer:true ensures content is there)
        ctx.drawImage(threeCanvas, 0, 0);

        // Composite HTML labels if they are currently forced-visible
        if (window.NeuralGraph.getLabelsVisible()) {
            var nodes = window.NeuralGraph.getAllNodes();
            ctx.font       = '11px "IBM Plex Mono", monospace';
            ctx.textAlign  = "center";
            ctx.textBaseline = "alphabetic";

            nodes.forEach(function (nd) {
                var sp = window.NeuralGraph.getNodeScreenPos(nd.id);
                if (!sp) return;

                var text    = nd.label;
                var metrics = ctx.measureText(text);
                var tw = metrics.width + 16;
                var th = 20;
                var tx = sp.x - tw / 2;
                var ty = sp.y - th - 12;

                // Background
                ctx.fillStyle = "#0d0d18";
                ctx.beginPath();
                if (ctx.roundRect) {
                    ctx.roundRect(tx, ty, tw, th, 2);
                } else {
                    ctx.rect(tx, ty, tw, th);
                }
                ctx.fill();

                // Border
                ctx.strokeStyle = "#1e1e2e";
                ctx.lineWidth   = 1;
                ctx.beginPath();
                if (ctx.roundRect) {
                    ctx.roundRect(tx, ty, tw, th, 2);
                } else {
                    ctx.rect(tx, ty, tw, th);
                }
                ctx.stroke();

                // Text
                ctx.fillStyle = "#e2e2f0";
                ctx.fillText(text, sp.x, ty + 13);
            });
        }

        var a    = document.createElement("a");
        a.download = "neuralgraph-export.png";
        a.href     = off.toDataURL("image/png");
        a.click();
    }

    // ── keyboard shortcuts overlay ────────────────────────────────────────────
    var SHORTCUTS = [
        ["F",      "Fullscreen toggle"],
        ["L",      "Labels toggle"],
        ["Space",  "Physics pause / resume"],
        ["R",      "Reset camera"],
        ["Ctrl+E", "Export JSON"],
        ["?",      "This shortcuts panel"],
        ["Esc",    "Close panels / deselect"],
    ];

    function _toggleShortcuts() {
        var existing = document.getElementById("ng-shortcuts-overlay");
        if (existing) { existing.remove(); return; }

        var overlay = document.createElement("div");
        overlay.id = "ng-shortcuts-overlay";

        var panel = document.createElement("div");
        panel.id = "ng-sc-panel";

        // Header
        var hdr = document.createElement("div");
        hdr.id = "ng-sc-header";
        var title = document.createElement("span");
        title.textContent = "Keyboard Shortcuts";
        var closeBtn = document.createElement("button");
        closeBtn.id = "ng-sc-close";
        var closeIcon = document.createElement("i");
        closeIcon.setAttribute("data-lucide", "x");
        closeBtn.appendChild(closeIcon);
        closeBtn.addEventListener("click", function () { overlay.remove(); });
        hdr.appendChild(title);
        hdr.appendChild(closeBtn);
        panel.appendChild(hdr);

        // Rows
        var list = document.createElement("div");
        list.id = "ng-sc-list";
        SHORTCUTS.forEach(function (row) {
            var div = document.createElement("div");
            div.className = "ng-sc-row";
            var kbd = document.createElement("kbd");
            kbd.textContent = row[0];
            var desc = document.createElement("span");
            desc.textContent = row[1];
            div.appendChild(kbd);
            div.appendChild(desc);
            list.appendChild(div);
        });
        panel.appendChild(list);

        overlay.appendChild(panel);
        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) overlay.remove();
        });
        document.body.appendChild(overlay);
        _refreshIcons();
    }

    // ── onboarding card (delegated to onboarding.js) ────────────────────────
    function _checkOnboarding() {
        if (window.NeuralGraphOnboarding) window.NeuralGraphOnboarding.check();
    }

    function _showOnboarding() {
        if (window.NeuralGraphOnboarding) window.NeuralGraphOnboarding.show();
    }

    // ── new mega-upgrade actions ───────────────────────────────────────────────

    function _loadDemo() {
        if (window.NeuralGraphTestData) window.NeuralGraphTestData.loadDemo();
    }

    function _openKPIs() {
        if (window.KPIManager) window.KPIManager.generateAllKPIs();
    }

    function _openMeting() {
        if (window.MeasurementPanel) window.MeasurementPanel.openBaselineMeasurement();
    }

    function _openBottleneck() {
        if (window.BottleneckDashboard) window.BottleneckDashboard.detect();
    }

    function _openRapport() {
        if (window.ReportExport) window.ReportExport.generateReport();
    }

    var _critPathActive = false;
    function _toggleCriticalPath() {
        _critPathActive = !_critPathActive;
        var b = document.getElementById("ng-tb-kritiek");
        if (b) b.classList.toggle("active", _critPathActive);
        if (!window.NeuralGraph || !window.NeuralGraphTestData) return;
        if (_critPathActive) {
            var nodes = window.NeuralGraph.getAllNodes();
            var edges = window.NeuralGraph.getAllEdges();
            var path  = window.NeuralGraphTestData.findCriticalPath(nodes, edges);
            var pathSet = new Set(path);
            nodes.forEach(function (n) {
                if (pathSet.has(n.id)) {
                    window.NeuralGraph.setNodeColor(n.id, "#ff9900");
                }
            });
        } else {
            // Reset colours via NodeIntelligence if available
            if (window.NodeIntelligence) window.NodeIntelligence.applyHealthVisualization();
            else if (window.NeuralGraph) {
                window.NeuralGraph.getAllNodes().forEach(function (n) {
                    window.NeuralGraph.setNodeColor(n.id, null);
                });
            }
        }
    }

    function _openHealth() {
        if (window.NodeIntelligence) window.NodeIntelligence.applyAll();
    }

    // ── keyboard shortcuts ────────────────────────────────────────────────────
    function _bindKeyboard() {
        document.addEventListener("keydown", function (e) {
            var tag = (e.target && e.target.tagName) ? e.target.tagName : "";
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

            switch (e.key) {
                case "f":
                case "F":
                    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                        e.preventDefault();
                        _toggleFullscreen();
                    }
                    break;

                case "l":
                case "L":
                    if (!e.ctrlKey && !e.metaKey) _toggleLabels();
                    break;

                case " ":
                    e.preventDefault();
                    _togglePhysics();
                    break;

                case "r":
                case "R":
                    if (!e.ctrlKey && !e.metaKey) _resetCamera();
                    break;

                case "e":
                case "E":
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        _exportJSON();
                    }
                    break;

                case "?":
                    _toggleShortcuts();
                    break;

                case "Escape": {
                    var sc = document.getElementById("ng-shortcuts-overlay");
                    if (sc) sc.remove();
                    if (window.NeuralGraphOnboarding) window.NeuralGraphOnboarding.hide();
                    break;
                }
            }
        });

        // Sync fullscreen icon on browser-native exit (Esc key in browser)
        document.addEventListener("fullscreenchange", function () {
            _setIcon(
                "ng-tb-fullscreen",
                document.fullscreenElement ? "minimize-2" : "maximize"
            );
            var fullscreenTitle = document.fullscreenElement
                ? "Exit Fullscreen (F)"
                : "Fullscreen (F)";
            var btn = document.getElementById("ng-tb-fullscreen");
            if (btn) btn.title = fullscreenTitle;
        });
    }

    // ── bootstrap ─────────────────────────────────────────────────────────────
    document.addEventListener("DOMContentLoaded", function () {
        var canvas = document.getElementById("graph-canvas");
        if (!canvas) return;

        // Build toolbar
        var toolbar = document.createElement("div");
        toolbar.id = "ng-toolbar";

        toolbar.appendChild(_btn("ng-tb-fullscreen", "maximize",   "Fullscreen (F)",        _toggleFullscreen));
        toolbar.appendChild(_sep());
        toolbar.appendChild(_btn("ng-tb-labels",     "eye",        "Toggle Labels (L)",     _toggleLabels));
        toolbar.appendChild(_btn("ng-tb-edges",      "link",       "Verbindingen tonen",    _toggleEdges));
        toolbar.appendChild(_btn("ng-tb-physics",    "pause",      "Pause Physics (Space)", _togglePhysics));
        toolbar.appendChild(_btn("ng-tb-reset",      "rotate-ccw", "Reset Camera (R)",      _resetCamera));
        toolbar.appendChild(_sep());
        toolbar.appendChild(_btn("ng-tb-export-json","download",   "Export JSON (Ctrl+E)",  _exportJSON));
        toolbar.appendChild(_btn("ng-tb-export-png", "camera",     "Export PNG",            _exportPNG));
        toolbar.appendChild(_sep());
        toolbar.appendChild(_btn("ng-tb-shortcuts",  "keyboard",        "Shortcuts (?)",               _toggleShortcuts));
        toolbar.appendChild(_sep());
        toolbar.appendChild(_btn("ng-tb-demo",       "play-circle",     "Demo Graph laden",            _loadDemo));
        toolbar.appendChild(_btn("ng-tb-kpis",       "bar-chart-2",     "KPI's genereren",             _openKPIs));
        toolbar.appendChild(_btn("ng-tb-meting",     "clipboard",       "Baseline meting openen",      _openMeting));
        toolbar.appendChild(_btn("ng-tb-bottleneck", "alert-triangle",  "Bottlenecks detecteren",      _openBottleneck));
        toolbar.appendChild(_btn("ng-tb-rapport",    "file-text",       "AI Rapport genereren",        _openRapport));
        toolbar.appendChild(_btn("ng-tb-kritiek",    "git-commit",      "Kritieke route highlighten",  _toggleCriticalPath));
        toolbar.appendChild(_btn("ng-tb-health",     "heart-pulse",     "Health overlay",              _openHealth));

        canvas.appendChild(toolbar);

        _refreshIcons();
        _bindKeyboard();

        // Check onboarding after graph has had time to load
        setTimeout(_checkOnboarding, 900);

        // ── Titlebar live stats ───────────────────────────────────────────
        function _syncTitlebarStats() {
            if (!window.NeuralGraph) return;
            try {
                var nodes = window.NeuralGraph.getAllNodes ? window.NeuralGraph.getAllNodes() : [];
                var edges = window.NeuralGraph.getAllEdges ? window.NeuralGraph.getAllEdges() : [];
                var nEl = document.getElementById("tb-stat-nodes");
                var eEl = document.getElementById("tb-stat-edges");
                if (nEl) nEl.textContent = nodes.length;
                if (eEl) eEl.textContent = edges.length;
                // Also sync legacy statusbar compat elements
                var lcN = document.getElementById("sb-node-count");
                var lcE = document.getElementById("sb-edge-count");
                if (lcN) lcN.textContent = nodes.length;
                if (lcE) lcE.textContent = edges.length;
                // Network pill name
                var pill = document.getElementById("tb-net-name");
                var dot  = document.getElementById("tb-net-dot");
                if (nodes.length > 0) {
                    if (pill) pill.textContent = nodes.length + " nodes geladen";
                    if (dot)  dot.classList.add("active");
                } else {
                    if (pill) pill.textContent = "Geen graph";
                    if (dot)  dot.classList.remove("active");
                }
            } catch (e) { /* swallow */ }
        }
        setInterval(_syncTitlebarStats, 2000);
        document.addEventListener("demo:loaded", function () {
            setTimeout(_syncTitlebarStats, 300);
        });

        // ── Toast global ──────────────────────────────────────────────────
        window.Toast = {
            show: function (message, type, duration) {
                type     = type     || "info";
                duration = duration !== undefined ? duration : 3000;
                var el = document.createElement("div");
                el.className = "toast toast--" + type;
                var icons = { success: "&#10003;", error: "&#10005;", warning: "&#9888;", info: "&#9678;" };
                el.innerHTML =
                    "<span class='toast__icon'>" + (icons[type] || icons.info) + "</span>" +
                    "<span>" + String(message).replace(/</g, "&lt;") + "</span>";
                document.body.appendChild(el);
                setTimeout(function () {
                    el.style.animation = "toast-out 0.15s ease forwards";
                    setTimeout(function () { if (el.parentNode) el.remove(); }, 150);
                }, duration);
            }
        };

        // Wire NeuralGraphUI.showToast → Toast.show if not already set
        if (!window.NeuralGraphUI) window.NeuralGraphUI = {};
        if (!window.NeuralGraphUI.showToast) {
            window.NeuralGraphUI.showToast = function (msg, type) { window.Toast.show(msg, type); };
        }

        window.NeuralGraphToolbar = {
            getLabelsState:  function () { return _labelsOn; },
            getPhysicsState: function () { return _physicsOn; },
            exportJSON:      _exportJSON,
            exportPNG:       _exportPNG,
            showOnboarding:  _showOnboarding,
        };
    });

})();
