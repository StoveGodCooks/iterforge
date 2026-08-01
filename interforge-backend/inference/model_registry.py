"""
inference/model_registry.py — the pluggable model adapter/registry.

Every switchable model is one `ModelDef` record. Adding an SDXL checkpoint is a
one-line entry in BUILTINS; adding a whole new architecture (e.g. FLUX) is a new
`kind` branch in ForgeEngine.load_model() plus its pipeline class. The registry
itself is license-agnostic — it just describes and locates models. Whether a
given model's weights may be redistributed is a distribution decision recorded
in each entry's `license` field (see LICENSES.md at the repo root).

Resolution: `source_type == "local_file"` -> CHECKPOINTS_DIR/<source> (loads via
from_single_file); `source_type == "hf_repo"` -> the repo id verbatim (loads via
from_pretrained, downloaded once on first use, then offline).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Optional

from core.config import CHECKPOINTS_DIR


@dataclass(frozen=True)
class ModelDef:
    id: str            # stable id sent from the UI (e.g. "sdxl-base")
    label: str         # human label for the picker
    kind: str          # "sdxl" | "flux" — selects the pipeline/adapter
    source_type: str   # "hf_repo" | "local_file"
    source: str        # HF repo id, or a filename under CHECKPOINTS_DIR
    note: str          # one-line description shown under the label
    license: str       # license id (for the badge + compliance)
    default: bool = False
    enabled: bool = True   # False = shown but not selectable (e.g. FLUX stub)


# ── Built-in registry ─────────────────────────────────────────
# Order = display order. Exactly one entry should have default=True.
BUILTINS: list[ModelDef] = [
    ModelDef(
        id="sdxl-base", label="Stable Diffusion XL",
        kind="sdxl", source_type="hf_repo",
        source="stabilityai/stable-diffusion-xl-base-1.0",
        note="Neutral base — the cleanest LoRA canvas. Pair with a style LoRA.",
        license="OpenRAIL++-M", default=True,
    ),
    ModelDef(
        id="ssd-1b", label="SSD-1B (fast)",
        kind="sdxl", source_type="hf_repo",
        source="segmind/SSD-1B",
        note="Distilled SDXL — ~2.5 GB, faster. Fully-open Apache license.",
        license="Apache-2.0",
    ),
    ModelDef(
        id="samaritan", label="Samaritan 3D Cartoon",
        kind="sdxl", source_type="hf_repo",
        source="imagepipeline/Samaritan-3d-Cartoon-v4-SDXL",
        note="Cartoon/matte — best for clean 3D meshes.",
        license="OpenRAIL-M",
    ),
    ModelDef(
        id="dreamshaper", label="DreamShaper XL",
        kind="sdxl", source_type="local_file",
        # Filename must match what setup downloads AND what users already have
        # on disk. (The Lykon URL serves Turbo weights under this v2_1 name.)
        source="DreamShaperXL_v2_1.safetensors",
        note="Versatile artistic SDXL — strong 2D art (not mesh-friendly).",
        license="OpenRAIL-M",
    ),
    ModelDef(
        id="flux", label="FLUX.1 dev",
        kind="flux", source_type="hf_repo",
        source="black-forest-labs/FLUX.1-dev",
        note="Top-quality — coming soon (16 GB tier).",
        license="FLUX.1-dev Non-Commercial", enabled=False,
    ),
]

_BY_ID: dict[str, ModelDef] = {m.id: m for m in BUILTINS}


def default_model() -> ModelDef:
    """The shipped default (base SDXL)."""
    for m in BUILTINS:
        if m.default:
            return m
    return BUILTINS[0]


DEFAULT_ID = default_model().id


def _prettify(stem: str) -> str:
    """Human label for a user-dropped checkpoint filename."""
    s = stem.replace("_", " ").replace("-", " ")
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s.title() if s.islower() else s


def _scanned_models() -> list[ModelDef]:
    """
    User-dropped .safetensors checkpoints not already covered by a builtin.
    Mirrors api/loras.py's dir-scan so anyone can plug in their own model.
    """
    out: list[ModelDef] = []
    known_files = {m.source for m in BUILTINS if m.source_type == "local_file"}
    if CHECKPOINTS_DIR.is_dir():
        for f in sorted(CHECKPOINTS_DIR.glob("*.safetensors")):
            if f.name in known_files:
                continue
            out.append(ModelDef(
                id=f"local:{f.stem}", label=_prettify(f.stem),
                kind="sdxl", source_type="local_file", source=f.name,
                note="User checkpoint (dropped in the models folder).",
                license="unknown",
            ))
    return out


def get_model(model_id: Optional[str]) -> ModelDef:
    """Resolve an id to a ModelDef, falling back to the default. Includes
    scanned local checkpoints so a `local:*` id resolves too."""
    if model_id:
        if model_id in _BY_ID:
            return _BY_ID[model_id]
        for m in _scanned_models():
            if m.id == model_id:
                return m
    return default_model()


def resolve_source(m: ModelDef) -> str:
    """Map a ModelDef to what ForgeEngine.load(checkpoint=...) expects:
    a local file path (from_single_file) or an HF repo id (from_pretrained)."""
    if m.source_type == "local_file":
        return str(CHECKPOINTS_DIR / m.source)
    return m.source


def _hf_cached(repo_id: str) -> bool:
    """Has this repo already been pulled into the local HF cache?

    The picker badged every hf_repo model "↓ download" because it keyed off
    `local`, which only ever meant "a .safetensors sitting in CHECKPOINTS_DIR".
    A fully cached 6.7 GB SDXL base still advertised a download. Checking the
    cache directly is what the badge actually wanted to know.
    """
    try:
        from huggingface_hub.constants import HF_HUB_CACHE
        snaps = Path(HF_HUB_CACHE) / f"models--{repo_id.replace('/', '--')}" / "snapshots"
        if not snaps.is_dir():
            return False
        # A ref directory with no snapshot in it is an interrupted download.
        return any(any(s.iterdir()) for s in snaps.iterdir() if s.is_dir())
    except Exception:
        # Never let a cache probe take the model picker down.
        return False


def list_models() -> list[dict]:
    """Full picker payload: builtins + scanned local checkpoints, each tagged
    with `downloaded` so the UI can flag what still needs fetching."""
    out: list[dict] = []
    for m in [*BUILTINS, *_scanned_models()]:
        if m.source_type == "local_file":
            downloaded = (CHECKPOINTS_DIR / m.source).exists()
        else:
            downloaded = _hf_cached(m.source)
        out.append({
            "id": m.id,
            "label": m.label,
            "kind": m.kind,
            "note": m.note,
            "license": m.license,
            "default": m.default,
            "enabled": m.enabled,
            "local": m.source_type == "local_file",
            # On disk and ready to load — the flag the picker should badge on.
            "downloaded": downloaded,
            # Kept for older callers; it meant the same thing for local files
            # and was hardcoded true for hf_repo.
            "available": downloaded if m.source_type == "local_file" else True,
        })
    return out
