/**
 * bottomPanel.js — Enterprise Bottom Panel (4 tabs)
 * Tabs: Activity Feed | KPI Snapshot | Critical Route | Bottleneck Alerts
 *
 * Listens for CustomEvents:
 *   demo:loaded, bottleneck:detected, kpi:approved, measurement:saved, graph:saved
 *
 * Exposes: window.BottomPanel
 */
(function () {
    "use strict";

    var MAX_ACTIVITY = 50;

    var _panel          = null;
    var _content        = null;
    var _collapseBtn    = null;
    var _currentTab     = "activity";
    var _collapsed      = false;
    var _activityLog    = [];   // { type, message, entity, time }
    var _cachedAlerts   = null;
    var _cachedKPIs     = null;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function _esc(s) {
        return String(s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function _fmt(d) {
        return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
    }

    function _el(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html !== undefined) e.innerHTML = html;
        return e;
    }

    function _setBadge(id, count) {
        var el = document.getElementById(id);
        if (!el) return;
        el.setAttribute("data-count", count);
        el.textContent = count;
    }

    // -----------------------------------------------------------------------
    // Activity Feed
    // -----------------------------------------------------------------------

    function addActivity(type, message, entity) {
        var item = {
            type:    type || "info",
            message: message || "",
            entity:  entity  || "",
            time:    new Date()
        };
        _activityLog.unshift(item);
        if (_activityLog.length > MAX_ACTIVITY) _activityLog.pop();
        if (_currentTab === "activity" && _content) renderTab("activity");
        document.dispatchEvent(new CustomEvent("activity:added", { detail: item }));
    }

    function renderActivityFeed() {
        if (!_content) return;
        if (!_activityLog.length) {
            _content.innerHTML = "";
            var empty = _el("div", "bp-empty-state");
            empty.innerHTML = "<span>&#9678; Nog geen activiteit</span><span style='font-size:10px'>Laad een graph of start een analyse</span>";
            _content.appendChild(empty);
            return;
        }

        var list = _el("div", "bp-activity-list");
        var visible = _activityLog.slice(0, 5);
        visible.forEach(function (item) {
            var dotCls = "bp-activity-dot bp-activity-dot--" + item.type;
            var row = _el("div", "bp-activity-item");
            var dot = _el("span", dotCls);
            var time = _el("span", "bp-activity-time", _fmt(item.time));
            var msg = _el("span", "bp-activity-msg");
            var text = item.entity
                ? _esc(item.message).replace(_esc(item.entity), "<b>" + _esc(item.entity) + "</b>")
                : _esc(item.message);
            msg.innerHTML = text;
            row.appendChild(dot);
            row.appendChild(time);
            row.appendChild(msg);
            list.appendChild(row);
        });
        _content.innerHTML = "";
        _content.appendChild(list);
    }

    // -----------------------------------------------------------------------
    // KPI Snapshot
    // -----------------------------------------------------------------------

    function renderKPISnapshot() {
        if (!_content) return;
        _content.innerHTML = "";

        // Show skeleton while loading
        var grid = _el("div", "bp-kpi-grid");
        for (var i = 0; i < 5; i++) {
            var card = _el("div", "bp-kpi-card");
            card.innerHTML =
                "<div class='skeleton skeleton-line skeleton-line--med' style='height:8px;margin-bottom:4px'></div>" +
                "<div class='skeleton skeleton-line skeleton-line--short' style='height:16px;margin-bottom:4px'></div>" +
                "<div class='skeleton skeleton-line skeleton-line--full' style='height:2px'></div>";
            grid.appendChild(card);
        }
        _content.appendChild(grid);

        Promise.all([
            fetch("/api/kpi/all").then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
            fetch("/api/measurements/all").then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
        ]).then(function (results) {
            var kpis         = results[0] || [];
            var measurements = results[1] || {};
            _cachedKPIs = kpis;
            _content.innerHTML = "";

            if (!kpis.length) {
                var empty = _el("div", "bp-empty-state");
                empty.innerHTML = "<span>Geen KPIs beschikbaar</span>";
                var btn = _el("button", "bp-action-btn", "Start een 0-meting");
                btn.addEventListener("click", function () {
                    if (window.MeasurementPanel) window.MeasurementPanel.openBaselineMeasurement();
                });
                empty.appendChild(btn);
                _content.appendChild(empty);
                return;
            }

            var sorted = kpis.slice().sort(function (a, b) {
                var da = (a.baseline || 0) - (a.current || a.baseline || 0);
                var db = (b.baseline || 0) - (b.current || b.baseline || 0);
                return da - db;
            }).slice(0, 6);

            var g = _el("div", "bp-kpi-grid");
            sorted.forEach(function (kpi) {
                var val = kpi.current !== undefined ? kpi.current : (kpi.baseline || 0);
                var base = kpi.baseline || val || 1;
                var pct = Math.min(100, Math.round((val / base) * 100));
                var status = pct >= 70 ? "ok" : (pct >= 40 ? "warn" : "error");
                var trend = val >= base ? "up" : "down";
                var delta = Math.abs(Math.round(((val - base) / (base || 1)) * 100));

                var card = _el("div", "bp-kpi-card");
                card.innerHTML =
                    "<div class='bp-kpi-name'>" + _esc(kpi.name || kpi.id || "KPI") + "</div>" +
                    "<div class='bp-kpi-value bp-kpi-value--" + status + "'>" + _esc(String(val)) + (kpi.unit ? "<span style='font-size:10px;opacity:.6'>" + _esc(kpi.unit) + "</span>" : "") + "</div>" +
                    "<div class='bp-kpi-trend bp-kpi-trend--" + trend + "'>" + (trend === "up" ? "&#8593;" : "&#8595;") + " " + delta + "% vs basis</div>" +
                    "<div class='bp-kpi-bar'><div class='bp-kpi-bar-fill' style='width:" + pct + "%;background:var(--status-" + status + ")'></div></div>" +
                    "<div class='bp-kpi-node-name'>" + _esc(kpi.node_id || "") + "</div>";

                card.addEventListener("click", function () {
                    if (kpi.node_id && window.NeuralGraph && window.NeuralGraph.focusNode) {
                        window.NeuralGraph.focusNode(kpi.node_id);
                    }
                });
                g.appendChild(card);
            });
            _content.appendChild(g);
        });
    }

    // -----------------------------------------------------------------------
    // Critical Route
    // -----------------------------------------------------------------------

    function renderCriticalRoute() {
        if (!_content) return;
        _content.innerHTML = "";

        var nodes = [], edges = [], path = [];
        try {
            if (window.NeuralGraph) {
                nodes = window.NeuralGraph.getAllNodes ? window.NeuralGraph.getAllNodes() : [];
                edges = window.NeuralGraph.getAllEdges ? window.NeuralGraph.getAllEdges() : [];
            }
            if (window.NeuralGraphTestData && nodes.length && edges.length) {
                var result = window.NeuralGraphTestData.findCriticalPath(nodes, edges);
                path = (result && result.path) ? result.path : (Array.isArray(result) ? result : []);
            }
        } catch (e) { /* swallow */ }

        if (!path.length) {
            var empty = _el("div", "bp-empty-state");
            empty.innerHTML = "<span>Geen kritieke route berekend</span>";
            var btn = _el("button", "bp-action-btn", "&#8594; Bereken route");
            btn.addEventListener("click", function () {
                if (window.BottleneckDashboard && window.BottleneckDashboard.detect) {
                    window.BottleneckDashboard.detect();
                }
            });
            empty.appendChild(btn);
            _content.appendChild(empty);
            return;
        }

        // Build a lookup of node data
        var nodeMap = {};
        nodes.forEach(function (n) { nodeMap[n.id] = n; });

        // Get bottleneck ids for styling
        var bottleneckIds = new Set();
        try {
            if (window.BottleneckDashboard && window.BottleneckDashboard.getLastResults) {
                var res = window.BottleneckDashboard.getLastResults();
                if (res && res.bottlenecks) {
                    res.bottlenecks.forEach(function (b) { bottleneckIds.add(b.node_id || b.id); });
                }
            }
        } catch (e) { /* swallow */ }

        var track = _el("div", "bp-route-track");
        path.forEach(function (nodeId, idx) {
            var node = nodeMap[nodeId] || { id: nodeId, label: nodeId };
            var isFirst  = (idx === 0);
            var isLast   = (idx === path.length - 1);
            var isBN     = bottleneckIds.has(nodeId);
            var pillType = isBN ? "bottleneck" : (isFirst || isLast ? (isFirst ? "start" : "end") : "normal");

            var wrap = _el("div", "bp-route-node");

            var pill = _el("div", "bp-route-pill bp-route-pill--" + pillType, _esc(node.label || nodeId));
            pill.title = node.description || "";
            pill.addEventListener("click", function () {
                if (window.NeuralGraph && window.NeuralGraph.focusNode) window.NeuralGraph.focusNode(nodeId);
            });

            var roleLabel = _el("div", "bp-route-role-label");
            if (isBN) roleLabel.textContent = "bottleneck";
            else if (isFirst) roleLabel.textContent = "start";
            else if (isLast) roleLabel.textContent = "eindpunt";
            else if (node.role) roleLabel.textContent = node.role;

            wrap.appendChild(pill);
            wrap.appendChild(roleLabel);
            track.appendChild(wrap);

            if (idx < path.length - 1) {
                track.appendChild(_el("div", "bp-route-arrow", "&#8594;"));
            }
        });
        _content.appendChild(track);
    }

    // -----------------------------------------------------------------------
    // Bottleneck Alerts
    // -----------------------------------------------------------------------

    function renderBottleneckAlerts() {
        if (!_content) return;
        _content.innerHTML = "";

        var showAlerts = function (alerts) {
            _cachedAlerts = alerts;
            _setBadge("alert-badge", alerts.length);
            updateAlertsTitlebar(alerts.length);

            if (!alerts.length) {
                var ok = _el("div", "bp-empty-state");
                ok.innerHTML = "<span class='bp-check-ok'>&#10003; Geen knelpunten gedetecteerd</span>";
                var btn = _el("button", "bp-action-btn", "&#9650; Nieuwe analyse");
                btn.style.marginTop = "6px";
                btn.addEventListener("click", function () {
                    if (window.BottleneckDashboard && window.BottleneckDashboard.detect) window.BottleneckDashboard.detect();
                });
                ok.appendChild(btn);
                _content.appendChild(ok);
                return;
            }

            var sorted = alerts.slice().sort(function (a, b) {
                var sev = { critical: 3, high: 2, moderate: 1, low: 0 };
                return (sev[b.severity] || 0) - (sev[a.severity] || 0);
            });

            var list = _el("div", "bp-alerts-list");
            sorted.forEach(function (alert) {
                var sev = alert.severity || "moderate";
                var dotCls = sev === "critical" || sev === "high" ? "critical" :
                             (sev === "hidden" ? "hidden" : "moderate");
                var stars = sev === "critical" ? "&#9733;&#9733;&#9733;" :
                            (sev === "high" ? "&#9733;&#9733;&#9734;" : "&#9733;&#9734;&#9734;");
                var starCls = sev === "critical" ? " bp-alert-stars--red" : "";
                var nodeId = alert.node_id || alert.id || "";
                var type   = alert.type || (sev === "critical" ? "Kritiek" : "Matig");

                var item = _el("div", "bp-alert-item");
                item.innerHTML =
                    "<span class='bp-alert-dot bp-alert-dot--" + dotCls + "'></span>" +
                    "<span class='bp-alert-name'>" + _esc(alert.label || alert.name || nodeId) + "</span>" +
                    "<span class='bp-alert-badge'>" + _esc(type) + "</span>" +
                    "<span class='bp-alert-stars" + starCls + "'>" + stars + "</span>";
                item.addEventListener("click", function () {
                    if (nodeId && window.NeuralGraph && window.NeuralGraph.focusNode) window.NeuralGraph.focusNode(nodeId);
                });
                list.appendChild(item);
            });

            var fullBtn = _el("button", "bp-action-btn", "Volledige analyse &#8250;");
            fullBtn.style.marginTop = "var(--space-2)";
            fullBtn.addEventListener("click", function () {
                if (window.BottleneckDashboard) window.BottleneckDashboard.detect();
            });
            _content.innerHTML = "";
            _content.appendChild(list);
            _content.appendChild(fullBtn);
        };

        // Show skeleton
        _content.innerHTML = "<div class='bp-empty-state'><span style='opacity:.5;font-size:10px'>Laden&#8230;</span></div>";

        if (_cachedAlerts !== null) {
            showAlerts(_cachedAlerts);
            return;
        }

        fetch("/api/bottleneck/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
            .then(function (r) { return r.ok ? r.json() : { bottlenecks: [] }; })
            .catch(function () { return { bottlenecks: [] }; })
            .then(function (data) {
                showAlerts(data.bottlenecks || data.alerts || []);
            });
    }

    // -----------------------------------------------------------------------
    // Badges + Titlebar alert
    // -----------------------------------------------------------------------

    function updateAlertsTitlebar(count) {
        var el = document.getElementById("tb-alerts");
        var cnt = document.getElementById("tb-alerts-count");
        if (!el) return;
        el.style.display = count > 0 ? "flex" : "none";
        if (cnt) cnt.textContent = count;
        _setBadge("alert-badge", count);
    }

    function updateBadges() {
        // Alerts
        fetch("/api/bottleneck/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
            .then(function (r) { return r.ok ? r.json() : { bottlenecks: [] }; })
            .catch(function () { return { bottlenecks: [] }; })
            .then(function (data) {
                var list = data.bottlenecks || data.alerts || [];
                _cachedAlerts = list;
                var count = list.length;
                _setBadge("alert-badge", count);
                updateAlertsTitlebar(count);
                if (window.StatusBar && window.StatusBar.setBottlenecks) window.StatusBar.setBottlenecks(count);
            });

        // KPIs
        fetch("/api/kpi/all")
            .then(function (r) { return r.ok ? r.json() : []; })
            .catch(function () { return []; })
            .then(function (list) { _setBadge("kpi-badge", list.length); });
    }

    // -----------------------------------------------------------------------
    // Collapse / expand
    // -----------------------------------------------------------------------

    function _toggleCollapse() {
        _collapsed = !_collapsed;
        if (_panel) _panel.setAttribute("data-collapsed", String(_collapsed));
    }

    // -----------------------------------------------------------------------
    // Render tab
    // -----------------------------------------------------------------------

    function renderTab(tabName) {
        _currentTab = tabName;
        document.querySelectorAll(".bp-tab").forEach(function (t) {
            t.classList.toggle("bp-tab--active", t.getAttribute("data-tab") === tabName);
        });
        if (!_content) return;
        _content.innerHTML = "";

        var map = {
            activity: renderActivityFeed,
            kpis:     renderKPISnapshot,
            route:    renderCriticalRoute,
            alerts:   renderBottleneckAlerts
        };
        if (map[tabName]) map[tabName]();
    }

    // -----------------------------------------------------------------------
    // Init
    // -----------------------------------------------------------------------

    function init() {
        _panel       = document.getElementById("bottom-panel");
        _content     = document.getElementById("bp-content");
        _collapseBtn = document.getElementById("bp-collapse");

        if (!_panel) return;

        // Tab click handlers
        document.querySelectorAll(".bp-tab").forEach(function (tab) {
            tab.addEventListener("click", function () {
                if (_collapsed) {
                    _collapsed = false;
                    _panel.setAttribute("data-collapsed", "false");
                }
                renderTab(tab.getAttribute("data-tab"));
            });
        });

        // Collapse button
        if (_collapseBtn) {
            _collapseBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                _toggleCollapse();
            });
        }

        // Double-click tab bar to toggle collapse
        var tabBar = document.getElementById("bp-tab-bar");
        if (tabBar) {
            tabBar.addEventListener("dblclick", function (e) {
                if (!e.target.closest(".bp-tab") && !e.target.closest(".bp-collapse-btn")) {
                    _toggleCollapse();
                }
            });
        }

        // Titlebar alerts click → alerts tab
        var tbAlerts = document.getElementById("tb-alerts");
        if (tbAlerts) {
            tbAlerts.addEventListener("click", function () {
                if (_collapsed) {
                    _collapsed = false;
                    _panel.setAttribute("data-collapsed", "false");
                }
                renderTab("alerts");
            });
        }

        // Custom events
        document.addEventListener("demo:loaded", function (e) {
            _cachedAlerts = null;
            addActivity("info", "Demo graph geladen", "Demo Network");
            updateBadges();
            renderTab(_currentTab);
        });

        document.addEventListener("bottleneck:detected", function (e) {
            _cachedAlerts = null;
            var count = e.detail ? (e.detail.count || 0) : 0;
            addActivity("warning", count + " bottlenecks gedetecteerd", "Analyse");
            updateBadges();
            if (_currentTab === "alerts") renderTab("alerts");
        });

        document.addEventListener("kpi:approved", function (e) {
            _cachedKPIs = null;
            addActivity("success", "KPIs goedgekeurd", (e.detail && e.detail.name) || "KPI");
            updateBadges();
        });

        document.addEventListener("measurement:saved", function (e) {
            addActivity("success", "Meting opgeslagen", (e.detail && e.detail.node) || "");
        });

        document.addEventListener("graph:saved", function () {
            addActivity("info", "Graph opgeslagen", "");
        });

        // Initial render
        setTimeout(function () {
            renderTab("activity");
            updateBadges();
        }, 500);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    window.BottomPanel = {
        init:          init,
        addActivity:   addActivity,
        updateBadges:  updateBadges,
        renderTab:     renderTab,
        get currentTab() { return _currentTab; },
        get collapsed()  { return _collapsed; }
    };

})();

// ✓ bottomPanel.js compleet
