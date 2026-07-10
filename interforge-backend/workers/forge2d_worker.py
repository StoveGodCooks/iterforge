"""
2D Sprite pipeline worker.

Steps (IDs match forge2d.py TwoDForgeRequest and frontend step list):
  1. load     — resolve direction images from smelt job output folder
  2. rembg    — background removal on each sprite (skip if already RGBA)
  3. trim     — auto-crop each sprite to tight transparent bounding box
  4. outline  — optional pixel-perfect outline via alpha dilation (Pillow)
  5. pack     — pack into sprite sheet PNG + write atlas JSON
  6. save     — write project manifest

SSE events emitted:
  step_active   — step just started
  step_done     — step completed
  progress      — within-step progress
  sprite_ready  — a single processed sprite is ready  {direction, image_url}
  sheet_ready   — final sprite sheet is ready         {sheet_url, atlas_url}
  done          — pipeline complete
  error         — fatal failure
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from core.job_manager import Job
from core.sse import (
    EventType, make_event, done_event, error_event, log_event,
    step_active_event, step_done_event, progress_event,
)
from core.config import PROJECTS_ROOT, OUTPUTS_URL
from core.profiler import PipelineProfiler


# ── Step IDs ─────────────────────────────────────────────────

STEPS = ["load", "rembg", "trim", "outline", "pack", "save"]


async def run_forge2d(job: Job, params: dict) -> None:
    """
    Run the 2D sprite pipeline.
    params comes from TwoDForgeRequest.model_dump().
    """
    import asyncio

    profiler = PipelineProfiler(job_id=job.id, route="FORGE2D")

    smelt_job_id  = params["smelt_job_id"].strip()
    directions    = params.get("directions", ["front", "back"])
    add_outline   = bool(params.get("add_outline", True))
    outline_width = int(params.get("outline_width", 2))
    outline_color = params.get("outline_color", "black")
    export_size   = int(params.get("export_size", 256))
    sheet_layout  = params.get("sheet_layout", "grid")

    out_dir = PROJECTS_ROOT / job.id / "forge2d"
    out_dir.mkdir(parents=True, exist_ok=True)

    smelt_dir = PROJECTS_ROOT / smelt_job_id / "smelt"

    # Sprites collected: direction → processed RGBA PIL image
    sprites: dict[str, "Image"] = {}

    from PIL import Image, ImageFilter

    # ── Step 1: Load ─────────────────────────────────────────
    await job.push(step_active_event("load", "Resolving direction images from smelt job…"))
    with profiler.section("load", "Resolve smelt images"):
        missing = []
        for direction in directions:
            dir_path = smelt_dir / direction
            # Prefer rembg RGBA, fall back to raw
            rgba_candidate = dir_path / "image_00_rgba.png"
            raw_candidate  = dir_path / "image_00.png"

            if rgba_candidate.exists():
                sprites[direction] = Image.open(str(rgba_candidate)).convert("RGBA")
            elif raw_candidate.exists():
                sprites[direction] = Image.open(str(raw_candidate)).convert("RGBA")
            else:
                missing.append(direction)

    if missing:
        job.error_code = "ERROR_FORGE2D_MISSING_DIRECTIONS"
        await job.push(error_event(
            "ERROR_FORGE2D_MISSING_DIRECTIONS",
            f"Could not find images for directions: {', '.join(missing)}. "
            "Ensure the 2D smelt job completed successfully.",
        ))
        return

    await job.push(step_done_event("load", f"Loaded {len(sprites)} direction images"))

    # ── Step 2: rembg ────────────────────────────────────────
    # If an image came in as RGB, run full rembg (U2Net + 5px erosion).
    # If it's already RGBA (from upstream smelt/prospect), just re-erode to
    # strip any shadow fringe that survived earlier passes — double erosion
    # is cheap and idempotent beyond the silhouette edge.
    await job.push(step_active_event("rembg", "Background removal + edge cleanup…"))
    with profiler.section("rembg", "Background removal + 5px alpha erosion"):
        try:
            from core.postprocess import remove_background, erode_alpha
            import io as _io
            for direction, img in list(sprites.items()):
                buf = _io.BytesIO()
                already_rgba = (img.mode == "RGBA")
                if already_rgba:
                    alpha = img.split()[3]
                    # If alpha is fully opaque the upstream rembg didn't run
                    # — fall through to the full removal path.
                    has_transparency = alpha.getextrema()[0] < 250
                else:
                    has_transparency = False

                img.convert("RGBA").save(buf, "PNG")
                if has_transparency:
                    # Upstream already eroded ~5px; a second heavy erode eats real
                    # edges (10px total off the sprite). 1px just tidies any fringe.
                    rgba_bytes = await asyncio.to_thread(
                        erode_alpha, buf.getvalue(), 1
                    )
                else:
                    rgba_bytes = await asyncio.to_thread(
                        remove_background, buf.getvalue(), 5
                    )
                sprites[direction] = Image.open(_io.BytesIO(rgba_bytes)).convert("RGBA")

        except Exception as exc:
            # Non-fatal — continue with existing images
            await job.push(log_event(f"rembg warning (non-fatal): {exc}"))

    await job.push(step_done_event("rembg", "Background removal complete"))

    # ── Step 3: Trim ─────────────────────────────────────────
    await job.push(step_active_event("trim", "Cropping sprites to bounding box…"))
    with profiler.section("trim", "Auto-crop to bounding box"):
        for direction, img in list(sprites.items()):
            bbox = img.getbbox()
            if bbox:
                sprites[direction] = img.crop(bbox)

    await job.push(step_done_event("trim", "Sprites cropped"))

    # ── Resize to final export size (letterboxed, aspect-preserved) ──
    # Do this BEFORE the outline so the outline is drawn at final resolution —
    # outlining first and then downscaling softens it into a translucent halo.
    # Letterboxing (vs. stretch-to-square) keeps each sprite's proportions.
    with profiler.section("resize", "Letterbox to export size"):
        for direction, img in list(sprites.items()):
            sprites[direction] = _fit_square(img, export_size)

    # ── Step 4: Outline (at final resolution) ────────────────
    await job.push(step_active_event("outline", "Applying pixel outline…" if add_outline else "Outline skipped"))
    if add_outline:
        with profiler.section("outline", "Pixel outline pass"):
            outline_rgb = (0, 0, 0, 255) if outline_color == "black" else (255, 255, 255, 255)
            for direction, img in list(sprites.items()):
                sprites[direction] = _add_outline(img, outline_width, outline_rgb)

    await job.push(step_done_event("outline", "Outline pass complete" if add_outline else "Skipped"))

    # Save individual sprites + emit sprite_ready per direction
    for direction, img in sprites.items():
        sprite_path = out_dir / f"{direction}.png"
        img.save(str(sprite_path), "PNG")

        rel = sprite_path.relative_to(PROJECTS_ROOT)
        sprite_url = f"{OUTPUTS_URL}/{rel.as_posix()}"
        await job.push(make_event("sprite_ready", {
            "direction": direction,
            "image_url": sprite_url,
        }))

    # ── Step 5: Pack ─────────────────────────────────────────
    await job.push(step_active_event("pack", "Packing sprite sheet…"))
    with profiler.section("pack", "Sprite sheet packing"):
        sheet_img, atlas = _pack_sprites(sprites, directions, export_size, sheet_layout)

    sheet_path = out_dir / "sprite_sheet.png"
    atlas_path = out_dir / "atlas.json"

    sheet_img.save(str(sheet_path), "PNG")
    atlas_path.write_text(json.dumps(atlas, indent=2))

    rel_sheet = sheet_path.relative_to(PROJECTS_ROOT)
    rel_atlas = atlas_path.relative_to(PROJECTS_ROOT)
    sheet_url = f"{OUTPUTS_URL}/{rel_sheet.as_posix()}"
    atlas_url = f"{OUTPUTS_URL}/{rel_atlas.as_posix()}"

    await job.push(make_event("sheet_ready", {
        "sheet_url": sheet_url,
        "atlas_url": atlas_url,
        "sheet_path": str(sheet_path),
        "atlas_path": str(atlas_path),
    }))
    await job.push(step_done_event("pack", f"Sheet packed ({sheet_img.width}×{sheet_img.height}px)"))

    # ── Step 6: Save ─────────────────────────────────────────
    await job.push(step_active_event("save", "Writing manifest…"))
    manifest = {
        "job_id":       job.id,
        "smelt_job_id": smelt_job_id,
        "directions":   directions,
        "export_size":  export_size,
        "add_outline":  add_outline,
        "outline_width": outline_width,
        "outline_color": outline_color,
        "sheet_layout": sheet_layout,
        "sheet_url":    sheet_url,
        "atlas_url":    atlas_url,
        "atlas":        atlas,
    }
    (out_dir / "project.json").write_text(json.dumps(manifest, indent=2))
    await job.push(step_done_event("save", "Manifest saved"))

    # ── Done ─────────────────────────────────────────────────
    job.result = manifest
    await job.push(done_event(manifest))


# ── Helpers ──────────────────────────────────────────────────

def _add_outline(img: "Image", width: int, color: tuple) -> "Image":
    """
    Adds a pixel outline around the non-transparent region of an RGBA image.
    Uses repeated MaxFilter passes on the alpha channel (alpha dilation).
    Pure Pillow — no OpenCV needed.
    """
    from PIL import Image, ImageFilter

    r, g, b, alpha = img.split()

    # Dilate alpha by `width` pixels
    dilated_alpha = alpha
    for _ in range(width):
        dilated_alpha = dilated_alpha.filter(ImageFilter.MaxFilter(3))

    # Create solid-color outline layer
    outline_layer = Image.new("RGBA", img.size, color)
    outline_layer.putalpha(dilated_alpha)

    # Composite: outline behind original sprite
    result = Image.new("RGBA", img.size, (0, 0, 0, 0))
    result.paste(outline_layer, (0, 0))
    result.paste(img, (0, 0), mask=alpha)

    return result


def _fit_square(img: "Image", size: int) -> "Image":
    """
    Scale an RGBA sprite to fit a `size`×`size` box preserving aspect ratio,
    then center it on a transparent square canvas. Avoids the fat/thin
    distortion of stretching a non-square crop straight to a square.
    """
    from PIL import Image

    w, h = img.size
    if w == 0 or h == 0:
        return img.resize((size, size), Image.LANCZOS)
    scale = min(size / w, size / h)
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    scaled = img.resize((new_w, new_h), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(scaled, ((size - new_w) // 2, (size - new_h) // 2), mask=scaled.split()[3])
    return canvas


def _pack_sprites(
    sprites: dict[str, "Image"],
    directions: list[str],
    cell_size: int,
    layout: str,
) -> tuple["Image", dict]:
    """
    Pack sprites into a sheet.

    grid layout: 2 columns, N/2 rows (2×2 for 4 dirs, 2×4 for 8 dirs)
    strip layout: 1 row, N columns

    Returns (sheet_image, atlas_dict).
    Atlas dict follows the Godot/Unity atlas convention:
      { frames: [ { name, x, y, w, h } ], meta: { size: {w, h} } }
    """
    from PIL import Image

    n = len(directions)

    if layout == "strip":
        cols, rows = n, 1
    else:
        # Grid: prefer 2 columns
        cols = 2
        rows = (n + cols - 1) // cols

    sheet_w = cols * cell_size
    sheet_h = rows * cell_size
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))

    frames = []
    for i, direction in enumerate(directions):
        col = i % cols
        row = i // cols
        x = col * cell_size
        y = row * cell_size

        img = sprites.get(direction)
        if img is not None:
            # Letterbox to cell size (aspect-preserved) rather than stretch.
            if img.size != (cell_size, cell_size):
                img = _fit_square(img, cell_size)
            sheet.paste(img, (x, y), mask=img.split()[3])

        frames.append({
            "name": direction,
            "x": x,
            "y": y,
            "w": cell_size,
            "h": cell_size,
        })

    atlas = {
        "frames": frames,
        "meta": {
            "size": {"w": sheet_w, "h": sheet_h},
            "cell_size": cell_size,
            "layout": layout,
            "directions": directions,
        },
    }

    return sheet, atlas
