@echo off
setlocal EnableDelayedExpansion
title InterForge Dev Launcher
color 0A
cd /d "%~dp0"

echo.
echo  =====================================================
echo   InterForge  --  Development Launcher
echo  =====================================================
echo.

:: ── Kill any stale processes on our port ─────────────────────
echo [1/3] Clearing port 7842...
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":7842 "') do (
    taskkill /PID %%p /F >nul 2>&1
)

:: ── Start FastAPI backend ──────────────────────────────────────
echo [2/3] Starting FastAPI backend (direct GPU inference)...
if not exist "interforge-backend\main.py" (
    echo [ERROR] interforge-backend\main.py not found. Are you in the right directory?
    pause
    exit /b 1
)
start "InterForge Backend" /min cmd /c "cd /d ""%~dp0interforge-backend"" && py -3.11 -m uvicorn main:app --host 127.0.0.1 --port 7842 --log-level info 2>&1 | tee backend.log"
echo       Backend starting at http://127.0.0.1:7842

:: ── Wait for backend to be ready ──────────────────────────────
echo [3/3] Waiting for backend...
set /a attempts=0
:wait_loop
    timeout /t 1 /nobreak >nul
    set /a attempts+=1
    curl -s -o nul -w "" http://127.0.0.1:7842/ >nul 2>&1
    if !errorlevel!==0 goto backend_ready
    if !attempts! geq 15 (
        echo       Backend still loading — launching app anyway.
        goto launch_app
    )
    echo       ... (!attempts!s^)
    goto wait_loop

:backend_ready
echo       Backend ready! (!attempts!s^)

:: ── Launch the app ────────────────────────────────────────────
:launch_app
echo.
echo  =====================================================
echo   InterForge is running.
echo   Close this window to stop the backend.
echo  =====================================================
echo.

npm run tauri dev

:: Cleanup on exit
echo.
echo [InterForge] Shutting down...
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":7842 "') do taskkill /PID %%p /F >nul 2>&1
echo [InterForge] Done.
