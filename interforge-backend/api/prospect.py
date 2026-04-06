"""
POST /api/prospect  →  start a Prospecting job
GET  /api/prospect/svg  →  re-run SVG analysis on an existing image
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.job_manager import create_job, run_job

router = APIRouter()


class ProspectRequest(BaseModel):
    prompt: str
    neg_prompt: str = ""
    asset_type: str = "prop"
    art_style: str = "stylized"
    lighting_preset: str | None = None
    seed: int = -1
    batch_size: int | None = None
    reference_image_path: str | None = None   # local path to img2img source


class SvgRequest(BaseModel):
    image_path: str    # absolute path to a PNG already saved to disk
    detail: float = 0.6


@router.post("/api/prospect")
async def start_prospect(req: ProspectRequest):
    """
    Start a Prospecting job. Returns job_id immediately.
    Frontend subscribes to /api/jobs/{job_id}/stream for SSE progress.
    """
    if not req.prompt.strip():
        raise HTTPException(status_code=422, detail="Prompt cannot be empty.")

    # Pre-validate prompt before wasting a GPU pass
    from masterforge.prompt_templates import validate_prompt
    validation = validate_prompt(req.prompt, req.asset_type)
    if not validation.valid:
        raise HTTPException(status_code=422, detail=validation.errors[0])

    job = create_job("prospect")

    async def _worker(j):
        params = req.model_dump()
        from workers.prospect_worker import run_prospect
        await run_prospect(j, params)

    asyncio.create_task(run_job(job, _worker))

    return {"job_id": job.id, "status": job.status}


@router.post("/api/prospect/svg")
async def regen_svg(req: SvgRequest):
    """
    Re-run SVG analysis on an existing RGBA image.
    Used by the 'Regen SVG' button in the Prospecting tab.
    Returns svg_data directly (no job/SSE — fast enough for sync response).
    """
    from core.postprocess import trace_to_svg

    path = Path(req.image_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Image not found.")

    rgba_bytes = path.read_bytes()
    svg_data = await asyncio.to_thread(trace_to_svg, rgba_bytes, req.detail)
    return {"svg_data": svg_data}
