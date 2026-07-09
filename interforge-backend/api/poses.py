"""
Pose-library endpoints for the Smelting sprite-sheet UI.

GET /api/poses                    -> list all authored presets
GET /api/poses/{name}/preview.png -> render a preset's OpenPose skeleton
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from core.pose_library import PRESETS, default_sprite_sheet, render_preset_to_png_bytes

router = APIRouter()


@router.get("/api/poses")
async def list_poses():
    """Return preset metadata plus the recommended default sprite-sheet lineup."""
    return {
        "default_sheet": list(default_sprite_sheet()),
        "presets": [
            {
                "name":        p.name,
                "label":       p.label,
                "direction":   p.direction,
                "prompt_hint": p.prompt_hint,
            }
            for p in PRESETS
        ],
    }


@router.get("/api/poses/{name}/preview.png")
async def preview_pose(name: str, size: int = 512):
    """PNG render of the OpenPose skeleton for preview in the UI."""
    size = max(128, min(2048, int(size)))
    try:
        png = render_preset_to_png_bytes(name, size=size)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown pose preset: {name}")
    return Response(content=png, media_type="image/png")
