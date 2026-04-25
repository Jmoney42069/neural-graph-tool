/*!
 * chat.js  ─  NeuralGraph streaming chat UI
 *
 * Manages:  #chat-history  #chat-input  #chat-send
 * Streams from  GET /chat/stream  via EventSource.
 *
 * SSE events handled:
 *   {type:"token",     content:"..."}
 *   {type:"highlight", node_ids:["..."]}
 *   {type:"sources",   sources:[...], context_used:{...}}
 *   {type:"done"}
 *   {type:"error",     message:"..."}
 */
(function () {
    "use strict";

    // ── constants ─────────────────────────────────────────────────────────────
    var MAX_HISTORY = 20;
    var CHIPS = [
        "What are the key entities in this network?",
        "How are the main nodes connected?",
        "List all compliance-related items.",
    ];

    // ── state ─────────────────────────────────────────────────────────────────
    var _history   = [];     // [{role, content}]  — sent to API
    var _inputLog  = [];     // sent messages for Up/Down cycling
    var _logIdx    = -1;
    var _streaming = false;
    var _autoScroll= true;
    var _curMsgEl  = null;   // <div.ng-msg> being built
    var _curSpan   = null;   // <span.ng-msg-content> being built
    var _es        = null;   // active EventSource

    // ── dom refs ──────────────────────────────────────────────────────────────
    var $history, $input, $send, $hint;

    // ── CSS ───────────────────────────────────────────────────────────────────
    function _injectStyles() {
        var el = document.createElement("style");
        el.id   = "ng-chat-styles";
        el.textContent = [
            /* message list */
            "#chat-history {",
            "  display:flex; flex-direction:column; gap:8px;",
            "  padding:12px 14px; overflow-y:auto; scroll-behavior:smooth; flex:1;",
            "}",

            /* base bubble */
            ".ng-msg {",
            "  max-width:82%; padding:8px 12px; border-radius:6px;",
            "  font-size:12px; line-height:1.55; word-break:break-word; position:relative;",
            "}",
            ".ng-msg--user {",
            "  align-self:flex-end; background:#141428;",
            "  border-right:2px solid #4f8ef7; color:#c8c8e8;",
            "}",
            ".ng-msg--assistant {",
            "  align-self:flex-start; background:#0d0d18;",
            "  border-left:2px solid #4ff7a0; color:#d4d4e4;",
            "}",
            ".ng-msg--error {",
            "  align-self:flex-start; background:#1a0809;",
            "  border-left:2px solid #f74f6a; color:#f7a0ab;",
            "}",
            ".ng-msg-content { white-space:pre-wrap; }",

            /* typing dots */
            ".ng-typing {",
            "  display:inline-flex; gap:4px; padding:10px 12px;",
            "  align-self:flex-start; background:#0d0d18;",
            "  border-left:2px solid #4ff7a0; border-radius:6px;",
            "}",
            ".ng-typing span {",
            "  display:inline-block; width:5px; height:5px; border-radius:50%;",
            "  background:#4ff7a0; animation:ng-dot 1.2s infinite both;",
            "}",
            ".ng-typing span:nth-child(2) { animation-delay:.2s; }",
            ".ng-typing span:nth-child(3) { animation-delay:.4s; }",
            "@keyframes ng-dot {",
            "  0%,80%,100% { transform:scale(.6); opacity:.4; }",
            "  40%         { transform:scale(1);  opacity:1;  }",
            "}",

            /* sources panel */
            ".ng-sources { margin-top:8px; border-top:1px solid #1e1e32; padding-top:6px; }",
            ".ng-sources-toggle {",
            "  font-size:10px; color:#4a4a6a; letter-spacing:.08em;",
            "  cursor:pointer; user-select:none; text-transform:uppercase;",
            "}",
            ".ng-sources-toggle:hover { color:#8a8aba; }",
            ".ng-sources-list { margin-top:5px; display:flex; flex-wrap:wrap; gap:4px; }",
            ".ng-source-badge {",
            "  font-size:10px; padding:2px 7px; border-radius:3px;",
            "  background:#141428; border:1px solid #2a2a48; color:#8a8aba;",
            "  cursor:pointer; transition:border-color .15s, color .15s;",
            "}",
            ".ng-source-badge:hover { border-color:#4f8ef7; color:#b0b0e0; }",

            /* empty-state chips */
            ".ng-empty {",
            "  display:flex; flex-direction:column; align-items:center;",
            "  gap:8px; padding:20px 0 10px; color:#3a3a5a; font-size:11px;",
            "}",
            ".ng-empty p { font-size:10px; letter-spacing:.08em; text-transform:uppercase; }",
            ".ng-chip {",
            "  width:100%; padding:7px 10px; background:#0f0f1e;",
            "  border:1px solid #2a2a48; border-radius:4px; color:#8a8aba;",
            "  font-size:11px; text-align:left; cursor:pointer;",
            "  transition:border-color .15s, color .15s; font-family:inherit;",
            "}",
            ".ng-chip:hover { border-color:#4f8ef7; color:#d0d0f0; }",

            /* scroll hint */
            "#ng-scroll-hint {",
            "  position:absolute; bottom:52px; right:14px;",
            "  background:#4f8ef7; color:#09090f; border:none;",
            "  border-radius:50%; width:26px; height:26px;",
            "  font-size:14px; line-height:26px; text-align:center;",
            "  cursor:pointer; display:none; z-index:10;",
            "  box-shadow:0 2px 8px #0008; transition:opacity .2s;",
            "}",

            /* send button disabled */
            "#chat-send:disabled { opacity:.4; cursor:not-allowed; }",

            /* clear chat button */
            "#ng-clear-chat {",
            "  background:none; border:1px solid #2a2a48; border-radius:4px;",
            "  color:#4a4a6a; font-size:10px; letter-spacing:.06em; text-transform:uppercase;",
            "  padding:3px 8px; cursor:pointer; transition:border-color .15s, color .15s;",
            "  align-self:flex-end; margin:4px 14px 0 0; flex-shrink:0;",
            "}",
            "#ng-clear-chat:hover { border-color:#f74f6a; color:#f7a0ab; }",
        ].join("\n");
        document.head.appendChild(el);
    }

    // ── empty state ───────────────────────────────────────────────────────────
    function _showEmpty() {
        $history.innerHTML = "";
        var wrap = document.createElement("div");
        wrap.className = "ng-empty";
        var p = document.createElement("p");
        p.textContent = "Ask about your network";
        wrap.appendChild(p);
        CHIPS.forEach(function (txt) {
            var btn = document.createElement("button");
            btn.className   = "ng-chip";
            btn.textContent = txt;
            btn.addEventListener("click", function () {
                $input.value = txt;
                $input.focus();
                _send();
            });
            wrap.appendChild(btn);
        });
        $history.appendChild(wrap);
        _autoScroll = true;
    }

    // ── scroll helpers ────────────────────────────────────────────────────────
    function _scrollToBottom() {
        $history.scrollTop = $history.scrollHeight;
    }

    function _updateHint() {
        var atBottom = ($history.scrollHeight - $history.scrollTop - $history.clientHeight) < 40;
        if ($hint) $hint.style.display = atBottom ? "none" : "block";
        _autoScroll = atBottom;
    }

    // ── message builders ──────────────────────────────────────────────────────
    function _appendUser(text) {
        var div = document.createElement("div");
        div.className = "ng-msg ng-msg--user";
        var span = document.createElement("span");
        span.className   = "ng-msg-content";
        span.textContent = text;
        div.appendChild(span);
        $history.appendChild(div);
        if (_autoScroll) _scrollToBottom();
    }

    function _startAssistant() {
        var typing = $history.querySelector(".ng-typing");
        if (typing) typing.remove();
        var div = document.createElement("div");
        div.className = "ng-msg ng-msg--assistant";
        var span = document.createElement("span");
        span.className = "ng-msg-content";
        div.appendChild(span);
        $history.appendChild(div);
        _curMsgEl = div;
        _curSpan  = span;
        if (_autoScroll) _scrollToBottom();
    }

    function _appendToken(token) {
        if (!_curSpan) _startAssistant();
        _curSpan.textContent += token;
        if (_autoScroll) _scrollToBottom();
    }

    function _appendTyping() {
        var div = document.createElement("div");
        div.className = "ng-typing";
        div.innerHTML  = "<span></span><span></span><span></span>";
        $history.appendChild(div);
        if (_autoScroll) _scrollToBottom();
    }

    function _appendError(msg) {
        var typing = $history.querySelector(".ng-typing");
        if (typing) typing.remove();
        var div = document.createElement("div");
        div.className = "ng-msg ng-msg--error";
        var span = document.createElement("span");
        span.className   = "ng-msg-content";
        span.textContent = "\u26a0 " + msg;
        div.appendChild(span);
        $history.appendChild(div);
        if (_autoScroll) _scrollToBottom();
    }

    function _attachSources(sources) {
        if (!_curMsgEl || !sources || sources.length === 0) return;
        var wrap   = document.createElement("div");
        wrap.className = "ng-sources";
        var toggle = document.createElement("div");
        toggle.className = "ng-sources-toggle";
        var count = sources.length;
        var open  = false;
        toggle.textContent = "\u25b8 " + count + " source" + (count !== 1 ? "s" : "");
        wrap.appendChild(toggle);

        var list = document.createElement("div");
        list.className    = "ng-sources-list";
        list.style.display = "none";
        sources.forEach(function (src) {
            var badge = document.createElement("span");
            badge.className   = "ng-source-badge";
            badge.textContent = src.label || src.id;
            badge.title       = src.description || "";
            badge.addEventListener("click", function () {
                if (!window.NeuralGraph) return;
                if (window.NeuralGraph.focusNode)     window.NeuralGraph.focusNode(src.id);
                else if (window.NeuralGraph.highlightNode) window.NeuralGraph.highlightNode(src.id);
            });
            list.appendChild(badge);
        });
        wrap.appendChild(list);

        toggle.addEventListener("click", function () {
            open = !open;
            list.style.display  = open ? "flex" : "none";
            toggle.textContent  = (open ? "\u25be " : "\u25b8 ") + count + " source" + (count !== 1 ? "s" : "");
        });

        _curMsgEl.appendChild(wrap);
    }

    // ── send ──────────────────────────────────────────────────────────────────
    function _send() {
        var text = $input.value.trim();
        if (!text || _streaming) return;

        if (_es) { _es.close(); _es = null; }

        // Clear empty-state
        var empty = $history.querySelector(".ng-empty");
        if (empty) empty.remove();

        // Log for Up/Down
        _inputLog.unshift(text);
        if (_inputLog.length > 50) _inputLog.pop();
        _logIdx = -1;

        _appendUser(text);
        $input.value = "";
        _appendTyping();
        _streaming = true;
        _curMsgEl  = null;
        _curSpan   = null;
        $send.disabled = true;

        _history.push({ role: "user", content: text });
        if (_history.length > MAX_HISTORY) _history.shift();

        var histParam  = encodeURIComponent(JSON.stringify(_history.slice(-10)));
        var msgParam   = encodeURIComponent(text);
        var worldParam = (window.WorldManager ? window.WorldManager.getCurrent() : "demo");
        var url = "/chat/stream?message=" + msgParam + "&conversation_history=" + histParam + "&world=" + encodeURIComponent(worldParam);

        _es = new EventSource(url);

        var assistantText = "";

        _es.onmessage = function (evt) {
            var data;
            try { data = JSON.parse(evt.data); } catch (_) { return; }

            switch (data.type) {
                case "token": {
                    var typing = $history.querySelector(".ng-typing");
                    if (typing) typing.remove();
                    if (!_curSpan) _startAssistant();
                    assistantText += data.content;
                    _appendToken(data.content);
                    break;
                }
                case "highlight": {
                    if (data.node_ids && window.NeuralGraph) {
                        data.node_ids.forEach(function (id) {
                            if (window.NeuralGraph.highlightNode) window.NeuralGraph.highlightNode(id);
                        });
                    }
                    break;
                }
                case "sources": {
                    _attachSources(data.sources);
                    break;
                }
                case "done": {
                    _es.close(); _es = null;
                    _streaming = false;
                    $send.disabled = false;
                    _history.push({ role: "assistant", content: assistantText });
                    if (_history.length > MAX_HISTORY) _history.shift();
                    _curMsgEl = null;
                    _curSpan  = null;
                    break;
                }
                case "error": {
                    _appendError(data.message || "Unknown error");
                    _es.close(); _es = null;
                    _streaming = false;
                    $send.disabled = false;
                    _curMsgEl = null;
                    _curSpan  = null;
                    break;
                }
            }
        };

        _es.onerror = function () {
            if (_streaming) _appendError("Connection lost. Please try again.");
            _es.close(); _es = null;
            _streaming = false;
            $send.disabled = false;
        };
    }

    // ── keyboard & events ─────────────────────────────────────────────────────
    function _bindEvents() {
        $send.addEventListener("click", _send);

        $input.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                _send();
            } else if (e.key === "Escape") {
                $input.value = "";
                _logIdx = -1;
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (_logIdx < _inputLog.length - 1) {
                    _logIdx++;
                    $input.value = _inputLog[_logIdx] || "";
                }
            } else if (e.key === "ArrowDown") {
                e.preventDefault();
                if (_logIdx > 0) {
                    _logIdx--;
                    $input.value = _inputLog[_logIdx] || "";
                } else {
                    _logIdx = -1;
                    $input.value = "";
                }
            }
        });

        $history.addEventListener("scroll", _updateHint);

        if ($hint) {
            $hint.addEventListener("click", function () {
                _scrollToBottom();
                _autoScroll = true;
                $hint.style.display = "none";
            });
        }
    }

    // ── clear chat ────────────────────────────────────────────────────────────
    function _clearChat() {
        if (_es) { _es.close(); _es = null; }
        _history   = [];
        _inputLog  = [];
        _logIdx    = -1;
        _streaming = false;
        _autoScroll= true;
        _curMsgEl  = null;
        _curSpan   = null;
        $send.disabled = false;
        _showEmpty();
    }

    // ── scroll hint ───────────────────────────────────────────────────────────
    function _setupScrollHint() {
        var chatBar = document.getElementById("chat-bar");
        if (!chatBar) return;

        // clear button
        var clearBtn = document.createElement("button");
        clearBtn.id          = "ng-clear-chat";
        clearBtn.title       = "Clear chat history";
        clearBtn.textContent = "\u{1F5D1} Clear chat";
        clearBtn.addEventListener("click", _clearChat);
        chatBar.appendChild(clearBtn);

        // scroll-to-bottom hint
        $hint = document.createElement("button");
        $hint.id          = "ng-scroll-hint";
        $hint.title       = "Scroll to bottom";
        $hint.textContent = "\u2193";
        chatBar.style.position = "relative";
        chatBar.appendChild($hint);
    }

    // ── bootstrap ─────────────────────────────────────────────────────────────
    document.addEventListener("DOMContentLoaded", function () {
        $history = document.getElementById("chat-history");
        $input   = document.getElementById("chat-input");
        $send    = document.getElementById("chat-send");
        if (!$history || !$input || !$send) return;

        _injectStyles();
        _setupScrollHint();
        _showEmpty();
        _bindEvents();

        // Expose a public hook so other modules can pre-fill the chat
        window.NeuralGraphChat = {
            send: function (text) {
                $input.value = text || "";
                _send();
            },
            fill: function (text) {
                $input.value = text || "";
                $input.focus();
            },
            clear: _clearChat,
        };
    });

})();
