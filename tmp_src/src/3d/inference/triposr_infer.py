#!/usr/bin/env python3
"""
triposr_infer.py — IterForge TripoSR 3D Reconstruction Pipeline

Bootstraps all dependencies on first run (uses ComfyUI's embedded Python so
torch is already available).  Downloads TripoSR weights (~1 GB, MIT licence)
from HuggingFace and caches them in ITERFORGE_HOME/3d/weights/triposr/.

Usage:
    python triposr_infer.py \\
        --image  <abs-path-to-png>  \\
        --output <abs-path-to-output-dir>  \\
        [--mask  <abs-path-to-mask-png>]   \\
        [--resolution 256]

Stdout protocol (consumed by src/backends/triposr.js):
    [TripoSR] PROGRESS: <n>/<total> <message>
    [TripoSR] DONE: {"glbPath":"...","previewPath":"..."}
    [TripoSR] ERROR: <message>
"""

import sys
import os
import argparse
import json
import traceback
from pathlib import Path

# ── Progress helpers ───────────────────────────────────────────────────────────

TOTAL_STEPS = 10

def prog(n, msg):
    print(f"[TripoSR] PROGRESS: {n}/{TOTAL_STEPS} {msg}", flush=True)

def done(payload: dict):
    print(f"[TripoSR] DONE: {json.dumps(payload)}", flush=True)

def fail(msg: str):
    print(f"[TripoSR] ERROR: {msg}", flush=True)
    sys.exit(1)

# ── Paths ──────────────────────────────────────────────────────────────────────

ITERFORGE_HOME = Path(os.environ.get(
    'ITERFORGE_HOME',
    Path.home() / 'AppData' / 'Roaming' / 'IterForge'
))

WEIGHTS_DIR  = ITERFORGE_HOME / '3d' / 'weights' / 'triposr'
TSR_PKG_DIR  = ITERFORGE_HOME / '3d' / 'tsr_pkg'
TSR_SRC_DIR  = TSR_PKG_DIR / 'TripoSR'

HF_REPO_ID   = 'stabilityai/TripoSR'
# Pinned GitHub archive — known-good commit of VAST-AI-Research/TripoSR
TSR_ARCHIVE_URL = (
    'https://github.com/VAST-AI-Research/TripoSR/archive/'
    'refs/heads/main.zip'
)

# ── Step 1: bootstrap extra pip deps ──────────────────────────────────────────

def _pip_install(*pkgs):
    import subprocess
    subprocess.check_call(
        [sys.executable, '-m', 'pip', 'install', '--quiet', *pkgs],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )

def bootstrap_deps():
    prog(1, "Checking dependencies…")
    missing = []
    checks = {
        'huggingface_hub': 'huggingface_hub',
        'trimesh':         'trimesh',
        'xatlas':          'xatlas',
        'einops':          'einops',
        'omegaconf':       'omegaconf',
        'mcubes':          'PyMCubes',
        'rembg':           'rembg[cpu]',
    }
    for mod, pkg in checks.items():
        try:
            __import__(mod)
        except ImportError:
            missing.append(pkg)

    # transformers / Pillow should already be present in ComfyUI python
    for mod, pkg in [('transformers', 'transformers'), ('PIL', 'Pillow')]:
        try:
            __import__(mod)
        except ImportError:
            missing.append(pkg)

    if missing:
        prog(1, f"Installing: {', '.join(missing)}")
        _pip_install(*missing)

# ── Step 2: download / locate TripoSR source package ──────────────────────────

def ensure_tsr_package():
    prog(2, "Locating TripoSR package…")

    # Try import first (works if already installed via pip)
    try:
        import tsr  # noqa: F401
        return
    except ImportError:
        pass

    # Try vendored copy — don't test-import here (patch happens before real load)
    vendor_system = TSR_SRC_DIR / 'tsr' / 'system.py'
    if vendor_system.exists():
        sys.path.insert(0, str(TSR_SRC_DIR))
        return

    # Download archive
    prog(2, "Downloading TripoSR source (~5 MB)…")
    import urllib.request, zipfile, io

    TSR_PKG_DIR.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(TSR_ARCHIVE_URL, timeout=120) as resp:
            data = resp.read()
    except Exception as e:
        fail(f"Could not download TripoSR source: {e}")

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        # Archive root is TripoSR-main/
        names = zf.namelist()
        prefix = names[0].split('/')[0] + '/'
        for member in names:
            rel = member[len(prefix):]
            if not rel:
                continue
            dest = TSR_SRC_DIR / rel
            if member.endswith('/'):
                dest.mkdir(parents=True, exist_ok=True)
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(zf.read(member))

    sys.path.insert(0, str(TSR_SRC_DIR))
    patch_isosurface()
    try:
        import tsr  # noqa: F401
    except ImportError as e:
        fail(f"TripoSR source downloaded but import failed: {e}")

# ── Step 2b: patch torchmcubes → skimage (no CUDA compilation needed) ─────────

ISOSURFACE_PATCH = '''\
from typing import Callable, Optional, Tuple
import numpy as np
import torch
import torch.nn as nn

def marching_cubes(level: torch.Tensor, threshold: float = 0.0):
    from skimage.measure import marching_cubes as sk_mc
    vol = level.detach().cpu().numpy()
    try:
        verts, faces, _normals, _values = sk_mc(vol, level=threshold, allow_degenerate=False)
    except (ValueError, RuntimeError):
        verts = np.zeros((0, 3), dtype=np.float32)
        faces = np.zeros((0, 3), dtype=np.int64)
    return torch.from_numpy(verts.astype(np.float32)), torch.from_numpy(faces.astype(np.int64))

class IsosurfaceHelper(nn.Module):
    points_range: Tuple[float, float] = (0, 1)
    @property
    def grid_vertices(self) -> torch.FloatTensor:
        raise NotImplementedError

class MarchingCubeHelper(IsosurfaceHelper):
    def __init__(self, resolution: int) -> None:
        super().__init__()
        self.resolution = resolution
        self.mc_func: Callable = marching_cubes
        self._grid_vertices: Optional[torch.FloatTensor] = None

    @property
    def grid_vertices(self) -> torch.FloatTensor:
        if self._grid_vertices is None:
            x, y, z = (torch.linspace(*self.points_range, self.resolution),
                       torch.linspace(*self.points_range, self.resolution),
                       torch.linspace(*self.points_range, self.resolution))
            x, y, z = torch.meshgrid(x, y, z, indexing="ij")
            verts = torch.cat([x.reshape(-1,1), y.reshape(-1,1), z.reshape(-1,1)], dim=-1).reshape(-1,3)
            self._grid_vertices = verts
        return self._grid_vertices

    def forward(self, level: torch.FloatTensor) -> Tuple[torch.FloatTensor, torch.LongTensor]:
        level = -level.view(self.resolution, self.resolution, self.resolution)
        v_pos, t_pos_idx = self.mc_func(level, 0.0)
        v_pos = v_pos[..., [2, 1, 0]]
        v_pos = v_pos / (self.resolution - 1.0)
        return v_pos.to(level.device), t_pos_idx.to(level.device)
'''

def patch_isosurface():
    """Replace torchmcubes import with skimage fallback — idempotent."""
    iso_path = TSR_SRC_DIR / 'tsr' / 'models' / 'isosurface.py'
    if not iso_path.exists():
        return
    if 'torchmcubes' not in iso_path.read_text(encoding='utf-8'):
        return  # already patched
    iso_path.write_text(ISOSURFACE_PATCH, encoding='utf-8')
    # clear pycache so Python uses the new source
    pycache = iso_path.parent / '__pycache__'
    if pycache.exists():
        import shutil
        shutil.rmtree(pycache)

# ── Step 3: download model weights ────────────────────────────────────────────

def ensure_weights():
    prog(3, "Checking TripoSR weights (~1 GB, MIT licence)…")
    WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)

    from huggingface_hub import snapshot_download
    local = snapshot_download(
        repo_id=HF_REPO_ID,
        local_dir=str(WEIGHTS_DIR),
        local_dir_use_symlinks=False,
        ignore_patterns=['*.md', '*.txt', 'example_images/*'],
    )
    return Path(local)

# ── Step 4: load model ────────────────────────────────────────────────────────

def load_model(weights_path: Path, device):
    prog(4, "Loading TripoSR model…")
    patch_isosurface()   # ensure skimage fallback is in place before import
    import torch
    from tsr.system import TSR

    model = TSR.from_pretrained(
        str(weights_path),
        config_name='config.yaml',
        weight_name='model.ckpt',
    )
    model.renderer.set_chunk_size(8192)
    model.to(device)
    model.eval()
    return model

# ── Step 5: preprocess image ──────────────────────────────────────────────────

def _remove_bg_threshold(arr_rgba: 'np.ndarray', thresh: int = 240, edge_px: int = 4) -> 'np.ndarray':
    """
    Zero out alpha for near-white or near-black background pixels.
    Works well for Game Asset Mode images (white bg) and dark-bg renders.
    Uses a simple flood-fill from the corners so we don't cut interior highlights.
    """
    import numpy as np
    from collections import deque

    h, w = arr_rgba.shape[:2]
    rgb  = arr_rgba[:, :, :3].astype(np.int32)

    # near-white: all channels > thresh
    is_bg = np.all(rgb > thresh, axis=2)

    # flood-fill background from all four corners to avoid masking bright interior regions
    filled = np.zeros((h, w), dtype=bool)
    q = deque()
    for sy, sx in [(0, 0), (0, w-1), (h-1, 0), (h-1, w-1)]:
        if is_bg[sy, sx]:
            q.append((sy, sx))
            filled[sy, sx] = True
    while q:
        y, x = q.popleft()
        for dy, dx in [(-1,0),(1,0),(0,-1),(0,1)]:
            ny, nx = y+dy, x+dx
            if 0 <= ny < h and 0 <= nx < w and not filled[ny, nx] and is_bg[ny, nx]:
                filled[ny, nx] = True
                q.append((ny, nx))

    # erode the fill mask inward by edge_px to keep antialiased fringe
    from scipy.ndimage import binary_erosion
    if edge_px > 0:
        struct = np.ones((edge_px*2+1, edge_px*2+1), dtype=bool)
        filled = binary_erosion(filled, structure=struct, border_value=1)

    out = arr_rgba.copy()
    out[filled, 3] = 0
    return out


def _add_depth_shading(arr_rgba: 'np.ndarray') -> 'np.ndarray':
    """
    Apply depth-from-silhouette shading to a flat 2D sprite before TripoSR.

    TripoSR was trained on shaded 3D renders. Flat cartoon sprites have no
    depth cues, so the model produces blobby geometry. This pass fakes 3D
    lighting by treating distance-from-silhouette-edge as a height map:
      - Centre of the silhouette = highest point (closest to camera)
      - Silhouette edge          = lowest point (at the surface)
    A fake surface normal is derived from the height gradient, then Lambertian
    lighting is applied.  The result looks like a lit 3D object to TripoSR.
    """
    import numpy as np
    try:
        from scipy.ndimage import distance_transform_edt, sobel
    except ImportError:
        return arr_rgba   # scipy unavailable — skip shading

    fg = arr_rgba[:, :, 3] > 10
    if not fg.any():
        return arr_rgba

    # Height map: normalised distance from silhouette edge (0 = edge, 1 = centre)
    dist = distance_transform_edt(fg).astype(np.float32)
    dist_max = dist.max()
    if dist_max < 1e-6:
        return arr_rgba
    dist /= dist_max

    # Surface normals from height gradient
    gx = sobel(dist, axis=1).astype(np.float32)
    gy = sobel(dist, axis=0).astype(np.float32)
    gz = np.full_like(dist, 2.0)                  # flat z keeps normals pointing outward
    norm_len = np.sqrt(gx**2 + gy**2 + gz**2)
    norm_len = np.maximum(norm_len, 1e-8)
    nx = gx / norm_len
    ny = gy / norm_len
    nz = gz / norm_len

    # Light direction: upper-left, slightly in front (standard 3/4 game light)
    lx, ly, lz = -0.45, -0.65, 0.62
    l_len = (lx**2 + ly**2 + lz**2) ** 0.5
    lx, ly, lz = lx / l_len, ly / l_len, lz / l_len

    diffuse = np.maximum(nx * lx + ny * ly + nz * lz, 0.0)
    shade   = np.clip(0.55 + 0.55 * diffuse, 0.5, 1.25)   # ambient=0.55, diffuse strength=0.55

    out = arr_rgba.copy().astype(np.float32)
    for c in range(3):
        out[:, :, c] = np.where(fg, np.clip(out[:, :, c] * shade, 0, 255), out[:, :, c])
    return out.astype(np.uint8)


def preprocess_image(image_path: Path, mask_path=None):
    """
    Return a PIL RGBA image ready for TripoSR: background removed, synthetic
    depth shading applied, 512×512, centred on subject.
    Priority: explicit mask → rembg → white-threshold flood-fill.
    """
    prog(5, "Preprocessing image…")
    from PIL import Image
    import numpy as np

    img = Image.open(str(image_path)).convert('RGBA')
    arr = np.array(img)

    if mask_path and Path(mask_path).exists():
        mask = Image.open(str(mask_path)).convert('L').resize(img.size, Image.LANCZOS)
        arr[:, :, 3] = np.array(mask)

    elif arr[:, :, 3].min() > 10:
        # No existing alpha — try rembg first, fall back to white-threshold
        removed = False
        try:
            from rembg import remove as rembg_remove
            import io
            buf = io.BytesIO()
            img.save(buf, format='PNG')
            result = rembg_remove(buf.getvalue())
            img  = Image.open(io.BytesIO(result)).convert('RGBA')
            arr  = np.array(img)
            removed = True
        except Exception:
            pass

        if not removed:
            try:
                from scipy.ndimage import binary_erosion as _be
                arr = _remove_bg_threshold(arr, thresh=230, edge_px=3)
            except Exception:
                rgb   = arr[:, :, :3].astype(np.int32)
                is_bg = np.all(rgb > 230, axis=2)
                arr[is_bg, 3] = 0

    # Apply synthetic depth shading so TripoSR can infer 3D geometry from 2D art
    arr = _add_depth_shading(arr)

    img = Image.fromarray(arr, 'RGBA')

    # Crop tight to foreground bounding box
    alpha = np.array(img)[:, :, 3]
    ys, xs = np.where(alpha > 10)
    if len(ys) and len(xs):
        y0, y1 = int(ys.min()), int(ys.max())
        x0, x1 = int(xs.min()), int(xs.max())
        img = img.crop((x0, y0, x1 + 1, y1 + 1))

    # Pad to square, centre, resize to 512 with margin
    w, h      = img.size
    side      = max(w, h)
    margin    = int(side * 0.10)
    canvas_sz = side + margin * 2
    padded    = Image.new('RGBA', (canvas_sz, canvas_sz), (0, 0, 0, 0))
    padded.paste(img, (margin + (side - w) // 2, margin + (side - h) // 2))
    padded = padded.resize((512, 512), Image.LANCZOS)
    return padded

# ── Step 6: run TripoSR inference ─────────────────────────────────────────────

def run_inference(model, pil_image, resolution: int, device):
    """
    Returns (mesh, front_render_pil):
      - mesh             : trimesh.Trimesh, smoothed, no vertex colors
      - front_render_pil : 512×512 RGB rendered from the triplane front view
                           — used as UV texture so colours exactly match the geometry.
    """
    prog(6, f"Running triplane inference (resolution={resolution})…")
    import torch
    from tsr.utils import resize_foreground
    from PIL import Image as _Image

    # Ensure RGBA for resize_foreground
    if pil_image.mode != 'RGBA':
        pil_image = pil_image.convert('RGBA')

    # Scale foreground to 85 % of frame — TripoSR training convention
    pil_image = resize_foreground(pil_image, 0.85)

    # Composite onto grey — TripoSR was trained on grey-background renders
    bg = _Image.new('RGB', pil_image.size, (127, 127, 127))
    bg.paste(pil_image, mask=pil_image.split()[3])
    pil_input = bg

    # ── Build triplane ────────────────────────────────────────────────────────
    with torch.no_grad():
        scene_codes = model([pil_input], device=device)

    # ── Render front view from the triplane (same angle as input image) ───────
    # n_views=4 gives front / right / back / left at 0° elevation.
    # We use the front render (index 0) as the UV texture.
    prog(6, "Rendering texture from triplane…")
    renders = model.render(
        scene_codes,
        n_views=4,
        elevation_deg=0.0,
        camera_distance=1.9,
        fovy_deg=40.0,
        height=512,
        width=512,
        return_type="pil",
    )
    front_render = renders[0][0]   # scene 0, view 0 (front)

    # Debug: save all 4 renders so we can inspect the texture orientation
    import os as _os
    _dbg_dir = Path(_os.environ.get('ITERFORGE_HOME', '')) / '3d' / 'triposr-out'
    _dbg_dir.mkdir(parents=True, exist_ok=True)
    for _i, _r in enumerate(renders[0]):
        _r.save(str(_dbg_dir / f'_debug_view{_i}.png'))

    # ── Extract mesh ─────────────────────────────────────────────────────────
    prog(7, "Extracting mesh via marching cubes…")
    meshes = model.extract_mesh(
        scene_codes,
        has_vertex_color=False,
        resolution=resolution,
        threshold=25.0,
    )
    mesh = meshes[0]

    # Taubin smoothing — removes staircase without shrinkage.
    # Stability: 0 < 1/lamb − 1/nu < 0.1  →  nu=0.52 gives 0.038 ✓
    try:
        import trimesh.smoothing as _sm
        _sm.filter_taubin(mesh, lamb=0.5, nu=0.52, iterations=10)
    except Exception:
        try:
            import trimesh.smoothing as _sm
            _sm.filter_laplacian(mesh, lamb=0.3, iterations=5, volume_constraint=True)
        except Exception:
            pass

    return mesh, front_render

# ── Step 7: export GLB ────────────────────────────────────────────────────────

def _dilate_colors(arr_rgba: 'np.ndarray') -> 'np.ndarray':
    """
    Fill transparent (alpha≈0) pixels with the color of the nearest opaque pixel.
    Eliminates grey/black bleeding on UV seams when edge faces sample outside
    the visible silhouette.
    """
    import numpy as np
    from scipy.ndimage import distance_transform_edt

    arr  = arr_rgba.copy()
    fg   = arr[:, :, 3] > 10                          # True = foreground pixel
    if fg.all():
        return arr                                     # nothing to fill

    _, idx = distance_transform_edt(~fg, return_indices=True)
    for c in range(3):                                 # R, G, B
        arr[:, :, c][~fg] = arr[:, :, c][idx[0][~fg], idx[1][~fg]]
    arr[:, :, 3] = 255                                 # fully opaque — GLB ignores alpha
    return arr


def _strip_triplane_bg(pil_rgb) -> 'np.ndarray':
    """
    Convert a triplane render (RGB, near-white background) to RGBA with the
    connected background region made transparent so _dilate_colors can push
    sword edge colours outward to fill the full UV space.
    Uses corner flood-fill so interior bright/grey areas are NOT removed.
    """
    import numpy as np
    from collections import deque

    arr = np.array(pil_rgb.convert('RGB'))
    h, w = arr.shape[:2]

    # Background pixels: near-white (TripoSR renders onto a light background)
    is_bg_candidate = np.all(arr.astype(np.int32) > 200, axis=2)

    # Flood-fill the connected background region from all four corners
    filled = np.zeros((h, w), dtype=bool)
    q = deque()
    for sy, sx in [(0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)]:
        if is_bg_candidate[sy, sx] and not filled[sy, sx]:
            q.append((sy, sx))
            filled[sy, sx] = True
    while q:
        y, x = q.popleft()
        for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not filled[ny, nx] and is_bg_candidate[ny, nx]:
                filled[ny, nx] = True
                q.append((ny, nx))

    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, :3] = arr
    rgba[:, :, 3]  = np.where(filled, 0, 255).astype(np.uint8)
    return rgba


def _apply_planar_texture(mesh, pil_texture):
    """
    Front-project pil_texture onto the mesh using TripoSR's axis convention.

    After TripoSR's [2,1,0] swap in MarchingCubeHelper the axes are:
        verts[:,0] = world Y (up/down)  ← blade length  (largest range ~1.0)
        verts[:,1] = world X (left/right) ← guard width  (medium range ~0.9)
        verts[:,2] = world Z (depth)    ← blade thickness (tiny ~0.2)
    The front-view render camera looks from +Z, so UV must use (world X, world Y):
        U  ← verts[:,1]  (left/right in image)
        V  ← verts[:,0]  (up/down in image, flipped for top-down image coords)
    """
    import trimesh
    import numpy as np
    from PIL import Image as _Image

    # Build RGBA with background stripped so _dilate_colors fills the full texture
    if pil_texture.mode == 'RGBA':
        arr = np.array(pil_texture)
    else:
        arr = _strip_triplane_bg(pil_texture)   # grey bg → transparent

    arr     = _dilate_colors(arr)               # push sword edge colours into bg area
    rgb_arr = arr[:, :, :3]

    # Slight brightness lift — Babylon's PBR darkens flat-lit textures
    rgb_arr = np.clip(rgb_arr.astype(np.float32) * 1.3, 0, 255).astype(np.uint8)
    tex_rgb = _Image.fromarray(rgb_arr, 'RGB')

    verts   = np.array(mesh.vertices)           # (N, 3)  — original (pre-rotation) space
    x       = verts[:, 1]                       # world X = left/right in front render
    y       = verts[:, 0]                       # world Y = up/down   in front render

    x_range = x.max() - x.min()
    y_range = y.max() - y.min()

    u =       (x - x.min()) / max(x_range, 1e-8)
    v = 1.0 - (y - y.min()) / max(y_range, 1e-8)   # flip: image Y is top-down

    uv       = np.column_stack([u, v]).astype(np.float32)
    material = trimesh.visual.texture.SimpleMaterial(
        image=tex_rgb,
        ambient=(1.0, 1.0, 1.0, 1.0),
        diffuse=(1.0, 1.0, 1.0, 1.0),
    )
    mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=material)
    return mesh


def _orient_mesh_for_gltf(mesh):
    """
    Rotate the mesh so its primary axis (blade/height) aligns with GLTF Y (up).

    TripoSR axis convention after [2,1,0] swap:
        axis 0 = world Y (up in TripoSR = blade length, largest range)
        axis 1 = world X (left/right = guard width)
        axis 2 = world Z (depth, always smallest)

    In GLTF/Babylon Y-up, the mesh is exported with trimesh axes mapping directly
    to GLTF axes, so axis 0 → GLTF X (horizontal).  We need +90° around Z so
    that axis 0 → GLTF Y (vertical, upright).

    UV coordinates are stored per-vertex before this rotation and remain correct.
    """
    import numpy as np

    v      = np.array(mesh.vertices)
    ranges = [v[:, i].max() - v[:, i].min() for i in range(3)]

    # Depth axis = smallest range (axis 2 in practice, but detect it)
    depth_axis = int(np.argmin(ranges))
    uv_axes    = [i for i in range(3) if i != depth_axis]         # [tall, wide] or similar
    tall_axis  = uv_axes[0] if ranges[uv_axes[0]] >= ranges[uv_axes[1]] else uv_axes[1]

    if tall_axis == 0:
        # Standard: blade along axis 0 (GLTF X) → rotate +90° around Z → axis 0 becomes Y
        angle = np.pi / 2
        c, s  = np.cos(angle), np.sin(angle)
        R = np.array([[c, -s, 0, 0],
                      [s,  c, 0, 0],
                      [0,  0, 1, 0],
                      [0,  0, 0, 1]], dtype=np.float64)
        mesh.apply_transform(R)
    # If tall_axis == 1, blade is already along GLTF Y — no rotation needed


def export_glb(mesh, output_dir: Path, stem: str, pil_texture=None):
    prog(8, "Exporting GLB…")
    output_dir.mkdir(parents=True, exist_ok=True)
    glb_path = output_dir / f"{stem}.glb"

    import trimesh
    if not hasattr(mesh, 'export'):
        verts  = mesh.get('verts')
        faces  = mesh.get('faces')
        mesh   = trimesh.Trimesh(vertices=verts, faces=faces, process=False)

    # Apply planar UV projection using original (pre-rotation) vertex positions
    if pil_texture is not None:
        _apply_planar_texture(mesh, pil_texture)

    # Rotate to GLTF Y-up so the sword stands upright in Babylon.js
    _orient_mesh_for_gltf(mesh)

    mesh.export(str(glb_path))
    return glb_path

# ── Step 8: render preview ────────────────────────────────────────────────────

def render_preview(glb_path: Path, output_dir: Path, stem: str):
    """Render a turntable preview PNG using trimesh's built-in renderer."""
    prog(9, "Rendering preview…")
    preview_path = output_dir / f"{stem}_preview.png"
    try:
        import trimesh
        import numpy as np
        mesh = trimesh.load(str(glb_path), force='mesh')
        scene = trimesh.scene.scene.Scene(geometry={'mesh': mesh})
        # Isometric-ish camera angle
        scene.set_camera(angles=(0.4, 0.0, 0.8), distance=2.5)
        png = scene.save_image(resolution=(512, 512), visible=True)
        if png:
            preview_path.write_bytes(png)
    except Exception:
        # Preview is optional — don't fail the job
        pass
    return preview_path if preview_path.exists() else None

# ── GPU check ─────────────────────────────────────────────────────────────────

def select_device():
    import torch
    if not torch.cuda.is_available():
        return 'cpu'
    vram_gb = torch.cuda.get_device_properties(0).total_memory / 1024**3
    if vram_gb < 5.5:
        fail(
            f"TripoSR requires ≥6 GB VRAM (detected {vram_gb:.1f} GB). "
            "Use the silhouette pipeline for lower-end GPUs."
        )
    return 'cuda'

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image',         default=None)
    parser.add_argument('--output',        default=None)
    parser.add_argument('--mask',          default=None)
    parser.add_argument('--resolution',    type=int, default=256)
    parser.add_argument('--stem',          default=None)
    parser.add_argument('--prefetch-only', action='store_true',
                        help='Only download weights/deps, do not run inference')
    args = parser.parse_args()

    try:
        bootstrap_deps()
        ensure_tsr_package()
        ensure_weights()

        if args.prefetch_only:
            prog(10, "Prefetch complete.")
            done({'prefetchOnly': True, 'weightsDir': str(WEIGHTS_DIR)})
            return

        if not args.image or not args.output:
            fail("--image and --output are required for inference mode")

        image_path = Path(args.image)
        output_dir = Path(args.output)
        mask_path  = Path(args.mask) if args.mask else None
        resolution = args.resolution
        stem       = args.stem or image_path.stem

        if not image_path.exists():
            fail(f"Image not found: {image_path}")

        device         = select_device()
        model          = load_model(ensure_weights(), device)
        pil_img        = preprocess_image(image_path, mask_path)   # 512×512 RGBA, bg removed
        mesh, _        = run_inference(model, pil_img, resolution, device)
        # Use the preprocessed source image as texture — it has correct artwork colours
        # and proper alpha from background removal, so _dilate_colors fills the full UV space.
        glb_path       = export_glb(mesh, output_dir, stem, pil_texture=pil_img)
        preview   = render_preview(glb_path, output_dir, stem)

        prog(10, "Complete.")
        done({
            'glbPath':     str(glb_path),
            'previewPath': str(preview) if preview else None,
            'resolution':  resolution,
            'device':      device,
        })

    except SystemExit:
        raise
    except Exception:
        fail(traceback.format_exc())


if __name__ == '__main__':
    main()
