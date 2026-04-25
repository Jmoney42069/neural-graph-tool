// FILE: nodes.js
// DOES: Renders ALL nodes as ONE InstancedMesh (cores) + ONE Points cloud (glows)
//       = 2 draw calls total for 500 nodes, vs 2000 draw calls with per-node meshes.
//       entry.group is a position-only holder (NOT in scene) so all existing
//       physics/drag/edge code that reads entry.group.position still works.
// USES: THREE (global)
// EXPOSES: window.NodeManager

(function () {
    "use strict";

    // ── Category palette — neural/scientific, dim at rest, glow on hover ────
    var CAT_COLOR = {
        product:    0x2060cc,  // synapse blue
        process:    0x10a8a8,  // axon teal
        compliance: 0xb02858,  // cortex rose
        finance:    0x18a05a,  // dendrite emerald
        customer:   0x7030bb,  // cerebral violet
        person:     0xcc6018,  // neural amber
        system:     0x1888cc,  // deep signal blue
        location:   0x6aa018,  // muted moss
        concept:    0x4a62b8,  // default periwinkle
        brain_core: 0xe8c840,  // golden — instruction hub
    };

    var CAT_GLOW_HEX = {
        product:    "#4a90ff",
        process:    "#30e0e0",
        compliance: "#ff5090",
        finance:    "#30e08a",
        customer:   "#b060ff",
        person:     "#ffaa30",
        system:     "#30b8ff",
        location:   "#90d830",
        concept:    "#7888e8",
        brain_core: "#ffe060",  // golden glow
    };

    // ── Glow texture cache ─────────────────────────────────────────────────
    var _glowCache = Object.create(null);

    function _glowTexture(hexColor) {
        if (_glowCache[hexColor]) return _glowCache[hexColor];
        var canvas = document.createElement("canvas");
        canvas.width = canvas.height = 128;
        var ctx  = canvas.getContext("2d");
        var grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0,   hexColor + "cc");
        grad.addColorStop(0.4, hexColor + "44");
        grad.addColorStop(1,   hexColor + "00");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 128);
        var tex = new THREE.CanvasTexture(canvas);
        _glowCache[hexColor] = tex;
        return tex;
    }

    function _catColor(cat) { return CAT_COLOR[cat]    || 0xe0e0ff; }
    function _catGlow(cat)  { return CAT_GLOW_HEX[cat] || "#c0c0ff"; }

    // ── GPU resources ──────────────────────────────────────────────────────
    var _nodeMap  = Object.create(null); // id → entry
    var _nodeList = [];                  // ordered; index = instance index in _iMesh

    var _iMesh       = null; // THREE.InstancedMesh  — ONE draw call for all nodes
    var _glowPts     = null; // THREE.Points         — ONE draw call for all glows
    var _glowPosAttr = null;
    var _glowColAttr = null;
    var _scene       = null;

    // Per-frame reusable (zero allocation in hot path) + animation clock
    var _col  = new THREE.Color();
    var _time = 0;  // continuous clock incremented in syncInstances (~60fps)

    // ── Entry ──────────────────────────────────────────────────────────────
    function _createEntry(data, idx) {
        var cat = data.category || "concept";
        var baseHex;
        if (data.color) {
            baseHex = parseInt(data.color.replace("#", ""), 16);
        } else {
            baseHex = _catColor(cat);
        }

        // Plain Object3D used ONLY as position holder (not added to scene)
        var group = new THREE.Object3D();
        if (typeof data.x === "number") {
            group.position.set(data.x, data.y || 0, data.z || 0);
        }

        var sz = (typeof data.size === "number" && data.size > 0) ? data.size : 1.0;

        // HTML label overlay
        var labelEl = document.createElement("div");
        labelEl.className   = "node-label";
        labelEl.textContent = data.label || data.id;
        var hexStr = "#" + baseHex.toString(16).padStart(6, "0");
        labelEl.style.setProperty("--node-color", hexStr);
        var lc = document.getElementById("label-container");
        if (lc) lc.appendChild(labelEl);

        return {
            id:         data.id,
            idx:        idx,
            data:       data,
            group:      group,
            baseHex:    baseHex,
            glowHex:    data.color || _catGlow(cat),
            sz:         sz,
            labelEl:    labelEl,
            hovered:    false,
            scaleTween: sz,
            emTween:    sz > 1.2 ? 0.55 : 0.35,
            glowTween:  sz > 1.2 ? 0.40 : 0.25,
            _pulseT:       0,
            _pulseOffset:  Math.random() * Math.PI * 2,  // unique breathing phase per node
        };
    }

    // ── Build / rebuild the GPU InstancedMesh + Points ─────────────────────
    function _buildInstanced(scene) {
        _scene = scene;

        // Dispose old GPU objects
        if (_iMesh) {
            scene.remove(_iMesh);
            _iMesh.geometry.dispose();
            _iMesh.material.dispose();
            _iMesh = null;
        }
        if (_glowPts) {
            scene.remove(_glowPts);
            _glowPts.geometry.dispose();
            _glowPts.material.dispose();
            _glowPts = null;
        }
        _glowPosAttr = null;
        _glowColAttr = null;

        var n = _nodeList.length;
        if (!n) return;

        // ── Core InstancedMesh ──────────────────────────────────────────
        var coreGeom = new THREE.SphereGeometry(3.0, 16, 11);  // neurons
        var coreMat  = new THREE.MeshBasicMaterial();  // instance colour via setColorAt
        _iMesh = new THREE.InstancedMesh(coreGeom, coreMat, n);
        _iMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(_iMesh);

        // ── Glow Points cloud ────────────────────────────────────────────
        var glowPos  = new Float32Array(n * 3);
        var glowCol  = new Float32Array(n * 3);
        var glowGeom = new THREE.BufferGeometry();
        _glowPosAttr = new THREE.BufferAttribute(glowPos, 3);
        _glowColAttr = new THREE.BufferAttribute(glowCol, 3);
        _glowPosAttr.setUsage(THREE.DynamicDrawUsage);
        _glowColAttr.setUsage(THREE.DynamicDrawUsage);
        glowGeom.setAttribute("position", _glowPosAttr);
        glowGeom.setAttribute("color",    _glowColAttr);
        _glowPts = new THREE.Points(glowGeom, new THREE.PointsMaterial({
            size:            36,
            sizeAttenuation: true,
            vertexColors:    true,
            transparent:     true,
            opacity:         0.65,
            blending:        THREE.AdditiveBlending,
            depthWrite:      false,
            map:             _glowTexture("#ffffff"),
        }));
        scene.add(_glowPts);

        // Fill initial state
        syncInstances();
    }

    // ── syncInstances — write positions + tween state + pulse to GPU buffers ─
    function syncInstances() {
        if (!_iMesh) return;

        _time += 0.016;  // ~60fps animation clock

        var matArr  = _iMesh.instanceMatrix.array;
        var glowPos = _glowPosAttr ? _glowPosAttr.array : null;
        var glowCol = _glowColAttr ? _glowColAttr.array : null;

        for (var i = 0, n = _nodeList.length; i < n; i++) {
            var e = _nodeList[i];
            var p = e.group.position;

            // Breathing pulse — unique phase per node, visibly alive
            var breathe = 1.0 + Math.sin(_time * 1.5 + e._pulseOffset) * 0.13;
            var s = e.sz * e.scaleTween * breathe;

            // Column-major 4×4 translate+scale matrix (no rotation needed for spheres)
            var b = i * 16;
            matArr[b]    = s; matArr[b+1]  = 0; matArr[b+2]  = 0; matArr[b+3]  = 0;
            matArr[b+4]  = 0; matArr[b+5]  = s; matArr[b+6]  = 0; matArr[b+7]  = 0;
            matArr[b+8]  = 0; matArr[b+9]  = 0; matArr[b+10] = s; matArr[b+11] = 0;
            matArr[b+12] = p.x; matArr[b+13] = p.y; matArr[b+14] = p.z; matArr[b+15] = 1;

            // Shimmer: slow hue/brightness oscillation layered on top of hover state
            var shimmer = 1.0 + Math.sin(_time * 0.8 + e._pulseOffset * 1.4) * 0.11;
            _col.setHex(e.baseHex);
            var bright = (0.30 + e.emTween * 0.55) * shimmer;
            _col.r = Math.min(_col.r * bright, 1);
            _col.g = Math.min(_col.g * bright, 1);
            _col.b = Math.min(_col.b * bright, 1);
            _iMesh.setColorAt(i, _col);

            // Glow position
            if (glowPos) {
                var gp = i * 3;
                glowPos[gp]   = p.x;
                glowPos[gp+1] = p.y;
                glowPos[gp+2] = p.z;
            }
            // Glow colour: pulsing intensity driven by breathing phase
            if (glowCol) {
                _col.setHex(e.baseHex);
                var gb = i * 3;
                // Glow pulses in sync with scale but with slight phase lag
                var glowPhase = 0.50 + Math.sin(_time * 1.5 + e._pulseOffset + 0.7) * 0.32;
                var gf = glowPhase * (0.15 + e.glowTween * 0.50);
                glowCol[gb]   = Math.min(_col.r * gf, 1);
                glowCol[gb+1] = Math.min(_col.g * gf, 1);
                glowCol[gb+2] = Math.min(_col.b * gf, 1);
            }
        }

        _iMesh.instanceMatrix.needsUpdate = true;
        if (_iMesh.instanceColor) _iMesh.instanceColor.needsUpdate = true;
        if (_glowPosAttr) _glowPosAttr.needsUpdate = true;
        if (_glowColAttr) _glowColAttr.needsUpdate = true;
    }

    // ── Public CRUD ────────────────────────────────────────────────────────
    function _add(data /*, scene — kept for API compat */) {
        if (_nodeMap[data.id]) return;
        var idx   = _nodeList.length;
        var entry = _createEntry(data, idx);
        _nodeList.push(entry);
        _nodeMap[data.id] = entry;
        // buildInstanced() called once after full batch add by renderer.js
    }

    function _remove(id, scene) {
        var e = _nodeMap[id];
        if (!e) return;
        if (e.labelEl && e.labelEl.parentNode) e.labelEl.parentNode.removeChild(e.labelEl);
        delete _nodeMap[id];
        _nodeList = _nodeList.filter(function (n) { return n.id !== id; });
        for (var i = 0; i < _nodeList.length; i++) _nodeList[i].idx = i;
        if (_scene) _buildInstanced(_scene);
    }

    function _clear(scene) {
        _nodeList.forEach(function (e) {
            if (e.labelEl && e.labelEl.parentNode) e.labelEl.parentNode.removeChild(e.labelEl);
        });
        _nodeList = [];
        _nodeMap  = Object.create(null);
        if (_iMesh && scene) {
            scene.remove(_iMesh);
            _iMesh.geometry.dispose();
            _iMesh.material.dispose();
            _iMesh = null;
        }
        if (_glowPts && scene) {
            scene.remove(_glowPts);
            _glowPts.geometry.dispose();
            _glowPts.material.dispose();
            _glowPts = null;
        }
        _glowPosAttr = null;
        _glowColAttr = null;
    }

    function _get(id)  { return _nodeMap[id] || null; }
    function _getAll() { return _nodeList; }

    function _getInstancedMesh() { return _iMesh; }

    // Legacy shim — old code may call getMeshes(); returns empty (InstancedMesh used directly)
    function _getMeshes() { return []; }

    function _applyProps(id, props) {
        var e = _nodeMap[id];
        if (!e) return;
        if (props.label !== undefined) {
            if (e.labelEl) e.labelEl.textContent = props.label;
            e.data.label = props.label;
        }
        if (props.category !== undefined) {
            e.baseHex = _catColor(props.category);
            e.glowHex = _catGlow(props.category);
            e.data.category = props.category;
        }
        if (props.color !== undefined) {
            e.baseHex = parseInt(props.color.replace("#", ""), 16);
            e.glowHex = props.color;
        }
    }

    window.NodeManager = {
        add:              _add,
        remove:           _remove,
        clear:            _clear,
        get:              _get,
        getAll:           _getAll,
        getMeshes:        _getMeshes,
        getInstancedMesh: _getInstancedMesh,
        buildInstanced:   _buildInstanced,
        syncInstances:    syncInstances,
        applyProps:       _applyProps,
    };

})();
