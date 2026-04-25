/*!
 * minimap.js — NeuralGraph Step 10: Standalone 2D Minimap
 *
 * Renders a 160×120 top-down (XZ plane) overview canvas in the bottom-right
 * corner of #graph-canvas. Draws all nodes (colour-coded by category), edge
 * lines, and a viewport indicator rectangle derived from the live camera state.
 *
 * Globals used:
 *   window.NeuralGraph  (getAllNodes, getAllEdges, getNodeWorldPos, getCameraState)
 *
 * Globals exposed:
 *   window.NeuralGraphMinimap = { toggle, isVisible }
 */
(function () {
    "use strict";

    // ── constants ─────────────────────────────────────────────────────────────
    var MM_W   = 160;
    var MM_H   = 120;
    var MM_PAD = 10;   // padding inside canvas before graph area

    // Category colours matching the main theme
    var CAT_COLOR = {
        product:    "#4f8ef7",
        customer:   "#b44ff7",
        process:    "#f7a04f",
        compliance: "#f74f6a",
        finance:    "#4ff7a0",
        _default:   "#8a8aba",
    };

    var CAM_FOV_DEG = 60;   // must match CAM_FOV in neuralGraph3D.js

    // ── state ─────────────────────────────────────────────────────────────────
    var _canvas   = null;
    var _ctx      = null;
    var _visible  = true;
    var _rafId    = null;
    var _paused   = false;  // briefly true during graph reload

    // Stored per-frame so the click handler can reverse-project
    var _bounds   = null;   // { minX, maxX, minZ, maxZ }
    var _scaleX   = 1;
    var _scaleZ   = 1;

    // ── coordinate helpers ────────────────────────────────────────────────────
    function _toMM(worldX, worldZ) {
        if (!_bounds) return { mx: 0, my: 0 };
        return {
            mx: MM_PAD + (worldX - _bounds.minX) * _scaleX,
            my: MM_PAD + (worldZ - _bounds.minZ) * _scaleZ,
        };
    }

    function _fromMM(mx, my) {
        if (!_bounds) return { worldX: 0, worldZ: 0 };
        return {
            worldX: _bounds.minX + (mx - MM_PAD) / _scaleX,
            worldZ: _bounds.minZ + (my - MM_PAD) / _scaleZ,
        };
    }

    // ── draw loop ─────────────────────────────────────────────────────────────
    function _draw() {
        _rafId = requestAnimationFrame(_draw);

        if (!_visible || !_ctx || _paused) return;
        // Wait until Three.js renderer has initialised
        if (!window.NeuralGraph || !window.NeuralGraph.getAllNodes) return;

        var nodes = window.NeuralGraph.getAllNodes();
        var edges = window.NeuralGraph.getAllEdges();

        if (nodes.length === 0) { _drawEmpty(); return; }

        // ── collect world positions ──────────────────────────────────────────
        var positions = {};
        nodes.forEach(function (nd) {
            var p = window.NeuralGraph.getNodeWorldPos(nd.id);
            if (p) positions[nd.id] = p;
        });

        // ── compute XZ bounding box ──────────────────────────────────────────
        var minX =  Infinity, maxX = -Infinity;
        var minZ =  Infinity, maxZ = -Infinity;
        var ids = Object.keys(positions);
        ids.forEach(function (id) {
            var p = positions[id];
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.z < minZ) minZ = p.z;
            if (p.z > maxZ) maxZ = p.z;
        });

        var margin = 22;
        minX -= margin; maxX += margin;
        minZ -= margin; maxZ += margin;

        var drawW = MM_W - MM_PAD * 2;
        var drawH = MM_H - MM_PAD * 2;

        _bounds = { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ };
        _scaleX = drawW / (maxX - minX || 1);
        _scaleZ = drawH / (maxZ - minZ || 1);

        // ── background ───────────────────────────────────────────────────────
        _ctx.fillStyle = "#09090f";
        _ctx.fillRect(0, 0, MM_W, MM_H);

        // ── edge lines ───────────────────────────────────────────────────────
        _ctx.strokeStyle = "#2a2a4a";
        _ctx.lineWidth   = 0.7;
        edges.forEach(function (ed) {
            var a = positions[ed.from];
            var b = positions[ed.to];
            if (!a || !b) return;
            var pa = _toMM(a.x, a.z);
            var pb = _toMM(b.x, b.z);
            _ctx.beginPath();
            _ctx.moveTo(pa.mx, pa.my);
            _ctx.lineTo(pb.mx, pb.my);
            _ctx.stroke();
        });

        // ── node dots ────────────────────────────────────────────────────────
        nodes.forEach(function (nd) {
            var p = positions[nd.id];
            if (!p) return;
            var pm  = _toMM(p.x, p.z);
            var col = CAT_COLOR[nd.category] || CAT_COLOR._default;
            _ctx.beginPath();
            _ctx.arc(pm.mx, pm.my, 2.5, 0, Math.PI * 2);
            _ctx.fillStyle = col;
            _ctx.fill();
        });

        // ── viewport indicator ───────────────────────────────────────────────
        if (typeof window.NeuralGraph.getCameraState === "function") {
            var cs = window.NeuralGraph.getCameraState();
            // The camera looks at (panX, panZ).
            // Estimate visible half-width in world units:
            //   hw = radius * tan(fov/2) * aspect
            //   hh = radius * tan(fov/2)
            var tanHalf = Math.tan((CAM_FOV_DEG * Math.PI / 180) / 2);
            var hw = cs.radius * tanHalf * cs.aspect;
            var hh = cs.radius * tanHalf;

            var tl = _toMM(cs.panX - hw, cs.panZ - hh);
            var br = _toMM(cs.panX + hw, cs.panZ + hh);

            _ctx.setLineDash([3, 2]);
            _ctx.strokeStyle = "rgba(79, 142, 247, 0.55)";
            _ctx.lineWidth   = 1;
            _ctx.strokeRect(tl.mx, tl.my, br.mx - tl.mx, br.my - tl.my);
            _ctx.setLineDash([]);

            // Camera-target crosshair dot
            var ctr = _toMM(cs.panX, cs.panZ);
            _ctx.beginPath();
            _ctx.arc(ctr.mx, ctr.my, 3, 0, Math.PI * 2);
            _ctx.fillStyle = "rgba(79, 142, 247, 0.75)";
            _ctx.fill();
        }

        // ── border ───────────────────────────────────────────────────────────
        _ctx.strokeStyle = "#2a2a4a";
        _ctx.lineWidth   = 1;
        _ctx.strokeRect(0.5, 0.5, MM_W - 1, MM_H - 1);

        // ── label ─────────────────────────────────────────────────────────────
        _ctx.fillStyle    = "#3a3a5a";
        _ctx.font         = '8px "IBM Plex Mono", monospace';
        _ctx.textAlign    = "left";
        _ctx.textBaseline = "bottom";
        _ctx.fillText("MINIMAP", MM_PAD, MM_H - 3);
    }

    function _drawEmpty() {
        _ctx.fillStyle = "#09090f";
        _ctx.fillRect(0, 0, MM_W, MM_H);
        _ctx.strokeStyle = "#1e1e2e";
        _ctx.lineWidth   = 1;
        _ctx.strokeRect(0.5, 0.5, MM_W - 1, MM_H - 1);
        _ctx.fillStyle    = "#2a2a4a";
        _ctx.font         = '8px "IBM Plex Mono", monospace';
        _ctx.textAlign    = "center";
        _ctx.textBaseline = "middle";
        _ctx.fillText("MINIMAP", MM_W / 2, MM_H / 2);
    }

    // ── click-to-focus ────────────────────────────────────────────────────────
    function _onMinimapClick(e) {
        if (!window.NeuralGraph || !_bounds) return;
        var rect   = _canvas.getBoundingClientRect();
        // Canvas pixel coords (account for canvas internal scale vs. CSS size)
        var scaleCSS_X = MM_W / rect.width;
        var scaleCSS_Z = MM_H / rect.height;
        var mx = (e.clientX - rect.left) * scaleCSS_X;
        var mz = (e.clientY - rect.top)  * scaleCSS_Z;

        var world = _fromMM(mx, mz);

        // Find closest node
        var nodes = window.NeuralGraph.getAllNodes();
        var closest   = null;
        var closestD  = Infinity;

        nodes.forEach(function (nd) {
            var p = window.NeuralGraph.getNodeWorldPos(nd.id);
            if (!p) return;
            // Map world pos to minimap coords for distance comparison
            var pm = _toMM(p.x, p.z);
            var dx = pm.mx - mx;
            var dz = pm.my - mz;
            var d  = dx * dx + dz * dz;
            if (d < closestD) {
                closestD = d;
                closest  = nd;
            }
        });

        // 12px hit radius
        if (closest && Math.sqrt(closestD) < 12 && window.NeuralGraph.focusNode) {
            window.NeuralGraph.focusNode(closest.id);
        }
    }

    // ── toggle visibility ─────────────────────────────────────────────────────
    function _toggle() {
        _visible = !_visible;
        if (_canvas) {
            _canvas.classList.toggle("ng-hidden", !_visible);
        }
    }

    // ── bootstrap ─────────────────────────────────────────────────────────────
    document.addEventListener("DOMContentLoaded", function () {
        var container = document.getElementById("graph-canvas");
        if (!container) return;

        _canvas        = document.createElement("canvas");
        _canvas.id     = "ng-minimap";
        _canvas.width  = MM_W;
        _canvas.height = MM_H;
        _canvas.title  = "Minimap — click a node to focus";
        _ctx           = _canvas.getContext("2d");

        container.appendChild(_canvas);

        _canvas.addEventListener("click", _onMinimapClick);

        // Wait for renderer to be ready before starting the draw loop.
        // Poll every 200 ms; once NeuralGraph is available start the loop
        // and fade the minimap in.
        function _waitForRenderer() {
            if (window.NeuralGraph && window.NeuralGraph.getAllNodes) {
                // Give ThreeJS one more frame to paint before we show the minimap
                requestAnimationFrame(function () {
                    _draw();
                    setTimeout(function () {
                        _canvas.classList.add("mm-ready");
                    }, 400);
                });
            } else {
                setTimeout(_waitForRenderer, 200);
            }
        }
        setTimeout(_waitForRenderer, 800);

        window.NeuralGraphMinimap = {
            toggle:    _toggle,
            isVisible: function () { return _visible; },
            // Pause drawing briefly during graph reload to avoid glitch
            freezeFor: function (ms) {
                _paused = true;
                setTimeout(function () { _paused = false; }, ms || 600);
            },
        };
    });

})();
