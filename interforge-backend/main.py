"""
InterForge Backend — FastAPI app
Port 7842  (spawned by Tauri shell plugin on app launch)

Architecture:
  /api/status          — subsystem health (backend / GPU / models)
  /api/setup/*         — Phase 8: environment check + installer
  /api/jobs/*          — job lifecycle + SSE stream
  /api/prospect        — concept image generation (SDXL)
  /api/forge           — mesh pipeline (Stable Fast 3D)

All pipeline jobs stream progress via SSE so the frontend can show
real-time step-by-step updates without polling.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

# ── GPU memory management ────────────────────────────────────
# Prevent VRAM fragmentation OOM on 8GB cards.
# Must be set BEFORE torch is imported anywhere.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "max_split_size_mb:128,expandable_segments:True")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api import jobs, prospect, smelt, poses, forge, forge2d, status, masterforge, setup, dev, publish, loras

# Ensure the projects output root exists before mounting
PROJECTS_ROOT = Path.home() / "interforge-projects"
PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)

# ── Logging ───────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="[InterForge] %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

# ── App ───────────────────────────────────────────────────────
app = FastAPI(
    title="InterForge Backend",
    version="0.1.0",
    description="AI-powered game asset pipeline",
    docs_url="/docs",       # Swagger UI at http://127.0.0.1:7842/docs
    redoc_url="/redoc",
)

# Allow the Tauri WebView (and Vite dev server) to reach the API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",    # Vite dev server
        "http://127.0.0.1:1420",
        "tauri://localhost",        # Tauri production WebView
        "https://tauri.localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ────────────────────────────────────────────────────
app.include_router(status.router)
app.include_router(setup.router)
app.include_router(jobs.router)
app.include_router(prospect.router)
app.include_router(smelt.router)
app.include_router(poses.router)
app.include_router(forge.router)
app.include_router(forge2d.router)
app.include_router(masterforge.router)
app.include_router(loras.router)
app.include_router(publish.router)
app.include_router(dev.router)

# Serve generated images as static files.
# e.g. ~/interforge-projects/{job_id}/prospect/image_00.png
#   → http://127.0.0.1:7842/outputs/{job_id}/prospect/image_00.png
app.mount("/outputs", StaticFiles(directory=str(PROJECTS_ROOT)), name="outputs")


@app.on_event("startup")
def _startup_checks():
    """Log GPU/memory config at startup for debugging."""
    try:
        import torch
        if torch.cuda.is_available():
            gpu_name = torch.cuda.get_device_name(0)
            vram_gb = torch.cuda.get_device_properties(0).total_mem / 1024**3
            sdpa = torch.backends.cuda.flash_sdp_enabled()
            logger.info(f"[GPU] {gpu_name} — {vram_gb:.1f}GB VRAM")
            logger.info(f"[GPU] SDPA (flash attention): {'enabled' if sdpa else 'DISABLED'}")
            logger.info(f"[GPU] PYTORCH_CUDA_ALLOC_CONF={os.environ.get('PYTORCH_CUDA_ALLOC_CONF', 'not set')}")
        else:
            logger.warning("[GPU] No CUDA device found — running on CPU")
    except Exception as exc:
        logger.warning(f"[GPU] Startup check failed: {exc}")


@app.get("/")
def root():
    return {"service": "InterForge Backend", "version": "0.1.0", "status": "ok"}


# ── Dev entry point ───────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=7842,
        reload=True,            # hot-reload during development
        log_level="info",
    )
