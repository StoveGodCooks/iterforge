"""
export_blend.py — InterForge Blender re-export script

Usage:
  blender --background <blend_file> --python export_blend.py -- <output_glb>

Called automatically when the user saves their .blend file in the full Blender GUI.
InterForge's file watcher detects the save, then runs this script to re-export
the updated mesh as GLB so the in-app viewer refreshes.
"""

import bpy
import sys
import os

# ── Parse CLI args ──────────────────────────────────────────────────────────
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if not args:
    print('[InterForge] ERROR: expected output_glb path as argument')
    sys.exit(1)

output_glb = args[0]
print(f'[InterForge] Re-exporting to {output_glb}')

# ── Export GLB ──────────────────────────────────────────────────────────────
# The .blend file is already loaded because it was passed to blender as argv[1]
os.makedirs(os.path.dirname(output_glb), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=output_glb,
    export_format='GLB',
    export_materials='EXPORT',
    export_textures=True,
    export_apply=True,
    export_cameras=False,
    export_lights=False,
)
print(f'[InterForge] GLB re-exported → {output_glb}')

# ── Re-render preview PNG ────────────────────────────────────────────────────
preview_path = os.path.splitext(output_glb)[0] + '_preview.png'
scene = bpy.context.scene
scene.render.filepath = preview_path
scene.render.resolution_x = 512
scene.render.resolution_y = 512
scene.render.image_settings.file_format = 'PNG'

# Only render if there's a camera in the scene
if scene.camera:
    bpy.ops.render.render(write_still=True)
    print(f'[InterForge] Preview re-rendered → {preview_path}')
else:
    print('[InterForge] No camera in scene, skipping preview render')

print('[InterForge] export_blend.py complete')
