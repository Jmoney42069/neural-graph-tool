// FILE: edges.js
// DOES: Renders ALL edges as ONE BatchedLineSegments (BufferGeometry).
//       syncPositions() writes Float32Array in-place — zero geometry recreation.
//       Spark animation uses lazy linear interpolation.
// USES: THREE (global), window.NodeManager
// EXPOSES: window.EdgeManager

(function () {
    "use strict";

    // Default edge colour (dim blue-grey for the batch)
    var DEF_R = 0.16, DEF_G = 0.30, DEF_B = 0.52;
    var HI_R  = 0.60, HI_G  = 0.85, HI_B  = 1.00;  // highlight colour

    var _scene      = null;
    var _batchMesh  = null;   // THREE.LineSegments — single draw call for ALL edges
    var _posAttr    = null;   // Float32Array attribute (6 floats per edge: x0y0z0 x1y1z1)
    var _colAttr    = null;   // Float32Array attribute (6 floats per edge: r0g0b0 r1g1b1)
    var _edgeList   = [];     // [{from, to, data}]  — ordered, index = position in buffer
    var _indexMap   = Object.create(null); // key → index in _edgeList
    var _visible    = false;
    var _dirty      = false;  // true when _edgeList changed and batch needs rebuild
    var _rebuildPending = false;  // deferred rebuild flag

    // Legacy _edgeMap for sparks + picking (lightweight: no mesh stored)
    var _edgeMap  = Object.create(null); // key → {from, to, data, idx}

    // ── Batch geometry ─────────────────────────────────────────────────────
    function _rebuildBatch() {
        _dirty = false;
        _rebuildPending = false;
        if (!_scene) return;

        // Dispose old
        if (_batchMesh) {
            _scene.remove(_batchMesh);
            _batchMesh.geometry.dispose();
            _batchMesh.material.dispose();
            _batchMesh = null;
        }

        var n = _edgeList.length;
        if (n === 0) return;

        // Allocate typed arrays (2 verts × 3 coords per edge)
        var positions = new Float32Array(n * 6);
        var colors    = new Float32Array(n * 6);

        // Fill initial positions + default colour
        for (var i = 0; i < n; i++) {
            var e = _edgeList[i];
            var fp = _nodePosRaw(e.from);
            var tp = _nodePosRaw(e.to);
            var b  = i * 6;
            positions[b]   = fp[0]; positions[b+1] = fp[1]; positions[b+2] = fp[2];
            positions[b+3] = tp[0]; positions[b+4] = tp[1]; positions[b+5] = tp[2];
            colors[b]   = DEF_R; colors[b+1] = DEF_G; colors[b+2] = DEF_B;
            colors[b+3] = DEF_R; colors[b+4] = DEF_G; colors[b+5] = DEF_B;
        }

        var geom = new THREE.BufferGeometry();
        _posAttr = new THREE.BufferAttribute(positions, 3);
        _colAttr = new THREE.BufferAttribute(colors,    3);
        _posAttr.setUsage(THREE.DynamicDrawUsage);
        _colAttr.setUsage(THREE.DynamicDrawUsage);
        geom.setAttribute("position", _posAttr);
        geom.setAttribute("color",    _colAttr);

        var mat = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent:  true,
            opacity:      0.30,
            blending:     THREE.AdditiveBlending,
            depthWrite:   false,
        });

        _batchMesh = new THREE.LineSegments(geom, mat);
        _batchMesh.visible = _visible;
        _batchMesh.renderOrder = 0;
        _scene.add(_batchMesh);
    }

    function _scheduleBuild() {
        if (_rebuildPending) return;
        _rebuildPending = true;
        // Defer to next microtask — batches all add() calls in one tick
        Promise.resolve().then(function () {
            if (_dirty) _rebuildBatch();
        });
    }

    // Fast node position read — returns [x,y,z] without Vector3 allocation
    function _nodePosRaw(id) {
        var e = window.NodeManager && window.NodeManager.get(id);
        if (!e) return [0, 0, 0];
        var p = e.group.position;
        return [p.x, p.y, p.z];
    }

    // ── Electric sparks (linear travel along edge endpoints) ─────────────
    var MAX_SPARKS = 10;
    var _sparks    = [];
    var _lastTick  = 0;
    var _pulseGeom = null;
    var _up        = new THREE.Vector3(0, 1, 0);
    var _thinking  = false;

    function _getPulseGeom() {
        if (!_pulseGeom) _pulseGeom = new THREE.SphereGeometry(0.6, 5, 4);
        return _pulseGeom;
    }

    function _edgesFrom(nodeId) {
        return Object.keys(_edgeMap).filter(function (k) {
            return _edgeMap[k].from === nodeId || _edgeMap[k].to === nodeId;
        });
    }

    function _launchSpark(slot) {
        var keys = Object.keys(_edgeMap);
        if (!keys.length || !_scene) return;
        var entry = _edgeMap[keys[Math.floor(Math.random() * keys.length)]];
        if (!entry) return;

        var mat = new THREE.MeshBasicMaterial({
            color:       0xd8f4ff,
            transparent: true,
            opacity:     0.0,
            blending:    THREE.AdditiveBlending,
            depthWrite:  false,
            depthTest:   false,
        });
        var mesh = new THREE.Mesh(_getPulseGeom(), mat);
        mesh.scale.set(1.0, 5.0, 1.0);
        mesh.renderOrder = 999;
        // Use linear start pos
        var startRaw = _nodePosRaw(entry.from);
        mesh.position.set(startRaw[0], startRaw[1], startRaw[2]);
        _scene.add(mesh);
        slot.mesh      = mesh;
        slot.entry     = entry;
        slot.t         = 0;
        slot.speed     = 2.8 + Math.random() * 3.0;
        slot.nextNode  = entry.to;
        slot.forward   = true;
        slot.active    = true;
        slot.nextLaunch = 0;
    }

    function _advanceSpark(slot, dt) {
        slot.t += dt * slot.speed;

        if (slot.t >= 1.0) {
            var arrivedAt  = slot.nextNode;
            var candidates = _edgesFrom(arrivedAt).filter(function (k) {
                return _edgeMap[k] !== slot.entry;
            });

            if (candidates.length === 0) {
                _scene.remove(slot.mesh);
                slot.mesh.material.dispose();
                slot.active     = false;
                slot.nextLaunch = performance.now() + 1500 + Math.random() * 4000;
                return;
            }

            var nextKey   = candidates[Math.floor(Math.random() * candidates.length)];
            var nextEntry = _edgeMap[nextKey];
            var forward   = (nextEntry.from === arrivedAt);
            slot.entry    = nextEntry;
            slot.t        = 0;
            slot.nextNode = forward ? nextEntry.to : nextEntry.from;
            slot.forward  = forward;
            var sp = _nodePosRaw(forward ? nextEntry.from : nextEntry.to);
            slot.mesh.position.set(sp[0], sp[1], sp[2]);
            return;
        }

        // Linear interpolation between endpoints — zero curve overhead
        var curveT  = slot.forward ? slot.t : (1.0 - slot.t);
        var fp = _nodePosRaw(slot.entry.from);
        var tp = _nodePosRaw(slot.entry.to);
        slot.mesh.position.set(
            fp[0] + (tp[0]-fp[0]) * curveT,
            fp[1] + (tp[1]-fp[1]) * curveT,
            fp[2] + (tp[2]-fp[2]) * curveT
        );
        var base = Math.pow(Math.sin(slot.t * Math.PI), 0.5);
        slot.mesh.material.opacity = base * (0.75 + Math.random() * 0.25);
    }

    function _tick() {
        var now = performance.now();
        var dt  = Math.min((now - (_lastTick || now)) / 1000, 0.05);
        _lastTick = now;

        if (!_thinking) return;

        while (_sparks.length < MAX_SPARKS) {
            _sparks.push({ active: false, nextLaunch: now + Math.random() * 500 });
        }

        for (var i = 0; i < _sparks.length; i++) {
            var s = _sparks[i];
            if (s.active) {
                _advanceSpark(s, dt);
            } else if (now >= s.nextLaunch) {
                _launchSpark(s);
            }
        }
    }

    function _key(from, to) { return from + "|" + to; }

    // ── Public CRUD ────────────────────────────────────────────────────────
    function _add(edgeData, scene) {
        var k = _key(edgeData.from, edgeData.to);
        if (_edgeMap[k]) return;
        if (!_scene) _scene = scene;
        var idx = _edgeList.length;
        var entry = { from: edgeData.from, to: edgeData.to, data: edgeData, idx: idx };
        _edgeList.push(entry);
        _edgeMap[k] = entry;
        _dirty = true;
        _scheduleBuild();
    }

    function _remove(fromId, toId) {
        var k = _key(fromId, toId);
        if (!_edgeMap[k]) return;
        delete _edgeMap[k];
        _edgeList = _edgeList.filter(function (e) { return !(e.from === fromId && e.to === toId); });
        // re-index
        for (var i = 0; i < _edgeList.length; i++) _edgeList[i].idx = i;
        _dirty = true;
        _scheduleBuild();
    }

    function _removeEdgesOf(nodeId) {
        var before = _edgeList.length;
        _edgeList = _edgeList.filter(function (e) {
            if (e.from === nodeId || e.to === nodeId) {
                delete _edgeMap[_key(e.from, e.to)];
                return false;
            }
            return true;
        });
        if (_edgeList.length !== before) {
            for (var i = 0; i < _edgeList.length; i++) _edgeList[i].idx = i;
            _dirty = true;
            _scheduleBuild();
        }
    }

    function _clear() {
        // Kill sparks
        if (_scene) {
            _sparks.forEach(function (s) {
                if (s.active && s.mesh) { _scene.remove(s.mesh); s.mesh.material.dispose(); }
            });
        }
        _sparks = [];
        _edgeList = [];
        _edgeMap  = Object.create(null);
        _dirty    = true;
        if (_batchMesh && _scene) {
            _scene.remove(_batchMesh);
            _batchMesh.geometry.dispose();
            _batchMesh.material.dispose();
            _batchMesh = null;
        }
        _posAttr = null;
        _colAttr = null;
    }

    // ── THE CRITICAL HOT PATH — called every physics frame ─────────────────
    // Writes positions directly from cached node refs — zero hash lookups.
    function _syncPositions() {
        if (_dirty) { _rebuildBatch(); return; }
        if (!_batchMesh || !_posAttr) return;
        var arr = _posAttr.array;
        var list = _edgeList;
        var NM = window.NodeManager;
        for (var i = 0, n = list.length; i < n; i++) {
            var e  = list[i];
            // Cache node refs on first access (avoids 4690 hash lookups per tick)
            if (!e._fn) { e._fn = NM && NM.get(e.from); e._tn = NM && NM.get(e.to); }
            var fp = e._fn, tp = e._tn;
            if (!fp || !tp) continue;
            var fpp = fp.group.position;
            var tpp = tp.group.position;
            var b   = i * 6;
            arr[b]   = fpp.x; arr[b+1] = fpp.y; arr[b+2] = fpp.z;
            arr[b+3] = tpp.x; arr[b+4] = tpp.y; arr[b+5] = tpp.z;
        }
        _posAttr.needsUpdate = true;
    }

    function _highlightEdgesOf(nodeId, hexColor) {
        if (!_colAttr) return;
        var col = new THREE.Color(hexColor || 0x4f8ef7);
        var arr = _colAttr.array;
        _edgeList.forEach(function (e) {
            if (e.from === nodeId || e.to === nodeId) {
                var b = e.idx * 6;
                arr[b]   = col.r; arr[b+1] = col.g; arr[b+2] = col.b;
                arr[b+3] = col.r; arr[b+4] = col.g; arr[b+5] = col.b;
            }
        });
        _colAttr.needsUpdate = true;
    }

    function _resetHighlights() {
        if (!_colAttr) return;
        var arr = _colAttr.array;
        for (var i = 0; i < arr.length; i += 3) {
            arr[i] = DEF_R; arr[i+1] = DEF_G; arr[i+2] = DEF_B;
        }
        _colAttr.needsUpdate = true;
    }

    function _updateLabel(from, to, label) {
        var e = _edgeMap[_key(from, to)];
        if (e) e.data.label = label;
    }

    function _getAll() { return _edgeList.map(function (e) { return e.data; }); }

    // 2D screen-space proximity — no per-edge mesh needed, use midpoint math
    function _getEdgeAtScreen(x, y, camera, renderer) {
        if (!camera || !renderer) return null;
        var el = renderer.domElement;
        var w  = el.offsetWidth, h = el.offsetHeight;
        var v  = new THREE.Vector3();
        var best = null, bestDist = 18;
        for (var i = 0; i < _edgeList.length; i++) {
            var e  = _edgeList[i];
            var fn = window.NodeManager && window.NodeManager.get(e.from);
            var tn = window.NodeManager && window.NodeManager.get(e.to);
            if (!fn || !tn) continue;
            var fp = fn.group.position, tp = tn.group.position;
            v.set((fp.x+tp.x)*0.5, (fp.y+tp.y)*0.5, (fp.z+tp.z)*0.5).project(camera);
            var sx = (v.x*0.5+0.5)*w, sy = (-v.y*0.5+0.5)*h;
            var d  = Math.hypot(sx-x, sy-y);
            if (d < bestDist) { bestDist = d; best = e.data; }
        }
        return best;
    }

    window.EdgeManager = {
        add:              _add,
        remove:           _remove,
        removeEdgesOf:    _removeEdgesOf,
        clear:            _clear,
        syncPositions:    _syncPositions,
        highlightEdgesOf: _highlightEdgesOf,
        resetHighlights:  _resetHighlights,
        updateLabel:      _updateLabel,
        getAll:           _getAll,
        getEdgeAtScreen:  _getEdgeAtScreen,
        setVisible: function (on) {
            _visible = on;
            if (_batchMesh) _batchMesh.visible = on;
        },
        setThinking: function (on) {
            _thinking = on;
            if (!on) {
                _sparks.forEach(function (s) {
                    if (s.active && s.mesh && _scene) {
                        _scene.remove(s.mesh);
                        s.mesh.material.dispose();
                        s.active = false;
                    }
                });
                _sparks = [];
            }
        },
        tick: _tick,
    };

})();
