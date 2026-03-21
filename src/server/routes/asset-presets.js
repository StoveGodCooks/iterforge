/**
 * Inter-Forge — Per-Asset Technical Presets
 *
 * Philosophy: presets inject TECHNICAL REQUIREMENTS only (framing, isolation,
 * orientation, count). They do NOT inject style terms — the user's prompt and
 * art style selection handle all creative direction. This prevents the preset
 * from overpowering what the user actually asked for.
 *
 * Each preset has:
 *  - technical   : appended after the user's prompt — framing/isolation only
 *  - negative    : extra negatives specific to this asset type
 *  - loraName    : exact filename in loras folder (null = no LoRA)
 *  - cfgOverride / stepsOverride : model settings (Lightning auto-clamped in comfyui.js)
 *  - suggestSize : auto-applied when user leaves default square resolution
 */

export const GAME_ASSET_TYPES = new Set([
  'icon', 'item', 'weapon', 'sword', 'axe', 'dagger', 'staff',
  'shield', 'armor', 'ring', 'ui', 'tileset', 'texture', 'prop',
  'furniture', 'tree',
]);

export const ASSET_PRESETS = {

  // ── Weapons ─────────────────────────────────────────────────────────────────
  sword: {
    loraName:    'cartoon.safetensors',
    technical:   'single sword, vertical orientation tip pointing straight up, front-facing orthographic view, fully centered, transparent background, completely isolated, no hands, no character, no scene',
    negative:    ', two swords, pair of swords, multiple weapons, hands gripping, character holding, diagonal tilt, horizontal, background scene, shadow, glow effects, environment, text, watermark',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 512, height: 1024 },
  },

  axe: {
    loraName:    'cartoon.safetensors',
    technical:   'single axe, vertical orientation blade up, front-facing orthographic view, fully centered, transparent background, completely isolated, no hands, no character, no scene',
    negative:    ', two axes, multiple weapons, hands gripping, character holding, background scene, shadow, text, watermark',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 512, height: 768 },
  },

  dagger: {
    loraName:    'cartoon.safetensors',
    technical:   'single dagger, vertical orientation tip pointing up, front-facing orthographic view, fully centered, transparent background, completely isolated, no hands, no character, no scene',
    negative:    ', two daggers, multiple weapons, hands gripping, character holding, background scene, shadow, text, watermark',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 512, height: 768 },
  },

  staff: {
    loraName:    'cartoon.safetensors',
    technical:   'single staff, vertical orientation, front-facing flat view, fully centered, transparent background, completely isolated, no hands, no character, no scene',
    negative:    ', multiple staves, hands gripping, character holding, background scene, shadow, text, watermark',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 512, height: 1024 },
  },

  weapon: {
    loraName:    'cartoon.safetensors',
    technical:   'single weapon, front-facing orthographic view, fully centered, transparent background, completely isolated, no hands, no character, no scene',
    negative:    ', multiple weapons, hands gripping, character holding, background scene, shadow, glow, text, watermark',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 512, height: 1024 },
  },

  // ── Armor & Equipment ───────────────────────────────────────────────────────
  shield: {
    loraName:    'cartoon.safetensors',
    technical:   'single shield, front-facing orthographic view, fully centered, transparent background, completely isolated, no arm, no character, no scene',
    negative:    ', multiple shields, arm holding, character, background scene, shadow, text, watermark',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 512, height: 512 },
  },

  armor: {
    loraName:    'cartoon.safetensors',
    technical:   'single armor piece, front-facing flat lay view, fully centered, transparent background, completely isolated, no body, no character wearing it, empty armor',
    negative:    ', character wearing armor, body inside armor, background scene, shadow, text, watermark',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 512, height: 768 },
  },

  ring: {
    loraName:    'cartoon.safetensors',
    technical:   'single ring, top-down orthographic view, fully centered, transparent background, completely isolated, no finger, no hand',
    negative:    ', finger wearing ring, hand, multiple rings, background, shadow, text, watermark',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 512, height: 512 },
  },

  // ── Characters & Creatures ──────────────────────────────────────────────────
  character: {
    loraName:    'CuteCartoonRedmond.safetensors',
    technical:   'single character, full body, front-facing, centered, transparent background, fully isolated, no background scene',
    negative:    ', multiple characters, background environment, text, watermark, partial body, cropped',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 512, height: 1024 },
  },

  creature: {
    loraName:    'cartoon.safetensors',
    technical:   'single creature, full body, front-facing, centered, transparent background, fully isolated, no background scene',
    negative:    ', multiple creatures, background environment, text, watermark, partial body, cropped',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 512, height: 768 },
  },

  // ── Props & Objects ─────────────────────────────────────────────────────────
  prop: {
    loraName:    'cartoon.safetensors',
    technical:   'single object, front-facing view, centered, transparent background, fully isolated',
    negative:    ', multiple objects, background scene, text, watermark, hands, character',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 512, height: 512 },
  },

  item: {
    loraName:    'cartoon.safetensors',
    technical:   'single item, front-facing view, centered, transparent background, fully isolated',
    negative:    ', multiple items, background scene, text, watermark, hands, character',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 512, height: 512 },
  },

  furniture: {
    loraName:    null,
    technical:   'single furniture piece, front-facing or slight 3/4 view, centered, transparent background, fully isolated, no room, no scene',
    negative:    ', multiple furniture, room interior, background scene, text, watermark, person',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 768, height: 768 },
  },

  tree: {
    loraName:    null,
    technical:   'single tree, full view from roots to crown, front-facing, centered, transparent background, fully isolated',
    negative:    ', forest, multiple trees, background landscape, ground, grass, text, watermark',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 512, height: 1024 },
  },

  building: {
    loraName:    null,
    technical:   'single building, front facade view, centered, transparent background, fully isolated, no street, no environment',
    negative:    ', multiple buildings, street scene, background environment, people, text, watermark',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 768, height: 1024 },
  },

  // ── UI & Icons ───────────────────────────────────────────────────────────────
  icon: {
    loraName:    'IconsRedmondV2-Icons.safetensors',
    technical:   'icredm, single icon, centered, transparent background, flat design, fully isolated',
    negative:    ', multiple icons, background, text overlay, watermark, 3D render',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 512, height: 512 },
  },

  ui: {
    loraName:    'IconsRedmondV2-Icons.safetensors',
    technical:   'icredm, single UI element, centered, clean edges, isolated, no background clutter',
    negative:    ', background, text labels, watermark, 3D render, scene',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: null,
  },

  // ── Tiles & Textures ─────────────────────────────────────────────────────────
  tileset: {
    loraName:    'PixelArtRedmond-Lite64.safetensors',
    technical:   'seamless tileable tile, consistent edges that tile perfectly, top-down flat view',
    negative:    ', non-seamless edges, visible seam, gradient fade, watermark, character, object, text',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 512, height: 512 },
  },

  texture: {
    loraName:    'PixelArtRedmond-Lite64.safetensors',
    technical:   'seamless tileable surface texture, repeating pattern, top-down flat view, no visible seams',
    negative:    ', non-seamless edges, visible seam, gradient, watermark, character, object, text',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 512, height: 512 },
  },

  // ── Effects ──────────────────────────────────────────────────────────────────
  vfx: {
    loraName:    null,
    technical:   'single effect, centered, isolated, no character, no background scene',
    negative:    ', character, background scene, text, watermark, multiple effects',
    cfgOverride:    5.0,
    stepsOverride:  20,
    suggestSize: null,
  },

  particle: {
    loraName:    null,
    technical:   'single particle effect, centered, isolated, transparent-ready',
    negative:    ', character, background, text, watermark',
    cfgOverride:    5.0,
    stepsOverride:  20,
    suggestSize: null,
  },

  // ── Scene types (no isolation needed) ────────────────────────────────────────
  environment: {
    loraName:    null,
    technical:   'game environment, atmospheric, wide establishing shot',
    negative:    ', text, watermark, low quality, blurry',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 1024, height: 576 },
  },

  concept: {
    loraName:    'SDXL-HearthstoneCard-Lora.safetensors',
    technical:   'Hearthstone Card, detailed game illustration, cinematic composition',
    negative:    ', text, watermark, card border, card frame, UI overlay, low quality',
    cfgOverride:    6.0,
    stepsOverride:  28,
    suggestSize: { width: 768, height: 1024 },
  },

  portrait: {
    loraName:    null,
    technical:   'character portrait, face and upper body, centered',
    negative:    ', text, watermark, multiple faces, low quality',
    cfgOverride:    5.5,
    stepsOverride:  25,
    suggestSize: { width: 768, height: 1024 },
  },
};

// Light style hints — a single short descriptor appended after the user prompt.
// Intentionally minimal so user creative direction isn't overridden.
export const STYLE_HINTS = {
  stylized:    'stylized game art',
  pixel:       'pixel art, 16-bit pixel style, crisp hard pixels',
  anime:       'anime style, cel shading',
  painted:     'hand painted style',
  lowpoly:     'low poly style',
  cartoon:     'cartoon style, bold outlines',
  darkfantasy: 'dark fantasy art',
  isometric:   'isometric view',
  scifi:       'sci-fi futuristic style',
  chibi:       'chibi style, kawaii',
  watercolor:  'watercolor style',
  painterly:   'painterly brushwork',
  ink:         'ink line art',
  realistic:   'detailed digital painting',
};

// Style-specific negatives — still useful to block style contamination
export const STYLE_NEGATIVES = {
  pixel:       ', smooth anti-aliasing, gradients, soft painterly blur, photorealistic',
  cartoon:     ', photorealistic, 3D render, harsh photo shadows',
  anime:       ', photorealistic, 3D CGI, rough sketchy',
  lowpoly:     ', photorealistic, high poly, noisy texture',
  chibi:       ', realistic adult proportions, tall body',
  isometric:   ', straight front view, flat non-isometric, photorealistic',
  darkfantasy: ', bright kawaii, clean white background',
  watercolor:  ', hard digital edges, flat vector, photorealistic',
};

/**
 * Build the final prompt pair for a preset-mode generation.
 *
 * Prompt order (user subject has full priority):
 *   1. User's subject/prompt  ← FIRST, full creative control
 *   2. Light art style hint   ← short, doesn't override subject
 *   3. Technical framing      ← orientation, isolation, count
 *   4. Quality baseline       ← minimal, at the end
 *
 * @param {object} opts
 * @param {string} opts.assetType
 * @param {string} opts.artStyle
 * @param {string} opts.subject      - user's text prompt
 * @param {string} opts.baseNegative - base negative prompt
 * @param {number} opts.cfg
 * @param {number} opts.steps
 * @returns {{ positive, negative, cfg, steps, loraName, suggestSize }}
 */
export function buildPresetPrompt({ assetType, artStyle, subject, baseNegative, cfg, steps }) {
  const preset     = ASSET_PRESETS[assetType];
  const styleHint  = STYLE_HINTS[artStyle]    ?? '';
  const styleNeg   = STYLE_NEGATIVES[artStyle] ?? '';

  const positiveParts = [
    subject.trim() || null,    // USER PROMPT — full priority, first position
    styleHint      || null,    // light style hint
    preset?.technical || null, // technical framing/isolation only
    'high quality, game-ready asset',  // minimal quality baseline
  ].filter(Boolean);

  const positive = positiveParts.join(', ');
  const negative = baseNegative + styleNeg + (preset?.negative ?? '');

  return {
    positive,
    negative,
    cfg:        preset?.cfgOverride    ?? cfg,
    steps:      preset?.stepsOverride  ?? steps,
    loraName:   preset?.loraName       ?? null,
    suggestSize: preset?.suggestSize   ?? null,
  };
}
