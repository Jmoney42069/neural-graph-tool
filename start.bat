@echo off
cd /d "%~dp0"
start "" /B ".\.venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8000
timeout /t 2 /nobreak >nul
npm run dev
