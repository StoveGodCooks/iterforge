/**
 * Section A6 - Prompt Engineering Specification
 * Maps internal settings to specific AI prompt phrases.
 */

export const FACTION_TERMS = {
  AEGIS: "tactical military installation, reinforced concrete, chain-link fencing, floodlights, watchtowers, utilitarian architecture, olive drab and gunmetal",
  ECLIPSE: "corporate megastructure, glass and steel, neon signage, surveillance cameras, clean lines, black and silver, cyberpunk aesthetic",
  SPECTER: "abandoned urban environment, decay, graffiti, broken windows, rust, overgrown vegetation, muted earth tones, post-industrial"
};

export const ATMOSPHERE_TERMS = {
  midday: "harsh overhead sunlight, sharp shadows, high contrast, clear sky, bleached colors",
  nighttime: "artificial lighting only, deep shadows, neon reflections, moonlight, high contrast darkness",
  rain: "wet surfaces, rain streaks, puddle reflections, overcast sky, desaturated colors, atmospheric haze",
  flooded: "standing water, submerged lower structures, reflective surfaces, waterlogged debris, murky tones"
};

export const LEVEL_MODIFIERS = {
  darkness: [
    "bright and exposed, fully lit, no shadows",
    "slightly shadowed, soft ambient lighting",
    "moderately dark, partial shadows, dusk lighting",
    "heavily shadowed, minimal lighting, threatening atmosphere",
    "near total darkness, single harsh light source, extreme contrast"
  ],
  zoom: [
    "extreme close-up, macro detail shot, texture focus",
    "close-up shot, character or object detail",
    "medium shot, subject and immediate environment",
    "wide shot, full environment visible",
    "establishing shot, sweeping panoramic view, full scene"
  ],
  noise: [
    "pristine clean image, no visual noise, clinical precision",
    "slight film grain, minimal noise",
    "moderate grain, gritty texture",
    "heavy grain, distressed, war-worn aesthetic",
    "extreme noise, heavily degraded, VHS artifact quality"
  ]
};

export const ASSET_TYPE_PREFIXES = {
  arena: "game arena background, strategic battle environment, top-down perspective, isometric view, tile-able background, 1024x1024",
  card: "card game illustration, card art, centered composition, portrait orientation, detailed foreground subject, atmospheric background, 1024x1024",
  icon: "game icon, small sprite, clear silhouette, readable at small size, solid background, 128x128 effective detail",
  sprite: "game character sprite, full body, clear outline, isolated subject, game-ready asset, transparent background compatible"
};

export const CONDITION_TERMS = {
  standard: "clean operational state, no damage",
  damaged: "battle damage, scorch marks, debris, structural damage, broken equipment",
  flooded: "water damage, flooding visible, waterlogged, submerged elements"
};

export const UNIVERSAL_NEGATIVE = "blurry, low quality, jpeg artifacts, watermark, signature, text, logo, distorted anatomy, extra limbs, missing limbs, disfigured, duplicate, out of frame, cropped badly, worst quality, normal quality, low resolution, pixelated, oversaturated, overexposed, underexposed";

export const QUALITY_SUFFIX = "masterpiece, best quality, highly detailed, professional game art, concept art";
