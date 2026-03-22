export const DEFAULT_CONFIG = {
  version: "1.0",
  project: {
    name: "new-project",
    type: "godot",
    godot_version: "4.x",
    godot_path: "./",
    assets_path: "./assets/iterforge/"
  },
  active: {
    faction: "AEGIS",
    card: null,
    arena_variant: "midday-standard",
    generation_mode: "base"
  },
  settings: {
    zoom: 4, 
    darkness: 3, 
    noise: 1,
    atmosphere: "midday", 
    condition: "standard",
    width: 1024, 
    height: 1024,
    steps: 30, 
    cfg: 7.0,
    auto_start_backends: false
  },
  backend_override: null,
  last_generated: { 
    image_path: null, 
    prompt: null, 
    backend_used: null, 
    seed: null 
  },
  history: [], 
  max_history: 50,
  godot_sync: { 
    last_import: null, 
    pending_assets: [] 
  },
  iteration_notes: []
};
