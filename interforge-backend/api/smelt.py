"""
POST /api/smelt/all-views ->  start Zero123++ multi-view generation

Single call generates all 6 geometrically consistent views from the
locked prospect image.  Returns a job_id immediately.  Frontend
subscribes to /api/jobs/{job_id}/stream for SSE progress and
VIEW_READY events (one per view).
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.job_manager import create_job, run_job

router = APIRouter()


class SmeltRequest(BaseModel):
    """Generate 6 multi-view images from a prospect reference."""
    prospect_job_id: str            # folder: ~/interforge-projects/{id}/prospect/
    image_index: int = 0            # which image from the prospect batch was locked
    prompt: str
    asset_type: str = "prop"
    art_style: str = "stylized"


@router.post("/api/smelt/all-views")
async def start_smelt_all_views(req: SmeltRequest):
    """
    Generate ALL 6 views in one Zero123++ forward pass.
    Returns job_id immediately — emits VIEW_READY per view + DONE at end.
    """
    if not req.prompt.strip():
        raise HTTPException(status_code=422, detail="Prompt cannot be empty.")
    if not req.prospect_job_id.strip():
        raise HTTPException(status_code=422, detail="prospect_job_id cannot be empty.")

    job = create_job("smelt")

    async def _worker(j):
        params = req.model_dump()
        from workers.smelt_worker import run_smelt_all_views
        await run_smelt_all_views(j, params)

    asyncio.create_task(run_job(job, _worker))

    return {"job_id": job.id, "status": job.status}
