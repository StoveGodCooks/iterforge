"""
vectorize.py — Convert a rembg boolean mask to SVG via vtracer.

Step 2.5 in the MasterForge pipeline: mask → SVG → trace_svg() (exact CadQuery math)
instead of mask → trace_contour() (raster marching-squares approximation).
"""

import os
import tempfile
import numpy as np


def mask_to_svg(mask: np.ndarray, output_path: str) -> str:
    """
    Convert a boolean (H, W) mask to SVG via vtracer.

    Args:
        mask:        2-D boolean array, True = foreground.
        output_path: Destination .svg path.

    Returns:
        output_path on success; raises RuntimeError if vtracer is unavailable.
    """
    try:
        import vtracer
    except ImportError:
        raise RuntimeError(
            'vtracer is not installed — run: pip install vtracer\n'
            'Falling back to raster trace_contour() path.'
        )

    # Build an RGBA image: white foreground, black background, fully opaque
    h, w = mask.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[mask]  = [255, 255, 255, 255]   # foreground
    rgba[~mask] = [0,   0,   0,   255]   # background

    # vtracer.convert_raw_image_to_svg expects a flat list of (R,G,B,A) tuples
    pixels = [tuple(int(v) for v in px) for px in rgba.reshape(-1, 4)]

    svg_str = vtracer.convert_raw_image_to_svg(
        pixels,
        size=(w, h),
        colormode='binary',       # black/white only — no color quantisation
        hierarchical='stacked',   # outer path only, no hole punching
        mode='polygon',           # straight lines → cleaner CadQuery import
        filter_speckle=4,         # drop isolated noise blobs < 4 px²
        color_precision=6,
        layer_difference=16,
        corner_threshold=60,
        length_threshold=4.0,
        splice_threshold=45,
    )

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(svg_str)

    return output_path
