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


def erode_alpha(rgba_bytes: bytes, erode_px: int) -> bytes:
    """
    Erode the alpha channel of an RGBA PNG by `erode_px` pixels. Use this to
    clean fringe on images that already have transparency (e.g. upstream-
    rembg'd Zero123++ views) without re-running the U2Net inference.
    """
    if erode_px <= 0:
        return rgba_bytes

    import numpy as np
    from scipy.ndimage import binary_erosion

    img = Image.open(io.BytesIO(rgba_bytes)).convert("RGBA")
    arr = np.array(img)
    alpha = arr[:, :, 3]

    mask = alpha > 32
    eroded = binary_erosion(mask, iterations=int(erode_px))

    arr[:, :, 3] = np.where(eroded, alpha, 0).astype(np.uint8)
    arr[~eroded, 0:3] = 0

    out = Image.fromarray(arr, mode="RGBA")
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


def clip_floor_shadow(
    rgba_bytes: bytes,
    bottom_frac: float = 0.08,
    luminance_threshold: float = 0.22,
    saturation_threshold: float = 0.22,
    shadow_aspect_min: float = 1.5,
) -> bytes:
    """
    Strip ground / drop shadows that rembg keeps attached to the silhouette.

    Operates only within the bottom ``bottom_frac`` of the figure bbox (default
    0.08 — the very bottom sliver below the feet). A pixel is treated as
    shadow when its HSV value is below ``luminance_threshold`` AND its
    saturation is below ``saturation_threshold``.

    Shape filter (new): candidate shadow pixels are connected-component
    labeled, and only components whose bounding-box width exceeds
    ``shadow_aspect_min`` × height are clipped. Real drop shadows splay
    horizontally; legs, boots, and trailing cloaks are vertical. This
    preserves dark extremities that the old thresholds chewed off.

    Returns the same RGBA PNG if no shadow pixels are found.
    """
    import numpy as np
    from scipy.ndimage import label, find_objects

    img = Image.open(io.BytesIO(rgba_bytes)).convert("RGBA")
    arr = np.array(img)
    alpha = arr[:, :, 3]

    mask = alpha > 32
    if not mask.any():
        return rgba_bytes

    ys, _ = np.where(mask)
    y_min, y_max = int(ys.min()), int(ys.max())
    h_fig = max(1, y_max - y_min + 1)
    bottom_y_start = int(y_max - h_fig * bottom_frac)

    rgb_f = arr[:, :, :3].astype(np.float32) / 255.0
    max_c = rgb_f.max(axis=2)
    min_c = rgb_f.min(axis=2)
    saturation = np.where(max_c > 0, (max_c - min_c) / (max_c + 1e-6), 0.0)
    value = max_c

    row_idx = np.arange(arr.shape[0])[:, None]
    candidate = (
        mask
        & (row_idx >= bottom_y_start)
        & (value < luminance_threshold)
        & (saturation < saturation_threshold)
    )

    if not candidate.any():
        return rgba_bytes

    # Connected-component shape filter — keep vertical clusters (legs,
    # cloaks, tails); drop flat wide clusters (real drop shadows).
    labeled, n_components = label(candidate)
    if n_components == 0:
        return rgba_bytes

    shadow_mask = np.zeros_like(candidate)
    slices = find_objects(labeled)
    for cid in range(1, n_components + 1):
        sl = slices[cid - 1]
        if sl is None:
            continue
        y_slice, x_slice = sl
        comp_h = max(1, y_slice.stop - y_slice.start)
        comp_w = max(1, x_slice.stop - x_slice.start)
        if comp_w >= shadow_aspect_min * comp_h:
            shadow_mask |= (labeled == cid)

    if not shadow_mask.any():
        return rgba_bytes

    arr[:, :, 3] = np.where(shadow_mask, 0, arr[:, :, 3]).astype(np.uint8)
    arr[shadow_mask, 0:3] = 0

    out = Image.fromarray(arr, mode="RGBA")
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


def luminance_key(
    rgba_bytes: bytes,
    bg_color: tuple[int, int, int] = (127, 127, 127),
    tolerance: int = 14,
    feather_px: int = 1,
) -> bytes:
    """
    Fast background removal for images printed on a flat, known color.

    Zero123++ outputs 6 views composited onto RGB(127,127,127) gray — no
    lighting information embedded in the background. For these we don't
    need U2Net's ~3-5s per-image saliency inference; a simple color distance
    key runs in ~50ms per view and produces a cleaner edge because there
    is no mis-classification risk on dark silhouette pixels.

    The test is euclidean distance in RGB space against ``bg_color``:
    pixels within ``tolerance`` are made transparent, pixels outside stay
    opaque. ``feather_px`` runs a 1-pixel binary erosion on the keep mask
    to chew the sub-pixel fringe where rasterized silhouette edges partly
    mix with the gray background.

    Caller should still run ``clip_floor_shadow`` afterward for ground
    shadows — those are darker than 127 and would pass the key cleanly,
    looking like real geometry. The shadow clipper catches them.
    """
    import numpy as np

    img = Image.open(io.BytesIO(rgba_bytes)).convert("RGBA")
    arr = np.array(img)
    rgb = arr[:, :, :3].astype(np.int16)

    bg = np.array(bg_color, dtype=np.int16).reshape(1, 1, 3)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    keep = dist > tolerance

    if feather_px > 0:
        from scipy.ndimage import binary_erosion
        keep = binary_erosion(keep, iterations=int(feather_px))

    alpha = np.where(keep, 255, 0).astype(np.uint8)
    arr[:, :, 3] = alpha
    arr[~keep, 0:3] = 0

    out = Image.fromarray(arr, mode="RGBA")
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


async def save_and_process_view_luma(
    raw_png: bytes,
    out_dir: Path,
    index: int = 0,
    bg_color: tuple[int, int, int] = (127, 127, 127),
    tolerance: int = 14,
    detail: float = 0.5,
) -> dict:
    """
    Luminance-key flavored of ``save_and_process_image`` for Zero123++
    views. Skips U2Net entirely (~60× faster per view) and uses the known
    gray background as the key. Still runs ``clip_floor_shadow`` to zap
    ground-contact shadows and vtracer to produce an SVG.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    raw_path  = out_dir / f"image_{index:02d}.png"
    rgba_path = out_dir / f"image_{index:02d}_rgba.png"
    svg_path  = out_dir / f"image_{index:02d}.svg"

    raw_path.write_bytes(raw_png)

    def _process():
        rgba_bytes = luminance_key(raw_png, bg_color=bg_color, tolerance=tolerance)
        rgba_bytes = clip_floor_shadow(rgba_bytes)
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


def remove_background(
    png_bytes: bytes,
    edge_erode_px: int = 5,
    clip_shadows: bool = True,
) -> bytes:
    """
    Run rembg background removal, then erode the alpha mask by `edge_erode_px`
    pixels to eat any fringe leftovers (shadow halos, matte bleed, sub-pixel
    hair/fur crumbs). Returns RGBA PNG bytes.

    Why erode:
        U2Net is conservative near ground-contact shadows — it often keeps a
        few pixels of shadow attached to feet/bases because they share color
        with the object edge. A small erosion (3–5 px) reliably removes that
        fringe without eating real silhouette detail at our 1024px render size.

    Why clip_shadows:
        Erosion alone can't remove large soft ground shadows that U2Net kept
        as a dark oval under the figure. ``clip_floor_shadow`` zeroes those
        pixels using an HSV dark-and-desaturated test restricted to the
        bottom of the figure bbox.

    edge_erode_px: pixels to erode. 0 disables. Default 5 is safe for 1024px
        images. Drop to 2–3 if fine detail (hair wisps, weapon tips) vanishes.
    clip_shadows: run the floor-shadow clipper after erosion (default on).
    """
    from rembg import remove
    session = _get_rembg_session()
    rgba_bytes = remove(png_bytes, session=session)
    rgba_bytes = erode_alpha(rgba_bytes, edge_erode_px)
    if clip_shadows:
        rgba_bytes = clip_floor_shadow(rgba_bytes)
    return rgba_bytes


# ── vtracer ───────────────────────────────────────────────────

def trace_to_svg(rgba_bytes: bytes, detail: float = 0.6) -> str:
    """
    Convert RGBA PNG bytes to an SVG string using vtracer in COLOR mode.

    Color mode captures internal edges (armor seams, belt lines, facial
    structure, hair parts) as separate path layers, not just the outer
    silhouette. These internal edges are fed into the 3D reconstruction
    pipeline as concavity hints — a feature the old binary mode couldn't
    provide.

    detail (0.0–1.0) controls path precision and how finely colors are
    split into layers:
      low detail  → fewer layers, broad regions, smoother paths
      high detail → more layers, captures subtle tonal edges
    """
    import vtracer

    img = Image.open(io.BytesIO(rgba_bytes)).convert("RGBA")

    # Map detail slider to vtracer parameters.
    # filter_speckle:  lower = keep smaller details
    # color_precision: higher = more color bits retained per layer
    # layer_difference: lower = more layers (more internal edges captured)
    # path_precision:  higher = more path nodes
    filter_speckle   = max(1, int(20 * (1.0 - detail)))
    color_precision  = max(4, int(6 + detail * 2))
    layer_difference = max(8, int(24 - detail * 16))   # 24 at low detail → 8 at high
    path_precision   = max(3, int(3 + detail * 5))

    # Convert PIL RGBA → raw pixel bytes for vtracer
    pixels = list(img.getdata())
    flat   = [v for px in pixels for v in px]   # RGBA flat list

    svg_str = vtracer.convert_pixels_to_svg(
        flat,
        size=(img.width, img.height),
        colormode="color",         # multi-layer trace — internal edges preserved
        filter_speckle=filter_speckle,
        color_precision=color_precision,
        layer_difference=layer_difference,
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


# ── Character sheet splitter ──────────────────────────────────
#
# SDXL strongly prefers to output character turnaround sheets when asked
# for a single character with an explicit view direction. Instead of
# fighting this bias with prompt engineering, we lean into it: generate
# ONE image containing front + back figures side-by-side, then split it
# programmatically via connected-component analysis on the alpha mask.
#
# Advantages over two separate IP-Adapter generations:
#   - Automatic consistency (same lighting, proportions, materials)
#   - ~Half the generation time (1 SDXL pass vs 2)
#   - No "back-view drifts toward front" problem from IP-Adapter bias

def split_character_sheet(
    rgba_bytes: bytes,
    min_component_fraction: float = 0.03,
    output_size: int = 1024,
    margin: float = 0.08,
    bridge_break_px: int = 8,
) -> list[bytes]:
    """
    Split a character turnaround RGBA PNG into separate centered square PNGs.

    Finds connected components in the alpha channel, filters by area,
    sorts left-to-right by x-centroid, and returns one RGBA PNG per
    component — each cropped to its bbox and pasted onto a centered
    transparent square canvas.

    For a typical front/back turnaround, the returned list has 2 entries:
      [front_png_bytes, back_png_bytes]  (ordered left→right)

    Callers should validate the list length before trusting the split
    (bad generations may yield 1, 3, or more components).

    Bridge breaking: before labeling, the alpha mask is morphologically
    eroded by ``bridge_break_px`` pixels so that thin connectors between
    figures (soft ground shadows, overlapping capes, touching weapons)
    don't collapse two figures into one component. Eroded components are
    then regrown into the original silhouette via nearest-seed assignment
    so the final crops keep every real pixel of each figure.

    min_component_fraction: components smaller than this fraction of the
                             image area are discarded as noise.
    output_size: edge length of the square canvas each figure is centered on.
    margin: fraction of output_size to leave as padding around each figure.
    bridge_break_px: erosion radius applied before labeling (0 disables).
    """
    from scipy.ndimage import (
        label, find_objects, binary_erosion, distance_transform_edt,
    )
    import numpy as np

    img = Image.open(io.BytesIO(rgba_bytes)).convert("RGBA")
    arr = np.array(img)
    h, w = arr.shape[:2]
    alpha = arr[:, :, 3]

    binary = alpha > 32

    # Pre-erode so thin bridges (shadow halos, grazing capes) break into
    # separate components. Then regrow the eroded labels back into the
    # original silhouette so no real pixels are lost.
    labeled = None
    n_components = 0
    if bridge_break_px > 0:
        eroded = binary_erosion(binary, iterations=int(bridge_break_px))
        e_labeled, e_n = label(eroded)
        if e_n >= 2:
            # Nearest-seed fill: every original-binary pixel adopts the
            # label of the closest eroded component.
            _, indices = distance_transform_edt(
                e_labeled == 0, return_distances=True, return_indices=True,
            )
            regrown = e_labeled[tuple(indices)]
            regrown = np.where(binary, regrown, 0)
            labeled = regrown.astype(np.int32)
            n_components = int(regrown.max())

    # Fall back to raw labeling when erosion over-ate the silhouette.
    if labeled is None or n_components == 0:
        labeled, n_components = label(binary)

    if n_components == 0:
        return []

    min_pixels = int(h * w * min_component_fraction)
    component_sizes = np.bincount(labeled.ravel())
    component_sizes[0] = 0  # background

    keep_ids = [
        cid for cid in range(1, n_components + 1)
        if component_sizes[cid] >= min_pixels
    ]

    if not keep_ids:
        return []

    slices = find_objects(labeled)

    # Compute x-centroid for each kept component so we can sort left→right.
    entries: list[tuple[float, int, tuple]] = []
    for cid in keep_ids:
        sl = slices[cid - 1]
        if sl is None:
            continue
        y_slice, x_slice = sl
        x_centroid = (x_slice.start + x_slice.stop) / 2.0
        entries.append((x_centroid, cid, sl))

    entries.sort(key=lambda e: e[0])

    results: list[bytes] = []
    for _, cid, sl in entries:
        y_slice, x_slice = sl
        # Mask out other components from this crop so they don't bleed in.
        crop_arr = arr[y_slice, x_slice].copy()
        crop_labels = labeled[y_slice, x_slice]
        mask = (crop_labels == cid)
        crop_arr[~mask, 3] = 0  # zero alpha outside this component

        crop_img = Image.fromarray(crop_arr, mode="RGBA")

        # Scale crop to fit inside (output_size * (1 - 2*margin)) and
        # paste centered on a square transparent canvas.
        usable = int(output_size * (1.0 - 2 * margin))
        cw, ch = crop_img.size
        scale = min(usable / cw, usable / ch, 1.0) if max(cw, ch) > usable else 1.0
        new_w, new_h = int(cw * scale), int(ch * scale)
        if (new_w, new_h) != (cw, ch):
            crop_img = crop_img.resize((new_w, new_h), Image.LANCZOS)

        canvas = Image.new("RGBA", (output_size, output_size), (0, 0, 0, 0))
        off_x = (output_size - new_w) // 2
        off_y = (output_size - new_h) // 2
        canvas.paste(crop_img, (off_x, off_y), mask=crop_img.split()[3])

        buf = io.BytesIO()
        canvas.save(buf, format="PNG")
        results.append(buf.getvalue())

    return results


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
