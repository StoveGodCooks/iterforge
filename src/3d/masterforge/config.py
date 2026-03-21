"""
config.py - load per-asset-type JSON configs from assets/ directory.
"""
import os
import json

ASSETS_DIR = os.path.join(os.path.dirname(__file__), 'assets')


def load_asset_config(asset_type: str) -> dict:
    """Load JSON config for an asset type. Raises ValueError if not found."""
    path = os.path.join(ASSETS_DIR, f'{asset_type}.json')
    if not os.path.exists(path):
        available = [f[:-5] for f in os.listdir(ASSETS_DIR) if f.endswith('.json')]
        raise ValueError(
            f'No config for asset type "{asset_type}". '
            f'Available: {available}'
        )
    with open(path, encoding='utf-8') as f:
        return json.load(f)
