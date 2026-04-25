/**
 * dragNodes.js — pointer-based 3D node drag for NeuralGraph
 * Depends on: THREE (global), GraphPhysics, NodeManager
 */
(function () {
    "use strict";

    var _scene, _camera, _renderer, _canvas;
    var _raycaster = null;
    var _dragPlane = null;
    var _dragOffset = null;
    var _draggedNode = null;   // NodeManager entry {id, group, coreMesh, data}
    var _isDragging = false;
    var _pointerDownTime = 0;
    var _pointerDownX = 0;
    var _pointerDownY = 0;
    var _pointerMoved = false;
    var _dragRing = null;
    var _saveTimer = null;
    var _enabled = false;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function _getNDC(event) {
        var rect = _canvas.getBoundingClientRect();
        return new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
    }

    function _getNodeAtEvent(event) {
        if (!window.NodeManager) return null;
        var iMesh = window.NodeManager.getInstancedMesh();
        if (!iMesh) return null;
        _raycaster.setFromCamera(_getNDC(event), _camera);
        var hits = _raycaster.intersectObject(iMesh, false);
        if (!hits.length) return null;
        var all   = window.NodeManager.getAll();
        return all[hits[0].instanceId] || null;
    }

    function _startDragRing(pos) {
        _removeDragRing();
        try {
            var geo = new THREE.RingGeometry(5.5, 7, 32);
            var mat = new THREE.MeshBasicMaterial({
                color: 0x4fc3f7,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.85,
                depthTest: false
            });
            _dragRing = new THREE.Mesh(geo, mat);
            _dragRing.position.copy(pos);
            _dragRing.lookAt(_camera.position);
            _dragRing.renderOrder = 999;
            _scene.add(_dragRing);
        } catch (e) {
            _dragRing = null;
        }
    }

    function _removeDragRing() {
        if (_dragRing) {
            _scene.remove(_dragRing);
            if (_dragRing.geometry) _dragRing.geometry.dispose();
            if (_dragRing.material) _dragRing.material.dispose();
            _dragRing = null;
        }
    }

    function _debounceSave(id, x, y, z) {
        clearTimeout(_saveTimer);
        _saveTimer = setTimeout(function () {
            fetch("/graph/node-position", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ node_id: id, x: x, y: y, z: z })
            }).catch(function (e) {
                console.warn("[DragNodes] save failed:", e);
            });
        }, 1000);
    }

    // -----------------------------------------------------------------------
    // Pointer handlers
    // -----------------------------------------------------------------------

    function _onPointerDown(event) {
        if (!_enabled || event.button !== 0) return;
        var entry = _getNodeAtEvent(event);
        if (!entry) return;
        event.preventDefault();
        event.stopPropagation();
        _draggedNode = entry;
        _pointerDownTime = Date.now();
        _pointerDownX = event.clientX;
        _pointerDownY = event.clientY;
        _pointerMoved = false;
        _isDragging = false;

        // Drag plane perpendicular to camera, passing through node center
        var normal = new THREE.Vector3()
            .subVectors(_camera.position, entry.group.position)
            .normalize();
        _dragPlane = new THREE.Plane();
        _dragPlane.setFromNormalAndCoplanarPoint(normal, entry.group.position);

        // Compute offset between node origin and hit point on plane
        var hitPoint = new THREE.Vector3();
        _raycaster.setFromCamera(_getNDC(event), _camera);
        _raycaster.ray.intersectPlane(_dragPlane, hitPoint);
        _dragOffset = new THREE.Vector3().subVectors(entry.group.position, hitPoint);

        // Tell renderer to suppress camera orbit
        window._DragNodes_active = true;
    }

    function _onPointerMove(event) {
        if (!_enabled) return;

        // Hover cursor when not dragging
        if (!_draggedNode) {
            var hover = _getNodeAtEvent(event);
            if (_canvas) _canvas.style.cursor = hover ? "grab" : "";
            return;
        }

        var dx = event.clientX - _pointerDownX;
        var dy = event.clientY - _pointerDownY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) _pointerMoved = true;

        var elapsed = Date.now() - _pointerDownTime;
        if (!_isDragging && (_pointerMoved || elapsed > 150)) {
            _isDragging = true;
            if (_canvas) {
                _canvas.style.cursor = "grabbing";
                _canvas.classList.add("ng-drag-active");
            }
            if (window.GraphPhysics && window.GraphPhysics.startDrag) {
                window.GraphPhysics.startDrag(_draggedNode.id);
            }
            _startDragRing(_draggedNode.group.position);
        }

        if (!_isDragging) return;

        // Move node in 3D along drag plane
        _raycaster.setFromCamera(_getNDC(event), _camera);
        var target = new THREE.Vector3();
        if (_raycaster.ray.intersectPlane(_dragPlane, target)) {
            target.add(_dragOffset);
            _draggedNode.group.position.copy(target);
            if (_draggedNode.data) {
                _draggedNode.data.x = target.x;
                _draggedNode.data.y = target.y;
                _draggedNode.data.z = target.z;
            }
            if (_dragRing) {
                _dragRing.position.copy(target);
                _dragRing.lookAt(_camera.position);
            }
            if (window.GraphPhysics && window.GraphPhysics.updateDrag) {
                window.GraphPhysics.updateDrag(target.x, target.y, target.z);
            }
        }
    }

    function _onPointerUp(event) {
        window._DragNodes_active = false;

        if (!_draggedNode) return;

        if (_isDragging) {
            if (window.GraphPhysics && window.GraphPhysics.endDrag) {
                window.GraphPhysics.endDrag();
            }
            _removeDragRing();
            if (_canvas) {
                _canvas.style.cursor = "";
                _canvas.classList.remove("ng-drag-active");
            }
            var d = _draggedNode.data || {};
            _debounceSave(_draggedNode.id, d.x || 0, d.y || 0, d.z || 0);
        } else {
            // Short tap / click (no drag) — fire node selection manually.
            // We must do this here because event.preventDefault() on pointerdown
            // suppresses the browser's synthetic click event before hover.js sees it.
            var entry = _draggedNode;
            if (window.HoverManager) {
                var sel = window.HoverManager.getSelectedId && window.HoverManager.getSelectedId();
                if (sel === entry.id) {
                    // Deselect
                    window.HoverManager.clearSelection && window.HoverManager.clearSelection();
                } else {
                    // Select — highlight edges in this node's color
                    if (window.HoverManager.clearSelection) window.HoverManager.clearSelection();
                    if (window.EdgeManager) {
                        var col = "#" + entry.baseHex.toString(16).padStart(6, "0");
                        window.EdgeManager.highlightEdgesOf(entry.id, col);
                    }
                    // Store selected id via HoverManager internal (call hidden setter if available)
                    if (window.HoverManager._setSelected) window.HoverManager._setSelected(entry.id);
                }
            }
            // Show / hide inspector overlay
            var overlay = document.getElementById("node-inspector-overlay");
            if (overlay) overlay.classList.toggle("visible", true);
            if (window.onNodeSelect) window.onNodeSelect(entry.data);
        }

        _isDragging = false;
        _draggedNode = null;
        _dragPlane = null;
        _dragOffset = null;
        _pointerMoved = false;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    function init(scene, camera, renderer) {
        _scene = scene;
        _camera = camera;
        _renderer = renderer;
        _canvas = renderer ? renderer.domElement : null;
        _raycaster = new THREE.Raycaster();

        if (_canvas) {
            _canvas.addEventListener("pointerdown", _onPointerDown);
            _canvas.addEventListener("pointermove", _onPointerMove);
            _canvas.addEventListener("pointerup", _onPointerUp);
            _canvas.addEventListener("pointercancel", _onPointerUp);
        }
    }

    function enable() {
        _enabled = true;
    }

    function disable() {
        _enabled = false;
        window._DragNodes_active = false;
        if (_isDragging) {
            _removeDragRing();
            if (window.GraphPhysics && window.GraphPhysics.endDrag) window.GraphPhysics.endDrag();
            _isDragging = false;
            _draggedNode = null;
        }
    }

    function pinNode(nodeId) {
        if (window.GraphPhysics && window.GraphPhysics.pinNode) {
            window.GraphPhysics.pinNode(nodeId);
        }
    }

    function unpinNode(nodeId) {
        if (window.GraphPhysics && window.GraphPhysics.unpinNode) {
            window.GraphPhysics.unpinNode(nodeId);
        }
    }

    function getPinnedNodes() {
        if (window.GraphPhysics && window.GraphPhysics.getPinnedNodes) {
            return window.GraphPhysics.getPinnedNodes();
        }
        return [];
    }

    function savePositions() {
        if (!window.NodeManager) return;
        window.NodeManager.getAll().forEach(function (e) {
            var d = e.data || {};
            _debounceSave(e.id, d.x || 0, d.y || 0, d.z || 0);
        });
    }

    window.DragNodes = {
        init: init,
        enable: enable,
        disable: disable,
        pinNode: pinNode,
        unpinNode: unpinNode,
        getPinnedNodes: getPinnedNodes,
        savePositions: savePositions,
    };

})();

// ✓ Fix 2 compleet — node drag geïmplementeerd
