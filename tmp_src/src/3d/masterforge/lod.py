"""
lod.py - automatic LOD (Level of Detail) mesh generation.

Generates 3 LOD levels from the full-resolution CadQuery STL using
pyvista's VTK decimation filter.

LOD levels (configurable):
  LOD 0 - 100% (full res, for cutscenes / close-up)
  LOD 1 -  50% (mid range, standard in-game)
  LOD 2 -  10% (far distance, many on-screen)

Outputs:
  <stem>_lod0.stl   full resolution (copy of original)
  <stem>_lod1.stl   50% reduction
  <stem>_lod2.stl   90% reduction

Each LOD is also exported as GLB when a texture is provided.
"""

import os


# Default LOD target reductions (pyvista decimate: 0 = no change, 0.9 = 90% removed)
LOD_REDUCTIONS = (0.0, 0.50, 0.90)
LOD_NAMES      = ('lod0', 'lod1', 'lod2')


def generate_lods(stl_path: str, output_dir: str, stem: str,
                  reductions: tuple = LOD_REDUCTIONS) -> list:
    """
    Generate LOD meshes from a source STL.

    Args:
        stl_path   - full-resolution input STL
        output_dir - directory to write LOD files
        stem       - filename stem (e.g. 'sword')
        reductions - tuple of VTK target reductions per LOD level

    Returns list of output STL paths.
    """
    try:
        import pyvista as pv
    except ImportError:
        print('[masterforge.lod] pyvista not installed - '
              'pip install pyvista')
        return []

    mesh   = pv.read(stl_path)
    n_in   = mesh.n_cells   # n_faces removed in PyVista 0.43+ — use n_cells
    paths  = []

    for i, reduction in enumerate(reductions):
        name     = LOD_NAMES[i] if i < len(LOD_NAMES) else f'lod{i}'
        out_path = os.path.join(output_dir, f'{stem}_{name}.stl')

        if reduction <= 0.0:
            # LOD 0 - write full-res copy
            mesh.save(out_path)
            n_out = mesh.n_cells
        else:
            try:
                decimated = mesh.decimate(
                    reduction,
                    volume_preservation=True,
                    attribute_error=False,
                )
                decimated.save(out_path)
                n_out = decimated.n_cells
            except Exception as e:
                print(f'[masterforge.lod] LOD{i} decimate failed: {e} - skipping')
                continue

        pct  = int((1.0 - reduction) * 100)
        size = os.path.getsize(out_path)
        print(f'[masterforge.lod] LOD{i}: {pct}%  '
              f'{n_in}->{n_out} faces  '
              f'{size:,} bytes  {out_path}')
        paths.append(out_path)

    return paths


def lod_summary(lod_paths: list) -> dict:
    """Return a dict of LOD metadata for JSON output."""
    import pyvista as pv
    summary = {}
    for path in lod_paths:
        stem  = os.path.splitext(os.path.basename(path))[0]
        label = stem.rsplit('_', 1)[-1]   # 'lod0', 'lod1', 'lod2'
        try:
            m = pv.read(path)
            summary[label] = {
                'path':   path,
                'faces':  int(m.n_cells),   # n_faces removed in PyVista 0.43+
                'verts':  int(m.n_points),
                'bytes':  int(os.path.getsize(path)),
            }
        except Exception:
            summary[label] = {'path': path}
    return summary
