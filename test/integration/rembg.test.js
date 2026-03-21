/**
 * Integration test: rembg background removal
 * Tests Python availability, rembg module, and remove_bg.py script.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve Python: prefer managed IterForge Python (has rembg), fall back to system
const ITERFORGE_HOME = path.join(os.homedir(), 'AppData', 'Roaming', 'IterForge');
const MANAGED_PYTHON = path.join(ITERFORGE_HOME, 'python-base', 'python.exe');
const PYTHON_EXE = (await fs.pathExists(MANAGED_PYTHON)) ? MANAGED_PYTHON : 'python';

// SkipError — dynamically import from runner so tests can use it standalone too
let SkipError;
try {
  const runnerPath = path.resolve(__dirname, '../runner.js');
  const { SkipError: SE } = await import((await import('url')).pathToFileURL(runnerPath).href);
  SkipError = SE;
} catch {
  // Runner not imported yet — define a local fallback
  SkipError = class SkipError extends Error {
    constructor(msg) { super(msg); this.name = 'SkipError'; }
  };
}

async function checkPython() {
  try {
    const { stdout } = await execFileAsync(PYTHON_EXE, ['--version']);
    const version = (stdout || '').trim();
    return version;
  } catch {
    return null;
  }
}

// Write a minimal valid 10x10 white PNG using raw binary construction
// Avoids any external dependency and guarantees a well-formed file.
async function writeMinimalPng(filePath) {
  // Use sharp if available (it's in the project dependencies)
  try {
    const { default: sharp } = await import('sharp');
    // 10x10 white RGB image
    await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).png().toFile(filePath);
    return;
  } catch {
    // sharp not available in this context — fall through to manual construction
  }

  // Manual minimal 1x1 white PNG (valid, PIL-compatible)
  // Built from spec: PNG sig + IHDR + IDAT + IEND
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (const b of buf) {
      c ^= b;
      for (let i = 0; i < 8; i++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crcBuf = Buffer.concat([typeBytes, data]);
    const crcVal = Buffer.alloc(4); crcVal.writeUInt32BE(crc32(crcBuf));
    return Buffer.concat([len, typeBytes, data, crcVal]);
  }

  // zlib compress a single unfiltered 1x1 white pixel row: [0x00, 0xFF, 0xFF, 0xFF]
  const { deflateSync } = await import('zlib');
  const raw = Buffer.from([0x00, 0xFF, 0xFF, 0xFF]); // filter=None, R, G, B
  const compressed = deflateSync(raw);

  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.from([0,0,0,1, 0,0,0,1, 8, 2, 0, 0, 0]); // 1x1, 8-bit RGB
  const png  = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
  await fs.writeFile(filePath, png);
}

export default async function test() {
  // ── Python is accessible ─────────────────────────────────────────────────
  const pyVersion = await checkPython();
  if (!pyVersion) {
    throw new SkipError('Python not available on PATH');
  }
  console.log(`Python: ${PYTHON_EXE} — ${pyVersion}`);

  // ── rembg module is importable ───────────────────────────────────────────
  let rembgVersion = null;
  try {
    const { stdout } = await execFileAsync(PYTHON_EXE, [
      '-c',
      'import rembg; print(rembg.__version__)',
    ]);
    rembgVersion = stdout.trim();
    console.log(`rembg version: ${rembgVersion}`);
  } catch {
    console.log('WARNING: rembg module not importable — background removal will be skipped at runtime');
    // Don't fail the test — rembg is optional, the code handles its absence
  }

  // ── remove_bg.py exists ──────────────────────────────────────────────────
  const scriptPath = path.resolve(__dirname, '../../src/tools/remove_bg.py');
  if (!(await fs.pathExists(scriptPath))) {
    throw new Error(`remove_bg.py not found at ${scriptPath}`);
  }
  console.log(`remove_bg.py found at ${scriptPath}`);

  // ── rembg integration: run on a test PNG ────────────────────────────────
  // Only run the actual removal if rembg is available
  if (!rembgVersion) {
    console.log('Skipping end-to-end rembg test (rembg not installed)');
    return;
  }

  const tmpDir = os.tmpdir();
  const inputPng  = path.join(tmpDir, 'iterforge-test-input.png');
  const outputPng = path.join(tmpDir, 'iterforge-test-output.png');

  // Create minimal test PNG
  await writeMinimalPng(inputPng);
  if (!(await fs.pathExists(inputPng))) {
    throw new Error('Failed to create test input PNG');
  }
  const inputStat = await fs.stat(inputPng);
  console.log(`Test input PNG created: ${inputStat.size} bytes`);

  // Clean up any leftover output from previous run
  await fs.remove(outputPng).catch(() => {});

  // Run remove_bg.py
  try {
    await execFileAsync(PYTHON_EXE, [scriptPath, inputPng, outputPng, '--white'], {
      timeout: 60_000,
    });
  } catch (e) {
    throw new Error(`remove_bg.py failed: ${e.message}`);
  }

  // Verify output file exists and is non-empty
  if (!(await fs.pathExists(outputPng))) {
    throw new Error('remove_bg.py ran but output PNG was not created');
  }
  const outputStat = await fs.stat(outputPng);
  if (outputStat.size === 0) {
    throw new Error('remove_bg.py output PNG is 0 bytes');
  }
  console.log(`Output PNG created: ${outputStat.size} bytes`);

  // Clean up
  await fs.remove(inputPng).catch(() => {});
  await fs.remove(outputPng).catch(() => {});
  console.log('rembg end-to-end test passed');
}
