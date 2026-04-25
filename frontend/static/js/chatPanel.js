// FILE: chatPanel.js
// DOES: Full chat UI — header, mode toggle, message feed, typewriter, source cards, input
// USES: window.NeuralGraph (highlights, focusNode), EventSource, fetch streaming
// EXPOSES: window.NeuralGraphChat = { send, refreshStats }

(function () {
    "use strict";

    // ── Category colours (match nodes.js) ──────────────────────────────────
    var CAT_COLOR = {
        product:    "#4f8ef7",
        process:    "#f7a04f",
        compliance: "#f74f6a",
        finance:    "#4ff7a0",
        customer:   "#b44ff7",
        person:     "#ff9f7f",
        system:     "#7fcfff",
        location:   "#ffcf7f",
        concept:    "#e0e0ff",
    };

    // ── State ──────────────────────────────────────────────────────────────
    var _mode            = "graph";   // "graph" | "query"
    var _history         = [];        // only used in graph-builder mode
    var _isStreaming     = false;
    var _currentES       = null;
    var _typeQueue       = "";
    var _typeTimer       = null;
    var _dom             = {};
    var _smartQuestions  = [];        // voorgestelde vragen voor Network Query modus
    var _HISTORY_KEY     = "ng_chat_history"; // localStorage key

    // ── DOM helpers ────────────────────────────────────────────────────────
    function _el(tag, attrs, children) {
        var el = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                if      (k === "class") el.className = attrs[k];
                else if (k === "text")  el.textContent = attrs[k];
                else                    el.setAttribute(k, attrs[k]);
            });
        }
        if (Array.isArray(children)) {
            children.forEach(function (c) { if (c) el.appendChild(c); });
        } else if (typeof children === "string") {
            el.textContent = children;
        }
        return el;
    }

    function _esc(s) {
        return String(s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function _lucideIcon(name, size) {
        var i = document.createElement("i");
        i.setAttribute("data-lucide", name);
        i.style.cssText = "width:" + size + "px;height:" + size + "px;pointer-events:none;";
        return i;
    }

    // ── Build panel ────────────────────────────────────────────────────────
    function _build() {
        var panel = document.getElementById("chat-panel");
        if (!panel) return;
        panel.innerHTML = "";

        // Enterprise header with title + mode switch
        var header = _el("div", { class: "chat-panel__header" }, [
            _el("span", { class: "chat-panel__title" }, "Network Query"),
            _el("div", { class: "chat-panel__mode-switch" }, [
                _el("button", { id: "mode-graph", class: "mode-btn", "data-mode": "graph" }, "Builder"),
                _el("button", { id: "mode-query", class: "mode-btn mode-btn--active", "data-mode": "query" }, "Query"),
            ]),
            _el("button", { id: "chat-settings-btn", class: "chat-icon-btn", title: "Settings" }, [
                _lucideIcon("settings", 14),
            ]),
        ]);
        panel.appendChild(header);

        // Stats row
        panel.appendChild(_el("div", { id: "chat-header", style: "display:none" }, [
            _el("div", { class: "chat-header-left" }, [
                _el("span", { id: "chat-stats", class: "chat-stats" }, "0 nodes · 0 edges"),
            ]),
        ]));

        // Smart questions bar (Network Query modus)
        var sqBar = document.createElement("div");
        sqBar.id = "chat-smart-questions";
        sqBar.className = "chat-sq-bar";
        sqBar.style.display = "none";
        panel.appendChild(sqBar);

        // Message feed
        panel.appendChild(_el("div", { id: "chat-feed" }));

        // Enterprise input area
        panel.appendChild(_el("div", { class: "chat-panel__input-area", id: "chat-input-area" }, [
            _el("textarea", {
                id: "chat-input",
                class: "chat-input-enterprise",
                placeholder: "Stel een vraag aan je netwerk\u2026",
                rows: "1",
                autocomplete: "off",
            }),
            _el("button", { id: "chat-send", class: "chat-send-enterprise", title: "Verzenden (Enter)" }, [
                (function () {
                    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                    svg.setAttribute("viewBox", "0 0 14 14");
                    svg.setAttribute("width", "13");
                    svg.setAttribute("height", "13");
                    svg.setAttribute("fill", "none");
                    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                    path.setAttribute("d", "M3 7h8M8 4l3 3-3 3");
                    path.setAttribute("stroke", "currentColor");
                    path.setAttribute("stroke-width", "1.6");
                    path.setAttribute("stroke-linecap", "round");
                    svg.appendChild(path);
                    return svg;
                })()
            ]),
        ]));

        // Cache refs
        _dom.feed        = document.getElementById("chat-feed");
        _dom.input       = document.getElementById("chat-input");
        _dom.sendBtn     = document.getElementById("chat-send");
        _dom.stats       = document.getElementById("chat-stats");
        _dom.modeGraph   = document.getElementById("mode-graph");
        _dom.modeQuery   = document.getElementById("mode-query");
        _dom.settingsBtn    = document.getElementById("chat-settings-btn");
        _dom.smartQBar      = document.getElementById("chat-smart-questions");

        // Wire events
        _dom.modeGraph.addEventListener("click", function () { _setMode("graph"); });
        _dom.modeQuery.addEventListener("click", function () {
            _setMode("query");
            if (_smartQuestions.length === 0) loadSmartQuestions();
        });
        _dom.sendBtn.addEventListener("click", _send);

        _dom.input.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); _send(); }
        });
        _dom.input.addEventListener("input", function () {
            _dom.input.style.height = "auto";
            _dom.input.style.height = Math.min(_dom.input.scrollHeight, 120) + "px";
        });

        _dom.settingsBtn.addEventListener("click", function () {
            var sp = document.getElementById("settings-panel");
            if (sp) sp.classList.toggle("active");
        });

        // Herstel chat geschiedenis
        _loadChatHistory();
        // Welcome
        _addMsg("chat-msg--system", "Ready. Upload data and start asking questions.");
    }

    // ── Mode ───────────────────────────────────────────────────────────────
    function _setMode(m) {
        _mode = m;
        _dom.modeGraph.classList.toggle("mode-btn--active", m === "graph");
        _dom.modeQuery.classList.toggle("mode-btn--active", m === "query");
        _dom.modeGraph.classList.remove("active");
        _dom.modeQuery.classList.remove("active");
        // Toon/verberg smart questions bar
        if (_dom.smartQBar) {
            _dom.smartQBar.style.display = (m === "query" && _smartQuestions.length) ? "flex" : "none";
        }
    }

    // ── Stats ──────────────────────────────────────────────────────────────
    function _refreshStats() {
        if (!_dom.stats) return;
        var n = window.NeuralGraph ? window.NeuralGraph.getAllNodes().length : 0;
        var e = window.NeuralGraph ? window.NeuralGraph.getAllEdges().length : 0;
        _dom.stats.textContent = n + " nodes · " + e + " edges";
    }

    // ── Message helpers ─────────────────────────────────────────────────────
    function _addMsg(cls, html, isHtml) {
        var el = document.createElement("div");
        el.className = "chat-msg " + cls;
        if (isHtml) el.innerHTML = html;
        else        el.textContent = html;
        _dom.feed.appendChild(el);
        _dom.feed.scrollTop = _dom.feed.scrollHeight;
        return el;
    }

    function _addAiEl() {
        return _addMsg("chat-msg--ai", "");
    }

    function _addSources(sources) {
        if (!sources || !sources.length) return;
        var html = "<div class='sources-header'>── SOURCES ──────────────</div>";
        sources.forEach(function (s) {
            var col = CAT_COLOR[s.category] || "#8a8aba";
            html +=
                "<div class='source-item' data-id='" + _esc(s.id) + "'>" +
                    "<span class='source-dot' style='background:" + col + "'></span>" +
                    "<span class='source-label'>" + _esc(s.label || s.id) + "</span>" +
                    "<span class='source-cat' style='color:" + col + "'>[" + _esc(s.category || "") + "]</span>" +
                "</div>";
            // Pulse animatie op de 3D node bij ontvangst van sources
            if (window.NeuralGraph && window.NeuralGraph.highlightNode) {
                window.NeuralGraph.highlightNode(s.id, true);
            }
        });
        html += "<div class='sources-footer'>─────────────────────────</div>";
        var el = _addMsg("chat-msg--sources", html, true);
        el.querySelectorAll(".source-item").forEach(function (item) {
            item.addEventListener("click", function () {
                var id = item.getAttribute("data-id");
                if (id && window.NeuralGraph) {
                    window.NeuralGraph.focusNode(id);
                    window.NeuralGraph.highlightNode(id);
                }
            });
        });
    }

    // ── Typewriter ──────────────────────────────────────────────────────────
    function _typewrite(el, text) {
        _typeQueue += text;
        if (_typeTimer) return;
        _typeTimer = setInterval(function () {
            if (!_typeQueue.length) {
                clearInterval(_typeTimer);
                _typeTimer = null;
                return;
            }
            el.textContent += _typeQueue[0];
            _typeQueue = _typeQueue.slice(1);
            _dom.feed.scrollTop = _dom.feed.scrollHeight;
        }, 15);
    }

    function _flushTypewriter(el) {
        if (_typeTimer) { clearInterval(_typeTimer); _typeTimer = null; }
        if (_typeQueue.length) {
            el.textContent += _typeQueue;
            _typeQueue      = "";
        }
        // Post-process [[node]] refs into clickable highlight chips
        _renderNodeRefs(el);
        _dom.feed.scrollTop = _dom.feed.scrollHeight;
    }

    // Convert [[Label]] → clickable .ng-highlight-ref span
    function _renderNodeRefs(el) {
        var raw = el.textContent;
        if (!raw || raw.indexOf("[[") === -1) return;
        var html = raw.replace(/\[\[([^\]]+)\]\]/g, function (_, label) {
            var safe = label.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
            return '<span class="ng-highlight-ref" data-label="' + safe + '">' + safe + '</span>';
        });
        // Only replace markup if there are actual refs
        if (html !== raw) {
            el.innerHTML = html;
            el.querySelectorAll(".ng-highlight-ref").forEach(function (chip) {
                chip.addEventListener("click", function () {
                    var lbl = chip.getAttribute("data-label");
                    if (!window.NeuralGraph) return;
                    // Try to find node by label
                    var nodes = window.NeuralGraph.getAllNodes ? window.NeuralGraph.getAllNodes() : [];
                    var node = nodes.find(function (n) {
                        return (n.label || "").toLowerCase() === (lbl || "").toLowerCase();
                    });
                    if (node) window.NeuralGraph.focusNode(node.id);
                });
            });
        }
    }

    // ── Send ────────────────────────────────────────────────────────────────
    function _send(msg) {
        var text = (typeof msg === "string") ? msg.trim() : (_dom.input ? _dom.input.value.trim() : "");
        if (!text || _isStreaming) return;

        if (_dom.input) { _dom.input.value = ""; _dom.input.style.height = "auto"; }
        _addMsg("chat-msg--user", text);

        if (_mode === "graph") _streamGraph(text);
        else                   _streamQuery(text);
    }

    // ── Graph Builder stream (GET /chat/stream via EventSource) ────────────
    function _streamGraph(message) {
        _isStreaming = true;
        _dom.sendBtn.disabled = true;
        if (window.EdgeManager) window.EdgeManager.setThinking(true);

        var histParam = encodeURIComponent(JSON.stringify(_history.slice(-18)));
        var worldParam = (window.WorldManager ? window.WorldManager.getCurrent() : "demo");
        var url = "/chat/stream?message=" + encodeURIComponent(message) +
                  "&conversation_history=" + histParam +
                  "&world=" + encodeURIComponent(worldParam);

        if (_currentES) { _currentES.close(); _currentES = null; }
        var es = new EventSource(url);
        _currentES = es;

        var aiEl = _addAiEl();
        _typeQueue = "";

        es.onmessage = function (evt) {
            var p; try { p = JSON.parse(evt.data); } catch (e) { return; }

            if (p.type === "token") {
                _typewrite(aiEl, p.content || "");
            } else if (p.type === "highlight") {
                (p.node_ids || []).forEach(function (id) {
                    if (window.NeuralGraph) window.NeuralGraph.highlightNode(id);
                });
            } else if (p.type === "sources") {
                _flushTypewriter(aiEl);
                _addSources(p.sources);
                _refreshStats();
            } else if (p.type === "done") {
                _flushTypewriter(aiEl);
                _history.push({ role: "user",      content: message });
                _history.push({ role: "assistant", content: aiEl.textContent });
                _done(es);
            } else if (p.type === "error") {
                _flushTypewriter(aiEl);
                aiEl.textContent = p.message || "An error occurred.";
                aiEl.className = "chat-msg chat-msg--error";
                _done(es);
            }
        };

        es.onerror = function () {
            _flushTypewriter(aiEl);
            if (!aiEl.textContent) aiEl.textContent = "Connection lost.";
            _done(es);
        };
    }

    // ── Network Query stream (POST /api/query/ask via fetch SSE) ───────────
    function _streamQuery(message) {
        _isStreaming = true;
        _dom.sendBtn.disabled = true;
        if (window.EdgeManager) window.EdgeManager.setThinking(true);

        var aiEl    = _addAiEl();
        var thinkEl = null;
        _typeQueue  = "";

        fetch("/api/query/ask", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
                question: message,
                world: (window.WorldManager ? window.WorldManager.getCurrent() : "demo"),
            }),
        })
        .then(function (resp) {
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            var reader  = resp.body.getReader();
            var decoder = new TextDecoder();
            var buffer  = "";

            function read() {
                reader.read().then(function (res) {
                    if (res.done) { _flushTypewriter(aiEl); _doneSimple(); return; }
                    buffer += decoder.decode(res.value, { stream: true });
                    var parts = buffer.split("\n\n");
                    buffer = parts.pop();

                    parts.forEach(function (part) {
                        var m = part.match(/^data:\s*([\s\S]*)/m);
                        if (!m) return;
                        var p; try { p = JSON.parse(m[1]); } catch (e) { return; }

                        if (p.type === "thinking") {
                            var kw  = (p.keywords || []).slice(0, 4).join(", ");
                            var cnt = p.node_count || 0;
                            if (!thinkEl) {
                                thinkEl = document.createElement("div");
                                thinkEl.className = "chat-msg chat-msg--thinking";
                                thinkEl.innerHTML =
                                    '<div class="chat-thinking-dots">' +
                                    '<span></span><span></span><span></span>' +
                                    '</div><span class="chat-thinking-text"></span>';
                                _dom.feed.appendChild(thinkEl);
                                _dom.feed.scrollTop = _dom.feed.scrollHeight;
                            }
                            var t = thinkEl.querySelector(".chat-thinking-text");
                            if (t) t.textContent = kw ? kw + " \u00b7 " + cnt + " nodes" : "Analyzing\u2026";
                        } else if (p.type === "chunk") {
                            if (thinkEl) { thinkEl.remove(); thinkEl = null; }
                            _typewrite(aiEl, p.content || "");
                        } else if (p.type === "highlight") {
                            (p.node_ids || []).forEach(function (id) {
                                if (window.NeuralGraph) window.NeuralGraph.highlightNode(id);
                            });
                        } else if (p.type === "sources") {
                            _flushTypewriter(aiEl);
                            if (thinkEl) { thinkEl.remove(); thinkEl = null; }
                            _addSources(p.sources);
                            _refreshStats();
                        } else if (p.type === "done") {
                            _flushTypewriter(aiEl);
                            _doneSimple();
                        } else if (p.type === "error") {
                            _flushTypewriter(aiEl);
                            if (thinkEl) { thinkEl.remove(); thinkEl = null; }
                            aiEl.textContent = p.message || "Error.";
                            aiEl.className = "chat-msg chat-msg--error";
                            _doneSimple();
                        }
                    });
                    read();
                }).catch(function () { _flushTypewriter(aiEl); _doneSimple(); });
            }
            read();
        })
        .catch(function (err) {
            aiEl.textContent = "Could not reach server: " + err.message;
            aiEl.className = "chat-msg chat-msg--error";
            _doneSimple();
        });
    }

    function _done(es) {
        if (es) es.close();
        _currentES    = null;
        _isStreaming  = false;
        _dom.sendBtn.disabled = false;
        if (window.EdgeManager) window.EdgeManager.setThinking(false);
        _refreshStats();
    }

    function _doneSimple() {
        _isStreaming  = false;
        _dom.sendBtn.disabled = false;
        if (window.EdgeManager) window.EdgeManager.setThinking(false);
        _refreshStats();
    }

    // ── Smart Questions ─────────────────────────────────────────────────────
    function loadSmartQuestions() {
        fetch("/api/query/smart-questions")
            .then(function (r) { return r.ok ? r.json() : { questions: [] }; })
            .then(function (d) {
                _smartQuestions = d.questions || [];
                _renderSmartQuestions(_smartQuestions);
            })
            .catch(function () {});
    }

    function _renderSmartQuestions(questions) {
        if (!_dom.smartQBar || !questions.length) return;
        _dom.smartQBar.innerHTML = "";
        var label = document.createElement("span");
        label.className = "chat-sq-label";
        label.textContent = "Suggesties";
        _dom.smartQBar.appendChild(label);
        questions.slice(0, 4).forEach(function (q) {
            var chip = document.createElement("button");
            chip.className = "chat-sq-btn";
            chip.textContent = q;
            chip.title = q;
            chip.addEventListener("click", function () {
                _setMode("query");
                _send(q);
            });
            _dom.smartQBar.appendChild(chip);
        });
        if (_mode === "query") {
            _dom.smartQBar.style.display = "flex";
        }
    }

    // ── Chat History Persistentie (localStorage) ────────────────────────────
    function _saveChatHistory() {
        try {
            var entries = [];
            if (_dom.feed) {
                var msgs = _dom.feed.querySelectorAll(".chat-msg--user, .chat-msg--ai");
                msgs.forEach(function (m) {
                    entries.push({
                        role: m.classList.contains("chat-msg--user") ? "user" : "assistant",
                        text: m.textContent,
                    });
                });
            }
            localStorage.setItem(_HISTORY_KEY, JSON.stringify(entries.slice(-50)));
        } catch (e) {}
    }

    function _loadChatHistory() {
        try {
            var raw = localStorage.getItem(_HISTORY_KEY);
            if (!raw) return;
            var entries = JSON.parse(raw);
            if (!entries || !entries.length) return;
            _addMsg("chat-msg--system", "── Vorige sessie hersteld ──");
            entries.slice(-15).forEach(function (e) {
                var cls = e.role === "user" ? "chat-msg--user" : "chat-msg--ai";
                _addMsg(cls, e.text || "");
            });
        } catch (e) {}
    }

    // ── API key status check ────────────────────────────────────────────────
    function _checkApiKey() {
        fetch("/settings/load", { method: "GET" })
            .then(function (r) { return r.ok ? r.json() : { has_api_key: true }; })
            .then(function (d) {
                var hasKey = d.has_api_key || d.api_key_saved;
                if (!hasKey) _showNoKeyBanner();
            })
            .catch(function () { /* server not ready yet — ignore */ });
    }

    function _showNoKeyBanner() {
        if (!_dom.feed || document.getElementById("chat-no-key-banner")) return;
        var el = document.createElement("div");
        el.id = "chat-no-key-banner";
        el.className = "chat-msg chat-msg--system";
        el.style.cssText = "border-left:3px solid #f7a04f;padding-left:10px;color:#f7a04f;";
        el.innerHTML =
            "\u26A0 Geen API key ingesteld \u2014 " +
            "<button class='chat-link-btn' id='chat-open-settings-btn' style='" +
            "background:transparent;border:none;color:#4f8ef7;cursor:pointer;" +
            "font-family:inherit;font-size:inherit;text-decoration:underline;padding:0;'>" +
            "open Instellingen</button>";
        _dom.feed.appendChild(el);
        var btn = document.getElementById("chat-open-settings-btn");
        if (btn) {
            btn.addEventListener("click", function () {
                if (window.SettingsPanel && window.SettingsPanel.open) {
                    window.SettingsPanel.open();
                } else {
                    var sp = document.getElementById("settings-panel");
                    if (sp) sp.classList.add("active");
                }
            });
        }
    }

    function _hideNoKeyBanner() {
        var el = document.getElementById("chat-no-key-banner");
        if (el) el.remove();
    }

    // ── Init ────────────────────────────────────────────────────────────────
    function _init() {
        _build();
        // Re-render Lucide icons if available
        if (window.lucide) window.lucide.createIcons();
        // Refresh stats every few seconds
        setInterval(_refreshStats, 2000);
        // Initial stat display
        setTimeout(_refreshStats, 500);
        // Auto-save chat history every 10 s
        setInterval(_saveChatHistory, 10000);
        // Laad smart questions als graph al beschikbaar is
        setTimeout(function () {
            if (window.NeuralGraph && window.NeuralGraph.getAllNodes().length > 0) {
                loadSmartQuestions();
            }
        }, 1500);
        // Check API key status — show banner if not configured
        setTimeout(_checkApiKey, 800);
        // Hide banner when key is saved from settings panel
        document.addEventListener("ng:key_saved", _hideNoKeyBanner);
    }

    // ── Public API ──────────────────────────────────────────────────────────
    function _clearChat(worldLabel) {
        // Stop any running stream
        if (_currentES) { _currentES.close(); _currentES = null; }
        if (_typeTimer) { clearInterval(_typeTimer); _typeTimer = null; }
        _isStreaming = false;
        _history = [];
        _typeQueue = "";
        // Clear the feed
        if (_dom.feed) _dom.feed.innerHTML = "";
        // Show world-switch notice
        if (worldLabel) {
            _addMsg("chat-msg--system", "\u2014 " + worldLabel + " \u2014");
        }
        if (_dom.sendBtn) _dom.sendBtn.disabled = false;
    }

    window.NeuralGraphChat = {
        send:               _send,
        refreshStats:       _refreshStats,
        loadSmartQuestions: loadSmartQuestions,
        clearChat:          _clearChat,
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", _init);
    } else {
        _init();
    }

})();
