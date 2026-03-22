"""
sword_asset.py — Professional sword 3D asset builder for InterForge

Pipeline:
  1. Read texture → aspect ratio → scale sword proportions to match
  2. Build geometrically accurate sword (blade, guard, handle, pommel)
  3. UV skin: front-face projection maps 2D art directly onto 3D front face
  4. PBR material: metallic=0.85, roughness=0.20 — polished fantasy sword
  5. Dramatic 3-point studio lighting
  6. Render tall preview PNG (512x1024)
  7. Export game-ready GLB + save .blend

Usage:
  blender --background --python sword_asset.py -- <texture_path> <output_glb> <output_blend>
"""

import bpy
import bmesh
import sys
import os
import math

# ── Args ──────────────────────────────────────────────────────────────────────
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(args) < 3:
    print('[SwordAsset] USAGE: -- <texture_path> <output_glb> <output_blend>')
    sys.exit(1)

texture_path  = args[0].replace('\\', '/')
output_glb    = args[1]
output_blend  = args[2]
# Optional 4th arg lets the route specify where the preview PNG should land.
# Falls back to alongside the GLB if not provided.
output_preview = args[3].replace('\\', '/') if len(args) > 3 else None

print(f'[SwordAsset] texture  = {texture_path}')
print(f'[SwordAsset] glb      = {output_glb}')
print(f'[SwordAsset] blend    = {output_blend}')

# ── Clear scene ───────────────────────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
for blk in list(bpy.data.meshes):    bpy.data.meshes.remove(blk)
for blk in list(bpy.data.materials): bpy.data.materials.remove(blk)
for blk in list(bpy.data.images):    bpy.data.images.remove(blk)
for blk in list(bpy.data.lights):    bpy.data.lights.remove(blk)
for blk in list(bpy.data.cameras):   bpy.data.cameras.remove(blk)

# ── Load texture + read dimensions ────────────────────────────────────────────
if not os.path.isfile(texture_path):
    print(f'[SwordAsset] ERROR: texture not found: {texture_path}')
    sys.exit(1)

img = bpy.data.images.load(texture_path)
img.colorspace_settings.name = 'sRGB'
iw, ih = img.size
aspect = ih / max(iw, 1)   # how tall the image is relative to its width
print(f'[SwordAsset] image {iw}×{ih}  aspect={aspect:.3f}')

# ── Sword proportions (based on image aspect ratio) ───────────────────────────
# Total height matches image aspect (width = 1 unit, height = aspect units)
# We normalise to H = 2.0 Blender units total sword height.
H = 2.0

BLADE_LEN   = H * 0.630
GUARD_H     = H * 0.046
HANDLE_LEN  = H * 0.220
POMMEL_H    = H * 0.065  # remaining goes here: ~H * (1 - 0.63 - 0.046 - 0.22) = 0.104, split

BW = H * 0.085   # blade width at base
BT = H * 0.018   # blade thickness (thin!)
GW = H * 0.280   # guard cross span
GT = H * 0.030   # guard thickness
HR = H * 0.027   # handle cylinder radius
PR = H * 0.053   # pommel sphere radius

# Z positions — sword stands along Z axis, centered at origin
total = BLADE_LEN + GUARD_H + HANDLE_LEN + POMMEL_H
z0 = -total / 2          # pommel bottom
z1 = z0 + POMMEL_H       # pommel top / handle bottom
z2 = z1 + HANDLE_LEN     # handle top / guard bottom
z3 = z2 + GUARD_H        # guard top / blade base
z4 = z3 + BLADE_LEN      # blade tip

print(f'[SwordAsset] z0={z0:.3f}  z1={z1:.3f}  z2={z2:.3f}  z3={z3:.3f}  z4={z4:.3f}')

# ── Build mesh parts ──────────────────────────────────────────────────────────

def apply_transforms(obj):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# BLADE — tapered box built with bmesh for precise control
blade_data = bpy.data.meshes.new('Blade')
blade_obj  = bpy.data.objects.new('Blade', blade_data)
bpy.context.collection.objects.link(blade_obj)

bm = bmesh.new()
uv_layer = bm.loops.layers.uv.new('UVMap')

# Five cross-section rings from base to tip
blade_rings_spec = [
    (z3,                    BW,        BT),
    (z3 + BLADE_LEN*0.28,  BW*0.73,  BT*0.75),
    (z3 + BLADE_LEN*0.55,  BW*0.46,  BT*0.50),
    (z3 + BLADE_LEN*0.79,  BW*0.18,  BT*0.25),
    (z4,                    0.0025,   0.0025),   # tip — near-point
]

def rect_ring(bm, w, d, z):
    hw, hd = w / 2, d / 2
    # Order: front-left, front-right, back-right, back-left
    return [
        bm.verts.new((-hw, -hd, z)),
        bm.verts.new(( hw, -hd, z)),
        bm.verts.new(( hw,  hd, z)),
        bm.verts.new((-hw,  hd, z)),
    ]

rings = []
for z, w, d in blade_rings_spec:
    rings.append(rect_ring(bm, w, d, z))

# Bridge adjacent rings with quad faces
for i in range(len(rings) - 1):
    lo, hi = rings[i], rings[i + 1]
    n = len(lo)
    for j in range(n):
        k = (j + 1) % n
        try:
            bm.faces.new([lo[j], lo[k], hi[k], hi[j]])
        except Exception:
            pass  # degenerate at tip — skip

# Bottom cap (blade base, open side toward guard)
try:
    bm.faces.new([rings[0][3], rings[0][2], rings[0][1], rings[0][0]])
except Exception:
    pass

bm.verts.ensure_lookup_table()
bm.normal_update()

# ── UV: front-face projection ─────────────────────────────────────────────────
# Map the 2D sword art onto the 3D front face:
#   U = normalised X within blade width range
#   V = normalised Z within full sword height
# Side faces (normals in X) get a thin edge strip (U near 0 or 1)
# Back faces get mirrored front projection

X_MIN = -GW / 2   # use guard width as reference (widest part)
X_MAX =  GW / 2
Z_MIN = z0        # full sword range
Z_MAX = z4

def front_uv(vx, vz):
    u = (vx - X_MIN) / (X_MAX - X_MIN)
    v = (vz - Z_MIN) / (Z_MAX - Z_MIN)
    return (max(0.0, min(1.0, u)), max(0.0, min(1.0, v)))

bm.faces.ensure_lookup_table()
for face in bm.faces:
    nx = face.normal.x
    ny = face.normal.y
    abs_nx = abs(nx)
    abs_ny = abs(ny)

    for loop in face.loops:
        vx = loop.vert.co.x
        vz = loop.vert.co.z
        vy = loop.vert.co.y

        if abs_ny > 0.3:
            # Front or back face — project straight from front
            u, v = front_uv(vx, vz)
        elif abs_nx > 0.4:
            # Left/right thin edge — pin to a thin vertical strip
            u = 0.02 if nx < 0 else 0.98
            v = (vz - Z_MIN) / (Z_MAX - Z_MIN)
            v = max(0.0, min(1.0, v))
        else:
            # Horizontal cap (top/bottom) — use X,Y
            u, v = front_uv(vx, vz)

        loop[uv_layer].uv = (u, v)

bm.to_mesh(blade_data)
bm.free()

for poly in blade_data.polygons:
    poly.use_smooth = True

# GUARD — flat box
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, (z2 + z3) / 2))
guard = bpy.context.active_object
guard.name = 'Guard'
guard.scale = (GW, GT, GUARD_H)
apply_transforms(guard)

# HANDLE — 12-sided cylinder
bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=HR, depth=HANDLE_LEN, location=(0, 0, (z1 + z2) / 2))
handle = bpy.context.active_object
handle.name = 'Handle'
apply_transforms(handle)

# POMMEL — slightly flattened sphere
bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=10, radius=PR, location=(0, 0, (z0 + z1) / 2))
pommel = bpy.context.active_object
pommel.name = 'Pommel'
pommel.scale.z = POMMEL_H / (2 * PR) * 0.8   # flatten slightly
apply_transforms(pommel)

# Smooth all parts
for obj_name in ['Guard', 'Handle', 'Pommel']:
    o = bpy.data.objects[obj_name]
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.shade_smooth()

# ── Join all parts into one mesh ──────────────────────────────────────────────
bpy.ops.object.select_all(action='DESELECT')
for o in [blade_obj, guard, handle, pommel]:
    o.select_set(True)
bpy.context.view_layer.objects.active = blade_obj
bpy.ops.object.join()
sword = bpy.context.active_object
sword.name = 'Sword'

# Recalculate normals consistently
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')

# ── PBR metallic material ─────────────────────────────────────────────────────
mat   = bpy.data.materials.new('SwordMat_PBR')
mat.use_nodes = True
nodes = mat.node_tree.nodes
links = mat.node_tree.links
nodes.clear()

# Node layout
out_node  = nodes.new('ShaderNodeOutputMaterial')
bsdf_node = nodes.new('ShaderNodeBsdfPrincipled')
tex_node  = nodes.new('ShaderNodeTexImage')
uv_node   = nodes.new('ShaderNodeUVMap')

out_node.location  = (500, 200)
bsdf_node.location = (200, 200)
tex_node.location  = (-200, 200)
uv_node.location   = (-500, 200)

tex_node.image    = img
uv_node.uv_map    = 'UVMap'

# Sword = polished metal — high metallic, low roughness
bsdf_node.inputs['Metallic'].default_value  = 0.85
bsdf_node.inputs['Roughness'].default_value = 0.20

# Specular — handle both Blender 3.x and 4.x node names
for spec_name in ('Specular IOR Level', 'Specular'):
    spec_in = bsdf_node.inputs.get(spec_name)
    if spec_in:
        spec_in.default_value = 0.85
        break

links.new(uv_node.outputs['UV'],          tex_node.inputs['Vector'])
links.new(tex_node.outputs['Color'],      bsdf_node.inputs['Base Color'])
links.new(bsdf_node.outputs['BSDF'],      out_node.inputs['Surface'])

if sword.data.materials:
    sword.data.materials[0] = mat
else:
    sword.data.materials.append(mat)

# ── Scene: render setup ───────────────────────────────────────────────────────
scene = bpy.context.scene

# Cycles CPU works headless on Windows without a display.
# EEVEE requires a GPU/display context and silently fails in --background mode.
scene.render.engine = 'CYCLES'
scene.cycles.device  = 'CPU'
scene.cycles.samples = 48    # fast enough for a preview, good quality
scene.cycles.use_denoising = True

# Tall preview to match sword proportions
scene.render.resolution_x          = 512
scene.render.resolution_y          = 1024
scene.render.resolution_percentage = 100
scene.render.film_transparent       = False

# Dark studio background
world = bpy.data.worlds.new('StudioWorld')
world.use_nodes = True
bg_node = world.node_tree.nodes.get('Background')
if bg_node:
    bg_node.inputs['Color'].default_value    = (0.02, 0.02, 0.04, 1.0)  # near-black blue
    bg_node.inputs['Strength'].default_value = 0.05
scene.world = world

# Camera — orthographic front view, tight on sword
cam_data = bpy.data.cameras.new('Camera')
cam_obj  = bpy.data.objects.new('Camera', cam_data)
bpy.context.collection.objects.link(cam_obj)
scene.camera   = cam_obj
cam_data.type  = 'ORTHO'
cam_data.ortho_scale = H * 1.15   # slight padding

cam_obj.location       = (0, -8, 0)
cam_obj.rotation_euler = (math.radians(90), 0, 0)   # front orthographic

# Key light — warm from front-right, high
key_d = bpy.data.lights.new('Key', type='AREA')
key_d.energy = 500
key_d.size   = 2.5
key_d.color  = (1.0, 0.95, 0.85)    # warm white
key_o = bpy.data.objects.new('Key', key_d)
bpy.context.collection.objects.link(key_o)
key_o.location       = (2.5, -4, 3.5)
key_o.rotation_euler = (math.radians(45), 0, math.radians(25))

# Rim light — cool blue from behind (magic/fantasy glow)
rim_d = bpy.data.lights.new('Rim', type='SPOT')
rim_d.energy     = 300
rim_d.spot_size  = math.radians(60)
rim_d.color      = (0.25, 0.45, 1.0)    # magical blue
rim_o = bpy.data.objects.new('Rim', rim_d)
bpy.context.collection.objects.link(rim_o)
rim_o.location       = (-1.5, 4, 1)
rim_o.rotation_euler = (math.radians(-60), 0, math.radians(180))

# Fill light — soft gold from left
fill_d = bpy.data.lights.new('Fill', type='AREA')
fill_d.energy = 120
fill_d.size   = 3.0
fill_d.color  = (1.0, 0.85, 0.6)    # warm gold
fill_o = bpy.data.objects.new('Fill', fill_d)
bpy.context.collection.objects.link(fill_o)
fill_o.location = (-3, -2, 0)

# ── Render preview ────────────────────────────────────────────────────────────
preview_path = output_preview if output_preview else (os.path.splitext(output_glb)[0] + '_preview.png')
os.makedirs(os.path.dirname(preview_path), exist_ok=True)
os.makedirs(os.path.dirname(output_glb), exist_ok=True)
scene.render.filepath = preview_path
scene.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print(f'[SwordAsset] preview → {preview_path}')

# ── Export GLB ────────────────────────────────────────────────────────────────
bpy.context.view_layer.objects.active = sword
bpy.ops.object.select_all(action='DESELECT')
sword.select_set(True)

bpy.ops.export_scene.gltf(
    filepath=output_glb,
    export_format='GLB',
    export_materials='EXPORT',
    export_apply=True,
    use_selection=True,
    export_cameras=False,
    export_lights=False,
)
print(f'[SwordAsset] GLB     → {output_glb}')

# ── Save .blend ───────────────────────────────────────────────────────────────
os.makedirs(os.path.dirname(output_blend), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=output_blend)
print(f'[SwordAsset] blend   → {output_blend}')

print('[SwordAsset] Done ✓')
