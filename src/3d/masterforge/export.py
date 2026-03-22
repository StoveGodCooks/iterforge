"""
export.py - mesh export: STL (primary), GLB (game engine), DXF (CAD editing).

STL  - CadQuery output, full precision, Blender import.
GLB  - trimesh export with UV atlas + baked texture, game-engine ready.
DXF  - ezdxf 3D face mesh, importable into Fusion 360 / AutoCAD / Rhino.
"""

import os


# -- STL -----------------------------------------------------------------------

def export_stl(solid, output_path: str, cq, exporters) -> str:
    """Export a CadQuery solid to STL. Returns output_path."""
    exporters.export(cq.Workplane().add(solid), output_path)
    size = os.path.getsize(output_path)
    print(f'[masterforge.export] STL -> {output_path}  ({size:,} bytes)')
    return output_path


def smooth_mesh(stl_path: str, iterations: int = 3) -> str:
    """
    Apply Laplacian smoothing to an STL mesh using Open3D.
    Overwrites the original STL file.
    """
    try:
        import open3d as o3d
        mesh = o3d.io.read_triangle_mesh(stl_path)
        if mesh.is_empty():
            return stl_path
            
        # Laplacian smoothing reduces noise and "stair-stepping" from slices
        mesh = mesh.filter_smooth_laplacian(number_of_iterations=iterations)
        mesh.compute_vertex_normals()
        o3d.io.write_triangle_mesh(stl_path, mesh)
        print(f'[masterforge.export] Mesh smoothed ({iterations} iter)')
    except Exception as e:
        print(f'[masterforge.export] Smoothing failed: {e}')
    return stl_path


# -- GLB (Vertex Color) --------------------------------------------------------

def export_glb_vertex_color(stl_path: str, front_image_path: str, output_path: str) -> str:
    """
    Project front image onto mesh vertices to create a vertex-colored GLB.
    Uses mask-aware nearest-foreground sampling to prevent shadow/background bleeding
    onto back-face or side-face vertices.
    """
    import trimesh
    import numpy as np
    from PIL import Image
    from scipy.ndimage import distance_transform_edt
    from masterforge.ingest import load_rgba, get_mask

    mesh    = trimesh.load(stl_path, force='mesh')
    rgba    = load_rgba(front_image_path)
    mask    = get_mask(rgba, image_path=front_image_path)
    H, W    = rgba.shape[:2]
    img_rgb = (rgba[:, :, :3] * 255).astype(np.uint8)

    verts  = mesh.vertices
    v_min  = verts.min(axis=0)
    v_max  = verts.max(axis=0)
    v_span = v_max - v_min + 1e-6

    # Planar projection mapping
    u = (verts[:, 0] - v_min[0]) / v_span[0]
    v = 1.0 - (verts[:, 1] - v_min[1]) / v_span[1]

    px = np.clip((u * (W - 1)).astype(int), 0, W - 1)
    py = np.clip((v * (H - 1)).astype(int), 0, H - 1)

    # Nearest foreground pixel for vertices mapping to background/shadows
    # ensures clean color even on the "back" of the planar-projected mesh.
    _, nearest = distance_transform_edt(~mask, return_indices=True)
    px_safe = np.where(mask[py, px], px, nearest[1][py, px])
    py_safe = np.where(mask[py, px], py, nearest[0][py, px])

    colors = img_rgb[py_safe, px_safe]
    
    # Add full alpha for the vertex color array (RGBA)
    alpha = np.full((len(colors), 1), 255, dtype=np.uint8)
    colors_rgba = np.hstack([colors, alpha])

    mesh.visual = trimesh.visual.ColorVisuals(
        mesh=mesh,
        vertex_colors=colors_rgba
    )
    
    mesh.export(output_path)
    print(f'[masterforge.export] Vertex-color GLB -> {output_path}')
    return output_path


# -- GLB (Textured) ------------------------------------------------------------

def export_glb(uv_npz_path: str, texture_path: str,
               output_path: str) -> str:
    """
    Build a trimesh with UV atlas + baked texture and export as GLB.
    """
    import trimesh
    import numpy as np
    from PIL import Image

    data     = np.load(uv_npz_path)
    vertices = data['vertices'].astype(np.float64)
    faces    = data['faces'].astype(np.int32)
    uvs      = data['uvs'].astype(np.float64)

    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    mesh.fix_normals()
    
    if os.path.isfile(texture_path):
        tex_img  = Image.open(texture_path).convert('RGBA')
        material = trimesh.visual.material.PBRMaterial(
            baseColorTexture=tex_img,
            metallicFactor=0.0,
            roughnessFactor=0.85,
        )
        mesh.visual = trimesh.visual.TextureVisuals(
            uv=uvs,
            material=material,
        )
    else:
        print(f'[masterforge.export] GLB: no texture at {texture_path} - '
              'exporting without material')

    mesh.export(output_path)
    size = os.path.getsize(output_path)
    print(f'[masterforge.export] GLB -> {output_path}  ({size:,} bytes)')
    return output_path


# -- DXF -----------------------------------------------------------------------

def export_dxf(stl_path: str, output_path: str) -> str:
    """
    Export mesh as DXF R2010 with 3DFACE entities.
    """
    import ezdxf
    import trimesh
    import numpy as np

    mesh     = trimesh.load(stl_path, force='mesh')
    vertices = np.array(mesh.vertices, dtype=np.float64)
    faces    = np.array(mesh.faces,    dtype=np.int32)

    doc = ezdxf.new('R2010')
    doc.header['$INSUNITS'] = 6
    msp = doc.modelspace()

    for face in faces:
        v0 = vertices[face[0]]
        v1 = vertices[face[1]]
        v2 = vertices[face[2]]
        msp.add_3dface([
            (float(v0[0]), float(v0[1]), float(v0[2])),
            (float(v1[0]), float(v1[1]), float(v1[2])),
            (float(v2[0]), float(v2[1]), float(v2[2])),
            (float(v2[0]), float(v2[1]), float(v2[2])),
        ])

    doc.saveas(output_path)
    size = os.path.getsize(output_path)
    print(f'[masterforge.export] DXF -> {output_path}  ({size:,} bytes)')
    return output_path
