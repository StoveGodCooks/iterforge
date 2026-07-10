"""
Centralized configuration — single source of truth for paths and URLs.

All workers and modules import from here instead of duplicating constants.
Values can be overridden via environment variables.
"""
from __future__ import annotations

import os
from pathlib import Path

# ── Project output root ──────────────────────────────────────
PROJECTS_ROOT = Path(os.environ.get(
    "INTERFORGE_PROJECTS_DIR",
    str(Path.home() / "interforge-projects"),
))

# ── Backend API ──────────────────────────────────────────────
BACKEND_HOST = os.environ.get("INTERFORGE_BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = int(os.environ.get("INTERFORGE_BACKEND_PORT", "7842"))
OUTPUTS_URL  = f"http://{BACKEND_HOST}:{BACKEND_PORT}/outputs"

# ── Model storage ───────────────────────────────────────────
# Where SDXL checkpoints, LoRAs, and other model files live.
# Defaults to the IterForge AppData bundle.
MODELS_ROOT = Path(os.environ.get(
    "INTERFORGE_MODELS_DIR",
    os.path.join(os.environ.get("APPDATA", str(Path.home())), "IterForge", "models"),
))

# SDXL checkpoints live here (both the registry's known models and any the user
# drops in by hand). Centralized so engine.py / status.py / the model registry
# all agree on one path.
CHECKPOINTS_DIR = MODELS_ROOT / "checkpoints"

# ── Reconstruction mode ──────────────────────────────────────
# "tsdf"        → Depth Anything V2 + TSDF volumetric fusion (best quality)
# "visual_hull" → alpha silhouette space carving (no depth model needed)
# "auto"        → try TSDF first, fall back to visual hull
RECON_MODE = os.environ.get("INTERFORGE_RECON_MODE", "auto").lower()
