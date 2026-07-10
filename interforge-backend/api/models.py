"""
GET /api/models  ->  list the switchable SDXL models (+ any user-dropped ones).

The returned `id` is what the frontend sends back in a generate request's
`model` field; the engine resolves it via inference.model_registry and loads it
(downloading an hf_repo model on first use). `active` reports which model is
currently resident in the engine, if any.
"""
from __future__ import annotations

from fastapi import APIRouter

from inference.model_registry import list_models

router = APIRouter()


@router.get("/api/models")
def get_models():
    """List available models for the Model picker."""
    from inference.engine import ForgeEngine
    active = ForgeEngine.get().current_model_id()
    return {"models": list_models(), "active": active}
