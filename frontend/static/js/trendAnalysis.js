/*!
 * trendAnalysis.js — Maandelijkse Meting & Trend Dashboard
 * window.TrendAnalysis = { openMonthlyMeasurement, showTrendDashboard, calculateDelta, renderSparkline, calculateMomentum }
 */
(function () {
    "use strict";

    var _overlay = null;

    function _getOverlay() {
        if (_overlay) { _overlay.style.display = "flex"; return _overlay; }
        _overlay = document.createElement("div");
        _overlay.id = "trend-overlay";
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

    // ─────────────────────────────────────────────────────────────
    // Maandelijkse meting openen (redirect naar MeasurementPanel)
    // ─────────────────────────────────────────────────────────────
    function openMonthlyMeasurement() {
        if (window.MeasurementPanel) {
            window.MeasurementPanel.openMonthlyMeasurement();
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Trend Dashboard
    // ─────────────────────────────────────────────────────────────
    function showTrendDashboard() {
        var overlay = _getOverlay();
        overlay.innerHTML = '<div class="kpi-panel" style="min-width:680px"><div class="kpi-panel-header"><h2>Trends laden...</h2></div></div>';
        overlay.style.display = "flex";

        // Trigger server-side analyse
        fetch("/api/trends/analyze", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({}),
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            _renderTrendDashboard(overlay, data);
        })
        .catch(function () {
            // Probeer bestaande samenvatting te tonen
            fetch("/api/trends/summary")
                .then(function (r) { return r.json(); })
                .then(function (data) { _renderTrendDashboard(overlay, data); })
                .catch(function () { _renderError(overlay, "Trendanalyse mislukt."); });
        });
    }

    function _renderError(overlay, msg) {
        overlay.innerHTML = [
            '<div class="kpi-panel">',
            '  <div class="kpi-panel-header">',
            '    <h2>Trend Analyse</h2>',
            '    <button class="kpi-close-btn" onclick="TrendAnalysis.closePanel()"><i data-lucide="x"></i></button>',
            '  </div>',
            '  <div style="padding:30px;text-align:center;color:#ff6060">' + msg + '</div>',
            '</div>',
        ].join("");
        if (window.lucide) window.lucide.createIcons({ el: overlay });
    }

    function _renderTrendDashboard(overlay, data) {
        var nodes   = data.nodes || data.trends || {};
        var summary = {
            improving: data.improving || 0,
            declining: data.declining || 0,
            stable:    data.stable    || 0,
            total:     data.total_nodes || Object.keys(nodes).length,
        };

        var nodeCards = Object.keys(nodes).filter(function (nid) {
            return Object.keys(nodes[nid].kpis || {}).length > 0;
        }).map(function (nid) {
            return _buildNodeCard(nid, nodes[nid]);
        }).join("") || '<p style="color:#606070;padding:20px;text-align:center">Geen trends beschikbaar. Sla eerst maandelijkse metingen op.</p>';

        var panel = document.createElement("div");
        panel.className = "kpi-panel";
        panel.style.minWidth = "700px";
        panel.style.maxWidth = "900px";
        panel.innerHTML = [
            '<div class="kpi-panel-header">',
            '  <h2><i data-lucide="trending-up"></i> Trend Dashboard</h2>',
            '  <button class="kpi-close-btn" onclick="TrendAnalysis.closePanel()"><i data-lucide="x"></i></button>',
            '</div>',
            '<div class="trend-summary-bar">',
            '  <div class="trend-stat trend-improving"><span class="trend-num">' + summary.improving + '</span>Verbeterend</div>',
            '  <div class="trend-stat trend-stable"><span class="trend-num">' + summary.stable + '</span>Stabiel</div>',
            '  <div class="trend-stat trend-declining"><span class="trend-num">' + summary.declining + '</span>Dalend</div>',
            '  <div class="trend-stat"><span class="trend-num">' + summary.total + '</span>Totaal</div>',
            '</div>',
            '<div class="trend-cards-body">' + nodeCards + '</div>',
            '<div class="kpi-actions">',
            '  <button class="kpi-btn-secondary" onclick="TrendAnalysis.openMonthlyMeasurement()">',
            '    <i data-lucide="clipboard"></i> Nieuwe meting',
            '  </button>',
            '  <button class="kpi-btn-primary" onclick="TrendAnalysis.showTrendDashboard()">',
            '    <i data-lucide="refresh-cw"></i> Verversen',
            '  </button>',
            '</div>',
        ].join("");

        overlay.innerHTML = "";
        overlay.appendChild(panel);
        overlay.style.display = "flex";
        if (window.lucide) window.lucide.createIcons({ el: panel });
    }

    function _buildNodeCard(nid, nodeData) {
        var kpis   = nodeData.kpis || {};
        var names  = Object.keys(kpis);
        if (!names.length) return "";

        var kpiRows = names.map(function (name) {
            var k = kpis[name];
            var arrow = k.trend === "improving" ? "\u2197" : k.trend === "declining" ? "\u2198" : "\u2192";
            var cls   = "trend-" + k.trend;
            var spark = renderSparkline(k.series || []);
            return [
                '<div class="trend-kpi-row">',
                '  <span class="trend-kpi-name">' + name + '</span>',
                '  <span class="trend-sparkline">' + spark + '</span>',
                '  <span class="trend-arrow ' + cls + '">' + arrow + '</span>',
                '  <span class="trend-last">' + (k.last != null ? k.last : "—") + '</span>',
                '  <span class="trend-delta ' + (k.delta_pct >= 0 ? "trend-improving" : "trend-declining") + '">',
                '    ' + (k.delta_pct != null ? (k.delta_pct >= 0 ? "+" : "") + k.delta_pct + "%" : ""),
                '  </span>',
                '</div>',
            ].join("");
        }).join("");

        return [
            '<div class="trend-node-card">',
            '  <div class="trend-node-title">' + nid + '</div>',
            '  ' + kpiRows,
            '</div>',
        ].join("");
    }

    // ─────────────────────────────────────────────────────────────
    // SVG Sparkline helper
    // ─────────────────────────────────────────────────────────────
    function renderSparkline(series) {
        if (!series || series.length < 2) {
            return '<svg width="60" height="20"><line x1="0" y1="10" x2="60" y2="10" stroke="#444" stroke-width="1.5"/></svg>';
        }
        var vals   = series.map(function (s) { return s.value; });
        var minV   = Math.min.apply(null, vals);
        var maxV   = Math.max.apply(null, vals);
        var range  = maxV - minV || 1;
        var w = 60, h = 20, pad = 2;
        var points = vals.map(function (v, i) {
            var x = pad + (i / (vals.length - 1)) * (w - pad * 2);
            var y = h - pad - ((v - minV) / range) * (h - pad * 2);
            return x.toFixed(1) + "," + y.toFixed(1);
        }).join(" ");
        var last   = vals[vals.length - 1];
        var isBetter = last >= vals[0];
        var color  = isBetter ? "#00ff88" : "#ff5555";
        return [
            '<svg width="' + w + '" height="' + h + '">',
            '  <polyline points="' + points + '" fill="none" stroke="' + color + '" stroke-width="1.5"/>',
            '</svg>',
        ].join("");
    }

    // ─────────────────────────────────────────────────────────────
    // Utility functies
    // ─────────────────────────────────────────────────────────────
    function calculateDelta(series) {
        if (!series || series.length < 2) return 0;
        var first = series[0].value, last = series[series.length - 1].value;
        return first !== 0 ? Math.round((last - first) / Math.abs(first) * 100) : 0;
    }

    function calculateMomentum(series) {
        if (!series || series.length < 2) return 50;
        var half   = Math.floor(series.length / 2);
        var early  = series.slice(0, half).reduce(function (a, s) { return a + s.value; }, 0) / half;
        var recent = series.slice(half).reduce(function (a, s) { return a + s.value; }, 0) / (series.length - half);
        return early !== 0 ? Math.min(100, Math.max(0, Math.round(50 * recent / early))) : 50;
    }

    // ─────────────────────────────────────────────────────────────
    // Inline styles
    // ─────────────────────────────────────────────────────────────
    (function _injectStyles() {
        if (document.getElementById("trend-styles")) return;
        var s = document.createElement("style");
        s.id = "trend-styles";
        s.textContent = [
            ".trend-summary-bar{display:flex;gap:0;border-bottom:1px solid rgba(100,100,200,0.15)}",
            ".trend-stat{flex:1;padding:14px 16px;text-align:center;border-right:1px solid rgba(100,100,200,0.1)}",
            ".trend-num{display:block;font-size:24px;font-weight:700;color:#e0e0ff}",
            ".trend-stat{font-size:10px;color:#707090;letter-spacing:0.06em}",
            ".trend-improving .trend-num,.trend-improving{color:#00ff88!important}",
            ".trend-stable .trend-num,.trend-stable{color:#ffcc00!important}",
            ".trend-declining .trend-num,.trend-declining{color:#ff5555!important}",
            ".trend-cards-body{flex:1;overflow-y:auto;padding:14px 22px;display:flex;flex-direction:column;gap:10px}",
            ".trend-node-card{background:rgba(255,255,255,0.04);border-radius:10px;padding:12px 16px;border:1px solid rgba(100,100,200,0.12)}",
            ".trend-node-title{font-size:13px;font-weight:600;color:#d0d0ff;margin-bottom:8px}",
            ".trend-kpi-row{display:grid;grid-template-columns:1fr 70px 24px 60px 60px;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)}",
            ".trend-kpi-name{font-size:11px;color:#a0a0c0}",
            ".trend-arrow{font-size:18px;text-align:center}",
            ".trend-last{font-size:12px;color:#c0c0e0;text-align:right}",
            ".trend-delta{font-size:11px;text-align:right;font-weight:600}",
        ].join("\n");
        document.head.appendChild(s);
    })();

    window.TrendAnalysis = {
        openMonthlyMeasurement: openMonthlyMeasurement,
        showTrendDashboard:     showTrendDashboard,
        calculateDelta:         calculateDelta,
        renderSparkline:        renderSparkline,
        calculateMomentum:      calculateMomentum,
        closePanel:             closePanel,
    };

})();
