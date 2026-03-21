"""
IterForge — Background Removal via rembg
Usage: python remove_bg.py <input_path> <output_path> [--white]
  --white  : composite on white background (default: transparent PNG)
"""
import sys
import argparse
from pathlib import Path
from PIL import Image
import io

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('input')
    parser.add_argument('output')
    parser.add_argument('--white', action='store_true', help='Composite on white bg instead of transparent')
    args = parser.parse_args()

    from rembg import remove, new_session

    # BiRefNet-general gives significantly better edge quality than U2Net
    # especially on thin elements (blades, hair, fingers, staff tips).
    # Model auto-downloads ~600MB to ~/.u2net/ on first run.
    session = new_session('birefnet-general')

    with open(args.input, 'rb') as f:
        data = f.read()

    result = remove(data, session=session)
    img = Image.open(io.BytesIO(result)).convert('RGBA')

    if args.white:
        bg = Image.new('RGBA', img.size, (255, 255, 255, 255))
        bg.paste(img, mask=img.split()[3])
        bg.convert('RGB').save(args.output, 'PNG')
    else:
        img.save(args.output, 'PNG')

    print(f'[rembg] saved: {args.output}')

if __name__ == '__main__':
    main()
