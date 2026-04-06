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

_APPDATA = os.environ.get("APPDATA", str(Path.home()))
_CKPT = "Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors"

_REQUIRED_MODELS: list[dict] = [
    {
        "name": "Juggernaut XL v9 (SDXL checkpoint)",
        "env_key": "INTERFORGE_SDXL_CHECKPOINT",
        "default_paths": [
            f"{_APPDATA}/IterForge/models/checkpoints/{_CKPT}",
        ],
    },
]


def _check_models() -> dict:
    missing = []
    for spec in _REQUIRED_MODELS:
        path_str = os.environ.get(spec["env_key"], "")
        candidates = [Path(path_str)] if path_str else []
        candidates += [Path(p).expanduser() for p in spec["default_paths"]]
        found = any(p.exists() for p in candidates)
        if not found:
            missing.append(spec["name"])

    if missing:
        return {"status": "missing", "missing": missing}
    return {"status": "ok", "missing": []}


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
