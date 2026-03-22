"""
build_silhouette_gn.py — One-time script to author silhouette_gn.blend

The saved .blend contains a pre-built Geometry Nodes modifier tree:
  Fill Curve (TRIANGLES) → Extrude Mesh → Triangulate Mesh

Expose 'Extrude Depth' (Float, default 0.06) as a group input so
sword_silhouette.py can drive it per-asset without rebuilding the tree.

Run once via:
  blender --background --python src/3d/build_silhouette_gn.py

The resulting silhouette_gn.blend lands in src/3d/templates/.
sword_silhouette.py detects it and appends the node group as a
fallback for complex silhouettes (handles self-intersecting corners
better than the curve's native extrude).
"""

import bpy
import os

# ── Clear ─────────────────────────────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
for blk in list(bpy.data.meshes):    bpy.data.meshes.remove(blk)
for blk in list(bpy.data.node_groups): bpy.data.node_groups.remove(blk)

# ── Node group ────────────────────────────────────────────────────────────────
ng = bpy.data.node_groups.new('SilhouetteGN', 'GeometryNodeTree')

# Interface (Blender 4.x API)
try:
    ng.interface.new_socket('Geometry',     in_out='INPUT',  socket_type='NodeSocketGeometry')
    sock_d = ng.interface.new_socket('Extrude Depth', in_out='INPUT', socket_type='NodeSocketFloat')
    sock_d.default_value = 0.06
    sock_d.min_value     = 0.001
    sock_d.max_value     = 0.5
    ng.interface.new_socket('Geometry',     in_out='OUTPUT', socket_type='NodeSocketGeometry')
    print('[BuildGN] Using Blender 4.x interface API')
except AttributeError:
    # Blender 3.x fallback
    ng.inputs.new('NodeSocketGeometry', 'Geometry')
    inp_d = ng.inputs.new('NodeSocketFloat', 'Extrude Depth')
    inp_d.default_value = 0.06
    ng.outputs.new('NodeSocketGeometry', 'Geometry')
    print('[BuildGN] Using Blender 3.x interface API (fallback)')

n  = ng.nodes
lk = ng.links

# Nodes
grp_in   = n.new('NodeGroupInput');               grp_in.location   = (-600,  0)
fill     = n.new('GeometryNodeFillCurve');         fill.location     = (-400,  0)
extrude  = n.new('GeometryNodeExtrudeMesh');       extrude.location  = (-150,  0)
tri      = n.new('GeometryNodeTriangulateMesh');   tri.location      = ( 100,  0)
grp_out  = n.new('NodeGroupOutput');               grp_out.location  = ( 350,  0)

# Fill curve: TRIANGLES mode avoids large N-gon caps
fill.mode    = 'TRIANGLES'
# Extrude: FACES mode — solid bidirectional extrusion
extrude.mode = 'FACES'

# Links — use index access to avoid socket name fragility across Blender versions
lk.new(grp_in.outputs[0],  fill.inputs[0])        # Geometry → Curve
lk.new(fill.outputs[0],    extrude.inputs[0])      # Mesh → Mesh
lk.new(grp_in.outputs[1],  extrude.inputs[3])      # Extrude Depth → Offset Scale
lk.new(extrude.outputs[0], tri.inputs[0])          # Mesh → Mesh
lk.new(tri.outputs[0],     grp_out.inputs[0])      # Mesh → Geometry

print(f'[BuildGN] Node group created: {len(n)} nodes, {len(list(lk))} links')

# ── Dummy host object (keeps the node group embedded in the .blend) ───────────
dummy_mesh = bpy.data.meshes.new('_GN_Host')
dummy_obj  = bpy.data.objects.new('_GN_Host', dummy_mesh)
bpy.context.collection.objects.link(dummy_obj)

mod = dummy_obj.modifiers.new('SilhouetteGN', 'NODES')
mod.node_group = ng

# ── Save ──────────────────────────────────────────────────────────────────────
script_dir = os.path.dirname(os.path.abspath(__file__))
out_path   = os.path.join(script_dir, 'templates', 'silhouette_gn.blend')
os.makedirs(os.path.dirname(out_path), exist_ok=True)

bpy.ops.wm.save_as_mainfile(filepath=out_path)
print(f'[BuildGN] Saved → {out_path}')
print('[BuildGN] Done ✓')
