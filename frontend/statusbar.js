/**
 * statusbar.js — Bottom Status Bar for NeuralGraph
 *
 * Wires up the #ng-statusbar:
 *  - Live node/edge counts (polled every 2 s)
 *  - Critical-path node count (computed once after graph loads)
 *  - Selected-node display (via window.onNodeSelect hook)
 *  - Save state indicator (via NeuralGraphState hooks)
 *  - Action buttons: Analyse, Health, Export
 *
 * Depends on: neuralGraph3D.js, testData.js, toolbar.js,
 *             bottleneckDashboard.js, nodeIntelligence.js, autosave.js
 */
(function () {
    "use strict";

    /* ------------------------------------------------------------------ */
    /*  Category colour map (mirrors neuralGraph3D.js CAT_COLOR, as hex)   */
    /* ------------------------------------------------------------------ */
    var CAT_CSS_COLOR = {
        product:    "#4f8ef7",
        customer:   "#b44ff7",
        process:    "#f7a04f",
        compliance: "#f74f6a",
        finance:    "#4ff7a0",
    };

    /* ------------------------------------------------------------------ */
    /*  Element refs (resolved after DOMContentLoaded)                      */
    /* ------------------------------------------------------------------ */
    var elNodeCount, elEdgeCount, elPathCount,
        elSelectedContent, elSaveStatus,
        btnBottleneck, btnHealth, btnExport;

    /* ------------------------------------------------------------------ */
    /*  Save-state integration                                              */
    /* ------------------------------------------------------------------ */
    var _saveState = "saved"; // "saved" | "unsaved" | "saving"

    function _setSaveState(state, label) {
        _saveState = state;
        if (!elSaveStatus) return;
        elSaveStatus.className   = ""; // clear classes
        elSaveStatus.id          = "sb-save-status";
        elSaveStatus.classList.add(state);

        var icons = { saved: "✓", unsaved: "●", saving: "↑" };
        var labels = {
            saved:   "Opgeslagen",
            unsaved: "Niet opgeslagen",
            saving:  "Opslaan…",
        };
        elSaveStatus.innerHTML =
            "<span style='font-size:11px;margin-right:3px'>" +
            (icons[state] || "") + "</span>" +
            "<span id='sb-save-label'>" + (label || labels[state] || "") + "</span>";
    }

    function _patchAutosave() {
        // Wrap NeuralGraphState to intercept dirty/save events
        var orig = window.NeuralGraphState;
        if (!orig) return;

        var origMarkDirty  = orig.markDirty.bind(orig);
        var origForceSave  = orig.forceSave.bind(orig);

        orig.markDirty = function () {
            origMarkDirty();
            _setSaveState("unsaved");
        };
        orig.forceSave = function () {
            _setSaveState("saving");
            // intercept with patched promise-like polling
            origForceSave();
            setTimeout(function () {
                if (_saveState === "saving") _setSaveState("saved");
            }, 3500);
        };
    }

    /* ------------------------------------------------------------------ */
    /*  Count updater                                                       */
    /* ------------------------------------------------------------------ */
    function _refreshCounts() {
        if (!window.NeuralGraph) return;
        try {
            var nodes = window.NeuralGraph.getAllNodes   ? window.NeuralGraph.getAllNodes() : [];
            var edges = window.NeuralGraph.getAllEdges   ? window.NeuralGraph.getAllEdges() : [];
            if (elNodeCount) elNodeCount.textContent = nodes.length;
            if (elEdgeCount) elEdgeCount.textContent = edges.length;
        } catch (e) { /* swallow */ }
    }

    /* ------------------------------------------------------------------ */
    /*  Critical-path count                                                 */
    /* ------------------------------------------------------------------ */
    function _computeCriticalPath() {
        if (!window.NeuralGraphTestData || !window.NeuralGraph) return;
        try {
            var nodes = window.NeuralGraph.getAllNodes();
            var edges = window.NeuralGraph.getAllEdges();
            var result = window.NeuralGraphTestData.findCriticalPath(nodes, edges);
            if (result && result.path && elPathCount) {
                elPathCount.textContent = result.path.length + " stappen";
            }
        } catch (e) { /* swallow */ }
    }

    /* ------------------------------------------------------------------ */
    /*  Selected-node display                                               */
    /* ------------------------------------------------------------------ */
    function _showSelectedNode(nodeData) {
        if (!elSelectedContent) return;
        if (!nodeData) {
            elSelectedContent.innerHTML =
                "<span class='ng-sb-no-selection'>Geen node geselecteerd</span>";
            return;
        }

        // Fetch description from full node list
        var description = "";
        if (window.NeuralGraph && window.NeuralGraph.getAllNodes) {
            try {
                var all = window.NeuralGraph.getAllNodes();
                var found = all.filter(function (n) { return n.id === nodeData.id; })[0];
                if (found) description = found.description || "";
            } catch (e) { /* swallow */ }
        }

        var color = CAT_CSS_COLOR[nodeData.category] || "#cccccc";
        var catLabel = nodeData.category
            ? nodeData.category.charAt(0).toUpperCase() + nodeData.category.slice(1)
            : "";
        var descHtml = description
            ? "<span class='ng-sb-node-desc' title='" +
              description.replace(/'/g, "&#39;") + "'>" +
              _esc(description) + "</span>"
            : "";

        elSelectedContent.innerHTML =
            "<div class='ng-sb-selected-node-info'>" +
            "<span class='ng-sb-node-dot' style='color:" + color + ";background:" + color + "'></span>" +
            "<span class='ng-sb-node-label'>" + _esc(nodeData.label || nodeData.id) + "</span>" +
            (catLabel ? "<span class='ng-sb-node-cat'>" + _esc(catLabel) + "</span>" : "") +
            (descHtml ? "<span class='ng-sb-divider'></span>" + descHtml : "") +
            "</div>";
    }

    function _esc(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    /* ------------------------------------------------------------------ */
    /*  Hook into window.onNodeSelect                                       */
    /* ------------------------------------------------------------------ */
    function _hookNodeSelect() {
        var prev = window.onNodeSelect;
        window.onNodeSelect = function (nodeData) {
            _showSelectedNode(nodeData);
            if (typeof prev === "function") prev(nodeData);
        };
    }

    /* ------------------------------------------------------------------ */
    /*  Button handlers                                                     */
    /* ------------------------------------------------------------------ */
    function _wireButtons() {
        if (btnBottleneck) {
            btnBottleneck.addEventListener("click", function () {
                if (window.BottleneckDashboard && window.BottleneckDashboard.detect)
                    window.BottleneckDashboard.detect();
            });
        }
        if (btnHealth) {
            btnHealth.addEventListener("click", function () {
                if (window.NodeIntelligence && window.NodeIntelligence.applyAll)
                    window.NodeIntelligence.applyAll();
            });
        }
        if (btnExport) {
            btnExport.addEventListener("click", function () {
                if (window.NeuralGraphToolbar && window.NeuralGraphToolbar.exportJSON)
                    window.NeuralGraphToolbar.exportJSON();
            });
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                                */
    /* ------------------------------------------------------------------ */
    function _init() {
        elNodeCount      = document.getElementById("sb-node-count");
        elEdgeCount      = document.getElementById("sb-edge-count");
        elPathCount      = document.getElementById("sb-path-count");
        elSelectedContent = document.getElementById("sb-selected-content");
        elSaveStatus     = document.getElementById("sb-save-status");
        btnBottleneck    = document.getElementById("sb-btn-bottleneck");
        btnHealth        = document.getElementById("sb-btn-health");
        btnExport        = document.getElementById("sb-btn-export");

        // Initial save indicator
        _setSaveState("saved");

        // Hook selection before graph initialises (safe — init may have already run)
        _hookNodeSelect();

        // Wire action buttons
        _wireButtons();

        // Poll counts every 2 s
        setInterval(_refreshCounts, 2000);
        _refreshCounts();

        // Wait for testData to load graph, then compute critical path
        // testData.js dispatches 'demo:loaded' after loadDemoGraph completes
        document.addEventListener("demo:loaded", function () {
            setTimeout(_computeCriticalPath, 200);
            setTimeout(_refreshCounts, 200);
            _setSaveState("saved");
        });

        // Patch autosave after a tick (autosave.js initialises on DOMContentLoaded)
        setTimeout(_patchAutosave, 100);

        // Fallback: retry critical path once graph might be ready
        setTimeout(function () {
            _refreshCounts();
            _computeCriticalPath();
        }, 3000);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", _init);
    } else {
        _init();
    }

})();
