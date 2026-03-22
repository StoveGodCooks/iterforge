"""
sword_procedural.py — Procedural sword mesh generator for IterForge

Architecture (per Gemini + ChatGPT audit):
  image → extract metrics (centerline, width profile, zone boundaries)
       → fit procedural topology (blade with diamond cross-section, guard, grip, pommel)
       → project SDXL texture onto front/back faces
       → bevel + weighted normals
       → export GLB

This replaces silhouette-extrusion. Silhouette drives PARAMETERS not TOPOLOGY.

Usage:
  blender --background --python sword_procedural.py -- <texture_path> <output_glb> <output_blend> [output_preview]
"""

import bpy
import bmesh
import sys
import os
import math
import numpy as np

# ══════════════════════════════════════════════════════════════════════════════
# LAYER 4 HELPERS — Pure-NumPy image processing (no scipy/OpenCV needed)
# Implements the "Frequency Separation" pipeline from the architecture audit.
# ══════════════════════════════════════════════════════════════════════════════

def gaussian_blur_numpy(arr, sigma):
    """Separable Gaussian blur — pure NumPy, vectorised over rows then columns.
    Kernel offsets are unrolled into fast array-add accumulations.
    Fast enough for 1024×1024 at sigma≈25 in ~1 s."""
    size = max(3, int(sigma * 4) | 1)          # kernel size, always odd
    ax   = np.arange(-(size // 2), size // 2 + 1, dtype=np.float32)
    k    = np.exp(-ax**2 / (2 * sigma**2)).astype(np.float32)
    k   /= k.sum()
    pad  = size // 2
    h, w = arr.shape
    a    = arr.astype(np.float32)
    # ── Row pass ──
    rp  = np.pad(a, ((0, 0), (pad, pad)), mode='edge')
    row = np.zeros_like(a)
    for i, ki in enumerate(k):
        row += ki * rp[:, i:i + w]
    # ── Column pass ──
    cp  = np.pad(row, ((pad, pad), (0, 0)), mode='edge')
    col = np.zeros_like(row)
    for i, ki in enumerate(k):
        col += ki * cp[i:i + h, :]
    return col


def sobel_numpy(arr):
    """3×3 Sobel gradients in X and Y — pure NumPy, fully vectorised."""
    kx = np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=np.float32)
    ky = np.array([[ 1, 2, 1], [ 0, 0, 0], [-1,-2,-1]], dtype=np.float32)
    p  = np.pad(arr.astype(np.float32), 1, mode='edge')
    h, w = arr.shape
    gx = sum(kx[i, j] * p[i:i+h, j:j+w] for i in range(3) for j in range(3))
    gy = sum(ky[i, j] * p[i:i+h, j:j+w] for i in range(3) for j in range(3))
    return gx, gy


def generate_relief_maps(rgb, mask, blur_sigma=None):
    """Layer 4 — Frequency Separation (Gemini/ChatGPT architecture audit).

    Why this fixes the 'sticker / painted balloon' look:
      SDXL bakes inconsistent lighting INTO the texture (bright left side, dark
      right side, etc.).  If we displace with raw brightness those gradients cave
      the geometry in on shaded sides.  Instead we:
        1. Extract the MACRO light (low-frequency, wide Gaussian blur).
        2. Subtract it → only LOCAL micro-detail remains (engraving lines, grain,
           edge glints, rune grooves).
        3. Shift to 0.5 midpoint so the base mesh retains its volume.
        4. Clamp tightly [0.35, 0.65] so spikes never explode geometry.
        5. Force background pixels to neutral 0.5 (no background displacement).
        6. Sobel on height map → tangent-space normal map (micro-surface for free).
    """
    h, w = rgb.shape[:2]
    if blur_sigma is None:
        blur_sigma = max(h, w) / 40.0          # ~2.5 % of image size

    gray  = (0.299*rgb[:,:,0] + 0.587*rgb[:,:,1] + 0.114*rgb[:,:,2]).astype(np.float32)
    macro = gaussian_blur_numpy(gray, blur_sigma)
    local = gray - macro                       # high-frequency detail only
    hmap  = np.clip(local + 0.5, 0.35, 0.65)  # stable midpoint, no spikes
    hmap  = np.where(mask, hmap, 0.5)          # background → perfectly neutral

    gx, gy = sobel_numpy(hmap)
    nx, ny, nz = -gx, gy, np.full_like(hmap, 0.5, dtype=np.float32)
    nl  = np.sqrt(nx**2 + ny**2 + nz**2) + 1e-8
    nmap = np.dstack(((nx/nl)*0.5+0.5, (ny/nl)*0.5+0.5, (nz/nl)*0.5+0.5)).astype(np.float32)

    return hmap.astype(np.float32), nmap


def save_bpy_image(arr_float, name, filepath):
    """Write a float32 NumPy array to disk as PNG via Blender's image API.
    arr_float: (H,W) grayscale  or  (H,W,3) RGB  — values in [0, 1].
    Blender stores pixels bottom-to-top, so we flipud before writing."""
    h, w = arr_float.shape[:2]
    rgba = np.ones((h, w, 4), dtype=np.float32)
    if arr_float.ndim == 2:
        rgba[:,:,0] = rgba[:,:,1] = rgba[:,:,2] = arr_float
    else:
        rgba[:,:,:3] = arr_float
    img = bpy.data.images.new(name, width=w, height=h, alpha=False, float_buffer=False)
    img.pixels[:] = np.flipud(rgba).ravel()
    img.filepath_raw = filepath
    img.file_format  = 'PNG'
    img.save()
    return img

# ── Args ──────────────────────────────────────────────────────────────────────
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(args) < 3:
    print('[SwordPro] USAGE: -- <texture_path> <output_glb> <output_blend> [output_preview]')
    sys.exit(1)

texture_path   = args[0].replace('\\', '/')
output_glb     = args[1]
output_blend   = args[2]
output_preview = args[3].replace('\\', '/') if len(args) > 3 else None

print(f'[SwordPro] texture  = {texture_path}')
print(f'[SwordPro] glb      = {output_glb}')

# ── Clear scene ───────────────────────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
for blk in list(bpy.data.meshes):    bpy.data.meshes.remove(blk)
for blk in list(bpy.data.materials): bpy.data.materials.remove(blk)
for blk in list(bpy.data.images):    bpy.data.images.remove(blk)
for blk in list(bpy.data.lights):    bpy.data.lights.remove(blk)
for blk in list(bpy.data.cameras):   bpy.data.cameras.remove(blk)

# ── Load image as NumPy array ─────────────────────────────────────────────────
if not os.path.isfile(texture_path):
    print(f'[SwordPro] ERROR: texture not found: {texture_path}')
    sys.exit(1)

img_bpy = bpy.data.images.load(texture_path)
img_bpy.colorspace_settings.name = 'sRGB'
iw, ih = img_bpy.size

# Blender pixels: RGBA floats, stored bottom-to-top → flip to top-to-bottom
px = np.array(img_bpy.pixels[:], dtype=np.float32).reshape((ih, iw, 4))
px = np.flipud(px)
rgb = px[:, :, :3]

print(f'[SwordPro] image {iw}×{ih}')

# ══════════════════════════════════════════════════════════════════════════════
# STAGE 1 — Robust mask extraction (variance filter kills glow/bloom)
# ══════════════════════════════════════════════════════════════════════════════

mean_brightness = np.mean(rgb, axis=2)           # (h, w)
variance        = np.std(rgb, axis=2)            # (h, w)  — glow has low variance

# Sample background color from corners (top-left block average)
corner_pixels = np.concatenate([
    rgb[:30, :30].reshape(-1, 3),
    rgb[:30, -30:].reshape(-1, 3),
    rgb[-30:, :30].reshape(-1, 3),
    rgb[-30:, -30:].reshape(-1, 3),
])
bg_color = np.median(corner_pixels, axis=0)   # robust median background estimate
corner_b = float(np.mean(bg_color))

# Deviation from background — works for white, grey, AND dark backgrounds
bg_mean_map = np.mean(rgb, axis=2)
deviation   = np.abs(mean_brightness - corner_b)

if corner_b > 0.80:
    # Pure white BG: pixels significantly darker than white OR high variance = sword
    mask = (deviation > 0.10) | (variance > 0.07)
elif corner_b > 0.35:
    # Grey BG: MUST have high deviation from BG and some variance to exclude flat BG
    mask = (deviation > 0.12) & ((variance > 0.05) | (mean_brightness < corner_b - 0.20))
else:
    # Dark BG: anything brighter than background
    mask = (deviation > 0.10) | (variance > 0.07)

print(f'[SwordPro] bg_color={bg_color}  corner_b={corner_b:.3f}')

# ══════════════════════════════════════════════════════════════════════════════
# STAGE 2 — Isolate central connected component (kills multi-sword contamination)
# ══════════════════════════════════════════════════════════════════════════════

def get_central_component(mask):
    """BFS on a downscaled copy → isolates the blob nearest to image centre."""
    h, w  = mask.shape
    SCALE = max(1, min(h, w) // 128)   # target ~128px on shortest axis
    dh    = max(1, h // SCALE)
    dw    = max(1, w // SCALE)

    # Downsample: any True pixel in block → True
    crop_h, crop_w = dh * SCALE, dw * SCALE
    ds = mask[:crop_h, :crop_w].reshape(dh, SCALE, dw, SCALE).any(axis=(1, 3))

    # Find start pixel: bright pixel closest to image centre
    ys, xs = np.where(ds)
    if len(ys) == 0:
        return mask

    cy, cx  = dh // 2, dw // 2
    dists   = (ys - cy) ** 2 + (xs - cx) ** 2
    sy, sx  = int(ys[np.argmin(dists)]), int(xs[np.argmin(dists)])

    # Stack-based BFS (fast for small downscaled image)
    visited = np.zeros((dh, dw), dtype=bool)
    stack   = [(sy, sx)]
    visited[sy, sx] = True
    comp    = []

    while stack:
        y, x = stack.pop()
        comp.append((y, x))
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < dh and 0 <= nx < dw and ds[ny, nx] and not visited[ny, nx]:
                visited[ny, nx] = True
                stack.append((ny, nx))

    # Build full-res mask from component
    comp_ds = np.zeros((dh, dw), dtype=bool)
    for y, x in comp:
        comp_ds[y, x] = True

    comp_full = np.zeros_like(mask)
    for y in range(dh):
        for x in range(dw):
            if comp_ds[y, x]:
                y0, y1 = y * SCALE, min((y + 1) * SCALE, h)
                x0, x1 = x * SCALE, min((x + 1) * SCALE, w)
                comp_full[y0:y1, x0:x1] = True

    return comp_full & mask

mask = get_central_component(mask)

# ══════════════════════════════════════════════════════════════════════════════
# STAGE 3 — Morphological cleanup (erode → dilate removes thin glow tendrils)
# ══════════════════════════════════════════════════════════════════════════════

def morph(mask, op, iters=1):
    for _ in range(iters):
        padded = np.pad(mask.astype(np.uint8), 1)
        if op == 'erode':
            result = np.ones_like(mask, dtype=bool)
            for dy in range(3):
                for dx in range(3):
                    result &= padded[dy:dy + mask.shape[0], dx:dx + mask.shape[1]].astype(bool)
        else:
            result = np.zeros_like(mask, dtype=bool)
            for dy in range(3):
                for dx in range(3):
                    result |= padded[dy:dy + mask.shape[0], dx:dx + mask.shape[1]].astype(bool)
        mask = result
    return mask

mask = morph(mask, 'erode',  2)
mask = morph(mask, 'dilate', 2)

# Bounding box
rows_idx, cols_idx = np.where(mask)
if len(rows_idx) == 0:
    print('[SwordPro] ERROR: no sword detected in image')
    sys.exit(1)

r_min, r_max = int(rows_idx.min()), int(rows_idx.max())
c_min, c_max = int(cols_idx.min()), int(cols_idx.max())
sword_h_px   = r_max - r_min + 1
sword_w_px   = c_max - c_min + 1
print(f'[SwordPro] bbox rows {r_min}–{r_max}  cols {c_min}–{c_max}  ({sword_w_px}×{sword_h_px}px)')

# ══════════════════════════════════════════════════════════════════════════════
# STAGE 4 — Width profile + centerline (smoothed)
# ══════════════════════════════════════════════════════════════════════════════

widths     = np.zeros(ih, dtype=float)
centerline = np.full(ih, (c_min + c_max) / 2.0, dtype=float)

for y in range(r_min, r_max + 1):
    bright = np.where(mask[y, c_min:c_max + 1])[0]
    if len(bright):
        widths[y]     = float(bright[-1] - bright[0] + 1)
        centerline[y] = float(bright[0] + bright[-1]) / 2 + c_min

# Smooth (31-px moving average)
def smooth1d(arr, valid_mask, k=31):
    kernel = np.ones(k) / k
    s = np.convolve(arr * valid_mask, kernel, mode='same')
    w = np.convolve(valid_mask.astype(float), kernel, mode='same')
    return np.where(w > 1e-6, s / w, arr)

valid = widths > 0
widths     = smooth1d(widths,     valid)
centerline = smooth1d(centerline, valid)

# ══════════════════════════════════════════════════════════════════════════════
# STAGE 5 — Zone segmentation via horizontal projection profile
# ══════════════════════════════════════════════════════════════════════════════
# Key insight: blade = narrow, guard = widest spike, grip = narrow, pommel = small bulge

w_slice    = widths[r_min:r_max + 1]
mean_w     = float(np.mean(w_slice[w_slice > 0])) if np.any(w_slice > 0) else sword_w_px * 0.3
sword_rows = np.arange(r_min, r_max + 1)

# Guard: widest row in middle 40–88% of sword height (exclude tip + pommel)
search_lo  = int(len(w_slice) * 0.40)
search_hi  = int(len(w_slice) * 0.88)
search_w   = w_slice[search_lo:search_hi]
guard_i    = int(np.argmax(search_w)) + search_lo   # index within w_slice
guard_row  = r_min + guard_i
guard_w_px = float(w_slice[guard_i])

# Guard extent: rows around the peak where width > 1.4× mean blade
guard_thresh = mean_w * 1.4
guard_rows_mask = w_slice > guard_thresh
# Find contiguous block around guard_i
g_top_i = guard_i
g_bot_i = guard_i
while g_top_i > 0          and guard_rows_mask[g_top_i - 1]: g_top_i -= 1
while g_bot_i < len(w_slice) - 1 and guard_rows_mask[g_bot_i + 1]: g_bot_i += 1

blade_top_row  = r_min
blade_bot_row  = r_min + g_top_i
grip_top_row   = r_min + g_bot_i
grip_bot_row   = r_min + int(len(w_slice) * 0.90)
pommel_top_row = grip_bot_row
pommel_bot_row = r_max

# Store actual guard zone rows in IMAGE space BEFORE any orientation flip.
# These are used for guard_h_bu later — they must not change with the flip.
guard_zone_top_img = r_min + g_top_i
guard_zone_bot_img = r_min + g_bot_i

# Cap guard width: crossguard should never exceed 40% of sword height
max_guard_w = sword_h_px * 0.40
if guard_w_px > max_guard_w:
    print(f'[SwordPro] guard width capped {guard_w_px:.0f} → {max_guard_w:.0f}px')
    guard_w_px = max_guard_w

# ── Orientation detection: which end has the blade tip? ───────────────────────
# The blade tip is the narrowest end. Average width of top 20% vs bottom 20%.
seg5 = max(1, len(w_slice) // 5)
top_avg_w = float(np.mean(w_slice[:seg5][w_slice[:seg5] > 0])) if np.any(w_slice[:seg5] > 0) else 0
bot_avg_w = float(np.mean(w_slice[-seg5:][w_slice[-seg5:] > 0])) if np.any(w_slice[-seg5:] > 0) else 0
tip_at_top = top_avg_w <= bot_avg_w   # True = tip at top of image (normal), False = handle at top

print(f'[SwordPro] orientation: top_avg_w={top_avg_w:.1f}  bot_avg_w={bot_avg_w:.1f}  tip_at_top={tip_at_top}')

if not tip_at_top:
    # Sword is handle-up in the image — flip all zone assignments
    def flip_row(r): return r_max - (r - r_min)
    blade_top_row, blade_bot_row   = flip_row(blade_bot_row),  flip_row(blade_top_row)
    grip_top_row,  grip_bot_row    = flip_row(grip_bot_row),   flip_row(grip_top_row)
    pommel_top_row, pommel_bot_row = flip_row(pommel_bot_row), flip_row(pommel_top_row)
    guard_row = flip_row(guard_row)
    # Ensure correct ordering after flip
    blade_top_row, blade_bot_row   = min(blade_top_row, blade_bot_row),  max(blade_top_row, blade_bot_row)
    grip_top_row,  grip_bot_row    = min(grip_top_row,  grip_bot_row),   max(grip_top_row,  grip_bot_row)
    pommel_top_row, pommel_bot_row = min(pommel_top_row, pommel_bot_row), max(pommel_top_row, pommel_bot_row)
    print('[SwordPro] zones flipped — handle was at top of image')

print(f'[SwordPro] guard row={guard_row}  w={guard_w_px:.0f}px')
print(f'[SwordPro] blade  {blade_top_row}–{blade_bot_row}')
print(f'[SwordPro] grip   {grip_top_row}–{grip_bot_row}')
print(f'[SwordPro] pommel {pommel_top_row}–{pommel_bot_row}')

# ══════════════════════════════════════════════════════════════════════════════
# STAGE 6 — Coordinate system
# ══════════════════════════════════════════════════════════════════════════════

H     = 2.0    # sword height in Blender units
# REF_W: use guard width (capped) so proportions are correct for a sword
REF_W = max(guard_w_px, sword_h_px * 0.15, 1.0)   # guard is typically 30-40% of height

def row_to_z(r):
    return H * (1.0 - (r - r_min) / max(sword_h_px - 1, 1)) - H / 2

def px_to_x(col):
    return ((col - (c_min + c_max) / 2) / REF_W) * H * 0.55

def px_w_to_bu(w):
    return (w / REF_W) * H * 0.55

# ══════════════════════════════════════════════════════════════════════════════
# STAGE 7 — Blade: diamond cross-section mesh
# Each ring = 4 verts: left-edge, front-ridge, right-edge, back-ridge
# This gives two bevelled planes per side (correct sword look)
# ══════════════════════════════════════════════════════════════════════════════

N_RINGS = 48   # blade sample count

blade_data = bpy.data.meshes.new('BladeMesh')
blade_obj  = bpy.data.objects.new('Blade', blade_data)
bpy.context.collection.objects.link(blade_obj)

bm      = bmesh.new()
uv_lyr  = bm.loops.layers.uv.new('UVMap')

# Use image only for blade BASE width — then taper linearly to tip.
# This eliminates crumpled topology from noisy pixel profiles ("silhouette drives parameters, not topology")
blade_base_row = blade_bot_row if tip_at_top else blade_top_row
blade_tip_row  = blade_top_row if tip_at_top else blade_bot_row

# Measure blade width 12% INTO the blade zone from the base end
# — avoids guard junction contamination where guard wings still overlap
blade_zone_len = abs(blade_tip_row - blade_base_row)
skip = int(blade_zone_len * 0.12)
blade_measure_row = int(np.clip(
    blade_base_row + skip if blade_tip_row > blade_base_row else blade_base_row - skip,
    r_min, r_max
))
blade_base_w = max(float(widths[blade_measure_row]), sword_h_px * 0.04)
print(f'[SwordPro] blade_base_row={blade_base_row}  measure_row={blade_measure_row}  blade_base_w={blade_base_w:.1f}px')
# Centerline: use average over blade zone (more stable than per-row)
blade_cx_px    = float(np.mean(centerline[blade_top_row:blade_bot_row+1][widths[blade_top_row:blade_bot_row+1] > 0])) if np.any(widths[blade_top_row:blade_bot_row+1] > 0) else (c_min + c_max) / 2.0

blade_sample_rows = np.linspace(blade_tip_row, blade_base_row, N_RINGS).astype(int)
rings = []   # list of (row, [v0,v1,v2,v3], cx_bu, hw_bu, thick_bu, z)

for i, row in enumerate(blade_sample_rows):
    row = int(np.clip(row, r_min, r_max))
    z   = row_to_z(row)

    # LINEAR taper: 0 at tip (i=0), blade_base_w at base (i=N_RINGS-1)
    taper  = i / max(N_RINGS - 1, 1)
    hw     = max(px_w_to_bu(blade_base_w) / 2 * taper, 0.003)
    cx     = px_to_x(blade_cx_px)   # stable centerline, not per-row noise

    # Thickness also tapers proportionally
    t_norm = taper
    thick  = max(hw * 0.45, 0.002)

    # Diamond: left(v0), front-ridge(v1), right(v2), back-ridge(v3)
    ring = [
        bm.verts.new((cx - hw,    0.0,    z)),
        bm.verts.new((cx,         +thick, z)),
        bm.verts.new((cx + hw,    0.0,    z)),
        bm.verts.new((cx,         -thick, z)),
    ]
    rings.append((row, ring, cx, hw, thick, z))

# Bridge adjacent rings — 4 quads per pair
for i in range(len(rings) - 1):
    _, r0, *_ = rings[i]
    _, r1, *_ = rings[i + 1]
    try: bm.faces.new([r0[0], r0[1], r1[1], r1[0]])
    except: pass
    try: bm.faces.new([r0[1], r0[2], r1[2], r1[1]])
    except: pass
    try: bm.faces.new([r0[2], r0[3], r1[3], r1[2]])
    except: pass
    try: bm.faces.new([r0[3], r0[0], r1[0], r1[3]])
    except: pass

# Tip cap (4 triangles converging to a point)
tip_cx, tip_z = rings[0][2], rings[0][5]
try:
    tip_v = bm.verts.new((tip_cx, 0, tip_z + 0.012))
    for j in range(4):
        try: bm.faces.new([rings[0][1][j], tip_v, rings[0][1][(j + 1) % 4]])
        except: pass
except: pass

# Base cap
try: bm.faces.new([rings[-1][1][3], rings[-1][1][2], rings[-1][1][1], rings[-1][1][0]])
except: pass

bm.normal_update()

# ── UV: map vertices back to image pixel space then normalise ─────────────────
# Front/back faces → planar front-projection (X→U, Z→V)
# Side rim faces (normals mostly in Y) → thin vertical strip at U=0.01 or 0.99
for face in bm.faces:
    ny = face.normal.y
    nx = face.normal.x
    for loop in face.loops:
        vx = loop.vert.co.x
        vz = loop.vert.co.z
        # Map 3D position back to image UV
        img_col = vx / (H * 0.55) * REF_W + (c_min + c_max) / 2
        img_row = (1.0 - (vz + H / 2) / H) * (sword_h_px - 1) + r_min
        u = max(0.0, min(1.0, (img_col - c_min) / max(sword_w_px, 1)))
        v = max(0.0, min(1.0, (img_row - r_min) / max(sword_h_px, 1)))

        if abs(ny) < 0.3:
            # Side/rim face — sample a thin vertical strip at the blade edge
            # Keeps consistent metal color without stretching the art
            edge_u = max(0.0, min(1.0, (blade_cx_px - c_min) / max(sword_w_px, 1)))
            loop[uv_lyr].uv = (edge_u, v)
        elif ny > 0:
            # Back face — mirror U so left/right match front
            loop[uv_lyr].uv = (1.0 - u, v)
        else:
            # Front face — direct mapping
            loop[uv_lyr].uv = (u, v)

bm.to_mesh(blade_data)
bm.free()
for p in blade_data.polygons: p.use_smooth = True

# ══════════════════════════════════════════════════════════════════════════════
# STAGE 8 — Guard: extruded box fitted to detected guard zone
# ══════════════════════════════════════════════════════════════════════════════

guard_z    = row_to_z(guard_row)
# Use pre-flip guard zone rows for true physical guard height
guard_h_bu = max(abs(row_to_z(guard_zone_top_img) - row_to_z(guard_zone_bot_img)), H * 0.04)
guard_w_bu = px_w_to_bu(guard_w_px)
guard_d_bu = max(guard_w_bu * 0.22, 0.04)
print(f'[SwordPro] guard_z={guard_z:.3f}  guard_h_bu={guard_h_bu:.3f}  guard_w_bu={guard_w_bu:.3f}')

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, guard_z))
guard_obj = bpy.context.active_object
guard_obj.name = 'Guard'
guard_obj.scale = (guard_w_bu, guard_d_bu, max(guard_h_bu / 2, 0.02))
bpy.context.view_layer.objects.active = guard_obj
bpy.ops.object.transform_apply(scale=True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=1.15)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.shade_smooth()

# ══════════════════════════════════════════════════════════════════════════════
# STAGE 9 — Grip: 12-sided cylinder fitted to grip zone
# ══════════════════════════════════════════════════════════════════════════════

grip_z      = (row_to_z(grip_top_row) + row_to_z(grip_bot_row)) / 2
grip_h_bu   = abs(row_to_z(grip_top_row) - row_to_z(grip_bot_row))
grip_ws     = widths[grip_top_row:grip_bot_row + 1]
avg_grip_w  = float(np.mean(grip_ws[grip_ws > 0])) if np.any(grip_ws > 0) else sword_w_px * 0.12
grip_r      = max(px_w_to_bu(avg_grip_w) / 2, 0.015)

bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=grip_r,
                                     depth=max(grip_h_bu, 0.05), location=(0, 0, grip_z))
grip_obj = bpy.context.active_object
grip_obj.name = 'Grip'
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.unwrap(method='ANGLE_BASED')
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.shade_smooth()

# ══════════════════════════════════════════════════════════════════════════════
# STAGE 10 — Pommel: flattened UV sphere fitted to pommel zone
# ══════════════════════════════════════════════════════════════════════════════

pommel_z    = (row_to_z(pommel_top_row) + row_to_z(pommel_bot_row)) / 2
pommel_ws   = widths[pommel_top_row:pommel_bot_row + 1]
max_pommel_w = float(np.max(pommel_ws[pommel_ws > 0])) if np.any(pommel_ws > 0) else avg_grip_w * 1.6
pommel_r    = max(px_w_to_bu(max_pommel_w) / 2, grip_r * 1.1)
pommel_h_bu = abs(row_to_z(pommel_top_row) - row_to_z(pommel_bot_row))

bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=10,
                                      radius=pommel_r, location=(0, 0, pommel_z))
pommel_obj = bpy.context.active_object
pommel_obj.name = 'Pommel'
# Flatten to match pommel zone height
pommel_obj.scale.z = max(pommel_h_bu / (2 * pommel_r), 0.3)
bpy.context.view_layer.objects.active = pommel_obj
bpy.ops.object.transform_apply(scale=True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project()
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.shade_smooth()

# ══════════════════════════════════════════════════════════════════════════════
# STAGE 11 — Join all parts + post-processing
# ══════════════════════════════════════════════════════════════════════════════

bpy.ops.object.select_all(action='DESELECT')
for obj in [blade_obj, guard_obj, grip_obj, pommel_obj]:
    obj.select_set(True)
bpy.context.view_layer.objects.active = blade_obj
bpy.ops.object.join()
sword = bpy.context.active_object
sword.name = 'Sword'

# Recalculate normals
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')

# Bevel modifier — tiny bevel transforms low-poly look dramatically
bevel = sword.modifiers.new('Bevel', type='BEVEL')
bevel.width        = 0.003
bevel.segments     = 2
bevel.limit_method = 'ANGLE'
bevel.angle_limit  = math.radians(30)

# Weighted normals — huge visual gain for hard-surface shading
wn      = sword.modifiers.new('WeightedNormal', type='WEIGHTED_NORMAL')
wn.mode = 'FACE_AREA'
wn.weight = 50

# ══════════════════════════════════════════════════════════════════════════════
# STAGE 12 — PBR material
# ══════════════════════════════════════════════════════════════════════════════

mat   = bpy.data.materials.new('SwordMat')
mat.use_nodes = True
nodes = mat.node_tree.nodes
links = mat.node_tree.links
nodes.clear()

out_node  = nodes.new('ShaderNodeOutputMaterial')
bsdf_node = nodes.new('ShaderNodeBsdfPrincipled')
tex_node  = nodes.new('ShaderNodeTexImage')
uv_node   = nodes.new('ShaderNodeUVMap')

tex_node.image  = img_bpy
uv_node.uv_map  = 'UVMap'

bsdf_node.inputs['Metallic'].default_value  = 0.45   # lower = texture more visible
bsdf_node.inputs['Roughness'].default_value = 0.35
for spec in ('Specular IOR Level', 'Specular'):
    if spec in bsdf_node.inputs:
        bsdf_node.inputs[spec].default_value = 0.85
        break

out_node.location  = (500, 200)
bsdf_node.location = (200, 200)
tex_node.location  = (-200, 200)
uv_node.location   = (-500, 200)

links.new(uv_node.outputs['UV'],          tex_node.inputs['Vector'])
links.new(tex_node.outputs['Color'],      bsdf_node.inputs['Base Color'])
links.new(bsdf_node.outputs['BSDF'],      out_node.inputs['Surface'])

sword.data.materials.clear()
sword.data.materials.append(mat)

# ══════════════════════════════════════════════════════════════════════════════
# STAGE 12.5 — Layer 4: Frequency Separation → Height Map + Normal Map
# Extracts micro-detail (engravings, grain, edge glints) from the SDXL texture
# and uses it to physically displace vertices + drive the normal map slot.
# This converts the flat "sticker on a balloon" look into a surface that reacts
# to light like real carved metal.
# ══════════════════════════════════════════════════════════════════════════════

print('[SwordPro] Layer 4: computing frequency-separated relief maps...')
hmap, nmap = generate_relief_maps(rgb, mask)

relief_dir = os.path.dirname(output_glb)
stem       = os.path.splitext(os.path.basename(output_glb))[0]
hmap_path  = os.path.join(relief_dir, f'{stem}_height.png')
nmap_path  = os.path.join(relief_dir, f'{stem}_normal.png')

hmap_img = save_bpy_image(hmap, 'HeightMap', hmap_path)
nmap_img = save_bpy_image(nmap, 'NormalMap',  nmap_path)
nmap_img.colorspace_settings.name = 'Non-Color'   # critical — wrong colorspace = broken normals
print(f'[SwordPro] height map → {hmap_path}')
print(f'[SwordPro] normal map → {nmap_path}')

# Subdivision level 1 — gives displacement modifier vertices to push/pull.
# Level 1 = 4× face count, enough for subtle relief without bloating GLB size.
subd               = sword.modifiers.new('Subd', type='SUBSURF')
subd.levels        = 1
subd.render_levels = 1

# Displace modifier: height map drives actual vertex displacement.
# strength=0.012 is subtle — enough for light to catch edges, not enough to
# deform the silhouette shape.  mid_level=0.5 matches our height map midpoint.
disp_tex           = bpy.data.textures.new('HeightTex', type='IMAGE')
disp_tex.image     = hmap_img
disp_tex.use_clamp = False
disp_mod                = sword.modifiers.new('Displace', type='DISPLACE')
disp_mod.texture        = disp_tex
disp_mod.texture_coords = 'UV'
disp_mod.uv_layer       = 'UVMap'
disp_mod.strength       = 0.010
disp_mod.mid_level      = 0.5
# Limit displacement to blade only — grip/pommel UVs map to wrong texture region
# causing violent spikes if displacement is applied there.
if 'BLADE' in sword.vertex_groups:
    disp_mod.vertex_group = 'BLADE'

# Wire normal map into PBR shader Normal input.
# Gives micro-surface detail (leather wrapping, scratches, blade groove) for free.
norm_tex          = nodes.new('ShaderNodeTexImage')
norm_tex.image    = nmap_img   # colorspace already set to Non-Color on the image object above
norm_tex.location = (-200, -200)

norm_map          = nodes.new('ShaderNodeNormalMap')
norm_map.space    = 'TANGENT'
norm_map.inputs['Strength'].default_value = 0.4   # conservative — blade detail without grip artifact
norm_map.location = (0, -200)

links.new(uv_node.outputs['UV'],       norm_tex.inputs['Vector'])
links.new(norm_tex.outputs['Color'],   norm_map.inputs['Color'])
links.new(norm_map.outputs['Normal'],  bsdf_node.inputs['Normal'])

print('[SwordPro] Layer 4: relief maps applied ✓')

# ══════════════════════════════════════════════════════════════════════════════
# STAGE 13 — Scene, lighting, camera
# ══════════════════════════════════════════════════════════════════════════════

scene = bpy.context.scene
scene.render.engine          = 'CYCLES'
scene.cycles.device          = 'CPU'
scene.cycles.samples         = 64
scene.cycles.use_denoising   = True
scene.render.resolution_x    = 512
scene.render.resolution_y    = 1024
scene.render.resolution_percentage = 100
scene.render.film_transparent = False

world = bpy.data.worlds.new('World')
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
if bg:
    bg.inputs['Color'].default_value    = (0.02, 0.02, 0.04, 1.0)
    bg.inputs['Strength'].default_value = 0.05
scene.world = world

cam_d = bpy.data.cameras.new('Camera')
cam_o = bpy.data.objects.new('Camera', cam_d)
bpy.context.collection.objects.link(cam_o)
scene.camera     = cam_o
cam_d.type       = 'ORTHO'
# Auto-fit: ortho scale = max(sword height, guard width) + 15% padding
guard_w_bu_final = px_w_to_bu(guard_w_px)
cam_d.ortho_scale = max(H, guard_w_bu_final) * 1.15
cam_o.location       = (0, -8, 0)
cam_o.rotation_euler = (math.radians(90), 0, 0)

def add_light(name, ltype, energy, color, loc, rot_deg=None, size=None, spot_size=None):
    d = bpy.data.lights.new(name, type=ltype)
    d.energy = energy
    d.color  = color
    if size:      d.size     = size
    if spot_size: d.spot_size = math.radians(spot_size)
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    o.location = loc
    if rot_deg:
        o.rotation_euler = tuple(math.radians(r) for r in rot_deg)

add_light('Key',  'AREA',  500, (1.0,  0.95, 0.85), (2.5,  -4,    3.5), rot_deg=(45,  0, 25), size=2.5)
add_light('Rim',  'SPOT',  300, (0.25, 0.45, 1.0),  (-1.5,  4,    1.0), rot_deg=(-60, 0, 180), spot_size=60)
add_light('Fill', 'AREA',  120, (1.0,  0.85, 0.6),  (-3,   -2,    0.0), size=3.0)

# ══════════════════════════════════════════════════════════════════════════════
# STAGE 14 — Render + export
# ══════════════════════════════════════════════════════════════════════════════

preview_path = output_preview or (os.path.splitext(output_glb)[0] + '_preview.png')
os.makedirs(os.path.dirname(preview_path),  exist_ok=True)
os.makedirs(os.path.dirname(output_glb),    exist_ok=True)
os.makedirs(os.path.dirname(output_blend),  exist_ok=True)

scene.render.filepath = preview_path
scene.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print(f'[SwordPro] preview → {preview_path}')

bpy.context.view_layer.objects.active = sword
bpy.ops.object.select_all(action='DESELECT')
sword.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=output_glb,
    export_format='GLB',
    export_materials='EXPORT',
    export_apply=True,
    use_selection=True,
    export_cameras=False,
    export_lights=False,
)
print(f'[SwordPro] GLB     → {output_glb}')

bpy.ops.wm.save_as_mainfile(filepath=output_blend)
print(f'[SwordPro] blend   → {output_blend}')
print('[SwordPro] Done ✓')
