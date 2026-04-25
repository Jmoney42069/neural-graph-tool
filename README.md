# NeuralGraph

A professional AI-powered knowledge graph visualizer. Upload company data (text, PDF, CSV) and an AI converts it into an interactive 3D neural network of connected nodes and edges. Chat with the AI to query the graph.

Runs 100% locally — no cloud hosting required.

## Prerequisites

- Python 3.11 or newer
- A modern web browser (Chrome, Edge, Firefox)

## Setup

1. **Install dependencies**

```bash
pip install -r requirements.txt
```

2. **Run the server**

```bash
uvicorn main:app --reload --port 8000
```

3. **Open in browser**

Navigate to [http://localhost:8000](http://localhost:8000)

The frontend is served automatically by FastAPI. The health check is available at [http://localhost:8000/health](http://localhost:8000/health).

## Project Structure

```
├── main.py              # FastAPI application entry point
├── requirements.txt     # Python dependencies
├── routes/
│   ├── graph.py         # Graph extract / load / save endpoints
│   ├── chat.py          # AI chat query endpoint
│   └── settings.py      # Settings save / load endpoints
├── frontend/
│   ├── index.html       # HTML shell
│   ├── style.css        # Dark theme styles
│   └── app.js           # Client-side JavaScript
└── data/
    └── graph.json       # Local graph data store
```
