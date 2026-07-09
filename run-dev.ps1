# InterForge — local dev launcher
# Starts the FastAPI backend (port 7842) and the Vite dev server (port 1420),
# each in its own PowerShell window so you can watch the logs.
#
#   Browser test:  run this, then open  http://localhost:1420
#   Full desktop:  use  `npm run tauri dev`  instead (spawns its own backend)
#
# Stop everything by closing the two spawned windows.

$root = $PSScriptRoot

Write-Host "Starting InterForge backend on http://127.0.0.1:7842 ..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$root\interforge-backend'; py -3.11 -m uvicorn main:app --host 127.0.0.1 --port 7842"
)

Write-Host "Starting Vite dev server on http://localhost:1420 ..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$root'; npm run dev"
)

Write-Host ""
Write-Host "InterForge launching — open http://localhost:1420 in your browser." -ForegroundColor Green
