import {
  ASSET_TYPE_PREFIXES,
  FACTION_TERMS,
  ATMOSPHERE_TERMS,
  LEVEL_MODIFIERS,
  CONDITION_TERMS,
  QUALITY_SUFFIX,
  UNIVERSAL_NEGATIVE
} from './templates.js';

export class PromptEngine {
  /**
   * Builds a full prompt string based on the provided options.
   * Follows the strict order in Section A6.8 of the Master Spec.
   */
  static build(options) {
    const {
      type = 'arena',
      faction = 'AEGIS',
      atmosphere = 'midday',
      darkness = 3,
      zoom = 4,
      noise = 1,
      condition = 'standard'
    } = options;

    const parts = [
      // 1. Asset type prefix
      ASSET_TYPE_PREFIXES[type] || ASSET_TYPE_PREFIXES.arena,
      // 2. Faction base terms
      FACTION_TERMS[faction] || FACTION_TERMS.AEGIS,
      // 3. Atmosphere modifier
      ATMOSPHERE_TERMS[atmosphere] || ATMOSPHERE_TERMS.midday,
      // 4. Darkness level modifier
      LEVEL_MODIFIERS.darkness[darkness] || LEVEL_MODIFIERS.darkness[2],
      // 5. Zoom level modifier
      LEVEL_MODIFIERS.zoom[zoom] || LEVEL_MODIFIERS.zoom[2],
      // 6. Noise level modifier
      LEVEL_MODIFIERS.noise[noise] || LEVEL_MODIFIERS.noise[1],
      // 7. Condition modifier
      CONDITION_TERMS[condition] || CONDITION_TERMS.standard,
      // 8. Quality suffix
      QUALITY_SUFFIX
    ];

    return {
      positive: parts.join(', '),
      negative: UNIVERSAL_NEGATIVE
    };
  }
}
