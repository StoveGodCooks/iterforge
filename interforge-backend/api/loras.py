"""
GET /api/loras  ->  list the LoRA .safetensors files available on disk.

Scans MODELS_ROOT/loras/*.safetensors. The returned `id` (filename stem) is
what the frontend sends back in a generate request's `loras` list; the engine
resolves it to MODELS_ROOT/loras/{id}.safetensors.
"""
from __future__ import annotations

import re

from fastapi import APIRouter

from core.config import MODELS_ROOT

router = APIRouter()

LORAS_DIR = MODELS_ROOT / "loras"


def _prettify(stem: str) -> str:
    """Best-effort human label: split camelCase + separators, title-case if all-lower."""
    s = stem.replace("_", " ").replace("-", " ")
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)   # camelCase -> spaced
    s = re.sub(r"\s+", " ", s).strip()
    return s.title() if s.islower() else s


@router.get("/api/loras")
def list_loras():
    """List available LoRA files (id = filename stem, used to select in requests)."""
    out = []
    if LORAS_DIR.is_dir():
        for f in sorted(LORAS_DIR.glob("*.safetensors")):
            out.append({
                "id":       f.stem,
                "name":     _prettify(f.stem),
                "filename": f.name,
                "size_mb":  round(f.stat().st_size / (1024 * 1024), 1),
            })
    return {"loras": out}
