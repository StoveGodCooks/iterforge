"""
POST /api/forge2d  →  2D sprite pipeline

Takes directional images from a 2D smelt job and produces a cleaned,
trimmed, optionally outlined sprite sheet + atlas JSON.

Steps (IDs match forge2d_worker.py):
  1. load     — resolve direction images from smelt job folder
  2. rembg    — background removal on each sprite
  3. trim     — auto-crop to tight bounding box
  4. outline  — optional pixel outline via alpha dilation
  5. pack     — Pillow sprite sheet + atlas JSON
  6. save     — write manifest

Returns job_id immediately. Subscribe to /api/jobs/{job_id}/stream for SSE.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.job_manager import create_job, spawn_job

router = APIRouter()


class TwoDForgeRequest(BaseModel):
    smelt_job_id: str               # folder: ~/interforge-projects/{id}/smelt/
    directions: list[str] = ["front", "back", "left", "right"]

    # Outline pass
    add_outline: bool = True
    outline_width: int = 2          # pixels
    outline_color: str = "black"    # "black" | "white"

    # Export
    export_size: int = 256          # final px per sprite (64 / 128 / 256 / 512)
    sheet_layout: str = "grid"      # "grid" (2×2 or 2×4) | "strip" (1 row)


@router.post("/api/forge2d")
async def start_forge2d(req: TwoDForgeRequest):
    """
    Run the 2D sprite pipeline on a completed 2D smelt job.
    Returns job_id immediately — subscribe to SSE for progress.
    """
    if not req.smelt_job_id.strip():
        raise HTTPException(status_code=422, detail="smelt_job_id cannot be empty.")
    if not req.directions:
        raise HTTPException(status_code=422, detail="At least one direction is required.")
    if req.export_size not in (64, 128, 256, 512, 1024):
        raise HTTPException(status_code=422, detail="export_size must be 64, 128, 256, 512, or 1024.")

    job = create_job("forge2d")

    async def _worker(j):
        params = req.model_dump()
        from workers.forge2d_worker import run_forge2d
        await run_forge2d(j, params)

    spawn_job(job, _worker)

    return {"job_id": job.id, "status": job.status}
