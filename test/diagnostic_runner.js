/**
 * Node.js Wrapper for MasterForge Comprehensive Diagnostics.
 * Usage: node test/diagnostic_runner.js <image_path> [asset_type]
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { findPython } from '../src/backends/masterforge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIAG_PY = path.join(__dirname, '..', 'src', '3d', 'masterforge', 'tests', 'comprehensive_diagnostics.py');

async function run() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node test/diagnostic_runner.js <image_path> [asset_type]');
    process.exit(1);
  }

  const imagePath = path.resolve(args[0]);
  const assetType = args[1] || 'sword';

  if (!await fs.pathExists(imagePath)) {
    console.error(`Error: Input image not found at ${imagePath}`);
    process.exit(1);
  }

  const pythonExe = findPython();
  console.log(`[Diagnostic] Using Python: ${pythonExe}`);
  console.log(`[Diagnostic] Script: ${DIAG_PY}`);
  console.log(`[Diagnostic] Image: ${imagePath}`);
  console.log(`[Diagnostic] Type: ${assetType}`);

  const child = spawn(pythonExe, [DIAG_PY, imagePath, assetType], {
    stdio: 'inherit',
    windowsHide: true
  });

  child.on('close', (code) => {
    process.exit(code);
  });
}

run().catch(err => {
  console.error('[Diagnostic] Runner crashed:', err.message);
  process.exit(1);
});
