"""
unwrap.py - xatlas UV atlas generation.

Takes a watertight STL mesh (from CadQuery loft), runs xatlas parametrization
to produce a game-ready UV atlas with no overlapping charts, and saves the
result as a .npz file alongside the STL.

Output .npz keys:
  vertices  - (N, 3) float32  new vertex positions (remapped by xatlas)
  faces     - (M, 3) uint32   new triangle indices
  uvs       - (N, 2) float32  UV coordinates in [0, 1]
  vmapping  - (N,)   uint32   new vertex index -> original vertex index
"""

import numpy as np


def unwrap_uv(stl_path: str, output_path: str = None, use_xatlas: bool = False) -> tuple:
    """
    Load STL, generate UV coordinates, optionally save .npz.

    Args:
        stl_path     - path to input STL file
        output_path  - where to save .npz (None = don't save)
        use_xatlas   - if True, use xatlas (can shred 2D art).
                       if False (default), use planar front-projection.

    Returns:
        (vmapping, new_faces, uvs, new_vertices)
    """
    import trimesh
    mesh = trimesh.load(stl_path, force='mesh')
    vertices = np.array(mesh.vertices, dtype=np.float32)
    faces    = np.array(mesh.faces,    dtype=np.uint32)

    print(f'[masterforge.unwrap] input: {len(vertices)} verts, {len(faces)} faces')

    if use_xatlas:
        import xatlas
        atlas = xatlas.Atlas()
        atlas.add_mesh(vertices, faces)

        chart_opts = xatlas.ChartOptions()
        chart_opts.max_iterations = 4
        pack_opts  = xatlas.PackOptions()
        pack_opts.padding = 2
        pack_opts.resolution = 1024

        atlas.generate(chart_opts, pack_opts)
        vmapping, new_faces, uvs = atlas[0]
        new_vertices = vertices[vmapping]
        print('[masterforge.unwrap] using xatlas unwrapping')
    else:
        # Planar Projection: Map [-1, 1] mesh space to [0, 1] UV space
        # This keeps the original 2D art perfectly aligned on front/back.
        uvs = np.zeros((len(vertices), 2), dtype=np.float32)
        uvs[:, 0] = np.clip((vertices[:, 0] + 1.0) * 0.5, 0, 1)
        uvs[:, 1] = np.clip((vertices[:, 1] + 1.0) * 0.5, 0, 1)
        
        vmapping = np.arange(len(vertices), dtype=np.uint32)
        new_faces = faces
        new_vertices = vertices
        print('[masterforge.unwrap] using planar front-projection UVs')

    print(f'[masterforge.unwrap] done: '
          f'{len(new_vertices)} verts, {len(new_faces)} faces, '
          f'UV range [{uvs.min():.3f}, {uvs.max():.3f}]')

    if output_path:
        np.savez(
            output_path,
            vertices=new_vertices,
            faces=new_faces,
            uvs=uvs,
            vmapping=vmapping,
        )
        import os
        final_path = output_path if output_path.endswith('.npz') else output_path + '.npz'
        size = os.path.getsize(final_path)
        print(f'[masterforge.unwrap] UV data saved: {final_path}  ({size:,} bytes)')

    return vmapping, new_faces, uvs, new_vertices
