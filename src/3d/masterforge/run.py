#!/usr/bin/env python3
"""
MasterForge run.py - unified game asset 3D pipeline entry point.

Usage:
  python run.py <image_path> --type sword --output ./out/
  python run.py <image_path> --type axe   --output ./out/ --fallback profile.json
  python run.py <image_path> --type sword --stl /explicit/path/sword.stl
  python run.py <image_path> --type sword --midas      (neural depth)
  python run.py <image_path> --type sword --no-lod     (skip LOD generation)

Outputs written to --output dir (or --stl parent dir):
  <stem>.stl            watertight CAD mesh (primary)
  <stem>_uv.npz         xatlas UV atlas (vertices, faces, uvs)
  <stem>_tex.png        baked texture (512x512 RGBA)
  <stem>.glb            game-engine ready mesh with UV + texture
  <stem>.dxf            editable CAD file (Fusion 360, AutoCAD, Rhino)
  <stem>_lod0.stl       full resolution
  <stem>_lod1.stl       50% reduced
  <stem>_lod2.stl       90% reduced
  <stem>_zones.json     zone graph (diagnostic)

Exit codes:
  0  success
  1  usage / config / trace error
  2  cadquery not installed
  3  not enough wires for loft
  4  loft or export failed
"""

import sys
import os
import json
import argparse

# Ensure masterforge package is importable when called as a script
_pkg_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _pkg_dir not in sys.path:
    sys.path.insert(0, _pkg_dir)


def main():
    parser = argparse.ArgumentParser(description='MasterForge asset pipeline')
    parser.add_argument('image',
                        help='Input PNG path')
    parser.add_argument('--type',     default='sword', dest='asset_type',
                        help='Asset type: sword, axe, dagger, staff (default: sword)')
    parser.add_argument('--output',   default='.',
                        help='Output directory (default: current dir)')
    parser.add_argument('--fallback', default=None,
                        help='Profile fallback JSON (optional)')
    parser.add_argument('--stl',      default=None,
                        help='Explicit STL path (overrides --output stem naming)')
    parser.add_argument('--no-uv',    action='store_true',
                        help='Skip xatlas UV unwrap (also skips texture + GLB)')
    parser.add_argument('--no-lod',   action='store_true',
                        help='Skip LOD generation')
    parser.add_argument('--no-dxf',   action='store_true',
                        help='Skip DXF export')
    parser.add_argument('--midas',    action='store_true', default=True,
                        help='Use MiDaS neural depth (default: True)')
    parser.add_argument('--no-midas', action='store_false', dest='midas',
                        help='Disable MiDaS and use EDT instead')
    parser.add_argument('--xatlas',   action='store_true',
                        help='Use xatlas UV unwrapping (can shred 2D art)')
    parser.add_argument('--vectorize', action='store_true',
                        help='Automatically vectorize PNG input using Inkscape')
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)

    # -- Resolve input type and paths -------------------------------------------
    input_is_svg = args.image.lower().endswith('.svg')
    image_to_process = args.image

    if args.vectorize and not input_is_svg:
        # Automated Sophisticated Transformation: PNG -> SVG (Numerical)
        print('[masterforge] Vectorizing input PNG for solid 3D data...')
        svg_tmp = os.path.join(args.output, 'vectorized_input.svg')
        try:
            # We assume inkscape is in the PATH or managed dir (handled by backend logic)
            # For the python script, we'll try to find it
            import subprocess
            from masterforge.ingest import find_inkscape
            ink_exe = find_inkscape()
            if ink_exe:
                # Inkscape 1.2+ command for tracing bitmap to path
                subprocess.run([
                    ink_exe, '--batch-process',
                    '--actions=path-trace;export-filename:' + svg_tmp + ';export-do',
                    args.image
                ], check=True, capture_output=True)
                image_to_process = svg_tmp
                input_is_svg = True
                print(f'[masterforge] PNG -> SVG numerical conversion OK: {svg_tmp}')
            else:
                print('[masterforge] Inkscape not found - skipping auto-vectorization')
        except Exception as e:
            print(f'[masterforge] Auto-vectorization failed: {e}')

    if args.stl:
        stl_path = args.stl
        stem     = os.path.splitext(os.path.basename(args.stl))[0]
        out_dir  = os.path.dirname(os.path.abspath(args.stl)) or args.output
        os.makedirs(out_dir, exist_ok=True)
    else:
        stem     = os.path.splitext(os.path.basename(image_to_process))[0]
        out_dir  = args.output
        stl_path = os.path.join(out_dir, f'{stem}.stl')

    uv_path    = os.path.join(out_dir, f'{stem}_uv.npz')
    tex_path   = os.path.join(out_dir, f'{stem}_tex.png')
    glb_path   = os.path.join(out_dir, f'{stem}.glb')
    dxf_path   = os.path.join(out_dir, f'{stem}.dxf')
    zones_path = os.path.join(out_dir, f'{stem}_zones.json')

    print(f'[masterforge] START  type={args.asset_type}  '
          f'input={os.path.basename(image_to_process)} (vector={input_is_svg})')

    # -- 1. Asset config --------------------------------------------------------
    from masterforge.config import load_asset_config
    try:
        asset_config = load_asset_config(args.asset_type)
    except ValueError as e:
        print(f'[masterforge] ERROR: {e}')
        sys.exit(1)

    n_slices = asset_config.get('n_slices', 300)
    min_d    = asset_config.get('min_depth', 0.025)
    min_w    = asset_config.get('min_width', 0.005)

    # -- 2. Ingest - mask & reference image ------------------------------------
    from masterforge.ingest import load_rgba, get_mask, rasterize_svg
    
    # If input is SVG, we need a PNG for MiDaS and Texturing
    if input_is_svg:
        ref_png = os.path.join(out_dir, 'svg_reference.png')
        if rasterize_svg(image_to_process, ref_png):
            image_for_ai = ref_png
        else:
            image_for_ai = args.image # fallback
    else:
        image_for_ai = args.image

    rgba = load_rgba(image_for_ai)
    mask = get_mask(rgba, image_path=image_for_ai)
    print(f'[masterforge] mask: {mask.sum()} fg pixels  '
          f'{rgba.shape[1]}x{rgba.shape[0]}')

    # -- 3. Depth --------------------------------------------------------------
    from masterforge.depth import get_depth_profile, apply_depth_to_profile
    depth_profile, _ = get_depth_profile(
        mask, asset_config,
        image_path=image_for_ai,
        n_slices=n_slices,
        use_midas=args.midas,
    )

    # -- 4. Trace - silhouette (Numerical or Raster) --------------------------
    from masterforge.trace import trace_contour, trace_svg, scanline_profile, smooth_profile
    profile_sm = None
    
    try:
        if input_is_svg:
            # PURE NUMERICAL PIPELINE
            contour, _ = trace_svg(image_to_process)
            print('[masterforge] Using numerical SVG paths for perfect edges')
        else:
            # RASTER TRACING PIPELINE
            contour, _ = trace_contour(mask)
            
        raw        = scanline_profile(contour, n_slices=n_slices)
        profile_sm = smooth_profile(raw)
        print(f'[masterforge] silhouette trace: {len(profile_sm)} slices')
    except Exception as e:
        print(f'[masterforge] silhouette trace failed: {e}')

    if profile_sm is None:
        if args.fallback and os.path.isfile(args.fallback):
            with open(args.fallback, encoding='utf-8') as f:
                raw = json.load(f)
            profile_sm = [[row[0], row[1], row[2]] for row in raw]
            print(f'[masterforge] fallback profile: {len(profile_sm)} slices')
        else:
            print('[masterforge] ERROR: trace failed and no fallback provided')
            sys.exit(1)

    # -- 5. Skeleton - zones + depths + cross-sections -------------------------
    import numpy as np
    from masterforge.skeleton import (
        detect_zones, get_cross_section_types,
        build_zone_graph, zone_graph_to_dict, print_zone_summary,
    )

    widths   = np.array([row[2] - row[1] for row in profile_sm], dtype=np.float32)
    zones    = detect_zones(widths, asset_config)
    depths   = apply_depth_to_profile(
        profile_sm, depth_profile, zones, asset_config, min_depth=min_d
    )
    cs_types = get_cross_section_types(zones, asset_config)

    profile_full = [
        [row[0], row[1], row[2], float(d), str(z), cs]
        for row, d, z, cs in zip(profile_sm, depths, zones, cs_types)
    ]

    try:
        G = build_zone_graph(zones, profile_full)
        print_zone_summary(G)
        with open(zones_path, 'w', encoding='utf-8') as f:
            json.dump(zone_graph_to_dict(G), f, indent=2)
    except ImportError:
        counts = {z: int((zones == z).sum())
                  for z in ('blade', 'guard', 'handle', 'pommel', 'tip')}
        print(f'[masterforge] zones: {counts}')

    # -- 6. Loft - CadQuery OCC mesh -------------------------------------------
    try:
        import cadquery as cq
        from cadquery import exporters
        print(f'[masterforge] CadQuery {cq.__version__}')
    except ImportError:
        print('[masterforge] ERROR: cadquery not installed  '
              'py -3.11 -m pip install cadquery')
        sys.exit(2)

    from masterforge.loft import build_wires, do_loft
    from masterforge.export import export_stl

    wires = build_wires(profile_full, cq, min_width=min_w)
    if len(wires) < 2:
        print(f'[masterforge] ERROR: only {len(wires)} wire(s) - aborting')
        sys.exit(3)

    solid = do_loft(wires, cq)
    if solid is None:
        print('[masterforge] ERROR: loft failed')
        sys.exit(4)

    export_stl(solid, stl_path, cq, exporters)

    # -- 7. UV unwrap - xatlas -------------------------------------------------
    uv_ok = False
    if not args.no_uv:
        try:
            from masterforge.unwrap import unwrap_uv
            unwrap_uv(stl_path, uv_path, use_xatlas=args.xatlas)
            uv_ok = True
        except Exception as e:
            print(f'[masterforge] UV unwrap skipped: {e}')

    # -- 8. Texture bake -------------------------------------------------------
    tex_ok = False
    if uv_ok:
        try:
            from masterforge.texture import bake_texture
            bake_texture(args.image, uv_path, tex_path, output_size=512)
            tex_ok = True
        except Exception as e:
            print(f'[masterforge] texture bake skipped: {e}')

    # -- 9a. GLB export --------------------------------------------------------
    if uv_ok:
        try:
            from masterforge.export import export_glb
            export_glb(uv_path, tex_path if tex_ok else '', glb_path)
        except Exception as e:
            print(f'[masterforge] GLB export skipped: {e}')

    # -- 9b. DXF export --------------------------------------------------------
    if not args.no_dxf:
        try:
            from masterforge.export import export_dxf
            export_dxf(stl_path, dxf_path)
        except Exception as e:
            print(f'[masterforge] DXF export skipped: {e}')

    # -- 9c. LOD generation ----------------------------------------------------
    if not args.no_lod:
        try:
            from masterforge.lod import generate_lods
            generate_lods(stl_path, out_dir, stem)
        except Exception as e:
            print(f'[masterforge] LOD generation skipped: {e}')

    print(f'[masterforge] -- DONE  stl={stl_path} --')


if __name__ == '__main__':
    main()
