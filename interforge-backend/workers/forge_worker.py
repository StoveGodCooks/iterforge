"""
Forge pipeline worker — 6-step geometry pipeline.

Steps (IDs must match Forge.tsx INITIAL_STEPS):
  1. build     — Geometry construction   (depth + loft OR point cloud + Poisson)
  2. decimate  — Reduce to target polygon count
  3. refine    — Smooth + repair manifold
  4. lod       — LOD0→LOD3 at 100%/50%/25%/10%
  5. export    — Save geometry as GLB / FBX / OBJ
  6. save      — Write project.json manifest

Routing — determined by reconstruction_path from MasterForge asset config:
  HARD_SURFACE → engine/ loft pipeline (CadQuery contour rings → solid)
  ORGANIC      → Poisson pipeline      (DPT depth + point cloud → surface)
  NONE         → 2D skip               (no mesh; fast-pass all steps)
  auto / null  → defaults to ORGANIC

SSE events emitted:
  step_active  — step just started     {step_id, description}
  step_done    — step completed        {step_id, output}
  progress     — within-step update   {pct, message}
  mesh_ready   — export available     {mesh_url, format}
  done         — pipeline complete    {mesh_url, ...}
  error        — fatal failure        {code, message}
"""
from __future__ import annotations

import asyncio
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from core.job_manager import Job, JobStatus
from core.sse import (
    EventType, make_event, done_event,
    error_event, log_event, step_active_event, step_done_event,
)

from core.config import PROJECTS_ROOT, OUTPUTS_URL
from core.profiler import PipelineProfiler
from inference.zero123 import VIEW_ORDER

VIEW_ANGLES = VIEW_ORDER  # ["front", "front_right", "right", "back", "left", "front_left"]


# ── Public entry point ────────────────────────────────────────

async def run_forge(job: Job, params: dict) -> None:
    """
    6-step mesh pipeline with 3-way routing on reconstruction_path.
    params comes from ForgeRequest.model_dump().
    """
    smelt_job_id    = (params.get("smelt_job_id") or "").strip()
    prospect_job_id = (params.get("prospect_job_id") or "").strip()
    image_index     = int(params.get("image_index", 0))
    tinker_mode     = bool(params.get("tinker_mode", False))
    target_poly     = int(params.get("target_poly_count", 15000))
    export_fmt      = params.get("export_format", "glb").lower().replace("gltf", "glb")

    # Normalise reconstruction path
    recon_path = (params.get("reconstruction_path") or "auto").lower().strip()
    if recon_path not in ("hard_surface", "organic", "none"):
        recon_path = "organic"

    out_dir = PROJECTS_ROOT / job.id / "forge"
    out_dir.mkdir(parents=True, exist_ok=True)

    # ── Resolve input view paths (single smelt job → 6 views) ─
    view_rgba_paths: dict[str, Path | None] = {}
    if smelt_job_id:
        for angle in VIEW_ANGLES:
            rgba = PROJECTS_ROOT / smelt_job_id / "smelt" / angle / "image_00_rgba.png"
            raw  = PROJECTS_ROOT / smelt_job_id / "smelt" / angle / "image_00.png"
            view_rgba_paths[angle] = rgba if rgba.exists() else (raw if raw.exists() else None)
    else:
        for angle in VIEW_ANGLES:
            view_rgba_paths[angle] = None

    # Tinker mode fallback — use locked prospect image as front view
    if view_rgba_paths.get("front") is None and tinker_mode and prospect_job_id:
        prospect_dir   = PROJECTS_ROOT / prospect_job_id / "prospect"
        prospect_rgba  = prospect_dir / f"image_{image_index:02d}_rgba.png"
        prospect_raw   = prospect_dir / f"image_{image_index:02d}.png"
        fallback       = prospect_rgba if prospect_rgba.exists() else prospect_raw
        if fallback.exists():
            view_rgba_paths["front"] = fallback

    # NONE path doesn't need views for mesh — skip the check
    if recon_path != "none" and view_rgba_paths.get("front") is None:
        await job.push(error_event(
            "ERROR_FORGE_NO_VIEWS",
            "No usable source image found. Complete Smelting first, "
            "or use Tinker Mode with a locked Prospecting image.",
        ))
        return

    found = sum(1 for p in view_rgba_paths.values() if p)
    await job.push(log_event(
        f"Forge pipeline starting — {found} view(s) — route: {recon_path.upper()}"
    ))

    profiler = PipelineProfiler(job_id=job.id, route=recon_path.upper())

    # ── Route ─────────────────────────────────────────────────
    if recon_path == "hard_surface":
        await _run_hard_surface(job, params, view_rgba_paths, out_dir, target_poly, export_fmt, profiler)
    elif recon_path == "none":
        await _run_none(job, params, view_rgba_paths, out_dir)
    else:
        await _run_organic(job, params, view_rgba_paths, out_dir, target_poly, export_fmt, profiler)


# ═══════════════════════════════════════════════════════════════
#  HARD_SURFACE BRANCH — engine/ loft pipeline
# ═══════════════════════════════════════════════════════════════

async def _run_hard_surface(
    job:             Job,
    params:          dict,
    view_rgba_paths: dict[str, Path | None],
    out_dir:         Path,
    target_poly:     int,
    export_fmt:      str,
    profiler:        "PipelineProfiler",
) -> None:
    """
    HARD_SURFACE route — calls engine modules directly so progress can be
    forwarded as SSE events (engine/run.py's _emit() is stdout-only).

    build    → Visual hull reconstruction (6-view silhouette carving)
    decimate → trimesh quadric decimation
    refine   → export.smooth_mesh_laplacian
    lod      → export.generate_lods
    export   → export.export_all (vertex color projection)
    save     → _step_save_project
    """
    import trimesh

    # ── Step 1: build ─────────────────────────────────────────
    await job.push(step_active_event(
        "build",
        "Multi-view depth analysis + contour ring lofting → solid geometry",
    ))
    mesh: trimesh.Trimesh
    try:
        with profiler.section("build", "Multi-view depth analysis + loft"):
            smelt_id = (params.get("smelt_job_id") or "").strip()
            mesh = await asyncio.to_thread(
                _engine_build, view_rgba_paths, out_dir, smelt_id
            )
        job.checkpoint(0)
        # If loft fell back to visual hull, inform the user via SSE
        fallback_msg = getattr(mesh, "metadata", {}).get("_loft_fallback")
        if fallback_msg:
            await job.push(log_event(f"Loft failed ({fallback_msg}) — used visual hull fallback"))
        await job.push(step_done_event("build", f"{len(mesh.faces):,} faces"))
    except ImportError as exc:
        await job.push(error_event(
            "ERROR_FORGE_MISSING_DEP",
            f"Missing package: {exc}. Install: pip install cadquery open3d",
        ))
        profiler.export(out_dir)
        return
    except Exception as exc:
        await job.push(error_event("ERROR_FORGE_BUILD", str(exc)))
        profiler.export(out_dir)
        return

    # ── Step 2: decimate ──────────────────────────────────────
    await job.push(step_active_event(
        "decimate", f"Reducing to ~{target_poly:,} polygons"
    ))
    try:
        with profiler.section("decimate", f"Quadric decimation → {target_poly:,} polys"):
            mesh = await asyncio.to_thread(_engine_decimate, mesh, target_poly)
        job.checkpoint(1)
        await job.push(step_done_event("decimate", f"{len(mesh.faces):,} faces"))
    except Exception as exc:
        await job.push(error_event("ERROR_FORGE_DECIMATE", str(exc)))
        profiler.export(out_dir)
        return

    # ── Step 3: refine ────────────────────────────────────────
    await job.push(step_active_event(
        "refine", "Laplacian smoothing + manifold refinement"
    ))
    try:
        with profiler.section("refine", "Sharp edge preservation (hard surface)"):
            # Hard-surface meshes: no smoothing (preserve sharp edges for weapons, armor, etc.)
            mesh = await asyncio.to_thread(_engine_refine, mesh, 0)
        job.checkpoint(2)
        await job.push(step_done_event("refine", "Hard-surface — sharp edges preserved"))
    except Exception as exc:
        # Refine failure is non-fatal — continue with unsmoothed mesh
        await job.push(log_event(f"Refine warning (non-fatal): {exc}"))
        await job.push(step_done_event("refine", "Skipped — using raw mesh"))

    # ── Step 4: lod ───────────────────────────────────────────
    await job.push(step_active_event("lod", "Generating LOD0 / LOD1 / LOD2 / LOD3"))
    lod_paths: dict[str, str] = {}
    try:
        with profiler.section("lod", "LOD0→LOD3 generation"):
            lod_paths = await asyncio.to_thread(_engine_lod, mesh, out_dir)
        job.checkpoint(3)
        await job.push(step_done_event("lod", f"{len(lod_paths)} LOD levels"))
    except Exception as exc:
        await job.push(log_event(f"LOD warning (non-fatal): {exc}"))
        lod_paths = {}

    # ── Step 5: export ────────────────────────────────────────
    await job.push(step_active_event(
        "export",
        f"Vertex color projection + packaging as {export_fmt.upper()}",
    ))
    try:
        with profiler.section("export", f"Vertex color projection + {export_fmt.upper()} packaging"):
            export_path, mesh_url = await asyncio.to_thread(
                _engine_export, mesh, view_rgba_paths, out_dir, export_fmt, job.id
            )
        job.checkpoint(4)
        await job.push(step_done_event("export", export_path.name))
        await job.push(make_event(EventType.MESH_READY, {
            "mesh_url": mesh_url,
            "format":   export_fmt,
        }))
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

    # ── Export profiler ───────────────────────────────────────
    try:
        md_path, json_path = profiler.export(out_dir)
        await job.push(log_event(f"[PROFILER] {md_path.name} + {json_path.name} written to forge output dir"))
    except Exception as exc:
        await job.push(log_event(f"[PROFILER] Export failed (non-fatal): {exc}"))

    # ── Done ──────────────────────────────────────────────────
    rel = export_path.relative_to(PROJECTS_ROOT)
    job.result = {
        "mesh_url":      f"{OUTPUTS_URL}/{rel.as_posix()}",
        "export_format": export_fmt,
        "lod_paths":     lod_paths,
        "out_dir":       str(out_dir),
        "pipeline":      "hard_surface",
    }
    await job.push(done_event(job.result))


# ── Engine step implementations (HARD_SURFACE, run in threads) ─

def _engine_build(
    view_rgba_paths: dict[str, Path | None],
    out_dir: Path,
    smelt_job_id: str = "",
) -> "trimesh.Trimesh":
    """
    Step 1 (HARD_SURFACE): Visual hull reconstruction from Zero123++ multi-view silhouettes.
    """
    import trimesh

    ply_path = out_dir / "mesh_raw.ply"
    try:
        ply_path = _step_reconstruct_tsdf(view_rgba_paths, ply_path, smelt_job_id=smelt_job_id)
    except Exception as tsdf_exc:
        import logging
        logging.warning(f"[forge] TSDF failed ({tsdf_exc}) — falling back to visual hull")
        ply_path = _step_reconstruct(view_rgba_paths, ply_path, "organic")

    mesh = trimesh.load(str(ply_path))
    if isinstance(mesh, trimesh.Scene):
        mesh = trimesh.util.concatenate(list(mesh.geometry.values()))
    return mesh


def _engine_decimate(mesh: "trimesh.Trimesh", target_faces: int) -> "trimesh.Trimesh":
    if len(mesh.faces) <= target_faces:
        return mesh
    # trimesh.simplify_quadric_decimation optionally uses fast_simplification.
    # Fall back to Open3D decimation if that package is not installed.
    try:
        return mesh.simplify_quadric_decimation(target_faces)
    except (ImportError, ModuleNotFoundError):
        pass
    try:
        import open3d as o3d
        import numpy as np
        o3d_mesh = o3d.geometry.TriangleMesh()
        o3d_mesh.vertices  = o3d.utility.Vector3dVector(np.asarray(mesh.vertices,  dtype=np.float64))
        o3d_mesh.triangles = o3d.utility.Vector3iVector(np.asarray(mesh.faces,     dtype=np.int32))
        o3d_mesh = o3d_mesh.simplify_quadric_decimation(target_number_of_triangles=target_faces)
        import trimesh as _trimesh
        return _trimesh.Trimesh(
            vertices=np.asarray(o3d_mesh.vertices),
            faces=np.asarray(o3d_mesh.triangles),
            process=False,
        )
    except Exception:
        return mesh  # decimation failure is non-fatal — use full mesh


def _engine_refine(mesh: "trimesh.Trimesh", iterations: int = 1) -> "trimesh.Trimesh":
    from engine.export import smooth_mesh_laplacian
    return smooth_mesh_laplacian(mesh, iterations=iterations)


def _engine_lod(
    mesh: "trimesh.Trimesh",
    out_dir: Path,
    vertex_colors: "np.ndarray | None" = None,
) -> dict[str, str]:
    from engine.export import generate_lods
    return generate_lods(mesh, out_dir, base_name="asset", vertex_colors=vertex_colors)


def _engine_export(
    mesh:            "trimesh.Trimesh",
    view_rgba_paths: dict[str, Path | None],
    out_dir:         Path,
    export_fmt:      str,
    job_id:          str,
) -> tuple[Path, str]:
    from engine.export import export_all

    view_paths = {
        angle: str(p) if p else None
        for angle, p in view_rgba_paths.items()
    }
    result = export_all(
        shape=mesh,
        out_dir=out_dir,
        views=view_paths,
        formats=[export_fmt],
        base_name="asset",
        no_lod=True,           # LOD already generated in step 4
        no_dxf=True,
        smooth_iterations=0,   # already smoothed in step 3
    )

    export_file = result.get(export_fmt) or result.get("glb") or result.get("obj")
    if not export_file:
        raise RuntimeError(f"Export produced no output file for format: {export_fmt}")

    export_path = Path(export_file)
    rel         = export_path.relative_to(PROJECTS_ROOT)
    mesh_url    = f"{OUTPUTS_URL}/{rel.as_posix()}"
    return export_path, mesh_url


# ═══════════════════════════════════════════════════════════════
#  ORGANIC BRANCH — Poisson reconstruction pipeline (original)
# ═══════════════════════════════════════════════════════════════

async def _run_organic(
    job:             Job,
    params:          dict,
    view_rgba_paths: dict[str, Path | None],
    out_dir:         Path,
    target_poly:     int,
    export_fmt:      str,
    profiler:        "PipelineProfiler",
) -> None:
    """
    ORGANIC route — visual hull space carving from alpha silhouettes → surface mesh.
    """
    # ── Step 1: build ─────────────────────────────────────────
    await job.push(step_active_event(
        "build",
        "Depth estimation + TSDF volumetric fusion",
    ))
    mesh_path = out_dir / "mesh_raw.ply"
    try:
        await job.push(log_event("Running visual hull reconstruction (6-view silhouette carving)…"))
        with profiler.section("build", "Visual hull (6-view camera projection)"):
            smelt_id = (params.get("smelt_job_id") or "").strip()
            mesh_path = await asyncio.to_thread(
                _step_reconstruct_tsdf, view_rgba_paths, mesh_path, profiler, smelt_id
            )
        job.checkpoint(0)
        await job.push(step_done_event("build", mesh_path.name))
    except ImportError as exc:
        await job.push(error_event(
            "ERROR_FORGE_MISSING_DEP",
            f"Missing package: {exc}. Install: pip install open3d scikit-image",
        ))
        profiler.export(out_dir)
        return
    except Exception as exc:
        await job.push(error_event("ERROR_FORGE_BUILD", str(exc)))
        profiler.export(out_dir)
        return

    # ── Step 2: decimate ──────────────────────────────────────
    await job.push(step_active_event("decimate", f"Reducing to ~{target_poly:,} polygons"))
    decimated_path = out_dir / "mesh_decimated.ply"
    try:
        with profiler.section("decimate", f"Open3D quadric decimation → {target_poly:,} polys"):
            decimated_path = await asyncio.to_thread(
                _step_decimate, mesh_path, decimated_path, target_poly
            )
        job.checkpoint(1)
        await job.push(step_done_event("decimate", decimated_path.name))
    except Exception as exc:
        await job.push(error_event("ERROR_FORGE_DECIMATE", str(exc)))
        profiler.export(out_dir)
        return

    # ── Step 3: refine ────────────────────────────────────────
    await job.push(step_active_event("refine", "Filling holes + fixing winding + watertight manifold"))
    repaired_path = out_dir / "mesh_repaired.ply"
    try:
        with profiler.section("refine", "Hole fill + normal fix + Taubin smoothing"):
            repaired_path = await asyncio.to_thread(_step_repair, decimated_path, repaired_path)
        job.checkpoint(2)
        await job.push(step_done_event("refine", repaired_path.name))
    except Exception as exc:
        await job.push(error_event("ERROR_FORGE_REFINE", str(exc)))
        profiler.export(out_dir)
        return

    # ── Step 4: lod ───────────────────────────────────────────
    await job.push(step_active_event("lod", "Generating LOD0 / LOD1 / LOD2 / LOD3"))
    lod_paths: dict[str, str] = {}
    try:
        with profiler.section("lod", "LOD0→LOD3 generation"):
            lod_paths = await asyncio.to_thread(_step_lod, repaired_path, out_dir)
        job.checkpoint(3)
        await job.push(step_done_event("lod", f"{len(lod_paths)} LOD levels"))
    except Exception as exc:
        await job.push(log_event(f"LOD warning (non-fatal): {exc}"))
        lod_paths = {"lod0": str(repaired_path)}

    # ── Step 5: export ────────────────────────────────────────
    ext = {"glb": ".glb", "fbx": ".fbx", "obj": ".obj"}.get(export_fmt, ".glb")
    export_path = out_dir / f"asset{ext}"
    await job.push(step_active_event(
        "export", f"Packaging geometry as {export_fmt.upper()}"
    ))
    try:
        with profiler.section("export", f"{export_fmt.upper()} packaging"):
            export_path = await asyncio.to_thread(
                _step_export, repaired_path, export_path, export_fmt
            )
        job.checkpoint(4)
        rel       = export_path.relative_to(PROJECTS_ROOT)
        mesh_url  = f"{OUTPUTS_URL}/{rel.as_posix()}"
        await job.push(step_done_event("export", export_path.name))
        await job.push(make_event(EventType.MESH_READY, {
            "mesh_url": mesh_url,
            "format":   export_fmt,
        }))
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

    # ── Export profiler ───────────────────────────────────────
    try:
        md_path, json_path = profiler.export(out_dir)
        await job.push(log_event(f"[PROFILER] {md_path.name} + {json_path.name} written to forge output dir"))
    except Exception as exc:
        await job.push(log_event(f"[PROFILER] Export failed (non-fatal): {exc}"))

    # ── Done ──────────────────────────────────────────────────
    rel = export_path.relative_to(PROJECTS_ROOT)
    job.result = {
        "mesh_url":      f"{OUTPUTS_URL}/{rel.as_posix()}",
        "export_format": export_fmt,
        "lod_paths":     lod_paths,
        "out_dir":       str(out_dir),
        "pipeline":      "organic",
    }
    await job.push(done_event(job.result))


# ═══════════════════════════════════════════════════════════════
#  NONE BRANCH — 2D asset, no mesh required
# ═══════════════════════════════════════════════════════════════

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


# ═══════════════════════════════════════════════════════════════
#  ORGANIC step implementations (unchanged, used by ORGANIC branch
#  and as fallback in HARD_SURFACE branch)
# ═══════════════════════════════════════════════════════════════

def _step_reconstruct(
    view_rgba_paths: dict[str, Path | None],
    out_path: Path,
    recon_path: str,
    profiler: "PipelineProfiler | None" = None,
) -> Path:
    """
    Visual hull reconstruction from multi-view alpha silhouettes.

    For each voxel in a 3D grid, project it onto every available view's
    alpha mask.  A voxel survives only if it falls INSIDE the silhouette
    in ALL views.  This is the classical "space carving" algorithm — the
    correct approach when input is RGBA images with clean alpha channels.

    Pipeline:
      1. Load RGBA views, extract binary alpha silhouettes.
      2. Synthesize a back view (mirrored front) since no back camera exists.
      3. Carve the voxel grid: multiply by each view's silhouette projection.
      4. Gaussian-smooth the volume for a clean surface.
      5. Marching cubes → triangle mesh → PLY.

    No depth estimation is used — the alpha silhouette intersection from
    4-5 views constrains the 3D shape accurately without monocular depth
    (which produces flat / noisy results on AI-generated game art).
    """
    import numpy as np
    from PIL import Image
    import open3d as o3d
    from scipy.ndimage import gaussian_filter
    from skimage.measure import marching_cubes

    # Convenience: no-op section() when profiler is absent
    from contextlib import nullcontext as _noop
    def _sec(name, label=""):
        return profiler.section(name, label) if profiler else _noop()

    # ── Load RGBA views at 512×512 ───────────────────────────────
    with _sec("build.load_images", "Load + resize RGBA views to 512×512"):
        view_rgbas: dict[str, np.ndarray] = {}
        for angle, path in view_rgba_paths.items():
            if path and path.exists():
                img = np.array(Image.open(str(path)).convert("RGBA").resize((512, 512)))
                view_rgbas[angle] = img

    if not view_rgbas:
        raise RuntimeError("No view RGBA images found for reconstruction.")

    # Synthesize back view (mirrored front) — we never have a real back camera
    if "front" in view_rgbas and "back" not in view_rgbas:
        view_rgbas["back"] = np.flip(view_rgbas["front"], axis=1).copy()

    # Synthesize side views when missing (Tinker Mode: only front exists).
    # Without side views the visual hull degenerates to a thick slab.
    # Strategy: for each row of the front alpha, measure the horizontal span
    # of opaque pixels.  The synthetic side view has the SAME height profile
    # but width = front_span * THICKNESS_RATIO at each row.  This creates an
    # elliptical cross-section assumption — much better than no constraint.
    if "front" in view_rgbas and "right" not in view_rgbas:
        THICKNESS_RATIO = 0.30  # side depth ≈ 30% of front width
        front_alpha = (view_rgbas["front"][..., 3] > 64)
        h, w = front_alpha.shape
        synth_alpha = np.zeros((h, w), dtype=np.uint8)
        for row in range(h):
            cols = np.where(front_alpha[row])[0]
            if len(cols) == 0:
                continue
            span = cols[-1] - cols[0] + 1
            side_span = max(1, int(span * THICKNESS_RATIO))
            center = w // 2
            c0 = center - side_span // 2
            c1 = c0 + side_span
            synth_alpha[row, max(0, c0):min(w, c1)] = 255
        # Build a full RGBA from the synthetic alpha (RGB doesn't matter for carving)
        synth_rgba = np.zeros((h, w, 4), dtype=np.uint8)
        synth_rgba[..., :3] = 128  # neutral grey
        synth_rgba[..., 3] = synth_alpha
        view_rgbas["right"] = synth_rgba
        view_rgbas["left"] = np.flip(synth_rgba, axis=1).copy()

    # Synthesize top view when missing — use the front alpha's horizontal
    # span as width and the synthetic side span as height.
    if "front" in view_rgbas and "top" not in view_rgbas:
        front_alpha = (view_rgbas["front"][..., 3] > 64)
        h, w = front_alpha.shape
        # Get the overall bounding box of the front silhouette
        cols_any = np.any(front_alpha, axis=0)
        if cols_any.any():
            c0, c1 = np.where(cols_any)[0][[0, -1]]
            front_span = c1 - c0 + 1
        else:
            front_span = w // 2
        THICKNESS_RATIO_TOP = 0.30
        side_span = max(1, int(front_span * THICKNESS_RATIO_TOP))
        synth_top = np.zeros((h, w, 4), dtype=np.uint8)
        synth_top[..., :3] = 128
        # Top view: object centred, width = front_span, height = side_span
        cx, cy = w // 2, h // 2
        x0 = max(0, cx - front_span // 2)
        x1 = min(w, x0 + front_span)
        y0 = max(0, cy - side_span // 2)
        y1 = min(h, y0 + side_span)
        synth_top[y0:y1, x0:x1, 3] = 255
        view_rgbas["top"] = synth_top

    # ── Adaptive bounding box from alpha silhouettes ──────────────
    # Focus voxel resolution on the object's actual extent instead of
    # wasting grid cells on empty space (e.g., a tall narrow sword).
    PADDING = 0.05
    bbox_min = np.array([-0.5, -0.5, -0.5], dtype=np.float32)
    bbox_max = np.array([ 0.5,  0.5,  0.5], dtype=np.float32)

    def _alpha_bbox(rgba: np.ndarray):
        """Return (u_min, u_max, v_min, v_max) in [0,1] from alpha mask."""
        alpha = rgba[..., 3] > 64
        rows = np.any(alpha, axis=1)
        cols = np.any(alpha, axis=0)
        if not rows.any() or not cols.any():
            return 0.0, 1.0, 0.0, 1.0
        r0, r1 = np.where(rows)[0][[0, -1]]
        c0, c1 = np.where(cols)[0][[0, -1]]
        h, w = alpha.shape
        return c0 / w, (c1 + 1) / w, r0 / h, (r1 + 1) / h

    if "front" in view_rgbas:
        u0, u1, v0, v1 = _alpha_bbox(view_rgbas["front"])
        bbox_min[0] = max(-0.5, (u0 - 0.5) - PADDING)
        bbox_max[0] = min( 0.5, (u1 - 0.5) + PADDING)
        bbox_min[1] = max(-0.5, (0.5 - v1) - PADDING)
        bbox_max[1] = min( 0.5, (0.5 - v0) + PADDING)

    if "right" in view_rgbas:
        u0, u1, v0, v1 = _alpha_bbox(view_rgbas["right"])
        bbox_min[2] = max(-0.5, -(u1 - 0.5) - PADDING)
        bbox_max[2] = min( 0.5, -(u0 - 0.5) + PADDING)
        y_min_r = max(-0.5, (0.5 - v1) - PADDING)
        y_max_r = min( 0.5, (0.5 - v0) + PADDING)
        bbox_min[1] = max(bbox_min[1], y_min_r)
        bbox_max[1] = min(bbox_max[1], y_max_r)

    if profiler:
        profiler.mark("build.adaptive_bbox",
                      f"bbox X[{bbox_min[0]:.2f},{bbox_max[0]:.2f}] "
                      f"Y[{bbox_min[1]:.2f},{bbox_max[1]:.2f}] "
                      f"Z[{bbox_min[2]:.2f},{bbox_max[2]:.2f}]")

    # ── Visual hull: carve voxel grid with silhouettes ───────────
    #
    # Volume axes use 'ij' indexing: volume[ix, iy, iz]
    # maps to world position (lin_x[ix], lin_y[iy], lin_z[iz]).
    #
    # Each view defines an orthographic projection. We compute a 2D
    # lookup (RES×RES) and broadcast into the 3D volume along the
    # "free" axis.  Memory is O(RES²) per view, not O(RES³).

    RES = 192
    lin_x = np.linspace(bbox_min[0], bbox_max[0], RES, dtype=np.float32)
    lin_y = np.linspace(bbox_min[1], bbox_max[1], RES, dtype=np.float32)
    lin_z = np.linspace(bbox_min[2], bbox_max[2], RES, dtype=np.float32)
    volume = np.ones((RES, RES, RES), dtype=np.float32)

    with _sec("build.carve_volume", f"Space carving {len(view_rgbas)} views into {RES}³ grid"):
      for angle, rgba in view_rgbas.items():
        alpha = (rgba[..., 3] > 64).astype(np.float32)
        h, w = alpha.shape

        if angle == "front":        # u=+x, v=+y → free axis = z
            u_c, v_c = lin_x, lin_y
            def bcast(m): return m[:, :, np.newaxis]
        elif angle == "back":       # u=−x, v=+y → free axis = z
            u_c, v_c = -lin_x, lin_y
            def bcast(m): return m[:, :, np.newaxis]
        elif angle == "right":      # u=−z, v=+y → free axis = x
            u_c, v_c = -lin_z, lin_y
            def bcast(m): return m.T[np.newaxis, :, :]
        elif angle == "left":       # u=+z, v=+y → free axis = x
            u_c, v_c = lin_z, lin_y
            def bcast(m): return m.T[np.newaxis, :, :]
        elif angle == "top":        # u=+x, v=+z → free axis = y
            u_c, v_c = lin_x, lin_z
            def bcast(m): return m[:, np.newaxis, :]
        else:
            continue

        # u_c/v_c are world coords — map to [0,1] pixel space via (coord + 0.5)
        px = np.clip(((u_c + 0.5) * (w - 1)).astype(np.int32), 0, w - 1)
        py = np.clip(((0.5 - v_c) * (h - 1)).astype(np.int32), 0, h - 1)
        inside_2d = alpha[py[np.newaxis, :], px[:, np.newaxis]]
        volume *= bcast(inside_2d)

    # ── Smooth + marching cubes → triangle mesh ─────────────────
    with _sec("build.marching_cubes", "Gaussian smooth + marching cubes isosurface"):
        volume = gaussian_filter(volume, sigma=1.5)
        padded = np.pad(volume, 1, mode='constant', constant_values=0)
        try:
            verts, faces, _, _ = marching_cubes(padded, level=0.5)
        except (ValueError, RuntimeError):
            raise RuntimeError(
                "Visual hull produced no geometry — check that view images "
                "have valid alpha channels (transparent background)."
            )

    # Rescale vertices from padded-grid indices to per-axis world coords
    span = bbox_max - bbox_min
    verts_world = bbox_min[np.newaxis, :] + (verts - 1.0) / (RES - 1) * span[np.newaxis, :]
    verts = verts_world

    if len(verts) < 4:
        raise RuntimeError("Visual hull produced too few vertices.")

    with _sec("build.mesh_cleanup", "Floating island removal + normals + PLY write"):
        mesh = o3d.geometry.TriangleMesh()
        mesh.vertices = o3d.utility.Vector3dVector(verts.astype(np.float64))
        mesh.triangles = o3d.utility.Vector3iVector(faces.astype(np.int32))

        # ── Remove floating islands (keep largest connected component) ──
        triangle_clusters, cluster_n_triangles, _ = (
            mesh.cluster_connected_triangles()
        )
        cluster_n_triangles = np.asarray(cluster_n_triangles)
        if len(cluster_n_triangles) > 1:
            largest = cluster_n_triangles.argmax()
            triangles_to_remove = np.asarray(triangle_clusters) != largest
            mesh.remove_triangles_by_mask(triangles_to_remove)
            mesh.remove_unreferenced_vertices()

        mesh.compute_vertex_normals()
        o3d.io.write_triangle_mesh(str(out_path), mesh)

    if profiler:
        profiler.mark("build.done", f"{len(np.asarray(mesh.triangles)):,} triangles written to {out_path.name}")

    return out_path


def _step_reconstruct_tsdf(
    view_rgba_paths: dict[str, Path | None],
    out_path: Path,
    profiler: "PipelineProfiler | None" = None,
    smelt_job_id: str = "",
) -> Path:
    """
    Visual hull reconstruction from Zero123++ multi-view silhouettes.

    Uses the actual camera matrices from Zero123++ to project each voxel
    into every view. No depth estimation needed — the alpha silhouettes
    from 6 views are sufficient to carve the 3D shape. RGB color is
    projected onto the surface from the view images.
    """
    import numpy as np
    from PIL import Image
    import logging

    log = logging.getLogger(__name__)

    from contextlib import nullcontext as _noop
    def _sec(name, label=""):
        return profiler.section(name, label) if profiler else _noop()

    # ── Load views ───────────────────────────────────────────────
    with _sec("build.load_images", "Load + resize RGBA views"):
        view_rgbas: dict[str, np.ndarray] = {}
        for angle, path in view_rgba_paths.items():
            if path and path.exists():
                img = np.array(Image.open(str(path)).convert("RGBA").resize((768, 768)))
                view_rgbas[angle] = img

    if not view_rgbas:
        raise RuntimeError("No view RGBA images found for reconstruction.")

    # ── Center views by alpha centroid ───────────────────────────
    # Zero123++ can drift the object off-center between views.
    # Re-center each view so the object's alpha centroid sits at the
    # image center — this aligns views with the camera matrices.
    with _sec("build.center_views", "Alpha centroid alignment"):
        for angle, rgba in view_rgbas.items():
            alpha = rgba[:, :, 3]
            fg = alpha > 128  # Ignore shadow pixels for centroid calc
            if not fg.any():
                continue
            ys, xs = np.where(fg)
            cy, cx = int(ys.mean()), int(xs.mean())
            h, w = rgba.shape[:2]
            dy, dx = h // 2 - cy, w // 2 - cx
            if abs(dy) > 5 or abs(dx) > 5:
                shifted = np.zeros_like(rgba)
                sy0 = max(0, -dy)
                sy1 = min(h, h - dy)
                sx0 = max(0, -dx)
                sx1 = min(w, w - dx)
                dy0 = max(0, dy)
                dx0 = max(0, dx)
                shifted[dy0:dy0 + (sy1 - sy0), dx0:dx0 + (sx1 - sx0)] = rgba[sy0:sy1, sx0:sx1]
                view_rgbas[angle] = shifted
                log.info(f"[forge] Centered '{angle}' by ({dx}, {dy}) px")

    # ── Extract alpha masks ──────────────────────────────────────
    # Use threshold > 128 (not > 32) to ignore faint shadow/ground
    # artifacts that survived rembg.  The actual object has alpha > 200.
    alpha_masks: dict[str, np.ndarray] = {}
    for angle, rgba in view_rgbas.items():
        alpha_masks[angle] = (rgba[..., 3] > 128).astype(np.uint8) * 255

    # ── Load SVG silhouettes (sharper masks for carving) ────────
    svg_data: dict[str, str] | None = None
    if smelt_job_id:
        svg_data = {}
        for angle in view_rgbas:
            svg_path = PROJECTS_ROOT / smelt_job_id / "smelt" / angle / "image_00.svg"
            if svg_path.exists():
                svg_data[angle] = svg_path.read_text(encoding="utf-8")
        if not svg_data:
            svg_data = None
            log.info("[forge] No SVG silhouettes found — using raster alpha masks only")
        else:
            log.info(f"[forge] Loaded {len(svg_data)} SVG silhouettes for sharper carving")

    # ── Visual hull reconstruction ───────────────────────────────
    with _sec("build.visual_hull", "Visual hull carving (6 views × camera projection)"):
        try:
            from inference.reconstruct import visual_hull_reconstruct, cleanup_mesh

            mesh = visual_hull_reconstruct(
                alpha_masks=alpha_masks,
                view_images=view_rgbas,
                svg_data=svg_data,
                resolution=256,
                image_size=768,
            )
            log.info(f"[forge] Visual hull mesh: {len(mesh.vertices)} verts, {len(mesh.faces)} faces")
        except Exception as exc:
            raise RuntimeError(f"Visual hull reconstruction failed: {exc}") from exc

    # ── Cleanup + save ───────────────────────────────────────────
    with _sec("build.mesh_cleanup", "Mesh cleanup + PLY write"):
        mesh = cleanup_mesh(mesh, smooth_iterations=3, target_faces=None)
        mesh.export(str(out_path))

    if profiler:
        profiler.mark("build.done", f"{len(mesh.faces):,} faces written to {out_path.name}")

    return out_path


def _step_decimate(mesh_path: Path, out_path: Path, target_faces: int) -> Path:
    import open3d as o3d
    mesh = o3d.io.read_triangle_mesh(str(mesh_path))
    if len(mesh.triangles) > target_faces:
        mesh = mesh.simplify_quadric_decimation(target_number_of_triangles=target_faces)
    o3d.io.write_triangle_mesh(str(out_path), mesh)
    return out_path


def _step_repair(mesh_path: Path, out_path: Path) -> Path:
    import trimesh
    import trimesh.repair
    mesh = trimesh.load(str(mesh_path))
    if isinstance(mesh, trimesh.Scene):
        mesh = trimesh.util.concatenate(list(mesh.geometry.values()))
    trimesh.repair.fill_holes(mesh)
    trimesh.repair.fix_normals(mesh)
    trimesh.repair.fix_winding(mesh)
    # Taubin smoothing for organic meshes — smooths without volume shrinkage
    from engine.export import smooth_mesh_taubin
    mesh = smooth_mesh_taubin(mesh, iterations=10)
    mesh.export(str(out_path))
    return out_path


def _step_lod(mesh_path: Path, out_dir: Path) -> dict[str, str]:
    import trimesh
    mesh = trimesh.load(str(mesh_path))
    if isinstance(mesh, trimesh.Scene):
        mesh = trimesh.util.concatenate(list(mesh.geometry.values()))
    base_faces  = len(mesh.faces)
    lod_ratios  = [("lod0", 1.0), ("lod1", 0.5), ("lod2", 0.25), ("lod3", 0.10)]
    lod_paths: dict[str, str] = {}
    for name, ratio in lod_ratios:
        target   = max(4, int(base_faces * ratio))
        lod_mesh = mesh if ratio == 1.0 else mesh.simplify_quadric_decimation(target)
        lod_out  = out_dir / f"{name}.obj"
        lod_mesh.export(str(lod_out))
        lod_paths[name] = str(lod_out)
    return lod_paths


def _step_export(mesh_path: Path, out_path: Path, export_fmt: str) -> Path:
    import trimesh
    mesh = trimesh.load(str(mesh_path))
    if isinstance(mesh, trimesh.Scene):
        mesh = trimesh.util.concatenate(list(mesh.geometry.values()))

    if export_fmt == "fbx":
        # trimesh cannot export FBX natively — fall back to GLB with a warning
        out_path = out_path.with_suffix(".glb")
        mesh.export(str(out_path))
        raise RuntimeError(
            "FBX export is not yet supported (requires Blender headless). "
            "Your mesh has been exported as GLB instead."
        )

    mesh.export(str(out_path))
    return out_path


def _stub_midas_depth_refinement(
    mesh: "trimesh.Trimesh",
    view_rgba_paths: dict[str, "Path | None"],
) -> "trimesh.Trimesh":
    """
    [STUB — NOT CALLED] MiDaS-based depth displacement refinement.

    Intended future pipeline (activate once validated):
      1. Render the visual-hull mesh from front/right/left/top using
         trimesh's built-in scene rendering (orthographic cameras).
      2. Run MiDaS depth estimation on each rendered view
         (engine.multiview.estimate_depth_midas).
      3. Compare MiDaS depth maps against the mesh's actual Z-buffer
         from each camera angle → per-pixel depth residual.
      4. Project residuals back to 3D as per-vertex displacement vectors
         along vertex normals.
      5. Apply displacement to refine surface detail (blade bevels,
         grip texture, pommel curvature, etc.).

    Why deferred:
      MiDaS on flat 2D AI art produces unreliable depth (the current
      problem).  MiDaS on RENDERED views of our own 3D mesh should
      produce consistent depth because it sees a 3D-looking scene with
      shading, not flat pixel art.  However, the displacement integration
      needs careful normal alignment, boundary handling, and a quality
      gate (reject if depth residual is too noisy).

    Parameters
    ----------
    mesh            : base mesh from visual hull or loft pipeline
    view_rgba_paths : original RGBA view images for comparison

    Returns
    -------
    trimesh.Trimesh — refined mesh (currently returns input unchanged)
    """
    # TODO: Implement when MiDaS-on-rendered-views is validated.
    return mesh


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
