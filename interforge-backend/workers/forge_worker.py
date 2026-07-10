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
    elif recon_path == "relief":
        await job.push(log_event("Forge pipeline starting — route: 2.5D RELIEF (depth mesh)"))
        await _run_relief(job, params, out_dir, export_fmt, profiler)
    elif recon_path == "extrude":
        await job.push(log_event("Forge pipeline starting — route: 2D FLAT (billboard)"))
        await _run_extrude(job, params, out_dir, export_fmt, profiler)
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


# ══════════════════════════════════════════════════════════════
#  2D MESH routes — 2.5D depth relief / 2D flat billboard
# ══════════════════════════════════════════════════════════════

def _resolve_prospect_src(params: dict) -> "Path | None":
    """Locate the locked prospect RGBA image (falls back to a smelt front frame)."""
    prospect_job_id = (params.get("prospect_job_id") or "").strip()
    image_index     = int(params.get("image_index", 0))
    smelt_job_id    = (params.get("smelt_job_id") or "").strip()
    if prospect_job_id:
        pdir = PROJECTS_ROOT / prospect_job_id / "prospect"
        for cand in (pdir / f"image_{image_index:02d}_rgba.png",
                     pdir / f"image_{image_index:02d}.png"):
            if cand.exists():
                return cand
    if smelt_job_id:
        sdir = PROJECTS_ROOT / smelt_job_id / "smelt" / "front"
        for cand in (sdir / "image_00_rgba.png", sdir / "image_00.png"):
            if cand.exists():
                return cand
    return None


def _load_rgba(src: "Path"):
    """Load an image as a uint8 (H, W, 4) RGBA numpy array."""
    import numpy as np
    from PIL import Image
    img = Image.open(str(src)).convert("RGBA")
    return np.asarray(img, dtype=np.uint8)


def _build_extrude_mesh(rgba):
    """2D flat: a textured billboard quad sized to the image aspect ratio."""
    import numpy as np
    import trimesh
    from PIL import Image
    h, w = rgba.shape[:2]
    m = float(max(w, h))
    hw, hh = (w / m) / 2.0, (h / m) / 2.0
    verts = np.array([[-hw, -hh, 0.0], [hw, -hh, 0.0],
                      [hw, hh, 0.0], [-hw, hh, 0.0]], dtype=np.float32)
    faces = np.array([[0, 1, 2], [0, 2, 3]], dtype=np.int64)
    uv    = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], dtype=np.float32)
    tex = Image.fromarray(rgba, "RGBA")
    # alphaMode MASK so transparent (RGB=black) background texels are discarded
    # instead of rendering as solid black; double-sided so the plane shows both ways.
    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=tex, alphaMode="MASK", alphaCutoff=0.5, doubleSided=True,
    )
    visual = trimesh.visual.TextureVisuals(uv=uv, material=material)
    return trimesh.Trimesh(vertices=verts, faces=faces, visual=visual, process=False)


def _build_relief_mesh(rgba, depth, grid_max: int = 160, relief: float = 0.22):
    """2.5D relief: a subdivided plane displaced by depth, background dropped, image-textured."""
    import numpy as np
    import trimesh
    from PIL import Image
    H, W = depth.shape
    m = float(max(W, H))
    gw = int(max(2, min(grid_max, W)))
    gh = int(max(2, min(grid_max, H)))
    xs = np.linspace(0, W - 1, gw).astype(int)
    ys = np.linspace(0, H - 1, gh).astype(int)
    dg = depth[np.ix_(ys, xs)]                       # (gh, gw)
    ag = rgba[np.ix_(ys, xs)][:, :, 3]               # alpha grid (gh, gw)

    # vertex positions — centered, +Y up (image row 0 = top)
    gx = (xs / m) - (W / m) / 2.0
    gy = (H / m) / 2.0 - (ys / m)
    verts = np.zeros((gh, gw, 3), dtype=np.float32)
    verts[:, :, 0] = gx[None, :]
    verts[:, :, 1] = gy[:, None]
    verts[:, :, 2] = dg * float(relief)
    verts = verts.reshape(-1, 3)

    # UVs — glTF (0,0) bottom-left, so flip V
    u = xs / float(W - 1)
    v = 1.0 - (ys / float(H - 1))
    uv = np.zeros((gh, gw, 2), dtype=np.float32)
    uv[:, :, 0] = u[None, :]
    uv[:, :, 1] = v[:, None]
    uv = uv.reshape(-1, 2)

    def vid(r, c):
        return r * gw + c

    faces = []
    for r in range(gh - 1):
        for c in range(gw - 1):
            avg_a = (int(ag[r, c]) + int(ag[r, c + 1]) +
                     int(ag[r + 1, c]) + int(ag[r + 1, c + 1])) / 4.0
            if avg_a < 128:                          # drop background quads
                continue
            faces.append([vid(r, c), vid(r + 1, c), vid(r + 1, c + 1)])
            faces.append([vid(r, c), vid(r + 1, c + 1), vid(r, c + 1)])

    if not faces:                                    # fully masked → keep the full grid
        for r in range(gh - 1):
            for c in range(gw - 1):
                faces.append([vid(r, c), vid(r + 1, c), vid(r + 1, c + 1)])
                faces.append([vid(r, c), vid(r + 1, c + 1), vid(r, c + 1)])

    faces = np.array(faces, dtype=np.int64)
    tex = Image.fromarray(rgba, "RGBA")
    # alphaMode MASK so transparent (RGB=black) background texels are discarded
    # instead of rendering as solid black; double-sided so the plane shows both ways.
    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=tex, alphaMode="MASK", alphaCutoff=0.5, doubleSided=True,
    )
    visual = trimesh.visual.TextureVisuals(uv=uv, material=material)
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, visual=visual, process=False)
    mesh.remove_unreferenced_vertices()
    return mesh


async def _finish_2d_mesh(job, mesh, out_dir, params, profiler, pipeline_name: str) -> None:
    """Shared tail for the 2D-mesh routes: fast-pass 3D post-steps, export GLB, save, done."""
    await job.push(step_active_event("decimate", "2D mesh — external decimation skipped"))
    await job.push(step_done_event("decimate", f"{len(mesh.faces):,} faces"))
    await job.push(step_active_event("refine", "2D mesh — refinement skipped"))
    await job.push(step_done_event("refine", "Skipped"))
    await job.push(step_active_event("lod", "LOD skipped to preserve texture"))
    await job.push(step_done_event("lod", "LOD0 only"))
    lod_paths: dict[str, str] = {}

    await job.push(step_active_event("export", "Packaging UV-textured GLB"))
    export_path = out_dir / "asset.glb"
    try:
        with profiler.section("export", "Textured GLB export"):
            await asyncio.to_thread(lambda: mesh.export(str(export_path), include_normals=True))
        rel      = export_path.relative_to(PROJECTS_ROOT)
        mesh_url = f"{OUTPUTS_URL}/{rel.as_posix()}"
        await job.push(step_done_event("export", export_path.name))
        await job.push(make_event(EventType.MESH_READY, {"mesh_url": mesh_url, "format": "glb"}))
    except Exception as exc:
        await job.push(error_event("ERROR_FORGE_EXPORT", str(exc)))
        profiler.export(out_dir)
        return

    await job.push(step_active_event("save", "Writing project manifest"))
    try:
        with profiler.section("save", "project.json manifest"):
            await asyncio.to_thread(_step_save_project, job.id, out_dir, export_path, lod_paths, params)
        await job.push(step_done_event("save", "project.json"))
    except Exception as exc:
        await job.push(log_event(f"Project save warning (non-fatal): {exc}"))

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
        "pipeline":      pipeline_name,
    }
    await job.push(done_event(job.result))


async def _run_relief(job, params, out_dir, export_fmt, profiler) -> None:
    """2.5D depth relief — locked image -> DepthAnything depth -> displaced textured plane."""
    src = _resolve_prospect_src(params)
    if src is None:
        await job.push(error_event("ERROR_FORGE_NO_SOURCE",
                                   "Lock a Prospect image before forging a 2D mesh."))
        profiler.export(out_dir)
        return

    await job.push(step_active_event("build", "Depth relief - estimating depth + displacing plane"))
    try:
        await asyncio.to_thread(_free_other_gpu_engines)     # arbiter: free SDXL first
        rgba = _load_rgba(src)
        with profiler.section("build", "DepthAnything + relief mesh"):
            from inference.depth import estimate_depth, unload as unload_depth
            depth = await asyncio.to_thread(estimate_depth, rgba, True, True)
            mesh  = await asyncio.to_thread(_build_relief_mesh, rgba, depth)
            await asyncio.to_thread(unload_depth)
        await job.push(step_done_event("build", f"{len(mesh.faces):,} faces (2.5D relief)"))
    except Exception as exc:
        await job.push(error_event("ERROR_FORGE_RELIEF", f"Relief generation failed: {exc}"))
        profiler.export(out_dir)
        return

    await _finish_2d_mesh(job, mesh, out_dir, params, profiler, "relief")


async def _run_extrude(job, params, out_dir, export_fmt, profiler) -> None:
    """2D flat - locked image -> textured billboard quad (no depth model)."""
    src = _resolve_prospect_src(params)
    if src is None:
        await job.push(error_event("ERROR_FORGE_NO_SOURCE",
                                   "Lock a Prospect image before forging a 2D mesh."))
        profiler.export(out_dir)
        return

    await job.push(step_active_event("build", "2D flat - building textured billboard"))
    try:
        rgba = _load_rgba(src)
        with profiler.section("build", "Billboard quad"):
            mesh = await asyncio.to_thread(_build_extrude_mesh, rgba)
        await job.push(step_done_event("build", f"{len(mesh.faces):,} faces (2D flat)"))
    except Exception as exc:
        await job.push(error_event("ERROR_FORGE_EXTRUDE", f"2D flat generation failed: {exc}"))
        profiler.export(out_dir)
        return

    await _finish_2d_mesh(job, mesh, out_dir, params, profiler, "extrude")
