// NeuralGraph — app.js

function initScene() {
    console.log("[NeuralGraph] initScene called");
}

function loadGraph() {
    console.log("[NeuralGraph] loadGraph called");
}

function onMouseMove(event) {
    console.log("[NeuralGraph] onMouseMove called");
}

function onScroll(event) {
    console.log("[NeuralGraph] onScroll called");
}

function openSettings() {
    console.log("[NeuralGraph] openSettings called");
}

function sendChat() {
    console.log("[NeuralGraph] sendChat called");
}

// Wire up events once DOM is ready
document.addEventListener("DOMContentLoaded", function () {
    initScene();
    loadGraph();

    const canvas = document.getElementById("graph-canvas");
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("wheel", onScroll);

    const chatSend = document.getElementById("chat-send");
    chatSend.addEventListener("click", sendChat);

    const chatInput = document.getElementById("chat-input");
    chatInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
            sendChat();
        }
    });
});
