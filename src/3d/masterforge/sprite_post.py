"""
sprite_post.py - Post-processing for MasterForge sprite sheets.
Handles normalization, grid packing, and Godot metadata (.tres).
"""

import os
from PIL import Image
import numpy as np

def normalize_frame(image_path: str, output_path: str, size: int = 512):
    """
    Centers the subject and scales it to fit within the frame
    while maintaining a consistent transparent canvas.
    """
    img = Image.open(image_path).convert('RGBA')
    arr = np.array(img)
    alpha = arr[:, :, 3]
    
    # Find bounding box
    ys, xs = np.where(alpha > 0)
    if len(ys) == 0:
        # Empty frame, just resize canvas
        img.resize((size, size), Image.LANCZOS).save(output_path)
        return

    y_min, y_max = ys.min(), ys.max()
    x_min, x_max = xs.min(), xs.max()
    
    # Crop to subject
    cropped = img.crop((x_min, y_min, x_max + 1, y_max + 1))
    
    # Scale to fit (85% of frame size)
    w, h = cropped.size
    scale = (size * 0.85) / max(w, h)
    new_w, new_h = int(w * scale), int(h * scale)
    scaled = cropped.resize((new_w, new_h), Image.LANCZOS)
    
    # Create new canvas and center
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    offset = ((size - new_w) // 2, (size - new_h) // 2)
    canvas.paste(scaled, offset)
    canvas.save(output_path)

def pack_sheet(frame_paths: list, output_path: str, cols: int = 2):
    """
    Packs individual frames into a single grid PNG.
    """
    if not frame_paths: return
    
    frames = [Image.open(p) for p in frame_paths]
    f_w, f_h = frames[0].size
    
    rows = (len(frames) + cols - 1) // cols
    sheet_w = f_w * cols
    sheet_h = f_h * rows
    
    sheet = Image.new('RGBA', (sheet_w, sheet_h), (0, 0, 0, 0))
    
    for i, frame in enumerate(frames):
        c = i % cols
        r = i // cols
        sheet.paste(frame, (c * f_w, r * f_h))
        
    sheet.save(output_path)

def write_godot_metadata(output_path: str, sheet_name: str, frame_count: int, cols: int, size: int):
    """
    Writes a Godot 4 .tres file for automatic SpriteFrames import.
    Sub-resources must be defined BEFORE the [resource] block.
    """
    lines = []
    lines.append(f'[gd_resource type="SpriteFrames" load_steps={frame_count + 2} format=3]')
    lines.append('')
    lines.append(f'[ext_resource type="Texture2D" path="res://{sheet_name}" id="1_tex"]')
    lines.append('')
    
    # 1. Define AtlasTexture sub-resources BEFORE [resource] block
    for i in range(frame_count):
        c = i % cols
        r = i // cols
        lines.append(f'[sub_resource type="AtlasTexture" id="AtlasTexture_{i}"]')
        lines.append(f'atlas = ExtResource("1_tex")')
        lines.append(f'region = Rect2({c * size}, {r * size}, {size}, {size})')
        lines.append('')
    
    # 2. Main [resource] block
    lines.append('[resource]')
    
    # Inline frame list for the animation
    frame_list = ', '.join(
        f'{{"duration": 1.0, "texture": SubResource("AtlasTexture_{i}")}}'
        for i in range(frame_count)
    )
    
    lines.append('animations = [{')
    lines.append(f'"frames": [{frame_list}],')
    lines.append('"loop": true,')
    lines.append('"name": &"default",')
    lines.append('"speed": 5.0')
    lines.append('}]')
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

if __name__ == "__main__":
    import argparse
    import json
    import sys
    
    parser = argparse.ArgumentParser()
    parser.add_argument('--args', help='JSON file containing arguments')
    a = parser.parse_args()
    
    if a.args:
        with open(a.args, encoding='utf-8') as f:
            opts = json.load(f)
        
        action = opts.get('action')
        if action == 'normalize':
            normalize_frame(opts['image_path'], opts['output_path'], size=opts.get('size', 512))
        elif action == 'pack':
            pack_sheet(opts['frame_paths'], opts['output_path'], cols=opts.get('cols', 2))
        elif action == 'metadata':
            write_godot_metadata(
                opts['output_path'], 
                opts['sheet_name'], 
                opts['frame_count'], 
                opts.get('cols', 2), 
                opts.get('size', 512)
            )
        sys.exit(0)
    
    print("Error: No arguments provided")
    sys.exit(1)
