"""
inference/reconstruct.py — Multi-view 3D reconstruction pipeline.

Pipeline stages:
  1. SVG silhouette rasterization (sharper masks from vector data)
  2. Visual hull carving (project voxels through camera matrices)
  3. Photo-consistency refinement (use RGB to carve concavities)
  4. Oriented point cloud extraction (surface positions + gradient normals)
  5. Open3D Poisson surface reconstruction (smooth, watertight mesh)
  6. Vertex color projection from views

Usage:
    from inference.reconstruct import visual_hull_reconstruct, cleanup_mesh
    mesh = visual_hull_reconstruct(alpha_masks, view_images, svg_data)
"""
from __future__ import annotations

import logging
import re
from typing import Optional

import numpy as np

log = logging.getLogger(__name__)


# ── Camera geometry from Zero123++ poses ────────────────────────

from inference.zero123 import CAMERA_POSES


def _rotation_y(angle_rad: float) -> np.ndarray:
    c, s = np.cos(angle_rad), np.sin(angle_rad)
    return np.array([
        [ c, 0, s, 0],
        [ 0, 1, 0, 0],
        [-s, 0, c, 0],
        [ 0, 0, 0, 1],
    ], dtype=np.float64)


def _rotation_x(angle_rad: float) -> np.ndarray:
    c, s = np.cos(angle_rad), np.sin(angle_rad)
    return np.array([
        [1, 0,  0, 0],
        [0, c, -s, 0],
        [0, s,  c, 0],
        [0, 0,  0, 1],
    ], dtype=np.float64)


def _build_extrinsic(view_name: str) -> np.ndarray:
    """Build a 4x4 world-to-camera extrinsic from Zero123++ camera poses.

    Convention: world is Y-up, camera is Y-down (OpenCV).
    We negate the Y row so that world-Y-up maps to image-Y-down,
    ensuring the top of the 3D object projects to the top of the image.
    """
    pose = CAMERA_POSES.get(view_name)
    if pose is None:
        return np.eye(4, dtype=np.float64)

    az_rad = np.radians(pose["azimuth"])
    el_rad = np.radians(pose["elevation"])
    radius = pose.get("radius", 1.5)

    ext = _rotation_x(-el_rad) @ _rotation_y(az_rad)
    ext[2, 3] = radius
    # Flip Y axis: world Y-up → camera Y-down (standard pinhole/OpenCV)
    ext[1, :] *= -1
    return ext


def _build_intrinsic(image_size: int, fov_deg: float = 30.0) -> np.ndarray:
    """Build 3x3 camera intrinsic matrix from field of view.

    Zero123++ v1.2 uses a unified 30° FoV.
    focal = (image_size / 2) / tan(fov / 2)
    """
    half_fov = np.radians(fov_deg / 2.0)
    focal = (float(image_size) / 2.0) / np.tan(half_fov)
    cx = cy = image_size / 2.0
    return np.array([
        [focal, 0, cx],
        [0, focal, cy],
        [0,     0,  1],
    ], dtype=np.float64)


def _compute_vol_bounds(fov_deg: float = 30.0, radius: float = 1.5) -> tuple[float, float]:
    """Compute volume bounds from camera FoV and distance.

    At a given FoV and radius, the camera's visible half-extent is:
        tan(fov/2) * radius

    The object fills ~75% of frame (per Zero123++ preprocessing), so
    the actual object extent is ~75% of visible extent. We use 95% of
    visible extent as volume bounds — tight enough that nearly all
    voxels project inside the camera frame (and can be carved), but
    with enough margin that the object isn't clipped.

    For 30° FoV at radius 1.5:
        visible half-extent = tan(15°) × 1.5 ≈ 0.402
        95% → 0.382, rounded to 0.38
    """
    half_fov = np.radians(fov_deg / 2.0)
    visible_half = np.tan(half_fov) * radius
    # Use 95% of visible extent — ensures voxels are inside camera view
    bounds_half = visible_half * 0.95
    log.info(f"[reconstruct] Volume bounds: ±{bounds_half:.3f} "
             f"(visible ±{visible_half:.3f} at {fov_deg}° FoV, radius={radius})")
    return (-bounds_half, bounds_half)


# ═════════════════════════════════════════════════════════════════
#  Stage 1: SVG Mask Rasterization
# ═════════════════════════════════════════════════════════════════

def _parse_svg_path_d(d: str) -> list[list[tuple[float, float]]]:
    """
    Parse an SVG path 'd' attribute into polygon outlines.

    Handles the subset vtracer binary mode produces:
    M (moveto), L (lineto), C (cubic Bézier), Z (close).
    Cubic Béziers are approximated by subdividing into line segments.
    """
    polygons: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []
    cx, cy = 0.0, 0.0

    # Tokenize: split into command letter + coordinate groups
    tokens = re.findall(r'[MLCZmlcz]|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?', d)

    i = 0
    while i < len(tokens):
        cmd = tokens[i]
        i += 1

        if cmd in ('M', 'm'):
            if current:
                polygons.append(current)
                current = []
            if i + 1 < len(tokens):
                x, y = float(tokens[i]), float(tokens[i + 1])
                i += 2
                if cmd == 'm':
                    x += cx; y += cy
                cx, cy = x, y
                current.append((cx, cy))
                # Implicit lineto after M
                while i + 1 < len(tokens) and tokens[i] not in 'MLCZmlcz':
                    x, y = float(tokens[i]), float(tokens[i + 1])
                    i += 2
                    if cmd == 'm':
                        x += cx; y += cy
                    cx, cy = x, y
                    current.append((cx, cy))

        elif cmd in ('L', 'l'):
            while i + 1 < len(tokens) and tokens[i] not in 'MLCZmlcz':
                x, y = float(tokens[i]), float(tokens[i + 1])
                i += 2
                if cmd == 'l':
                    x += cx; y += cy
                cx, cy = x, y
                current.append((cx, cy))

        elif cmd in ('C', 'c'):
            while i + 5 < len(tokens) and tokens[i] not in 'MLCZmlcz':
                x1, y1 = float(tokens[i]), float(tokens[i + 1])
                x2, y2 = float(tokens[i + 2]), float(tokens[i + 3])
                x3, y3 = float(tokens[i + 4]), float(tokens[i + 5])
                i += 6
                if cmd == 'c':
                    x1 += cx; y1 += cy
                    x2 += cx; y2 += cy
                    x3 += cx; y3 += cy
                # Subdivide cubic Bézier into ~10 line segments
                for t_i in range(1, 11):
                    t = t_i / 10.0
                    t2 = t * t
                    t3 = t2 * t
                    mt = 1 - t
                    mt2 = mt * mt
                    mt3 = mt2 * mt
                    bx = mt3 * cx + 3 * mt2 * t * x1 + 3 * mt * t2 * x2 + t3 * x3
                    by = mt3 * cy + 3 * mt2 * t * y1 + 3 * mt * t2 * y2 + t3 * y3
                    current.append((bx, by))
                cx, cy = x3, y3

        elif cmd in ('Z', 'z'):
            if current:
                polygons.append(current)
                current = []
                if polygons[-1]:
                    cx, cy = polygons[-1][0]

        else:
            # Unknown command — skip
            pass

    if current:
        polygons.append(current)

    return polygons


def _rasterize_svg_mask(
    svg_inner_html: str,
    target_size: int = 1024,
    source_size: tuple[int, int] = (768, 768),
) -> np.ndarray:
    """
    Rasterize vtracer SVG path elements into a binary mask at target_size.

    Returns uint8 (target_size, target_size) with 0/255 values.
    """
    from PIL import Image as _PIL, ImageDraw

    scale_x = target_size / source_size[0]
    scale_y = target_size / source_size[1]

    mask_img = _PIL.new("L", (target_size, target_size), 0)
    draw = ImageDraw.Draw(mask_img)

    # Extract all <path d="..."/> elements
    path_pattern = re.compile(r'd="([^"]*)"')
    fill_pattern = re.compile(r'fill="([^"]*)"')

    # Split by <path to handle each element
    path_elements = re.findall(r'<path[^>]*/?>', svg_inner_html)

    for elem in path_elements:
        d_match = path_pattern.search(elem)
        if not d_match:
            continue

        # Check fill color — skip background/white fills
        fill_match = fill_pattern.search(elem)
        if fill_match:
            fill_color = fill_match.group(1).lower()
            # Skip white/near-white fills (background)
            if fill_color in ('#ffffff', '#fff', 'white', 'none'):
                continue

        d_str = d_match.group(1)
        polygons = _parse_svg_path_d(d_str)

        for poly in polygons:
            if len(poly) < 3:
                continue
            # Scale coordinates
            scaled = [(x * scale_x, y * scale_y) for x, y in poly]
            draw.polygon(scaled, fill=255)

    return np.array(mask_img, dtype=np.uint8)


# ═════════════════════════════════════════════════════════════════
#  Stage 1b: Alpha Mask Cleanup
# ═════════════════════════════════════════════════════════════════

def _clean_alpha_mask(mask: np.ndarray, min_component_ratio: float = 0.02) -> np.ndarray:
    """
    Clean up an alpha mask by removing small disconnected components.

    Shadows, ground planes, and rembg artifacts create small alpha
    blobs near the base of the object. These confuse the visual hull
    because they project as "occupied" in one view but not others,
    fragmenting the reconstruction.

    Strategy:
      1. Find connected components in the binary mask
      2. Keep only the largest component (the actual object)
      3. Remove components smaller than min_component_ratio of the largest

    This preserves the main silhouette while stripping shadow fragments.
    """
    from scipy.ndimage import label

    binary = mask > 0.3 if mask.dtype == np.float32 else mask > 76

    if not binary.any():
        return mask

    labeled, n_components = label(binary)
    if n_components <= 1:
        return mask  # Single component — nothing to clean

    # Find component sizes
    component_sizes = np.bincount(labeled.ravel())
    component_sizes[0] = 0  # Background doesn't count

    largest_size = component_sizes.max()
    threshold = largest_size * min_component_ratio

    # Keep components that are at least min_component_ratio of the largest
    keep_components = component_sizes >= threshold
    cleaned = keep_components[labeled]

    n_removed = n_components - keep_components[1:].sum()
    if n_removed > 0:
        log.info(f"[reconstruct] Alpha cleanup: removed {n_removed} small component(s) "
                 f"(shadow/artifact fragments)")

    # Apply cleaned mask back
    if mask.dtype == np.float32:
        result = np.where(cleaned, mask, 0.0).astype(np.float32)
    else:
        result = np.where(cleaned, mask, 0).astype(mask.dtype)

    return result


# ═════════════════════════════════════════════════════════════════
#  Stage 2: Camera + Mask Setup
# ═════════════════════════════════════════════════════════════════

CameraEntry = tuple[str, np.ndarray, np.ndarray]  # (name, P_matrix, mask)


def _build_cameras(
    alpha_masks: dict[str, np.ndarray],
    svg_data: Optional[dict[str, str]],
    image_size: int,
    svg_raster_size: int,
) -> tuple[list[CameraEntry], int]:
    """
    Build projection matrices and select the best available mask per view.
    Prefers SVG-rasterized masks (sharper) over raster alpha masks.

    Returns (cameras, effective_image_size) where effective_image_size
    is svg_raster_size if SVGs were used, otherwise image_size.
    """
    from PIL import Image as _PIL

    # Determine effective size — use SVG raster size if any SVGs available
    use_svg = svg_data and any(svg_data.values())
    effective_size = svg_raster_size if use_svg else image_size
    h = w = effective_size

    K = _build_intrinsic(effective_size)

    cameras: list[CameraEntry] = []
    svg_used = 0

    for view_name, mask in alpha_masks.items():
        pose = CAMERA_POSES.get(view_name)
        if pose is None:
            continue

        ext = _build_extrinsic(view_name)
        P = K @ ext[:3, :]

        # Try SVG mask first
        mask_array = None
        if svg_data and svg_data.get(view_name):
            try:
                svg_mask = _rasterize_svg_mask(
                    svg_data[view_name],
                    target_size=effective_size,
                    source_size=(image_size, image_size),
                )
                mask_array = svg_mask.astype(np.float32) / 255.0
                svg_used += 1
            except Exception as exc:
                log.warning(f"[reconstruct] SVG rasterization failed for '{view_name}': {exc}")

        # Fallback to raster alpha mask
        if mask_array is None:
            mask_array = np.array(
                _PIL.fromarray(mask).resize((w, h), _PIL.NEAREST),
                dtype=np.float32,
            ) / 255.0

        # Clean up shadow/artifact fragments in the mask
        mask_array = _clean_alpha_mask(mask_array)

        cameras.append((view_name, P, mask_array))

    if svg_used > 0:
        log.info(f"[reconstruct] Using SVG masks for {svg_used}/{len(cameras)} views at {effective_size}px")
    else:
        log.info(f"[reconstruct] Using raster alpha masks at {effective_size}px")

    return cameras, effective_size


# ═════════════════════════════════════════════════════════════════
#  Stage 2b: Visual Hull Carving
# ═════════════════════════════════════════════════════════════════

def _carve_visual_hull(
    cameras: list[CameraEntry],
    image_size: int,
    resolution: int,
    vol_bounds: tuple[float, float],
) -> tuple[np.ndarray, np.ndarray]:
    """
    Carve a voxel volume using silhouette projection.

    Returns (volume_3d, pts_world_4xN) — the 3D occupancy grid and
    the homogeneous world coordinates used for projection.
    """
    h = w = image_size
    lo, hi = vol_bounds

    # Build voxel grid
    lin = np.linspace(lo, hi, resolution)
    gx, gy, gz = np.meshgrid(lin, lin, lin, indexing="ij")
    pts_world = np.stack([
        gx.ravel(), gy.ravel(), gz.ravel(), np.ones(resolution**3)
    ], axis=1).T  # (4, N)

    # Start with all voxels occupied
    occupied = np.ones(resolution**3, dtype=np.float32)

    for view_name, P, mask in cameras:
        projected = P @ pts_world
        z = projected[2, :]

        in_front = z > 0.01
        u = np.full(z.shape, -1.0)
        v = np.full(z.shape, -1.0)
        u[in_front] = projected[0, in_front] / z[in_front]
        v[in_front] = projected[1, in_front] / z[in_front]

        ui = np.round(u).astype(np.int32)
        vi = np.round(v).astype(np.int32)
        in_bounds = in_front & (ui >= 0) & (ui < w) & (vi >= 0) & (vi < h)

        # Only carve voxels we can SEE are outside the object.
        # Out-of-frame / behind camera → no info → keep.
        silhouette_val = np.ones(resolution**3, dtype=np.float32)
        silhouette_val[in_bounds] = mask[vi[in_bounds], ui[in_bounds]]

        occupied *= silhouette_val

        n_remaining = (occupied > 0.3).sum()
        log.info(f"[reconstruct] After '{view_name}': {n_remaining:,} voxels remain")

    volume = occupied.reshape((resolution, resolution, resolution))
    return volume, pts_world


# ═════════════════════════════════════════════════════════════════
#  Stage 3: Photo-Consistency Refinement
# ═════════════════════════════════════════════════════════════════

def _photo_consistency_refine(
    volume: np.ndarray,
    view_images: dict[str, np.ndarray],
    cameras: list[CameraEntry],
    image_size: int,
    vol_bounds: tuple[float, float],
    threshold: float = 30.0,
    shell_depth: int = 3,
) -> np.ndarray:
    """
    Refine the visual hull by checking RGB consistency across views.

    For each voxel near the surface, project into all views and compare
    the sampled colors. High color variance → likely a concavity → carve.
    """
    from scipy.ndimage import binary_erosion
    from PIL import Image as _PIL

    resolution = volume.shape[0]
    lo, hi = vol_bounds
    h = w = image_size

    # Find surface shell: occupied minus eroded interior
    binary_vol = volume > 0.3
    if not binary_vol.any():
        return volume

    shell = binary_vol.copy()
    eroded = binary_vol.copy()
    for _ in range(shell_depth):
        eroded = binary_erosion(eroded)
        if not eroded.any():
            break
    shell = binary_vol & ~eroded

    shell_indices = np.argwhere(shell)  # (N_shell, 3) — [ix, iy, iz]
    n_shell = len(shell_indices)

    if n_shell == 0:
        return volume

    log.info(f"[reconstruct] Photo-consistency: checking {n_shell:,} shell voxels")

    # Convert shell voxel indices to world coordinates
    scale = (hi - lo) / resolution
    shell_world = shell_indices * scale + lo  # (N_shell, 3)
    shell_h = np.hstack([shell_world, np.ones((n_shell, 1))]).T  # (4, N_shell)

    # Prepare resized RGB images
    rgb_images: dict[str, np.ndarray] = {}
    for view_name, P, mask in cameras:
        rgb_src = view_images.get(view_name)
        if rgb_src is None:
            continue
        if rgb_src.ndim == 3 and rgb_src.shape[2] == 4:
            rgb_src = rgb_src[:, :, :3]
        rgb_images[view_name] = np.array(
            _PIL.fromarray(rgb_src).resize((w, h), _PIL.BILINEAR),
            dtype=np.float32,
        )

    # For each shell voxel, collect colors from all visible views
    colors_per_voxel = np.zeros((n_shell, len(cameras), 3), dtype=np.float32)
    visible_per_voxel = np.zeros((n_shell, len(cameras)), dtype=bool)

    for cam_idx, (view_name, P, mask) in enumerate(cameras):
        rgb = rgb_images.get(view_name)
        if rgb is None:
            continue

        projected = P @ shell_h
        z = projected[2, :]
        in_front = z > 0.01

        u = np.full(z.shape, -1.0)
        v = np.full(z.shape, -1.0)
        u[in_front] = projected[0, in_front] / z[in_front]
        v[in_front] = projected[1, in_front] / z[in_front]

        ui = np.round(u).astype(np.int32)
        vi = np.round(v).astype(np.int32)
        in_bounds = in_front & (ui >= 0) & (ui < w) & (vi >= 0) & (vi < h)

        # Check foreground
        in_fg = np.zeros(n_shell, dtype=bool)
        in_fg[in_bounds] = mask[vi[in_bounds], ui[in_bounds]] > 0.3

        # Sample colors
        colors_per_voxel[in_fg, cam_idx, :] = rgb[vi[in_fg], ui[in_fg]]
        visible_per_voxel[in_fg, cam_idx] = True

    # Compute color standard deviation across visible views
    n_visible = visible_per_voxel.sum(axis=1)  # (N_shell,)
    multi_view = n_visible >= 2

    n_carved = 0
    for i in range(n_shell):
        if not multi_view[i]:
            continue
        vis_mask = visible_per_voxel[i]
        vis_colors = colors_per_voxel[i, vis_mask, :]  # (K, 3)
        std_dev = vis_colors.std(axis=0).mean()
        if std_dev > threshold:
            ix, iy, iz = shell_indices[i]
            volume[ix, iy, iz] *= 0.1
            n_carved += 1

    log.info(f"[reconstruct] Photo-consistency carved {n_carved:,} / {n_shell:,} shell voxels "
             f"(threshold={threshold})")
    return volume


# ═════════════════════════════════════════════════════════════════
#  Stage 4: Oriented Point Cloud Extraction
# ═════════════════════════════════════════════════════════════════

def _extract_oriented_pointcloud(
    volume: np.ndarray,
    vol_bounds: tuple[float, float],
    level: float = 0.3,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Extract surface points with normals from the occupancy volume.

    Uses marching cubes to find isosurface vertices, then estimates
    outward-pointing normals from the volume gradient field.

    Returns (points_Nx3, normals_Nx3) in world coordinates.
    """
    from skimage.measure import marching_cubes

    resolution = volume.shape[0]
    lo, hi = vol_bounds
    scale = (hi - lo) / resolution

    # Get surface vertices via marching cubes
    verts, faces, mc_normals, _ = marching_cubes(volume, level=level)

    if len(verts) == 0:
        raise RuntimeError("Point cloud extraction failed — empty isosurface")

    # Convert to world coordinates
    verts_world = verts * scale + lo

    # Compute volume gradient for better normals
    grad_x, grad_y, grad_z = np.gradient(volume)

    # Sample gradient at each vertex position (nearest voxel)
    vi = np.clip(np.round(verts).astype(np.int32), 0, resolution - 1)
    gx = grad_x[vi[:, 0], vi[:, 1], vi[:, 2]]
    gy = grad_y[vi[:, 0], vi[:, 1], vi[:, 2]]
    gz = grad_z[vi[:, 0], vi[:, 1], vi[:, 2]]

    # Gradient points inward (from low to high occupancy).
    # Negate for outward-pointing normals (Poisson convention).
    normals = np.stack([-gx, -gy, -gz], axis=1)

    # Normalize
    norms = np.linalg.norm(normals, axis=1, keepdims=True)
    norms = np.maximum(norms, 1e-8)
    normals = normals / norms

    # Replace any degenerate normals with marching cubes normals
    degenerate = np.isnan(normals).any(axis=1) | (norms.ravel() < 1e-6)
    if degenerate.any():
        normals[degenerate] = mc_normals[degenerate]

    log.info(f"[reconstruct] Point cloud: {len(verts_world)} points with gradient normals")
    return verts_world, normals


# ═════════════════════════════════════════════════════════════════
#  Stage 5: Open3D Poisson Surface Reconstruction
# ═════════════════════════════════════════════════════════════════

def _poisson_reconstruct(
    points: np.ndarray,
    normals: np.ndarray,
    depth: int = 8,
    scale: float = 1.1,
    density_quantile: float = 0.01,
) -> "trimesh.Trimesh":
    """
    Run Open3D Poisson surface reconstruction on an oriented point cloud.

    Produces a smooth, watertight mesh. Low-density vertices are trimmed
    to remove the "skirt" artifact Poisson produces at boundaries.
    """
    import open3d as o3d
    import trimesh

    # Build Open3D point cloud
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(points.astype(np.float64))
    pcd.normals = o3d.utility.Vector3dVector(normals.astype(np.float64))

    log.info(f"[reconstruct] Poisson reconstruction: {len(points)} points, depth={depth}")

    # Run Poisson
    mesh_o3d, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        pcd, depth=depth, scale=scale, linear_fit=True,
    )

    vertices = np.asarray(mesh_o3d.vertices)
    faces = np.asarray(mesh_o3d.triangles)
    density_arr = np.asarray(densities)

    if len(vertices) == 0:
        raise RuntimeError("Poisson reconstruction produced empty mesh")

    # Trim low-density vertices (removes boundary "skirt")
    if density_quantile > 0 and len(density_arr) > 0:
        threshold = np.quantile(density_arr, density_quantile)
        keep_mask = density_arr >= threshold
        # Build vertex index mapping
        keep_indices = np.where(keep_mask)[0]
        if len(keep_indices) < len(vertices):
            index_map = np.full(len(vertices), -1, dtype=np.int64)
            index_map[keep_indices] = np.arange(len(keep_indices))
            # Remap faces
            new_faces = index_map[faces.ravel()].reshape(-1, 3)
            valid_faces = (new_faces >= 0).all(axis=1)
            new_faces = new_faces[valid_faces]
            vertices = vertices[keep_indices]
            faces = new_faces

            log.info(f"[reconstruct] Density trimming: kept {len(vertices)} / "
                     f"{len(keep_mask)} vertices (quantile={density_quantile})")

    # Compute normals on the cleaned mesh
    mesh_o3d_clean = o3d.geometry.TriangleMesh()
    mesh_o3d_clean.vertices = o3d.utility.Vector3dVector(vertices)
    mesh_o3d_clean.triangles = o3d.utility.Vector3iVector(faces)
    mesh_o3d_clean.compute_vertex_normals()

    mesh = trimesh.Trimesh(
        vertices=vertices,
        faces=faces,
        vertex_normals=np.asarray(mesh_o3d_clean.vertex_normals),
        process=True,
    )

    log.info(f"[reconstruct] Poisson mesh: {len(mesh.vertices)} verts, {len(mesh.faces)} faces")
    return mesh


# ═════════════════════════════════════════════════════════════════
#  Stage 6: Vertex Color Projection
# ═════════════════════════════════════════════════════════════════

def _project_vertex_colors(
    vertices: np.ndarray,
    view_images: dict[str, np.ndarray],
    cameras: list[CameraEntry],
    image_size: int,
    fallback_radius: int = 3,
) -> np.ndarray:
    """
    Assign vertex colors by projecting each vertex into camera views
    and averaging the sampled RGB values.

    Vertices with no direct color hit search a small neighborhood
    around the projected position for the nearest foreground color.
    """
    from PIL import Image as _PIL

    h = w = image_size
    n_verts = len(vertices)

    pts_h = np.hstack([vertices, np.ones((n_verts, 1))]).T  # (4, N)

    color_accum = np.zeros((n_verts, 3), dtype=np.float64)
    weight_accum = np.zeros(n_verts, dtype=np.float64)

    # Pre-resize images
    resized_rgb: dict[str, np.ndarray] = {}
    for view_name, P, mask in cameras:
        rgb_src = view_images.get(view_name)
        if rgb_src is None:
            continue
        if rgb_src.ndim == 3 and rgb_src.shape[2] == 4:
            rgb_src = rgb_src[:, :, :3]
        resized_rgb[view_name] = np.array(
            _PIL.fromarray(rgb_src).resize((w, h), _PIL.BILINEAR),
            dtype=np.float64,
        )

    for view_name, P, mask in cameras:
        rgb = resized_rgb.get(view_name)
        if rgb is None:
            continue

        projected = P @ pts_h
        z = projected[2, :]
        valid = z > 0.01
        u = np.full(z.shape, -1.0)
        v = np.full(z.shape, -1.0)
        u[valid] = projected[0, valid] / z[valid]
        v[valid] = projected[1, valid] / z[valid]

        ui = np.round(u).astype(np.int32)
        vi = np.round(v).astype(np.int32)
        in_bounds = valid & (ui >= 0) & (ui < w) & (vi >= 0) & (vi < h)

        in_fg = np.zeros(n_verts, dtype=bool)
        in_fg[in_bounds] = mask[vi[in_bounds], ui[in_bounds]] > 0.3

        color_accum[in_fg] += rgb[vi[in_fg], ui[in_fg]]
        weight_accum[in_fg] += 1.0

    # Average colors
    has_color = weight_accum > 0
    colors = np.full((n_verts, 4), 128, dtype=np.uint8)
    colors[has_color, :3] = np.clip(
        color_accum[has_color] / weight_accum[has_color, None], 0, 255
    ).astype(np.uint8)
    colors[:, 3] = 255

    # Fallback: for vertices with no color, search nearby pixels
    no_color = ~has_color
    n_no_color = no_color.sum()
    if n_no_color > 0 and fallback_radius > 0:
        n_fixed = 0
        no_color_indices = np.where(no_color)[0]
        # Use the first camera with the most foreground coverage
        best_cam = cameras[0] if cameras else None
        best_rgb = resized_rgb.get(best_cam[0]) if best_cam else None

        if best_cam and best_rgb is not None:
            _, P, mask = best_cam
            projected = P @ pts_h[:, no_color_indices]
            z = projected[2, :]
            valid = z > 0.01

            for j, idx in enumerate(no_color_indices):
                if not valid[j]:
                    continue
                cu = int(round(projected[0, j] / z[j]))
                cv = int(round(projected[1, j] / z[j]))
                # Search expanding neighborhood
                found = False
                for r in range(1, fallback_radius + 1):
                    for dy in range(-r, r + 1):
                        for dx in range(-r, r + 1):
                            ny, nx = cv + dy, cu + dx
                            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] > 0.3:
                                colors[idx, :3] = np.clip(best_rgb[ny, nx], 0, 255).astype(np.uint8)
                                found = True
                                n_fixed += 1
                                break
                        if found:
                            break
                    if found:
                        break

        if n_fixed > 0:
            log.info(f"[reconstruct] Color fallback: fixed {n_fixed} / {n_no_color} uncolored vertices")

    return colors


# ═════════════════════════════════════════════════════════════════
#  Public API — Full Reconstruction Pipeline
# ═════════════════════════════════════════════════════════════════

def visual_hull_reconstruct(
    alpha_masks: dict[str, np.ndarray],
    view_images: Optional[dict[str, np.ndarray]] = None,
    svg_data: Optional[dict[str, str]] = None,
    resolution: int = 256,
    image_size: int = 768,
    svg_raster_size: int = 1024,
    smooth_sigma: float = 0.8,
    vol_bounds: Optional[tuple[float, float]] = None,
    photo_consistency: bool = True,
    photo_threshold: float = 30.0,
    poisson_depth: int = 8,
    fov_deg: float = 30.0,
) -> "trimesh.Trimesh":
    """
    Full multi-view 3D reconstruction pipeline.

    Stages:
      1. Build cameras with SVG or raster masks
      2. Visual hull carving (silhouette projection)
      3. Photo-consistency refinement (RGB-based concavity carving)
      4. Point cloud extraction with gradient normals
      5. Poisson surface reconstruction (or marching cubes fallback)
      6. Vertex color projection from views

    vol_bounds: If None (default), automatically computed from camera FoV
                and radius so the volume matches what the cameras can see.
                Previous hardcoded (-0.8, 0.8) was TOO LARGE for 30° FoV —
                ~50% of voxels per axis fell outside camera view and could
                never be carved, creating a massive uncarvable blob.
    """
    from scipy.ndimage import gaussian_filter
    import trimesh

    # ── Compute volume bounds from camera geometry if not specified ──
    if vol_bounds is None:
        # Get radius from camera poses (all views use same radius)
        first_pose = next(iter(CAMERA_POSES.values()))
        radius = first_pose.get("radius", 1.5)
        vol_bounds = _compute_vol_bounds(fov_deg=fov_deg, radius=radius)

    # ── Stage 1+2: Build cameras and carve ──────────────────────
    cameras, effective_size = _build_cameras(
        alpha_masks, svg_data, image_size, svg_raster_size,
    )

    if not cameras:
        raise RuntimeError("No valid camera views for reconstruction")

    log.info(f"[reconstruct] Pipeline: {len(cameras)} views, "
             f"{resolution}³ voxels, bounds={vol_bounds}")

    volume, pts_world = _carve_visual_hull(
        cameras, effective_size, resolution, vol_bounds,
    )

    # ── Stage 3: Photo-consistency refinement ───────────────────
    if photo_consistency and view_images:
        # Photo-consistency uses the original image_size for RGB sampling
        # (view_images are at original resolution, not SVG raster size)
        pc_cameras = cameras
        if effective_size != image_size:
            # Rebuild cameras at original image size for RGB sampling
            pc_cameras, _ = _build_cameras(
                alpha_masks, None, image_size, image_size,
            )
        volume = _photo_consistency_refine(
            volume, view_images, pc_cameras, image_size,
            vol_bounds, threshold=photo_threshold,
        )

    # ── Smooth volume ───────────────────────────────────────────
    if smooth_sigma > 0:
        volume = gaussian_filter(volume, sigma=smooth_sigma)

    # ── Stage 4+5: Point cloud → Poisson (with fallback) ───────
    lo, hi = vol_bounds
    scale = (hi - lo) / resolution

    try:
        points, normals = _extract_oriented_pointcloud(volume, vol_bounds, level=0.3)

        mesh = _poisson_reconstruct(
            points, normals,
            depth=poisson_depth,
        )
        log.info("[reconstruct] Poisson reconstruction succeeded")

    except Exception as exc:
        log.warning(f"[reconstruct] Poisson failed ({exc}), falling back to marching cubes")
        from skimage.measure import marching_cubes
        try:
            verts, faces, mc_normals, _ = marching_cubes(volume, level=0.3)
        except Exception:
            raise RuntimeError("Reconstruction failed — no surface in volume")

        if len(verts) == 0:
            raise RuntimeError("Reconstruction failed — empty mesh")

        verts_world = verts * scale + lo
        mesh = trimesh.Trimesh(
            vertices=verts_world, faces=faces,
            vertex_normals=mc_normals, process=True,
        )
        log.info(f"[reconstruct] Marching cubes fallback: {len(mesh.vertices)} verts")

    # ── Stage 6: Vertex colors ──────────────────────────────────
    if view_images:
        # Use original-size cameras for color projection
        color_cameras = cameras
        if effective_size != image_size:
            color_cameras, _ = _build_cameras(
                alpha_masks, None, image_size, image_size,
            )
        vertex_colors = _project_vertex_colors(
            mesh.vertices, view_images, color_cameras, image_size,
        )
        mesh.visual.vertex_colors = vertex_colors

    log.info(f"[reconstruct] Final mesh: {len(mesh.vertices)} verts, {len(mesh.faces)} faces")
    return mesh


# ── Quick mesh cleanup ────────────────────────────────────────

def cleanup_mesh(
    mesh: "trimesh.Trimesh",
    smooth_iterations: int = 3,
    target_faces: Optional[int] = None,
) -> "trimesh.Trimesh":
    """Post-processing: smooth + decimate + fix normals."""
    import trimesh

    trimesh.repair.fix_winding(mesh)
    trimesh.repair.fix_normals(mesh)
    trimesh.repair.fill_holes(mesh)

    if smooth_iterations > 0:
        trimesh.smoothing.filter_laplacian(mesh, iterations=smooth_iterations)

    if target_faces and len(mesh.faces) > target_faces:
        mesh = mesh.simplify_quadric_decimation(target_faces)

    return mesh
