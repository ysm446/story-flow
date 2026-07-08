@echo off
setlocal
cd /d "%~dp0"

echo === Story Flow ===

rem Prefer the py launcher (the "python" command may be a Windows Store stub)
set "PY_CMD=py"
where py >nul 2>nul
if errorlevel 1 set "PY_CMD=python"

rem --- Python venv (first run only: create + install deps) ---
if not exist ".venv\Scripts\python.exe" (
    echo [setup] Creating .venv ...
    %PY_CMD% -m venv .venv
    if errorlevel 1 (
        echo [error] Failed to create venv. Check that Python is installed.
        pause
        exit /b 1
    )
    echo [setup] Installing Python dependencies ...
    ".venv\Scripts\python.exe" -m pip install --upgrade pip
    ".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
    if errorlevel 1 (
        echo [error] pip install failed.
        pause
        exit /b 1
    )
)

rem --- Node dependencies (first run only) ---
if not exist "node_modules" (
    echo [setup] Running npm install ...
    call npm install
    if errorlevel 1 (
        echo [error] npm install failed. Check that Node.js is installed.
        pause
        exit /b 1
    )
)

rem --- Launch the app (FastAPI is started by the Electron main process) ---
echo [run] Starting the app ...
call npm run dev

endlocal
