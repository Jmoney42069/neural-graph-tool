/*!
 * reportExport.js — Rapport Genereren & PDF Export
 * window.ReportExport = { generateReport, exportPDF, exportStandaloneHTML }
 */
(function () {
    "use strict";

    var _overlay = null;
    var _currentRec = null;

    function _getOverlay() {
        if (_overlay) { _overlay.style.display = "flex"; return _overlay; }
        _overlay = document.createElement("div");
        _overlay.id = "report-overlay";
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
    // Genereer aanbevelingsrapport (SSE stream)
    // ─────────────────────────────────────────────────────────────
    function generateReport(focusArea) {
        var overlay = _getOverlay();
        overlay.style.display = "flex";

        var panel = document.createElement("div");
        panel.className = "kpi-panel";
        panel.style.minWidth = "640px";
        panel.innerHTML = [
            '<div class="kpi-panel-header">',
            '  <h2><i data-lucide="file-text"></i> Aanbevelingen Genereren</h2>',
            '  <button class="kpi-close-btn" onclick="ReportExport.closePanel()"><i data-lucide="x"></i></button>',
            '</div>',
            '<div class="report-stream-body" id="report-stream">',
            '  <div class="report-thinking"><span class="bn-spinner"></span> Analyseren...</div>',
            '</div>',
            '<div class="kpi-actions" id="report-actions" style="display:none">',
            '  <button class="kpi-btn-secondary" onclick="ReportExport.exportPDF()"><i data-lucide="download"></i> PDF exporteren</button>',
            '  <button class="kpi-btn-secondary" onclick="ReportExport.exportStandaloneHTML()"><i data-lucide="globe"></i> HTML exporteren</button>',
            '</div>',
        ].join("");

        overlay.innerHTML = "";
        overlay.appendChild(panel);
        if (window.lucide) window.lucide.createIcons({ el: panel });

        var streamEl = document.getElementById("report-stream");
        var buffer = "";
        var jsonBuf = "";
        var streamDone = false;

        var es = new EventSource("/api/recommendations/generate?"
            + (focusArea ? "focus=" + encodeURIComponent(focusArea) : ""));

        // POST request via fetch (SSE needs server to accept GET or POST)
        // Backend accepts POST, so use fetch + ReadableStream
        es.close();

        fetch("/api/recommendations/generate", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ focus: focusArea || null }),
        }).then(function (res) {
            var reader = res.body.getReader();
            var decoder = new TextDecoder();

            function pump() {
                return reader.read().then(function (result) {
                    if (result.done) {
                        _finishReport(streamEl);
                        return;
                    }
                    var text = decoder.decode(result.value, { stream: true });
                    // Parse SSE events
                    text.split("\n").forEach(function (line) {
                        if (!line.startsWith("data: ")) return;
                        try {
                            var d = JSON.parse(line.slice(6));
                            if (d.type === "thinking") {
                                streamEl.innerHTML = '<div class="report-thinking"><span class="bn-spinner"></span> ' + d.message + '</div>';
                            } else if (d.type === "chunk") {
                                jsonBuf += d.content;
                                // Show real-time streaming text
                                buffer += d.content;
                                streamEl.innerHTML = '<pre class="report-rawjson">' + _escHtml(buffer) + '</pre>';
                            } else if (d.type === "done") {
                                _currentRec = d.recommendations;
                                _renderRecommendations(streamEl, _currentRec);
                                document.getElementById("report-actions").style.display = "flex";
                                if (window.lucide) window.lucide.createIcons({ el: panel });
                            }
                        } catch (e) {}
                    });
                    return pump();
                });
            }
            return pump();
        }).catch(function (err) {
            streamEl.innerHTML = '<div style="color:#ff6060;padding:20px">Generatie mislukt: ' + err.message + '</div>';
        });
    }

    function _finishReport(streamEl) {
        if (!_currentRec) {
            // Probeer gecachte aanbevelingen
            fetch("/api/recommendations/latest")
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (d.ok) {
                        _currentRec = d.recommendations;
                        _renderRecommendations(streamEl, _currentRec);
                        var acts = document.getElementById("report-actions");
                        if (acts) acts.style.display = "flex";
                    }
                }).catch(function () {});
        }
    }

    function _renderRecommendations(el, rec) {
        if (!rec) return;
        var recs   = rec.recommendations || [];
        var summary = rec.executive_summary || "";
        var risks   = rec.risk_areas || [];
        var wins    = rec.quick_wins || [];

        var effortColor = { laag: "#00ff88", middel: "#ffcc00", hoog: "#ff6060" };
        var catIcon = { process:"git-branch", technology:"cpu", people:"users", governance:"shield" };

        var recHTML = recs.map(function (r) {
            var ec = effortColor[r.effort] || "#888";
            var ci = catIcon[r.category] || "circle";
            return [
                '<div class="report-rec-card">',
                '  <div class="report-rec-header">',
                '    <span class="report-rec-num">' + (r.priority || "") + '</span>',
                '    <span class="report-rec-title">' + (r.title || "") + '</span>',
                '    <span class="report-effort-badge" style="color:' + ec + ';border-color:' + ec + '44">' + (r.effort || "") + '</span>',
                '  </div>',
                '  <div class="report-rec-desc">' + (r.description || "") + '</div>',
                '  <div class="report-rec-meta">',
                '    <span>\u23F1 ' + (r.timeframe || "") + '</span>',
                '    <span>\u2192 ' + (r.expected_impact || "") + '</span>',
                '  </div>',
                '</div>',
            ].join("");
        }).join("");

        el.innerHTML = [
            summary ? '<div class="report-summary">' + _escHtml(summary) + '</div>' : "",
            recHTML,
            risks.length ? '<div class="report-section-title">Risico\'s</div><ul class="report-list">'
                + risks.map(function (r) { return '<li>' + _escHtml(r) + '</li>'; }).join("") + "</ul>" : "",
            wins.length ? '<div class="report-section-title">Quick Wins</div><ul class="report-list report-wins">'
                + wins.map(function (w) { return '<li>' + _escHtml(w) + '</li>'; }).join("") + "</ul>" : "",
        ].join("");
    }

    function _escHtml(s) {
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    // ─────────────────────────────────────────────────────────────
    // PDF Export
    // ─────────────────────────────────────────────────────────────
    function exportPDF(title) {
        _toast("PDF rapport genereren...", "info");
        fetch("/api/recommendations/export-pdf", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
                title:                   title || "NeuralGraph Procesrapport",
                include_kpis:            true,
                include_bottlenecks:     true,
                include_recommendations: true,
            }),
        })
        .then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            var disp = r.headers.get("Content-Disposition") || "";
            var match = disp.match(/filename="([^"]+)"/);
            var fname = match ? match[1] : "neuralgraph_rapport.pdf";
            return r.blob().then(function (blob) { return { blob: blob, fname: fname }; });
        })
        .then(function (d) {
            var url = URL.createObjectURL(d.blob);
            var a = document.createElement("a");
            a.href = url;
            a.download = d.fname;
            a.click();
            setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
            _toast("PDF gedownload: " + d.fname, "success");
        })
        .catch(function (err) { _toast("PDF mislukt: " + err.message, "error"); });
    }

    // ─────────────────────────────────────────────────────────────
    // Standalone HTML Export (clientside)
    // ─────────────────────────────────────────────────────────────
    function exportStandaloneHTML() {
        if (!_currentRec) { _toast("Genereer eerst aanbevelingen.", "info"); return; }

        var recs = _currentRec.recommendations || [];
        var rows = recs.map(function (r, i) {
            return "<tr><td>" + (r.priority || i+1) + "</td><td>" + _escHtml(r.title || "") + "</td>"
                 + "<td>" + _escHtml(r.description || "") + "</td><td>" + (r.effort || "") + "</td>"
                 + "<td>" + _escHtml(r.timeframe || "") + "</td></tr>";
        }).join("");

        var html = [
            "<!DOCTYPE html><html lang='nl'><head><meta charset='UTF-8'>",
            "<title>NeuralGraph Rapport</title>",
            "<style>body{font-family:Arial,sans-serif;margin:40px;color:#222}",
            "h1{color:#2244aa}table{border-collapse:collapse;width:100%}",
            "th,td{border:1px solid #ddd;padding:8px 12px;text-align:left}",
            "th{background:#f0f4ff}</style></head><body>",
            "<h1>NeuralGraph Procesrapport</h1>",
            "<p>Gegenereerd: " + new Date().toLocaleDateString("nl-NL") + "</p>",
            _currentRec.executive_summary ? "<blockquote>" + _escHtml(_currentRec.executive_summary) + "</blockquote>" : "",
            "<h2>Aanbevelingen</h2>",
            "<table><thead><tr><th>#</th><th>Titel</th><th>Beschrijving</th><th>Effort</th><th>Tijdlijn</th></tr></thead>",
            "<tbody>" + rows + "</tbody></table>",
            "</body></html>",
        ].join("\n");

        var blob = new Blob([html], { type: "text/html" });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement("a");
        a.href = url;
        a.download = "neuralgraph_rapport_" + new Date().toISOString().slice(0, 10) + ".html";
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        _toast("HTML rapport gedownload", "success");
    }

    // ─────────────────────────────────────────────────────────────
    // Inline stijlen
    // ─────────────────────────────────────────────────────────────
    (function _injectStyles() {
        if (document.getElementById("report-styles")) return;
        var s = document.createElement("style");
        s.id = "report-styles";
        s.textContent = [
            ".report-stream-body{flex:1;overflow-y:auto;padding:16px 22px;min-height:200px}",
            ".report-thinking{display:flex;align-items:center;gap:12px;color:#9090c0;font-size:13px;padding:30px}",
            ".report-rawjson{font-size:10px;color:#909090;white-space:pre-wrap;word-break:break-all;line-height:1.4}",
            ".report-summary{background:rgba(100,120,255,0.08);border-left:3px solid #7878ff;padding:12px 16px;border-radius:4px;color:#c0c0e0;font-size:12px;margin-bottom:16px}",
            ".report-rec-card{background:rgba(255,255,255,0.04);border:1px solid rgba(100,100,200,0.15);border-radius:10px;padding:14px 16px;margin-bottom:10px}",
            ".report-rec-header{display:flex;align-items:center;gap:10px;margin-bottom:6px}",
            ".report-rec-num{width:22px;height:22px;border-radius:50%;background:#7878ff;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}",
            ".report-rec-title{font-size:13px;font-weight:600;color:#d8d8ff;flex:1}",
            ".report-effort-badge{border:1px solid;border-radius:10px;padding:2px 8px;font-size:10px;font-weight:600;text-transform:uppercase}",
            ".report-rec-desc{font-size:12px;color:#a0a0c0;line-height:1.5;margin-bottom:8px}",
            ".report-rec-meta{display:flex;gap:16px;font-size:11px;color:#707080}",
            ".report-section-title{font-size:12px;font-weight:700;color:#9090c0;letter-spacing:0.05em;text-transform:uppercase;margin:16px 0 6px}",
            ".report-list{margin:0;padding-left:20px;color:#a0a0c0;font-size:12px;line-height:1.8}",
            ".report-wins li::marker{color:#00ff88}",
        ].join("\n");
        document.head.appendChild(s);
    })();

    window.ReportExport = {
        generateReport:       generateReport,
        exportPDF:            exportPDF,
        exportStandaloneHTML: exportStandaloneHTML,
        closePanel:           closePanel,
    };

})();
