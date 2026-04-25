// FILE: renderer.js
// DOES: Three.js scene, camera orbit, lights, stars, render loop, physics sync
// USES: THREE (global), window.GraphPhysics, window.NodeManager, window.EdgeManager, window.HoverManager
// EXPOSES: window.NeuralGraph (complete public API)

(function () {
    "use strict";

    // ── Private state ──────────────────────────────────────────────────────
    var _scene, _camera, _renderer;
    var _light1, _light2;
    var _lightAngle = 0;
    var _starField = null;
    var _nebulaPlane = null;

    // Camera orbit (spherical coordinates)
    var _theta  = Math.PI / 6;
    var _phi    = Math.PI / 2.5;
    var _radius = 180;
    var _targetRadius = 180;
    var _panX = 0, _panY = 0;
    var _targetPanX = 0, _targetPanY = 0;
    var _thetaVel = 0, _phiVel = 0;
    var _isDragging = false;
    var _isDraggingRight = false;
    var _lastMouseX = 0, _lastMouseY = 0;
    var _autoRotate = false;
    var _idleTimer  = null;

    // Flags
    var _labelsForced  = false;
    var _physicsPaused = false;
    var _anyLabelVisible = false;     // tracks whether any label is currently shown
    var _labelVec = null;             // shared Vector3 — initialised once Three.js is loaded
    var _physicsInterval = null;   // setInterval handle for decoupled physics
    var _physicsDirty    = false;  // true after a physics step — triggers GPU sync

    // Graph data cache (for getAllNodes/Edges)
    var _graphData = { nodes: [], edges: [] };

    // ── Init ───────────────────────────────────────────────────────────────
    function _init() {
        var container = document.getElementById("graph-canvas");
        if (!container) return;

        // Scene
        _scene = new THREE.Scene();
        _scene.background = new THREE.Color(0x000005);

        // Camera
        _camera = new THREE.PerspectiveCamera(
            60,
            container.offsetWidth / container.offsetHeight,
            0.1,
            15000
        );
        _updateCameraPos();

        // Renderer — GPU-first settings for RX 5700 XT
        // logarithmicDepthBuffer + preserveDrawingBuffer disabled: both kill AMD throughput
        _renderer = new THREE.WebGLRenderer({
            antialias: false,           // use CSS subpixel AA instead; saves ~25% fillrate
            alpha: false,
            powerPreference: "high-performance",
        });
        _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));  // crisp but not 4K
        _renderer.setSize(container.offsetWidth, container.offsetHeight);
        // NO ACESFilmicToneMapping — that adds an extra GPU pass; LinearToneMapping is free
        _renderer.toneMapping = THREE.LinearToneMapping;
        _renderer.toneMappingExposure = 1.0;
        _renderer.outputColorSpace = THREE.SRGBColorSpace;
        container.appendChild(_renderer.domElement);

        // Lighting — dramatic but subtle
        _scene.add(new THREE.AmbientLight(0x04040f, 4));
        _light1 = new THREE.PointLight(0x4f8ef7, 3, 300);
        _scene.add(_light1);
        _light2 = new THREE.PointLight(0xb44ff7, 3, 300);
        _scene.add(_light2);
        _scene.add(new THREE.HemisphereLight(0x080820, 0x000008, 1));

        // Nebula + Stars
        _buildNebula();
        _buildStars();

        // Physics callback — called synchronously inside GraphPhysics.step()
        // Uses getAll() array + index to avoid 500x string-hash lookups per tick
        if (window.GraphPhysics) {
            window.GraphPhysics.onUpdate(function (states) {
                var nodeList = window.NodeManager ? window.NodeManager.getAll() : [];
                for (var i = 0; i < states.length; i++) {
                    var s = states[i];
                    var entry = nodeList[i]; // same insertion order
                    if (entry) {
                        entry.group.position.set(s.x, s.y, s.z);
                        entry.data.x = s.x;
                        entry.data.y = s.y;
                        entry.data.z = s.z;
                    }
                }
                if (window.EdgeManager) window.EdgeManager.syncPositions();
            });
        }

        // Events
        _bindCameraEvents(container);
        window.addEventListener("resize", _onResize);

        // Init node drag module
        if (window.DragNodes) {
            window.DragNodes.init(_scene, _camera, _renderer);
            window.DragNodes.enable();
        }

        // ── Physics decoupled from render loop ───────────────────────────
        // Runs at 50 Hz max. Skips entirely when physics has settled so the
        // interval does zero work while the graph is idle.
        _physicsInterval = setInterval(function () {
            if (_physicsPaused || !window.GraphPhysics) return;
            if (!window.GraphPhysics.isActive()) return;  // settled → no-op
            window.GraphPhysics.step();
            _physicsDirty = true;
        }, 20);  // 50 Hz physics; render runs at display refresh rate (60+)

        // Start render loop
        _loop();

        // Load initial graph
        _fetchAndLoad();
    }

    // ── Nebula — subtle radial glow in the center ──────────────────────────
    function _buildNebula() {
        var canvas = document.createElement("canvas");
        canvas.width = canvas.height = 512;
        var ctx = canvas.getContext("2d");
        var grad = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
        grad.addColorStop(0,   "rgba(79,142,247,0.04)");
        grad.addColorStop(0.4, "rgba(180,79,247,0.02)");
        grad.addColorStop(1,   "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 512, 512);
        var tex = new THREE.CanvasTexture(canvas);
        _nebulaPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(600, 600),
            new THREE.MeshBasicMaterial({
                map: tex, transparent: true, opacity: 1,
                depthWrite: false, side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
            })
        );
        _nebulaPlane.position.z = -120;
        _scene.add(_nebulaPlane);
    }

    // ── Stars — 1200 particles, two sizes, blue tint ─────────────────────────
    function _buildStars() {
        var count = 1200;
        var pos   = new Float32Array(count * 3);
        var sizes = new Float32Array(count);
        var colors = new Float32Array(count * 3);
        for (var i = 0; i < count; i++) {
            // Distribute in a sphere of radius 500
            var r     = 200 + Math.random() * 300;
            var theta = Math.random() * Math.PI * 2;
            var phi   = Math.acos(2 * Math.random() - 1);
            pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
            pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            pos[i * 3 + 2] = r * Math.cos(phi);
            // 90% small, 10% larger
            sizes[i] = Math.random() < 0.9 ? 0.3 : 0.6;
            // White to light blue tint (#c8d8ff)
            var tint = 0.8 + Math.random() * 0.2;
            colors[i * 3]     = tint * 0.78; // r
            colors[i * 3 + 1] = tint * 0.85; // g
            colors[i * 3 + 2] = tint;         // b
        }
        var geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geom.setAttribute("color",    new THREE.BufferAttribute(colors, 3));
        _starField = new THREE.Points(
            geom,
            new THREE.PointsMaterial({
                size: 0.4,
                opacity: 0.6,
                transparent: true,
                sizeAttenuation: true,
                vertexColors: true,
                depthWrite: false,
            })
        );
        _scene.add(_starField);
    }

    // ── Render loop ────────────────────────────────────────────────────────
    function _loop() {
        requestAnimationFrame(_loop);

        // Animate point lights in sinusoidal orbits
        _lightAngle += 0.0003;
        var t = _lightAngle * 1000; // compatibility with time-based calcs
        _light1.position.set(
            Math.sin(t * 0.0003) * 150,
            50 + Math.sin(t * 0.0002) * 40,
            Math.cos(t * 0.0003) * 150
        );
        _light2.position.set(
            Math.cos(t * 0.0003) * 150,
            -40 + Math.sin(t * 0.00025) * 40,
            Math.sin(t * 0.0003) * 150
        );

        // Slow star field rotation
        if (_starField) _starField.rotation.y += 0.00005;

        // Auto-rotate when idle
        if (_autoRotate && !_isDragging) _theta += 0.002;

        // Apply & decay inertia
        if (!_isDragging) {
            _theta += _thetaVel;
            _phi   += _phiVel;
            _thetaVel *= 0.92;
            _phiVel   *= 0.92;
        }
        _phi = Math.max(0.1, Math.min(Math.PI - 0.1, _phi));

        // Smooth zoom / pan
        _radius += (_targetRadius - _radius) * 0.08;
        _panX   += (_targetPanX - _panX)     * 0.08;
        _panY   += (_targetPanY - _panY)     * 0.08;

        _updateCameraPos();

        // Physics dirty flag: reset for next interval
        if (_physicsDirty) _physicsDirty = false;

        // Update hover tweens
        if (window.HoverManager) window.HoverManager.update(_camera, _renderer);

        // Sync instances every frame — nodes have continuous pulse animation
        if (window.NodeManager && window.NodeManager.syncInstances) window.NodeManager.syncInstances();

        _updateLabels();
        if (window.EdgeManager) window.EdgeManager.tick();

        _renderer.render(_scene, _camera);
    }

    function _updateCameraPos() {
        _camera.position.set(
            _panX + _radius * Math.sin(_phi) * Math.cos(_theta),
            _panY + _radius * Math.cos(_phi),
            _radius * Math.sin(_phi) * Math.sin(_theta)
        );
        _camera.lookAt(_panX, _panY, 0);
    }

    // ── Label overlay ──────────────────────────────────────────────────────
    function _updateLabels() {
        if (!window.NodeManager) return;
        if (!_labelVec) _labelVec = new THREE.Vector3();

        var zoomRatio = 180 / Math.max(_radius, 1);
        var anyHovered = _labelsForced ||
            (window.HoverManager && window.HoverManager.getHoveredId && window.HoverManager.getHoveredId() !== null);

        // Fast-exit: if nothing should show, bulk-hide once then skip the loop
        if (!anyHovered || zoomRatio < 0.35) {
            if (_anyLabelVisible) {
                window.NodeManager.getAll().forEach(function (e) {
                    if (e.labelEl) e.labelEl.classList.remove("visible");
                });
                _anyLabelVisible = false;
            }
            return;
        }

        var container = document.getElementById("graph-canvas");
        if (!container) return;
        var w = container.offsetWidth;
        var h = container.offsetHeight;
        var hadVisible = false;

        window.NodeManager.getAll().forEach(function (entry) {
            var label = entry.labelEl;
            if (!label) return;
            if (!(_labelsForced || entry.hovered)) {
                label.classList.remove("visible");
                return;
            }
            _labelVec.copy(entry.group.position).project(_camera);
            if (_labelVec.z > 1) { label.classList.remove("visible"); return; }
            label.style.left = ((_labelVec.x * 0.5 + 0.5) * w) + "px";
            label.style.top  = ((-_labelVec.y * 0.5 + 0.5) * h - 22) + "px";
            label.classList.add("visible");
            hadVisible = true;
        });
        _anyLabelVisible = hadVisible;
    }

    // ── Camera events ──────────────────────────────────────────────────────
    function _bindCameraEvents(container) {
        container.addEventListener("mousedown", function (e) {
            if (window._DragNodes_active) return;  // node drag has priority
            if (e.button === 2 || e.button === 0) {
                _isDragging      = true;
                _isDraggingRight = (e.button === 2);
                _lastMouseX = e.clientX;
                _lastMouseY = e.clientY;
                _thetaVel = _phiVel = 0;
            }
        });

        window.addEventListener("mousemove", function (e) {
            if (!_isDragging) return;
            var dx = e.clientX - _lastMouseX;
            var dy = e.clientY - _lastMouseY;
            _lastMouseX = e.clientX;
            _lastMouseY = e.clientY;

            if (_isDraggingRight) {
                var panSpeed = _radius * 0.0008;
                _targetPanX -= dx * panSpeed;
                _targetPanY += dy * panSpeed;
            } else {
                var speed = 0.005;
                _thetaVel = -dx * speed;
                _phiVel   = -dy * speed;
                _theta += _thetaVel;
                _phi   += _phiVel;
            }

            _autoRotate = false;
            clearTimeout(_idleTimer);
            _idleTimer = setTimeout(function () { _autoRotate = true; }, 6000);
        });

        window.addEventListener("mouseup", function () { _isDragging = false; });

        container.addEventListener("wheel", function (e) {
            e.preventDefault();
            // Proportional zoom: fast when far, precise when close
            // min=1 allows flying deep inside the neural network
            _targetRadius = Math.max(1, Math.min(3000, _targetRadius * (1 + e.deltaY * 0.0018)));
        }, { passive: false });

        container.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    }

    function _onResize() {
        var container = document.getElementById("graph-canvas");
        if (!container || !_renderer) return;
        var w = container.offsetWidth;
        var h = container.offsetHeight;
        _camera.aspect = w / h;
        _camera.updateProjectionMatrix();
        _renderer.setSize(w, h);
    }

    // ── Data loading ───────────────────────────────────────────────────────
    function _fetchAndLoad() {
        fetch("/graph/load")
            .then(function (r) { return r.json(); })
            .then(function (data) { _loadData(data); })
            .catch(function () { /* empty graph */ });
    }

    function _loadData(graph) {
        if (!window.NodeManager || !window.EdgeManager) return;
        graph          = graph || {};
        graph.nodes    = graph.nodes || [];
        graph.edges    = graph.edges || [];
        _graphData     = graph;

        // Freeze minimap during rebuild to prevent glitch frames
        if (window.NeuralGraphMinimap && window.NeuralGraphMinimap.freezeFor) {
            window.NeuralGraphMinimap.freezeFor(600);
        }

        // Clear click selection when switching graphs
        if (window.HoverManager && window.HoverManager.clearSelection) {
            window.HoverManager.clearSelection();
        }

        // Clear scene
        window.NodeManager.clear(_scene);
        window.EdgeManager.clear(_scene);

        // ── Mind-graph layout ────────────────────────────────────────────────
        // Memory world arrives with pre-set Fibonacci sphere positions — keep them.
        // Demo / other worlds get brain-lobe placement + a central brain-core node.
        var _isMemory = graph.meta && graph.meta.world === "memory";

        if (!_isMemory) {
            // ── Inject Brain Core at origin ──────────────────────────────
            var _coreExists = graph.nodes.some(function (nn) { return nn.id === "__brain_core__"; });
            if (!_coreExists) {
                var _brainCore = {
                    id:          "__brain_core__",
                    label:       "BRAIN CORE",
                    category:    "brain_core",
                    color:       "#e8c840",
                    size:        4.5,
                    role:        "brain_core",
                    health:      100,
                    description: "Neural network instruction center — mind graph hub",
                    x: 0, y: 0, z: 0,
                };
                graph.nodes.unshift(_brainCore);  // first in list → index 0
                // Connect to first node of each category (one spoke per category)
                var _catSeen = {};
                graph.nodes.forEach(function (nn) {
                    if (nn.id === "__brain_core__") return;
                    var cat = nn.category || "concept";
                    if (!_catSeen[cat]) {
                        _catSeen[cat] = true;
                        graph.edges.push({ from: "__brain_core__", to: nn.id, label: cat, type: "core_link", weight: 1.0 });
                    }
                });
            }

            // ── Brain-lobe positions ──────────────────────────────────────
            var _CAT_LOBE = {
                concept:    { x:   0, y:  95, z:   0 },
                system:     { x:  75, y:  32, z:  30 },
                product:    { x:  58, y:   0, z: -70 },
                process:    { x: -62, y:  26, z: -58 },
                finance:    { x: -52, y: -20, z:  70 },
                customer:   { x:  50, y: -32, z:  64 },
                person:     { x:   0, y: -62, z: -76 },
                location:   { x: -78, y: -15, z:  24 },
                compliance: { x:   0, y: -95, z:   0 },
            };
            var _jitter = 28;
            graph.nodes.forEach(function (nn) {
                if (nn.id === "__brain_core__") { nn.x = 0; nn.y = 0; nn.z = 0; return; }
                var l = _CAT_LOBE[nn.category] || { x: 0, y: 0, z: 0 };
                nn.x = l.x + (Math.random() - 0.5) * _jitter * 2;
                nn.y = l.y + (Math.random() - 0.5) * _jitter * 2;
                nn.z = l.z + (Math.random() - 0.5) * _jitter * 2;
            });
        }

        // Init physics simulation
        if (window.GraphPhysics) {
            window.GraphPhysics.init(graph.nodes, graph.edges);
            var n = graph.nodes.length;
            if (n > 50) {
                if (_isMemory) {
                    // Memory world: pre-spaced by Fibonacci sphere — softer physics to maintain cluster shape
                    window.GraphPhysics.setConfig({
                        dampingFactor:         0.88,
                        repulsionStrength:     800,
                        springStrength:        0.003,
                        restLength:            50,
                        gravityStrength:       0.0005,
                        settleEnergyThreshold: 0.6,
                        minDistance:           5,
                    });
                } else {
                    // Demo / other worlds: mind-graph centred around brain-core
                    window.GraphPhysics.setConfig({
                        dampingFactor:         0.86,
                        repulsionStrength:     1000,
                        springStrength:        0.006,
                        restLength:            40,
                        gravityStrength:       0.002,
                        settleEnergyThreshold: 0.6,
                        minDistance:           6,
                    });
                }
            }
        }

        // Build three.js objects
        // 1) Queue node entries (no GPU yet)
        graph.nodes.forEach(function (n) { window.NodeManager.add(n, _scene); });
        // 2) Build single InstancedMesh from all queued nodes
        if (window.NodeManager && window.NodeManager.buildInstanced) {
            window.NodeManager.buildInstanced(_scene);
        }
        graph.edges.forEach(function (e) { window.EdgeManager.add(e, _scene); });

        // Raycaster targets updated automatically via InstancedMesh (no mesh list)
        if (window.HoverManager) {
            window.HoverManager.setMeshes([]);
        }

        _updateStats();

        // Notify chat panel
        if (window.NeuralGraphChat && window.NeuralGraphChat.refreshStats) {
            window.NeuralGraphChat.refreshStats();
        }
    }

    function _updateStats() {
        var ns = document.getElementById("stat-nodes");
        var es = document.getElementById("stat-edges");
        var us = document.getElementById("stat-updated");
        if (ns) ns.textContent = _graphData.nodes.length;
        if (es) es.textContent = _graphData.edges.length;
        if (us) {
            var d = new Date();
            us.textContent = d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
        }
    }

    // ── Camera helpers ─────────────────────────────────────────────────────
    function _resetCamera() {
        _theta = Math.PI / 6; _phi = Math.PI / 2.5;
        _targetRadius = _radius = 180;
        _targetPanX = _panX = 0;
        _targetPanY = _panY = 0;
        _thetaVel = _phiVel = 0;
    }

    function _fitAll() {
        if (!window.NodeManager) return;
        var all = window.NodeManager.getAll();
        if (!all.length) { _resetCamera(); return; }
        var max = 0;
        all.forEach(function (e) {
            var p = e.group.position;
            var d = Math.sqrt(p.x*p.x + p.y*p.y + p.z*p.z);
            if (d > max) max = d;
        });
        _targetRadius = Math.max(80, max * 2.2);
        _targetPanX = _targetPanY = 0;
    }

    // ── Public API ─────────────────────────────────────────────────────────
    window.NeuralGraph = {
        init:     _init,

        loadData: function (graph) {
            _loadData(graph);
        },

        highlightNode: function (id) {
            if (window.HoverManager) window.HoverManager.forceHighlight(id);
        },
        highlightNodes: function (ids) {
            if (!ids) return;
            ids.forEach(function (id) {
                if (window.HoverManager) window.HoverManager.forceHighlight(id);
            });
        },
        resetHighlights: function () {
            if (window.HoverManager) window.HoverManager.clearForced();
        },

        focusNode: function (id) {
            var entry = window.NodeManager && window.NodeManager.get(id);
            if (!entry) return;
            var p = entry.group.position;
            _targetPanX = p.x; _targetPanY = p.y; _targetRadius = 80;
        },

        resetCamera: _resetCamera,
        fitAll:      _fitAll,

        getAllNodes: function () { return _graphData.nodes.slice(); },
        getAllEdges: function () { return _graphData.edges.slice(); },

        addNode: function (nodeData) {
            if (!window.NodeManager) return;
            if (!_graphData.nodes.find(function (n) { return n.id === nodeData.id; })) {
                _graphData.nodes.push(nodeData);
            }
            window.NodeManager.add(nodeData, _scene);
            if (window.NodeManager.buildInstanced) window.NodeManager.buildInstanced(_scene);
            if (window.GraphPhysics) window.GraphPhysics.addNode(nodeData);
            _updateStats();
        },

        removeNode: function (id) {
            if (!window.NodeManager) return;
            window.NodeManager.remove(id, _scene);
            _graphData.nodes = _graphData.nodes.filter(function (n) { return n.id !== id; });
            _graphData.edges = _graphData.edges.filter(function (e) { return e.from !== id && e.to !== id; });
            if (window.EdgeManager) window.EdgeManager.removeEdgesOf(id, _scene);
            _updateStats();
        },

        addEdge: function (edgeData) {
            if (!window.EdgeManager) return;
            _graphData.edges.push(edgeData);
            window.EdgeManager.add(edgeData, _scene);
            if (window.GraphPhysics) window.GraphPhysics.addEdge(edgeData);
        },

        removeEdge: function (fromId, toId) {
            if (!window.EdgeManager) return;
            _graphData.edges = _graphData.edges.filter(function (e) {
                return !(e.from === fromId && e.to === toId);
            });
            window.EdgeManager.remove(fromId, toId, _scene);
        },

        updateNode: function (id, props) {
            if (!window.NodeManager) return;
            var entry = window.NodeManager.get(id);
            if (!entry) return;
            Object.assign(entry.data, props);
            window.NodeManager.applyProps(id, props);
        },

        updateEdgeLabel: function (from, to, label) {
            if (window.EdgeManager) window.EdgeManager.updateLabel(from, to, label);
        },

        getNodeAtScreen: function (x, y) {
            if (!window.HoverManager) return null;
            return window.HoverManager.getNodeAtScreen(x, y, _camera, _renderer);
        },
        getEdgeAtScreen: function (x, y) {
            if (!window.EdgeManager) return null;
            return window.EdgeManager.getEdgeAtScreen(x, y, _camera, _renderer);
        },
        getNodeScreenPos: function (id) {
            var entry = window.NodeManager && window.NodeManager.get(id);
            if (!entry) return null;
            var container = document.getElementById("graph-canvas");
            if (!container) return null;
            var vec = entry.group.position.clone().project(_camera);
            return {
                x: (vec.x * 0.5 + 0.5) * container.offsetWidth,
                y: (-vec.y * 0.5 + 0.5) * container.offsetHeight,
            };
        },
        getNodeWorldPos: function (id) {
            var entry = window.NodeManager && window.NodeManager.get(id);
            return entry ? entry.group.position.clone() : null;
        },

        getCameraState: function () {
            return { theta: _theta, phi: _phi, radius: _radius };
        },

        setLabelsVisible:  function (v) { _labelsForced = v; },
        getLabelsVisible:  function ()  { return _labelsForced; },
        setPhysicsPaused:  function (v) { _physicsPaused = v; },
        isPhysicsPaused:   function ()  { return _physicsPaused; },
        getRendererCanvas: function ()  { return _renderer ? _renderer.domElement : null; },

        resetPhysics: function () {
            if (window.GraphPhysics) window.GraphPhysics.init(_graphData.nodes, _graphData.edges);
        },

        setAutoRotate: function (v) { _autoRotate = v; },
    };

    // Auto-init
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", _init);
    } else {
        _init();
    }

})();
