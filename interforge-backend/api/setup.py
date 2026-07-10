"""
GET  /api/setup/status   — full environment check
                           (hardware, Python deps, model files)
POST /api/setup/install  — kick off install job → returns {job_id}
                           stream progress via /api/jobs/{job_id}/stream
"""
from __future__ import annotations

import asyncio
import importlib
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.config import MODELS_ROOT
from core.job_manager import create_job, spawn_job
from workers.setup_worker import run_setup_install

router = APIRouter()


# ── Hardware check ────────────────────────────────────────────
def _check_hardware() -> dict:
    try:
        import torch
        if torch.cuda.is_available():
            idx   = torch.cuda.current_device()
            props = torch.cuda.get_device_properties(idx)
            total_gb = props.total_memory / 1024 ** 3
            tier = "high" if total_gb >= 8 else ("mid" if total_gb >= 4 else "low")
            return {
                "gpu_name": props.name,
                "vram_gb":  round(total_gb, 1),
                "tier":     tier,
            }
    except Exception:
        pass

    try:
        import psutil
        vm = psutil.virtual_memory()
        return {
            "gpu_name": "CPU / System RAM",
            "vram_gb":  round(vm.total / 1024 ** 3, 1),
            "tier":     "cpu",
        }
    except Exception:
        return {"gpu_name": "Unknown", "vram_gb": 0.0, "tier": "cpu"}


# ── Python dependency check ───────────────────────────────────
PYTHON_DEPS = [
    {"id": "rembg",        "name": "rembg",       "package": "rembg[gpu]",        "import_name": "rembg"},
    {"id": "vtracer",      "name": "vtracer",      "package": "vtracer",           "import_name": "vtracer"},
    {"id": "open3d",       "name": "Open3D",       "package": "open3d>=0.18",      "import_name": "open3d"},
    {"id": "trimesh",      "name": "trimesh",      "package": "trimesh[all]>=4.0", "import_name": "trimesh"},
    {"id": "transformers", "name": "Transformers", "package": "transformers>=4.35","import_name": "transformers"},
    {"id": "diffusers",    "name": "Diffusers",    "package": "diffusers",         "import_name": "diffusers"},
    {"id": "accelerate",   "name": "Accelerate",   "package": "accelerate",        "import_name": "accelerate"},
    {"id": "pillow",       "name": "Pillow",       "package": "Pillow>=10.0",      "import_name": "PIL"},
    {"id": "numpy",        "name": "NumPy",        "package": "numpy",             "import_name": "numpy"},
]


def _check_python_deps() -> list[dict]:
    results = []
    for dep in PYTHON_DEPS:
        try:
            importlib.import_module(dep["import_name"])
            installed = True
        except Exception:
            installed = False
        results.append({
            "id":        dep["id"],
            "name":      dep["name"],
            "package":   dep["package"],
            "installed": installed,
        })
    return results


# ── Model file check ────────────────────────────────────────

def _models_dir(sub: str) -> str:
    return str(MODELS_ROOT / sub)


REQUIRED_MODELS = [
    {
        # Primary checkpoint — versatile across characters, environments,
        # props, and stylized renders. Used by Prospect (txt2img) and
        # Smelt 2D (IP-Adapter direction generation).
        "id":       "dreamshaper_xl",
        "name":     "DreamShaper XL (optional SDXL checkpoint)",
        "filename": "DreamShaperXL_v2_1.safetensors",  # matches the registry + existing installs
        "dest_dir": _models_dir("checkpoints"),
        "url":      "https://huggingface.co/Lykon/dreamshaper-xl-v2-turbo/resolve/main/DreamShaperXL_Turbo_v2.safetensors",
        "size_mb":  6800,
    },
    {
        # Pose-guided sprite-sheet generation (ControlNet + IP-Adapter).
        # Multi-file HF repo rather than a single safetensors — the setup
        # worker calls huggingface_hub.snapshot_download when "hf_repo" is set.
        "id":       "controlnet_openpose_sdxl",
        "name":     "ControlNet OpenPose SDXL (xinsir)",
        "filename": "config.json",                  # sentinel file used for presence check
        "dest_dir": _models_dir("controlnet/openpose-sdxl"),
        # xinsir has markedly stronger pose adherence than thibaud's — matches
        # the engine's preferred fallback (see inference/engine.py).
        "hf_repo":  "xinsir/controlnet-openpose-sdxl-1.0",
        "hf_allow_patterns": [
            "config.json",
            "diffusion_pytorch_model.safetensors",
        ],
        "url":      "https://huggingface.co/xinsir/controlnet-openpose-sdxl-1.0",
        "size_mb":  2500,
    },
]


def _find_model_on_disk(filename: str, primary_dir: str) -> Path | None:
    """Check the models directory for a required file."""
    p = Path(primary_dir) / filename
    return p if p.exists() else None


def _find_in_hf_cache(hf_repo: str, filename: str) -> Path | None:
    """
    Check the HuggingFace hub cache for a required file.

    HF hub stores snapshots under HF_HOME (or ~/.cache/huggingface/hub) as
    `models--{org}--{name}/snapshots/{revision}/{file}`.  If the pipeline
    auto-downloaded the repo on first use (e.g. ControlNet via diffusers),
    the file exists there even though our own MODELS_ROOT directory is
    empty — so setup status should report it as present.
    """
    hf_home = os.environ.get("HF_HOME") or os.environ.get("HUGGINGFACE_HUB_CACHE")
    candidates = []
    if hf_home:
        candidates.append(Path(hf_home) / "hub")
    candidates.append(Path.home() / ".cache" / "huggingface" / "hub")

    folder_name = "models--" + hf_repo.replace("/", "--")
    for base in candidates:
        repo_dir = base / folder_name / "snapshots"
        if not repo_dir.exists():
            continue
        for snap in repo_dir.iterdir():
            candidate = snap / filename
            if candidate.exists():
                return candidate
    return None


def _check_models() -> list[dict]:
    results = []
    for m in REQUIRED_MODELS:
        found = _find_model_on_disk(m["filename"], m["dest_dir"])
        # Fall back to the HF hub cache — diffusers may have populated it
        # on first use without hitting our MODELS_ROOT path.
        if found is None and m.get("hf_repo"):
            found = _find_in_hf_cache(m["hf_repo"], m["filename"])
        results.append({
            "id":       m["id"],
            "name":     m["name"],
            "filename": m["filename"],
            "size_mb":  m["size_mb"],
            "present":  found is not None,
            "path":     str(found) if found else str(Path(m["dest_dir"]) / m["filename"]),
            "url":      m["url"],
        })
    return results


# ── Routes ────────────────────────────────────────────────────

@router.get("/api/setup/status")
async def get_setup_status():
    """Full environment check — used by the Setup Wizard panel."""
    try:
        hardware = await asyncio.to_thread(_check_hardware)
    except Exception as exc:
        hardware = {"gpu_name": f"Check failed: {exc}", "vram_gb": 0.0, "tier": "cpu"}

    try:
        python_deps = await asyncio.to_thread(_check_python_deps)
    except Exception as exc:
        python_deps = [{"id": "error", "name": f"Dep check failed: {exc}",
                        "package": "", "installed": False}]

    try:
        models = await asyncio.to_thread(_check_models)
    except Exception as exc:
        models = [{"id": "error", "name": f"Model check failed: {exc}",
                   "filename": "", "size_mb": 0, "present": False, "path": "", "url": ""}]

    missing_deps   = sum(1 for d in python_deps   if not d["installed"])
    missing_models = sum(1 for m in models         if not m["present"])

    overall = "ready" if (missing_deps == 0 and missing_models == 0) else "needs_setup"

    return {
        "overall": overall,
        "hardware": hardware,
        "python_deps": python_deps,
        "models":      models,
        "summary": {
            "missing_deps_count":   missing_deps,
            "missing_models_count": missing_models,
        },
    }


class InstallRequest(BaseModel):
    items: list[str]   # dep IDs and/or model IDs to install / download


@router.post("/api/setup/install")
async def start_setup_install(req: InstallRequest):
    """
    Start an install job for the given items.
    Returns job_id — subscribe to /api/jobs/{job_id}/stream for SSE progress.
    """
    if not req.items:
        raise HTTPException(status_code=422, detail="No items to install.")

    job = create_job("setup")

    async def _worker(j):
        await run_setup_install(j, {"items": req.items})

    spawn_job(job, _worker, gpu=False)  # setup installs deps/downloads — no GPU needed
    return {"job_id": job.id, "status": job.status}
