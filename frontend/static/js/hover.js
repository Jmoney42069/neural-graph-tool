// FILE: hover.js
// DOES: Raycaster hover detection, smooth scale/emissive tweens, pulse ring, labels, edge highlights
// USES: THREE (global), window.NodeManager, window.EdgeManager
// EXPOSES: window.HoverManager

(function () {
    "use strict";

    var _raycaster  = new THREE.Raycaster();
    var _mouse      = new THREE.Vector2(-999, -999); // off-screen default
    var _meshes     = [];
    var _meshToId   = new WeakMap();
    var _hoveredId  = null;
    var _selectedId = null;  // persistently-selected node (click to set/clear)
    var _forcedIds  = new Set();

    var _camera   = null;
    var _renderer = null;
    var _tweensSettled = true;  // true when all node tweens are at rest values

    // ── Set raycaster targets ───────────────────────────────────────────────
    // No longer stores mesh list — InstancedMesh is fetched directly each time
    function _setMeshes(/* ignored */) {}

    // ── Hit test via InstancedMesh ──────────────────────────────────────────
    function _getNodeAtScreen(x, y, camera, renderer) {
        var iMesh = window.NodeManager && window.NodeManager.getInstancedMesh();
        if (!renderer || !camera || !iMesh) return null;
        var el   = renderer.domElement;
        var nx   = (x / el.offsetWidth)  * 2 - 1;
        var ny   = -(y / el.offsetHeight) * 2 + 1;
        _raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
        var hits = _raycaster.intersectObject(iMesh, false);
        if (!hits.length) return null;
        var all   = window.NodeManager.getAll();
        var entry = all[hits[0].instanceId];
        return entry ? entry.data : null;
    }

    // ── Init (attach to container) ──────────────────────────────────────────
    function _init() {
        var container = document.getElementById("graph-canvas");
        if (!container) return;

        container.addEventListener("mousemove", function (e) {
            var rect = container.getBoundingClientRect();
            _mouse.x = ((e.clientX - rect.left) / container.offsetWidth)  * 2 - 1;
            _mouse.y = -((e.clientY - rect.top)  / container.offsetHeight) * 2 + 1;
        });

        container.addEventListener("mouseleave", function () {
            _mouse.set(-999, -999);
        });

        container.addEventListener("click", function (e) {
            if (!_camera) return;
            var rect = container.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            var nodeData = _getNodeAtScreen(x, y, _camera, _renderer);

            if (nodeData) {
                if (_selectedId === nodeData.id) {
                    // Same node clicked → deselect
                    _selectedId = null;
                    if (window.EdgeManager) window.EdgeManager.resetHighlights();
                } else {
                    // New node clicked → persist its edge color
                    _selectedId = nodeData.id;
                    _applySelectedHighlight();
                }
            } else {
                // Clicked empty space → deselect
                _selectedId = null;
                if (window.EdgeManager) window.EdgeManager.resetHighlights();
            }

            // Show / hide inspector overlay
            var overlay = document.getElementById("node-inspector-overlay");
            if (overlay) overlay.classList.toggle("visible", !!nodeData);

            if (window.onNodeSelect) window.onNodeSelect(nodeData);
        });
    }

    function _applySelectedHighlight() {
        if (!_selectedId || !window.EdgeManager) return;
        var entry = window.NodeManager && window.NodeManager.get(_selectedId);
        if (!entry) return;
        var col = "#" + entry.baseHex.toString(16).padStart(6, "0");
        window.EdgeManager.highlightEdgesOf(_selectedId, col);
    }

    // ── Per-frame update (called from renderer._loop) ───────────────────────
    function _update(camera, renderer) {
        _camera   = camera;
        _renderer = renderer;
        if (!window.NodeManager) return;

        // Fast-exit: if mouse off-screen AND nothing is animating, skip everything
        var nothingActive = _hoveredId === null && _forcedIds.size === 0;
        var mouseOffscreen = _mouse.x === -999 && _mouse.y === -999;
        if (nothingActive && mouseOffscreen) return;

        // Raycast against InstancedMesh (single call for all nodes)
        var iMesh = window.NodeManager && window.NodeManager.getInstancedMesh();
        _raycaster.setFromCamera(_mouse, camera);
        var hits  = iMesh ? _raycaster.intersectObject(iMesh, false) : [];
        var newId = null;
        if (hits.length) {
            var all = window.NodeManager.getAll();
            var hit = all[hits[0].instanceId];
            if (hit) newId = hit.id;
        }

        if (newId !== _hoveredId) {
            if (_hoveredId) _onLeave(_hoveredId);
            if (newId)      _onEnter(newId);
            _hoveredId = newId;
            var container = document.getElementById("graph-canvas");
            if (container) container.style.cursor = newId ? "pointer" : "crosshair";
        }

        // Tween loop: only iterate nodes that are actually mid-animation
        // At rest: scaleTween≈1.0, emTween≈0.35, glowTween≈0.25
        // Skip entire loop if nothing hovered/forced
        if (_hoveredId !== null || _forcedIds.size > 0) {
            _tweensSettled = false;  // actively animating
            window.NodeManager.getAll().forEach(function (entry) {
                var isHov    = entry.id === _hoveredId;
                var isForced = _forcedIds.has(entry.id);
                var tgtScale = isHov ? 1.35 : 1.0;
                var tgtEm    = isHov ? 1.0 : (isForced ? 0.75 : 0.35);
                var tgtGlow  = isHov ? 0.55 : 0.25;

                entry.scaleTween += (tgtScale - entry.scaleTween) * 0.12;
                entry.emTween    += (tgtEm    - entry.emTween)    * 0.12;
                entry.glowTween  += (tgtGlow  - entry.glowTween)  * 0.10;
                entry.hovered = isHov;
            });
        } else if (!_tweensSettled) {
            // Decay any remaining animation toward rest values.
            // Once all tweens are at rest, set _tweensSettled = true and never
            // touch this loop again until the next hover event.
            var allSettled = true;
            window.NodeManager.getAll().forEach(function (entry) {
                if (entry.hovered) entry.hovered = false;
                var ds = entry.scaleTween - 1.0, de = entry.emTween - 0.35, dg = entry.glowTween - 0.25;
                if (Math.abs(ds) > 0.001 || Math.abs(de) > 0.001 || Math.abs(dg) > 0.001) {
                    entry.scaleTween += (1.0  - entry.scaleTween) * 0.12;
                    entry.emTween    += (0.35 - entry.emTween)    * 0.12;
                    entry.glowTween  += (0.25 - entry.glowTween)  * 0.10;
                    allSettled = false;
                }
            });
            if (allSettled) _tweensSettled = true;
        }
    }

    function _onEnter(id) {
        _tweensSettled = false;
        var entry = window.NodeManager && window.NodeManager.get(id);
        if (!entry) return;

        // Highlight connected edges
        if (window.EdgeManager) {
            var col = "#" + entry.baseHex.toString(16).padStart(6, "0");
            window.EdgeManager.highlightEdgesOf(id, col);
        }

        // Boost emissive of connected neighbours
        if (window.EdgeManager && window.NodeManager) {
            window.EdgeManager.getAll().forEach(function (e) {
                if (e.from === id || e.to === id) {
                    var nid   = e.from === id ? e.to : e.from;
                    var other = window.NodeManager.get(nid);
                    if (other) other.emTween = Math.max(other.emTween, 0.72);
                }
            });
        }

        // Enterprise hover panel
        _createHoverPanel(entry);
    }

    function _onLeave() {
        // Keep selected node's edge highlights on mouse-out
        if (_selectedId) {
            _applySelectedHighlight();
        } else {
            if (window.EdgeManager) window.EdgeManager.resetHighlights();
        }
        _removeHoverPanel();
    }

    // ── Hover panel helpers ─────────────────────────────────────────────────
    function _getScreenPos(pos3d) {
        if (!_camera || !_renderer) return null;
        var v = new THREE.Vector3(pos3d.x, pos3d.y, pos3d.z);
        v.project(_camera);
        var el   = _renderer.domElement;
        var rect = el.getBoundingClientRect();
        return {
            x: (v.x + 1) / 2 * rect.width  + rect.left,
            y: (-v.y + 1) / 2 * rect.height + rect.top,
        };
    }

    function _removeHoverPanel() {
        var el = document.getElementById("ng-node-hover-panel");
        if (el) el.remove();
    }

    function _createHoverPanel(entry) {
        _removeHoverPanel();
        var node = entry.data || {};

        var pos = _getScreenPos(entry.group.position);
        if (!pos) return;

        var panel = document.createElement("div");
        panel.id = "ng-node-hover-panel";
        panel.className = "ng-hover-panel";

        // ── Role badge ──────────────────────────────────────────────────────
        var role = node.role || "";
        if (!role) {
            if (node.bottleneck)  role = "Bottleneck";
            else if (node.bridge) role = "Brug node";
            else if (node.critical) role = "Kritiek pad";
            else if (node.start)  role = "Startpunt";
            else if (node.end)    role = "Eindpunt";
        }
        var roleColors = {
            "Bottleneck": "#ee0055",
            "Brug node":  "#ff9900",
            "Kritiek pad":"#ee6600",
            "Startpunt":  "#44aaff",
            "Eindpunt":   "#88ff88",
        };
        if (role) {
            var badgeColor = roleColors[role] || "#8888cc";
            var badge = document.createElement("div");
            badge.style.cssText = "display:inline-block;padding:1px 8px;border-radius:10px;" +
                "font-size:9px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;" +
                "margin-bottom:6px;background:" + badgeColor + "22;color:" + badgeColor +
                ";border:1px solid " + badgeColor + "55;";
            badge.textContent = role;
            panel.appendChild(badge);
        }

        // ── Node label ──────────────────────────────────────────────────────
        var nameEl = document.createElement("div");
        nameEl.style.cssText = "font-weight:600;font-size:12px;color:var(--text-primary,#e8e8f0);" +
            "margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;";
        nameEl.textContent = node.label || node.name || entry.id || "Node";
        panel.appendChild(nameEl);

        // ── Health gauge (half-circle SVG arc) ──────────────────────────────
        var health = Math.round(node.health || node.score || node.weight || 75);
        health = Math.max(0, Math.min(100, health));
        var R = 22;
        var fullArc = Math.PI * R;
        var dashOffset = fullArc * (1 - health / 100);
        var gaugeColor = health >= 70 ? "#33ffaa" : health >= 40 ? "#ffbb33" : "#ff5533";

        var gaugeRow = document.createElement("div");
        gaugeRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px;";

        var gaugeWrap = document.createElement("div");
        gaugeWrap.style.cssText = "position:relative;width:56px;height:32px;flex-shrink:0;";
        gaugeWrap.innerHTML =
            '<svg viewBox="0 0 56 32" width="56" height="32" overflow="visible">' +
            '<path d="M6,28 A22,22 0 0,1 50,28" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="4" stroke-linecap="round"/>' +
            '<path d="M6,28 A22,22 0 0,1 50,28" fill="none" stroke="' + gaugeColor + '" stroke-width="4" stroke-linecap="round"' +
            ' stroke-dasharray="' + fullArc.toFixed(1) + '" stroke-dashoffset="' + dashOffset.toFixed(1) + '"/>' +
            '<text x="28" y="26" text-anchor="middle" font-size="10" font-family="var(--font-data,monospace)"' +
            ' fill="' + gaugeColor + '" font-weight="600">' + health + '</text>' +
            '</svg>';

        var gaugeLabel = document.createElement("div");
        gaugeLabel.style.cssText = "font-size:9px;color:var(--text-muted,#888);text-transform:uppercase;" +
            "letter-spacing:0.06em;line-height:1.4;white-space:pre;";
        gaugeLabel.textContent = "Health\nscore";

        gaugeRow.appendChild(gaugeWrap);
        gaugeRow.appendChild(gaugeLabel);
        panel.appendChild(gaugeRow);

        // ── KPI mini-summary ────────────────────────────────────────────────
        var kpiRows = [];
        if (node.kpis && node.kpis.length) {
            node.kpis.slice(0, 3).forEach(function (k) {
                kpiRows.push({ label: k.name || k.label || "KPI", val: k.value != null ? k.value : k.val });
            });
        }
        if (!kpiRows.length && node.weight != null) {
            kpiRows.push({ label: "Weight", val: Math.round(node.weight * 100) / 100 });
        }
        var connCount = (window.EdgeManager ? window.EdgeManager.getAll().filter(function (e) {
            return e.from === entry.id || e.to === entry.id;
        }).length : null);
        if (connCount != null) kpiRows.push({ label: "Connections", val: connCount });

        if (kpiRows.length) {
            var kpiWrap = document.createElement("div");
            kpiWrap.style.cssText = "margin-bottom:4px;";
            kpiRows.slice(0, 3).forEach(function (row) {
                var line = document.createElement("div");
                line.style.cssText = "display:flex;justify-content:space-between;gap:12px;font-size:10px;line-height:1.8;";
                var lbl = document.createElement("span");
                lbl.style.cssText = "color:var(--text-muted,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
                lbl.textContent = row.label;
                var val = document.createElement("span");
                val.style.cssText = "font-family:var(--font-data,monospace);color:var(--text-primary,#e8e8f0);flex-shrink:0;";
                val.textContent = (row.val != null) ? row.val : "\u2014";
                line.appendChild(lbl);
                line.appendChild(val);
                kpiWrap.appendChild(line);
            });
            panel.appendChild(kpiWrap);

            if (window.KPIManager && window.KPIManager.showNodeKPIPanel) {
                var allBtn = document.createElement("button");
                allBtn.style.cssText = "background:none;border:none;color:var(--accent,#4f8ef7);font-size:9px;" +
                    "cursor:pointer;padding:0;font-family:inherit;pointer-events:all;";
                allBtn.textContent = "Alle KPIs \u203a";
                var _eid = entry.id;
                allBtn.addEventListener("mousedown", function (e) {
                    e.stopPropagation();
                    window.KPIManager.showNodeKPIPanel(_eid);
                });
                panel.appendChild(allBtn);
            }
        }

        // ── Trend indicator ─────────────────────────────────────────────────
        var trend = (node.trend != null) ? node.trend : node.delta;
        if (trend != null) {
            var trendRow = document.createElement("div");
            trendRow.style.cssText = "display:flex;align-items:center;gap:4px;margin-top:5px;padding-top:5px;" +
                "border-top:1px solid rgba(255,255,255,0.07);";
            var trendAbs   = Math.abs(trend);
            var trendColor = trend > 5 ? "#44ffee" : trend < -5 ? "#ff5566" : "#ffbb33";
            var arrow      = trend > 0 ? "\u2191" : trend < 0 ? "\u2193" : "\u2192";
            trendRow.innerHTML =
                '<span style="font-size:15px;line-height:1;color:' + trendColor + '">' + arrow + '</span>' +
                '<span style="font-family:var(--font-data,monospace);font-size:11px;font-weight:600;color:' + trendColor + '">' +
                trendAbs.toFixed(1) + '%</span>' +
                '<span style="font-size:9px;color:var(--text-muted,#888);">trend</span>';
            panel.appendChild(trendRow);
        }

        // ── Position panel ──────────────────────────────────────────────────
        panel.style.cssText += "left:-9999px;top:-9999px;"; // measure off-screen
        document.body.appendChild(panel);

        var pw = panel.offsetWidth  || 200;
        var ph = panel.offsetHeight || 120;
        var margin = 16;

        var left = (pos.x + 60 + pw + margin < window.innerWidth)
            ? pos.x + 60
            : pos.x - pw - 20;
        var top = Math.max(margin, Math.min(pos.y - ph / 2, window.innerHeight - ph - margin));

        panel.style.left = left + "px";
        panel.style.top  = top  + "px";
    }

    function _forceHighlight(id) { _forcedIds.add(id); _tweensSettled = false; }
    function _clearForced()      { _forcedIds.clear(); _tweensSettled = false; }

    window.HoverManager = {
        init:             _init,
        setMeshes:        _setMeshes,
        update:           _update,
        getNodeAtScreen:  _getNodeAtScreen,
        forceHighlight:   _forceHighlight,
        clearForced:      _clearForced,
        getHoveredId:     function () { return _hoveredId; },
        getSelectedId:    function () { return _selectedId; },
        clearSelection:   function () { _selectedId = null; if (window.EdgeManager) window.EdgeManager.resetHighlights(); },
        _setSelected:     function (id) { _selectedId = id; },
        isTweensSettled:  function () { return _tweensSettled; },
    };

    // Auto-init
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", _init);
    } else {
        _init();
    }

})();
