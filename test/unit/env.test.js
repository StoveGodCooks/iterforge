import path from 'path';
import { readEnv } from '../../src/env/reader.js';
import { writeEnv, updateEnv } from '../../src/env/writer.js';
import fs from 'fs-extra';
import { ITERFORGE_HOME } from '../../src/env/reader.js';

async function test() {
  // Only back up / restore env.json — never remove the whole ITERFORGE_HOME
  // because ComfyUI (or other managed processes) may have the directory locked.
  const envFile = path.join(ITERFORGE_HOME, 'env.json');
  const backupEnv = ITERFORGE_HOME + '-env.backup.json';
  if (await fs.pathExists(envFile)) {
    await fs.copy(envFile, backupEnv);
  }

  try {
    // Remove only env.json so readEnv falls back to defaults
    await fs.remove(envFile);

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
    // Restore original env.json (or clean up the test one)
    await fs.remove(envFile);
    if (await fs.pathExists(backupEnv)) {
      await fs.move(backupEnv, envFile, { overwrite: true });
    }
  }
}

export default test;
