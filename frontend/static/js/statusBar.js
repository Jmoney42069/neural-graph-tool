/**
 * statusBar.js — Enterprise Status Bar
 * Manages #status-bar: backend health, model name, bottlenecks, saved time
 *
 * Exposes: window.StatusBar
 */
(function () {
    "use strict";

    var _backendOk   = true;
    var _pollTimer   = null;

    function _elSet(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function updateBackendStatus() {
        fetch("/health")
            .then(function (r) {
                _backendOk = r.ok;
                var dot   = document.querySelector("#sb-backend .sb-dot");
                var label = document.querySelector("#sb-backend .sb-label");
                if (dot) {
                    dot.className = r.ok ? "sb-dot sb-dot--ok" : "sb-dot sb-dot--error";
                }
                if (label) {
                    label.textContent = r.ok ? "Backend actief" : "Backend offline";
                }
            })
            .catch(function () {
                _backendOk = false;
                var dot   = document.querySelector("#sb-backend .sb-dot");
                var label = document.querySelector("#sb-backend .sb-label");
                if (dot)   dot.className = "sb-dot sb-dot--error";
                if (label) label.textContent = "Backend offline";
            });
    }

    function updateModelName() {
        fetch("/settings/load")
            .then(function (r) { return r.ok ? r.json() : {}; })
            .catch(function () { return {}; })
            .then(function (s) {
                var model = s.model_chat || s.model_extract || "";
                var short = model ? model.split("/").pop() : "\u2014";
                _elSet("sb-model-name", short);
            });
    }

    function setSaved() {
        var now = new Date();
        var time = now.getHours() + ":" + String(now.getMinutes()).padStart(2, "0");
        _elSet("sb-saved-time", time);
        // Also sync with legacy save label if present
        var legacyLabel = document.getElementById("sb-save-label");
        if (legacyLabel) legacyLabel.textContent = "Opgeslagen " + time;
    }

    function setBottlenecks(count) {
        var el = document.getElementById("sb-bottlenecks");
        if (!el) return;
        el.style.display = count > 0 ? "flex" : "none";
        _elSet("sb-bottleneck-label", count + " bottleneck" + (count !== 1 ? "s" : ""));
    }

    function init() {
        updateBackendStatus();
        updateModelName();

        // Events
        document.addEventListener("graph:saved", function () { setSaved(); });
        document.addEventListener("measurement:saved", function () { setSaved(); });
        document.addEventListener("bottleneck:detected", function (e) {
            var count = (e.detail && e.detail.count) ? e.detail.count : 0;
            setBottlenecks(count);
        });
        document.addEventListener("backend:error", function () {
            var dot   = document.querySelector("#sb-backend .sb-dot");
            var label = document.querySelector("#sb-backend .sb-label");
            if (dot)   dot.className = "sb-dot sb-dot--error";
            if (label) label.textContent = "Backend offline";
        });

        // Poll health every 30 seconds
        _pollTimer = setInterval(updateBackendStatus, 30000);

        // Initial saved time from page load
        setSaved();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    window.StatusBar = {
        init:                 init,
        updateBackendStatus:  updateBackendStatus,
        updateModelName:      updateModelName,
        setSaved:             setSaved,
        setBottlenecks:       setBottlenecks
    };

})();

// ✓ statusBar.js compleet
