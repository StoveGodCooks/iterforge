"""
trace.py - sub-pixel silhouette contour tracing and scanline profile extraction.

Pipeline:
  1. skimage marching-squares contour (sub-pixel accuracy)
  2. PCA orientation + tip-up disambiguation
  3. Normalize to [-1, 1] coordinate space
  4. Scanline intersection profile
  5. Gaussian smooth
"""

import math
import numpy as np


def trace_svg(svg_path: str):
    """
    Extract silhouette contour directly from an SVG file using CadQuery.
    Returns (contour, centroid) normalized to [-1, 1].
    """
    try:
        import cadquery as cq
        # Import SVG as a set of wires
        result = cq.importers.importSVG(svg_path)
        wires = result.wires().vals()
        if not wires:
            raise RuntimeError('No paths found in SVG')
        
        # Select the largest wire by bounding box area (the main silhouette)
        # This prevents picking up tiny detail paths inside the sword.
        def _area(w):
            bb = w.BoundingBox()
            return (bb.xmax - bb.xmin) * (bb.ymax - bb.ymin)
            
        main_wire = max(wires, key=_area)
        
        # Discretize the wire into high-precision points (300 points)
        pts = [(float(p.x), float(p.y)) for p in main_wire.discretize(300)]
        print(f'[masterforge.trace] SVG numerical paths: {len(pts)} pts')

        # Calculate centroid for normalization
        pts_arr = np.array(pts, dtype=np.float32)
        centroid = pts_arr.mean(axis=0)
        
        # PCA Orientation (Ensure tip is UP)
        centered = pts_arr - centroid
        cov = (centered.T @ centered) / len(pts_arr)
        eigvals, eigvecs = np.linalg.eigh(cov)
        major = eigvecs[:, np.argmax(eigvals)]
        pca_angle = math.atan2(float(major[1]), float(major[0]))
        rot = math.pi / 2 - pca_angle

        def _rot(p, angle, ox, oy):
            ca, sa = math.cos(angle), math.sin(angle)
            return [((x - ox) * ca - (y - oy) * sa + ox,
                     (x - ox) * sa + (y - oy) * ca + oy) for x, y in p]

        rotated = _rot(pts, rot, float(centroid[0]), float(centroid[1]))

        # Normalise to [-1, 1]
        rot_arr = np.array(rotated, dtype=np.float32)
        x_min, x_max = float(rot_arr[:, 0].min()), float(rot_arr[:, 0].max())
        y_min, y_max = float(rot_arr[:, 1].min()), float(rot_arr[:, 1].max())
        span = max(x_max - x_min, y_max - y_min, 1e-6)
        scale = 2.0 / span
        cx_mid = (x_min + x_max) / 2
        cy_mid = (y_min + y_max) / 2
        
        norm = [((x - cx_mid) * scale, -(y - cy_mid) * scale) for x, y in rotated]
        
        return norm, centroid

    except Exception as e:
        print(f'[masterforge.trace] SVG trace failed: {e}')
        raise


def trace_contour(mask: np.ndarray):
    """
    Extract the main silhouette contour from a boolean mask.
    Applies PCA orientation (longest axis = Y) and tip-up flip.
    Normalises to [-1, 1].

    Returns:
        contour  - list of (x, y) normalised to [-1, 1]
        centroid - raw pixel centroid (cx, cy) before normalisation
    """
    from skimage.measure import find_contours

    contours = find_contours(mask.astype(np.float32), level=0.5)
    if not contours:
        raise RuntimeError('find_contours: no contours found in mask')

    contour_raw = max(contours, key=len)
    pts = [(float(c[1]), float(c[0])) for c in contour_raw]   # (x=col, y=row)
    print(f'[masterforge.trace] raw contour: {len(pts)} pts')

    # -- PCA orientation -------------------------------------------------------
    ys_fg, xs_fg = np.where(mask)
    coords   = np.column_stack([xs_fg.astype(np.float64),
                                ys_fg.astype(np.float64)])
    centroid = coords.mean(axis=0)
    centered = coords - centroid
    cov      = (centered.T @ centered) / len(coords)
    eigvals, eigvecs = np.linalg.eigh(cov)
    major    = eigvecs[:, np.argmax(eigvals)]
    pca_angle = math.atan2(float(major[1]), float(major[0]))
    rot       = math.pi / 2 - pca_angle

    def _rot(p, angle, ox, oy):
        ca, sa = math.cos(angle), math.sin(angle)
        return [((x - ox) * ca - (y - oy) * sa + ox,
                 (x - ox) * sa + (y - oy) * ca + oy) for x, y in p]

    rotated = _rot(pts, rot, float(centroid[0]), float(centroid[1]))

    # -- Tip-up flip: heavier/wider end = pommel/base, goes to -Y ----------------
    # Transform all foreground pixels into rotated space to check mass distribution
    ca, sa = math.cos(rot), math.sin(rot)
    ry_fg = np.array([
        (x - centroid[0]) * sa + (y - centroid[1]) * ca + centroid[1]
        for x, y in zip(xs_fg.astype(float), ys_fg.astype(float))
    ])
    
    mid_y = float(ry_fg.mean())
    mass_bottom = (ry_fg < mid_y).sum()
    mass_top    = (ry_fg >= mid_y).sum()
    
    if mass_top > mass_bottom:
        rotated = _rot(rotated, math.pi,
                       float(centroid[0]), float(centroid[1]))
        print('[masterforge.trace] flipped 180 (tip-up based on mass)')

    # -- Normalise to [-1, 1] -------------------------------------------------
    rot_arr = np.array(rotated, dtype=np.float32)
    x_min, x_max = float(rot_arr[:, 0].min()), float(rot_arr[:, 0].max())
    y_min, y_max = float(rot_arr[:, 1].min()), float(rot_arr[:, 1].max())
    span    = max(x_max - x_min, y_max - y_min, 1e-6)
    scale   = 2.0 / span
    cx_mid  = (x_min + x_max) / 2
    cy_mid  = (y_min + y_max) / 2
    # Negate Y: image Y points down, Blender/3D Y points up
    norm = [((x - cx_mid) * scale, -(y - cy_mid) * scale)
            for x, y in rotated]

    print(f'[masterforge.trace] normalised contour: {len(norm)} pts  scale={scale:.4f}')
    return norm, centroid


def scanline_profile(contour: list, n_slices: int = 300) -> list:
    """
    Scanline intersection of contour polygon.
    Returns list of [y, xl, xr] for each slice.
    """
    if not contour:
        return []

    arr   = np.array(contour, dtype=np.float32)
    y_min = float(arr[:, 1].min())
    y_max = float(arr[:, 1].max())
    
    # Handle extremely flat objects
    if abs(y_max - y_min) < 1e-4:
        print(f"[masterforge.trace] WARNING: object is too flat (height={y_max-y_min:.6f})")
        return []

    # Use a small epsilon to avoid exact endpoint issues
    y_vals = np.linspace(y_min + 1e-6, y_max - 1e-6, n_slices).tolist()

    n    = len(contour)
    rows = []
    for y in y_vals:
        xs = []
        for i in range(n):
            p1 = contour[i]
            p2 = contour[(i + 1) % n]
            x1, y1 = p1[0], p1[1]
            x2, y2 = p2[0], p2[1]
            
            if abs(y1 - y2) < 1e-9:
                continue
            if not (min(y1, y2) <= y < max(y1, y2)):
                continue
                
            # Linear interpolation for X intersection
            intersect_x = x1 + (y - y1) / (y2 - y1) * (x2 - x1)
            xs.append(intersect_x)
            
        if len(xs) >= 2:
            rows.append([float(y), float(min(xs)), float(max(xs))])

    if not rows:
        print(f"[masterforge.trace] WARNING: scanline intersection produced 0 rows for {len(contour)} pts")
        
    return rows


def smooth_profile(profile: list, sigma: float = 1.5) -> list:
    """
    Gaussian smooth xl and xr columns of the scanline profile.
    Returns list of [y, xl_smoothed, xr_smoothed].
    """
    if not profile:
        return []

    def _smooth1d(arr):
        if len(arr) < 3: return arr
        sz  = max(3, int(sigma * 4) | 1)
        ax  = np.arange(-(sz // 2), sz // 2 + 1, dtype=np.float32)
        k   = np.exp(-ax ** 2 / (2 * sigma ** 2)); k /= k.sum()
        pad = sz // 2
        a   = np.array(arr, dtype=np.float32)
        p   = np.concatenate([a[:pad][::-1], a, a[-pad:][::-1]])
        return sum(k[i] * p[i:i + len(a)] for i in range(len(k)))

    ys  = [r[0] for r in profile]
    xls = _smooth1d([r[1] for r in profile])
    xrs = _smooth1d([r[2] for r in profile])
    return [[float(y), float(xl), float(xr)]
            for y, xl, xr in zip(ys, xls, xrs)]
