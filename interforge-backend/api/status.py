"""
GET /api/status

Returns the health of every subsystem InterForge depends on.
The frontend status bar uses this to show the green/yellow/red dot.

Subsystems:
  backend   — this FastAPI process (always "ok" if reachable)
  gpu       — VRAM available (via torch)
  models    — checks for required model checkpoint files on disk
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

import psutil
from fastapi import APIRouter

router = APIRouter()


# ── GPU / VRAM ────────────────────────────────────────────────

def _check_gpu() -> dict:
    try:
        import torch
        if torch.cuda.is_available():
            idx = torch.cuda.current_device()
            total  = torch.cuda.get_device_properties(idx).total_memory
            free   = total - torch.cuda.memory_allocated(idx)
            return {
                "status": "ok",
                "name": torch.cuda.get_device_name(idx),
                "vram_total_gb": round(total / 1024**3, 1),
                "vram_free_gb":  round(free  / 1024**3, 1),
            }
    except Exception:
        pass

    vm = psutil.virtual_memory()
    return {
        "status": "cpu",
        "name": "CPU / System RAM",
        "vram_total_gb": round(vm.total   / 1024**3, 1),
        "vram_free_gb":  round(vm.available / 1024**3, 1),
    }


# ── Models ───────────────────────────────────────────────────
# The model registry is the single source of truth for the default checkpoint
# (see inference/model_registry.py). Status derives its check from whatever the
# registry marks as default, so the three never drift apart again.

def _check_models() -> dict:
    from inference.model_registry import default_model
    from core.config import CHECKPOINTS_DIR

    dm = default_model()

    # hf_repo models (e.g. base SDXL) are fetched + cached by diffusers on first
    # use — there's nothing to pre-install, so report ok.
    if dm.source_type == "hf_repo":
        return {"status": "ok", "missing": [], "default_model": dm.label}

    # local_file models must be present in the checkpoints dir (or pointed at by
    # INTERFORGE_SDXL_CHECKPOINT).
    env_override = os.environ.get("INTERFORGE_SDXL_CHECKPOINT", "")
    candidates = ([Path(env_override)] if env_override else []) + [CHECKPOINTS_DIR / dm.source]
    if any(p.exists() for p in candidates):
        return {"status": "ok", "missing": [], "default_model": dm.label}
    return {"status": "missing", "missing": [dm.label], "default_model": dm.label}


# ── Route ─────────────────────────────────────────────────────

@router.get("/api/status")
async def get_status():
    gpu_info = await asyncio.to_thread(_check_gpu)
    models_info = _check_models()

    overall = "ok"
    if models_info["status"] == "missing":
        overall = "degraded"

    return {
        "overall": overall,
        "backend": {"status": "ok"},
        "gpu":     gpu_info,
        "models":  models_info,
    }
