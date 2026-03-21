"""
sword_cad.py — compatibility shim.

Delegates to masterforge/run.py while maintaining the original interface
so sword_silhouette.py Stage 5.6 continues to work without modification.

Original interface:
  python sword_cad.py <image_path> <profile_fallback.json> <output.stl>
"""

import sys
import os
import subprocess

_here   = os.path.dirname(os.path.abspath(__file__))
_run_py = os.path.normpath(
    os.path.join(_here, '..', 'masterforge', 'run.py')
)

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print('Usage: sword_cad.py <image_path> <profile_fallback.json> <output.stl>')
        sys.exit(1)

    image_path = sys.argv[1]
    fallback   = sys.argv[2]
    output_stl = sys.argv[3]

    result = subprocess.run(
        [
            sys.executable, _run_py,
            image_path,
            '--type',     'sword',
            '--stl',      output_stl,
            '--fallback', fallback,
            '--no-uv',                  # UV handled separately in Phase 3+
        ],
        check=False,
    )
    sys.exit(result.returncode)
