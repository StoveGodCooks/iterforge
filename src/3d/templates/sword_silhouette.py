"""
sword_silhouette.py — Silhouette-trace 2D→3D game asset pipeline (v3)

Architecture (Gemini deep research audit, 2026-03-18):
  Stage 1   Chromaticity flood-fill from perimeter → binary mask
  Stage 2   Moore-neighbour boundary trace → ordered contour
  Stage 3   Douglas-Peucker simplification (ε = 0.0015 × bbox diagonal)
  Stage 4   PCA + 3rd-order skewness → vertical orientation, tip up
  Stage 5   Scanline profile: left/right extents from norm_contour polygon
  Stage 6   Width-proportional lenticular loft via direct bmesh construction
  Stage 7   UV via bmesh: front=planar, back=mirror-U, rim=solid patch
  Stage 8a  EDT (Felzenszwalb, pure NumPy) → structural form height map
  Stage 8b  Gaussian high-pass → detail layer; recombine with EDT
  Stage 8c  Sobel on high-pass → tangent-space normal map
  Stage 8d  Inverted luminance → roughness; HSV threshold → metallic mask
  Stage 9   Principled BSDF node tree (diffuse + normal + rough + metal)
  Stage 10  Subdivision(lvl=2) + Displace(strength=0.012)
  Stage 11  Cycles CPU render → preview PNG (512×1024, 3-point studio)
  Stage 12  GLB export: export_tangents=True, export_apply=True
  Stage 13  Save .blend

Usage:
  blender --background --python sword_silhouette.py -- \\
          <image_path> <output_glb> <output_blend> [output_preview]
"""

import bpy
import bmesh
import sys
import os
import math
import numpy as np

# ── Args ──────────────────────────────────────────────────────────────────────
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(args) < 3:
    print('[SilhouettePipe] USAGE: -- <image_path> <output_glb> <output_blend> [output_preview]')
    sys.exit(1)

image_path     = args[0].replace('\\', '/')
output_glb     = args[1]
output_blend   = args[2]
output_preview = args[3].replace('\\', '/') if len(args) > 3 else None

print(f'[SilhouettePipe] image   = {image_path}')
print(f'[SilhouettePipe] glb     = {output_glb}')
print(f'[SilhouettePipe] blend   = {output_blend}')

# ── Clear scene ───────────────────────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
for blk in list(bpy.data.meshes):    bpy.data.meshes.remove(blk)
for blk in list(bpy.data.materials): bpy.data.materials.remove(blk)
for blk in list(bpy.data.images):    bpy.data.images.remove(blk)
for blk in list(bpy.data.lights):    bpy.data.lights.remove(blk)
for blk in list(bpy.data.cameras):   bpy.data.cameras.remove(blk)
for blk in list(bpy.data.curves):    bpy.data.curves.remove(blk)

# ════════════════════════════════════════════════════════════════════════════
# STAGE 1 — Image load + foreground mask
# ════════════════════════════════════════════════════════════════════════════

if not os.path.isfile(image_path):
    print(f'[SilhouettePipe] ERROR: image not found: {image_path}')
    sys.exit(1)

bpy_img = bpy.data.images.load(image_path)
bpy_img.colorspace_settings.name = 'sRGB'
iw, ih = bpy_img.size
print(f'[SilhouettePipe] image {iw}×{ih}')

# Extract RGBA — Blender stores bottom-left origin; flip to top-left
pixels = np.array(bpy_img.pixels[:], dtype=np.float32).reshape(ih, iw, 4)
pixels = np.flipud(pixels)
rgb    = pixels[:, :, :3]
alpha  = pixels[:, :, 3]

# Use alpha if present, otherwise chromaticity flood-fill from perimeter
if alpha.min() < 0.9:
    mask = alpha > 0.5
    print('[SilhouettePipe] using alpha channel as mask')
else:
    samples  = [
        rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1],
        rgb[0, iw//2], rgb[ih//2, 0], rgb[0, iw//4], rgb[ih//4, 0],
    ]
    bg_color = np.median(np.array(samples, dtype=np.float32), axis=0)
    THRESH   = 0.22

    def _flood_fill_bg(rgb_arr, bgc, thr):
        h, w   = rgb_arr.shape[:2]
        vis    = np.zeros((h, w), dtype=bool)
        is_bg  = np.zeros((h, w), dtype=bool)
        from collections import deque
        q   = deque()
        dy8 = [-1, 1, 0, 0, -1, -1,  1,  1]
        dx8 = [ 0, 0,-1, 1, -1,  1, -1,  1]
        for y in range(h):
            for x in [0, w - 1]:
                if not vis[y, x] and np.linalg.norm(rgb_arr[y, x] - bgc) < thr:
                    vis[y, x] = is_bg[y, x] = True
                    q.append((y, x))
        for x in range(w):
            for y in [0, h - 1]:
                if not vis[y, x] and np.linalg.norm(rgb_arr[y, x] - bgc) < thr:
                    vis[y, x] = is_bg[y, x] = True
                    q.append((y, x))
        while q:
            y, x = q.popleft()
            for i in range(8):
                ny, nx = y + dy8[i], x + dx8[i]
                if 0 <= ny < h and 0 <= nx < w and not vis[ny, nx]:
                    if np.linalg.norm(rgb_arr[ny, nx] - bgc) < thr:
                        vis[ny, nx] = is_bg[ny, nx] = True
                        q.append((ny, nx))
        return ~is_bg

    def _dilate(m):
        h, w = m.shape
        out  = m.copy()
        for dy, dx in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]:
            sy = slice(max(0,-dy), h - max(0,dy) or None)
            sx = slice(max(0,-dx), w - max(0,dx) or None)
            ty = slice(max(0, dy), h - max(0,-dy) or None)
            tx = slice(max(0, dx), w - max(0,-dx) or None)
            out[ty, tx] |= m[sy, sx]
        return out

    def _erode(m):
        h, w = m.shape
        out  = np.ones_like(m)
        for dy, dx in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]:
            sy = slice(max(0,-dy), h - max(0,dy) or None)
            sx = slice(max(0,-dx), w - max(0,dx) or None)
            ty = slice(max(0, dy), h - max(0,-dy) or None)
            tx = slice(max(0, dx), w - max(0,-dx) or None)
            out[ty, tx] &= m[sy, sx]
        return out

    raw_mask = _flood_fill_bg(rgb, bg_color, THRESH)
    mask     = _dilate(_erode(_dilate(raw_mask)))

fg_count = int(mask.sum())
print(f'[SilhouettePipe] foreground pixels: {fg_count} ({fg_count/(iw*ih)*100:.1f}%)')
if fg_count < 100:
    print('[SilhouettePipe] ERROR: too few foreground pixels — check threshold')
    sys.exit(1)

# ── Largest connected component — isolate single central object ────────────────
# If the LoRA generated multiple items (sticker packs, sprite sheets, etc.),
# only keep the foreground blob closest to the image centre.  This prevents the
# row-scan contour from tracing multiple objects into one wide silhouette.
def _keep_center_component(mask_in):
    from collections import deque
    h, w  = mask_in.shape
    cy, cx = h // 2, w // 2
    ys, xs = np.where(mask_in)
    if len(ys) == 0:
        return mask_in
    dists    = (ys - cy) ** 2 + (xs - cx) ** 2
    seed_y   = int(ys[np.argmin(dists)])
    seed_x   = int(xs[np.argmin(dists)])
    result   = np.zeros_like(mask_in)
    visited  = np.zeros_like(mask_in, dtype=bool)
    q = deque([(seed_y, seed_x)])
    visited[seed_y, seed_x] = True
    while q:
        y, x = q.popleft()
        result[y, x] = True
        for dy, dx in [(-1,0),(1,0),(0,-1),(0,1)]:
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and mask_in[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))
    return result

mask = _keep_center_component(mask)
print(f'[SilhouettePipe] after LCC isolation: {int(mask.sum())} fg pixels')

# ── Mask background pixels in the source image ────────────────────────────────
# The raw image has a white background. Without masking it, the diffuse texture
# AND the emission shader both sample white pixels for background areas → the
# entire mesh glows white/grey in the viewer, drowning the sword's actual colors.
# Fix: zero R/G/B/A for all background pixels so the texture is transparent-black
# outside the sword silhouette. The alpha cutout (mask_nd → BSDF Alpha) still
# handles edge sharpness — this just removes the white bleed from white BG pixels.
pixels_masked = pixels.copy()               # shape (ih, iw, 4), top-left origin
pixels_masked[~mask, 0:3] = 0.5            # neutral grey outside foreground
pixels_masked[~mask, 3]   = 1.0            # fully opaque
bpy_img.pixels[:] = np.flipud(pixels_masked).ravel()   # Blender is bottom-left
bpy_img.update()
print('[SilhouettePipe] background pixels zeroed in source texture')

# ════════════════════════════════════════════════════════════════════════════
# STAGE 2 — Row-scan boundary trace → ordered closed contour
#
# For each row: record leftmost and rightmost foreground pixel.
# Walk down the left side then up the right side → closed polygon.
# Works reliably for any connected weapon silhouette including concave
# guard wings, without the loop-back failure modes of Moore trace.
# ════════════════════════════════════════════════════════════════════════════

def row_scan_contour(m):
    h, w = m.shape
    left_pts  = []
    right_pts = []
    for y in range(h):
        xs = np.where(m[y])[0]
        if len(xs) == 0:
            continue
        left_pts.append( (int(xs.min()), y) )
        right_pts.append((int(xs.max()), y) )
    if not left_pts:
        return []
    # Closed contour: down the left side, up the right side
    return left_pts + list(reversed(right_pts))

raw_contour = row_scan_contour(mask)
print(f'[SilhouettePipe] raw contour: {len(raw_contour)} pts')
if len(raw_contour) < 10:
    print('[SilhouettePipe] ERROR: contour too small')
    sys.exit(1)

# ════════════════════════════════════════════════════════════════════════════
# STAGE 3 — Douglas-Peucker simplification
# ════════════════════════════════════════════════════════════════════════════

def _dp(pts, eps):
    if len(pts) <= 2:
        return list(pts)
    s  = np.array(pts[0],  dtype=np.float32)
    e  = np.array(pts[-1], dtype=np.float32)
    seg_v = e - s
    seg_l = float(np.linalg.norm(seg_v))
    arr   = np.array(pts[1:-1], dtype=np.float32)
    if seg_l < 1e-9:
        dists = np.linalg.norm(arr - s, axis=1)
    else:
        unit  = seg_v / seg_l
        proj  = s + np.outer(np.dot(arr - s, unit), unit)
        dists = np.linalg.norm(arr - proj, axis=1)
    idx = int(np.argmax(dists))
    if dists[idx] > eps:
        return _dp(pts[:idx+2], eps)[:-1] + _dp(pts[idx+1:], eps)
    return [pts[0], pts[-1]]

pts_arr   = np.array(raw_contour, dtype=np.float32)
bbox_diag = float(np.sqrt(pts_arr[:,0].ptp()**2 + pts_arr[:,1].ptp()**2))
eps       = 0.0015 * bbox_diag
simplified = _dp(raw_contour, eps)
if len(simplified) < 12:
    simplified = _dp(raw_contour, eps / 3)
if len(simplified) > 500:
    simplified = _dp(raw_contour, eps * 2)
print(f'[SilhouettePipe] simplified: {len(simplified)} pts (ε={eps:.2f})')

# ════════════════════════════════════════════════════════════════════════════
# STAGE 4 — PCA orientation + 180° polarity (tip up)
# ════════════════════════════════════════════════════════════════════════════

ys_fg, xs_fg = np.where(mask)
coords   = np.column_stack([xs_fg.astype(np.float64), ys_fg.astype(np.float64)])
centroid = coords.mean(axis=0)
centered = coords - centroid
cov      = (centered.T @ centered) / len(coords)
eigvals, eigvecs = np.linalg.eigh(cov)
major    = eigvecs[:, np.argmax(eigvals)]
pca_angle = math.atan2(float(major[1]), float(major[0]))
rot       = math.pi / 2 - pca_angle

def _rot_pts(pts, angle, origin):
    ca, sa = math.cos(angle), math.sin(angle)
    ox, oy = float(origin[0]), float(origin[1])
    return [((x-ox)*ca - (y-oy)*sa + ox,
             (x-ox)*sa + (y-oy)*ca + oy) for x, y in pts]

rotated = _rot_pts(simplified, rot, centroid)

# 180° disambiguation: more pixel mass = hilt/pommel end (wider)
ry_all = np.array([(x-centroid[0])*math.sin(rot) + (y-centroid[1])*math.cos(rot) + centroid[1]
                   for x, y in zip(xs_fg.astype(float), ys_fg.astype(float))])
cy_med  = float(ry_all.mean())
flip_applied = False
if (ry_all < cy_med).sum() > (ry_all >= cy_med).sum():
    rotated      = _rot_pts(rotated, math.pi, centroid)
    flip_applied = True
    print('[SilhouettePipe] flipped 180° (tip-up)')

print(f'[SilhouettePipe] PCA angle: {math.degrees(pca_angle):.1f}°')

rot_arr  = np.array(rotated, dtype=np.float32)
x_min_c  = float(rot_arr[:,0].min());  x_max_c = float(rot_arr[:,0].max())
y_min_c  = float(rot_arr[:,1].min());  y_max_c = float(rot_arr[:,1].max())
span     = max(x_max_c - x_min_c, y_max_c - y_min_c, 1e-6)
SCALE    = 2.0 / span
cx_mid   = (x_min_c + x_max_c) / 2
cy_mid   = (y_min_c + y_max_c) / 2
# Image Y is inverted vs Blender Y — negate Y
norm_contour = [((x - cx_mid) * SCALE, -(y - cy_mid) * SCALE) for x, y in rotated]

# ════════════════════════════════════════════════════════════════════════════
# STAGE 5 — Scanline profile: left/right extents per Y slice in mesh space
# ════════════════════════════════════════════════════════════════════════════

N_SLICES    = 300    # Y profile samples — more slices = smoother blade taper
# Depth is NOT uniform — a sword has thin blade, thick guard, round pommel.
# DEPTH_RATIO is replaced by per-slice adaptive depth (see Stage 5b below).
MIN_DEPTH   = 0.025  # minimum absolute thickness (blade tip, very thin sections)

# Dense contour: apply same PCA + flip + normalize to the full raw_contour (2038 pts)
# instead of the simplified 75-pt polygon → much smoother scanline intersections.
raw_rotated_dense = _rot_pts(list(raw_contour), rot, centroid)
if flip_applied:
    raw_rotated_dense = _rot_pts(raw_rotated_dense, math.pi, centroid)
dense_contour = [((x - cx_mid) * SCALE, -(y - cy_mid) * SCALE)
                 for x, y in raw_rotated_dense]

def scanline_extents(poly, y_values):
    """For each Y, intersect horizontal scanline with closed polygon → (min_x, max_x)."""
    n = len(poly)
    out = []
    for y in y_values:
        xs = []
        for i in range(n):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % n]
            if y1 == y2:
                continue
            if not (min(y1, y2) <= y < max(y1, y2)):
                continue
            t = (y - y1) / (y2 - y1)
            xs.append(x1 + t * (x2 - x1))
        out.append((float(min(xs)), float(max(xs))) if len(xs) >= 2 else None)
    return out

def _smooth1d(arr, sigma=3.0):
    """1-D Gaussian smooth with mirror padding to avoid edge shrinkage."""
    sz  = max(3, int(sigma * 4) | 1)
    ax  = np.arange(-(sz // 2), sz // 2 + 1, dtype=np.float32)
    k   = np.exp(-ax**2 / (2 * sigma**2));  k /= k.sum()
    pad = sz // 2
    a   = np.array(arr, dtype=np.float32)
    p   = np.concatenate([a[:pad][::-1], a, a[-pad:][::-1]])
    return sum(k[i] * p[i:i + len(a)] for i in range(len(k)))

norm_arr = np.array(norm_contour, dtype=np.float32)
y_min_n  = float(norm_arr[:, 1].min())
y_max_n  = float(norm_arr[:, 1].max())
y_vals   = np.linspace(y_min_n + 1e-4, y_max_n - 1e-4, N_SLICES).tolist()
extents  = scanline_extents(dense_contour, y_vals)   # dense contour for accuracy
raw_prof = [(y, xl, xr) for y, ex in zip(y_vals, extents)
            if ex is not None for xl, xr in [ex]]

# ── Stage 5a: Adaptive Gaussian smoothing ────────────────────────────────────
# Wide sections (guard, pommel) need light smoothing to preserve shape.
# Narrow sections (blade edge) need heavier smoothing to kill pixel noise.
ys_a     = np.array([y  for y, _, __ in raw_prof], dtype=np.float32)
xl_raw   = np.array([xl for _, xl, __ in raw_prof], dtype=np.float32)
xr_raw   = np.array([xr for _, __, xr in raw_prof], dtype=np.float32)
widths_raw = xr_raw - xl_raw
max_w    = float(widths_raw.max()) if widths_raw.max() > 0 else 1.0

# Narrow sections (< 25% of max width) get strong smoothing (σ=4.0)
# Wide sections (> 60% of max width) get light smoothing (σ=1.2) to preserve guard shape
sigma_arr = np.where(widths_raw < 0.25 * max_w, 4.0,
            np.where(widths_raw > 0.60 * max_w, 1.2, 2.0)).astype(np.float32)

# Per-slice adaptive sigma — apply as weighted blend of two smoothed versions
xl_soft  = _smooth1d(xl_raw, sigma=4.0)
xr_soft  = _smooth1d(xr_raw, sigma=4.0)
xl_hard  = _smooth1d(xl_raw, sigma=1.2)
xr_hard  = _smooth1d(xr_raw, sigma=1.2)

# Blend weight: 0 = soft (blade), 1 = hard (guard)
w = np.clip((widths_raw - 0.25 * max_w) / (0.35 * max_w), 0.0, 1.0)
xl_a = xl_soft * (1 - w) + xl_hard * w
xr_a = xr_soft * (1 - w) + xr_hard * w

# Pull each edge inward by 2px so L/R verts don't land on antialiased fringe.
edge_inset = 2.0 * SCALE
xl_a = xl_a + edge_inset
xr_a = xr_a - edge_inset
widths_a = xr_a - xl_a

# ── Stage 5b: Part-aware zone detection + depth ratio ────────────────────────
#
# Zones (sword oriented tip-UP: ys_a[0]=pommel end, ys_a[-1]=blade tip):
#   tip    → collapses to apex point
#   blade  → thin lenticular (lens cross-section)
#   guard  → flat plate (wide, minimal depth)
#   handle → octagonal cylinder
#   pommel → full dome
#
# Detection strategy:
#   1. Guard  = widest local maximum in middle band (12%–80% of slices)
#   2. Tip    = top slices where width < 8% of max
#   3. Pommel = bottom slices wider than handle baseline
#   4. Handle = between pommel top and guard bottom
#   5. Blade  = everything else (default)

normalized_w = widths_a / max_w
n_s          = len(normalized_w)
zones        = np.full(n_s, 'blade', dtype=object)

# 1. Guard — widest peak in middle band
g_lo, g_hi = int(n_s * 0.12), int(n_s * 0.80)
if g_hi > g_lo:
    sub  = normalized_w[g_lo:g_hi]
    peak = int(np.argmax(sub)) + g_lo
    if normalized_w[peak] > 0.55:
        thresh = normalized_w[peak] * 0.72
        i = peak
        while i > g_lo     and normalized_w[i - 1] >= thresh: i -= 1
        j = peak
        while j < g_hi - 1 and normalized_w[j + 1] >= thresh: j += 1
        zones[i:j + 1] = 'guard'

# 2. Tip — top slices where width collapses
for i in range(n_s - 1, -1, -1):
    if normalized_w[i] < 0.08:
        zones[i] = 'tip'
    else:
        break

# 3. Pommel — bottom slices wider than handle baseline
guard_pos    = np.where(zones == 'guard')[0]
g_bottom     = int(guard_pos.min()) if len(guard_pos) else n_s
handle_base  = float(np.median(normalized_w[:g_bottom])) if g_bottom > 0 else 0.3
for i in range(min(g_bottom, int(n_s * 0.18))):
    if normalized_w[i] > handle_base * 1.4:
        zones[i] = 'pommel'

# 4. Handle — between pommel top and guard bottom
pommel_pos = np.where(zones == 'pommel')[0]
p_top      = int(pommel_pos.max()) + 1 if len(pommel_pos) else 0
for i in range(p_top, g_bottom):
    if zones[i] == 'blade':
        zones[i] = 'handle'

# Per-zone depth ratios
depth_ratio = np.where(zones == 'tip',    0.55,
              np.where(zones == 'blade',  0.08,
              np.where(zones == 'guard',  0.14,
              np.where(zones == 'handle', 0.30,
                                          0.48))))   # pommel

depths_a = np.maximum(widths_a * depth_ratio, MIN_DEPTH)
profile  = list(zip(ys_a.tolist(), xl_a.tolist(), xr_a.tolist(),
                    depths_a.tolist(), zones.tolist()))

zone_counts = {z: int(np.sum(zones == z)) for z in ('blade','guard','handle','pommel','tip')}
print(f'[SilhouettePipe] zones: {zone_counts}')
print(f'[SilhouettePipe] loft profile: {len(profile)} slices  '
      f'width=[{widths_a.min():.3f},{widths_a.max():.3f}]  '
      f'depth=[{depths_a.min():.3f},{depths_a.max():.3f}]')

# ════════════════════════════════════════════════════════════════════════════
# STAGE 5.5 — Bake reprojected UV texture
#
# Problem: the mesh is in PCA-rotated normalised space; the source image is
# in its original (possibly tilted) pixel space. Pixel-accurate inverse UV
# samples diagonally across the image, picking up background on the blade edges.
#
# Fix: build a square texture where each texel (u,v) is pre-computed to the
# correct source-image pixel by running the inverse transform vectorised.
# Stage 7 then just uses simple planar projection (mesh bbox → UV [0,1])
# and every face is guaranteed to sample the right colour — no background bleed.
# ════════════════════════════════════════════════════════════════════════════

# Mesh bounds in normalised space (same coords the mesh verts will have)
mesh_x_min_n = float(xl_a.min()) - edge_inset
mesh_x_max_n = float(xr_a.max()) + edge_inset
mesh_y_min_n = float(ys_a[0])
mesh_y_max_n = float(ys_a[-1])
mesh_x_rng   = max(mesh_x_max_n - mesh_x_min_n, 1e-6)
mesh_y_rng   = max(mesh_y_max_n - mesh_y_min_n, 1e-6)

# Inverse-transform constants (same as old Stage 7)
ca_inv_p = math.cos(-rot);  sa_inv_p = math.sin(-rot)
ox_p, oy_p = float(centroid[0]), float(centroid[1])

# Vectorised: build (PROJ_SZ × PROJ_SZ) UV grid, map to source pixel
PROJ_SZ = 512
u_lin = (np.arange(PROJ_SZ, dtype=np.float32) + 0.5) / PROJ_SZ   # u ∈ (0,1)
v_lin = (np.arange(PROJ_SZ, dtype=np.float32) + 0.5) / PROJ_SZ   # v ∈ (0,1)
uu_p, vv_p = np.meshgrid(u_lin, v_lin)                            # (PROJ_SZ,PROJ_SZ)

mx_p = mesh_x_min_n + uu_p * mesh_x_rng    # normalised mesh X
my_p = mesh_y_min_n + vv_p * mesh_y_rng    # normalised mesh Y

# Undo normalisation → rotated image space
x_rot_p = mx_p / SCALE + cx_mid
y_rot_p = -my_p / SCALE + cy_mid

# Undo 180° flip (if applied in Stage 4)
if flip_applied:
    x_rot_p = 2.0 * ox_p - x_rot_p
    y_rot_p = 2.0 * oy_p - y_rot_p

# Undo PCA rotation → original image pixel coordinates
dx_p = x_rot_p - ox_p
dy_p = y_rot_p - oy_p
px_p = dx_p * ca_inv_p - dy_p * sa_inv_p + ox_p
py_p = dx_p * sa_inv_p + dy_p * ca_inv_p + oy_p

# Nearest-neighbour sample from the masked source image (top-left origin)
px_i = np.clip(np.round(px_p).astype(np.int32), 0, iw - 1)
py_i = np.clip(np.round(py_p).astype(np.int32), 0, ih - 1)
proj_pixels = pixels_masked[py_i, px_i]   # (PROJ_SZ, PROJ_SZ, 4), top-left

# Create Blender image (bottom-left origin → flipud before writing)
proj_img = bpy.data.images.new('ProjTex', width=PROJ_SZ, height=PROJ_SZ, alpha=True)
proj_img.colorspace_settings.name = 'sRGB'
proj_img.pixels[:] = np.flipud(proj_pixels).ravel()
proj_img.update()
proj_img.pack()   # must pack in-memory image so glTF exporter embeds it in the GLB
print(f'[SilhouettePipe] reprojected texture baked {PROJ_SZ}×{PROJ_SZ}')

# ════════════════════════════════════════════════════════════════════════════
# STAGE 5.6 — CadQuery loft attempt (optional; falls back to Stage 6 bmesh)
#
# sword_cad.py is run as a subprocess using any system Python that has
# CadQuery installed (pip install cadquery).  It receives the profile data
# as JSON, lofts through mathematically clean OCC cross-sections, and
# outputs an STL that Blender imports here.  If anything fails we silently
# fall through to the existing Stage 6 bmesh pipeline.
# ════════════════════════════════════════════════════════════════════════════

import json as _json, subprocess as _subp, tempfile as _tmpmod, shutil as _shutil

_cad_mesh_obj = None
_CAD_SCRIPT   = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sword_cad.py')

if os.path.isfile(_CAD_SCRIPT):
    _td    = _tmpmod.mkdtemp(prefix='iterforge_cad_')
    _pjson = os.path.join(_td, 'profile.json')
    _pstl  = os.path.join(_td, 'sword.stl')

    # Write profile as JSON [[y, xl, xr, depth, zone], ...]
    with open(_pjson, 'w') as _jf:
        _json.dump([[y, xl, xr, d, z] for y, xl, xr, d, z in profile], _jf)

    def _find_cq_python():
        """Return a Python executable that has CadQuery installed, or None."""
        import os as _os
        _iterforge_home = _os.environ.get('ITERFORGE_HOME', '')
        _candidates = [
            # IterForge managed Python 3.11 (cadquery installs here)
            _os.path.join(_iterforge_home, 'python-base', 'python.exe'),
            _os.path.join(_os.path.expanduser('~'), 'AppData', 'Roaming', 'IterForge', 'python-base', 'python.exe'),
            # System Python (fallback)
            'python3', 'python',
        ]
        for _py in _candidates:
            if not _py:
                continue
            try:
                _rc = _subp.run([_py, '-c', 'import cadquery'],
                                capture_output=True, timeout=15)
                if _rc.returncode == 0:
                    return _py
            except (FileNotFoundError, _subp.TimeoutExpired):
                pass
        return None

    _cq_py = _find_cq_python()
    if _cq_py:
        print(f'[SilhouettePipe] CadQuery found ({_cq_py}) — running loft subprocess')
        try:
            _cr = _subp.run(
                [_cq_py, _CAD_SCRIPT, image_path, _pjson, _pstl],
                capture_output=True, text=True, timeout=180,
            )
            for _ln in _cr.stdout.splitlines():
                print(f'  [cad] {_ln}')
            if _cr.returncode == 0 and os.path.isfile(_pstl):
                # Deselect all so the imported object is the only selected one
                bpy.ops.object.select_all(action='DESELECT')
                # Blender 3.x uses import_mesh.stl; 4.x uses wm.stl_import
                try:
                    bpy.ops.wm.stl_import(filepath=_pstl)    # Blender 4.x
                except AttributeError:
                    bpy.ops.import_mesh.stl(filepath=_pstl)   # Blender 3.x
                _sel = [o for o in bpy.context.selected_objects if o.type == 'MESH']
                if _sel:
                    _cad_mesh_obj = _sel[0]
                    _cad_mesh_obj.name = 'SwordMeshCAD'
                    _cad_mesh_obj.rotation_euler = (math.radians(90), 0, 0)
                    bpy.context.view_layer.objects.active = _cad_mesh_obj
                    print('[SilhouettePipe] CadQuery STL imported ✓')
                else:
                    print('[SilhouettePipe] STL import produced no mesh — bmesh fallback')
            else:
                print(f'[SilhouettePipe] CadQuery failed (exit {_cr.returncode}) — bmesh fallback')
                if _cr.stderr:
                    print(_cr.stderr[-500:])
        except Exception as _ce:
            print(f'[SilhouettePipe] CadQuery subprocess error: {_ce} — bmesh fallback')
    else:
        print('[SilhouettePipe] CadQuery not in PATH — bmesh Stage 6 (pip install cadquery to enable)')

    _shutil.rmtree(_td, ignore_errors=True)
else:
    print(f'[SilhouettePipe] sword_cad.py not found — bmesh Stage 6')

# ════════════════════════════════════════════════════════════════════════════
# STAGE 6 — Part-aware loft: 8-vert rings, smooth transitions, tip apex
#
# All rings use N_RING=8 verts → clean all-quad topology.
# Zone cross-sections:
#   blade  → lenticular (raised center ridge, sharp edge verts at indices 2 & 6)
#   handle → octagon    (cylindrical grip)
#   guard  → flat plate (wide, minimal depth, chamfered corners)
#   pommel → full circle (dome cap)
#   tip    → blade shape that converges to a single apex vertex
#
# Smooth transitions: each zone boundary blends over BLEND_SLICES slices.
# Tip convergence: top tip-zone slices collapse to a single apex vertex.
# Sharp edges: blade edge verts (z≈0) marked sharp after bm.to_mesh().
# ════════════════════════════════════════════════════════════════════════════

N_RING       = 8
BLEND_SLICES = 14

def _ring_xz(cx, xl, xr, d, zone):
    """Return N_RING (x, z) pairs for the cross-section at this slice."""
    hw = max((xr - xl) * 0.5, 1e-6)
    rz = d * 0.5
    if zone in ('blade', 'tip'):
        bv_x = hw * 0.52
        bv_z = rz * 0.28
        return [(cx,         rz   ),   # 0 front center ridge
                (cx + bv_x,  bv_z ),   # 1 front-right bevel
                (xr,         0.0  ),   # 2 RIGHT sharp edge  ← blade silhouette
                (cx + bv_x, -bv_z ),   # 3 back-right bevel
                (cx,        -rz   ),   # 4 back center ridge
                (cx - bv_x, -bv_z ),   # 5 back-left bevel
                (xl,         0.0  ),   # 6 LEFT sharp edge   ← blade silhouette
                (cx - bv_x,  bv_z )]   # 7 front-left bevel
    elif zone == 'handle':
        return [(cx + hw * math.cos(i * math.pi * 2.0 / 8),
                 rz * math.sin(i * math.pi * 2.0 / 8)) for i in range(8)]
    elif zone == 'guard':
        plate_z = rz * 0.22
        bv_x    = hw * 0.62
        return [(cx,          plate_z       ),   # 0
                (cx + bv_x,   plate_z * 0.45),   # 1
                (xr,          0.0           ),   # 2
                (cx + bv_x,  -plate_z * 0.45),   # 3
                (cx,         -plate_z       ),   # 4
                (cx - bv_x,  -plate_z * 0.45),   # 5
                (xl,          0.0           ),   # 6
                (cx - bv_x,   plate_z * 0.45)]   # 7
    else:   # pommel — full circle
        return [(cx + hw * math.cos(i * math.pi * 2.0 / 8),
                 rz * math.sin(i * math.pi * 2.0 / 8)) for i in range(8)]

def _lerp_ring(r1, r2, t):
    t  = max(0.0, min(1.0, t))
    t0 = 1.0 - t
    return [(r1[i][0] * t0 + r2[i][0] * t,
             r1[i][1] * t0 + r2[i][1] * t) for i in range(N_RING)]

# ── Compute raw rings ────────────────────────────────────────────────────────
raw_rings = []
for y, xl, xr, d, zone in profile:
    cx = (xl + xr) * 0.5
    raw_rings.append(_ring_xz(cx, xl, xr, d, zone))

blended = [list(r) for r in raw_rings]

# ── Smooth zone transitions ──────────────────────────────────────────────────
boundaries = [i for i in range(1, len(profile)) if profile[i][4] != profile[i - 1][4]]
for b in boundaries:
    z_pre  = profile[b - 1][4]
    z_post = profile[b][4]
    for k in range(1, BLEND_SLICES + 1):
        i = b - k
        if i >= 0 and profile[i][4] == z_pre:
            t = (BLEND_SLICES - k + 1) / (BLEND_SLICES + 1)
            y, xl, xr, d, _ = profile[i]
            cx = (xl + xr) * 0.5
            blended[i] = _lerp_ring(raw_rings[i],
                                     _ring_xz(cx, xl, xr, d, z_post), t)

# ── Tip convergence → apex ────────────────────────────────────────────────────
tip_idxs = [i for i, (_, _, _, _, z) in enumerate(profile) if z == 'tip']
if tip_idxs:
    n_tip = len(tip_idxs)
    for k, i in enumerate(tip_idxs):
        conv_t = (k + 1) / (n_tip + 1)
        y, xl, xr, _, _ = profile[i]
        cx        = (xl + xr) * 0.5
        apex_ring = [(cx, 0.0)] * N_RING
        blended[i] = _lerp_ring(blended[i], apex_ring, conv_t)

# ── Build bmesh ───────────────────────────────────────────────────────────────
mesh_data = bpy.data.meshes.new('SwordMesh')
mesh_obj  = bpy.data.objects.new('SwordMesh', mesh_data)
bpy.context.collection.objects.link(mesh_obj)
bpy.context.view_layer.objects.active = mesh_obj
mesh_obj.rotation_euler = (math.radians(90), 0, 0)

bm = bmesh.new()

vert_rings = []
for i, (y, xl, xr, d, zone) in enumerate(profile):
    ring = [bm.verts.new((xz[0], float(y), xz[1])) for xz in blended[i]]
    vert_rings.append(ring)

bm.verts.ensure_lookup_table()

# Quad strips between adjacent rings
for i in range(len(vert_rings) - 1):
    r0, r1 = vert_rings[i], vert_rings[i + 1]
    for j in range(N_RING):
        j1 = (j + 1) % N_RING
        try:
            bm.faces.new((r0[j], r0[j1], r1[j1], r1[j]))
        except Exception:
            pass   # degenerate face at fully-converged tip — skip

# Bottom end cap (pommel) — fan to center point
y0, xl0, xr0 = profile[0][0], profile[0][1], profile[0][2]
v_bot = bm.verts.new(((xl0 + xr0) * 0.5, float(y0), 0.0))
for j in range(N_RING):
    try:
        bm.faces.new((v_bot, vert_rings[0][(j + 1) % N_RING], vert_rings[0][j]))
    except Exception:
        pass

# Top end cap (blade tip) — apex vertex + fan from last ring
yn, xln, xrn = profile[-1][0], profile[-1][1], profile[-1][2]
v_top = bm.verts.new(((xln + xrn) * 0.5, float(yn), 0.0))
for j in range(N_RING):
    try:
        bm.faces.new((v_top, vert_rings[-1][j], vert_rings[-1][(j + 1) % N_RING]))
    except Exception:
        pass

bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='BEAUTY', ngon_method='BEAUTY')
bm.to_mesh(mesh_data)
bm.free()
mesh_data.update()

# ── Sharp edges: blade silhouette verts sit at z≈0 — mark edges between them ─
# This preserves the crisp blade outline in the normal map and glTF export.
for e in mesh_data.edges:
    v0 = mesh_data.vertices[e.vertices[0]]
    v1 = mesh_data.vertices[e.vertices[1]]
    if abs(v0.co.z) < 0.005 and abs(v1.co.z) < 0.005:
        e.use_edge_sharp = True

# Auto-smooth so sharp-marked edges stay hard, others blend smoothly
try:
    mesh_data.use_auto_smooth = True
    mesh_data.auto_smooth_angle = math.radians(60)
except AttributeError:
    pass   # Blender 4.1+ handles this via geometry nodes — skip silently

# ── CadQuery mesh override: if Stage 5.6 produced a mesh, discard the bmesh ─
# The bmesh above still ran (cheap — <1 s), but we prefer the CAD-quality mesh.
if _cad_mesh_obj is not None:
    bpy.data.objects.remove(mesh_obj, do_unlink=True)
    mesh_obj       = _cad_mesh_obj
    mesh_obj.name  = 'SwordMesh'
    mesh_data      = mesh_obj.data
    print('[SilhouettePipe] CadQuery mesh active (bmesh discarded)')

bpy.context.view_layer.objects.active = mesh_obj
vco = [v.co for v in mesh_data.vertices]
print(f'[SilhouettePipe] mesh: {len(mesh_data.vertices)} verts, {len(mesh_data.polygons)} faces')
print(f'[SilhouettePipe] local bounds '
      f'X[{min(v.x for v in vco):.3f},{max(v.x for v in vco):.3f}] '
      f'Y[{min(v.y for v in vco):.3f},{max(v.y for v in vco):.3f}] '
      f'Z[{min(v.z for v in vco):.3f},{max(v.z for v in vco):.3f}]')

# ════════════════════════════════════════════════════════════════════════════
# STAGE 7 — UV: planar projection onto the reprojected texture
#
# The reprojected texture (Stage 5.5) is already in mesh-normalised space,
# so a direct X/Y → U/V mapping is all that's needed.
#
# Face classification:
#   front  (z_avg >  RIM_THRESH) : direct UV
#   back   (z_avg < -RIM_THRESH) : mirror U  (1 - u)
#   rim    (|z_avg| <= RIM_THRESH): always front UV
#
# RIM_THRESH prevents the stained-glass artifact where triangulated rim faces
# at z≈0 randomly flip between front/back UV and create alternating patches.
# ════════════════════════════════════════════════════════════════════════════

RIM_THRESH = 0.015   # faces closer than this to z=0 are treated as front

bm = bmesh.new()
bm.from_mesh(mesh_data)
bm.normal_update()
uv_layer = bm.loops.layers.uv.new('UVMap')
bm.verts.ensure_lookup_table()
bm.faces.ensure_lookup_table()

for face in bm.faces:
    z_avg   = sum(lp.vert.co.z for lp in face.loops) / len(face.loops)
    is_back = (z_avg < -RIM_THRESH)   # only truly back-facing, never rim
    for loop in face.loops:
        u = (loop.vert.co.x - mesh_x_min_n) / mesh_x_rng
        v = (loop.vert.co.y - mesh_y_min_n) / mesh_y_rng
        if is_back:
            u = 1.0 - u
        loop[uv_layer].uv = (float(np.clip(u, 0.0, 1.0)), float(np.clip(v, 0.0, 1.0)))

sample = next((f for f in bm.faces
               if sum(lp.vert.co.z for lp in f.loops) / len(f.loops) > 0), None)
if sample:
    su, sv = sample.loops[0][uv_layer].uv
    print(f'[SilhouettePipe] sample UV (planar, proj tex) = ({su:.3f}, {sv:.3f})')

bm.to_mesh(mesh_data)
bm.free()
mesh_data.update()
print('[SilhouettePipe] UV assigned')

os.makedirs(os.path.dirname(os.path.abspath(output_glb)), exist_ok=True)

print('[SilhouettePipe] Stage 8 skipped (no extra maps needed)')

# ════════════════════════════════════════════════════════════════════════════
# STAGE 9 — Game-ready material (flat diffuse + emission for viewer compat)
#
# The source texture is a 2D illustration with its own painted lighting.
# PBR metallic/roughness/normal maps fight with that painted lighting and
# make the mesh look dark and wrong in web viewers (Babylon.js, Three.js).
#
# Instead: Principled BSDF with Metallic=0, Roughness=1 (pure diffuse,
# no reflections) + Emission Color tied to the same texture so the asset
# is always visible regardless of viewer lighting. Simple node tree that
# exports cleanly to glTF without lossy material conversion.
# ════════════════════════════════════════════════════════════════════════════

mat = bpy.data.materials.new('AssetMat')
mat.use_nodes = True
nt  = mat.node_tree
nds = nt.nodes
lks = nt.links
nds.clear()

# Minimal node tree: UV → TexImage → Principled BSDF → Output
# ONE texture node only — prevents glTF "more than one tex image" warning
out_n   = nds.new('ShaderNodeOutputMaterial');  out_n.location  = (600,  0)
bsdf_n  = nds.new('ShaderNodeBsdfPrincipled'); bsdf_n.location = (300,  0)
diff_n  = nds.new('ShaderNodeTexImage');        diff_n.location = (-200, 0)
uv_n    = nds.new('ShaderNodeUVMap');           uv_n.location   = (-500, 0)

diff_n.image = proj_img   # reprojected texture — sword pixels + grey background
diff_n.image.colorspace_settings.name = 'sRGB'
uv_n.uv_map  = 'UVMap'

# Wire: UV → Texture → Base Color → Output
lks.new(uv_n.outputs['UV'],      diff_n.inputs['Vector'])
lks.new(diff_n.outputs['Color'], bsdf_n.inputs['Base Color'])
bsdf_n.inputs['Alpha'].default_value = 1.0

# Flat diffuse — no reflections
bsdf_n.inputs['Metallic'].default_value  = 0.0
bsdf_n.inputs['Roughness'].default_value = 1.0
for sn in ('Specular IOR Level', 'Specular'):
    si = bsdf_n.inputs.get(sn)
    if si:
        si.default_value = 0.0
        break

# Emission so mesh is always visible regardless of viewer lighting
emit_in = bsdf_n.inputs.get('Emission Color') or bsdf_n.inputs.get('Emission')
if emit_in:
    lks.new(diff_n.outputs['Color'], emit_in)
emit_str = bsdf_n.inputs.get('Emission Strength')
if emit_str:
    emit_str.default_value = 0.25

lks.new(bsdf_n.outputs['BSDF'], out_n.inputs['Surface'])

mesh_obj.data.materials.append(mat)
print('[SilhouettePipe] simple material built (1 texture, grey bg, no alpha)')

# ════════════════════════════════════════════════════════════════════════════
# STAGE 10 — Subdivision (smooth mesh, no displacement)
#
# Displacement was adding noise artifacts and tearing on thin blade sections.
# With the flat game-ready material, surface bumps from the height map
# aren't needed — the 2D texture carries all the visual detail.
# ════════════════════════════════════════════════════════════════════════════

print('[SilhouettePipe] no SubSurf — 300-slice scanline profile is smooth enough')

# ════════════════════════════════════════════════════════════════════════════
# STAGE 11 — Scene, lighting, render preview
# ════════════════════════════════════════════════════════════════════════════

scene = bpy.context.scene
scene.render.engine               = 'CYCLES'
scene.cycles.device               = 'CPU'
scene.cycles.samples              = 48
scene.cycles.use_denoising        = True
scene.render.resolution_x         = 512
scene.render.resolution_y         = 1024
scene.render.resolution_percentage = 100
scene.render.film_transparent     = False

# World — light neutral ambient so the flat material shows colours clearly
world = bpy.data.worlds.new('World')
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
if bg:
    bg.inputs['Color'].default_value    = (0.6, 0.6, 0.65, 1.0)
    bg.inputs['Strength'].default_value = 1.0
scene.world = world

# Camera — at Y=-8 with Rx(90°) so it looks along world +Y.
# Mesh is also rotated Rx(90°), so its local +Z face (front cap, z_avg>0) ends up
# pointing world -Y = toward the camera.  UV front-cap = straight projection. ✓
cam_d = bpy.data.cameras.new('Cam')
cam_d.type        = 'ORTHO'
cam_d.ortho_scale = 2.5
cam_o = bpy.data.objects.new('Cam', cam_d)
bpy.context.collection.objects.link(cam_o)
scene.camera         = cam_o
cam_o.location       = (0, -8, 0)
cam_o.rotation_euler = (math.radians(90), 0, 0)   # looks along +Y

def _light(name, ltype, energy, color, loc, rot=(0,0,0), size=None):
    d = bpy.data.lights.new(name, type=ltype)
    d.energy = energy;  d.color = color
    if size: d.size = size
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    o.location       = loc
    o.rotation_euler = [math.radians(r) for r in rot]

# Lights: sword at origin, front face points world -Y (toward camera at Y=-8).
# Key and Fill sit between camera and sword (negative Y), Rim behind.
_light('Key',  'POINT', 800, (1.0, 0.97, 0.90), ( 1.2, -3.0,  1.0))
_light('Fill', 'POINT', 400, (1.0, 0.95, 0.90), (-1.5, -2.5,  0.5))
_light('Rim',  'POINT', 200, (0.8, 0.85, 1.0),  ( 0.0,  3.0, -0.5))

preview_path = output_preview if output_preview else (base_out + '_preview.png')
os.makedirs(os.path.dirname(os.path.abspath(preview_path)), exist_ok=True)
scene.render.filepath = preview_path
scene.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print(f'[SilhouettePipe] preview → {preview_path}')

# ════════════════════════════════════════════════════════════════════════════
# STAGE 12 — GLB export (MikkTSpace tangents, apply all modifiers)
# ════════════════════════════════════════════════════════════════════════════

bpy.context.view_layer.objects.active = mesh_obj
bpy.ops.object.select_all(action='DESELECT')
mesh_obj.select_set(True)

bpy.ops.export_scene.gltf(
    filepath         = output_glb,
    export_format    = 'GLB',
    export_materials = 'EXPORT',
    export_apply     = True,
    use_selection    = True,
    export_cameras   = False,
    export_lights    = False,
    export_tangents  = True,
)
print(f'[SilhouettePipe] GLB → {output_glb}')

# ════════════════════════════════════════════════════════════════════════════
# STAGE 13 — Save .blend
# ════════════════════════════════════════════════════════════════════════════

os.makedirs(os.path.dirname(os.path.abspath(output_blend)), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=output_blend)
print(f'[SilhouettePipe] blend → {output_blend}')
print('[SilhouettePipe] Done ✓')
