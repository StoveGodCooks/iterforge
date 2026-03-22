"""
loft.py - cross-section geometry and CadQuery OCC loft.

Cross-section types:
  lenticular - blade / tip  (double-bevel diamond profile)
  flat       - guard        (thin wide profile, minimal Z depth)
  octagon    - handle / pommel (regular 8-sided prism)
"""

import math


def xz_ring(y: float, xl: float, xr: float,
            depth: float, cross_section: str) -> list:
    """
    Build a dynamic 32-vertex adaptive cross-section ring.
    
    Unchained version: Instead of hardcoded diamonds/octagons, it builds
    an adaptive ellipsoid that honors the specific 'depth' (Z) and 
    'width' (xl/xr) found in the artwork for this exact slice.
    """
    cx = (xl + xr) * 0.5
    hw = max((xr - xl) * 0.5, 1e-6)
    rz = max(depth * 0.5, 1e-6)
    N  = 32  # High resolution for smooth surfaces

    # Dynamic Anatomy: Vary the sharpness based on the zone
    # lenticular (blade) -> 1.1 (razor sharp)
    # flat (guard)       -> 1.8 (solid/machined)
    # octagon (handle)   -> 2.2 (ergonomic/round)
    n_map = {
        'lenticular': 1.1,
        'flat':       1.8,
        'octagon':    2.2
    }
    n = n_map.get(cross_section, 1.4) 

    pts_xz = []
    for i in range(N):
        angle = i * 2.0 * math.pi / N
        cos_a = math.cos(angle)
        sin_a = math.sin(angle)
        
        x = hw * (abs(cos_a)**(2/n)) * math.copysign(1, cos_a)
        z = rz * (abs(sin_a)**(2/n)) * math.copysign(1, sin_a)
        
        pts_xz.append((cx + x, z))

    return [(x, float(y), z) for x, z in pts_xz]


def build_wires(profile_full: list, cq, min_width: float = 0.005) -> list:
    """
    Build CadQuery Wire objects using every slice for high resolution.
    Uses makeSpline for smooth curved surfaces.
    """
    if not profile_full:
        print('[masterforge.loft] ERROR: profile_full is empty')
        return []

    wires   = []
    skipped = 0

    for entry in profile_full:
        try:
            y, xl, xr, depth, zone, cs = entry
            width = xr - xl
            
            # Skip slices that are too thin to avoid degenerate geometry
            if width < min_width:
                skipped += 1
                continue
                
            pts = xz_ring(y, xl, xr, depth, cs)
            vecs = [cq.Vector(vx, vy, vz) for vx, vy, vz in pts]
            
            # periodic=True ensures the spline closes smoothly without a seam
            wire = cq.Wire.makeSpline(vecs, periodic=True)
            wires.append(wire)
            
        except Exception as e:
            # Log specific slice failure but continue building others
            # Often one bad slice shouldn't kill the whole mesh
            y_val = entry[0] if entry else 0
            print(f'[masterforge.loft] wire error at y={y_val:.4f}: {e}')
            skipped += 1

    print(f'[masterforge.loft] {len(profile_full)} slices -> '
          f'{len(wires)} wires ({skipped} skipped)')
          
    if len(wires) < 2 and len(profile_full) > 2:
        print(f'[masterforge.loft] WARNING: extreme skip rate! '
              f'Check if min_width={min_width} is too aggressive.')
              
    return wires


def do_loft(wires: list, cq):
    """
    Loft wires into a solid. Tries ruled=False first, then ruled=True.
    Returns cq.Solid or None on failure.
    """
    for ruled in (False, True):
        try:
            solid = cq.Solid.makeLoft(wires, ruled=ruled)
            print(f'[masterforge.loft] loft OK (ruled={ruled})')
            return solid
        except Exception as e:
            print(f'[masterforge.loft] loft ruled={ruled} failed: {e}')
    return None
