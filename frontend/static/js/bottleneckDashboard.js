/*!
 * bottleneckDashboard.js — Bottleneck Detectie & Visualisatie
 * window.BottleneckDashboard = { detect, render, calculateSeverity, highlight, closePanel }
 */
(function () {
    "use strict";

    var _overlay = null;
    var _lastReport = null;

    function _getOverlay() {
        if (_overlay) { _overlay.style.display = "flex"; return _overlay; }
        _overlay = document.createElement("div");
        _overlay.id = "bn-overlay";
        _overlay.className = "kpi-overlay";
        _overlay.addEventListener("click", function (e) {
            if (e.target === _overlay) closePanel();
        });
        document.body.appendChild(_overlay);
        return _overlay;
    }

    function closePanel() {
        if (_overlay) _overlay.style.display = "none";
    }

    function _toast(msg, type) {
        if (window.NeuralGraphUI && window.NeuralGraphUI.showToast)
            window.NeuralGraphUI.showToast(msg, type || "info");
    }

    // ─────────────────────────────────────────────────────────────
    // Detecteer bottlenecks (via server)
    // ─────────────────────────────────────────────────────────────
    function detect() {
        var overlay = _getOverlay();
        overlay.innerHTML = [
            '<div class="kpi-panel bn-panel">',
            '  <div class="kpi-panel-header">',
            '    <h2><i data-lucide="alert-triangle"></i> Bottleneck Detectie</h2>',
            '    <button class="kpi-close-btn" onclick="BottleneckDashboard.closePanel()"><i data-lucide="x"></i></button>',
            '  </div>',
            '  <div class="bn-loading">Analyseren... <span class="bn-spinner"></span></div>',
            '</div>',
        ].join("");
        overlay.style.display = "flex";
        if (window.lucide) window.lucide.createIcons({ el: overlay });

        // Eerst intelligence analyse zodat betweenness up-to-date is
        fetch("/api/intelligence/analyze", { method: "POST" })
            .then(function () {
                return fetch("/api/bottleneck/detect", { method: "POST" });
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                _lastReport = data;
                _renderDashboard(overlay, data);
                _highlight(data.bottlenecks || []);
            })
            .catch(function (err) {
                overlay.innerHTML = [
                    '<div class="kpi-panel">',
                    '  <div class="kpi-panel-header"><h2>Bottleneck Detectie</h2>',
                    '    <button class="kpi-close-btn" onclick="BottleneckDashboard.closePanel()"><i data-lucide="x"></i></button>',
                    '  </div>',
                    '  <div style="padding:30px;color:#ff6060;text-align:center">Detectie mislukt: ' + err.message + '</div>',
                    '</div>',
                ].join("");
                if (window.lucide) window.lucide.createIcons({ el: overlay });
            });
    }

    // ─────────────────────────────────────────────────────────────
    // Render het dashboard
    // ─────────────────────────────────────────────────────────────
    function _renderDashboard(overlay, data) {
        var bns   = data.bottlenecks || [];
        var counts = data.counts || {};

        var critical = bns.filter(function (b) { return b.severity >= 60; });
        var moderate = bns.filter(function (b) { return b.severity >= 30 && b.severity < 60; });
        var low      = bns.filter(function (b) { return b.severity < 30; });

        var typeColors = { structural:"#ff6060", temporal:"#ffaa00", hidden:"#aa88ff", performance:"#66aaff" };
        var typeLabels = { structural:"Structureel", temporal:"Temporeel", hidden:"Verborgen", performance:"Performance" };

        var rows = bns.map(function (b) {
            var bar = _severityBar(b.severity);
            return [
                '<tr class="bn-row bn-sev-' + (b.severity >= 60 ? "critical" : b.severity >= 30 ? "moderate" : "low") + '"',
                '    onclick="BottleneckDashboard.focusNode(\'' + b.node_id + '\')">',
                '  <td class="bn-node-cell">' + (b.label || b.node_id) + '</td>',
                '  <td><span class="bn-type-badge" style="background:' + (typeColors[b.type] || "#888") + '33;color:' + (typeColors[b.type] || "#888") + '">' + (typeLabels[b.type] || b.type) + '</span></td>',
                '  <td class="bn-reason-cell">' + (b.reason || "") + '</td>',
                '  <td>' + bar + '</td>',
                '</tr>',
            ].join("");
        }).join("");

        var panel = document.createElement("div");
        panel.className = "kpi-panel bn-panel";
        panel.innerHTML = [
            '<div class="kpi-panel-header">',
            '  <h2><i data-lucide="alert-triangle"></i> Bottleneck Dashboard</h2>',
            '  <button class="kpi-close-btn" onclick="BottleneckDashboard.closePanel()"><i data-lucide="x"></i></button>',
            '</div>',
            // Summary stats
            '<div class="bn-stat-bar">',
            '  <div class="bn-stat bn-sev-critical-bg"><span class="trend-num">' + critical.length + '</span>Kritiek</div>',
            '  <div class="bn-stat bn-sev-moderate-bg"><span class="trend-num">' + moderate.length + '</span>Matig</div>',
            '  <div class="bn-stat bn-sev-low-bg"><span class="trend-num">' + low.length + '</span>Laag</div>',
            '  <div class="bn-stat"><span class="trend-num">' + bns.length + '</span>Totaal</div>',
            '</div>',
            // Type breakdown
            '<div class="bn-type-bar">',
            ['structural','temporal','hidden','performance'].map(function (t) {
                return '<div class="bn-type-chip" style="background:' + (typeColors[t] || "#888") + '22;border-color:' + (typeColors[t] || "#888") + '55;color:' + (typeColors[t] || "#888") + '">'
                     + (typeLabels[t] || t) + ' <strong>' + (counts[t] || 0) + '</strong></div>';
            }).join(""),
            '</div>',
            // Table
            '<div class="bn-table-body">',
            bns.length ? [
                '<table class="bn-table">',
                '<thead><tr><th>Node</th><th>Type</th><th>Reden</th><th>Ernst</th></tr></thead>',
                '<tbody>' + rows + '</tbody>',
                '</table>',
            ].join("") : '<p class="kpi-empty">Geen bottlenecks gedetecteerd. Graph ziet er gezond uit!</p>',
            '</div>',
            '<div class="kpi-actions">',
            '  <button class="kpi-btn-secondary" onclick="BottleneckDashboard.detect()"><i data-lucide="refresh-cw"></i> Opnieuw</button>',
            '  <button class="kpi-btn-primary" onclick="ReportExport.generateReport()"><i data-lucide="file-text"></i> Rapport</button>',
            '</div>',
        ].join("");

        overlay.innerHTML = "";
        overlay.appendChild(panel);
        if (window.lucide) window.lucide.createIcons({ el: panel });
    }

    function _severityBar(severity) {
        var color = severity >= 60 ? "#ff6060" : severity >= 30 ? "#ffaa00" : "#66aaff";
        return [
            '<div class="bn-sev-bar">',
            '  <div class="bn-sev-fill" style="width:' + severity + '%;background:' + color + '"></div>',
            '  <span class="bn-sev-num">' + severity + '</span>',
            '</div>',
        ].join("");
    }

    // ─────────────────────────────────────────────────────────────
    // Highlight bottleneck nodes in 3D viewer
    // ─────────────────────────────────────────────────────────────
    function _highlight(bottlenecks) {
        if (!window.NeuralGraph) return;
        bottlenecks.forEach(function (b) {
            if (window.NeuralGraph.highlightNode) {
                window.NeuralGraph.highlightNode(b.node_id, true);
            }
            if (window.NeuralGraph.setNodeColor) {
                var color = b.severity >= 60 ? 0xff3333 : b.severity >= 30 ? 0xff8800 : 0x4488ff;
                window.NeuralGraph.setNodeColor(b.node_id, color);
            }
        });
    }

    function focusNode(nodeId) {
        if (window.NeuralGraph && window.NeuralGraph.focusNode) {
            window.NeuralGraph.focusNode(nodeId);
        }
        closePanel();
    }

    function render(data) {
        if (!data) {
            detect();
            return;
        }
        _lastReport = data;
        _renderDashboard(_getOverlay(), data);
        _getOverlay().style.display = "flex";
    }

    function calculateSeverity(node) {
        if (!_lastReport) return 0;
        var found = (_lastReport.bottlenecks || []).find(function (b) {
            return b.node_id === (node.id || node);
        });
        return found ? found.severity : 0;
    }

    window.BottleneckDashboard = {
        detect:           detect,
        render:           render,
        calculateSeverity: calculateSeverity,
        highlight:        _highlight,
        focusNode:        focusNode,
        closePanel:       closePanel,
    };

})();
