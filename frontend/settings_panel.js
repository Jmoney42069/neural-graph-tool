/**
 * settings_panel.js
 * ─────────────────────────────────────────────────────────────────────────
 * All frontend logic for the NeuralGraph settings panel.
 *
 * Responsibilities:
 *   - On startup: call GET /settings/load, populate form, show banner
 *   - Eye toggle for API key field
 *   - Sliders: live value display + immediate GraphPhysics.setConfig() call
 *   - API key format validation
 *   - Save: POST /settings/save → trigger GET /settings/validate → update status
 *   - Cancel: close panel without persisting unsaved edits
 *   - Reset Defaults: restore slider defaults
 *   - Startup "no API key" banner with dismiss and open-settings CTA
 *
 * Sections:
 *   1. CONSTANTS
 *   2. DOM REFS
 *   3. STATUS INDICATOR
 *   4. SLIDER HELPERS
 *   5. POPULATE FORM
 *   6. STARTUP LOAD
 *   7. STARTUP BANNER
 *   8. EYE TOGGLE
 *   9. SLIDER EVENTS
 *  10. SAVE HANDLER
 *  11. CANCEL HANDLER
 *  12. VALIDATE API KEY
 *  13. INIT
 */

(function () {
    "use strict";

    // =====================================================================
    // 1. CONSTANTS
    // =====================================================================

    var API_BASE = "";   // same origin — backend serves the frontend

    var DEFAULTS = {
        repulsion: 1200,
        spring:    45,
        damping:   0.88,
    };

    var GRAPH_MODELS = [
        { value: "anthropic/claude-sonnet-4-6",          label: "Claude Sonnet 4.6 \u2605 Recommended" },
        { value: "anthropic/claude-opus-4-6",            label: "Claude Opus 4.6 \u2014 Most accurate" },
        { value: "openai/gpt-4.1",                       label: "GPT-4.1" },
        { value: "google/gemini-pro-2.5",                label: "Gemini 2.5 Pro" },
        { value: "meta-llama/llama-3.3-70b-instruct",    label: "Llama 3.3 70B \u2014 Fast & free" },
    ];

    // =====================================================================
    // 2. DOM REFS  (resolved lazily after DOMContentLoaded)
    // =====================================================================

    var dom = {};

    function grabDom() {
        dom.panel        = document.getElementById("settings-panel");
        dom.apiKeyInput  = document.getElementById("sp-api-key");
        dom.eyeToggle    = document.getElementById("sp-eye-toggle");
        dom.apiError     = document.getElementById("sp-api-error");
        dom.statusDot    = document.getElementById("sp-status-dot");
        dom.statusText   = document.getElementById("sp-status-text");
        dom.graphModel   = document.getElementById("sp-graph-model");
        dom.chatModel    = document.getElementById("sp-chat-model");
        dom.repulsion    = document.getElementById("sp-repulsion");
        dom.repulsionVal = document.getElementById("sp-repulsion-val");
        dom.spring       = document.getElementById("sp-spring");
        dom.springVal    = document.getElementById("sp-spring-val");
        dom.damping      = document.getElementById("sp-damping");
        dom.dampingVal   = document.getElementById("sp-damping-val");
        dom.resetBtn     = document.getElementById("sp-reset-defaults");
        dom.cancelBtn    = document.getElementById("sp-cancel");
        dom.saveBtn      = document.getElementById("sp-save");
        dom.saveFeedback = document.getElementById("sp-save-feedback");
        dom.app          = document.getElementById("app");
        dom.main         = document.getElementById("main");
    }

    // =====================================================================
    // 3. STATUS INDICATOR
    // =====================================================================

    var STATUS = {
        UNCONFIGURED: { dot: "grey",   text: "Not configured" },
        VALIDATING:   { dot: "yellow", text: "Validating\u2026" },
        CONNECTED:    { dot: "green",  text: "Connected" },
        INVALID:      { dot: "red",    text: "Invalid key" },
        FAILED:       { dot: "red",    text: "Connection failed" },
    };

    function setStatus(s) {
        if (!dom.statusDot || !dom.statusText) return;

        // Reset colour classes
        dom.statusDot.className  = "sp-status-dot " + s.dot;
        dom.statusText.className = "sp-status-text " + s.dot;
        dom.statusText.textContent = s.text;
    }

    // =====================================================================
    // 4. SLIDER HELPERS
    // =====================================================================

    function fmtSlider(id, val) {
        val = parseFloat(val);
        if (id === "sp-damping") return val.toFixed(2);
        return String(Math.round(val));
    }

    function pushPhysicsConfig() {
        if (!window.GraphPhysics || typeof window.GraphPhysics.setConfig !== "function") return;
        window.GraphPhysics.setConfig({
            repulsionStrength: parseFloat(dom.repulsion.value),
            restLength:        parseFloat(dom.spring.value),
            dampingFactor:     parseFloat(dom.damping.value),
        });
    }

    // =====================================================================
    // 5. POPULATE FORM
    // =====================================================================

    function populateForm(settings) {
        // ── Model dropdowns ──────────────────────────────────────────────
        if (settings.graph_model && dom.graphModel) {
            dom.graphModel.value = settings.graph_model;
        }
        if (settings.chat_model && dom.chatModel) {
            dom.chatModel.value = settings.chat_model;
        }

        // ── Physics sliders ──────────────────────────────────────────────
        var p = settings.physics || {};

        if (p.repulsion_strength !== undefined) {
            dom.repulsion.value       = p.repulsion_strength;
            dom.repulsionVal.textContent = fmtSlider("sp-repulsion", p.repulsion_strength);
        }
        if (p.spring_length !== undefined) {
            dom.spring.value       = p.spring_length;
            dom.springVal.textContent = fmtSlider("sp-spring", p.spring_length);
        }
        if (p.damping !== undefined) {
            dom.damping.value       = p.damping;
            dom.dampingVal.textContent = fmtSlider("sp-damping", p.damping);
        }
    }

    // =====================================================================
    // 6. STARTUP LOAD   GET /settings/load
    // =====================================================================

    function loadSettings() {
        return fetch(API_BASE + "/settings/load", { method: "GET" })
            .then(function (r) {
                if (!r.ok) throw new Error("HTTP " + r.status);
                return r.json();
            })
            .then(function (data) {
                populateForm(data);

                if (data.api_key_saved) {
                    setStatus(STATUS.CONNECTED);
                    hideBanner();
                } else {
                    setStatus(STATUS.UNCONFIGURED);
                    showBanner();
                }
            })
            .catch(function (err) {
                console.warn("[NeuralGraph] Could not load settings:", err);
                // Backend not running — panel shows defaults; no banner needed
                // (this path is hit when opening index.html directly as a file)
            });
    }

    // =====================================================================
    // 7. STARTUP BANNER
    // =====================================================================

    var _banner = null;

    function showBanner() {
        if (_banner || document.getElementById("ng-api-banner")) return;

        _banner = document.createElement("div");
        _banner.id = "ng-api-banner";
        _banner.innerHTML =
            "<span class=\"ng-banner-text\">\u26A0 No API key configured \u2014 open Settings to get started</span>" +
            "<button class=\"ng-banner-cta\" id=\"ng-banner-open\">Open Settings</button>" +
            "<button class=\"ng-banner-dismiss\" id=\"ng-banner-close\" title=\"Dismiss\">&times;</button>";

        var mainEl = dom.main;
        dom.app.insertBefore(_banner, mainEl);

        document.getElementById("ng-banner-close").addEventListener("click", hideBanner);
        document.getElementById("ng-banner-open").addEventListener("click", function () {
            hideBanner();
            openSettingsPanel();
        });
    }

    function hideBanner() {
        var el = document.getElementById("ng-api-banner");
        if (el) {
            el.parentNode.removeChild(el);
        }
        _banner = null;
    }

    // =====================================================================
    // 8. EYE TOGGLE
    // =====================================================================

    function initEyeToggle() {
        if (!dom.eyeToggle || !dom.apiKeyInput) return;
        dom.eyeToggle.addEventListener("click", function () {
            var isPassword = dom.apiKeyInput.type === "password";
            dom.apiKeyInput.type = isPassword ? "text" : "password";
            // Toggle the emoji: open eye ↔ closed eye
            dom.eyeToggle.textContent = isPassword ? "\uD83D\uDE48" : "\uD83D\uDC41";
        });
    }

    // =====================================================================
    // 9. SLIDER EVENTS
    // =====================================================================

    function initSliders() {
        // Use "input" for live feedback, "change" also fires on keyboard nav
        [dom.repulsion, dom.spring, dom.damping].forEach(function (slider) {
            if (!slider) return;
            slider.addEventListener("input", function () {
                var valEl = document.getElementById(slider.id + "-val");
                if (valEl) valEl.textContent = fmtSlider(slider.id, slider.value);
                pushPhysicsConfig();
            });
        });

        if (dom.resetBtn) {
            dom.resetBtn.addEventListener("click", function () {
                dom.repulsion.value       = DEFAULTS.repulsion;
                dom.repulsionVal.textContent = String(DEFAULTS.repulsion);
                dom.spring.value       = DEFAULTS.spring;
                dom.springVal.textContent = String(DEFAULTS.spring);
                dom.damping.value       = DEFAULTS.damping;
                dom.dampingVal.textContent = DEFAULTS.damping.toFixed(2);
                pushPhysicsConfig();
            });
        }
    }

    // =====================================================================
    // 10. SAVE HANDLER
    // =====================================================================

    function validateKeyFormat(key) {
        if (!key) return null;  // empty means "don't update the key" — ok
        if (key.length < 8 || key.indexOf("sk-or-") !== 0) {
            return "API key must start with \u201Csk-or-\u201D";
        }
        return null;
    }

    function showFeedback(msg, type) {
        if (!dom.saveFeedback) return;
        dom.saveFeedback.textContent = msg;
        dom.saveFeedback.className = "sp-save-feedback " + (type || "");
    }

    function clearFeedback() {
        showFeedback("", "");
    }

    function initSaveButton() {
        if (!dom.saveBtn) return;
        dom.saveBtn.addEventListener("click", function () {
            clearFeedback();

            var rawKey = dom.apiKeyInput ? dom.apiKeyInput.value.trim() : "";

            // Client-side format validation
            var keyError = validateKeyFormat(rawKey);
            if (keyError) {
                if (dom.apiError) dom.apiError.textContent = keyError;
                if (dom.apiKeyInput) dom.apiKeyInput.classList.add("has-error");
                return;
            }
            if (dom.apiError) dom.apiError.textContent = "";
            if (dom.apiKeyInput) dom.apiKeyInput.classList.remove("has-error");

            var payload = {
                graph_model: dom.graphModel ? dom.graphModel.value : "anthropic/claude-sonnet-4-6",
                chat_model:  dom.chatModel  ? dom.chatModel.value  : "meta-llama/llama-3.3-70b-instruct",
                physics: {
                    repulsion_strength: parseFloat(dom.repulsion.value),
                    spring_length:      parseFloat(dom.spring.value),
                    damping:            parseFloat(dom.damping.value),
                },
            };

            if (rawKey) {
                payload.openrouter_api_key = rawKey;
            }

            // Disable button during request
            dom.saveBtn.disabled = true;
            dom.saveBtn.classList.add("loading");
            dom.saveBtn.textContent = "Saving";

            fetch(API_BASE + "/settings/save", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify(payload),
            })
                .then(function (r) {
                    if (!r.ok) {
                        return r.json().then(function (errBody) {
                            var msg = (errBody && errBody.detail && errBody.detail.error)
                                ? errBody.detail.error
                                : (r.status === 422 ? "Ongeldige API key notatie" : "HTTP " + r.status);
                            throw new Error(msg);
                        }, function () { throw new Error("HTTP " + r.status); });
                    }
                    return r.json();
                })
                .then(function (data) {
                    dom.saveBtn.disabled = false;
                    dom.saveBtn.classList.remove("loading");
                    dom.saveBtn.textContent = "Save Settings";

                    // Toast success notification
                    if (window.NeuralGraphUI && window.NeuralGraphUI.showToast) {
                        window.NeuralGraphUI.showToast("API key opgeslagen \u2713", "success");
                    }
                    showFeedback("Instellingen opgeslagen.", "success");

                    // Show "filled" placeholder instead of clearing to blank
                    if (dom.apiKeyInput) {
                        dom.apiKeyInput.value       = "";
                        dom.apiKeyInput.placeholder = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
                        dom.apiKeyInput.type        = "password";
                        if (dom.eyeToggle) dom.eyeToggle.textContent = "\uD83D\uDC41";
                    }

                    var keySaved = data.success || data.api_key_saved || data.has_api_key;
                    if (keySaved) {
                        hideBanner();
                        validateApiKey();
                        // Notify other modules (e.g. chatPanel) that a key was saved
                        document.dispatchEvent(new CustomEvent("ng:key_saved"));
                    } else {
                        setStatus(STATUS.UNCONFIGURED);
                    }
                })
                .catch(function (err) {
                    dom.saveBtn.disabled = false;
                    dom.saveBtn.classList.remove("loading");
                    dom.saveBtn.textContent = "Save Settings";
                    var msg = err.message || "Opslaan mislukt \u2014 is de server actief?";
                    showFeedback(msg, "error");
                    if (window.NeuralGraphUI && window.NeuralGraphUI.showToast) {
                        window.NeuralGraphUI.showToast(msg, "error");
                    }
                    console.error("[NeuralGraph] save settings error:", err);
                });
        });
    }

    // =====================================================================
    // 11. CANCEL HANDLER + TEST BUTTON
    // =====================================================================

    function initTestButton() {
        var testBtn = document.getElementById("sp-test-key");
        if (!testBtn) return;
        testBtn.addEventListener("click", function () {
            testBtn.disabled = true;
            testBtn.textContent = "Testen\u2026";
            validateApiKey().then(function () {
                testBtn.disabled = false;
                testBtn.textContent = "Test verbinding";
            });
        });
    }

    function initCancelButton() {
        if (!dom.cancelBtn) return;
        dom.cancelBtn.addEventListener("click", function () {
            clearFeedback();
            if (dom.apiError)    dom.apiError.textContent = "";
            if (dom.apiKeyInput) dom.apiKeyInput.classList.remove("has-error");
            closeSettingsPanel();
        });
    }

    // =====================================================================
    // 12. VALIDATE API KEY  GET /settings/validate
    // =====================================================================

    function validateApiKey() {
        setStatus(STATUS.VALIDATING);

        return fetch(API_BASE + "/settings/validate", { method: "GET" })
            .then(function (r) {
                if (!r.ok) throw new Error("HTTP " + r.status);
                return r.json();
            })
            .then(function (data) {
                if (data.valid) {
                    setStatus(STATUS.CONNECTED);
                } else {
                    var msg = data.error || "Invalid key";
                    if (msg.toLowerCase().indexOf("invalid") !== -1) {
                        setStatus(STATUS.INVALID);
                    } else {
                        setStatus(STATUS.FAILED);
                    }
                }
            })
            .catch(function () {
                setStatus(STATUS.FAILED);
            });
    }

    // =====================================================================
    // 13. OPEN / CLOSE PANEL  (these complement the existing toggle in index.html)
    // =====================================================================

    function openSettingsPanel() {
        var panel = document.getElementById("settings-panel");
        if (panel) panel.classList.add("active");
    }

    function closeSettingsPanel() {
        var panel = document.getElementById("settings-panel");
        if (panel) panel.classList.remove("active");
    }

    // Expose so other modules (e.g. index.html inline script) can call these
    window.SettingsPanel = {
        open:  openSettingsPanel,
        close: closeSettingsPanel,
    };

    // =====================================================================
    // INIT — wire everything up after DOM is ready
    // =====================================================================

    function init() {
        grabDom();

        // Only run if the settings panel HTML is present
        if (!dom.panel) return;

        initEyeToggle();
        initSliders();
        initSaveButton();
        initCancelButton();
        initTestButton();
        loadSettings();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

})();
