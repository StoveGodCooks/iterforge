"""
Forge pipeline worker — mesh generation.

Two routes, chosen by reconstruction_path from the MasterForge asset config:
  NONE  → 2D asset: no mesh; copy source images through, write a 2D manifest.
  else  → Stable Fast 3D: one locked prospect image → UV-textured GLB.

SSE events emitted: step_active / step_done / mesh_ready / done / error.
"""
from __future__ import annotations

import asyncio
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from core.job_manager import Job
from core.sse import (
    EventType, make_event, done_event,
    error_event, log_event, step_active_event, step_done_event,
)
from core.config import PROJECTS_ROOT, OUTPUTS_URL
from core.profiler import PipelineProfiler

VIEW_ANGLES = ["front", "front_right", "right", "back", "left", "front_left"]


# ── Public entry point ────────────────────────────────────────

async def run_forge(job: Job, params: dict) -> None:
    """
    Mesh pipeline. NONE → 2D skip; everything else → Stable Fast 3D.
    params comes from ForgeRequest.model_dump().
    """
    smelt_job_id = (params.get("smelt_job_id") or "").strip()
    target_poly  = int(params.get("target_poly_count", 15000))
    export_fmt   = params.get("export_format", "glb").lower().replace("gltf", "glb")

    recon_path = (params.get("reconstruction_path") or "auto").lower().strip()

    out_dir = PROJECTS_ROOT / job.id / "forge"
    out_dir.mkdir(parents=True, exist_ok=True)

    profiler = PipelineProfiler(job_id=job.id, route=recon_path.upper())

    if recon_path == "none":
        view_rgba_paths: dict[str, Path | None] = {}
        for angle in VIEW_ANGLES:
            p = None
            if smelt_job_id:
                base = PROJECTS_ROOT / smelt_job_id / "smelt" / angle
                rgba, raw = base / "image_00_rgba.png", base / "image_00.png"
                p = rgba if rgba.exists() else (raw if raw.exists() else None)
            view_rgba_paths[angle] = p
        await job.push(log_event("Forge pipeline starting — route: NONE (2D asset)"))
        await _run_none(job, params, view_rgba_paths, out_dir)
    else:
        await job.push(log_event(
            "Forge pipeline starting — route: SF3D (single image → textured mesh)"
        ))
        await _run_sf3d(job, params, out_dir, target_poly, export_fmt, profiler)


# ── NONE route — 2D asset (no mesh) ───────────────────────────
async def _run_none(
    job:             Job,
    params:          dict,
    view_rgba_paths: dict[str, Path | None],
    out_dir:         Path,
) -> None:
    """
    NONE route — asset type doesn't produce a 3D mesh (environment, UI, sprite, etc.).
    Fast-passes all 6 steps, copies source images to the forge output folder,
    and writes a 2D-only project.json manifest.
    """
    steps_desc = [
        ("build",    "2D asset — geometry build skipped"),
        ("decimate", "2D asset — decimation skipped"),
        ("refine",   "2D asset — refinement skipped"),
        ("lod",      "2D asset — LOD skipped"),
        ("export",   "Copying source images to project folder"),
        ("save",     "Writing 2D project manifest"),
    ]

    for i, (step_id, desc) in enumerate(steps_desc):
        await job.push(step_active_event(step_id, desc))

        if step_id == "export":
            # Copy source view images to forge output dir
            copied: list[str] = []
            for angle, path in view_rgba_paths.items():
                if path and path.exists():
                    dest = out_dir / f"{angle}{path.suffix}"
                    shutil.copy2(str(path), str(dest))
                    copied.append(angle)
            await job.push(step_done_event(
                "export",
                f"Copied {len(copied)} source image(s)" if copied else "No source images",
            ))

        elif step_id == "save":
            project = {
                "id":             job.id,
                "schema_version": "1.0",
                "created_at":     datetime.now(timezone.utc).isoformat(),
                "pipeline":       "none",
                "mesh":           False,
                "note":           "2D asset type — no mesh generated",
                "smelt_job_id":   params.get("smelt_job_id", ""),
                "files": {
                    "views": {
                        angle: str(out_dir / f"{angle}{p.suffix}")
                        for angle, p in view_rgba_paths.items()
                        if p and p.exists()
                    }
                },
            }
            project_json = out_dir / "project.json"
            project_json.write_text(json.dumps(project, indent=2, ensure_ascii=False))
            await job.push(step_done_event("save", "project.json"))

        else:
            await job.push(step_done_event(step_id, "Skipped"))

        job.checkpoint(i)

    job.result = {
        "mesh_url":  None,
        "pipeline":  "none",
        "out_dir":   str(out_dir),
    }
    await job.push(done_event(job.result))


# ── SF3D route — single image → UV-textured mesh ──────────────

def _free_other_gpu_engines() -> None:
    """
    VRAM arbiter (GPU-primary): free the SDXL sprite engine before SF3D takes the
    GPU, so only one heavy model is resident on the 8GB card at a time.
    """
    try:
        from inference.engine import ForgeEngine
        if ForgeEngine.get().is_loaded:
            ForgeEngine.get().unload()
    except Exception:
        pass


async def _run_sf3d(
    job:         Job,
    params:      dict,
    out_dir:     Path,
    target_poly: int,
    export_fmt:  str,
    profiler:    "PipelineProfiler",
) -> None:
    """
    SF3D route — the locked prospect image → UV-unwrapped, PBR-textured GLB.
    Replaces the Zero123++ multi-view + visual-hull reconstruction chain.
    SF3D emits a clean, low-poly, textured mesh in one pass, so the old
    decimate/refine/lod steps fast-pass (external decimation would break UVs).
    """
    from PIL import Image

    prospect_job_id = (params.get("prospect_job_id") or "").strip()
    image_index     = int(params.get("image_index", 0))
    smelt_job_id    = (params.get("smelt_job_id") or "").strip()

    # ── Resolve the single source image (prefer the RGBA prospect) ──
    src: Path | None = None
    if prospect_job_id:
        pdir = PROJECTS_ROOT / prospect_job_id / "prospect"
        for cand in (pdir / f"image_{image_index:02d}_rgba.png",
                     pdir / f"image_{image_index:02d}.png"):
            if cand.exists():
                src = cand
                break
    if src is None and smelt_job_id:  # legacy fallback: a smelt front frame
        sdir = PROJECTS_ROOT / smelt_job_id / "smelt" / "front"
        for cand in (sdir / "image_00_rgba.png", sdir / "image_00.png"):
            if cand.exists():
                src = cand
                break
    if src is None:
        await job.push(error_event(
            "ERROR_FORGE_NO_SOURCE",
            "No source image found. Lock a Prospect image before forging a 3D mesh.",
        ))
        profiler.export(out_dir)
        return

    # ── Step 1: build (SF3D inference) ────────────────────────
    await job.push(step_active_event("build", "Stable Fast 3D — single image → textured mesh"))
    try:
        await asyncio.to_thread(_free_other_gpu_engines)   # arbiter: GPU-primary
        from inference.sf3d_engine import SF3DEngine
        eng = SF3DEngine.get()

        img = Image.open(str(src))
        # A locked prospect RGBA already has its background removed — skip rembg then.
        has_alpha = img.mode == "RGBA" and img.split()[3].getextrema()[0] < 250

        with profiler.section("build", "SF3D inference (single image → mesh + texture)"):
            mesh = await asyncio.to_thread(
                eng.generate_mesh,
                img,
                0.85,            # foreground_ratio
                1024,            # texture_resolution
                "none",          # remesh
                -1,              # target_vertex_count (natural ~20k faces)
                not has_alpha,   # remove_bg only if not already masked
            )
        job.checkpoint(0)
        await job.push(step_done_event("build", f"{len(mesh.faces):,} faces, UV-textured"))
    except Exception as exc:
        await job.push(error_event("ERROR_FORGE_SF3D", f"SF3D generation failed: {exc}"))
        profiler.export(out_dir)
        return

    # ── Steps 2-4: SF3D already produced a game-ready textured mesh ──
    await job.push(step_active_event("decimate", "SF3D emits a low-poly mesh — external decimation skipped"))
    await job.push(step_done_event("decimate", f"{len(mesh.faces):,} faces"))
    await job.push(step_active_event("refine", "SF3D mesh is clean + watertight — refinement skipped"))
    await job.push(step_done_event("refine", "Skipped"))
    await job.push(step_active_event("lod", "LOD chain skipped to preserve UV texture"))
    await job.push(step_done_event("lod", "LOD0 only"))
    lod_paths: dict[str, str] = {}

    # ── Step 5: export (UV-textured GLB) ──────────────────────
    await job.push(step_active_event("export", "Packaging UV-textured GLB"))
    export_path = out_dir / "asset.glb"
    try:
        with profiler.section("export", "Textured GLB export"):
            await asyncio.to_thread(
                lambda: mesh.export(str(export_path), include_normals=True)
            )
        job.checkpoint(4)
        rel      = export_path.relative_to(PROJECTS_ROOT)
        mesh_url = f"{OUTPUTS_URL}/{rel.as_posix()}"
        await job.push(step_done_event("export", export_path.name))
        await job.push(make_event(EventType.MESH_READY, {"mesh_url": mesh_url, "format": "glb"}))
    except Exception as exc:
        await job.push(error_event("ERROR_FORGE_EXPORT", str(exc)))
        profiler.export(out_dir)
        return

    # ── Step 6: save ──────────────────────────────────────────
    await job.push(step_active_event("save", "Writing project manifest"))
    try:
        with profiler.section("save", "project.json manifest"):
            await asyncio.to_thread(
                _step_save_project, job.id, out_dir, export_path, lod_paths, params
            )
        job.checkpoint(5)
        await job.push(step_done_event("save", "project.json"))
    except Exception as exc:
        await job.push(log_event(f"Project save warning (non-fatal): {exc}"))

    # Offload SF3D to CPU RAM so the GPU is free for the next stage (arbiter).
    try:
        from inference.sf3d_engine import SF3DEngine as _SF
        await asyncio.to_thread(_SF.get().offload)
    except Exception:
        pass

    try:
        profiler.export(out_dir)
    except Exception:
        pass

    rel = export_path.relative_to(PROJECTS_ROOT)
    job.result = {
        "mesh_url":      f"{OUTPUTS_URL}/{rel.as_posix()}",
        "export_format": "glb",
        "lod_paths":     lod_paths,
        "out_dir":       str(out_dir),
        "pipeline":      "sf3d",
    }
    await job.push(done_event(job.result))


# ── Shared: project manifest ──────────────────────────────────

def _step_save_project(
    job_id:     str,
    out_dir:    Path,
    export_path: Path,
    lod_paths:  dict,
    params:     dict,
) -> Path:
    project = {
        "id":                job_id,
        "schema_version":    "1.0",
        "created_at":        datetime.now(timezone.utc).isoformat(),
        "export_format":     params.get("export_format", "glb"),
        "target_poly_count": params.get("target_poly_count", 15000),
        "reconstruction":    params.get("reconstruction_path", "auto"),
        "prospect_job_id":   params.get("prospect_job_id", ""),
        "smelt_job_id":      params.get("smelt_job_id", ""),
        "texturing":         "v2",
        "files": {
            "mesh": str(export_path),
            "lods": lod_paths,
        },
    }
    project_json = out_dir / "project.json"
    project_json.write_text(json.dumps(project, indent=2, ensure_ascii=False))
    return project_json
