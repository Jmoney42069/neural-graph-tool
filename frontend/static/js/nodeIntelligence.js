/*!
 * nodeIntelligence.js — Node Intelligence Engine (Frontend)
 * window.NodeIntelligence = { analyzeGraph, applyAll, applyHealthVisualization, getMetrics }
 */
(function () {
    "use strict";

    var _metrics = {};   // nodeId → { in_degree, out_degree, betweenness, role, health }

    // ── Analyse de graph lokaal (snelle approximatie voor directe feedback) ──
    function analyzeGraph(graphData) {
        var nodes = (graphData && graphData.nodes) || (window.NeuralGraph ? window.NeuralGraph.getAllNodes() : []);
        var edges = (graphData && graphData.edges) || (window.NeuralGraph ? window.NeuralGraph.getAllEdges() : []);

        // Bouw adjacency
        var adjOut = {}, adjIn = {};
        nodes.forEach(function (n) { adjOut[n.id] = []; adjIn[n.id] = []; });
        edges.forEach(function (e) {
            if (e.type === "feedback") return;
            if (adjOut[e.from]) adjOut[e.from].push(e.to);
            if (adjIn[e.to])   adjIn[e.to].push(e.from);
        });

        _metrics = {};
        nodes.forEach(function (n) {
            var nid    = n.id;
            var outD   = (adjOut[nid] || []).length;
            var inD    = (adjIn[nid] || []).length;
            var role   = n.role || _inferRole(nid, inD, outD, n.category);
            var health = n.health != null ? n.health : _inferHealth(inD, outD, role);

            _metrics[nid] = {
                id:          nid,
                in_degree:   inD,
                out_degree:  outD,
                betweenness: 0,  // Wordt server-side berekend
                role:        role,
                health:      health,
                is_isolated: inD === 0 && outD === 0,
            };
        });

        // Vraag ook server-side metrics op
        _fetchServerMetrics();

        return _metrics;
    }

    function _inferRole(nid, inD, outD, cat) {
        if (inD === 0) return "start";
        if (outD === 0) return "end";
        if (inD >= 3 || outD >= 3) return "bottleneck";
        if (outD >= 2) return "hub";
        return "normal";
    }

    function _inferHealth(inD, outD, role) {
        if (inD === 0 && outD === 0) return 30;
        if (role === "bottleneck")    return 65;
        if (role === "start" || role === "end") return 80;
        return 100;
    }

    function _fetchServerMetrics() {
        fetch("/api/intelligence/analyze", { method: "POST" })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (!data || !data.metrics) return;
                Object.assign(_metrics, data.metrics);
                _applyHealthColors();
            })
            .catch(function () {});
    }

    // ── Visuele health overlay op de 3D nodes ──
    function applyHealthVisualization() {
        _applyHealthColors();
    }

    function _applyHealthColors() {
        if (!window.NeuralGraph) return;
        var allNodes = window.NeuralGraph.getAllNodes();
        allNodes.forEach(function (n) {
            var m = _metrics[n.id];
            if (!m) return;
            var h = m.health;
            var color = h >= 90 ? 0x00ff88
                      : h >= 70 ? 0xffcc00
                      : h >= 50 ? 0xff8800
                      : 0xff3333;
            if (window.NeuralGraph.setNodeColor) {
                window.NeuralGraph.setNodeColor(n.id, color);
            }
        });
    }

    // ── Pas alle intelligence toe (roles, health, kleuren) ──
    function applyAll() {
        _applyHealthColors();
        // Markeer bottleneck nodes met speciaal pictogram indien beschikbaar
        if (window.NeuralGraph && window.NeuralGraph.getAllNodes) {
            window.NeuralGraph.getAllNodes().forEach(function (n) {
                var m = _metrics[n.id];
                if (m && m.role === "bottleneck" && window.NeuralGraph.setNodeBadge) {
                    window.NeuralGraph.setNodeBadge(n.id, "bottleneck");
                }
            });
        }
    }

    function getMetrics(nodeId) {
        return nodeId ? _metrics[nodeId] : _metrics;
    }

    function determineRole(node) {
        var m = _metrics[node.id];
        return m ? m.role : (node.role || "normal");
    }

    function calculateHealth(node) {
        var m = _metrics[node.id];
        return m ? m.health : (node.health != null ? node.health : 100);
    }

    window.NodeIntelligence = {
        analyzeGraph:              analyzeGraph,
        applyHealthVisualization:  applyHealthVisualization,
        applyAll:                  applyAll,
        getMetrics:                getMetrics,
        determineRole:             determineRole,
        calculateHealth:           calculateHealth,
    };

})();
