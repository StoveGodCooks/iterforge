"""
Setup pipeline worker — installs Python dependencies and downloads model files.

SSE events emitted:
  step_active  — item install/download starting  {step_id, description}
  step_done    — item completed                  {step_id, output}
  progress     — download progress               {pct, message}
  log          — informational message
  done         — all items finished              {installed, failed}
  error        — fatal failure                   {code, message}
"""
from __future__ import annotations

import asyncio
import subprocess
import sys
import urllib.request
from pathlib import Path

from core.job_manager import Job
from core.sse import (
    EventType, make_event, done_event, log_event,
    step_active_event, step_done_event,
)
from core.config import MODELS_ROOT


# ── Static data (mirrors api/setup.py) ───────────────────────

def _mdir(sub: str) -> str:
    return str(MODELS_ROOT / sub)


PYTHON_DEPS_MAP: dict[str, dict] = {
    "rembg":        {"name": "rembg",       "package": "rembg[gpu]"},
    "vtracer":      {"name": "vtracer",      "package": "vtracer"},
    "open3d":       {"name": "Open3D",       "package": "open3d>=0.18"},
    "trimesh":      {"name": "trimesh",      "package": "trimesh[all]>=4.0"},
    "transformers": {"name": "Transformers", "package": "transformers>=4.35"},
    "diffusers":    {"name": "Diffusers",    "package": "diffusers"},
    "accelerate":   {"name": "Accelerate",   "package": "accelerate"},
    "pillow":       {"name": "Pillow",       "package": "Pillow>=10.0"},
    "numpy":        {"name": "NumPy",        "package": "numpy"},
}

MODELS_MAP: dict[str, dict] = {
    "dreamshaper_xl": {
        "name":     "DreamShaper XL v2.1 (SDXL checkpoint)",
        "filename": "DreamShaperXL_v2_1.safetensors",
        "dest_dir": _mdir("checkpoints"),
        "url":      "https://huggingface.co/Lykon/dreamshaper-xl-v2-turbo/resolve/main/DreamShaperXL_Turbo_v2.safetensors",
        "size_mb":  6800,
    },
    "controlnet_openpose_sdxl": {
        "name":     "ControlNet OpenPose SDXL",
        "filename": "config.json",
        "dest_dir": _mdir("controlnet/openpose-sdxl"),
        "hf_repo":  "thibaud/controlnet-openpose-sdxl-1.0",
        "hf_allow_patterns": [
            "config.json",
            "diffusion_pytorch_model.safetensors",
        ],
        "url":      "https://huggingface.co/thibaud/controlnet-openpose-sdxl-1.0",
        "size_mb":  2500,
    },
}


# ── Public entry point ────────────────────────────────────────

async def run_setup_install(job: Job, params: dict) -> None:
    """
    Install Python packages and download model files.
    params["items"] is a list of dep IDs and/or model IDs.
    """
    items: list[str] = params.get("items", [])
    installed: list[str] = []
    failed:    list[str] = []

    dep_ids   = [i for i in items if i in PYTHON_DEPS_MAP]
    model_ids = [i for i in items if i in MODELS_MAP]

    loop = asyncio.get_running_loop()

    # ── Python packages ───────────────────────────────────────
    for dep_id in dep_ids:
        dep = PYTHON_DEPS_MAP[dep_id]
        await job.push(step_active_event(dep_id, f"pip install {dep['package']}"))
        try:
            out = await asyncio.to_thread(_pip_install, dep["package"])
            await job.push(log_event(out))
            await job.push(step_done_event(dep_id, "installed"))
            installed.append(dep_id)
        except Exception as exc:
            await job.push(log_event(f"Failed: {dep['package']} — {exc}"))
            failed.append(dep_id)

    # ── Model downloads ───────────────────────────────────────
    for model_id in model_ids:
        model     = MODELS_MAP[model_id]
        dest_dir  = Path(model["dest_dir"]).expanduser()
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_path = dest_dir / model["filename"]

        if dest_path.exists():
            await job.push(log_event(f"Already present: {model['name']} — skipping"))
            installed.append(model_id)
            continue

        await job.push(step_active_event(
            model_id,
            f"Downloading {model['name']}  (~{model['size_mb']:,} MB)",
        ))
        try:
            if model.get("hf_repo"):
                await _download_hf_repo(job, model, dest_dir)
            else:
                await _download_with_progress(job, loop, model, dest_path)

            # Multi-file models (some model checkpoints ship alongside config files)
            for extra in model.get("extra_files", []):
                extra_path = dest_dir / extra["filename"]
                if extra_path.exists():
                    await job.push(log_event(
                        f"Already present: {extra['filename']} — skipping"
                    ))
                    continue
                await job.push(log_event(f"Fetching companion file: {extra['filename']}"))
                await _download_with_progress(
                    job, loop,
                    {"name": extra["filename"], "url": extra["url"]},
                    extra_path,
                )

            await job.push(step_done_event(model_id, dest_path.name))
            installed.append(model_id)
        except Exception as exc:
            await job.push(log_event(
                f"Download failed: {model['name']}: {exc}\n"
                f"  Place {model['filename']} manually in {dest_dir}"
            ))
            failed.append(model_id)
            if dest_path.exists():
                dest_path.unlink(missing_ok=True)

    job.result = {"installed": installed, "failed": failed}
    await job.push(done_event(job.result))


# ── Helpers ───────────────────────────────────────────────────

def _pip_install(package: str) -> str:
    """Run pip install in the current interpreter. Raises on failure."""
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "--quiet", package],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        stderr_tail = (result.stderr or "")[-400:].strip()
        raise RuntimeError(stderr_tail or "pip returned non-zero exit code")
    return f"Installed {package}"


async def _download_with_progress(
    job: Job,
    loop: asyncio.AbstractEventLoop,
    model: dict,
    dest_path: Path,
) -> None:
    """
    Stream-download a file and push PROGRESS SSE events every 5%.
    """
    name = model["name"]
    url  = model["url"]

    async def _push_pct(pct: int) -> None:
        await job.push(make_event(EventType.PROGRESS, {
            "pct":     pct,
            "message": f"Downloading {name}… {pct}%",
        }))

    def _download_thread() -> None:
        req = urllib.request.Request(url, headers={"User-Agent": "InterForge/1.0"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            total      = int(resp.headers.get("Content-Length") or 0)
            downloaded = 0
            last_pct   = -1

            with open(dest_path, "wb") as fh:
                while True:
                    chunk = resp.read(65_536)
                    if not chunk:
                        break
                    fh.write(chunk)
                    downloaded += len(chunk)

                    if total > 0:
                        pct = min(99, int(downloaded / total * 100))
                        if pct - last_pct >= 5:
                            last_pct = pct
                            asyncio.run_coroutine_threadsafe(
                                _push_pct(pct), loop
                            )

    await asyncio.to_thread(_download_thread)
    await _push_pct(100)


async def _download_hf_repo(job: Job, model: dict, dest_dir: Path) -> None:
    """
    Snapshot-download a HuggingFace model repo (multi-file, e.g. ControlNet).

    Uses huggingface_hub with allow_patterns so we only pull the weights
    variants we need (fp16 shards + config). No per-file byte progress —
    HF hub handles retries and caching internally — but we emit coarse
    start/done progress for the UI.
    """
    repo        = model["hf_repo"]
    name        = model["name"]
    allow       = model.get("hf_allow_patterns")

    await job.push(make_event(EventType.PROGRESS, {
        "pct": 1, "message": f"Fetching {name} from HuggingFace…",
    }))

    def _snapshot() -> None:
        from huggingface_hub import snapshot_download
        snapshot_download(
            repo_id=repo,
            local_dir=str(dest_dir),
            local_dir_use_symlinks=False,
            allow_patterns=allow,
        )

    await asyncio.to_thread(_snapshot)
    await job.push(make_event(EventType.PROGRESS, {
        "pct": 100, "message": f"Downloaded {name}",
    }))
