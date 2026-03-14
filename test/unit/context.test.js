import { ContextManager } from '../../src/context/manager.js';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

const TEST_DIR = path.join(os.tmpdir(), 'iterforge-test-' + Date.now());

async function test() {
  await fs.ensureDir(TEST_DIR);
  const origCwd = process.cwd();
  process.chdir(TEST_DIR);

  try {
    let config = await ContextManager.init('test-proj');
    if (!config.project.name.includes('test')) throw new Error('init: project name not set');
    if (!(await fs.pathExists('iterforge.json'))) throw new Error('init: file not created');

    config = await ContextManager.read();
    if (!config) throw new Error('read: config is null');

    await ContextManager.update({ 'active.faction': 'ECLIPSE' });
    config = await ContextManager.read();
    if (config.active.faction !== 'ECLIPSE') throw new Error('update: faction not changed');

    config.history = Array(10).fill({ timestamp: new Date().toISOString() });
    await ContextManager.write(config);
    config = await ContextManager.read();
    if (config.history.length !== 10) throw new Error('history: not persisted');

  } finally {
    process.chdir(origCwd);
    await fs.remove(TEST_DIR);
  }
}

export default test;
// Additional export for history pruning test (called from the main test)
