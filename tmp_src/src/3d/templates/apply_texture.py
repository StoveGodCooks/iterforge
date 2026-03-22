"""
apply_texture.py — InterForge Blender headless texture application script

Usage:
  blender --background --python apply_texture.py -- <mesh_type> <texture_path> <output_glb> <output_blend>

mesh_type values:
  plane      — subdivided plane (floor tile, decal, UI element)
  cube       — box UV cube (crate, building block)
  cylinder   — cylindrical UV cylinder (barrel, pillar, tree trunk)
  sphere     — sphere UV (rock, orb)
  custom:<path>  — import a custom GLB/FBX/OBJ file from <path>

The script:
  1. Clears the default Blender scene
  2. Generates or imports the base mesh
  3. Smart UV unwraps it
  4. Creates a material: TexImage → Principled BSDF → Output
  5. Exports GLB to output_glb
  6. Saves .blend to output_blend (for "Edit in Blender" later)
  7. Renders a 512x512 EEVEE preview PNG (same path as output_glb with .png extension)
"""

import bpy
import sys
import os
import math

def rotate_uv(u, v, degrees):
    """Rotate UV coordinates around center (0.5, 0.5)"""
    if degrees == 0:
        return (u, v)
    import math
    rad = math.radians(degrees)
    uc = u - 0.5
    vc = v - 0.5
    u_rot = uc * math.cos(rad) - vc * math.sin(rad)
    v_rot = uc * math.sin(rad) + vc * math.cos(rad)
    return (max(0.0, min(1.0, u_rot + 0.5)),
            max(0.0, min(1.0, v_rot + 0.5)))

# ── Parse CLI args ──────────────────────────────────────────────────────────
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(args) < 4:
    print('[InterForge] ERROR: expected 4 args: mesh_type texture_path output_glb output_blend')
    sys.exit(1)

mesh_type, texture_path, output_glb, output_blend = args[0], args[1], args[2], args[3]
subdivision_level = int(args[4]) if len(args) > 4 else 1
rotation_deg = float(args[5]) if len(args) > 5 else 0.0

print(f'[InterForge] mesh_type={mesh_type}  texture={texture_path}')
print(f'[InterForge] output_glb={output_glb}  output_blend={output_blend}')

# ── Clear default scene ─────────────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

# Remove default collections clutter
for block in bpy.data.meshes:     bpy.data.meshes.remove(block)
for block in bpy.data.materials:  bpy.data.materials.remove(block)
for block in bpy.data.images:     bpy.data.images.remove(block)

# ── Create / import mesh ────────────────────────────────────────────────────
def make_plane(rotation_deg=0):
    bpy.ops.mesh.primitive_plane_add(size=2, enter_editmode=False, location=(0, 0, 0))
    obj = bpy.context.active_object
    # Subdivide for better texture resolution sampling
    bpy.ops.object.editmode_toggle()
    bpy.ops.mesh.subdivide(number_cuts=4)
    bpy.ops.object.editmode_toggle()
    # Smart UV Project
    bpy.ops.object.editmode_toggle()
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    bpy.ops.object.editmode_toggle()
    return obj

def make_cube(rotation_deg=0):
    bpy.ops.mesh.primitive_cube_add(size=2, enter_editmode=False, location=(0, 0, 0))
    obj = bpy.context.active_object
    bpy.ops.object.editmode_toggle()
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=1.0)
    bpy.ops.object.editmode_toggle()
    bpy.ops.object.shade_smooth()
    return obj

def make_cylinder(rotation_deg=0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=1, depth=2, location=(0, 0, 0))
    obj = bpy.context.active_object
    bpy.ops.object.editmode_toggle()
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cylinder_project(direction='ALIGN_TO_OBJECT', align='POLAR_ZX',
                                  radius=1.0, correct_aspect=True, clip_to_bounds=False, scale_to_bounds=True)
    bpy.ops.object.editmode_toggle()
    bpy.ops.object.shade_smooth()
    return obj

def make_sphere(rotation_deg=0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1, location=(0, 0, 0))
    obj = bpy.context.active_object
    bpy.ops.object.editmode_toggle()
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.sphere_project(direction='ALIGN_TO_OBJECT', align='POLAR_ZX',
                               correct_aspect=True, clip_to_bounds=False, scale_to_bounds=True)
    bpy.ops.object.editmode_toggle()
    bpy.ops.object.shade_smooth()
    return obj

def make_torus(rotation_deg=0):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=1.0, minor_radius=0.35,
        major_segments=48, minor_segments=16,
        location=(0, 0, 0)
    )
    obj = bpy.context.active_object
    bpy.ops.object.editmode_toggle()
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    bpy.ops.object.editmode_toggle()
    bpy.ops.object.shade_smooth()
    return obj

def make_cone(rotation_deg=0):
    bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=1, radius2=0, depth=2, location=(0, 0, 0))
    obj = bpy.context.active_object
    bpy.ops.object.editmode_toggle()
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    bpy.ops.object.editmode_toggle()
    bpy.ops.object.shade_smooth()
    return obj

def make_capsule(rotation_deg=0):
    # Capsule = cylinder + hemisphere caps
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.6, depth=1.5, location=(0, 0, 0))
    obj = bpy.context.active_object
    bpy.ops.object.editmode_toggle()
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    bpy.ops.object.editmode_toggle()
    bpy.ops.object.shade_smooth()
    return obj

def make_terrain(rotation_deg=0):
    # Low-poly terrain: subdivided plane with displacement noise
    bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, 0))
    obj = bpy.context.active_object
    bpy.ops.object.editmode_toggle()
    bpy.ops.mesh.subdivide(number_cuts=12)
    bpy.ops.object.editmode_toggle()
    # Add a displacement modifier with procedural noise texture
    noise_tex = bpy.data.textures.new('TerrainNoise', type='CLOUDS')
    noise_tex.noise_scale = 1.5
    disp_mod = obj.modifiers.new('TerrainDisplace', type='DISPLACE')
    disp_mod.texture = noise_tex
    disp_mod.strength = 0.4
    bpy.ops.object.modifier_apply(modifier='TerrainDisplace')
    bpy.ops.object.editmode_toggle()
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    bpy.ops.object.editmode_toggle()
    return obj

def make_armor(rotation_deg=0):
    # Breastplate — icosphere squashed into torso silhouette
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.scale = (0.85, 0.55, 1.1)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.editmode_toggle()
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    bpy.ops.object.editmode_toggle()
    return obj

def make_utility(rotation_deg=0):
    # Potion flask — cylinder body + neck + cork
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.5, depth=1.0, location=(0, 0, 0))
    body = bpy.context.active_object
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.18, depth=0.45, location=(0, 0, 0.72))
    neck = bpy.context.active_object
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.22, location=(0, 0, 1.0))
    cork = bpy.context.active_object
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    neck.select_set(True)
    cork.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    obj = bpy.context.active_object
    bpy.ops.object.editmode_toggle()
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    bpy.ops.object.editmode_toggle()
    return obj

def make_hero(rotation_deg=0):
    # Humanoid — torso + head + arms + legs joined
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.35, depth=1.0, location=(0, 0, 0.5))
    torso = bpy.context.active_object
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.3, location=(0, 0, 1.45))
    head = bpy.context.active_object
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.11, depth=0.8, location=(-0.52, 0, 0.5))
    larm = bpy.context.active_object
    larm.rotation_euler = (0, 0.28, 0)
    bpy.ops.object.transform_apply(rotation=True)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.11, depth=0.8, location=(0.52, 0, 0.5))
    rarm = bpy.context.active_object
    rarm.rotation_euler = (0, -0.28, 0)
    bpy.ops.object.transform_apply(rotation=True)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.14, depth=1.0, location=(-0.18, 0, -0.5))
    lleg = bpy.context.active_object
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.14, depth=1.0, location=(0.18, 0, -0.5))
    rleg = bpy.context.active_object
    bpy.ops.object.select_all(action='DESELECT')
    for part in [torso, head, larm, rarm, lleg, rleg]:
        part.select_set(True)
    bpy.context.view_layer.objects.active = torso
    bpy.ops.object.join()
    obj = bpy.context.active_object
    bpy.ops.object.editmode_toggle()
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    bpy.ops.object.editmode_toggle()
    return obj

def import_custom(filepath):
    ext = os.path.splitext(filepath)[1].lower()
    if ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=filepath)
    elif ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=filepath)
    elif ext == '.obj':
        bpy.ops.import_scene.obj(filepath=filepath)
    else:
        raise ValueError(f'Unsupported mesh format: {ext}')
    imported = [o for o in bpy.context.selected_objects if o.type == 'MESH']
    if not imported:
        raise ValueError(f'No mesh found in imported file: {filepath}')
    return imported[0]

# Dispatch to mesh builder
if mesh_type == 'plane':
    mesh_obj = make_plane(rotation_deg=rotation_deg)
elif mesh_type == 'cube':
    mesh_obj = make_cube(rotation_deg=rotation_deg)
elif mesh_type == 'cylinder':
    mesh_obj = make_cylinder(rotation_deg=rotation_deg)
elif mesh_type == 'sphere':
    mesh_obj = make_sphere(rotation_deg=rotation_deg)
elif mesh_type == 'torus':
    mesh_obj = make_torus(rotation_deg=rotation_deg)
elif mesh_type == 'cone':
    mesh_obj = make_cone(rotation_deg=rotation_deg)
elif mesh_type == 'capsule':
    mesh_obj = make_capsule(rotation_deg=rotation_deg)
elif mesh_type == 'terrain':
    mesh_obj = make_terrain(rotation_deg=rotation_deg)
elif mesh_type == 'armor':
    mesh_obj = make_armor(rotation_deg=rotation_deg)
elif mesh_type == 'utility':
    mesh_obj = make_utility(rotation_deg=rotation_deg)
elif mesh_type == 'hero':
    mesh_obj = make_hero(rotation_deg=rotation_deg)
elif mesh_type.startswith('custom:'):
    custom_path = mesh_type[len('custom:'):]
    mesh_obj = import_custom(custom_path)
else:
    print(f'[InterForge] Unknown mesh_type "{mesh_type}", defaulting to plane')
    mesh_obj = make_plane(rotation_deg=rotation_deg)

bpy.context.view_layer.objects.active = mesh_obj

# ── Optional subdivision modifier ───────────────────────────────────────────
if subdivision_level > 0 and mesh_type not in ('torus', 'terrain', 'armor'):
    subsurf = mesh_obj.modifiers.new('Subdivision', type='SUBSURF')
    subsurf.levels = subdivision_level
    subsurf.render_levels = subdivision_level
    bpy.ops.object.modifier_apply(modifier='Subdivision')

# ── Apply texture material ──────────────────────────────────────────────────
mat = bpy.data.materials.new(name='InterForgeMat')
mat.use_nodes = True
nodes = mat.node_tree.nodes
links = mat.node_tree.links

# Clear default nodes
nodes.clear()

# Build node tree: TexImage → Principled BSDF → Material Output
tex_node  = nodes.new('ShaderNodeTexImage')
bsdf_node = nodes.new('ShaderNodeBsdfPrincipled')
out_node  = nodes.new('ShaderNodeOutputMaterial')

# Load texture image — normalise path separators for Windows
texture_path_norm = texture_path.replace('\\', '/')
if not os.path.isfile(texture_path_norm):
    print(f'[InterForge] ERROR: texture not found at {texture_path_norm}')
    sys.exit(1)
img = bpy.data.images.load(texture_path_norm)
img.colorspace_settings.name = 'sRGB'
tex_node.image = img

# Position nodes nicely (purely cosmetic for Blender GUI view)
tex_node.location  = (-400, 200)
bsdf_node.location = (0, 200)
out_node.location  = (400, 200)

# Connect: Color → Base Color, BSDF → Surface
links.new(tex_node.outputs['Color'],  bsdf_node.inputs['Base Color'])
links.new(bsdf_node.outputs['BSDF'],  out_node.inputs['Surface'])

# Roughness — game sprites look better with slight roughness
bsdf_node.inputs['Roughness'].default_value = 0.7
spec_input = bsdf_node.inputs.get('Specular IOR Level') or bsdf_node.inputs.get('Specular')
if spec_input:
    spec_input.default_value = 0.1

# Apply material to mesh
if mesh_obj.data.materials:
    mesh_obj.data.materials[0] = mat
else:
    mesh_obj.data.materials.append(mat)

# ── Set up scene for EEVEE preview render ───────────────────────────────────
scene = bpy.context.scene
# Blender 4.x uses BLENDER_EEVEE_NEXT; 3.x used BLENDER_EEVEE
try:
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
except TypeError:
    scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 512
scene.render.resolution_y = 512
scene.render.resolution_percentage = 100
scene.render.film_transparent = False

# White world background
world = bpy.data.worlds.new('World')
world.use_nodes = True
bg_node = world.node_tree.nodes.get('Background')
if bg_node:
    bg_node.inputs['Color'].default_value = (1.0, 1.0, 1.0, 1.0)
    bg_node.inputs['Strength'].default_value = 1.0
scene.world = world

# 3/4 angle camera — good for showing 3D structure
cam_data = bpy.data.cameras.new('Camera')
cam_obj  = bpy.data.objects.new('Camera', cam_data)
bpy.context.collection.objects.link(cam_obj)
scene.camera = cam_obj
cam_data.type = 'PERSP'
cam_data.lens = 50

# Position at isometric-ish 3/4 angle
cam_obj.location = (3.0, -3.0, 3.0)
cam_obj.rotation_euler = (math.radians(54.7), 0, math.radians(45))

# Key light
light_data = bpy.data.lights.new('KeyLight', type='SUN')
light_data.energy = 3.0
light_obj  = bpy.data.objects.new('KeyLight', light_data)
bpy.context.collection.objects.link(light_obj)
light_obj.location = (5, -5, 8)
light_obj.rotation_euler = (math.radians(30), 0, math.radians(30))

# Fill light
fill_data = bpy.data.lights.new('FillLight', type='AREA')
fill_data.energy = 50.0
fill_obj  = bpy.data.objects.new('FillLight', fill_data)
bpy.context.collection.objects.link(fill_obj)
fill_obj.location = (-4, 4, 4)

# Preview output path: same as GLB but .png
preview_path = os.path.splitext(output_glb)[0] + '_preview.png'
scene.render.filepath = preview_path
scene.render.image_settings.file_format = 'PNG'

# Render preview
bpy.ops.render.render(write_still=True)
print(f'[InterForge] Preview rendered → {preview_path}')

# ── Export GLB ──────────────────────────────────────────────────────────────
os.makedirs(os.path.dirname(output_glb), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=output_glb,
    export_format='GLB',
    export_materials='EXPORT',
    export_apply=True,
    export_cameras=False,
    export_lights=False,
)
print(f'[InterForge] GLB exported → {output_glb}')

# ── Save .blend for "Edit in Blender" ───────────────────────────────────────
os.makedirs(os.path.dirname(output_blend), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=output_blend)
print(f'[InterForge] .blend saved → {output_blend}')

print('[InterForge] apply_texture.py complete')
