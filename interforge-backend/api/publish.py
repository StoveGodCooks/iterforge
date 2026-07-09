"""
POST /api/publish/sprite-atlas
  — Pack the 6 Zero123++ views from a smelt job into a PNG sprite atlas.
  — Optional ?include_json=true returns JSON manifest alongside atlas URL.

The atlas is a 3×2 grid (3 columns, 2 rows) of the 6 views at their
original resolution, padded to a uniform cell size. Order matches
Zero123++ output: front, front_right, right, back, left, front_left.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from core.config import PROJECTS_ROOT

router = APIRouter()
log    = logging.getLogger(__name__)

VIEW_ORDER = ["front", "front_right", "right", "back", "left", "front_left"]
VIEW_LABELS = {
    "front":       "Front 0°",
    "front_right": "FR 60°",
    "right":       "Right 120°",
    "back":        "Back 180°",
    "left":        "Left 240°",
    "front_left":  "FL 300°",
}

ATLAS_COLS = 3
ATLAS_ROWS = 2


def _build_atlas(smelt_job_id: str) -> tuple[Path, dict]:
    """
    Load view images from a smelt job and pack them into a PNG atlas.

    Returns (atlas_path, json_manifest).
    """
    from PIL import Image

    smelt_dir = PROJECTS_ROOT / smelt_job_id / "smelt"
    if not smelt_dir.exists():
        raise FileNotFoundError(f"Smelt output not found: {smelt_dir}")

    # Load each view image (RGBA preferred for sprite use)
    images: list[tuple[str, Image.Image]] = []
    for angle in VIEW_ORDER:
        # Try RGBA first, fall back to RGB
        for suffix in ("_rgba.png", ".png"):
            path = smelt_dir / angle / f"image_00{suffix}"
            if path.exists():
                img = Image.open(str(path)).convert("RGBA")
                images.append((angle, img))
                break
        else:
            log.warning(f"[publish] Missing view '{angle}' in {smelt_dir}")

    if not images:
        raise RuntimeError(f"No view images found in {smelt_dir}")

    # Uniform cell size — max width and height across all views
    cell_w = max(img.width  for _, img in images)
    cell_h = max(img.height for _, img in images)

    atlas_w = cell_w * ATLAS_COLS
    atlas_h = cell_h * ATLAS_ROWS
    atlas = Image.new("RGBA", (atlas_w, atlas_h), (0, 0, 0, 0))

    frames: list[dict] = []
    for idx, (angle, img) in enumerate(images):
        col = idx % ATLAS_COLS
        row = idx // ATLAS_COLS
        x   = col * cell_w
        y   = row * cell_h
        # Centre the image in the cell
        ox = (cell_w - img.width)  // 2
        oy = (cell_h - img.height) // 2
        atlas.paste(img, (x + ox, y + oy), img)
        frames.append({
            "name":  angle,
            "label": VIEW_LABELS.get(angle, angle),
            "x": x, "y": y, "w": cell_w, "h": cell_h,
        })

    out_path = smelt_dir / "sprite_atlas.png"
    atlas.save(str(out_path), "PNG")
    log.info(f"[publish] Atlas saved: {out_path} ({atlas_w}×{atlas_h})")

    manifest = {
        "atlas":    "sprite_atlas.png",
        "width":    atlas_w,
        "height":   atlas_h,
        "cell_w":   cell_w,
        "cell_h":   cell_h,
        "cols":     ATLAS_COLS,
        "rows":     ATLAS_ROWS,
        "frames":   frames,
    }

    return out_path, manifest


class SpriteAtlasRequest(BaseModel):
    smelt_job_id: str


@router.post("/api/publish/sprite-atlas")
async def build_sprite_atlas(req: SpriteAtlasRequest, include_json: bool = False):
    """
    Pack 6 smelt views into a PNG sprite atlas.

    ?include_json=true  → returns JSON with atlas_url + frame manifest
    (default)           → returns the PNG file directly
    """
    import asyncio

    if not req.smelt_job_id:
        raise HTTPException(status_code=422, detail="smelt_job_id is required")

    try:
        atlas_path, manifest = await asyncio.to_thread(
            _build_atlas, req.smelt_job_id
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        log.exception("[publish] Atlas build failed")
        raise HTTPException(status_code=500, detail=str(exc))

    if include_json:
        # Derive a URL for the atlas PNG via the /outputs static mount
        rel = atlas_path.relative_to(PROJECTS_ROOT)
        atlas_url = f"/outputs/{rel.as_posix()}"
        return JSONResponse({"atlas_url": atlas_url, "json": manifest})

    return FileResponse(
        str(atlas_path),
        media_type="image/png",
        filename="sprite_atlas.png",
    )
