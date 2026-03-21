/**
 * Unit tests for src/server/routes/asset-presets.js
 * Tests buildPresetPrompt, STYLE_HINTS, GAME_ASSET_TYPES
 */
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function test() {
  const modulePath = path.resolve(__dirname, '../../src/server/routes/asset-presets.js');
  const {
    buildPresetPrompt,
    ASSET_PRESETS,
    STYLE_HINTS,
    STYLE_NEGATIVES,
    GAME_ASSET_TYPES,
  } = await import(pathToFileURL(modulePath).href);

  const BASE_NEGATIVE = 'blurry, low quality, watermark';

  // ── GAME_ASSET_TYPES ─────────────────────────────────────────────────────

  if (!(GAME_ASSET_TYPES instanceof Set)) {
    throw new Error('GAME_ASSET_TYPES must be a Set');
  }
  if (!GAME_ASSET_TYPES.has('sword')) {
    throw new Error('GAME_ASSET_TYPES missing: sword');
  }
  if (!GAME_ASSET_TYPES.has('weapon')) {
    throw new Error('GAME_ASSET_TYPES missing: weapon');
  }
  if (!GAME_ASSET_TYPES.has('icon')) {
    throw new Error('GAME_ASSET_TYPES missing: icon');
  }
  console.log(`GAME_ASSET_TYPES has ${GAME_ASSET_TYPES.size} entries`);

  // ── ASSET_PRESETS: per-key checks ────────────────────────────────────────

  const presetKeys = Object.keys(ASSET_PRESETS);
  if (presetKeys.length === 0) throw new Error('ASSET_PRESETS is empty');
  console.log(`Testing ${presetKeys.length} ASSET_PRESETS: ${presetKeys.join(', ')}`);

  for (const assetType of presetKeys) {
    const result = buildPresetPrompt({
      assetType,
      artStyle: 'stylized',
      subject: 'iron longsword',
      baseNegative: BASE_NEGATIVE,
      cfg: 5.5,
      steps: 25,
    });

    // positive is a non-empty string
    if (typeof result.positive !== 'string' || result.positive.length === 0) {
      throw new Error(`[${assetType}] positive must be a non-empty string`);
    }

    // subject appears first in positive
    if (!result.positive.startsWith('iron longsword')) {
      throw new Error(`[${assetType}] positive must start with the user subject`);
    }

    // No literal newlines or tab characters
    if (result.positive.includes('\n') || result.positive.includes('\t')) {
      throw new Error(`[${assetType}] positive contains newlines or tabs (JSON unsafe)`);
    }
    if (result.negative.includes('\n') || result.negative.includes('\t')) {
      throw new Error(`[${assetType}] negative contains newlines or tabs (JSON unsafe)`);
    }

    // negative is non-empty
    if (typeof result.negative !== 'string' || result.negative.length === 0) {
      throw new Error(`[${assetType}] negative must be a non-empty string`);
    }

    // cfg is between 1 and 20
    if (typeof result.cfg !== 'number' || result.cfg < 1 || result.cfg > 20) {
      throw new Error(`[${assetType}] cfg out of range [1,20]: ${result.cfg}`);
    }

    // steps is between 1 and 50
    if (typeof result.steps !== 'number' || result.steps < 1 || result.steps > 50) {
      throw new Error(`[${assetType}] steps out of range [1,50]: ${result.steps}`);
    }
  }
  console.log('All ASSET_PRESETS keys passed individual checks');

  // ── STYLE_HINTS ──────────────────────────────────────────────────────────

  const styleKeys = Object.keys(STYLE_HINTS);
  if (styleKeys.length === 0) throw new Error('STYLE_HINTS is empty');
  for (const style of styleKeys) {
    if (typeof STYLE_HINTS[style] !== 'string' || STYLE_HINTS[style].length === 0) {
      throw new Error(`STYLE_HINTS["${style}"] must be a non-empty string`);
    }
  }
  console.log(`STYLE_HINTS has ${styleKeys.length} entries — all non-empty`);

  // Style hints surface in the generated positive
  const styledResult = buildPresetPrompt({
    assetType: 'sword',
    artStyle: 'pixel',
    subject: 'golden sword',
    baseNegative: BASE_NEGATIVE,
    cfg: 5.5,
    steps: 25,
  });
  if (!styledResult.positive.includes(STYLE_HINTS['pixel'])) {
    throw new Error('pixel style hint not present in positive prompt');
  }
  console.log('Style hints are injected into positive prompt');

  // ── Unknown assetType: graceful fallback (no crash) ─────────────────────

  let unknownResult;
  try {
    unknownResult = buildPresetPrompt({
      assetType: 'totally_unknown_type_xyz',
      artStyle: 'stylized',
      subject: 'test subject',
      baseNegative: BASE_NEGATIVE,
      cfg: 5.5,
      steps: 25,
    });
  } catch (e) {
    throw new Error(`Unknown assetType should not crash, but threw: ${e.message}`);
  }
  if (typeof unknownResult.positive !== 'string' || unknownResult.positive.length === 0) {
    throw new Error('Unknown assetType: positive should still be a non-empty string');
  }
  // Falls back to passed cfg/steps since no preset override
  if (unknownResult.cfg !== 5.5) {
    throw new Error(`Unknown assetType: cfg fallback should be 5.5, got ${unknownResult.cfg}`);
  }
  console.log('Unknown assetType falls back gracefully');

  // ── Empty subject: still produces valid positive ─────────────────────────

  const emptySubjectResult = buildPresetPrompt({
    assetType: 'sword',
    artStyle: 'stylized',
    subject: '',
    baseNegative: BASE_NEGATIVE,
    cfg: 5.5,
    steps: 25,
  });
  if (typeof emptySubjectResult.positive !== 'string' || emptySubjectResult.positive.length === 0) {
    throw new Error('Empty subject must still produce a non-empty positive (from style/technical parts)');
  }
  console.log('Empty subject still produces valid positive');

  // ── Whitespace-only subject is treated like empty ────────────────────────

  const wsResult = buildPresetPrompt({
    assetType: 'sword',
    artStyle: 'stylized',
    subject: '   ',
    baseNegative: BASE_NEGATIVE,
    cfg: 5.5,
    steps: 25,
  });
  if (typeof wsResult.positive !== 'string' || wsResult.positive.length === 0) {
    throw new Error('Whitespace-only subject should produce valid positive');
  }
  console.log('Whitespace-only subject is trimmed and handled gracefully');
}
