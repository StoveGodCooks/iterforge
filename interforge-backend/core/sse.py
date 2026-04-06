"""
SSE event helpers.

All pipeline stages stream progress via Server-Sent Events.
Each event has a type and a JSON payload so the frontend can
update its UI without polling.
"""
from __future__ import annotations
import json
from enum import Enum
from typing import Any


class EventType(str, Enum):
    # Generic lifecycle
    PROGRESS    = "progress"
    STEP_ACTIVE = "step_active"   # Forge: a pipeline step has started
    STEP_DONE   = "step_done"     # Forge: a pipeline step completed
    DONE        = "done"
    ERROR       = "error"
    LOG         = "log"

    # Stage-specific
    IMAGE_READY   = "image_ready"    # Prospecting: one image generated
    SVG_READY     = "svg_ready"      # Prospecting: SVG analysis complete
    VIEW_READY    = "view_ready"     # Smelting: one multi-view render done
    MESH_READY    = "mesh_ready"     # Forge: export mesh available


def make_event(event_type: EventType, data: dict[str, Any]) -> str:
    """
    Format a single SSE message.
    The frontend listens with EventSource and parses event.data as JSON.
    """
    payload = json.dumps({"type": event_type, **data})
    return f"data: {payload}\n\n"


def progress_event(step: int, total: int, message: str) -> str:
    return make_event(EventType.PROGRESS, {
        "step": step,
        "total": total,
        "pct": round(step / total * 100) if total else 0,
        "message": message,
    })


def done_event(data: dict[str, Any]) -> str:
    return make_event(EventType.DONE, data)


def error_event(code: str, message: str) -> str:
    """
    Critical pipeline failure.
    code format: ERROR_<STAGE>_<CODE>  e.g. ERROR_FORGE_MESH_RECONSTRUCT
    """
    return make_event(EventType.ERROR, {"code": code, "message": message})


def log_event(message: str) -> str:
    return make_event(EventType.LOG, {"message": message})


def step_active_event(step_id: str, description: str = "") -> str:
    """Emitted when a Forge pipeline step begins executing."""
    return make_event(EventType.STEP_ACTIVE, {
        "step_id":     step_id,
        "description": description,
    })


def step_done_event(step_id: str, output: str = "") -> str:
    """Emitted when a Forge pipeline step completes successfully."""
    return make_event(EventType.STEP_DONE, {
        "step_id": step_id,
        "output":  output,
    })
