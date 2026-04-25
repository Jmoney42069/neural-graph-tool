@echo off
REM FILE: scripts\build-backend.bat
REM DOES: Compiles the FastAPI backend into a standalone .exe via PyInstaller
REM USES: pyinstaller, Python 3.11+
REM EXPOSES: backend-dist\neuralgraph-server.exe

echo === Building NeuralGraph backend (Windows) ===

if exist backend-dist rmdir /s /q backend-dist
if exist build\pyinstaller rmdir /s /q build\pyinstaller

pyinstaller --onefile ^
  --name neuralgraph-server ^
  --distpath backend-dist ^
  --workpath build\pyinstaller ^
  --specpath build\pyinstaller ^
  --paths . ^
  --add-data "frontend;frontend" ^
  --add-data "data;data" ^
  --hidden-import uvicorn.logging ^
  --hidden-import uvicorn.loops ^
  --hidden-import uvicorn.loops.auto ^
  --hidden-import uvicorn.protocols ^
  --hidden-import uvicorn.protocols.http ^
  --hidden-import uvicorn.protocols.http.auto ^
  --hidden-import uvicorn.protocols.http.h11_impl ^
  --hidden-import uvicorn.protocols.http.httptools_impl ^
  --hidden-import uvicorn.protocols.websockets ^
  --hidden-import uvicorn.protocols.websockets.auto ^
  --hidden-import uvicorn.protocols.websockets.websockets_impl ^
  --hidden-import uvicorn.lifespan ^
  --hidden-import uvicorn.lifespan.on ^
  --hidden-import uvicorn.lifespan.off ^
  scripts\server_entry.py

echo === Done === backend-dist\neuralgraph-server.exe ===
