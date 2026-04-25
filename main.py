from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routes.graph import router as graph_router
from routes.chat import router as chat_router
from routes.settings import router as settings_router
from routes.query_chat import router as query_router
from routes.intelligence import router as intelligence_router
from routes.kpi import router as kpi_router
from routes.measurements import router as measurements_router
from routes.trends import router as trends_router
from routes.bottleneck import router as bottleneck_router
from routes.recommendations import router as recommendations_router
from routes.memory import router as memory_router

app = FastAPI(title="NeuralGraph", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(graph_router)
app.include_router(chat_router)
app.include_router(settings_router)
app.include_router(query_router)
app.include_router(intelligence_router)
app.include_router(kpi_router)
app.include_router(measurements_router)
app.include_router(trends_router)
app.include_router(bottleneck_router)
app.include_router(recommendations_router)
app.include_router(memory_router)


@app.get("/health")
async def health():
    return {"status": "ok", "app": "NeuralGraph"}


app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
