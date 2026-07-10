"""
inference/depth.py — Real monocular depth estimation via Depth Anything V2.

Replaces the distance_transform_edt hack in engine/multiview.py with actual
learned depth maps.  Uses the HuggingFace transformers pipeline for easy
model management (auto-downloads, caches in ~/.cache/huggingface/).

Model variants (pick via INTERFORGE_DEPTH_MODEL env var):
  vits   → 24 M params,  ~2 GB VRAM, real-time
  vitb   → 97 M params,  ~6 GB VRAM, best balance  ← DEFAULT
  vitl   → 335 M params, ~20 GB VRAM, highest quality

Usage:
    from inference.depth import estimate_depth
    depth = estimate_depth(rgba_uint8)   # → float32 (H, W) in [0, 1]
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import numpy as np
from PIL import Image

log = logging.getLogger(__name__)

# ── Lazy-loaded singleton ─────────────────────────────────────

_MODEL_IDS = {
    "vits": "depth-anything/Depth-Anything-V2-Small-hf",
    "vitb": "depth-anything/Depth-Anything-V2-Base-hf",
    "vitl": "depth-anything/Depth-Anything-V2-Large-hf",
}

_pipe: Optional[object] = None
_device: Optional[str] = None


def _get_pipe():
    """Lazy-init the depth estimation pipeline (downloads model on first use)."""
    global _pipe, _device

    if _pipe is not None:
        return _pipe

    import torch
    from transformers import pipeline as hf_pipeline

    variant = os.environ.get("INTERFORGE_DEPTH_MODEL", "vits").lower()
    model_id = _MODEL_IDS.get(variant, _MODEL_IDS["vits"])

    _device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if _device == "cuda" else torch.float32

    log.info(f"[depth] Loading Depth Anything V2 ({variant}) on {_device}…")

    _pipe = hf_pipeline(
        "depth-estimation",
        model=model_id,
        device=_device,
        torch_dtype=dtype,
    )

    log.info(f"[depth] Model loaded: {model_id}")
    return _pipe


def unload():
    """Free VRAM by unloading the depth model."""
    global _pipe, _device
    if _pipe is not None:
        del _pipe
        _pipe = None
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        log.info("[depth] Model unloaded, VRAM freed")


# ── Public API ────────────────────────────────────────────────

def estimate_depth(
    rgba: np.ndarray,
    mask_by_alpha: bool = True,
    normalize: bool = True,
) -> np.ndarray:
    """
    Estimate monocular depth from an RGBA image.

    Parameters
    ----------
    rgba          : uint8 (H, W, 4) RGBA image
    mask_by_alpha : zero out depth where alpha < 32
    normalize     : if True, normalize to [0,1] per-image (False for batch joint normalization)

    Returns
    -------
    float32 (H, W) depth map. If normalize=True, values in [0, 1] where 1 = closest.
    """
    pipe = _get_pipe()

    # Convert RGBA → RGB PIL (white background where transparent)
    h, w = rgba.shape[:2]
    rgb = rgba[:, :, :3].copy()
    alpha = rgba[:, :, 3]
    bg_mask = alpha < 32
    rgb[bg_mask] = 255  # white background for clean depth at edges

    pil_img = Image.fromarray(rgb, "RGB")

    # Run depth estimation
    result = pipe(pil_img)
    depth_pil = result["depth"]  # PIL Image

    # Convert to numpy float32 — RAW model output, no per-view normalization
    depth = np.array(depth_pil.resize((w, h), Image.BILINEAR), dtype=np.float32)

    if normalize:
        # Per-view normalization (only for single-image use, NOT multi-view)
        d_min, d_max = depth.min(), depth.max()
        if d_max - d_min > 1e-6:
            depth = (depth - d_min) / (d_max - d_min)
        else:
            depth = np.zeros_like(depth)

    # Depth Anything V2 outputs "disparity" (closer = higher value).
    # Our convention: 1 = closest to camera, 0 = farthest.
    # The model already outputs in this convention (disparity), so no flip needed.

    # Mask by alpha — zero depth where object isn't present
    if mask_by_alpha:
        alpha_norm = alpha.astype(np.float32) / 255.0
        depth = depth * (alpha_norm > 0.125).astype(np.float32)

    return depth


def estimate_depth_batch(
    images: dict[str, np.ndarray],
) -> dict[str, np.ndarray]:
    """
    Estimate depth for multiple view images with JOINT normalization.

    Unlike single-image depth, multi-view depth maps must share the same
    scale so TSDF fusion sees consistent distances across views. We get
    raw model output for all views, then normalize jointly using the
    global min/max across all foreground pixels.

    Parameters
    ----------
    images : dict mapping angle name → RGBA uint8 array

    Returns
    -------
    dict mapping angle name → float32 depth map in [0, 1], jointly normalized
    """
    # Step 1: Get raw (unnormalized) depth for each view
    raw_depths: dict[str, np.ndarray] = {}
    alpha_masks: dict[str, np.ndarray] = {}
    for angle, rgba in images.items():
        raw_depths[angle] = estimate_depth(rgba, mask_by_alpha=False, normalize=False)
        alpha_masks[angle] = rgba[:, :, 3]

    # Step 2: Find global min/max across all foreground pixels
    all_fg_values = []
    for angle, depth in raw_depths.items():
        fg = alpha_masks[angle] > 32
        if fg.any():
            all_fg_values.append(depth[fg])

    if not all_fg_values:
        log.warning("[depth] No foreground pixels in any view — returning zero depth")
        return {angle: np.zeros_like(d) for angle, d in raw_depths.items()}

    all_fg = np.concatenate(all_fg_values)
    g_min, g_max = float(all_fg.min()), float(all_fg.max())
    log.info(f"[depth] Joint normalization: raw range [{g_min:.1f}, {g_max:.1f}] across {len(raw_depths)} views")

    # Step 3: Normalize all views to [0, 1] using the SAME scale
    depths: dict[str, np.ndarray] = {}
    for angle, depth in raw_depths.items():
        if g_max - g_min > 1e-6:
            normed = (depth - g_min) / (g_max - g_min)
        else:
            normed = np.zeros_like(depth)

        # Mask background
        fg = (alpha_masks[angle].astype(np.float32) / 255.0) > 0.125
        normed = normed * fg.astype(np.float32)

        depths[angle] = normed.astype(np.float32)

    return depths
