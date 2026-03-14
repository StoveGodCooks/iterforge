#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;

async function runTest(file) {
  try {
    const mod = await import(pathToFileURL(file).href);
    const name = path.basename(file);
    if (typeof mod.default === 'function') {
      await mod.default();
      console.log(`✓ ${name}`);
      passed++;
    }
  } catch (e) {
    console.error(`✗ ${path.basename(file)}: ${e.message}`);
    failed++;
  }
}

async function main() {
  const testDir = __dirname;
  const unitDir = path.join(testDir, 'unit');
  const intDir  = path.join(testDir, 'integration');

  console.log('Running tests...\n');

  if (await fs.pathExists(unitDir)) {
    const files = (await fs.readdir(unitDir))
      .filter(f => f.endsWith('.test.js'))
      .sort();
    for (const f of files) await runTest(path.join(unitDir, f));
  }

  if (await fs.pathExists(intDir)) {
    const files = (await fs.readdir(intDir))
      .filter(f => f.endsWith('.test.js'))
      .sort();
    for (const f of files) await runTest(path.join(intDir, f));
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
