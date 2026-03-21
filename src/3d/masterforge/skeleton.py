"""
skeleton.py - zone detection and networkx zone graph.

Two responsibilities:

  1. Zone detection
     Classify each profile slice into a zone label using parameters
     from the asset config JSON.  Fully data-driven - no hardcoded
     values, every threshold comes from assets/<type>.json.

  2. Zone graph (networkx)
     Build a DiGraph of contiguous zone segments ordered from pommel
     to tip.  Nodes carry geometric properties (avg width, depth,
     slice range).  The graph is serialisable to JSON for inspection
     and is the foundation for branching asset types (axe, etc.).
"""

import numpy as np


# -- Zone detection -------------------------------------------------------------

def detect_zones(widths_a: np.ndarray, asset_config: dict) -> np.ndarray:
    """
    Classify each profile slice into a zone label.
    Returns object array of strings: 'blade'|'guard'|'handle'|'pommel'|'tip'
    """
    zone_cfg = asset_config.get('zones', {})
    n_s      = len(widths_a)
    max_w    = max(float(widths_a.max()), 1e-6)
    norm_w   = widths_a / max_w
    zones    = np.full(n_s, 'blade', dtype=object)

    # -- Guard: widest peak in the configured band --------------------------
    g_cfg = zone_cfg.get('guard', {})
    band  = g_cfg.get('band', [0.12, 0.80])
    g_lo  = int(n_s * band[0])
    g_hi  = int(n_s * band[1])
    g_thr = g_cfg.get('threshold', 0.55)
    g_rel = g_cfg.get('relative_threshold', 0.72)

    if g_hi > g_lo:
        sub  = norm_w[g_lo:g_hi]
        peak = int(np.argmax(sub)) + g_lo
        if norm_w[peak] > g_thr:
            thr = norm_w[peak] * g_rel
            i   = peak
            while i > g_lo     and norm_w[i - 1] >= thr: i -= 1
            j   = peak
            while j < g_hi - 1 and norm_w[j + 1] >= thr: j += 1
            zones[i:j + 1] = 'guard'

    # -- Tip: top slices where width collapses -----------------------------
    tip_thr = zone_cfg.get('tip', {}).get('width_threshold', 0.08)
    for i in range(n_s - 1, -1, -1):
        if norm_w[i] < tip_thr:
            zones[i] = 'tip'
        else:
            break

    # -- Pommel: bottom slices wider than handle baseline ------------------
    gpos        = np.where(zones == 'guard')[0]
    g_bottom    = int(gpos.min()) if len(gpos) else n_s
    handle_base = float(np.median(norm_w[:g_bottom])) if g_bottom > 0 else 0.3
    p_cfg       = zone_cfg.get('pommel', {})
    p_mult      = p_cfg.get('handle_multiplier', 1.4)
    p_max       = p_cfg.get('max_band', 0.18)

    for i in range(min(g_bottom, int(n_s * p_max))):
        if norm_w[i] > handle_base * p_mult:
            zones[i] = 'pommel'

    # -- Handle: gap between pommel top and guard bottom -------------------
    ppos  = np.where(zones == 'pommel')[0]
    p_top = int(ppos.max()) + 1 if len(ppos) else 0
    for i in range(p_top, g_bottom):
        if zones[i] == 'blade':
            zones[i] = 'handle'

    return zones


def get_depth_ratios(zones: np.ndarray, asset_config: dict) -> np.ndarray:
    """Depth-to-width scale factors per slice from config (legacy path)."""
    zone_cfg  = asset_config.get('zones', {})
    defaults  = {'blade': 0.08, 'guard': 0.14, 'handle': 0.30,
                 'pommel': 0.48, 'tip': 0.55}
    ratio_map = {z: zone_cfg.get(z, {}).get('depth_ratio', defaults.get(z, 0.1))
                 for z in defaults}
    return np.array([ratio_map.get(str(z), 0.08) for z in zones],
                    dtype=np.float32)


def get_cross_section_types(zones: np.ndarray, asset_config: dict) -> list:
    """Map zone labels to cross-section type strings from config."""
    zone_cfg = asset_config.get('zones', {})
    defaults = {'blade': 'lenticular', 'guard': 'flat',
                'handle': 'octagon',   'pommel': 'octagon', 'tip': 'lenticular'}
    cs_map = {z: zone_cfg.get(z, {}).get('cross_section', defaults.get(z, 'octagon'))
              for z in defaults}
    return [cs_map.get(str(z), 'octagon') for z in zones]


# -- Zone graph (networkx) ------------------------------------------------------

def build_zone_graph(zones: np.ndarray, profile_full: list) -> 'nx.DiGraph':
    """
    Build a directed zone graph from the detected zones and profile.

    Nodes - one per contiguous zone segment, ordered pommel → tip.
    Node properties:
        zone          zone label string
        start_slice   first slice index
        end_slice     last slice index (inclusive)
        slice_count   number of slices in this segment
        avg_width     mean (xr - xl) across segment
        max_width     peak width in segment
        avg_depth     mean depth value across segment

    Edges - directed pommel → tip, one per zone transition.
    Edge properties:
        transition_slice  slice index where zone changes

    Returns nx.DiGraph.  Caller should handle ImportError if networkx
    is not installed (graph is non-critical - pipeline continues without it).
    """
    import networkx as nx

    # -- Find contiguous segments ------------------------------------------
    segments = []
    current  = str(zones[0])
    start    = 0
    for i in range(1, len(zones)):
        if str(zones[i]) != current:
            segments.append((current, start, i - 1))
            current = str(zones[i])
            start   = i
    segments.append((current, start, len(zones) - 1))

    # -- Build graph -------------------------------------------------------
    G = nx.DiGraph()
    G.graph['asset_type'] = profile_full[0][4] if profile_full else 'unknown'
    G.graph['total_slices'] = len(profile_full)

    prev_node = None
    for idx, (zone_type, s_start, s_end) in enumerate(segments):
        slices = profile_full[s_start:s_end + 1]
        widths = [r[2] - r[1] for r in slices]
        depths = [r[3]        for r in slices]

        node_id = f'{zone_type}_{idx}'
        G.add_node(
            node_id,
            zone        = zone_type,
            start_slice = s_start,
            end_slice   = s_end,
            slice_count = s_end - s_start + 1,
            avg_width   = float(np.mean(widths)),
            max_width   = float(np.max(widths)),
            avg_depth   = float(np.mean(depths)),
        )

        if prev_node is not None:
            G.add_edge(prev_node, node_id,
                       transition_slice=s_start)
        prev_node = node_id

    return G


def zone_graph_to_dict(G) -> dict:
    """
    Serialise a zone graph to a plain dict for JSON output.
    Useful for debugging and diagnostics.
    """
    return {
        'nodes': [
            {'id': n, **G.nodes[n]}
            for n in G.nodes
        ],
        'edges': [
            {'from': u, 'to': v, **G.edges[u, v]}
            for u, v in G.edges
        ],
        'graph': dict(G.graph),
    }


def print_zone_summary(G) -> None:
    """Print a compact one-line summary of the zone graph."""
    parts = []
    for node in G.nodes:
        d = G.nodes[node]
        parts.append(
            f"{d['zone']}[{d['slice_count']}slices "
            f"w={d['avg_width']:.3f} d={d['avg_depth']:.3f}]"
        )
    print(f'[masterforge.skeleton] zone graph: {" -> ".join(parts)}')
