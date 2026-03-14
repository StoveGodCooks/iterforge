/**
 * fix-wincodesign-cache.mjs
 *
 * electron-builder downloads winCodeSign-2.6.0.7z which contains macOS
 * symlinks (libcrypto.dylib, libssl.dylib). On Windows without Developer Mode,
 * 7-zip exits with code 2 (partial failure) and electron-builder retries forever.
 *
 * This script:
 *   1. Downloads the .7z to a temp file
 *   2. Extracts it with 7za, ignoring the exit code
 *   3. Creates empty placeholder files for the 2 missing macOS symlinks
 *   4. Places the result in the correct electron-builder cache location
 *
 * Run once before `npm run build:exe`
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import https from 'https';
import path from 'path';
import os from 'os';

const VERSION   = 'winCodeSign-2.6.0';
const URL       = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${VERSION}/${VERSION}.7z`;
const CACHE_DIR = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'winCodeSign', VERSION);
const SEVEN_ZA  = path.join(process.cwd(), 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const TMP_FILE  = path.join(os.tmpdir(), `${VERSION}.7z`);

// Symlinks that Windows can't create — create empty placeholders instead
const MISSING_PLACEHOLDERS = [
  path.join(CACHE_DIR, 'darwin', '10.12', 'lib', 'libcrypto.dylib'),
  path.join(CACHE_DIR, 'darwin', '10.12', 'lib', 'libssl.dylib'),
];

async function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (u) => {
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return follow(res.headers.location);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on('finish', resolve);
        out.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

if (fs.existsSync(CACHE_DIR)) {
  console.log(`✓ winCodeSign cache already exists at:\n  ${CACHE_DIR}`);
  process.exit(0);
}

console.log(`Downloading ${VERSION}.7z…`);
await download(URL, TMP_FILE);
console.log('✓ Downloaded');

console.log('Extracting (ignoring symlink errors)…');
fs.mkdirSync(CACHE_DIR, { recursive: true });

// -y = yes to all prompts, exit code 2 = warnings (we ignore it)
const result = spawnSync(SEVEN_ZA, ['x', '-bd', TMP_FILE, `-o${CACHE_DIR}`, '-y'], {
  stdio: ['ignore', 'inherit', 'inherit'],
});

if (result.status !== 0 && result.status !== 2) {
  console.error(`7za exited with code ${result.status} — unexpected failure`);
  process.exit(1);
}

// Create placeholder files for the macOS symlinks that couldn't be extracted
for (const p of MISSING_PLACEHOLDERS) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '');  // empty placeholder — never used on Windows
    console.log(`  + placeholder: ${path.relative(CACHE_DIR, p)}`);
  }
}

// Clean up
fs.rmSync(TMP_FILE, { force: true });

console.log(`\n✓ winCodeSign cache ready at:\n  ${CACHE_DIR}`);
console.log('\nYou can now run: npm run build:exe');
