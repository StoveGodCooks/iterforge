"""
export.py — Vertex color projection + multi-format mesh export.

Pipeline
--------
1. Convert CadQuery shape → trimesh via direct OCC triangulation (STL fallback).
2. Project per-vertex colors from the source RGBA view images.
3. Apply Open3D Laplacian smoothing (configurable iterations).
4. Generate LOD0–LOD3 at 100/50/25/10% of face count.
5. Export to any subset of: GLB (vertex colors), OBJ, STL, DXF.

Vertex Color Projection
-----------------------
Each vertex is mapped onto whichever view(s) can "see" it, weighted by how
directly the vertex normal faces the view camera:

  front  → project (x, y)  — camera at +Z
  right  → project (z, y)  — camera at +X
  left   → project (-z, y) — camera at -X
  top    → project (x, z)  — camera at +Y

Colors are a weighted average of all views that contribute (weight = normal dot
view direction, clamped to [0, 1]). Vertices with no contributing view get a
neutral grey (0.5, 0.5, 0.5).

DXF Export
----------
Requires ezdxf>=1.0. Writes triangle faces as 3DFACE entities.
Skipped gracefully if ezdxf is not installed.

FBX
---
trimesh has no native FBX writer. FBX output path is returned as None with a
note — integrate pyassimp or ufbx when needed.
"""
from __future__ import annotations

import io
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image


# ── Image loading ─────────────────────────────────────────────

def _load_rgba(path: str | Path | None) -> Optional[np.ndarray]:
    if path is None:
        return None
    p = Path(path)
    if not p.exists():
        return None
    return np.array(Image.open(str(p)).convert("RGBA"), dtype=np.uint8)


# ── CadQuery → trimesh ────────────────────────────────────────

def cadquery_to_trimesh(
    shape,
    linear_deflection: float = 0.001,
    angular_deflection: float = 0.1,
) -> "trimesh.Trimesh":  # type: ignore
    """
    Convert a CadQuery Shape to trimesh by extracting OCC triangulation directly.

    Falls back to the legacy STL round-trip if the OCC API is unavailable.
    ``linear_deflection`` controls tesselation density (smaller = finer mesh).
    """
    try:
        return _cadquery_to_trimesh_direct(shape, linear_deflection, angular_deflection)
    except Exception:
        return _cadquery_to_trimesh_stl(shape)


def _cadquery_to_trimesh_direct(
    shape,
    linear_deflection: float,
    angular_deflection: float,
) -> "trimesh.Trimesh":  # type: ignore
    """Extract OCC triangulation directly — avoids lossy 32-bit STL round-trip."""
    import trimesh  # type: ignore
    from OCP.BRepMesh import BRepMesh_IncrementalMesh  # type: ignore
    from OCP.TopExp import TopExp_Explorer  # type: ignore
    from OCP.TopAbs import TopAbs_FACE  # type: ignore
    from OCP.BRep import BRep_Tool  # type: ignore
    from OCP.TopLoc import TopLoc_Location  # type: ignore

    occ_shape = shape.wrapped if hasattr(shape, "wrapped") else shape
    BRepMesh_IncrementalMesh(occ_shape, linear_deflection, False, angular_deflection, True)

    all_verts: list[list[float]] = []
    all_faces: list[list[int]] = []
    offset = 0

    explorer = TopExp_Explorer(occ_shape, TopAbs_FACE)
    while explorer.More():
        face = explorer.Current()
        loc = TopLoc_Location()
        triangulation = BRep_Tool.Triangulation_s(face, loc)
        if triangulation is None:
            explorer.Next()
            continue

        n_nodes = triangulation.NbNodes()
        for i in range(1, n_nodes + 1):
            pt = triangulation.Node(i)
            all_verts.append([pt.X(), pt.Y(), pt.Z()])

        n_tris = triangulation.NbTriangles()
        for i in range(1, n_tris + 1):
            tri = triangulation.Triangle(i)
            n1, n2, n3 = tri.Get()
            all_faces.append([n1 - 1 + offset, n2 - 1 + offset, n3 - 1 + offset])

        offset += n_nodes
        explorer.Next()

    if not all_verts:
        raise RuntimeError("OCC triangulation produced no vertices")

    return trimesh.Trimesh(
        vertices=np.array(all_verts, dtype=np.float64),
        faces=np.array(all_faces, dtype=np.int64),
        process=True,
    )


def _cadquery_to_trimesh_stl(shape) -> "trimesh.Trimesh":  # type: ignore
    """Legacy fallback: STL round-trip (32-bit float precision loss)."""
    import trimesh  # type: ignore
    import cadquery as cq  # type: ignore

    buf = io.BytesIO()
    cq.exporters.export(shape, buf, exportType="STL")
    buf.seek(0)
    mesh = trimesh.load(buf, file_type="stl")
    if isinstance(mesh, trimesh.Scene):
        mesh = trimesh.util.concatenate(list(mesh.geometry.values()))
    return mesh


# ── Vertex color projection ───────────────────────────────────

def project_vertex_colors(
    mesh:  "trimesh.Trimesh",  # type: ignore
    views: dict[str, np.ndarray],
) -> np.ndarray:
    """
    Project RGBA view images onto mesh vertices.

    Parameters
    ----------
    mesh  : trimesh.Trimesh with valid vertex positions and normals
    views : dict mapping angle ("front"|"right"|"left"|"top") → RGBA uint8 array

    Returns
    -------
    float32 array of shape (N, 3) with per-vertex RGB colors in [0, 1].
    """
    verts = np.asarray(mesh.vertices, dtype=np.float64)

    # Normalize to [-1, 1] in all axes
    mn, mx = verts.min(axis=0), verts.max(axis=0)
    span   = (mx - mn).max()
    if span < 1e-9:
        return np.full((len(verts), 3), 0.5, dtype=np.float32)
    vn = (verts - (mn + mx) / 2.0) / (span / 2.0)   # (N, 3) in [-1, 1]

    # Per-vertex normals
    try:
        normals = np.asarray(mesh.vertex_normals, dtype=np.float64)
    except Exception:
        normals = np.zeros_like(vn)
        normals[:, 2] = 1.0

    # View definitions: (uv_fn, view_direction_unit_vec)
    # uv_fn(vn) → (u, v) arrays in [0, 1]
    # Synthesize back view from mirrored front (if front exists but back doesn't)
    if "front" in views and "back" not in views:
        views["back"] = np.flip(views["front"], axis=1).copy()

    # View definitions: (uv_fn, view_direction_unit_vec, weight_scale)
    # uv_fn(vn) → (u, v) arrays in [0, 1]
    # weight_scale: synthetic views get lower confidence
    # NOTE: Image row 0 = top of image = mesh y=+1.
    # So v-coordinate must FLIP the y-axis:  v = 0.5 - mesh_y * 0.5
    view_defs = {
        "front": (
            lambda v: (v[:, 0] * 0.5 + 0.5, 0.5 - v[:, 1] * 0.5),
            np.array([0.0, 0.0, 1.0]),
            1.0,
        ),
        "back": (
            lambda v: (1.0 - (v[:, 0] * 0.5 + 0.5), 0.5 - v[:, 1] * 0.5),
            np.array([0.0, 0.0, -1.0]),
            0.5,   # synthetic mirror — lower confidence
        ),
        "right": (
            lambda v: (v[:, 2] * 0.5 + 0.5, 0.5 - v[:, 1] * 0.5),
            np.array([1.0, 0.0, 0.0]),
            1.0,
        ),
        "left": (
            lambda v: (1.0 - (v[:, 2] * 0.5 + 0.5), 0.5 - v[:, 1] * 0.5),
            np.array([-1.0, 0.0, 0.0]),
            1.0,
        ),
        "top": (
            lambda v: (v[:, 0] * 0.5 + 0.5, 0.5 - v[:, 2] * 0.5),
            np.array([0.0, 1.0, 0.0]),
            1.0,
        ),
    }

    n_verts = len(vn)
    color_accum  = np.zeros((n_verts, 3), dtype=np.float64)
    weight_accum = np.zeros(n_verts,       dtype=np.float64)

    for angle, (uv_fn, view_dir, w_scale) in view_defs.items():
        img = views.get(angle)
        if img is None:
            continue

        # Weight = dot(vertex_normal, view_direction) — only front-facing verts
        weights = np.clip(normals @ view_dir, 0.0, 1.0) * w_scale   # (N,)
        active  = weights > 0.01
        if not active.any():
            continue

        u_arr, v_arr = uv_fn(vn)
        img_h, img_w = img.shape[:2]

        # Bilinear interpolation for smooth color projection
        fx = np.clip(u_arr[active] * (img_w - 1), 0, img_w - 1.001)
        fy = np.clip(v_arr[active] * (img_h - 1), 0, img_h - 1.001)
        x0 = fx.astype(int)
        y0 = fy.astype(int)
        x1 = np.minimum(x0 + 1, img_w - 1)
        y1 = np.minimum(y0 + 1, img_h - 1)
        wx = (fx - x0)[:, np.newaxis]
        wy = (fy - y0)[:, np.newaxis]

        c00 = img[y0, x0, :3].astype(np.float64)
        c10 = img[y0, x1, :3].astype(np.float64)
        c01 = img[y1, x0, :3].astype(np.float64)
        c11 = img[y1, x1, :3].astype(np.float64)
        rgb = c00 * (1 - wx) * (1 - wy) + c10 * wx * (1 - wy) + c01 * (1 - wx) * wy + c11 * wx * wy

        # Alpha check uses nearest-neighbor (binary decision)
        px_x = np.clip(np.round(fx).astype(int), 0, img_w - 1)
        px_y = np.clip(np.round(fy).astype(int), 0, img_h - 1)
        alpha = img[px_y, px_x, 3]

        fg_mask = alpha >= 32
        w_active = weights[active]

        indices = np.where(active)[0]
        valid   = indices[fg_mask]
        w_valid = w_active[fg_mask]
        rgb_valid = rgb[fg_mask]

        color_accum[valid]  += rgb_valid * w_valid[:, np.newaxis]
        weight_accum[valid] += w_valid

    # Normalize accumulated colors
    result = np.full((n_verts, 3), 128.0, dtype=np.float64)
    mask = weight_accum > 1e-6
    result[mask] = color_accum[mask] / weight_accum[mask, np.newaxis]
    return (result / 255.0).astype(np.float32)


# ── Open3D smoothing ──────────────────────────────────────────

def _copy_vertex_colors(mesh: "trimesh.Trimesh") -> "np.ndarray | None":
    """Return a uint8 copy of mesh vertex colors, or None if absent."""
    try:
        vc = mesh.visual.vertex_colors
        if vc is not None and len(vc) == len(mesh.vertices):
            return np.asarray(vc, dtype=np.uint8).copy()
    except Exception:
        pass
    return None


def _paste_vertex_colors(
    src_verts: np.ndarray,
    colors:    np.ndarray,
    dst:       "trimesh.Trimesh",
) -> None:
    """Transfer vertex colors from src positions to dst via nearest-neighbor."""
    try:
        from scipy.spatial import cKDTree
        tree = cKDTree(src_verts)
        _, idx = tree.query(np.asarray(dst.vertices, dtype=np.float64))
        dst.visual.vertex_colors = colors[idx]
    except Exception:
        pass


def smooth_mesh_laplacian(
    mesh:       "trimesh.Trimesh",  # type: ignore
    iterations: int = 3,
) -> "trimesh.Trimesh":  # type: ignore
    """
    Apply Open3D Laplacian smoothing and return a new trimesh.Trimesh.
    Falls back silently to the original mesh if open3d is unavailable.
    """
    if iterations <= 0:
        return mesh
    try:
        import open3d as o3d  # type: ignore
        import trimesh  # type: ignore

        src_verts  = np.asarray(mesh.vertices, dtype=np.float64)
        src_colors = _copy_vertex_colors(mesh)

        o3d_mesh = o3d.geometry.TriangleMesh()
        o3d_mesh.vertices  = o3d.utility.Vector3dVector(src_verts)
        o3d_mesh.triangles = o3d.utility.Vector3iVector(np.asarray(mesh.faces, dtype=np.int32))
        o3d_mesh = o3d_mesh.filter_smooth_laplacian(number_of_iterations=iterations)
        o3d_mesh.compute_vertex_normals()

        result = trimesh.Trimesh(
            vertices=np.asarray(o3d_mesh.vertices),
            faces=np.asarray(o3d_mesh.triangles),
            process=False,
        )
        if src_colors is not None:
            _paste_vertex_colors(src_verts, src_colors, result)
        return result
    except Exception:
        return mesh


def smooth_mesh_taubin(
    mesh:            "trimesh.Trimesh",  # type: ignore
    iterations:      int = 10,
    lambda_factor:   float = 0.5,
    mu_factor:       float = -0.53,
) -> "trimesh.Trimesh":  # type: ignore
    """
    Apply Open3D Taubin smoothing — alternates positive/negative Laplacian
    steps to smooth without net volume shrinkage.

    Preferred over Laplacian for organic meshes (characters, creatures, props)
    where shape preservation matters.
    """
    if iterations <= 0:
        return mesh
    try:
        import open3d as o3d  # type: ignore
        import trimesh  # type: ignore

        src_verts  = np.asarray(mesh.vertices, dtype=np.float64)
        src_colors = _copy_vertex_colors(mesh)

        o3d_mesh = o3d.geometry.TriangleMesh()
        o3d_mesh.vertices  = o3d.utility.Vector3dVector(src_verts)
        o3d_mesh.triangles = o3d.utility.Vector3iVector(np.asarray(mesh.faces, dtype=np.int32))
        o3d_mesh = o3d_mesh.filter_smooth_taubin(
            number_of_iterations=iterations,
            lambda_filter=lambda_factor,
            mu_filter=mu_factor,
        )
        o3d_mesh.compute_vertex_normals()

        result = trimesh.Trimesh(
            vertices=np.asarray(o3d_mesh.vertices),
            faces=np.asarray(o3d_mesh.triangles),
            process=False,
        )
        if src_colors is not None:
            _paste_vertex_colors(src_verts, src_colors, result)
        return result
    except Exception:
        return mesh


# ── LOD generation ────────────────────────────────────────────

_LOD_RATIOS = [("lod0", 1.0), ("lod1", 0.5), ("lod2", 0.25), ("lod3", 0.10)]


def generate_lods(
    mesh:           "trimesh.Trimesh",  # type: ignore
    out_dir:        Path,
    base_name:      str = "asset",
    vertex_colors:  "np.ndarray | None" = None,
) -> dict[str, str]:
    """
    Generate LOD0–LOD3 OBJ files at 100/50/25/10% of base face count.

    If ``vertex_colors`` (float32 Nx3 in [0,1]) is provided, colors are
    transferred to each LOD mesh via nearest-vertex lookup from LOD0.

    Returns {lod_name: file_path_str}.
    """
    base_faces = len(mesh.faces)
    lod_paths: dict[str, str] = {}

    # Build KDTree once for color transfer
    _tree = None
    if vertex_colors is not None and len(vertex_colors) == len(mesh.vertices):
        try:
            from scipy.spatial import cKDTree
            _tree = cKDTree(np.asarray(mesh.vertices))
        except ImportError:
            _tree = None

    for name, ratio in _LOD_RATIOS:
        target = max(4, int(base_faces * ratio))
        if ratio < 1.0 and len(mesh.faces) > target:
            try:
                lod_mesh = mesh.simplify_quadric_decimation(target)
            except Exception:
                lod_mesh = mesh
        else:
            lod_mesh = mesh

        # Transfer vertex colors from LOD0 to decimated mesh
        if _tree is not None and ratio < 1.0 and lod_mesh is not mesh:
            _, indices = _tree.query(np.asarray(lod_mesh.vertices))
            lod_colors = vertex_colors[indices]
            lod_colors_u8 = (np.clip(lod_colors, 0.0, 1.0) * 255).astype(np.uint8)
            alpha = np.full((len(lod_colors_u8), 1), 255, dtype=np.uint8)
            lod_mesh.visual.vertex_colors = np.hstack([lod_colors_u8, alpha])

        out_path = out_dir / f"{base_name}_{name}.obj"
        lod_mesh.export(str(out_path))
        lod_paths[name] = str(out_path)

    return lod_paths


# ── DXF export ────────────────────────────────────────────────

def export_dxf(mesh: "trimesh.Trimesh", out_path: Path) -> bool:  # type: ignore
    """
    Write mesh triangles as DXF 3DFACE entities.
    Returns True on success, False if ezdxf is not installed.
    """
    try:
        import ezdxf  # type: ignore
    except ImportError:
        return False

    doc = ezdxf.new(dxfversion="R2010")
    msp = doc.modelspace()
    verts = np.asarray(mesh.vertices)
    faces = np.asarray(mesh.faces)

    for face in faces:
        v0 = tuple(float(x) for x in verts[face[0]])
        v1 = tuple(float(x) for x in verts[face[1]])
        v2 = tuple(float(x) for x in verts[face[2]])
        # 3DFACE requires 4 points; repeat last vertex for triangles
        msp.add_3dface([v0, v1, v2, v2])

    doc.saveas(str(out_path))
    return True


# ── GLB with vertex colors ────────────────────────────────────

def export_glb_with_colors(
    mesh:          "trimesh.Trimesh",  # type: ignore
    vertex_colors: np.ndarray,          # float32 (N, 3) in [0, 1]
    out_path:      Path,
) -> None:
    """Export GLB with embedded per-vertex RGBA colors."""
    import trimesh  # type: ignore

    colors_u8 = (np.clip(vertex_colors, 0.0, 1.0) * 255).astype(np.uint8)
    alpha      = np.full((len(colors_u8), 1), 255, dtype=np.uint8)
    rgba       = np.hstack([colors_u8, alpha])

    colored = trimesh.Trimesh(
        vertices=mesh.vertices,
        faces=mesh.faces,
        vertex_colors=rgba,
        process=False,
    )
    colored.export(str(out_path))


# ── Main orchestrator ─────────────────────────────────────────

def export_all(
    shape,                                         # CadQuery Shape or trimesh.Trimesh
    out_dir:          str | Path,
    views:            dict[str, str | Path | None],  # angle → RGBA PNG path (or None)
    formats:          list[str] = ("glb", "obj", "stl"),
    base_name:        str = "asset",
    no_lod:           bool = False,
    no_dxf:           bool = False,
    smooth_iterations: int = 3,
) -> dict[str, object]:
    """
    Full export pipeline.

    Parameters
    ----------
    shape             : CadQuery Shape or trimesh.Trimesh
    out_dir           : output directory (created if absent)
    views             : {angle: path_to_rgba_png} for color projection
    formats           : which formats to write — any of "glb", "obj", "stl", "dxf", "fbx"
    base_name         : output file stem
    no_lod            : skip LOD generation
    no_dxf            : skip DXF export even if "dxf" in formats
    smooth_iterations : Laplacian smoothing passes (0 = skip)

    Returns
    -------
    dict with keys: "glb", "obj", "stl", "dxf", "fbx", "lods"
    Each is a file path string or None if skipped.
    """
    import trimesh as tm  # type: ignore

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Convert CadQuery → trimesh if needed
    if hasattr(shape, "wrapped"):
        mesh = cadquery_to_trimesh(shape)
    elif isinstance(shape, tm.Trimesh):
        mesh = shape
    else:
        raise TypeError(f"Unsupported shape type: {type(shape).__name__}")

    # Smooth
    mesh = smooth_mesh_laplacian(mesh, iterations=smooth_iterations)

    # Load view images for color projection
    loaded: dict[str, np.ndarray] = {}
    for angle, path in views.items():
        img = _load_rgba(path)
        if img is not None:
            loaded[angle] = img

    vertex_colors: Optional[np.ndarray] = None
    if loaded:
        vertex_colors = project_vertex_colors(mesh, loaded)

    result: dict[str, object] = {}

    # ── GLB ──────────────────────────────────────────────────
    if "glb" in formats:
        glb_path = out_dir / f"{base_name}.glb"
        if vertex_colors is not None:
            export_glb_with_colors(mesh, vertex_colors, glb_path)
        else:
            mesh.export(str(glb_path))
        result["glb"] = str(glb_path)
    else:
        result["glb"] = None

    # ── OBJ ──────────────────────────────────────────────────
    if "obj" in formats:
        obj_path = out_dir / f"{base_name}.obj"
        mesh.export(str(obj_path))
        result["obj"] = str(obj_path)
    else:
        result["obj"] = None

    # ── STL ──────────────────────────────────────────────────
    if "stl" in formats:
        stl_path = out_dir / f"{base_name}.stl"
        mesh.export(str(stl_path))
        result["stl"] = str(stl_path)
    else:
        result["stl"] = None

    # ── FBX (not natively supported by trimesh) ───────────────
    if "fbx" in formats:
        result["fbx"] = None   # placeholder — needs pyassimp/ufbx
    else:
        result["fbx"] = None

    # ── DXF ───────────────────────────────────────────────────
    if "dxf" in formats and not no_dxf:
        dxf_path = out_dir / f"{base_name}.dxf"
        ok = export_dxf(mesh, dxf_path)
        result["dxf"] = str(dxf_path) if ok else None
    else:
        result["dxf"] = None

    # ── LODs ───────────────────────────────────────────────────
    if not no_lod:
        result["lods"] = generate_lods(
            mesh, out_dir, base_name=base_name, vertex_colors=vertex_colors,
        )
    else:
        # LOD0 = the primary export file (prefer OBJ for LOD consistency)
        primary = result.get("obj") or result.get("glb")
        result["lods"] = {"lod0": primary}

    return result
