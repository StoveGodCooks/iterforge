import { PromptEngine } from '../../src/prompts/engine.js';

async function test() {
  let result = PromptEngine.build({ type: 'arena', faction: 'AEGIS' });
  if (!result.positive || !result.negative) throw new Error('build: missing positive/negative');
  if (!result.positive.includes('arena')) throw new Error('build: type not in prompt');

  result = PromptEngine.build({});
  if (!result.positive) throw new Error('build: defaults failed');

  const aegis = PromptEngine.build({ faction: 'AEGIS' }).positive;
  const eclipse = PromptEngine.build({ faction: 'ECLIPSE' }).positive;
  if (aegis === eclipse) throw new Error('build: factions produce identical prompts');

  const midday = PromptEngine.build({ atmosphere: 'midday' }).positive;
  const rain = PromptEngine.build({ atmosphere: 'rain' }).positive;
  if (midday === rain) throw new Error('build: atmospheres produce identical prompts');
}

export default test;
