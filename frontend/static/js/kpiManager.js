/*!
 * kpiManager.js — KPI Generatie & Goedkeuring
 * window.KPIManager = { generateAllKPIs, showApprovalScreen, showNodeKPIPanel, openKPIPanel }
 */
(function () {
    "use strict";

    var _panel = null;
    var _overlay = null;
    var _kpiData = {};    // nodeId → { kpis: [] }

    // ─────────────────────────────────────────────────────────────
    // DOM helpers
    // ─────────────────────────────────────────────────────────────
    function _createOverlay() {
        if (_overlay) { _overlay.style.display = "flex"; return _overlay; }
        _overlay = document.createElement("div");
        _overlay.id = "kpi-overlay";
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
        if (window.NeuralGraphUI && window.NeuralGraphUI.showToast) {
            window.NeuralGraphUI.showToast(msg, type || "info");
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Genereer alle KPIs (SSE stream)
    // ─────────────────────────────────────────────────────────────
    function generateAllKPIs() {
        var overlay = _createOverlay();

        var panel = document.createElement("div");
        panel.className = "kpi-panel kpi-generate-panel";
        panel.innerHTML = [
            '<div class="kpi-panel-header">',
            '  <h2><i data-lucide="bar-chart-2"></i> KPI Generatie</h2>',
            '  <button class="kpi-close-btn" onclick="KPIManager.closePanel()"><i data-lucide="x"></i></button>',
            '</div>',
            '<div class="kpi-progress-area">',
            '  <div class="kpi-progress-label">Initialiseren...</div>',
            '  <div class="kpi-progress-bar"><div class="kpi-progress-fill" id="kpi-fill" style="width:0%"></div></div>',
            '  <div class="kpi-node-log" id="kpi-log"></div>',
            '</div>',
            '<div class="kpi-actions" id="kpi-actions" style="display:none">',
            '  <button class="kpi-btn-primary" onclick="KPIManager.showApprovalScreen()">',
            '    <i data-lucide="check-circle"></i> Bekijk & Keur goed',
            '  </button>',
            '</div>',
        ].join("");

        overlay.innerHTML = "";
        overlay.appendChild(panel);
        overlay.style.display = "flex";
        if (window.lucide) window.lucide.createIcons({ el: panel });

        var fill  = document.getElementById("kpi-fill");
        var label = panel.querySelector(".kpi-progress-label");
        var log   = document.getElementById("kpi-log");

        var es = new EventSource("/api/kpi/generate-all");
        es.onmessage = function (e) {
            var d = JSON.parse(e.data);
            if (d.type === "progress") {
                var pct = Math.round(d.current / d.total * 100);
                fill.style.width = pct + "%";
                label.textContent = "Bezig: " + d.label + " (" + d.current + "/" + d.total + ")";
            } else if (d.type === "node_done") {
                _kpiData[d.node_id] = { kpis: d.kpis };
                var item = document.createElement("div");
                item.className = "kpi-log-item";
                item.textContent = "\u2713 " + d.node_id + " — " + d.kpis.length + " KPI's";
                log.appendChild(item);
                log.scrollTop = log.scrollHeight;
            } else if (d.type === "done") {
                es.close();
                fill.style.width = "100%";
                label.textContent = "Gereed — " + d.total + " nodes verwerkt";
                document.getElementById("kpi-actions").style.display = "flex";
                _toast("KPIs gegenereerd voor " + d.total + " nodes", "success");
            } else if (d.type === "error") {
                es.close();
                label.textContent = "Fout: " + d.message;
                _toast("KPI generatie mislukt: " + d.message, "error");
            }
        };
        es.onerror = function () {
            es.close();
            label.textContent = "Verbinding verloren.";
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Goedkeuringsscherm (approval)
    // ─────────────────────────────────────────────────────────────
    function showApprovalScreen() {
        fetch("/api/kpi/all")
            .then(function (r) { return r.json(); })
            .then(function (data) {
                _kpiData = data.kpis || {};
                _renderApprovalPanel(_kpiData);
            })
            .catch(function () { _renderApprovalPanel(_kpiData); });
    }

    function _renderApprovalPanel(kpiData) {
        var overlay = _createOverlay();
        var nodeIds = Object.keys(kpiData);

        var rows = nodeIds.map(function (nid) {
            var entry = kpiData[nid];
            var kpis  = (entry && entry.kpis) || [];
            var kpiRows = kpis.map(function (k, i) {
                var checked = k.approved ? "checked" : "";
                return [
                    '<tr class="kpi-kpi-row" data-node="' + nid + '" data-idx="' + i + '">',
                    '  <td><input type="checkbox" class="kpi-approve-cb" ' + checked + '></td>',
                    '  <td>' + (k.name || "") + '</td>',
                    '  <td class="kpi-meta">' + (k.unit || "") + '</td>',
                    '  <td class="kpi-meta">' + (k.target || "") + '</td>',
                    '  <td><span class="kpi-badge kpi-cat-' + (k.category || "other") + '">' + (k.category || "") + '</span></td>',
                    '</tr>',
                ].join("");
            }).join("");

            return [
                '<tr class="kpi-node-row">',
                '  <td colspan="5"><strong>' + (entry && entry.label ? entry.label : nid) + '</strong></td>',
                '</tr>',
                kpiRows,
            ].join("");
        }).join("");

        var panel = document.createElement("div");
        panel.className = "kpi-panel kpi-approval-panel";
        panel.innerHTML = [
            '<div class="kpi-panel-header">',
            '  <h2><i data-lucide="check-square"></i> KPI Goedkeuring</h2>',
            '  <button class="kpi-close-btn" onclick="KPIManager.closePanel()"><i data-lucide="x"></i></button>',
            '</div>',
            '<div class="kpi-approval-body">',
            '  <table class="kpi-table">',
            '    <thead><tr><th>✓</th><th>KPI</th><th>Eenheid</th><th>Target</th><th>Categorie</th></tr></thead>',
            '    <tbody>' + rows + '</tbody>',
            '  </table>',
            '</div>',
            '<div class="kpi-actions">',
            '  <button class="kpi-btn-secondary" id="kpi-select-all">Alles selecteren</button>',
            '  <button class="kpi-btn-primary" id="kpi-save-btn"><i data-lucide="save"></i> Opslaan</button>',
            '</div>',
        ].join("");

        overlay.innerHTML = "";
        overlay.appendChild(panel);
        overlay.style.display = "flex";
        if (window.lucide) window.lucide.createIcons({ el: panel });

        document.getElementById("kpi-select-all").addEventListener("click", function () {
            panel.querySelectorAll(".kpi-approve-cb").forEach(function (cb) { cb.checked = true; });
        });

        document.getElementById("kpi-save-btn").addEventListener("click", function () {
            _saveApprovedKPIs(panel, kpiData);
        });
    }

    function _saveApprovedKPIs(panel, kpiData) {
        var promises = [];
        panel.querySelectorAll(".kpi-kpi-row").forEach(function (row) {
            var nid = row.dataset.node;
            var idx = parseInt(row.dataset.idx, 10);
            var cb  = row.querySelector(".kpi-approve-cb");
            if (kpiData[nid] && kpiData[nid].kpis) {
                kpiData[nid].kpis[idx].approved = cb.checked;
            }
        });

        Object.keys(kpiData).forEach(function (nid) {
            var entry = kpiData[nid];
            promises.push(
                fetch("/api/kpi/save", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ node_id: nid, kpis: entry.kpis || [] }),
                })
            );
        });

        Promise.all(promises).then(function () {
            _toast("KPIs opgeslagen", "success");
            closePanel();
        }).catch(function () {
            _toast("Opslaan mislukt", "error");
        });
    }

    // ─────────────────────────────────────────────────────────────
    // KPI paneel voor één node (vanuit node-inspector)
    // ─────────────────────────────────────────────────────────────
    function showNodeKPIPanel(nodeId) {
        if (!nodeId) return;
        fetch("/api/kpi/node/" + encodeURIComponent(nodeId))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                _renderNodeKPIPanel(nodeId, data.kpis || []);
            })
            .catch(function () {
                _renderNodeKPIPanel(nodeId, []);
            });
    }

    function _renderNodeKPIPanel(nodeId, kpis) {
        var overlay = _createOverlay();

        var kpiRows = kpis.map(function (k) {
            var gauge = _gaugeHTML(k);
            return [
                '<div class="kpi-node-kpi">',
                '  <div class="kpi-node-kpi-title">' + (k.name || "") + '</div>',
                '  <div class="kpi-node-kpi-desc">' + (k.description || "") + '</div>',
                '  ' + gauge,
                '  <div class="kpi-node-kpi-meta">',
                '    <span>Target: <strong>' + (k.target || "—") + ' ' + (k.unit || "") + '</strong></span>',
                '    <span class="kpi-badge kpi-cat-' + (k.category || "other") + '">' + (k.category || "") + '</span>',
                '  </div>',
                '</div>',
            ].join("");
        }).join("");

        var panel = document.createElement("div");
        panel.className = "kpi-panel kpi-node-panel";
        panel.innerHTML = [
            '<div class="kpi-panel-header">',
            '  <h2><i data-lucide="bar-chart-2"></i> KPIs — ' + nodeId + '</h2>',
            '  <button class="kpi-close-btn" onclick="KPIManager.closePanel()"><i data-lucide="x"></i></button>',
            '</div>',
            '<div class="kpi-node-kpis">',
            kpis.length ? kpiRows : '<p class="kpi-empty">Geen KPIs gevonden. Genereer eerst KPIs via de toolbar.</p>',
            '</div>',
            '<div class="kpi-actions">',
            '  <button class="kpi-btn-secondary" onclick="KPIManager.generateAllKPIs()">',
            '    <i data-lucide="refresh-cw"></i> KPIs genereren',
            '  </button>',
            '</div>',
        ].join("");

        overlay.innerHTML = "";
        overlay.appendChild(panel);
        overlay.style.display = "flex";
        if (window.lucide) window.lucide.createIcons({ el: panel });
    }

    function _gaugeHTML(kpi) {
        var target  = parseFloat(kpi.target) || 100;
        var pct     = Math.min(100, Math.round((target / (target * 1.5)) * 100));
        var color   = pct >= 80 ? "#00ff88" : pct >= 50 ? "#ffcc00" : "#ff3333";
        var circum  = 2 * Math.PI * 22;
        var dash    = (pct / 100) * circum;

        return [
            '<svg class="kpi-gauge" width="60" height="60" viewBox="0 0 60 60">',
            '  <circle cx="30" cy="30" r="22" fill="none" stroke="#2a2a4a" stroke-width="4"/>',
            '  <circle cx="30" cy="30" r="22" fill="none" stroke="' + color + '" stroke-width="4"',
            '    stroke-dasharray="' + dash.toFixed(1) + ' ' + circum.toFixed(1) + '"',
            '    stroke-linecap="round" transform="rotate(-90 30 30)"/>',
            '  <text x="30" y="34" text-anchor="middle" font-size="11" fill="#e0e0ff">' + pct + '%</text>',
            '</svg>',
        ].join("");
    }

    // ─────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────
    window.KPIManager = {
        generateAllKPIs:    generateAllKPIs,
        showApprovalScreen: showApprovalScreen,
        showNodeKPIPanel:   showNodeKPIPanel,
        openKPIPanel:       showNodeKPIPanel,
        closePanel:         closePanel,
    };

})();
