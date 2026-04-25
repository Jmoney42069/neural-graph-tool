/*!
 * measurementPanel.js — 0-Meting Baseline & Maandelijkse Metingen
 * window.MeasurementPanel = { openBaselineMeasurement, openMonthlyMeasurement, calculateCompleteness, showBlindSpots }
 */
(function () {
    "use strict";

    var _overlay = null;
    var _currentMeasurementId = null;

    // ─────────────────────────────────────────────────────────────
    // Overlay helper
    // ─────────────────────────────────────────────────────────────
    function _getOverlay() {
        if (_overlay) { _overlay.style.display = "flex"; return _overlay; }
        _overlay = document.createElement("div");
        _overlay.id = "meas-overlay";
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
    // Laad KPIs en graph nodes
    // ─────────────────────────────────────────────────────────────
    function _loadKPIsAndNodes(callback) {
        Promise.all([
            fetch("/api/kpi/all").then(function (r) { return r.json(); }),
        ]).then(function (results) {
            var kpiData = results[0].kpis || {};
            callback(kpiData);
        }).catch(function () { callback({}); });
    }

    // ─────────────────────────────────────────────────────────────
    // Openstaande metingen ophalen
    // ─────────────────────────────────────────────────────────────
    function _loadMeasurements(callback) {
        fetch("/api/measurements/all")
            .then(function (r) { return r.json(); })
            .then(function (d) { callback(d.measurements || []); })
            .catch(function () { callback([]); });
    }

    // ─────────────────────────────────────────────────────────────
    // 0-Meting (baseline)
    // ─────────────────────────────────────────────────────────────
    function openBaselineMeasurement() {
        _openMeasurementPanel("baseline");
    }

    function openMonthlyMeasurement() {
        _openMeasurementPanel("monthly");
    }

    function _openMeasurementPanel(type) {
        var overlay = _getOverlay();
        overlay.innerHTML = '<div class="kpi-panel" style="min-width:560px"><div class="kpi-panel-header"><h2>Laden...</h2></div></div>';
        overlay.style.display = "flex";

        _loadKPIsAndNodes(function (kpiData) {
            var nodeIds = Object.keys(kpiData).filter(function (nid) {
                return (kpiData[nid].kpis || []).some(function (k) { return k.approved !== false; });
            });

            if (!nodeIds.length) {
                _renderEmptyPanel(overlay, "Geen goedgekeurde KPIs gevonden. Genereer eerst KPIs via de toolbar.");
                return;
            }

            var title  = type === "baseline" ? "0-Meting Baseline" : "Maandelijkse Meting";
            var period = type === "baseline" ? "baseline-" + new Date().getFullYear()
                                             : new Date().toISOString().slice(0, 7);

            // Maak meetronde aan op server
            fetch("/api/measurements/create", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ title: title, period: period, type: type }),
            })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d.ok) throw new Error("Aanmaken mislukt");
                _currentMeasurementId = d.measurement.id;
                _renderMeasurementForm(overlay, d.measurement, kpiData, nodeIds);
            })
            .catch(function () {
                _renderEmptyPanel(overlay, "Meetronde aanmaken mislukt. Controleer de server.");
            });
        });
    }

    function _renderEmptyPanel(overlay, msg) {
        var panel = document.createElement("div");
        panel.className = "kpi-panel";
        panel.innerHTML = [
            '<div class="kpi-panel-header">',
            '  <h2>Meting</h2>',
            '  <button class="kpi-close-btn" onclick="MeasurementPanel.closePanel()"><i data-lucide="x"></i></button>',
            '</div>',
            '<div style="padding:30px;text-align:center;color:#606080">' + msg + '</div>',
        ].join("");
        overlay.innerHTML = "";
        overlay.appendChild(panel);
        if (window.lucide) window.lucide.createIcons({ el: panel });
    }

    function _renderMeasurementForm(overlay, measurement, kpiData, nodeIds) {
        var formRows = nodeIds.map(function (nid) {
            var entry = kpiData[nid] || {};
            var label = entry.label || nid;
            var kpis  = (entry.kpis || []).filter(function (k) { return k.approved !== false; });

            var kpiInputs = kpis.map(function (k, i) {
                return [
                    '<div class="meas-kpi-row">',
                    '  <label class="meas-kpi-label">' + (k.name || "") + ' <span class="kpi-meta">(' + (k.unit || "") + ', target: ' + (k.target || "—") + ')</span></label>',
                    '  <input type="number" class="meas-input" step="any" placeholder="Waarde"',
                    '    data-node="' + nid + '" data-kpi="' + (k.name || "").replace(/"/g, "&quot;") + '" data-unit="' + (k.unit || "") + '">',
                    '  <input type="text" class="meas-notes-input" placeholder="Notitie (optioneel)"',
                    '    data-node="' + nid + '" data-kpi-notes="' + (k.name || "").replace(/"/g, "&quot;") + '">',
                    '</div>',
                ].join("");
            }).join("");

            return [
                '<div class="meas-node-section">',
                '  <div class="meas-node-title">' + label + '</div>',
                '  ' + kpiInputs,
                '</div>',
            ].join("");
        }).join("");

        var completenessDiv = '<div class="meas-completeness">Compleetheid: <span id="meas-pct">0%</span></div>';

        var panel = document.createElement("div");
        panel.className = "kpi-panel";
        panel.style.minWidth = "580px";
        panel.innerHTML = [
            '<div class="kpi-panel-header">',
            '  <h2><i data-lucide="clipboard"></i> ' + measurement.title + ' — ' + measurement.period + '</h2>',
            '  <button class="kpi-close-btn" onclick="MeasurementPanel.closePanel()"><i data-lucide="x"></i></button>',
            '</div>',
            completenessDiv,
            '<div class="meas-form-body">' + formRows + '</div>',
            '<div class="kpi-actions">',
            '  <button class="kpi-btn-secondary" id="meas-save-draft"><i data-lucide="save"></i> Opslaan als concept</button>',
            '  <button class="kpi-btn-primary" id="meas-save-final"><i data-lucide="check-circle"></i> Definitief opslaan</button>',
            '</div>',
        ].join("");

        overlay.innerHTML = "";
        overlay.appendChild(panel);
        if (window.lucide) window.lucide.createIcons({ el: panel });

        // Completeness tracking
        panel.querySelectorAll(".meas-input").forEach(function (inp) {
            inp.addEventListener("input", function () {
                var all    = panel.querySelectorAll(".meas-input").length;
                var filled = 0;
                panel.querySelectorAll(".meas-input").forEach(function (i) { if (i.value !== "") filled++; });
                var pct = all ? Math.round(filled / all * 100) : 0;
                var el = document.getElementById("meas-pct");
                if (el) el.textContent = pct + "%";
            });
        });

        document.getElementById("meas-save-draft").addEventListener("click", function () {
            _collectAndSave(panel, measurement.id, "draft");
        });
        document.getElementById("meas-save-final").addEventListener("click", function () {
            _collectAndSave(panel, measurement.id, "final");
        });
    }

    function _collectAndSave(panel, measId, status) {
        var values = [];
        panel.querySelectorAll(".meas-input").forEach(function (inp) {
            var val = inp.value;
            if (val === "") return;
            var notesInp = panel.querySelector('[data-kpi-notes="' + inp.dataset.kpi + '"][data-node="' + inp.dataset.node + '"]');
            values.push({
                node_id:  inp.dataset.node,
                kpi_name: inp.dataset.kpi,
                value:    parseFloat(val),
                unit:     inp.dataset.unit || null,
                notes:    notesInp ? notesInp.value : null,
            });
        });

        fetch("/api/measurements/save", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ measurement_id: measId, values: values, status: status }),
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.ok) {
                _toast("Meting opgeslagen (" + d.completeness + "% compleet)", "success");
                if (status === "final") closePanel();
            }
        })
        .catch(function () { _toast("Opslaan mislukt", "error"); });
    }

    // ─────────────────────────────────────────────────────────────
    // Blind spots (nodes zonder KPIs)
    // ─────────────────────────────────────────────────────────────
    function showBlindSpots() {
        var overlay = _getOverlay();
        Promise.all([
            fetch("/api/kpi/all").then(function (r) { return r.json(); }),
        ]).then(function (results) {
            var kpiData = results[0].kpis || {};
            var allNodes = window.NeuralGraph ? window.NeuralGraph.getAllNodes() : [];
            var blind = allNodes.filter(function (n) {
                var e = kpiData[n.id];
                return !e || !e.kpis || e.kpis.length === 0;
            });

            var panel = document.createElement("div");
            panel.className = "kpi-panel";
            panel.innerHTML = [
                '<div class="kpi-panel-header">',
                '  <h2><i data-lucide="eye-off"></i> Blind Spots</h2>',
                '  <button class="kpi-close-btn" onclick="MeasurementPanel.closePanel()"><i data-lucide="x"></i></button>',
                '</div>',
                '<div style="padding:16px 22px;flex:1;overflow-y:auto">',
                '<p style="color:#808090;font-size:12px;margin-bottom:12px">',
                blind.length + ' nodes hebben geen KPIs ingesteld.</p>',
                blind.map(function (n) {
                    return '<div style="padding:6px;border-bottom:1px solid rgba(255,255,255,0.05);color:#b0b0c0;font-size:12px">'
                         + n.id + ' — ' + (n.label || n.id) + '</div>';
                }).join(""),
                '</div>',
                '<div class="kpi-actions">',
                '  <button class="kpi-btn-primary" onclick="KPIManager.generateAllKPIs()">',
                '    <i data-lucide="play-circle"></i> KPIs genereren',
                '  </button>',
                '</div>',
            ].join("");

            overlay.innerHTML = "";
            overlay.appendChild(panel);
            overlay.style.display = "flex";
            if (window.lucide) window.lucide.createIcons({ el: panel });
        }).catch(function () {});
    }

    function calculateCompleteness(measId) {
        return fetch("/api/measurements/" + encodeURIComponent(measId))
            .then(function (r) { return r.json(); })
            .then(function (d) { return d.measurement ? d.measurement.completeness : 0; })
            .catch(function () { return 0; });
    }

    // ─────────────────────────────────────────────────────────────
    // Inline styles voor measurement form (geen aparte CSS nodig)
    // ─────────────────────────────────────────────────────────────
    (function _injectMeasStyles() {
        if (document.getElementById("meas-styles")) return;
        var s = document.createElement("style");
        s.id = "meas-styles";
        s.textContent = [
            ".meas-completeness{padding:8px 22px;font-size:11px;color:#7878ff;background:rgba(100,100,200,0.08);text-align:right;letter-spacing:0.05em}",
            ".meas-form-body{flex:1;overflow-y:auto;padding:14px 22px}",
            ".meas-node-section{margin-bottom:18px}",
            ".meas-node-title{font-size:13px;font-weight:600;color:#d0d0ff;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid rgba(100,100,200,0.2)}",
            ".meas-kpi-row{display:grid;grid-template-columns:1fr 130px 160px;gap:8px;align-items:center;margin-bottom:6px}",
            ".meas-kpi-label{font-size:11px;color:#a0a0c0}",
            ".meas-input,.meas-notes-input{background:rgba(255,255,255,0.06);border:1px solid rgba(100,100,200,0.2);border-radius:6px;padding:6px 10px;color:#e0e0ff;font-family:inherit;font-size:11px;outline:none}",
            ".meas-input:focus,.meas-notes-input:focus{border-color:rgba(120,120,255,0.5);background:rgba(255,255,255,0.09)}",
        ].join("\n");
        document.head.appendChild(s);
    })();

    // Public API
    window.MeasurementPanel = {
        openBaselineMeasurement: openBaselineMeasurement,
        openMonthlyMeasurement:  openMonthlyMeasurement,
        calculateCompleteness:   calculateCompleteness,
        showBlindSpots:          showBlindSpots,
        closePanel:              closePanel,
    };

})();
