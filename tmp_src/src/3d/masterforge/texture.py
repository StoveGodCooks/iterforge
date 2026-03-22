"""
texture.py - bake the original 2D game art onto the xatlas UV atlas.

Approach: planar front-projection.
  - The CadQuery mesh lives in [-1, 1] normalised space.
  - X = sword width (matches original image X axis).
  - Y = sword length, tip-up (matches original image Y, flipped by trace.py).
  - Z = depth (new axis - not visible in the original PNG).
  - So: project each 3D vertex straight down the Z axis onto the XY plane
    and sample the original PNG at the corresponding pixel.

Steps:
  1. Load UV data (.npz) - remapped vertices, faces, UV coords.
  2. Sample each vertex's color from the original PNG via planar projection.
  3. Rasterize every UV triangle into the output texture atlas using
     numpy-vectorised barycentric interpolation (fast, no C extensions).
  4. Dilate the atlas by a few pixels to fill UV seams (prevents black edges).
  5. Save as PNG alongside the STL.
"""

import numpy as np
import os


def bake_texture(orig_image_path: str, uv_npz_path: str,
                 output_path: str, output_size: int = 512) -> str:
    """
    Bake original 2D art onto the xatlas UV atlas.

    Args:
        orig_image_path - source PNG (the generated game art)
        uv_npz_path     - xatlas output from unwrap.py
        output_path     - where to save the baked texture PNG
        output_size     - texture resolution (default 512)

    Returns output_path on success.
    """
    from PIL import Image

    # -- Load UV atlas data ----------------------------------------------------
    data     = np.load(uv_npz_path)
    vertices = data['vertices'].astype(np.float32)   # (N, 3) in [-1,1] space
    faces    = data['faces'].astype(np.int32)        # (M, 3)
    uvs      = data['uvs'].astype(np.float32)        # (N, 2) in [0, 1]

    # -- Sample per-vertex colors from original image --------------------------
    orig    = np.array(Image.open(orig_image_path).convert('RGBA'),
                       dtype=np.float32) / 255.0
    H, W    = orig.shape[:2]

    # Planar projection: vertex (x, y, z) → image pixel (px, py)
    # x in [-1,1] → px in [0, W-1]
    # y in [-1,1] → py in [0, H-1]  (Y flipped: tip=+1=top of image)
    px = np.clip(((vertices[:, 0] + 1.0) * 0.5 * W).astype(np.int32),
                 0, W - 1)
    py = np.clip(((1.0 - (vertices[:, 1] + 1.0) * 0.5) * H).astype(np.int32),
                 0, H - 1)
    vertex_colors = orig[py, px]   # (N, 4) RGBA per vertex

    # -- Rasterise UV triangles onto texture atlas -----------------------------
    size    = output_size
    texture = np.zeros((size, size, 4), dtype=np.float32)
    weight  = np.zeros((size, size),    dtype=np.float32)

    # Convert UV [0,1] → texture pixel coords [0, size-1]
    uv_px = uvs * (size - 1)    # (N, 2)

    for tri in faces:
        i0, i1, i2 = int(tri[0]), int(tri[1]), int(tri[2])
        p = uv_px[[i0, i1, i2]]           # (3, 2)
        c = vertex_colors[[i0, i1, i2]]   # (3, 4)
        _rasterise_triangle(texture, weight, p, c, size)

    # -- Normalise accumulated weights -----------------------------------------
    filled = weight > 0
    texture[filled] /= weight[filled, np.newaxis]

    # -- Dilate to fill UV seam gaps (2-pixel dilation) ------------------------
    texture = _dilate_atlas(texture, filled, passes=2)

    # -- Save ------------------------------------------------------------------
    out_img = Image.fromarray(
        (np.clip(texture, 0.0, 1.0) * 255).astype(np.uint8), 'RGBA'
    )
    out_img.save(output_path)
    size_bytes = os.path.getsize(output_path)
    print(f'[masterforge.texture] baked {output_size}x{output_size} '
          f'-> {output_path}  ({size_bytes:,} bytes)')
    return output_path


# -- Private helpers ------------------------------------------------------------

def _rasterise_triangle(texture: np.ndarray, weight: np.ndarray,
                        p: np.ndarray, c: np.ndarray, size: int) -> None:
    """
    Rasterise a UV triangle into the texture atlas using numpy-vectorised
    barycentric coordinates.

    p - (3, 2) UV pixel positions
    c - (3, 4) per-vertex RGBA colors
    """
    # Bounding box clipped to texture
    x0 = max(0,        int(np.floor(p[:, 0].min())))
    x1 = min(size - 1, int(np.ceil( p[:, 0].max())))
    y0 = max(0,        int(np.floor(p[:, 1].min())))
    y1 = min(size - 1, int(np.ceil( p[:, 1].max())))

    if x1 < x0 or y1 < y0:
        return

    # Pixel grid centres in bounding box
    xs, ys = np.meshgrid(
        np.arange(x0, x1 + 1, dtype=np.float32) + 0.5,
        np.arange(y0, y1 + 1, dtype=np.float32) + 0.5,
    )

    # Barycentric coordinates (vectorised)
    v0, v1, v2 = p[0], p[1], p[2]
    denom = ((v1[1] - v2[1]) * (v0[0] - v2[0]) +
             (v2[0] - v1[0]) * (v0[1] - v2[1]))
    if abs(denom) < 1e-10:
        return

    b0 = ((v1[1] - v2[1]) * (xs - v2[0]) +
          (v2[0] - v1[0]) * (ys - v2[1])) / denom
    b1 = ((v2[1] - v0[1]) * (xs - v2[0]) +
          (v0[0] - v2[0]) * (ys - v2[1])) / denom
    b2 = 1.0 - b0 - b1

    inside = (b0 >= -1e-6) & (b1 >= -1e-6) & (b2 >= -1e-6)
    if not inside.any():
        return

    iy = ys[inside].astype(np.int32)
    ix = xs[inside].astype(np.int32)
    b0i = b0[inside][:, np.newaxis]
    b1i = b1[inside][:, np.newaxis]
    b2i = b2[inside][:, np.newaxis]

    colors = b0i * c[0] + b1i * c[1] + b2i * c[2]
    np.add.at(texture, (iy, ix), colors)
    np.add.at(weight,  (iy, ix), 1.0)


def _dilate_atlas(texture: np.ndarray, filled: np.ndarray,
                  passes: int = 2) -> np.ndarray:
    """
    Expand filled texels into empty neighbours to eliminate black seams
    at UV island boundaries.
    """
    from scipy.ndimage import binary_dilation

    result = texture.copy()
    mask   = filled.copy()

    for _ in range(passes):
        dilated_mask = binary_dilation(mask)
        new_pixels   = dilated_mask & ~mask
        if not new_pixels.any():
            break

        # For each newly filled pixel, average its filled neighbours
        ys, xs = np.where(new_pixels)
        for y, x in zip(ys, xs):
            neighbours = []
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if (0 <= ny < mask.shape[0] and
                            0 <= nx < mask.shape[1] and mask[ny, nx]):
                        neighbours.append(texture[ny, nx])
            if neighbours:
                result[y, x] = np.mean(neighbours, axis=0)

        mask = dilated_mask

    return result
