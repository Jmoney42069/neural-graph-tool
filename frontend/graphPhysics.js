/**
 * graphPhysics.js
 * --------------------------------------------------------------------------
 * 3D force-directed graph physics engine with Barnes-Hut octree repulsion.
 * Pure math / vanilla JS. No rendering dependencies.
 *
 * Public API (window.GraphPhysics):
 *   - init(nodes, edges)
 *   - step()
 *   - startDrag(nodeId)
 *   - updateDrag(x, y, z)
 *   - endDrag()
 *   - addNode(node)
 *   - addEdge(from, to)
 *   - setConfig(options)
 *   - onSettled(callback)
 *   - onUpdate(callback)
 */

(function () {
    "use strict";

    // ======================================================================
    // 1) DEFAULT CONFIG
    // ======================================================================

    var config = {
        theta: 0.8,
        repulsionStrength: 1200,
        springStrength: 0.006,
        restLength: 45,
        gravityStrength: 0.0015,
        dampingFactor: 0.88,
        minDistance: 8,
        precomputeIterations: 120,
        settleEnergyThreshold: 0.08,
    };

    // ======================================================================
    // 2) ENGINE STATE
    // ======================================================================

    // Node identity
    var ids = [];                    // index -> id
    var idToIndex = Object.create(null);

    // Node data (typed arrays)
    var posX = new Float32Array(0);
    var posY = new Float32Array(0);
    var posZ = new Float32Array(0);
    var velX = new Float32Array(0);
    var velY = new Float32Array(0);
    var velZ = new Float32Array(0);
    var forceX = new Float32Array(0);
    var forceY = new Float32Array(0);
    var forceZ = new Float32Array(0);

    // Graph connectivity (edge endpoint indices)
    var edgeA = [];                  // edgeA[k] = i
    var edgeB = [];                  // edgeB[k] = j

    // Simulation state
    var nodeCount = 0;
    var active = false;
    var lastEnergy = Number.POSITIVE_INFINITY;

    // Drag state (single active drag via startDrag/updateDrag/endDrag)
    var pinnedIndex = -1;
    var dragX = 0;
    var dragY = 0;
    var dragZ = 0;
    var prevDragX = 0;
    var prevDragY = 0;
    var prevDragZ = 0;
    var dragVelX = 0;
    var dragVelY = 0;
    var dragVelZ = 0;
    var lastDragTime = 0;

    // Permanently pinned nodes (via pinNode/unpinNode API — independent of drag)
    var pinnedSet = new Set();

    // Callbacks
    var settledCallback = function () {};
    var updateCallback = function () {};

    // Reused output object array for onUpdate / step return
    var positionsOut = [];

    // ======================================================================
    // 3) SEEDED RNG (deterministic for same input IDs)
    // ======================================================================

    function buildSeedFromNodeIds(nodes) {
        var seed = 0;
        for (var i = 0; i < nodes.length; i++) {
            var id = String(nodes[i].id);
            for (var j = 0; j < id.length; j++) {
                seed = (seed + id.charCodeAt(j)) >>> 0;
            }
        }
        return seed >>> 0;
    }

    function mulberry32(seed) {
        var t = seed >>> 0;
        return function () {
            t += 0x6D2B79F5;
            var r = Math.imul(t ^ (t >>> 15), 1 | t);
            r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
        };
    }

    // Uniform random point inside sphere radius R using cbrt distribution
    function randomPointInSphere(rng, radius) {
        var u = rng();
        var v = rng();
        var w = rng();

        var theta = 2 * Math.PI * u;
        var phi = Math.acos(2 * v - 1);
        var r = radius * Math.cbrt(w);

        var sinPhi = Math.sin(phi);
        return {
            x: r * sinPhi * Math.cos(theta),
            y: r * sinPhi * Math.sin(theta),
            z: r * Math.cos(phi),
        };
    }

    // ======================================================================
    // 4) OCTREE (Barnes-Hut)
    // ======================================================================

    function OctreeNode(cx, cy, cz, halfSize) {
        this.cx = cx;
        this.cy = cy;
        this.cz = cz;
        this.half = halfSize;

        // Leaf/body state
        this.body = -1;        // index of a single node if leaf with one body

        // Children (length 8) or null for leaf
        this.children = null;

        // Center-of-mass aggregate
        this.mass = 0;         // number of bodies in this subtree
        this.comX = 0;
        this.comY = 0;
        this.comZ = 0;
    }

    OctreeNode.prototype.isLeaf = function () {
        return this.children === null;
    };

    OctreeNode.prototype.subdivide = function () {
        var q = this.half * 0.5;
        this.children = new Array(8);

        // Child index bits: xBit(1), yBit(2), zBit(4)
        for (var i = 0; i < 8; i++) {
            var ox = (i & 1) ? q : -q;
            var oy = (i & 2) ? q : -q;
            var oz = (i & 4) ? q : -q;
            this.children[i] = new OctreeNode(this.cx + ox, this.cy + oy, this.cz + oz, q);
        }
    };

    OctreeNode.prototype.childIndexFor = function (x, y, z) {
        var idx = 0;
        if (x >= this.cx) idx |= 1;
        if (y >= this.cy) idx |= 2;
        if (z >= this.cz) idx |= 4;
        return idx;
    };

    OctreeNode.prototype.insert = function (bodyIndex) {
        var x = posX[bodyIndex];
        var y = posY[bodyIndex];
        var z = posZ[bodyIndex];

        if (this.isLeaf()) {
            if (this.body === -1) {
                this.body = bodyIndex;
                return;
            }

            // Already has one body -> subdivide and reinsert both
            var existing = this.body;
            this.body = -1;
            this.subdivide();

            var oldChild = this.childIndexFor(posX[existing], posY[existing], posZ[existing]);
            this.children[oldChild].insert(existing);

            var newChild = this.childIndexFor(x, y, z);
            this.children[newChild].insert(bodyIndex);
            return;
        }

        // Internal node
        var cidx = this.childIndexFor(x, y, z);
        this.children[cidx].insert(bodyIndex);
    };

    OctreeNode.prototype.calculateCenterOfMass = function () {
        if (this.isLeaf()) {
            if (this.body === -1) {
                this.mass = 0;
                this.comX = 0;
                this.comY = 0;
                this.comZ = 0;
                return;
            }
            this.mass = 1;
            this.comX = posX[this.body];
            this.comY = posY[this.body];
            this.comZ = posZ[this.body];
            return;
        }

        var massSum = 0;
        var sx = 0;
        var sy = 0;
        var sz = 0;

        for (var i = 0; i < 8; i++) {
            var child = this.children[i];
            child.calculateCenterOfMass();
            if (child.mass > 0) {
                massSum += child.mass;
                sx += child.comX * child.mass;
                sy += child.comY * child.mass;
                sz += child.comZ * child.mass;
            }
        }

        this.mass = massSum;
        if (massSum > 0) {
            this.comX = sx / massSum;
            this.comY = sy / massSum;
            this.comZ = sz / massSum;
        } else {
            this.comX = 0;
            this.comY = 0;
            this.comZ = 0;
        }
    };

    OctreeNode.prototype.containsPoint = function (x, y, z) {
        var h = this.half;
        return (
            x >= this.cx - h && x <= this.cx + h &&
            y >= this.cy - h && y <= this.cy + h &&
            z >= this.cz - h && z <= this.cz + h
        );
    };

    OctreeNode.prototype.accumulateRepulsion = function (i, theta, repulsionStrength, minDistance) {
        if (this.mass === 0) return;

        // Skip exact self leaf
        if (this.isLeaf() && this.body === i) return;

        var xi = posX[i];
        var yi = posY[i];
        var zi = posZ[i];

        var dx = xi - this.comX;
        var dy = yi - this.comY;
        var dz = zi - this.comZ;

        var d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1e-8) d2 = 1e-8;
        var dist = Math.sqrt(d2);

        var boxSize = this.half * 2;
        var inThisCell = this.containsPoint(xi, yi, zi);

        // Barnes-Hut acceptance rule
        // If this node is sufficiently far, approximate as a single mass.
        // But never approximate a cell that contains the particle itself.
        if (this.isLeaf() || (!inThisCell && (boxSize / dist) < theta)) {
            var effectiveDist = dist < minDistance ? minDistance : dist;
            var invDist = 1 / effectiveDist;
            var invDist2 = invDist * invDist;

            // F = k / d^2, multiplied by aggregate mass
            var f = repulsionStrength * this.mass * invDist2;

            // Direction is away from center of mass
            var nx = dx * invDist;
            var ny = dy * invDist;
            var nz = dz * invDist;

            forceX[i] += nx * f;
            forceY[i] += ny * f;
            forceZ[i] += nz * f;
            return;
        }

        // Otherwise recurse into children
        if (!this.isLeaf()) {
            for (var c = 0; c < 8; c++) {
                this.children[c].accumulateRepulsion(i, theta, repulsionStrength, minDistance);
            }
        }
    };

    function buildOctree() {
        if (nodeCount === 0) return null;

        // Compute bounds and build a cubic root volume
        var minX = posX[0], maxX = posX[0];
        var minY = posY[0], maxY = posY[0];
        var minZ = posZ[0], maxZ = posZ[0];

        for (var i = 1; i < nodeCount; i++) {
            var x = posX[i], y = posY[i], z = posZ[i];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }

        var cx = (minX + maxX) * 0.5;
        var cy = (minY + maxY) * 0.5;
        var cz = (minZ + maxZ) * 0.5;

        var spanX = maxX - minX;
        var spanY = maxY - minY;
        var spanZ = maxZ - minZ;
        var span = Math.max(spanX, spanY, spanZ);
        var half = Math.max(16, span * 0.55 + 1);

        var root = new OctreeNode(cx, cy, cz, half);
        for (var n = 0; n < nodeCount; n++) {
            root.insert(n);
        }
        root.calculateCenterOfMass();
        return root;
    }

    // ======================================================================
    // 5) ARRAY MANAGEMENT
    // ======================================================================

    function allocateArrays(n) {
        posX = new Float32Array(n);
        posY = new Float32Array(n);
        posZ = new Float32Array(n);
        velX = new Float32Array(n);
        velY = new Float32Array(n);
        velZ = new Float32Array(n);
        forceX = new Float32Array(n);
        forceY = new Float32Array(n);
        forceZ = new Float32Array(n);
    }

    function growArrays(newSize) {
        function grow(oldArr) {
            var out = new Float32Array(newSize);
            out.set(oldArr);
            return out;
        }
        posX = grow(posX);
        posY = grow(posY);
        posZ = grow(posZ);
        velX = grow(velX);
        velY = grow(velY);
        velZ = grow(velZ);
        forceX = grow(forceX);
        forceY = grow(forceY);
        forceZ = grow(forceZ);
    }

    function refreshOutputBuffer() {
        positionsOut.length = nodeCount;
        for (var i = 0; i < nodeCount; i++) {
            positionsOut[i] = positionsOut[i] || { id: ids[i], x: 0, y: 0, z: 0 };
            positionsOut[i].id = ids[i];
        }
    }

    function updateOutputBufferValues() {
        for (var i = 0; i < nodeCount; i++) {
            positionsOut[i].x = posX[i];
            positionsOut[i].y = posY[i];
            positionsOut[i].z = posZ[i];
        }
    }

    // ======================================================================
    // 6) FORCE ACCUMULATION
    // ======================================================================

    function clearForces() {
        forceX.fill(0);
        forceY.fill(0);
        forceZ.fill(0);
    }

    function applyRepulsion(root) {
        if (!root) return;
        var theta = config.theta;
        var repulsionStrength = config.repulsionStrength;
        var minDistance = config.minDistance;

        for (var i = 0; i < nodeCount; i++) {
            if (i === pinnedIndex || pinnedSet.has(ids[i])) continue;
            root.accumulateRepulsion(i, theta, repulsionStrength, minDistance);
        }
    }

    function applySpringForces() {
        var k = config.springStrength;
        var rest = config.restLength;

        for (var e = 0; e < edgeA.length; e++) {
            var i = edgeA[e];
            var j = edgeB[e];
            if (i < 0 || j < 0 || i >= nodeCount || j >= nodeCount) continue;

            var dx = posX[j] - posX[i];
            var dy = posY[j] - posY[i];
            var dz = posZ[j] - posZ[i];
            var d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < 1e-8) d2 = 1e-8;
            var dist = Math.sqrt(d2);
            var invDist = 1 / dist;

            // Hooke force: F = k * (distance - restLength)
            var f = k * (dist - rest);

            var fx = dx * invDist * f;
            var fy = dy * invDist * f;
            var fz = dz * invDist * f;

            if (i !== pinnedIndex && !pinnedSet.has(ids[i])) {
                forceX[i] += fx;
                forceY[i] += fy;
                forceZ[i] += fz;
            }
            if (j !== pinnedIndex && !pinnedSet.has(ids[j])) {
                forceX[j] -= fx;
                forceY[j] -= fy;
                forceZ[j] -= fz;
            }
        }
    }

    function applyGravity() {
        var g = config.gravityStrength;
        for (var i = 0; i < nodeCount; i++) {
            if (i === pinnedIndex || pinnedSet.has(ids[i])) continue;
            // F = gravityStrength * distanceToOrigin, toward origin
            // vector form simplifies to: -g * position
            forceX[i] += -g * posX[i];
            forceY[i] += -g * posY[i];
            forceZ[i] += -g * posZ[i];
        }
    }

    // ======================================================================
    // 7) INTEGRATION / KINETIC ENERGY
    // ======================================================================

    function integrate() {
        var damping = config.dampingFactor;
        var kinetic = 0;

        for (var i = 0; i < nodeCount; i++) {
            if (i === pinnedIndex) {
                // Keep drag-pinned node exactly at drag position
                posX[i] = dragX;
                posY[i] = dragY;
                posZ[i] = dragZ;
                velX[i] = dragVelX;
                velY[i] = dragVelY;
                velZ[i] = dragVelZ;
                continue;
            }

            if (pinnedSet.has(ids[i])) {
                // Permanently pinned: zero velocity, position unchanged
                velX[i] = 0;
                velY[i] = 0;
                velZ[i] = 0;
                continue;
            }

            // Unit mass, dt = 1
            velX[i] = (velX[i] + forceX[i]) * damping;
            velY[i] = (velY[i] + forceY[i]) * damping;
            velZ[i] = (velZ[i] + forceZ[i]) * damping;

            posX[i] += velX[i];
            posY[i] += velY[i];
            posZ[i] += velZ[i];

            kinetic += 0.5 * (velX[i] * velX[i] + velY[i] * velY[i] + velZ[i] * velZ[i]);
        }

        lastEnergy = kinetic;
        return kinetic;
    }

    // ======================================================================
    // 8) ONE SIMULATION TICK
    // ======================================================================

    function simulateOneTick() {
        if (nodeCount === 0) return;

        var root = buildOctree();
        clearForces();
        applyRepulsion(root);
        applySpringForces();
        applyGravity();
        var kinetic = integrate();

        if (pinnedIndex === -1 && kinetic < config.settleEnergyThreshold) {
            if (active) {
                active = false;
                settledCallback();
            }
        } else {
            active = true;
        }

        updateOutputBufferValues();
        updateCallback(positionsOut);
    }

    // ======================================================================
    // 9) INITIALIZATION
    // ======================================================================

    function resetState() {
        ids = [];
        idToIndex = Object.create(null);
        edgeA = [];
        edgeB = [];
        nodeCount = 0;
        active = false;
        pinnedIndex = -1;
        pinnedSet = new Set();
        lastEnergy = Number.POSITIVE_INFINITY;
    }

    function init(nodes, edges) {
        if (!Array.isArray(nodes) || !Array.isArray(edges)) {
            throw new Error("GraphPhysics.init(nodes, edges): both arguments must be arrays.");
        }

        resetState();

        nodeCount = nodes.length;
        allocateArrays(nodeCount);

        var seed = buildSeedFromNodeIds(nodes);
        var rng = mulberry32(seed);

        // Initialize nodes
        for (var i = 0; i < nodeCount; i++) {
            var n = nodes[i];
            var id = String(n.id);
            ids[i] = id;
            idToIndex[id] = i;

            var hasXYZ = typeof n.x === "number" && typeof n.y === "number" && typeof n.z === "number";
            if (hasXYZ) {
                posX[i] = n.x;
                posY[i] = n.y;
                posZ[i] = n.z;
            } else {
                var p = randomPointInSphere(rng, 80);
                posX[i] = p.x;
                posY[i] = p.y;
                posZ[i] = p.z;
            }

            velX[i] = 0;
            velY[i] = 0;
            velZ[i] = 0;
        }

        // Initialize edges
        for (var e = 0; e < edges.length; e++) {
            var from = String(edges[e].from);
            var to = String(edges[e].to);
            var a = idToIndex[from];
            var b = idToIndex[to];
            if (a === undefined || b === undefined || a === b) continue;
            edgeA.push(a);
            edgeB.push(b);
        }

        refreshOutputBuffer();

        // PRE-COMPUTATION MODE: adaptive iterations (fewer for large graphs)
        var _adaptiveIters = Math.min(config.precomputeIterations,
            Math.max(15, Math.floor(8000 / Math.max(nodes.length, 1))));
        active = true;
        for (var k = 0; k < _adaptiveIters; k++) {
            simulateOneTick();
        }

        // Live mode starts after precompute; if already settled, callback will have fired
        if (lastEnergy >= config.settleEnergyThreshold) {
            active = true;
        }

        updateOutputBufferValues();
        return positionsOut;
    }

    // ======================================================================
    // 10) DRAG MODE
    // ======================================================================

    function startDrag(nodeId) {
        var idx = idToIndex[String(nodeId)];
        if (idx === undefined) return false;

        pinnedIndex = idx;
        dragX = posX[idx];
        dragY = posY[idx];
        dragZ = posZ[idx];

        prevDragX = dragX;
        prevDragY = dragY;
        prevDragZ = dragZ;
        dragVelX = 0;
        dragVelY = 0;
        dragVelZ = 0;
        lastDragTime = performance.now();

        active = true;
        return true;
    }

    function updateDrag(x, y, z) {
        if (pinnedIndex === -1) return false;

        var now = performance.now();
        var dtMs = now - lastDragTime;
        if (dtMs < 0.5) dtMs = 0.5;
        var dt = dtMs / 16.6667; // normalize to ~60Hz frame units

        dragVelX = (x - prevDragX) / dt;
        dragVelY = (y - prevDragY) / dt;
        dragVelZ = (z - prevDragZ) / dt;

        prevDragX = dragX;
        prevDragY = dragY;
        prevDragZ = dragZ;

        dragX = x;
        dragY = y;
        dragZ = z;
        lastDragTime = now;

        active = true;
        return true;
    }

    function endDrag() {
        if (pinnedIndex === -1) return false;

        // Release node with current drag velocity so momentum carries through network
        velX[pinnedIndex] = dragVelX;
        velY[pinnedIndex] = dragVelY;
        velZ[pinnedIndex] = dragVelZ;

        pinnedIndex = -1;
        active = true;
        return true;
    }

    // ======================================================================
    // 11) DYNAMIC GRAPH EDITS
    // ======================================================================

    function addNode(node) {
        if (!node || node.id === undefined || node.id === null) {
            throw new Error("GraphPhysics.addNode(node): node.id is required.");
        }

        var id = String(node.id);
        if (idToIndex[id] !== undefined) {
            return false;
        }

        var oldCount = nodeCount;
        var newCount = oldCount + 1;

        ids.push(id);
        idToIndex[id] = oldCount;
        growArrays(newCount);
        nodeCount = newCount;

        // Place near connected neighbors if they already exist in edge list,
        // otherwise near origin with deterministic jitter.
        var neighborIndices = [];
        for (var e = 0; e < edgeA.length; e++) {
            var a = edgeA[e], b = edgeB[e];
            if (a === oldCount && b < oldCount) neighborIndices.push(b);
            if (b === oldCount && a < oldCount) neighborIndices.push(a);
        }

        var x = 0, y = 0, z = 0;
        if (typeof node.x === "number" && typeof node.y === "number" && typeof node.z === "number") {
            x = node.x;
            y = node.y;
            z = node.z;
        } else if (neighborIndices.length > 0) {
            for (var i = 0; i < neighborIndices.length; i++) {
                var ni = neighborIndices[i];
                x += posX[ni];
                y += posY[ni];
                z += posZ[ni];
            }
            var inv = 1 / neighborIndices.length;
            x = x * inv + (Math.random() - 0.5) * 6;
            y = y * inv + (Math.random() - 0.5) * 6;
            z = z * inv + (Math.random() - 0.5) * 6;
        } else {
            x = (Math.random() - 0.5) * 20;
            y = (Math.random() - 0.5) * 20;
            z = (Math.random() - 0.5) * 20;
        }

        posX[oldCount] = x;
        posY[oldCount] = y;
        posZ[oldCount] = z;
        velX[oldCount] = 0;
        velY[oldCount] = 0;
        velZ[oldCount] = 0;

        refreshOutputBuffer();
        active = true;
        return true;
    }

    function addEdge(from, to) {
        var a = idToIndex[String(from)];
        var b = idToIndex[String(to)];
        if (a === undefined || b === undefined || a === b) return false;

        edgeA.push(a);
        edgeB.push(b);
        active = true;
        return true;
    }

    // ======================================================================
    // 12) CONFIG / CALLBACKS / STEP
    // ======================================================================

    function setConfig(options) {
        if (!options || typeof options !== "object") return;

        if (typeof options.repulsionStrength === "number") config.repulsionStrength = options.repulsionStrength;
        if (typeof options.springStrength === "number") config.springStrength = options.springStrength;
        if (typeof options.restLength === "number") config.restLength = options.restLength;
        if (typeof options.gravityStrength === "number") config.gravityStrength = options.gravityStrength;
        if (typeof options.dampingFactor === "number") config.dampingFactor = options.dampingFactor;

        // Optional expert params
        if (typeof options.theta === "number") config.theta = options.theta;
        if (typeof options.minDistance === "number") config.minDistance = options.minDistance;
        if (typeof options.precomputeIterations === "number") config.precomputeIterations = options.precomputeIterations;
        if (typeof options.settleEnergyThreshold === "number") config.settleEnergyThreshold = options.settleEnergyThreshold;

        active = true;
    }

    function onSettled(callback) {
        settledCallback = typeof callback === "function" ? callback : function () {};
    }

    function onUpdate(callback) {
        updateCallback = typeof callback === "function" ? callback : function () {};
    }

    function step() {
        if (nodeCount === 0) return [];

        // If settled and not dragging, skip force solve; still provide latest state.
        if (!active && pinnedIndex === -1) {
            updateOutputBufferValues();
            return positionsOut;
        }

        simulateOneTick();
        return positionsOut;
    }

    // ======================================================================
    // 13) PUBLIC API EXPORT
    // ======================================================================

    function pinNode(nodeId) {
        pinnedSet.add(String(nodeId));
        active = true;
    }

    function unpinNode(nodeId) {
        var id = String(nodeId);
        pinnedSet.delete(id);
        var idx = idToIndex[id];
        if (idx !== undefined) {
            velX[idx] = 0; velY[idx] = 0; velZ[idx] = 0;
        }
        active = true;
    }

    function getPinnedNodes() {
        return Array.from(pinnedSet);
    }

    window.GraphPhysics = {
        init: init,
        step: step,
        startDrag: startDrag,
        updateDrag: updateDrag,
        endDrag: endDrag,
        addNode: addNode,
        addEdge: addEdge,
        setConfig: setConfig,
        onSettled: onSettled,
        onUpdate: onUpdate,
        pinNode: pinNode,
        unpinNode: unpinNode,
        getPinnedNodes: getPinnedNodes,
        isActive: function () { return active; },
    };

    // ======================================================================
    // 14) INTEGRATION GUIDE (neuralGraph3D.js)
    // ======================================================================

    /**
     * Integration steps for frontend/neuralGraph3D.js
     * ----------------------------------------------------------------------
     * 1) Include this script before neuralGraph3D.js in index.html:
     *      <script src="graphPhysics.js"></script>
     *      <script src="neuralGraph3D.js"></script>
     *
     * 2) In neuralGraph3D.js loadData(nodeList, edgeList):
     *    - After creating node objects / nodeMap, call:
     *
     *      window.GraphPhysics.init(
     *          nodeList.map(function (n) {
     *              return { id: n.id };
     *          }),
     *          edgeList.map(function (e) {
     *              return { from: e.from, to: e.to };
     *          })
     *      );
     *
     *    - Register update callback once:
     *
     *      window.GraphPhysics.onUpdate(function (positions) {
     *          for (var i = 0; i < positions.length; i++) {
     *              var p = positions[i];
     *              var nodeObj = nodeMap[p.id];
     *              if (nodeObj) {
     *                  nodeObj.mesh.position.set(p.x, p.y, p.z);
     *              }
     *          }
     *
     *          // Rebuild edge geometry positions after node updates.
     *          // For each edge line, write endpoints into its buffer attribute.
     *      });
     *
     * 3) In the main animation loop in neuralGraph3D.js:
     *      window.GraphPhysics.step();
     *    Place this before renderer.render(...), so meshes are updated each frame.
     *
     * 4) Drag bridging:
     *    - On node mouse down (when you identify clicked node id):
     *        window.GraphPhysics.startDrag(nodeId);
     *    - While dragging, convert mouse to world position on drag plane and call:
     *        window.GraphPhysics.updateDrag(worldX, worldY, worldZ);
     *    - On mouse up:
     *        window.GraphPhysics.endDrag();
     *
     * 5) Dynamic graph updates:
     *    - When adding a node at runtime:
     *        window.GraphPhysics.addNode({ id: newId, x: optionalX, y: optionalY, z: optionalZ });
     *    - When adding an edge:
     *        window.GraphPhysics.addEdge(fromId, toId);
     *
     * 6) Optional tuning:
     *      window.GraphPhysics.setConfig({
     *          repulsionStrength: 1200,
     *          springStrength: 0.006,
     *          restLength: 45,
     *          gravityStrength: 0.0015,
     *          dampingFactor: 0.88,
     *      });
     */
})();
