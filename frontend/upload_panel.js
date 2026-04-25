/*
 * upload_panel.js
 * --------------------------------------------------------------------------
 * Connects the upload modal to backend upload + SSE extraction endpoints.
 */

(function () {
    "use strict";

    // =====================================================================
    // DOM references
    // =====================================================================

    var uploadModal = document.getElementById("upload-modal");
    var modalSubmit = document.getElementById("modal-submit");
    var modalClose = document.getElementById("modal-close");
    var modalCancel = document.getElementById("modal-cancel");
    var modalBody = uploadModal ? uploadModal.querySelector(".modal-body") : null;

    var fileInput = document.getElementById("file-input");
    var pasteInput = document.getElementById("paste-input");
    var dropZone = document.getElementById("drop-zone");

    if (!uploadModal || !modalSubmit || !modalBody || !fileInput || !pasteInput || !dropZone) {
        return;
    }

    // =====================================================================
    // UI wiring: progress + errors + toast
    // =====================================================================

    var ui = buildProgressUi();
    var eventSource = null;

    injectStyles();

    function buildProgressUi() {
        var wrapper = document.createElement("div");
        wrapper.className = "ng-upload-progress";
        wrapper.innerHTML =
            "<div class='ng-upload-status-row'>" +
                "<span id='ng-upload-status'>Waiting for input...</span>" +
                "<span id='ng-upload-percent'>0%</span>" +
            "</div>" +
            "<div class='ng-upload-bar'>" +
                "<div id='ng-upload-bar-fill' class='ng-upload-bar-fill'></div>" +
            "</div>" +
            "<div id='ng-upload-error' class='ng-upload-error'></div>";

        modalBody.appendChild(wrapper);

        return {
            status: wrapper.querySelector("#ng-upload-status"),
            percent: wrapper.querySelector("#ng-upload-percent"),
            fill: wrapper.querySelector("#ng-upload-bar-fill"),
            error: wrapper.querySelector("#ng-upload-error"),
        };
    }

    function injectStyles() {
        var style = document.createElement("style");
        style.textContent =
            ".ng-upload-progress{margin-top:12px;display:flex;flex-direction:column;gap:8px}" +
            ".ng-upload-status-row{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#e2e2f0}" +
            ".ng-upload-bar{position:relative;width:100%;height:8px;border-radius:999px;background:#1e1e2e;overflow:hidden}" +
            ".ng-upload-bar-fill{height:100%;width:0%;background:#4f8ef7;transition:width .28s ease, background-color .22s ease}" +
            ".ng-upload-error{min-height:15px;font-size:11px;color:#f74f6a}" +
            ".ng-upload-toast{position:fixed;right:18px;bottom:18px;z-index:9999;display:flex;align-items:center;gap:8px;padding:10px 12px;background:#0d0d18;border:1px solid #1e1e2e;border-radius:8px;color:#e2e2f0;font:12px 'IBM Plex Mono', monospace;opacity:0;transform:translateY(16px);transition:opacity .22s ease, transform .22s ease}" +
            ".ng-upload-toast.show{opacity:1;transform:translateY(0)}" +
            ".ng-upload-toast-icon{font-weight:700}" +
            ".ng-upload-toast.success .ng-upload-toast-icon{color:#4ff7a0}" +
            ".ng-upload-toast.error .ng-upload-toast-icon{color:#f74f6a}";
        document.head.appendChild(style);
    }

    function showToast(message, kind) {
        var toast = document.createElement("div");
        toast.className = "ng-upload-toast " + (kind === "error" ? "error" : "success");

        var icon = kind === "error" ? "✕" : "✓";
        toast.innerHTML =
            "<span class='ng-upload-toast-icon'>" + icon + "</span>" +
            "<span>" + escapeHtml(message) + "</span>";

        document.body.appendChild(toast);
        requestAnimationFrame(function () {
            toast.classList.add("show");
        });

        setTimeout(function () {
            toast.classList.remove("show");
            setTimeout(function () {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 250);
        }, 4000);
    }

    function setProgress(percent, statusText, state) {
        var clamped = Math.max(0, Math.min(100, Number(percent) || 0));
        ui.percent.textContent = String(clamped) + "%";
        ui.fill.style.width = String(clamped) + "%";
        if (statusText) {
            ui.status.textContent = statusText;
        }

        if (state === "complete") {
            ui.fill.style.background = "#4ff7a0";
        } else if (state === "error") {
            ui.fill.style.background = "#f74f6a";
        } else {
            ui.fill.style.background = "#4f8ef7";
        }
    }

    function setError(message) {
        ui.error.textContent = message || "";
    }

    function resetProgress() {
        setError("");
        setProgress(0, "Waiting for input...", "idle");
    }

    function disableUi(disabled) {
        modalSubmit.disabled = disabled;
        modalClose.disabled = disabled;
        modalCancel.disabled = disabled;
        fileInput.disabled = disabled;
        pasteInput.disabled = disabled;
    }

    function closeSse() {
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
    }

    // =====================================================================
    // API calls
    // =====================================================================

    async function uploadSource() {
        var hasFile = fileInput.files && fileInput.files.length > 0;
        var hasText = pasteInput.value.trim().length > 0;

        if (!hasFile && !hasText) {
            throw new Error("Please select a file or paste text before continuing.");
        }

        var form = new FormData();
        if (hasFile) {
            form.append("file", fileInput.files[0]);
        } else {
            form.append("text", pasteInput.value.trim());
        }

        var response = await fetch("/graph/upload", {
            method: "POST",
            body: form,
        });

        var data = await response.json().catch(function () {
            return {};
        });

        if (!response.ok) {
            throw new Error(data.detail || "Upload failed.");
        }

        return data;
    }

    function runExtractionStream(fileId) {
        return new Promise(function (resolve, reject) {
            var url = "/graph/extract/stream?mode=append&file_id=" + encodeURIComponent(fileId);
            eventSource = new EventSource(url);

            eventSource.onmessage = function (evt) {
                var payload = {};
                try {
                    payload = JSON.parse(evt.data || "{}");
                } catch (_err) {
                    payload = {};
                }

                if (payload.step === "error") {
                    closeSse();
                    setProgress(payload.progress || 0, payload.message || "Extraction failed", "error");
                    reject(new Error(payload.message || "Extraction failed"));
                    return;
                }

                setProgress(payload.progress || 0, payload.message || "Working...", payload.step);

                if (payload.step === "complete") {
                    closeSse();
                    resolve(payload.result || {});
                }
            };

            eventSource.onerror = function () {
                closeSse();
                reject(new Error("Live progress connection failed."));
            };
        });
    }

    // =====================================================================
    // Main submit handler
    // =====================================================================

    async function handleSubmitClick(event) {
        // Run before legacy listener and prevent it from force-closing the modal.
        event.preventDefault();
        event.stopImmediatePropagation();

        resetProgress();
        disableUi(true);

        try {
            setProgress(3, "Uploading source...", "working");
            var uploadResult = await uploadSource();

            setProgress(8, "Preparing extraction...", "working");
            var extractionResult = await runExtractionStream(uploadResult.file_id);

            var nodesAdded = Number(extractionResult.nodes_added || 0);
            var edgesAdded = Number(extractionResult.edges_added || 0);

            if (
                window.NeuralGraph &&
                typeof window.NeuralGraph.loadData === "function" &&
                extractionResult.graph
            ) {
                window.NeuralGraph.loadData(extractionResult.graph);
            }

            showToast(
                "Network updated - " + nodesAdded + " nodes, " + edgesAdded + " edges added",
                "success"
            );

            setProgress(100, "Done!", "complete");
            uploadModal.classList.remove("active");
            pasteInput.value = "";
            fileInput.value = "";
            dropZone.querySelector(".drop-zone-text").textContent = "Drag & drop files here or click to browse";
        } catch (err) {
            setError(err && err.message ? err.message : "Upload or extraction failed.");
            setProgress(100, "Error", "error");
            showToast(err && err.message ? err.message : "Upload failed", "error");
        } finally {
            disableUi(false);
        }
    }

    // Capture phase ensures this listener runs before older inline listeners.
    modalSubmit.addEventListener("click", handleSubmitClick, true);

    // Reset progress when modal closes.
    function resetOnClose() {
        closeSse();
        resetProgress();
        setError("");
    }

    modalClose.addEventListener("click", resetOnClose);
    modalCancel.addEventListener("click", resetOnClose);
    uploadModal.addEventListener("click", function (evt) {
        if (evt.target === uploadModal) {
            resetOnClose();
        }
    });

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
})();
