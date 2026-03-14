import { readEnv } from '../../src/env/reader.js';
import { writeEnv, updateEnv } from '../../src/env/writer.js';
import fs from 'fs-extra';
import { ITERFORGE_HOME } from '../../src/env/reader.js';

async function test() {
  // Backup existing env if present
  const backupPath = ITERFORGE_HOME + '.backup';
  if (await fs.pathExists(ITERFORGE_HOME)) {
    await fs.copy(ITERFORGE_HOME, backupPath);
  }

  try {
    // Clear for clean test
    await fs.remove(ITERFORGE_HOME);

    // Test: readEnv returns defaults when missing
    let env = await readEnv();
    if (env.tier !== 'free') throw new Error('readEnv: default tier not set');
    if (!env.tools) throw new Error('readEnv: tools object missing');

    // Test: writeEnv creates env.json
    await writeEnv({ tier: 'pro', tools: { test: { path: '/test' } } });
    env = await readEnv();
    if (env.tier !== 'pro') throw new Error('writeEnv: tier not persisted');

    // Test: updateEnv merges
    await updateEnv({ tools: { other: { path: '/other' } } });
    env = await readEnv();
    if (!env.tools.test) throw new Error('updateEnv: lost existing tool');
    if (!env.tools.other) throw new Error('updateEnv: new tool not merged');

  } finally {
    await fs.remove(ITERFORGE_HOME);
    if (await fs.pathExists(backupPath)) {
      await fs.move(backupPath, ITERFORGE_HOME, { overwrite: true });
    }
  }
}

export default test;
