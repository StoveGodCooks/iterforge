#!/usr/bin/env bash
# InterForge — local dev launcher (Linux / macOS)
#
# Starts the FastAPI backend (port 7842) and the Vite dev server (port 1420).
#   Browser test:  ./run-dev.sh   then open  http://localhost:1420
#   Full desktop:  use  `npm run tauri dev`  instead (spawns its own backend)
#
# Stop everything with Ctrl-C — both processes are cleaned up on exit.
#
# NOTE: 3D inference (SF3D) needs an NVIDIA GPU + CUDA. On macOS the UI runs but
# the CUDA-only inference stack won't (see docs/ROADMAP.md).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/interforge-backend"

# Prefer the backend virtualenv's Python if present, else python3.11, else python3.
if   [ -x "$BACKEND_DIR/.venv/bin/python" ]; then PY="$BACKEND_DIR/.venv/bin/python"
elif command -v python3.11 >/dev/null 2>&1;  then PY="python3.11"
else                                              PY="python3"
fi

echo "Using Python: $PY"

cleanup() {
  echo ""
  echo "Shutting down InterForge…"
  [ -n "${BACKEND_PID:-}" ] && kill "$BACKEND_PID" 2>/dev/null || true
  [ -n "${VITE_PID:-}" ]    && kill "$VITE_PID"    2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting InterForge backend on http://127.0.0.1:7842 …"
( cd "$BACKEND_DIR" && exec "$PY" -m uvicorn main:app --host 127.0.0.1 --port 7842 ) &
BACKEND_PID=$!

echo "Starting Vite dev server on http://localhost:1420 …"
( cd "$ROOT" && exec npm run dev ) &
VITE_PID=$!

echo ""
echo "InterForge launching — open http://localhost:1420 in your browser."
echo "Press Ctrl-C to stop both."

# Block until interrupted (Ctrl-C) or both processes exit; the trap cleans up.
# Plain `wait` (not `wait -n`) keeps this portable to macOS's stock bash 3.2.
wait
