"""
InterForge Dev Tools API — /dev/*

Exposes diagnostic, profiling, and testing endpoints.
Only intended for local development — no auth, no rate limiting.

Endpoints:
  GET  /dev/jobs                — list all job folders with metadata
  GET  /dev/job/{job_id}        — job detail, file listing, profile data
  GET  /dev/profile/{job_id}    — raw timing profile JSON
  GET  /dev/health              — system health: Python packages, GPU, disk
  POST /dev/tests/run           — run pytest, stream stdout as SSE
  GET  /dev/mesh-stats/{job_id} — triangle count, manifold status, bounding box
  GET  /dev/config              — current runtime config values
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from core.config import PROJECTS_ROOT, OUTPUTS_URL, BACKEND_HOST, BACKEND_PORT
from core.paths import is_valid_job_id

router = APIRouter(prefix="/dev", tags=["dev"])


def _require_valid_job_id(job_id: str) -> None:
    """Reject path-traversal / malformed job ids before they touch the FS."""
    if not is_valid_job_id(job_id):
        raise HTTPException(422, f"Invalid job id: {job_id!r}")


# ── Helpers ──────────────────────────────────────────────────────

def _job_dirs() -> list[Path]:
    """Return all job directories sorted newest-first (by mtime)."""
    if not PROJECTS_ROOT.exists():
        return []
    dirs = [d for d in PROJECTS_ROOT.iterdir() if d.is_dir()]
    return sorted(dirs, key=lambda d: d.stat().st_mtime, reverse=True)


def _job_meta(job_dir: Path) -> dict:
    """Summarise a job directory — stage, route, files, profile, timestamp."""
    stages = []
    files  = {}

    for stage in ("prospect", "smelt", "forge"):
        stage_dir = job_dir / stage
        if not stage_dir.exists():
            continue
        stages.append(stage)
        stage_files = [f.name for f in stage_dir.iterdir() if f.is_file()]
        files[stage] = stage_files

    profile_path = None
    profile_data = None
    for stage in ("forge", "smelt", "prospect"):
        p = job_dir / stage / f"profile_{job_dir.name}.json"
        if p.exists():
            profile_path = str(p)
            try:
                profile_data = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                pass
            break

    # Try to read project.json for metadata
    project_json = None
    pj = job_dir / "forge" / "project.json"
    if pj.exists():
        try:
            project_json = json.loads(pj.read_text(encoding="utf-8"))
        except Exception:
            pass

    mtime = job_dir.stat().st_mtime
    return {
        "job_id":       job_dir.name,
        "stages":       stages,
        "files":        files,
        "profile":      profile_data,
        "project_json": project_json,
        "modified_at":  mtime,
        "modified_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(mtime)),
    }


# ── Job browser ──────────────────────────────────────────────────

@router.get("/jobs")
def list_jobs(limit: int = 50):
    """List all job directories, newest-first, with summary metadata."""
    dirs  = _job_dirs()[:limit]
    items = []
    for d in dirs:
        try:
            items.append(_job_meta(d))
        except Exception as exc:
            items.append({"job_id": d.name, "error": str(exc)})
    return {"jobs": items, "total": len(_job_dirs())}


@router.get("/job/{job_id}")
def get_job(job_id: str):
    """Full detail for one job including file sizes and profile data."""
    _require_valid_job_id(job_id)
    job_dir = PROJECTS_ROOT / job_id
    if not job_dir.exists():
        raise HTTPException(404, f"Job not found: {job_id}")

    meta = _job_meta(job_dir)

    # Add file sizes
    file_sizes: dict[str, dict[str, int]] = {}
    for stage, file_list in meta["files"].items():
        file_sizes[stage] = {}
        for fname in file_list:
            fp = job_dir / stage / fname
            if fp.exists():
                file_sizes[stage][fname] = fp.stat().st_size

    meta["file_sizes"] = file_sizes
    return meta


# ── Profile ──────────────────────────────────────────────────────

@router.get("/profile/{job_id}")
def get_profile(job_id: str):
    """Return raw profiler JSON for a job, or 404 if not yet generated."""
    _require_valid_job_id(job_id)
    for stage in ("forge", "smelt", "prospect"):
        p = PROJECTS_ROOT / job_id / stage / f"profile_{job_id}.json"
        if p.exists():
            return JSONResponse(content=json.loads(p.read_text(encoding="utf-8")))
    raise HTTPException(404, f"No profile found for job {job_id}")


# ── System health ─────────────────────────────────────────────────

@router.get("/health")
async def system_health():
    """
    Check:
    - Python version + key package versions
    - GPU availability (via torch)
    - PROJECTS_ROOT disk space
    """
    import importlib

    packages = [
        "open3d", "trimesh", "numpy", "scipy", "skimage",
        "PIL", "fastapi", "uvicorn",
        "torch", "cadquery", "fast_simplification",
        "diffusers", "transformers", "accelerate",
        "rembg", "vtracer",
    ]
    pkg_versions: dict[str, str] = {}
    for pkg in packages:
        try:
            mod = importlib.import_module(pkg)
            pkg_versions[pkg] = getattr(mod, "__version__", "installed (no version attr)")
        except ImportError:
            pkg_versions[pkg] = "NOT INSTALLED"

    # GPU
    gpu_info: dict = {}
    try:
        import torch
        gpu_info["cuda_available"] = torch.cuda.is_available()
        if torch.cuda.is_available():
            gpu_info["device_name"] = torch.cuda.get_device_name(0)
            gpu_info["vram_gb"] = round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1)
    except ImportError:
        gpu_info["torch"] = "not installed"

    # Disk
    import shutil as _shutil
    disk = _shutil.disk_usage(str(PROJECTS_ROOT))
    disk_info = {
        "total_gb":  round(disk.total / 1e9, 1),
        "used_gb":   round(disk.used  / 1e9, 1),
        "free_gb":   round(disk.free  / 1e9, 1),
    }

    return {
        "python":      sys.version,
        "packages":    pkg_versions,
        "gpu":         gpu_info,
        "disk":        disk_info,
        "projects_root": str(PROJECTS_ROOT),
        "backend_url": f"http://{BACKEND_HOST}:{BACKEND_PORT}",
    }


# ── Test runner ──────────────────────────────────────────────────

@router.post("/tests/run")
async def run_tests(path: str = "tests/", args: str = "-v --tb=short"):
    """
    Run pytest and stream output as SSE.
    path: test file or directory (relative to backend root, confined to it)
    args: extra pytest flags

    Spawns a subprocess with caller-supplied arguments, so it is gated behind
    the INTERFORGE_ENABLE_TEST_RUNNER env flag and disabled by default.
    """
    if os.environ.get("INTERFORGE_ENABLE_TEST_RUNNER", "").lower() not in ("1", "true", "yes"):
        raise HTTPException(
            403,
            "Test runner is disabled. Set INTERFORGE_ENABLE_TEST_RUNNER=1 to enable it.",
        )

    backend_root = Path(__file__).parent.parent
    # Confine `path` to the backend root — reject anything that resolves outside.
    target = (backend_root / path).resolve()
    if not target.is_relative_to(backend_root.resolve()):
        raise HTTPException(422, "path must stay within the backend directory")

    cmd = [sys.executable, "-m", "pytest", str(target)] + args.split()

    async def _stream() -> AsyncIterator[str]:
        yield f"data: {json.dumps({'type': 'start', 'cmd': ' '.join(cmd)})}\n\n"
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(backend_root),
            )
            assert proc.stdout is not None
            async for raw in proc.stdout:
                line = raw.decode(errors="replace").rstrip()
                yield f"data: {json.dumps({'type': 'line', 'text': line})}\n\n"
            await proc.wait()
            yield f"data: {json.dumps({'type': 'done', 'returncode': proc.returncode})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream")


# ── Mesh stats ───────────────────────────────────────────────────

@router.get("/mesh-stats/{job_id}")
def mesh_stats(job_id: str):
    """
    Load the forge mesh (mesh_raw.ply → mesh_repaired.ply → asset.glb)
    and return triangle count, vertex count, manifold status, bounding box.
    """
    _require_valid_job_id(job_id)
    forge_dir = PROJECTS_ROOT / job_id / "forge"
    if not forge_dir.exists():
        raise HTTPException(404, f"No forge output for job {job_id}")

    # Prefer the most-processed PLY, fall back to GLB
    candidates = [
        forge_dir / "mesh_repaired.ply",
        forge_dir / "mesh_decimated.ply",
        forge_dir / "mesh_raw.ply",
        forge_dir / "mesh_raw_fallback.ply",
        forge_dir / "asset.glb",
    ]
    mesh_path = next((p for p in candidates if p.exists()), None)
    if not mesh_path:
        raise HTTPException(404, f"No mesh file found for job {job_id}")

    try:
        import trimesh
        mesh = trimesh.load(str(mesh_path))
        if isinstance(mesh, trimesh.Scene):
            mesh = trimesh.util.concatenate(list(mesh.geometry.values()))

        bb = mesh.bounds
        return {
            "job_id":        job_id,
            "mesh_file":     mesh_path.name,
            "vertices":      len(mesh.vertices),
            "faces":         len(mesh.faces),
            "is_watertight": bool(mesh.is_watertight),
            "is_winding_consistent": bool(mesh.is_winding_consistent),
            "bounding_box": {
                "min": bb[0].tolist() if bb is not None else None,
                "max": bb[1].tolist() if bb is not None else None,
            },
            "volume":        float(mesh.volume) if mesh.is_watertight else None,
            "surface_area":  float(mesh.area),
        }
    except Exception as exc:
        raise HTTPException(500, f"Mesh load failed: {exc}")


# ── E2E Profile ─────────────────────────────────────────────────

@router.get("/e2e-profile/{forge_job_id}")
def e2e_profile(forge_job_id: str):
    """
    Stitch together prospect + smelt + forge profiles into one end-to-end
    timing report for the full pipeline run.
    """
    forge_dir = PROJECTS_ROOT / forge_job_id / "forge"
    if not forge_dir.exists():
        raise HTTPException(404, f"No forge output for job {forge_job_id}")

    pj = forge_dir / "project.json"
    if not pj.exists():
        raise HTTPException(404, "project.json missing — run forge first")

    try:
        project = json.loads(pj.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(500, f"project.json unreadable: {exc}")

    prospect_job_id = project.get("prospect_job_id", "")
    smelt_job_id    = project.get("smelt_job_id", "")

    stages: list[dict] = []
    total_ms = 0.0

    # ── Prospect ──────────────────────────────────────────────
    if prospect_job_id:
        p = PROJECTS_ROOT / prospect_job_id / "prospect" / f"profile_{prospect_job_id}.json"
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                stages.append({
                    "stage":      "prospect",
                    "job_id":     prospect_job_id,
                    "route":      data.get("route", "PROSPECT"),
                    "total_ms":   data.get("total_ms", 0),
                    "sections":   data.get("sections", []),
                    "bottlenecks": data.get("bottlenecks", []),
                })
                total_ms += data.get("total_ms", 0)
            except Exception:
                pass
        else:
            stages.append({"stage": "prospect", "job_id": prospect_job_id, "note": "profile not found"})

    # ── Smelt (single Zero123++ job) ─────────────────────────
    if smelt_job_id:
        p = PROJECTS_ROOT / smelt_job_id / "smelt" / "multiview" / f"profile_{smelt_job_id}.json"
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                stages.append({
                    "stage":      "smelt",
                    "job_id":     smelt_job_id,
                    "route":      data.get("route", "SMELT_ZERO123"),
                    "total_ms":   data.get("total_ms", 0),
                    "sections":   data.get("sections", []),
                    "bottlenecks": data.get("bottlenecks", []),
                })
                total_ms += data.get("total_ms", 0)
            except Exception:
                pass
        else:
            stages.append({"stage": "smelt", "job_id": smelt_job_id, "note": "profile not found"})

    # ── Forge ─────────────────────────────────────────────────
    p = forge_dir / f"profile_{forge_job_id}.json"
    if p.exists():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            stages.append({
                "stage":      "forge",
                "job_id":     forge_job_id,
                "route":      data.get("route", ""),
                "total_ms":   data.get("total_ms", 0),
                "sections":   data.get("sections", []),
                "bottlenecks": data.get("bottlenecks", []),
            })
            total_ms += data.get("total_ms", 0)
        except Exception:
            pass
    else:
        stages.append({"stage": "forge", "job_id": forge_job_id, "note": "profile not found"})

    # ── Top bottlenecks across all stages ─────────────────────
    all_sections: list[dict] = []
    for stage in stages:
        prefix = stage.get("stage", "?")
        for sec in stage.get("sections", []):
            all_sections.append({**sec, "stage": prefix,
                                  "section": f"{prefix}.{sec['section']}"})
        for view in stage.get("views", []):
            for sec in view.get("sections", []):
                all_sections.append({**sec, "stage": f"smelt.{view['angle']}",
                                      "section": f"smelt.{view['angle']}.{sec['section']}"})

    all_sections.sort(key=lambda s: s.get("duration_ms", 0), reverse=True)
    bottlenecks = [
        {
            "section":     s["section"],
            "label":       s.get("label", ""),
            "duration_ms": round(s.get("duration_ms", 0), 2),
            "duration_s":  round(s.get("duration_ms", 0) / 1000, 2),
            "pct_total":   round(s.get("duration_ms", 0) / total_ms * 100, 1) if total_ms > 0 else 0,
        }
        for s in all_sections[:10]
    ]

    return {
        "forge_job_id": forge_job_id,
        "total_ms":     round(total_ms, 2),
        "total_s":      round(total_ms / 1000, 2),
        "total_min":    round(total_ms / 60000, 2),
        "stages":       stages,
        "bottlenecks":  bottlenecks,
    }


# ── Config ───────────────────────────────────────────────────────

@router.get("/config")
def get_config():
    """Return current runtime configuration values."""
    return {
        "PROJECTS_ROOT":    str(PROJECTS_ROOT),
        "OUTPUTS_URL":      OUTPUTS_URL,
        "BACKEND_HOST":     BACKEND_HOST,
        "BACKEND_PORT":     BACKEND_PORT,
        "env_overrides": {
            k: v for k, v in os.environ.items()
            if k.startswith("INTERFORGE_")
        },
    }


# ── Active in-memory jobs (for SSE Monitor) ───────────────────────

@router.get("/active-jobs")
def active_jobs():
    """
    Return all in-memory jobs (running + recently completed).
    Used by the Live SSE Monitor to know which job IDs to subscribe to.
    """
    from core.job_manager import list_jobs as _list_jobs_mem
    jobs = _list_jobs_mem()
    return {
        "jobs": [
            {
                "job_id":     j.id,
                "stage":      j.stage,
                "status":     j.status.value,
                "error_code": j.error_code,
            }
            for j in sorted(jobs, key=lambda j: j.id, reverse=True)
        ]
    }


# ── Loft debug ────────────────────────────────────────────────────

@router.get("/loft-debug/{forge_job_id}")
def loft_debug(forge_job_id: str):
    """
    Return loft_debug.json for a forge job.
    """
    forge_dir = PROJECTS_ROOT / forge_job_id / "forge"
    if not forge_dir.exists():
        raise HTTPException(404, f"No forge output for job {forge_job_id}")

    fallback_ply = forge_dir / "mesh_raw_fallback.ply"
    debug_path   = forge_dir / "loft_debug.json"

    if not debug_path.exists():
        return {
            "forge_job_id":       forge_job_id,
            "loft_succeeded":     not fallback_ply.exists(),
            "fallback_ply_exists": fallback_ply.exists(),
            "debug": None,
        }

    try:
        debug = json.loads(debug_path.read_text(encoding="utf-8"))
        return {
            "forge_job_id":       forge_job_id,
            "loft_succeeded":     False,
            "fallback_ply_exists": fallback_ply.exists(),
            "debug": debug,
        }
    except Exception as exc:
        raise HTTPException(500, f"Could not read loft_debug.json: {exc}")
