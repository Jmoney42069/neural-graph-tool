/**
 * NeuralGraph 3D Visualization Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Requires Three.js r128 loaded in the page before this script.
 * Targets div#graph-canvas. Exposes window.NeuralGraph public API.
 *
 * Sections:
 *   1. CONSTANTS & DEMO DATA
 *   2. MODULE STATE
 *   3. FORCE-DIRECTED LAYOUT
 *   4. SCENE INITIALIZATION
 *   5. STAR FIELD
 *   6. LOAD DATA / GRAPH BUILD
 *   7. DISPOSE
 *   8. CAMERA
 *   9. HOVER LOGIC
 *  10. RENDER LOOP
 *  11. EVENT BINDING
 *  12. IDLE / AUTO-ROTATE
 *  13. PUBLIC API
 *  14. AUTO-INIT
 */

(function () {
    "use strict";

    // ═══════════════════════════════════════════════════════════════════════
    // 1. CONSTANTS & DEMO DATA
    // ═══════════════════════════════════════════════════════════════════════

    const DEMO_NODES = [
        { id: "warmtepomp",       label: "Warmtepomp",       category: "product"     },
        { id: "zonnepanelen",     label: "Zonnepanelen",     category: "product"     },
        { id: "thuisbatterij",    label: "Thuisbatterij",    category: "product"     },
        { id: "frank_energie",    label: "Frank Energie",    category: "product"     },
        { id: "klant",            label: "Klant",            category: "customer"    },
        { id: "offerte",          label: "Offerte",          category: "process"     },
        { id: "afm_compliance",   label: "AFM Compliance",   category: "compliance"  },
        { id: "warmtefonds",      label: "Warmtefonds",      category: "finance"     },
        { id: "financiering",     label: "Financiering",     category: "finance"     },
        { id: "huisbezoek",       label: "Huisbezoek",       category: "process"     },
        { id: "contract",         label: "Contract",         category: "process"     },
        { id: "installatie",      label: "Installatie",      category: "process"     },
        { id: "subsidie",         label: "Subsidie ISDE",    category: "finance"     },
        { id: "wft_regel",        label: "Wft Regelgeving",  category: "compliance"  },
        { id: "energiebesparing", label: "Energiebesparing", category: "product"     },
    ];

    const DEMO_EDGES = [
        { from: "klant",          to: "huisbezoek",       label: "start"        },
        { from: "huisbezoek",     to: "offerte",          label: "leidt tot"    },
        { from: "offerte",        to: "warmtepomp",       label: "bevat"        },
        { from: "offerte",        to: "zonnepanelen",     label: "bevat"        },
        { from: "offerte",        to: "thuisbatterij",    label: "bevat"        },
        { from: "offerte",        to: "frank_energie",    label: "bevat"        },
        { from: "offerte",        to: "contract",         label: "wordt"        },
        { from: "contract",       to: "installatie",      label: "triggert"     },
        { from: "financiering",   to: "warmtefonds",      label: "via"          },
        { from: "financiering",   to: "subsidie",         label: "of via"       },
        { from: "klant",          to: "financiering",     label: "kiest"        },
        { from: "afm_compliance", to: "offerte",          label: "controleert"  },
        { from: "wft_regel",      to: "financiering",     label: "reguleert"    },
        { from: "warmtepomp",     to: "energiebesparing", label: "levert"       },
        { from: "zonnepanelen",   to: "energiebesparing", label: "levert"       },
        { from: "thuisbatterij",  to: "energiebesparing", label: "levert"       },
    ];

    // Category → hex integer color
    const CAT_COLOR = {
        product:    0x4f8ef7,
        customer:   0xb44ff7,
        process:    0xf7a04f,
        compliance: 0xf74f6a,
        finance:    0x4ff7a0,
    };

    // Scene
    const BG_COLOR          = 0x09090f;
    // Edges
    const EDGE_DEFAULT_HEX  = 0x2a2a4a;
    const EDGE_ACTIVE_HEX   = 0x4f8ef7;
    const EDGE_DEFAULT_OPA  = 0.6;
    const EDGE_ACTIVE_OPA   = 1.0;
    const EDGE_DIM_OPA      = 0.1;
    // Nodes
    const NODE_RADIUS       = 3.5;
    // Camera
    const CAM_FOV           = 60;
    const CAM_INIT_RADIUS   = 180;
    const CAM_MIN_RADIUS    = 60;
    const CAM_MAX_RADIUS    = 400;
    const CAM_INIT_THETA    = 0.4;  // horizontal angle (radians)
    const CAM_INIT_PHI      = 1.25; // vertical angle (radians from top)
    // Interaction
    const ROTATE_SPEED      = 0.005;
    const PAN_SPEED_FACTOR  = 0.0012;
    const ZOOM_IN_FACTOR    = 0.93;
    const ZOOM_OUT_FACTOR   = 1.08;
    const INERTIA_DECAY     = 0.95;  // velocity *= 0.95 per frame (damping 0.05)
    const CAM_LERP          = 0.08;
    // Auto-rotate
    const AUTO_ROT_SPEED    = 0.0008;
    const IDLE_TIMEOUT_MS   = 4000;
    // Force layout
    const LAYOUT_RANGE      = 80;   // initial ±80 cube
    const LAYOUT_REPULSION  = 800;
    const LAYOUT_SPRING_K   = 0.008;
    const LAYOUT_ITERS      = 80;
    const LAYOUT_COOLING    = 0.5;  // linear cooling weight
    const LAYOUT_STEP       = 0.1;

    // ═══════════════════════════════════════════════════════════════════════
    // 2. MODULE STATE
    // ═══════════════════════════════════════════════════════════════════════

    // Three.js core
    let renderer    = null;
    let scene       = null;
    let camera      = null;
    let raycaster   = new THREE.Raycaster();
    let container   = null;   // div#graph-canvas
    let labelLayer  = null;   // HTML overlay div for labels

    // Graph data
    let nodes   = [];   // [{ id, label, category, mesh, labelEl, connections[] }]
    let edges   = [];   // [{ from, to, label, line }]
    let nodeMap = {};   // id → node object

    // Hover / selection
    let hoveredNode  = null;
    let selectedNode = null;

    // Normalized device coords of the mouse (updated on mousemove)
    let mouseNDC = { x: 0, y: 0 };

    // ── Camera orbit state ──────────────────────────────────────────────
    // We maintain a spherical coordinate system:
    //   theta = horizontal angle around Y axis
    //   phi   = vertical angle from +Y pole
    //   radius = distance from focus point (panOffset)
    let spherical = {
        theta:  CAM_INIT_THETA,
        phi:    CAM_INIT_PHI,
        radius: CAM_INIT_RADIUS,
    };
    let targetRadius    = CAM_INIT_RADIUS;
    let panOffset       = new THREE.Vector3(0, 0, 0);
    let targetPan       = new THREE.Vector3(0, 0, 0);

    // Inertia velocities (applied when not dragging, decay per frame)
    let rotVelTheta = 0;
    let rotVelPhi   = 0;

    // ── Labels / Physics control ─────────────────────────────────────────
    let _labelsForced  = false;   // true = show all labels regardless of hover
    let _physicsPaused = false;   // reserved for future physics step gate

    // ── Drag state ───────────────────────────────────────────────────────
    let isDragging        = false;
    let isRightDragging   = false;
    let prevMouse         = { x: 0, y: 0 };
    let mouseDownPos      = { x: 0, y: 0 };

    // ── Auto-rotate ──────────────────────────────────────────────────────
    let autoRotate  = false;
    let idleTimer   = null;

    // ── RAF handle ───────────────────────────────────────────────────────
    let animFrameId     = null;
    let resizeObserver  = null;

    // ═══════════════════════════════════════════════════════════════════════
    // 3. FORCE-DIRECTED LAYOUT (computed before rendering)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Returns an array of {x, y, z} positions for each node in nodeList.
     * Runs LAYOUT_ITERS of:
     *   – Repulsion between all node pairs: force = LAYOUT_REPULSION / d²
     *   – Spring attraction along edges: force = LAYOUT_SPRING_K * delta
     * with linear cooling applied to the step size.
     */
    function computeLayout(nodeList, edgeList) {
        const N = nodeList.length;

        // Random initial positions in ±LAYOUT_RANGE cube
        const pos = nodeList.map(() => ({
            x: (Math.random() - 0.5) * LAYOUT_RANGE * 2,
            y: (Math.random() - 0.5) * LAYOUT_RANGE * 2,
            z: (Math.random() - 0.5) * LAYOUT_RANGE * 2,
        }));

        // Index lookup
        const idxMap = {};
        nodeList.forEach((n, i) => { idxMap[n.id] = i; });

        for (let iter = 0; iter < LAYOUT_ITERS; iter++) {
            const fx = new Float64Array(N);
            const fy = new Float64Array(N);
            const fz = new Float64Array(N);

            // ── Repulsion: all pairs ──────────────────────────────────
            for (let i = 0; i < N; i++) {
                for (let j = i + 1; j < N; j++) {
                    const dx = pos[j].x - pos[i].x;
                    const dy = pos[j].y - pos[i].y;
                    const dz = pos[j].z - pos[i].z;
                    let d2  = dx * dx + dy * dy + dz * dz;
                    if (d2 < 1.0) d2 = 1.0;
                    const d = Math.sqrt(d2);
                    const f = LAYOUT_REPULSION / d2;
                    const nx = (dx / d) * f;
                    const ny = (dy / d) * f;
                    const nz = (dz / d) * f;
                    fx[i] -= nx;  fy[i] -= ny;  fz[i] -= nz;
                    fx[j] += nx;  fy[j] += ny;  fz[j] += nz;
                }
            }

            // ── Spring attraction along edges ─────────────────────────
            edgeList.forEach(e => {
                const ai = idxMap[e.from];
                const bi = idxMap[e.to];
                if (ai === undefined || bi === undefined) return;
                const dx = pos[bi].x - pos[ai].x;
                const dy = pos[bi].y - pos[ai].y;
                const dz = pos[bi].z - pos[ai].z;
                fx[ai] += dx * LAYOUT_SPRING_K;
                fy[ai] += dy * LAYOUT_SPRING_K;
                fz[ai] += dz * LAYOUT_SPRING_K;
                fx[bi] -= dx * LAYOUT_SPRING_K;
                fy[bi] -= dy * LAYOUT_SPRING_K;
                fz[bi] -= dz * LAYOUT_SPRING_K;
            });

            // ── Apply with cooling ────────────────────────────────────
            const cool = 1.0 - (iter / LAYOUT_ITERS) * LAYOUT_COOLING;
            const step = LAYOUT_STEP * cool;
            for (let i = 0; i < N; i++) {
                pos[i].x += fx[i] * step;
                pos[i].y += fy[i] * step;
                pos[i].z += fz[i] * step;
            }
        }

        return pos;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 4. SCENE INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════

    function init() {
        container = document.getElementById("graph-canvas");
        if (!container) {
            console.error("[NeuralGraph] #graph-canvas not found in DOM");
            return;
        }

        // If already initialized, just re-load demo data
        if (renderer) {
            loadData(DEMO_NODES, DEMO_EDGES);
            return;
        }

        // Hide the "GRAPH RENDERS HERE" placeholder
        const placeholder = container.querySelector(".graph-placeholder");
        if (placeholder) placeholder.style.visibility = "hidden";

        // ── Renderer ────────────────────────────────────────────────────
        renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setClearColor(BG_COLOR, 1);
        container.appendChild(renderer.domElement);

        // ── Scene ────────────────────────────────────────────────────────
        scene = new THREE.Scene();
        scene.background = new THREE.Color(BG_COLOR);

        // ── Camera ───────────────────────────────────────────────────────
        camera = new THREE.PerspectiveCamera(
            CAM_FOV,
            container.clientWidth / container.clientHeight,
            0.1,
            2000
        );
        syncCamera();

        // ── Lighting ─────────────────────────────────────────────────────
        scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const sun = new THREE.DirectionalLight(0xffffff, 0.8);
        sun.position.set(0, 100, 60);
        scene.add(sun);

        // ── Background stars ─────────────────────────────────────────────
        buildStarField();

        // ── HTML label overlay ──────────────────────────────────────────
        labelLayer = document.createElement("div");
        Object.assign(labelLayer.style, {
            position:      "absolute",
            top:           "0",
            left:          "0",
            width:         "100%",
            height:        "100%",
            pointerEvents: "none",
            overflow:      "hidden",
        });
        container.appendChild(labelLayer);

        // ── Resize observer ──────────────────────────────────────────────
        resizeObserver = new ResizeObserver(() => {
            const W = container.clientWidth;
            const H = container.clientHeight;
            camera.aspect = W / H;
            camera.updateProjectionMatrix();
            renderer.setSize(W, H);
        });
        resizeObserver.observe(container);

        // ── Events ───────────────────────────────────────────────────────
        bindEvents();

        // ── Load demo data ───────────────────────────────────────────────
        loadData(DEMO_NODES, DEMO_EDGES);

        // ── Start loop ───────────────────────────────────────────────────
        loop();

        // ── Arm idle timer ───────────────────────────────────────────────
        resetIdleTimer();

        console.log("[NeuralGraph] Initialized.");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 5. STAR FIELD
    // ═══════════════════════════════════════════════════════════════════════

    function buildStarField() {
        const COUNT = 400;
        const buf = new Float32Array(COUNT * 3);
        for (let i = 0; i < COUNT; i++) {
            buf[i * 3]     = (Math.random() - 0.5) * 1400;
            buf[i * 3 + 1] = (Math.random() - 0.5) * 1400;
            buf[i * 3 + 2] = (Math.random() - 0.5) * 1400;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(buf, 3));
        const mat = new THREE.PointsMaterial({
            color:           0xffffff,
            size:            0.55,
            opacity:         0.3,
            transparent:     true,
            sizeAttenuation: true,
        });
        scene.add(new THREE.Points(geo, mat));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 6. LOAD DATA — clear scene and rebuild graph
    // ═══════════════════════════════════════════════════════════════════════

    function loadData(nodeList, edgeList) {
        disposeGraph();
        nodes   = [];
        edges   = [];
        nodeMap = {};

        // Compute settled positions before placing anything in scene
        const positions = computeLayout(nodeList, edgeList);

        // ── Build nodes ──────────────────────────────────────────────────
        nodeList.forEach((nd, i) => {
            const hexColor = CAT_COLOR[nd.category] || 0xcccccc;
            const threeColor = new THREE.Color(hexColor);

            const geo = new THREE.SphereGeometry(NODE_RADIUS, 32, 32);
            const mat = new THREE.MeshStandardMaterial({
                color:             threeColor,
                roughness:         0.4,
                metalness:         0.3,
                emissive:          threeColor,
                emissiveIntensity: 0.15,
                transparent:       true,
                opacity:           1.0,
            });

            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(positions[i].x, positions[i].y, positions[i].z);
            mesh.userData = {
                id:            nd.id,
                label:         nd.label,
                category:      nd.category,
                targetScale:   1.0,
                targetOpacity: 1.0,
            };
            scene.add(mesh);

            // ── HTML label ────────────────────────────────────────────
            const labelEl = document.createElement("div");
            labelEl.textContent = nd.label;
            Object.assign(labelEl.style, {
                position:    "absolute",
                fontFamily:  "'IBM Plex Mono', monospace",
                fontSize:    "11px",
                color:       "#e2e2f0",
                background:  "#0d0d18",
                border:      "1px solid #1e1e2e",
                padding:     "4px 8px",
                borderRadius:"2px",
                pointerEvents:"none",
                display:     "none",
                whiteSpace:  "nowrap",
                zIndex:      "10",
                transform:   "translate(-50%, calc(-100% - 12px))",
                userSelect:  "none",
            });
            labelLayer.appendChild(labelEl);

            const nodeObj = {
                id:          nd.id,
                label:       nd.label,
                category:    nd.category,
                mesh,
                labelEl,
                connections: [],   // populated after edges
            };
            nodes.push(nodeObj);
            nodeMap[nd.id] = nodeObj;
        });

        // ── Build edges ──────────────────────────────────────────────────
        edgeList.forEach(ed => {
            const a = nodeMap[ed.from];
            const b = nodeMap[ed.to];
            if (!a || !b) return;

            const pts = [
                a.mesh.position.clone(),
                b.mesh.position.clone(),
            ];
            const geo = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({
                color:       EDGE_DEFAULT_HEX,
                opacity:     EDGE_DEFAULT_OPA,
                transparent: true,
            });
            const line = new THREE.Line(geo, mat);
            scene.add(line);

            const edgeObj = { from: ed.from, to: ed.to, label: ed.label, line };
            edges.push(edgeObj);

            // Bi-directional connection registry
            a.connections.push({ node: b, edge: edgeObj });
            b.connections.push({ node: a, edge: edgeObj });
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 7. DISPOSE
    // ═══════════════════════════════════════════════════════════════════════

    function disposeGraph() {
        nodes.forEach(nd => {
            scene.remove(nd.mesh);
            nd.mesh.geometry.dispose();
            nd.mesh.material.dispose();
            if (nd.labelEl && nd.labelEl.parentNode) nd.labelEl.remove();
        });
        edges.forEach(ed => {
            scene.remove(ed.line);
            ed.line.geometry.dispose();
            ed.line.material.dispose();
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 8. CAMERA
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Rebuild camera.position and camera.lookAt from spherical + panOffset.
     */
    function syncCamera() {
        const { theta, phi, radius } = spherical;
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);
        camera.position.set(
            panOffset.x + radius * sinPhi * Math.sin(theta),
            panOffset.y + radius * cosPhi,
            panOffset.z + radius * sinPhi * Math.cos(theta)
        );
        camera.lookAt(panOffset);
    }

    function resetCamera() {
        spherical.theta  = CAM_INIT_THETA;
        spherical.phi    = CAM_INIT_PHI;
        spherical.radius = CAM_INIT_RADIUS;
        targetRadius     = CAM_INIT_RADIUS;
        rotVelTheta      = 0;
        rotVelPhi        = 0;
        panOffset.set(0, 0, 0);
        targetPan.set(0, 0, 0);
    }

    function setAutoRotate(bool) {
        autoRotate = bool;
        if (bool) clearTimeout(idleTimer);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 9. HOVER LOGIC
    // ═══════════════════════════════════════════════════════════════════════

    function processHover() {
        raycaster.setFromCamera(mouseNDC, camera);
        const meshList = nodes.map(n => n.mesh);
        const hits = raycaster.intersectObjects(meshList, false);
        const hitNode = hits.length > 0 ? nodeMap[hits[0].object.userData.id] : null;

        // Nothing changed — skip heavy DOM/material updates
        if (hitNode === hoveredNode) return;
        hoveredNode = hitNode;

        if (hoveredNode) {
            // Build fast lookup of connected node IDs
            const connectedIds = new Set(hoveredNode.connections.map(c => c.node.id));

            nodes.forEach(nd => {
                if (nd === hoveredNode) {
                    nd.mesh.userData.targetScale   = 1.4;
                    nd.mesh.userData.targetOpacity = 1.0;
                    nd.labelEl.style.display = "block";
                } else if (connectedIds.has(nd.id)) {
                    nd.mesh.userData.targetScale   = 1.15;
                    nd.mesh.userData.targetOpacity = 0.9;
                    if (!_labelsForced) nd.labelEl.style.display = "none";
                } else {
                    nd.mesh.userData.targetScale   = 1.0;
                    nd.mesh.userData.targetOpacity = 0.3;
                    if (!_labelsForced) nd.labelEl.style.display = "none";
                }
            });

            edges.forEach(ed => {
                const active = ed.from === hoveredNode.id || ed.to === hoveredNode.id;
                ed.line.material.color.setHex(active ? EDGE_ACTIVE_HEX : EDGE_DEFAULT_HEX);
                ed.line.material.opacity = active ? EDGE_ACTIVE_OPA : EDGE_DIM_OPA;
            });

            if (window.onNodeHover) {
                window.onNodeHover({
                    id:       hoveredNode.id,
                    label:    hoveredNode.label,
                    category: hoveredNode.category,
                });
            }
        } else {
            // Reset all nodes and edges to default
            nodes.forEach(nd => {
                nd.mesh.userData.targetScale   = 1.0;
                nd.mesh.userData.targetOpacity = 1.0;
                if (!_labelsForced) nd.labelEl.style.display = "none";
            });
            edges.forEach(ed => {
                ed.line.material.color.setHex(EDGE_DEFAULT_HEX);
                ed.line.material.opacity = EDGE_DEFAULT_OPA;
            });
            if (window.onNodeHover) window.onNodeHover(null);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 10. RENDER LOOP
    // ═══════════════════════════════════════════════════════════════════════

    function loop() {
        animFrameId = requestAnimationFrame(loop);

        const W = container.clientWidth;
        const H = container.clientHeight;

        // ── Auto-rotation when idle ──────────────────────────────────────
        if (autoRotate && !isDragging) {
            spherical.theta += AUTO_ROT_SPEED;
        }

        // ── Inertia (when user is not actively dragging) ─────────────────
        if (!isDragging) {
            rotVelTheta *= INERTIA_DECAY;
            rotVelPhi   *= INERTIA_DECAY;
            spherical.theta += rotVelTheta;
            spherical.phi   += rotVelPhi;
        }

        // ── Clamp phi to avoid pole flip ─────────────────────────────────
        spherical.phi = Math.max(0.08, Math.min(Math.PI - 0.08, spherical.phi));

        // ── Smooth zoom ──────────────────────────────────────────────────
        spherical.radius += (targetRadius - spherical.radius) * 0.1;

        // ── Smooth pan ───────────────────────────────────────────────────
        panOffset.lerp(targetPan, CAM_LERP);

        syncCamera();

        // ── Animate node scales and material opacity ─────────────────────
        nodes.forEach(nd => {
            // Scale lerp
            const cs = nd.mesh.scale.x;
            const ts = nd.mesh.userData.targetScale;
            if (Math.abs(cs - ts) > 0.001) {
                nd.mesh.scale.setScalar(cs + (ts - cs) * 0.15);
            }

            // Opacity lerp
            const co = nd.mesh.material.opacity;
            const to = nd.mesh.userData.targetOpacity;
            if (Math.abs(co - to) > 0.004) {
                nd.mesh.material.opacity = co + (to - co) * 0.12;
            }
        });

        // ── Update HTML label screen positions (zoom-aware when forced) ──
        nodes.forEach(nd => {
            if (!_labelsForced && nd.labelEl.style.display === "none") return;
            const v = nd.mesh.position.clone().project(camera);
            if (v.z > 1.0) {
                if (!_labelsForced) nd.labelEl.style.display = "none";
                return;
            }
            const sx = ((v.x + 1.0) / 2.0) * W;
            const sy = ((-v.y + 1.0) / 2.0) * H;
            nd.labelEl.style.left = sx + "px";
            nd.labelEl.style.top  = sy + "px";
            if (_labelsForced) {
                const zoomPct = 1.0 - (spherical.radius - CAM_MIN_RADIUS) / (CAM_MAX_RADIUS - CAM_MIN_RADIUS);
                nd.labelEl.style.opacity = zoomPct < 0.3 ? "0" : "1";
                const showDesc = zoomPct > 0.8 && nd.description;
                nd.labelEl.textContent = showDesc
                    ? nd.label + "\u2002\u2014\u2002" + nd.description.slice(0, 60)
                    : nd.label;
            }
        });

        renderer.render(scene, camera);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 11. EVENT BINDING
    // ═══════════════════════════════════════════════════════════════════════

    function bindEvents() {
        container.addEventListener("mousemove",   onMouseMove);
        container.addEventListener("mousedown",   onMouseDown);
        window.addEventListener("mouseup",        onMouseUp);
        container.addEventListener("wheel",       onWheel,      { passive: false });
        container.addEventListener("click",       onMouseClick);
        container.addEventListener("contextmenu", e => e.preventDefault());
    }

    /** Convert a MouseEvent to NDC coords relative to the canvas. */
    function toNDC(e) {
        const rect = container.getBoundingClientRect();
        return {
            x:  ((e.clientX - rect.left) / rect.width)  *  2 - 1,
            y: -((e.clientY - rect.top)  / rect.height) *  2 + 1,
        };
    }

    function onMouseMove(e) {
        const ndc = toNDC(e);
        mouseNDC.x = ndc.x;
        mouseNDC.y = ndc.y;

        if (isDragging) {
            // Left-drag: orbital rotation
            const dx = e.clientX - prevMouse.x;
            const dy = e.clientY - prevMouse.y;
            rotVelTheta = -dx * ROTATE_SPEED;
            rotVelPhi   = -dy * ROTATE_SPEED;
            spherical.theta += rotVelTheta;
            spherical.phi   += rotVelPhi;
        }

        if (isRightDragging) {
            // Right-drag: pan
            const dx = e.clientX - prevMouse.x;
            const dy = e.clientY - prevMouse.y;
            const panSpeed = spherical.radius * PAN_SPEED_FACTOR;
            targetPan.x -= dx * panSpeed;
            targetPan.y += dy * panSpeed;
        }

        prevMouse.x = e.clientX;
        prevMouse.y = e.clientY;

        // Hover detection only when not dragging
        if (!isDragging && !isRightDragging) {
            processHover();
        }

        resetIdleTimer();
    }

    function onMouseDown(e) {
        if (e.button === 0) isDragging      = true;
        if (e.button === 2) isRightDragging = true;

        // Store down position to distinguish click vs. drag
        mouseDownPos.x = e.clientX;
        mouseDownPos.y = e.clientY;
        prevMouse.x    = e.clientX;
        prevMouse.y    = e.clientY;

        // Kill inertia and auto-rotate on new drag
        rotVelTheta = 0;
        rotVelPhi   = 0;
        autoRotate  = false;
        clearTimeout(idleTimer);
    }

    function onMouseUp() {
        isDragging      = false;
        isRightDragging = false;
        // Inertia continues in the loop via rotVelTheta / rotVelPhi
        resetIdleTimer();
    }

    function onWheel(e) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR;
        targetRadius = Math.max(CAM_MIN_RADIUS, Math.min(CAM_MAX_RADIUS, targetRadius * factor));
        resetIdleTimer();
    }

    function onMouseClick(e) {
        // Ignore if the mouse moved (it was a drag, not a click)
        const dx = Math.abs(e.clientX - mouseDownPos.x);
        const dy = Math.abs(e.clientY - mouseDownPos.y);
        if (dx > 4 || dy > 4) return;

        const ndc = toNDC(e);
        raycaster.setFromCamera(ndc, camera);
        const hits = raycaster.intersectObjects(nodes.map(n => n.mesh), false);
        if (hits.length > 0) {
            const nd = nodeMap[hits[0].object.userData.id];
            selectedNode = nd;

            // Smooth camera focus — animate pan toward node, zoom in
            targetPan.copy(nd.mesh.position);
            targetRadius = Math.max(CAM_MIN_RADIUS, spherical.radius * 0.5);

            if (window.onNodeSelect) {
                window.onNodeSelect({
                    id:       nd.id,
                    label:    nd.label,
                    category: nd.category,
                });
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 12. IDLE / AUTO-ROTATE
    // ═══════════════════════════════════════════════════════════════════════

    function resetIdleTimer() {
        autoRotate = false;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            autoRotate = true;
        }, IDLE_TIMEOUT_MS);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 12b. EXTENDED EDITING API — internal helpers
    // ═══════════════════════════════════════════════════════════════════════

    /** Project a node's 3D mesh position to 2D pixel coords on the canvas element. */
    function _nodeScreenPos(nd) {
        const W = container.clientWidth;
        const H = container.clientHeight;
        const v = nd.mesh.position.clone().project(camera);
        return {
            x: ((v.x + 1.0) / 2.0) * W,
            y: ((-v.y + 1.0) / 2.0) * H,
        };
    }

    /**
     * Hit-test a screen coordinate against all node meshes.
     * Returns a rich data object or null.
     */
    function getNodeAtScreen(clientX, clientY) {
        if (!container || !camera || nodes.length === 0) return null;
        const rect = container.getBoundingClientRect();
        const ndc  = {
            x:  ((clientX - rect.left) / rect.width)  *  2 - 1,
            y: -((clientY - rect.top)  / rect.height) *  2 + 1,
        };
        raycaster.setFromCamera(ndc, camera);
        const hits = raycaster.intersectObjects(nodes.map(n => n.mesh), false);
        if (hits.length === 0) return null;
        const nd = nodeMap[hits[0].object.userData.id];
        if (!nd) return null;
        const sp = _nodeScreenPos(nd);
        return {
            id:          nd.id,
            label:       nd.label,
            category:    nd.category,
            description: nd.description || "",
            connections: nd.connections.map(c => ({
                nodeId:    c.node.id,
                nodeLabel: c.node.label,
                edgeLabel: c.edge.label || "",
                from:      c.edge.from,
                to:        c.edge.to,
            })),
            screenX: sp.x,
            screenY: sp.y,
        };
    }

    /** Return screen-space {x, y} of a node by id, or null if not found. */
    function getNodeScreenPos(id) {
        const nd = nodeMap[id];
        if (!nd || !container || !camera) return null;
        return _nodeScreenPos(nd);
    }

    /** Return raw 3D world position {x, y, z} of a node by id, or null. */
    function getNodeWorldPos(id) {
        const nd = nodeMap[id];
        if (!nd) return null;
        return { x: nd.mesh.position.x, y: nd.mesh.position.y, z: nd.mesh.position.z };
    }

    /**
     * Hit-test a screen coordinate against edge lines.
     * Returns first edge within `threshold` pixels, or null.
     */
    function getEdgeAtScreen(clientX, clientY, threshold) {
        if (!container || !camera || edges.length === 0) return null;
        const thresh = (threshold === undefined) ? 8 : threshold;
        const rect   = container.getBoundingClientRect();
        const mx     = clientX - rect.left;
        const my     = clientY - rect.top;
        const W      = container.clientWidth;
        const H      = container.clientHeight;

        let closest     = null;
        let closestDist = thresh;

        edges.forEach(ed => {
            const a = nodeMap[ed.from];
            const b = nodeMap[ed.to];
            if (!a || !b) return;
            const pA = a.mesh.position.clone().project(camera);
            const pB = b.mesh.position.clone().project(camera);
            if (pA.z > 1 || pB.z > 1) return;
            const ax = ((pA.x + 1.0) / 2.0) * W;
            const ay = ((-pA.y + 1.0) / 2.0) * H;
            const bx = ((pB.x + 1.0) / 2.0) * W;
            const by = ((-pB.y + 1.0) / 2.0) * H;
            const dx = bx - ax;
            const dy = by - ay;
            const lenSq = dx * dx + dy * dy;
            if (lenSq < 0.01) return;
            const t  = Math.max(0, Math.min(1, ((mx - ax) * dx + (my - ay) * dy) / lenSq));
            const px = ax + t * dx;
            const py = ay + t * dy;
            const dist = Math.sqrt((mx - px) * (mx - px) + (my - py) * (my - py));
            if (dist < closestDist) { closestDist = dist; closest = ed; }
        });

        return closest ? { from: closest.from, to: closest.to, label: closest.label || "" } : null;
    }

    /**
     * Update a single node's visual properties without re-building the graph.
     * Accepts partial nodeData: { id, label?, category?, description? }
     */
    function updateNode(nodeData) {
        const nd = nodeMap[nodeData.id];
        if (!nd) return;
        if (nodeData.label !== undefined && nodeData.label !== nd.label) {
            nd.label = nodeData.label;
            nd.mesh.userData.label = nodeData.label;
            nd.labelEl.textContent = nodeData.label;
        }
        if (nodeData.category !== undefined && nodeData.category !== nd.category) {
            nd.category = nodeData.category;
            nd.mesh.userData.category = nodeData.category;
            const hexColor   = CAT_COLOR[nodeData.category] || 0xcccccc;
            const threeColor = new THREE.Color(hexColor);
            nd.mesh.material.color.set(threeColor);
            nd.mesh.material.emissive.set(threeColor);
        }
        if (nodeData.description !== undefined) {
            nd.description = nodeData.description;
        }
    }

    /**
     * Dynamically add a node to the live 3D scene.
     * Animates a bounce-in scale effect.
     * @param {Object} nodeData   { id, label, category, description? }
     * @param {Object} [posHint]  { x, y, z } optional world position
     */
    function addNode(nodeData, posHint) {
        if (nodeMap[nodeData.id]) return;
        const hexColor   = CAT_COLOR[nodeData.category] || 0xcccccc;
        const threeColor = new THREE.Color(hexColor);

        const geo = new THREE.SphereGeometry(NODE_RADIUS, 32, 32);
        const mat = new THREE.MeshStandardMaterial({
            color:             threeColor,
            roughness:         0.4,
            metalness:         0.3,
            emissive:          threeColor,
            emissiveIntensity: 0.15,
            transparent:       true,
            opacity:           1.0,
        });
        const mesh = new THREE.Mesh(geo, mat);
        const pos  = posHint || {
            x: (Math.random() - 0.5) * LAYOUT_RANGE * 1.6,
            y: (Math.random() - 0.5) * LAYOUT_RANGE * 1.6,
            z: (Math.random() - 0.5) * LAYOUT_RANGE * 1.6,
        };
        mesh.position.set(pos.x, pos.y, pos.z);
        mesh.scale.setScalar(0.1);
        mesh.userData = { id: nodeData.id, targetScale: 1.5, targetOpacity: 1.0 };
        scene.add(mesh);

        const labelEl = document.createElement("div");
        labelEl.textContent = nodeData.label;
        Object.assign(labelEl.style, {
            position:      "absolute",
            fontFamily:    "'IBM Plex Mono', monospace",
            fontSize:      "11px",
            color:         "#e2e2f0",
            background:    "#0d0d18",
            border:        "1px solid #1e1e2e",
            padding:       "4px 8px",
            borderRadius:  "2px",
            pointerEvents: "none",
            display:       "none",
            whiteSpace:    "nowrap",
            zIndex:        "10",
            transform:     "translate(-50%, calc(-100% - 12px))",
            userSelect:    "none",
        });
        labelLayer.appendChild(labelEl);

        const nodeObj = {
            id:          nodeData.id,
            label:       nodeData.label,
            category:    nodeData.category,
            description: nodeData.description || "",
            mesh, labelEl,
            connections: [],
        };
        nodes.push(nodeObj);
        nodeMap[nodeData.id] = nodeObj;

        // Settle to rest scale after bounce-in
        setTimeout(() => { mesh.userData.targetScale = 1.0; }, 700);

        // Register with physics engine
        if (window.GraphPhysics && typeof window.GraphPhysics.addNode === "function") {
            window.GraphPhysics.addNode({ id: nodeData.id, x: pos.x, y: pos.y, z: pos.z });
        }
    }

    /**
     * Remove a node and all its connected edges from the live scene.
     * @param {string} nodeId
     */
    function removeNode(nodeId) {
        const nd = nodeMap[nodeId];
        if (!nd) return;

        // Dispose all edges touching this node
        edges.filter(ed => ed.from === nodeId || ed.to === nodeId).forEach(ed => {
            scene.remove(ed.line);
            ed.line.geometry.dispose();
            ed.line.material.dispose();
        });
        edges = edges.filter(ed => ed.from !== nodeId && ed.to !== nodeId);

        // Prune other nodes' connection lists
        nodes.forEach(n => { n.connections = n.connections.filter(c => c.node.id !== nodeId); });

        // Remove mesh + label
        scene.remove(nd.mesh);
        nd.mesh.geometry.dispose();
        nd.mesh.material.dispose();
        if (nd.labelEl && nd.labelEl.parentNode) nd.labelEl.remove();

        nodes = nodes.filter(n => n.id !== nodeId);
        delete nodeMap[nodeId];

        if (hoveredNode  && hoveredNode.id  === nodeId) hoveredNode  = null;
        if (selectedNode && selectedNode.id === nodeId) selectedNode = null;
    }

    /**
     * Add a new edge line between two existing nodes.
     * Flashes accent colour then fades to default.
     */
    function addEdge(edgeData) {
        const a = nodeMap[edgeData.from];
        const b = nodeMap[edgeData.to];
        if (!a || !b) return;
        if (edges.some(ed => ed.from === edgeData.from && ed.to === edgeData.to)) return;

        const pts = [a.mesh.position.clone(), b.mesh.position.clone()];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({
            color:       EDGE_ACTIVE_HEX,
            opacity:     EDGE_ACTIVE_OPA,
            transparent: true,
        });
        const line = new THREE.Line(geo, mat);
        scene.add(line);

        const edgeObj = { from: edgeData.from, to: edgeData.to, label: edgeData.label || "", line };
        edges.push(edgeObj);
        a.connections.push({ node: b, edge: edgeObj });
        b.connections.push({ node: a, edge: edgeObj });

        // Animate to default colour
        setTimeout(() => {
            mat.color.setHex(EDGE_DEFAULT_HEX);
            mat.opacity = EDGE_DEFAULT_OPA;
        }, 1200);

        if (window.GraphPhysics && typeof window.GraphPhysics.addEdge === "function") {
            window.GraphPhysics.addEdge(edgeData.from, edgeData.to);
        }
    }

    /** Remove a single directed edge from the scene. */
    function removeEdge(fromId, toId) {
        const idx = edges.findIndex(ed => ed.from === fromId && ed.to === toId);
        if (idx === -1) return;
        const ed = edges[idx];
        scene.remove(ed.line);
        ed.line.geometry.dispose();
        ed.line.material.dispose();
        edges.splice(idx, 1);
        const a = nodeMap[fromId];
        const b = nodeMap[toId];
        if (a) a.connections = a.connections.filter(c => c.node.id !== toId);
        if (b) b.connections = b.connections.filter(c => c.node.id !== fromId);
    }

    /** Update the label string of an edge (in-memory only, persisted via autosave). */
    function updateEdgeLabel(fromId, toId, newLabel) {
        const ed = edges.find(e => e.from === fromId && e.to === toId);
        if (ed) ed.label = newLabel || "";
    }

    /** Return a plain-object snapshot of all current nodes (category + description included). */
    function getAllNodes() {
        return nodes.map(nd => ({
            id:          nd.id,
            label:       nd.label,
            category:    nd.category,
            description: nd.description || "",
        }));
    }

    /** Return a plain-object snapshot of all current edges. */
    function getAllEdges() {
        return edges.map(ed => ({
            from:  ed.from,
            to:    ed.to,
            label: ed.label || "",
        }));
    }

    /** Pull camera back to fit the entire graph in view. */
    function fitAll() {
        if (nodes.length === 0) { resetCamera(); return; }
        let cx = 0, cy = 0, cz = 0;
        nodes.forEach(nd => { cx += nd.mesh.position.x; cy += nd.mesh.position.y; cz += nd.mesh.position.z; });
        cx /= nodes.length; cy /= nodes.length; cz /= nodes.length;
        let maxD = 0;
        nodes.forEach(nd => {
            const d = Math.sqrt(
                Math.pow(nd.mesh.position.x - cx, 2) +
                Math.pow(nd.mesh.position.y - cy, 2) +
                Math.pow(nd.mesh.position.z - cz, 2)
            );
            if (d > maxD) maxD = d;
        });
        targetPan.set(cx, cy, cz);
        targetRadius = Math.min(CAM_MAX_RADIUS, Math.max(CAM_MIN_RADIUS, maxD * 2.8 + 80));
    }

    /** Smoothly fly camera to centre on a node and flash it. */
    function focusNode(id) {
        const nd = nodeMap[id];
        if (!nd) return;
        targetPan.copy(nd.mesh.position);
        targetRadius = Math.max(CAM_MIN_RADIUS, spherical.radius * 0.55);
        nd.mesh.userData.targetScale = 1.7;
        setTimeout(() => { nd.mesh.userData.targetScale = 1.0; }, 900);
    }

    /** Re-run force-directed layout from scratch keeping the same nodes/edges. */
    function resetPhysics() {
        const nodeList = nodes.map(n => ({ id: n.id, label: n.label, category: n.category }));
        const edgeList = edges.map(e => ({ from: e.from, to: e.to }));
        const positions = computeLayout(nodeList, edgeList);
        nodeList.forEach((nd, i) => {
            const obj = nodeMap[nd.id];
            if (obj) obj.mesh.position.set(positions[i].x, positions[i].y, positions[i].z);
        });
        // Rebuild edge geometry to match new positions
        edges.forEach(ed => {
            const a = nodeMap[ed.from];
            const b = nodeMap[ed.to];
            if (!a || !b) return;
            const attr = ed.line.geometry.attributes.position;
            attr.setXYZ(0, a.mesh.position.x, a.mesh.position.y, a.mesh.position.z);
            attr.setXYZ(1, b.mesh.position.x, b.mesh.position.y, b.mesh.position.z);
            attr.needsUpdate = true;
        });
    }

    // ── Section 12c: Polish / Step-10 API helpers ────────────────────────────

    /** Return current camera orbit state for minimap and external tools. */
    function getCameraState() {
        const W = container ? container.clientWidth  : 1;
        const H = container ? container.clientHeight : 1;
        return {
            panX:   panOffset.x,
            panY:   panOffset.y,
            panZ:   panOffset.z,
            radius: spherical.radius,
            theta:  spherical.theta,
            phi:    spherical.phi,
            fov:    CAM_FOV,
            aspect: W / H,
        };
    }

    /**
     * Force all node labels visible (true) or restore hover-only mode (false).
     * 300 ms CSS opacity fade.
     */
    function setLabelsVisible(bool) {
        _labelsForced = bool;
        nodes.forEach(nd => {
            nd.labelEl.style.transition = "opacity 300ms ease";
            if (bool) {
                nd.labelEl.style.display = "block";
                nd.labelEl.style.opacity = "1";
            } else {
                nd.labelEl.style.opacity = "0";
                setTimeout(() => {
                    if (!_labelsForced) {
                        nd.labelEl.style.display    = "none";
                        nd.labelEl.style.opacity    = "";
                        nd.labelEl.style.transition = "";
                        nd.labelEl.textContent      = nd.label;
                    }
                }, 320);
            }
        });
    }

    function getLabelsVisible() { return _labelsForced; }

    /** Pause or resume the physics simulation gate flag. */
    function setPhysicsPaused(bool) { _physicsPaused = bool; }
    function isPhysicsPaused()      { return _physicsPaused; }

    /** Return the Three.js renderer canvas element for PNG compositing. */
    function getRendererCanvas() { return renderer ? renderer.domElement : null; }

    // ═══════════════════════════════════════════════════════════════════════
    // 13. PUBLIC API — window.NeuralGraph
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Programmatically highlight a node by ID.
     * Mirrors the hover visual state without requiring mouse interaction.
     */
    function highlightNode(id) {
        const nd = nodeMap[id];
        if (!nd) return;

        hoveredNode = nd;
        const connectedIds = new Set(nd.connections.map(c => c.node.id));

        nodes.forEach(n => {
            if (n === nd) {
                n.mesh.userData.targetScale   = 1.4;
                n.mesh.userData.targetOpacity = 1.0;
                n.labelEl.style.display = "block";
            } else if (connectedIds.has(n.id)) {
                n.mesh.userData.targetScale   = 1.15;
                n.mesh.userData.targetOpacity = 0.9;
            } else {
                n.mesh.userData.targetScale   = 1.0;
                n.mesh.userData.targetOpacity = 0.3;
            }
        });

        edges.forEach(ed => {
            const active = ed.from === id || ed.to === id;
            ed.line.material.color.setHex(active ? EDGE_ACTIVE_HEX : EDGE_DEFAULT_HEX);
            ed.line.material.opacity = active ? EDGE_ACTIVE_OPA : EDGE_DIM_OPA;
        });
    }

    window.NeuralGraph = {
        // ── Core ────────────────────────────────────────────────────────
        init,
        loadData,
        highlightNode,
        resetCamera,
        setAutoRotate,

        // ── Extended editing API ────────────────────────────────────────
        /** Hit-test screen coords → node data or null. */
        getNodeAtScreen,
        /** Hit-test screen coords → edge data or null. */
        getEdgeAtScreen,
        /** Screen {x,y} of a node by ID. */
        getNodeScreenPos,
        /** World {x,y,z} of a node by ID. */
        getNodeWorldPos,
        /** In-place update of a node's visual props. */
        updateNode,
        /** Add a node to the live scene. */
        addNode,
        /** Remove a node and its edges from the live scene. */
        removeNode,
        /** Add an edge line between two existing nodes. */
        addEdge,
        /** Remove a single directed edge. */
        removeEdge,
        /** Change an edge's label string. */
        updateEdgeLabel,
        /** Snapshot of all node plain objects. */
        getAllNodes,
        /** Snapshot of all edge plain objects. */
        getAllEdges,
        /** Pull camera back to show entire graph. */
        fitAll,
        /** Fly camera to a node and flash it. */
        focusNode,
        /** Re-run layout from scratch. */
        resetPhysics,

        // ── Step 10: Polish API ──────────────────────────────────────────────
        /** Camera orbit state for minimap: { panX, panY, panZ, radius, theta, phi, fov, aspect }. */
        getCameraState,
        /** Show (true) or hide (false) all labels with CSS fade. */
        setLabelsVisible,
        /** Current forced-labels state. */
        getLabelsVisible,
        /** Pause / resume physics gate. */
        setPhysicsPaused,
        isPhysicsPaused,
        /** Three.js renderer.domElement for PNG export. */
        getRendererCanvas,
    };

    // ═══════════════════════════════════════════════════════════════════════
    // 14. AUTO-INIT
    // ═══════════════════════════════════════════════════════════════════════

    // Provide default no-op callbacks if nothing overrides them
    window.onNodeHover  = window.onNodeHover  || function (nodeData) {};
    window.onNodeSelect = window.onNodeSelect || function (nodeData) {};

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        // DOM already ready (script loaded after DOMContentLoaded)
        init();
    }

})();
