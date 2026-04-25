/*!
 * queryChat.js  —  NeuralGraph Network Query mode
 *
 * Adds a "Graph Builder | Network Query" toggle pill to the top of #chat-bar.
 *
 * Network Query mode:
 *   - Intercepts #chat-send and #chat-input Enter (capture-phase) before chat.js
 *   - Sends POST /api/query/ask → ReadableStream SSE
 *   - Events: thinking | chunk | highlight | sources | done | error
 *   - Typewriter effect (char-by-char), source cards, focusNode on card click
 *
 * Graph Builder mode:
 *   - Events pass through to chat.js unchanged
 */
(function () {
    "use strict";

    // ── constants ─────────────────────────────────────────────────────────────
    var CAT_COLOR = {
        product:    "#4f8ef7",
        customer:   "#b44ff7",
        process:    "#f7a04f",
        compliance: "#f74f6a",
        finance:    "#4ff7a0",
    };
    var TW_DELAY = 16; // ms per character

    // ── state ─────────────────────────────────────────────────────────────────
    var _mode       = "builder"; // "builder" | "query"
    var _streaming  = false;
    var _reader     = null;      // active fetch ReadableStream reader
    var _twQueue    = [];
    var _twRunning  = false;
    var _twTarget   = null;      // <span> typewriter is writing into
    var _curBubble  = null;      // current answer bubble <div>
    var _curSpan    = null;      // current answer text <span>

    // ── dom refs ──────────────────────────────────────────────────────────────
    var $history, $input, $send;

    // ── CSS ───────────────────────────────────────────────────────────────────
    function _injectStyles() {
        if (document.getElementById("ng-qc-styles")) return;
        var s = document.createElement("style");
        s.id = "ng-qc-styles";
        s.textContent = [
            /* --- mode toggle pill --- */
            "#ng-mode-toggle {",
            "  display:flex; padding:6px 14px 5px; border-bottom:1px solid #1e1e2e;",
            "}",
            ".ng-mt-btn {",
            "  flex:1; font-family:inherit; font-size:9px; letter-spacing:.1em;",
            "  text-transform:uppercase; padding:4px 10px;",
            "  background:#0a0a14; border:1px solid #1e1e2e; color:#4a4a6a;",
            "  cursor:pointer; transition:background .15s, color .15s, border-color .15s;",
            "}",
            ".ng-mt-btn:first-child { border-radius:3px 0 0 3px; border-right:none; }",
            ".ng-mt-btn:last-child  { border-radius:0 3px 3px 0; }",
            ".ng-mt-btn:hover:not(.active) { color:#8a8aba; background:#0f0f1e; }",
            ".ng-mt-btn.active.builder { background:#141428; color:#4f8ef7; border-color:#4f8ef7; }",
            ".ng-mt-btn.active.query   { background:#07140d; color:#4ff7a0; border-color:#4ff7a0; }",

            /* --- user bubble (query mode) --- */
            ".ng-qmsg--user {",
            "  align-self:flex-end; max-width:84%;",
            "  padding:7px 11px; border-radius:5px;",
            "  background:#141428; border-right:2px solid #4ff7a0;",
            "  color:#c8c8e8; font-size:12px; line-height:1.55; word-break:break-word;",
            "}",

            /* --- answer bubble --- */
            ".ng-qmsg--answer {",
            "  align-self:flex-start; max-width:92%;",
            "  padding:8px 12px; border-radius:5px;",
            "  background:#07140d; border-left:2px solid #4ff7a0;",
            "  color:#d4e8d4; font-size:12px; line-height:1.6; word-break:break-word;",
            "}",
            ".ng-qmsg-text { white-space:pre-wrap; }",

            /* --- blinking block cursor --- */
            ".ng-cursor::after {",
            "  content:''; display:inline-block;",
            "  width:7px; height:12px; margin-left:1px; vertical-align:text-bottom;",
            "  background:#4ff7a0; animation:ng-blink .75s step-end infinite;",
            "}",
            "@keyframes ng-blink { 50% { opacity:0; } }",

            /* --- error bubble --- */
            ".ng-qmsg--error {",
            "  align-self:flex-start; max-width:92%;",
            "  padding:7px 12px; border-radius:5px;",
            "  background:#1a0809; border-left:2px solid #f74f6a;",
            "  color:#f7a0ab; font-size:11px;",
            "}",

            /* --- thinking indicator --- */
            "#ng-qc-thinking {",
            "  align-self:flex-start; display:flex; align-items:center; gap:8px;",
            "  padding:7px 12px; border-radius:5px;",
            "  background:#07140d; border-left:2px solid #4ff7a0;",
            "  font-size:10px; color:#4ff7a0; letter-spacing:.05em;",
            "}",
            ".ng-th-dot {",
            "  display:inline-block; width:4px; height:4px; border-radius:50%;",
            "  background:#4ff7a0; animation:ng-td 1.1s infinite both;",
            "}",
            ".ng-th-dot:nth-child(2) { animation-delay:.18s; }",
            ".ng-th-dot:nth-child(3) { animation-delay:.36s; }",
            "@keyframes ng-td {",
            "  0%,80%,100% { transform:scale(.5); opacity:.3; }",
            "  40%         { transform:scale(1);   opacity:1;  }",
            "}",
            ".ng-th-label { max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",

            /* --- sources panel --- */
            ".ng-src-panel {",
            "  margin-top:8px; padding-top:7px; border-top:1px solid #122012;",
            "}",
            ".ng-src-heading {",
            "  font-size:9px; letter-spacing:.1em; text-transform:uppercase;",
            "  color:#4a6a4a; margin-bottom:5px;",
            "}",
            ".ng-src-cards { display:flex; flex-wrap:wrap; gap:5px; }",
            ".ng-src-card {",
            "  padding:3px 9px; border-radius:3px;",
            "  font-size:10px; letter-spacing:.04em; cursor:pointer;",
            "  border:1px solid; white-space:nowrap;",
            "  transition:opacity .15s, transform .12s;",
            "}",
            ".ng-src-card:hover { opacity:.75; transform:translateY(-1px); }",

            /* --- empty state --- */
            ".ng-qc-empty {",
            "  padding:12px 14px; font-size:10px;",
            "  color:#3a5a3a; letter-spacing:.06em;",
            "}",
        ].join("\n");
        document.head.appendChild(s);
    }

    // ── toggle pill ───────────────────────────────────────────────────────────
    function _buildToggle() {
        var chatBar = document.getElementById("chat-bar");
        if (!chatBar || document.getElementById("ng-mode-toggle")) return;

        var row  = document.createElement("div");
        row.id   = "ng-mode-toggle";

        var btnB = document.createElement("button");
        btnB.className   = "ng-mt-btn active builder";
        btnB.dataset.m   = "builder";
        btnB.textContent = "Graph Builder";

        var btnQ = document.createElement("button");
        btnQ.className   = "ng-mt-btn";
        btnQ.dataset.m   = "query";
        btnQ.textContent = "Network Query";

        row.appendChild(btnB);
        row.appendChild(btnQ);
        chatBar.insertBefore(row, chatBar.firstChild);

        row.addEventListener("click", function (e) {
            var btn = e.target.closest(".ng-mt-btn");
            if (!btn || btn.dataset.m === _mode) return;
            if (_streaming) return; // don't switch mid-stream
            _setMode(btn.dataset.m);
        });
    }

    function _setMode(m) {
        _mode = m;

        document.querySelectorAll(".ng-mt-btn").forEach(function (b) {
            var isActive = b.dataset.m === m;
            b.classList.toggle("active",   isActive);
            b.classList.toggle("builder",  b.dataset.m === "builder" && isActive);
            b.classList.toggle("query",    b.dataset.m === "query"   && isActive);
        });

        if ($input) {
            $input.placeholder = m === "query"
                ? "Ask a question about your network\u2026"
                : "Ask your network\u2026";
        }

        if ($history) {
            $history.innerHTML = "";
            if (m === "query") {
                var empty = document.createElement("div");
                empty.className   = "ng-qc-empty";
                empty.textContent = "Network Query \u2014 ask a question, get an AI answer grounded in your graph.";
                $history.appendChild(empty);
            }
            // Builder mode: chat.js will restore its empty state on next send
        }
    }

    // ── typewriter ────────────────────────────────────────────────────────────
    function _twEnqueue(chunk) {
        for (var i = 0; i < chunk.length; i++) _twQueue.push(chunk[i]);
        if (!_twRunning) _twTick();
    }

    function _twTick() {
        if (!_twQueue.length) { _twRunning = false; return; }
        if (!_twTarget)       { _twQueue = []; _twRunning = false; return; }
        _twRunning = true;
        _twTarget.textContent += _twQueue.shift();
        if ($history) $history.scrollTop = $history.scrollHeight;
        setTimeout(_twTick, TW_DELAY);
    }

    function _twFlushAll() {
        if (_twTarget && _twQueue.length) {
            _twTarget.textContent += _twQueue.join("");
        }
        _twQueue   = [];
        _twRunning = false;
    }

    // ── message DOM helpers ───────────────────────────────────────────────────
    function _appendUserBubble(text) {
        var div = document.createElement("div");
        div.className   = "ng-qmsg--user";
        div.textContent = text;
        $history.appendChild(div);
        $history.scrollTop = $history.scrollHeight;
    }

    function _showThinking(keywords) {
        _removeThinking();
        var div = document.createElement("div");
        div.id = "ng-qc-thinking";

        var lbl  = document.createElement("span");
        lbl.className = "ng-th-label";
        var kw = keywords.length ? keywords.slice(0, 5).join(", ") : "network";
        lbl.textContent = "Searching \u201c" + kw + "\u201d";

        var dots = document.createElement("span");
        dots.innerHTML = [
            "<span class='ng-th-dot'></span>",
            "<span class='ng-th-dot'></span>",
            "<span class='ng-th-dot'></span>",
        ].join("");

        div.appendChild(lbl);
        div.appendChild(dots);
        $history.appendChild(div);
        $history.scrollTop = $history.scrollHeight;
    }

    function _removeThinking() {
        var el = document.getElementById("ng-qc-thinking");
        if (el) el.remove();
    }

    function _startAnswerBubble() {
        _removeThinking();
        var div  = document.createElement("div");
        div.className = "ng-qmsg--answer";

        var span = document.createElement("span");
        span.className  = "ng-qmsg-text ng-cursor";

        div.appendChild(span);
        $history.appendChild(div);

        _curBubble = div;
        _curSpan   = span;
        _twTarget  = span;

        $history.scrollTop = $history.scrollHeight;
    }

    function _sealAnswerBubble() {
        if (_curSpan) _curSpan.classList.remove("ng-cursor");
        _twTarget = null;
        _curSpan  = null;
        // _curBubble stays alive for _appendSources()
    }

    function _appendSources(sources) {
        if (!_curBubble || !sources || !sources.length) return;

        var panel = document.createElement("div");
        panel.className = "ng-src-panel";

        var heading = document.createElement("div");
        heading.className   = "ng-src-heading";
        heading.textContent = "Sources used";
        panel.appendChild(heading);

        var cards = document.createElement("div");
        cards.className = "ng-src-cards";

        sources.forEach(function (node) {
            var col  = CAT_COLOR[node.category] || "#8a8aba";
            var card = document.createElement("div");
            card.className        = "ng-src-card";
            card.textContent      = node.label || node.id;
            card.style.color      = col;
            card.style.borderColor = col + "55";
            card.style.background  = col + "12";
            card.title = (node.description || "").slice(0, 100);

            card.addEventListener("click", function () {
                if (!window.NeuralGraph) return;
                if (window.NeuralGraph.focusNode)
                    window.NeuralGraph.focusNode(node.id);
                else if (window.NeuralGraph.highlightNode)
                    window.NeuralGraph.highlightNode(node.id);
            });
            cards.appendChild(card);
        });

        panel.appendChild(cards);
        _curBubble.appendChild(panel);
        $history.scrollTop = $history.scrollHeight;
    }

    function _appendError(msg) {
        _removeThinking();
        var div = document.createElement("div");
        div.className   = "ng-qmsg--error";
        div.textContent = "\u26a0 " + (msg || "Unknown error");
        $history.appendChild(div);
        $history.scrollTop = $history.scrollHeight;
    }

    // ── node highlight (pulse) ────────────────────────────────────────────────
    function _highlight(nodeId) {
        if (!nodeId || !window.NeuralGraph) return;
        if (window.NeuralGraph.highlightNode) window.NeuralGraph.highlightNode(nodeId);
        else if (window.NeuralGraph.focusNode) window.NeuralGraph.focusNode(nodeId);
    }

    // ── stream fetch (POST → SSE via ReadableStream) ──────────────────────────
    function _sendQuery(text) {
        if (!text || _streaming) return;

        // Dismiss empty state
        var empty = $history.querySelector(".ng-qc-empty");
        if (empty) empty.remove();

        _appendUserBubble(text);
        _streaming = true;
        _curBubble = null;
        _curSpan   = null;
        _twTarget  = null;
        _twQueue   = [];
        _twRunning = false;
        $send.disabled = true;

        fetch("/api/query/ask", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
                question: text,
                world: (window.WorldManager ? window.WorldManager.getCurrent() : "demo"),
            }),
        })
        .then(function (res) {
            if (!res.ok) {
                _appendError("Server error " + res.status);
                _finish();
                return;
            }
            var reader = res.body.getReader();
            _reader    = reader;
            var dec    = new TextDecoder();
            var buf    = "";

            function pump() {
                reader.read().then(function (result) {
                    if (result.done) { _finish(); return; }

                    buf += dec.decode(result.value, { stream: true });
                    var lines = buf.split("\n");
                    buf = lines.pop(); // hold incomplete last line

                    lines.forEach(function (line) {
                        if (!line.startsWith("data: ")) return;
                        var raw = line.slice(6).trim();
                        if (!raw) return;

                        var data;
                        try { data = JSON.parse(raw); } catch (_x) { return; }

                        switch (data.type) {

                            case "thinking":
                                _showThinking(data.keywords || []);
                                break;

                            case "chunk":
                                if (!_curSpan) _startAnswerBubble();
                                _twEnqueue(data.content || "");
                                break;

                            case "highlight":
                                // node_id can be a string (inline) or array (batch)
                                if (Array.isArray(data.node_id)) {
                                    data.node_id.forEach(function (id) { _highlight(id); });
                                } else {
                                    _highlight(data.node_id);
                                }
                                break;

                            case "sources":
                                _twFlushAll();
                                _sealAnswerBubble();
                                _appendSources(data.sources || []);
                                break;

                            case "done":
                                _twFlushAll();
                                _sealAnswerBubble();
                                _finish();
                                break;

                            case "error":
                                _twFlushAll();
                                _sealAnswerBubble();
                                _appendError(data.message);
                                _finish();
                                break;
                        }
                    });

                    pump();
                }).catch(function () {
                    _appendError("Stream disconnected.");
                    _finish();
                });
            }

            pump();
        })
        .catch(function () {
            _appendError("Could not reach the server.");
            _finish();
        });
    }

    function _finish() {
        _streaming     = false;
        _curBubble     = null;
        _reader        = null;
        $send.disabled = false;
        _twFlushAll();
        _sealAnswerBubble();
    }

    // ── capture-phase event intercepts ────────────────────────────────────────
    // These fire BEFORE chat.js's bubble-phase handlers, allowing query mode
    // to steal the event when active. In builder mode they fall through.
    function _bindIntercepts() {
        $send.addEventListener("click", function (e) {
            if (_mode !== "query") return;
            e.stopImmediatePropagation();
            var text = $input.value.trim();
            if (!text) return;
            $input.value = "";
            _sendQuery(text);
        }, true /* capture */);

        $input.addEventListener("keydown", function (e) {
            if (_mode !== "query") return;
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
                var text = $input.value.trim();
                if (!text) return;
                $input.value = "";
                _sendQuery(text);
            } else if (e.key === "Escape") {
                if (_streaming && _reader) {
                    _reader.cancel();
                    _finish();
                } else {
                    $input.value = "";
                }
            }
        }, true /* capture */);
    }

    // ── public API ────────────────────────────────────────────────────────────
    window.NeuralGraphQuery = {
        ask: function (text) {
            _setMode("query");
            if ($input) { $input.value = text || ""; }
            _sendQuery(text || "");
        },
        getMode: function () { return _mode; },
    };

    // ── bootstrap ─────────────────────────────────────────────────────────────
    document.addEventListener("DOMContentLoaded", function () {
        $history = document.getElementById("chat-history");
        $input   = document.getElementById("chat-input");
        $send    = document.getElementById("chat-send");
        if (!$history || !$input || !$send) return;

        _injectStyles();
        _buildToggle();
        _bindIntercepts();
    });

})();
