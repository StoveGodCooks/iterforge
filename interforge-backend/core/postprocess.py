"""
Image post-processing — rembg background removal + vtracer SVG extraction.

Flow per image:
  Raw PNG → rembg → RGBA PNG → vtracer → SVG string

Files are saved to the project's prospect/ folder and served via
the /outputs static mount in main.py.
"""
from __future__ import annotations

import asyncio
import io
from pathlib import Path

from PIL import Image


# ── rembg ─────────────────────────────────────────────────────
# Lazy-load to avoid paying startup cost when not needed.
# First call downloads the U2Net model (~175 MB) if not cached.
_rembg_session = None

def _get_rembg_session():
    global _rembg_session
    if _rembg_session is None:
        from rembg import new_session
        _rembg_session = new_session("u2net")
    return _rembg_session


def remove_background(png_bytes: bytes) -> bytes:
    """Run rembg background removal. Returns RGBA PNG bytes."""
    from rembg import remove
    session = _get_rembg_session()
    return remove(png_bytes, session=session)


# ── vtracer ───────────────────────────────────────────────────

def trace_to_svg(rgba_bytes: bytes, detail: float = 0.6) -> str:
    """
    Convert RGBA PNG bytes to an SVG string using vtracer.

    detail (0.0–1.0) controls path precision:
      low detail  → fewer, smoother paths (good for silhouette)
      high detail → more paths, captures fine structure
    """
    import vtracer

    img = Image.open(io.BytesIO(rgba_bytes)).convert("RGBA")

    # Map detail slider to vtracer parameters.
    # filter_speckle:  lower = keep smaller details
    # color_precision: higher = more accurate colors
    # path_precision:  higher = more path nodes
    filter_speckle  = max(1, int(20 * (1.0 - detail)))
    color_precision = max(4, int(6 + detail * 2))
    path_precision  = max(3, int(3 + detail * 5))

    # Convert PIL RGBA → raw pixel bytes for vtracer
    pixels = list(img.getdata())
    flat   = [v for px in pixels for v in px]   # RGBA flat list

    svg_str = vtracer.convert_pixels_to_svg(
        flat,
        size=(img.width, img.height),
        colormode="binary",        # silhouette + structure
        filter_speckle=filter_speckle,
        color_precision=color_precision,
        layer_difference=16,
        corner_threshold=60,
        length_threshold=4.0,
        max_iterations=10,
        splice_threshold=45,
        path_precision=path_precision,
    )

    # Strip the outer <svg> wrapper — we inject our own in the frontend.
    # Keep only the inner <path> elements.
    import re
    inner = re.sub(r"<\?xml[^>]*\?>", "", svg_str)
    inner = re.sub(r"<svg[^>]*>", "", inner)
    inner = re.sub(r"</svg>", "", inner)
    return inner.strip()


# ── File helpers ──────────────────────────────────────────────

async def save_and_process_image(
    raw_png: bytes,
    out_dir: Path,
    index: int,
    detail: float = 0.6,
) -> dict:
    """
    Save the raw PNG, run rembg + vtracer, save RGBA + SVG.
    All blocking work runs in a thread so we don't stall the event loop.

    Returns a dict with paths and svg_data for the SSE event.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    raw_path  = out_dir / f"image_{index:02d}.png"
    rgba_path = out_dir / f"image_{index:02d}_rgba.png"
    svg_path  = out_dir / f"image_{index:02d}.svg"

    # Save raw
    raw_path.write_bytes(raw_png)

    # rembg + vtracer in thread (both are CPU-bound)
    def _process():
        rgba_bytes = remove_background(raw_png)
        rgba_path.write_bytes(rgba_bytes)
        svg_data = trace_to_svg(rgba_bytes, detail=detail)
        svg_path.write_text(svg_data, encoding="utf-8")
        return rgba_bytes, svg_data

    _, svg_data = await asyncio.to_thread(_process)

    return {
        "index":     index,
        "raw_path":  str(raw_path),
        "rgba_path": str(rgba_path),
        "svg_path":  str(svg_path),
        "svg_data":  svg_data,
    }
