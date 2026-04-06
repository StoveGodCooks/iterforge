"""
inference/zero123.py — Zero123++ multi-view generation engine.

Generates 6 geometrically consistent views from a single reference image
in one forward pass.  Uses the sudo-ai/zero123plus-v1.2 model via diffusers.

Architecture:
  Zero123Engine is a singleton (same pattern as ForgeEngine).
  Only one model lives in VRAM at a time — the GPU lock in job_manager
  ensures no overlap with SDXL or Depth Anything.

  On an RTX 3070 (8GB), this model runs at ~3-4GB FP16 WITHOUT
  cpu_offload — it fits comfortably and runs faster without offload overhead.

Camera Poses:
  Zero123++ v1.2 outputs 6 views in a 2×3 grid at fixed camera poses.
  CAMERA_POSES exports the exact elevation/azimuth for each view so the
  reconstruction pipeline can build correct extrinsic matrices.

Usage:
    from inference.zero123 import Zero123Engine

    engine = Zero123Engine.get()
    views = engine.generate_views(reference_image)  # dict[str, PIL.Image]
    engine.unload()
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from PIL import Image

log = logging.getLogger(__name__)

# ── Model location ───────────────────────────────────────────

_APPDATA = Path(os.environ.get("APPDATA", str(Path.home())))
_MODEL_DIR = _APPDATA / "IterForge" / "models" / "zero123pp"
_HF_MODEL_ID = "sudo-ai/zero123plus-v1.2"
_HF_PIPELINE_ID = "sudo-ai/zero123plus-pipeline"

# ── Camera poses for the 6 output views ──────────────────────
# Zero123++ v1.2 generates a 2×3 grid (640×960, 320×320 per cell).
# Azimuths: 30° increments starting at 30° (relative to input).
# Elevations: alternate +20° / −10° (left col high, right col low).
# FoV: 30° (unified in v1.2).
#
# Grid layout (row-major):
#   Top-left(0)     Top-right(1)      → az  30° el +20°,  az  90° el -10°
#   Mid-left(2)     Mid-right(3)      → az 150° el +20°,  az 210° el -10°
#   Bot-left(4)     Bot-right(5)      → az 270° el +20°,  az 330° el -10°

CAMERA_POSES: dict[str, dict[str, float]] = {
    "front":       {"azimuth":  30.0, "elevation":  20.0, "radius": 1.5},
    "front_right": {"azimuth":  90.0, "elevation": -10.0, "radius": 1.5},
    "right":       {"azimuth": 150.0, "elevation":  20.0, "radius": 1.5},
    "back":        {"azimuth": 210.0, "elevation": -10.0, "radius": 1.5},
    "left":        {"azimuth": 270.0, "elevation":  20.0, "radius": 1.5},
    "front_left":  {"azimuth": 330.0, "elevation": -10.0, "radius": 1.5},
}

# Ordered list matching the 2×3 grid layout (row-major: top-left → bottom-right)
VIEW_ORDER = ["front", "front_right", "right", "back", "left", "front_left"]


# ── VRAM helpers (shared with engine.py) ─────────────────────

def _log_vram(label: str = "") -> None:
    try:
        import torch
        if torch.cuda.is_available():
            alloc = torch.cuda.memory_allocated() / 1024**3
            reserved = torch.cuda.memory_reserved() / 1024**3
            log.info(f"[vram] {label} allocated={alloc:.2f}GB reserved={reserved:.2f}GB")
    except Exception:
        pass


def _cuda_safe_cleanup() -> None:
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.synchronize()
            torch.cuda.empty_cache()
    except Exception:
        pass


# ── Singleton engine ──────────────────────────────────────────

class Zero123Engine:
    """
    Zero123++ multi-view inference engine.  Singleton — use Zero123Engine.get().
    """

    _instance: Optional["Zero123Engine"] = None

    def __init__(self):
        self._pipe = None
        self._device = None

    @classmethod
    def get(cls) -> "Zero123Engine":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @property
    def is_loaded(self) -> bool:
        return self._pipe is not None

    # ── Load / Unload ────────────────────────────────────────

    def load(self) -> None:
        """Load the Zero123++ pipeline into VRAM."""
        if self._pipe is not None:
            return  # already loaded

        import time
        import torch
        from diffusers import DiffusionPipeline

        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if self._device == "cuda" else torch.float32

        # Try local cache first, fall back to HuggingFace download
        model_path = str(_MODEL_DIR) if _MODEL_DIR.exists() else _HF_MODEL_ID

        log.info(f"[zero123] Loading Zero123++ from {model_path} on {self._device}…")

        t0 = time.perf_counter()

        # Try offline first (no network check), fall back to online download
        try:
            self._pipe = DiffusionPipeline.from_pretrained(
                model_path,
                torch_dtype=dtype,
                custom_pipeline=_HF_PIPELINE_ID,
                local_files_only=True,
            )
        except Exception:
            log.info("[zero123] Local cache miss — downloading from HuggingFace (first run only)…")
            self._pipe = DiffusionPipeline.from_pretrained(
                _HF_MODEL_ID,
                torch_dtype=dtype,
                custom_pipeline=_HF_PIPELINE_ID,
            )
            # Save to local model dir for future offline loads
            try:
                _MODEL_DIR.mkdir(parents=True, exist_ok=True)
                self._pipe.save_pretrained(str(_MODEL_DIR))
                log.info(f"[zero123] Model saved to {_MODEL_DIR} for offline use")
            except Exception as save_exc:
                log.warning(f"[zero123] Could not save model locally: {save_exc}")

        t1 = time.perf_counter()
        log.info(f"[zero123] Pipeline loaded in {t1 - t0:.1f}s")

        # Zero123++ is ~2-3GB FP16 — fits on 8GB without cpu_offload.
        # Running fully on GPU avoids the offload latency penalty.
        if self._device == "cuda":
            t2 = time.perf_counter()
            self._pipe = self._pipe.to(self._device)
            t3 = time.perf_counter()
            log.info(f"[zero123] Moved to {self._device} in {t3 - t2:.1f}s")

        log.info("[zero123] Zero123++ pipeline loaded and ready")
        _log_vram("after Zero123++ load")

    def unload(self) -> None:
        """Free VRAM by unloading the pipeline."""
        if self._pipe is not None:
            del self._pipe
            self._pipe = None
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            log.info("[zero123] Pipeline unloaded, VRAM freed")
            _log_vram("after Zero123++ unload")

    # ── Input preprocessing ────────────────────────────────────

    @staticmethod
    def _preprocess_reference(img: Image.Image) -> Image.Image:
        """
        Prepare a reference image for Zero123++ inference.

        Zero123++ was trained with inputs where the object is:
          1. Centered in a square frame
          2. Occupying ~75% of the frame
          3. Composited on a gray (127,127,127) background

        Matches the official gradio_app.py preprocessing pipeline.
        """
        import numpy as np

        # Ensure RGBA so we can use the alpha for centering
        rgba = img.convert("RGBA")
        arr = np.array(rgba)
        alpha = arr[:, :, 3]

        # Find the bounding box of the foreground object.
        # Use a moderate threshold (128) so we ignore faint shadows,
        # semi-transparent ground planes, and rembg artifacts near
        # the base of the object.  The actual object body typically
        # has alpha > 200, while shadows are 30-100.
        fg = alpha > 128
        if not fg.any():
            # No foreground — just center on gray and return
            side = max(img.size)
            out = Image.new("RGBA", (side, side), (127, 127, 127, 255))
            ox = (side - img.size[0]) // 2
            oy = (side - img.size[1]) // 2
            out.paste(img, (ox, oy))
            return out

        rows = np.any(fg, axis=1)
        cols = np.any(fg, axis=0)
        y0, y1 = np.where(rows)[0][[0, -1]]
        x0, x1 = np.where(cols)[0][[0, -1]]

        # Crop to bounding box
        cropped = rgba.crop((int(x0), int(y0), int(x1) + 1, int(y1) + 1))
        cw, ch = cropped.size

        # Compute canvas size so object fills ~75% of the frame
        side = int(max(cw, ch) / 0.75)

        # Create gray canvas + center the object
        canvas = Image.new("RGBA", (side, side), (127, 127, 127, 255))
        ox = (side - cw) // 2
        oy = (side - ch) // 2
        canvas.paste(cropped, (ox, oy), cropped)   # use alpha as mask

        log.info(
            f"[zero123] Preprocessed reference: {img.size} → "
            f"crop {cw}×{ch} → canvas {side}×{side} "
            f"(object fills {max(cw,ch)/side*100:.0f}%)"
        )
        return canvas

    # ── Multi-view generation ────────────────────────────────

    def generate_views(
        self,
        reference_image: Image.Image,
        num_inference_steps: int = 40,
        guidance_scale: float = 4.0,
    ) -> dict[str, Image.Image]:
        """
        Generate 6 consistent views from a single reference image.

        Returns dict mapping view name → PIL Image:
          "front", "front_right", "right", "back", "left", "front_left"
        """
        if self._pipe is None:
            self.load()

        import time
        import torch

        # Preprocess: center object at ~75% fill on gray background,
        # matching Zero123++ v1.2's training distribution.
        ref = self._preprocess_reference(reference_image)

        log.info(f"[zero123] Generating 6 views ({num_inference_steps} steps)…")
        t0 = time.perf_counter()

        try:
            with torch.inference_mode():
                result = self._pipe(
                    ref,
                    num_inference_steps=num_inference_steps,
                    guidance_scale=guidance_scale,
                )
        except RuntimeError as exc:
            _cuda_safe_cleanup()
            self._pipe = None
            raise RuntimeError(
                f"GPU error during Zero123++ inference — engine reset: {exc}"
            ) from exc

        t1 = time.perf_counter()
        log.info(f"[zero123] Inference completed in {t1 - t0:.1f}s")

        # The output is a single composite image (2 cols × 3 rows grid).
        # Split it into 6 individual view images.
        composite = result.images[0]
        views = self._split_grid(composite)

        log.info(f"[zero123] Generated {len(views)} views successfully")
        return views

    # ── Grid splitting ───────────────────────────────────────

    @staticmethod
    def _split_grid(composite: Image.Image) -> dict[str, Image.Image]:
        """
        Split a 2×3 composite image into 6 individual views.

        Zero123++ v1.2 outputs width=640, height=960 → 2 columns × 3 rows
        of 320×320 cells.  The grid layout is:

          Row 0: [front]       [front_right]
          Row 1: [right]       [back]
          Row 2: [left]        [front_left]
        """
        w, h = composite.size
        cell_w = w // 2   # 640 / 2 = 320
        cell_h = h // 3   # 960 / 3 = 320

        views: dict[str, Image.Image] = {}
        for idx, name in enumerate(VIEW_ORDER):
            col = idx % 2
            row = idx // 2
            x0 = col * cell_w
            y0 = row * cell_h
            views[name] = composite.crop((x0, y0, x0 + cell_w, y0 + cell_h))

        return views


# ── Convenience ───────────────────────────────────────────────

def get_zero123_engine() -> Zero123Engine:
    """Shortcut for Zero123Engine.get()."""
    return Zero123Engine.get()
