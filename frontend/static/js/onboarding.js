// FILE: onboarding.js
// DOES: Empty state detection, mini Three.js node universe, drag-drop onboarding
// USES: THREE (global), window.NeuralGraph, window.NeuralGraphTestData
// EXPOSES: window.NeuralGraphOnboarding = { show, hide, check }

(function () {
    "use strict";

    var _visible = false;
    var _miniScene, _miniCamera, _miniRenderer, _miniRaf;
    var _miniNodes = [];
    var _miniAngle = 0;

    // ── Check if onboarding should show ────────────────────────────────────
    function _check() {
        fetch("/graph/load")
            .then(function (r) { return r.json(); })
            .then(function (g) {
                if (!(g.nodes && g.nodes.length > 0)) _show();
            })
            .catch(function () {});
    }

    // ── Show onboarding ────────────────────────────────────────────────────
    function _show() {
        if (_visible) return;
        if (document.getElementById("ng-onboarding")) return;
        _visible = true;

        var canvas = document.getElementById("graph-canvas");
        if (!canvas) return;

        var wrap = document.createElement("div");
        wrap.id = "ng-onboarding";

        var borderWrap = document.createElement("div");
        borderWrap.className = "ng-ob-border-wrap";

        var inner = document.createElement("div");
        inner.id = "ng-ob-inner";

        // Mini Three.js canvas
        var canvasWrap = document.createElement("div");
        canvasWrap.className = "ng-ob-canvas-wrap";
        var miniCanvas = _buildMiniUniverse();
        if (miniCanvas) canvasWrap.appendChild(miniCanvas);
        inner.appendChild(canvasWrap);

        // Title
        var title = document.createElement("div");
        title.id = "ng-ob-title";
        title.textContent = "NeuralGraph";
        inner.appendChild(title);

        // Subtitle
        var sub = document.createElement("div");
        sub.id = "ng-ob-sub";
        sub.textContent = "Connect your knowledge. Discover patterns.";
        inner.appendChild(sub);

        // Buttons
        var btns = document.createElement("div");
        btns.id = "ng-ob-btns";

        var uploadBtn = document.createElement("button");
        uploadBtn.className = "ng-ob-btn ng-ob-btn--accent";
        var uploadIcon = document.createElement("i");
        uploadIcon.setAttribute("data-lucide", "upload");
        uploadBtn.appendChild(uploadIcon);
        uploadBtn.appendChild(document.createTextNode(" Upload document"));
        uploadBtn.addEventListener("click", function () {
            _hide();
            if (window.openUploadModal) window.openUploadModal();
        });

        var demoBtn = document.createElement("button");
        demoBtn.className = "ng-ob-btn";
        var demoIcon = document.createElement("i");
        demoIcon.setAttribute("data-lucide", "zap");
        demoBtn.appendChild(demoIcon);
        demoBtn.appendChild(document.createTextNode(" Load demo graph"));
        demoBtn.addEventListener("click", function () {
            _hide();
            if (window.NeuralGraphTestData) window.NeuralGraphTestData.load(50);
        });

        btns.appendChild(uploadBtn);
        btns.appendChild(demoBtn);
        inner.appendChild(btns);

        // Drop hint
        var hint = document.createElement("div");
        hint.className = "ng-ob-drop-hint";
        hint.textContent = "or drag a file anywhere";
        inner.appendChild(hint);

        borderWrap.appendChild(inner);
        wrap.appendChild(borderWrap);
        canvas.appendChild(wrap);

        // Drag-drop support
        wrap.addEventListener("dragover", function (e) {
            e.preventDefault();
            wrap.classList.add("drag-over");
        });
        wrap.addEventListener("dragleave", function () {
            wrap.classList.remove("drag-over");
        });
        wrap.addEventListener("drop", function (e) {
            e.preventDefault();
            wrap.classList.remove("drag-over");
            _hide();
            // Forward to the file input
            var fileInput = document.getElementById("file-input");
            if (fileInput && e.dataTransfer.files.length) {
                fileInput.files = e.dataTransfer.files;
                if (window.openUploadModal) window.openUploadModal();
            }
        });

        if (typeof lucide !== "undefined") lucide.createIcons();
    }

    // ── Hide onboarding ────────────────────────────────────────────────────
    function _hide() {
        var el = document.getElementById("ng-onboarding");
        if (!el) return;
        el.classList.add("fade-out");
        setTimeout(function () {
            el.remove();
            _visible = false;
            _stopMini();
        }, 600);
    }

    // ── Mini Three.js universe (5 pulsing nodes in a ring) ────────────────
    function _buildMiniUniverse() {
        if (typeof THREE === "undefined") return null;

        var W = 160, H = 100;
        _miniScene = new THREE.Scene();
        _miniCamera = new THREE.PerspectiveCamera(50, W / H, 0.1, 500);
        _miniCamera.position.set(0, 12, 24);
        _miniCamera.lookAt(0, 0, 0);

        _miniRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        _miniRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        _miniRenderer.setSize(W, H);
        _miniRenderer.setClearColor(0x000000, 0);

        _miniScene.add(new THREE.AmbientLight(0x04040f, 3));
        var light = new THREE.PointLight(0x4f8ef7, 2, 100);
        light.position.set(10, 10, 10);
        _miniScene.add(light);

        // 5 nodes in a ring
        var colors = [0x4f8ef7, 0xf7a04f, 0xf74f6a, 0x4ff7a0, 0xb44ff7];
        for (var i = 0; i < 5; i++) {
            var angle = (i / 5) * Math.PI * 2;
            var r = 8;
            var x = Math.cos(angle) * r;
            var z = Math.sin(angle) * r;
            var color = colors[i];

            var sphere = new THREE.Mesh(
                new THREE.SphereGeometry(1.2, 32, 32),
                new THREE.MeshPhongMaterial({
                    color: color,
                    emissive: color,
                    emissiveIntensity: 0.5,
                    shininess: 80,
                })
            );
            sphere.position.set(x, 0, z);
            _miniScene.add(sphere);

            // Glow sprite
            var gCanvas = document.createElement("canvas");
            gCanvas.width = gCanvas.height = 64;
            var ctx = gCanvas.getContext("2d");
            var grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            var hexStr = "#" + color.toString(16).padStart(6, "0");
            grad.addColorStop(0, hexStr + "60");
            grad.addColorStop(0.5, hexStr + "20");
            grad.addColorStop(1, hexStr + "00");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 64, 64);
            var sprite = new THREE.Sprite(
                new THREE.SpriteMaterial({
                    map: new THREE.CanvasTexture(gCanvas),
                    transparent: true,
                    opacity: 0.4,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                })
            );
            sprite.scale.set(5, 5, 1);
            sprite.position.copy(sphere.position);
            _miniScene.add(sprite);

            _miniNodes.push({ mesh: sphere, baseY: 0, phase: i * 1.2 });

            // Edge to next node
            if (i > 0) {
                var prev = _miniNodes[i - 1].mesh.position;
                var curr = sphere.position;
                var lineGeo = new THREE.BufferGeometry().setFromPoints([prev, curr]);
                var line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({
                    color: 0x1e2a4a,
                    transparent: true,
                    opacity: 0.4,
                    blending: THREE.AdditiveBlending,
                }));
                _miniScene.add(line);
            }
        }
        // Close the ring
        var first = _miniNodes[0].mesh.position;
        var last = _miniNodes[4].mesh.position;
        var closeGeo = new THREE.BufferGeometry().setFromPoints([last, first]);
        _miniScene.add(new THREE.Line(closeGeo, new THREE.LineBasicMaterial({
            color: 0x1e2a4a, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending,
        })));

        // Start animation
        _animateMini();

        return _miniRenderer.domElement;
    }

    function _animateMini() {
        _miniRaf = requestAnimationFrame(_animateMini);
        _miniAngle += 0.003;

        // Rotate ring
        for (var i = 0; i < _miniNodes.length; i++) {
            var n = _miniNodes[i];
            var t = _miniAngle * 2 + n.phase;
            n.mesh.position.y = n.baseY + Math.sin(t) * 0.8;
            var s = 1 + Math.sin(t * 0.5) * 0.15;
            n.mesh.scale.setScalar(s);
        }

        // Orbit camera
        _miniCamera.position.x = Math.sin(_miniAngle) * 24;
        _miniCamera.position.z = Math.cos(_miniAngle) * 24;
        _miniCamera.lookAt(0, 0, 0);

        _miniRenderer.render(_miniScene, _miniCamera);
    }

    function _stopMini() {
        if (_miniRaf) cancelAnimationFrame(_miniRaf);
        _miniRaf = null;
        if (_miniRenderer) _miniRenderer.dispose();
        _miniNodes = [];
    }

    // ── Public API ─────────────────────────────────────────────────────────
    window.NeuralGraphOnboarding = {
        show:  _show,
        hide:  _hide,
        check: _check,
    };

})();
