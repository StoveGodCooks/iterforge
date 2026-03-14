# Godot Setup — IterForge Plugin Installation

## Requirements

- Godot 4.0 or later (GDScript 4 syntax)
- IterForge installed and initialized in project directory

## Installation Steps

### 1. Copy Plugin to Project

Copy the `godot-plugin/addons/iterforge/` folder to your Godot project's `res://addons/` directory.

Result: `res://addons/iterforge/plugin.cfg` should exist.

### 2. Enable Plugin in Godot

1. Open your Godot 4 project
2. Go to **Project → Project Settings → Plugins**
3. Search for "IterForge"
4. Click the checkbox next to IterForge to enable it

### 3. Open the Dock

The IterForge dock appears in the right sidebar (upper left panel).

**Dock shows:**
- ✓ or ⚠️ status (green = connected)
- Recent imports (last 5 assets)
- **Open GUI** — Launch GUI panel
- **Sync Now** — Manually trigger asset sync
- **Open Docs** — Visit itch.io

### 4. Generate Your First Asset

In a terminal:
```bash
iterforge generate arena --faction AEGIS
```

### 5. Watch It Import

The Godot plugin automatically:
1. Detects the new asset in `iterforge.json`
2. Imports it to `res://assets/iterforge/`
3. Updates the recent imports list

No manual importing needed!

## How Auto-Import Works

The plugin polls `iterforge.json` every 2 seconds looking for new assets in `pending_assets`. When found:

1. Acquires a `.lock` file (prevents Node.js from writing)
2. Triggers Godot's filesystem scan
3. Clears the pending list
4. Releases the lock

This is all automatic. You just generate and watch.

## Troubleshooting

**Plugin not showing in Project Settings?**
- Ensure `res://addons/iterforge/plugin.cfg` exists
- Restart Godot editor

**Status shows "Not Found"?**
- Run `iterforge init` in your project directory
- Ensure `iterforge.json` exists in project root

**Assets not importing?**
- Check the Godot console (bottom panel) for errors
- Run `iterforge doctor` to verify setup
- Click **Sync Now** in the dock to force a refresh

**Can't find the dock?**
- Go to **View → Show IterForge** (top menu)
- Or drag from the right sidebar if minimized

## File Structure

After setup, your project structure looks like:

```
your-project/
├── res://
│   ├── addons/iterforge/    ← Plugin files
│   ├── assets/iterforge/    ← Generated assets (auto-created)
│   └── scenes/              ← Your scenes
├── iterforge.json           ← Project config
└── .mcp.json                ← MCP config (for AI agents)
```

## Next Steps

- **Generate more assets:** `iterforge generate card --faction ECLIPSE`
- **Tweak settings:** Edit `iterforge.json` or use CLI flags
- **Use AI agents:** Claude CLI and Gemini CLI can call `iterforge` via MCP

Happy generating! 🎨
