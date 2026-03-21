#!/usr/bin/env node
/**
 * IterForge Test Runner
 * Supports: --verbose, --category=unit|integration|api, --json
 * Exports:  assert(), SkipError
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── ANSI colours ─────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  dim:    '\x1b[2m',
};
const noColor = process.env.NO_COLOR || process.env.CI;
const c = noColor
  ? Object.fromEntries(Object.keys(C).map(k => [k, '']))
  : C;

// ── Exported helpers (used by test files) ────────────────────────────────────

export class SkipError extends Error {
  constructor(msg) { super(msg); this.name = 'SkipError'; }
}

export function assert(condition, msg) {
  if (!condition) throw new Error(msg ?? 'Assertion failed');
}

// ── Stack trace parser ────────────────────────────────────────────────────────
function parseLocation(err) {
  if (!(err instanceof Error) || !err.stack) return null;
  const lines = err.stack.split('\n');
  // Skip the first "Error: ..." line and any frames inside runner.js itself
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('runner.js')) continue;
    // Match:  at Something (C:\path\to\file.js:42:10)
    // or:     at C:\path\to\file.js:42:10
    const m = line.match(/\(([^)]+\.js):(\d+):\d+\)/) ||
              line.match(/at\s+([^\s(]+\.js):(\d+):\d+/);
    if (m) return `${path.basename(m[1])}:${m[2]}`;
  }
  return null;
}

// ── CLI flags ────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const verbose   = args.includes('--verbose');
const jsonOut   = args.includes('--json');
const catFilter = (() => {
  const f = args.find(a => a.startsWith('--category='));
  return f ? f.split('=')[1] : null;
})();

// ── Per-test runner ───────────────────────────────────────────────────────────

const results = [];  // { category, name, status, durationMs, error?, location? }

async function runTestFile(file, category) {
  const name = path.basename(file, '.test.js');
  const start = Date.now();

  // Capture console.log lines from tests so we can show them in verbose mode
  const captured = [];
  if (!verbose) {
    const origLog = console.log;
    console.log = (...a) => captured.push(a.map(String).join(' '));
    try {
      const mod = await import(pathToFileURL(file).href);
      if (typeof mod.default === 'function') await mod.default();
    } catch (e) {
      console.log = origLog;
      const durationMs = Date.now() - start;
      if (e instanceof SkipError || e?.name === 'SkipError') {
        results.push({ category, name, status: 'skip', durationMs, reason: e.message });
        printTest('skip', category, name, durationMs, e.message, null, []);
      } else {
        const location = parseLocation(e);
        results.push({ category, name, status: 'fail', durationMs, error: e.message, location });
        printTest('fail', category, name, durationMs, e.message, location, captured, e.stack);
      }
      return;
    }
    console.log = origLog;
    const durationMs = Date.now() - start;
    results.push({ category, name, status: 'pass', durationMs });
    printTest('pass', category, name, durationMs, null, null, captured);
    return;
  }

  // verbose: let console.log through naturally
  try {
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod.default === 'function') await mod.default();
    const durationMs = Date.now() - start;
    results.push({ category, name, status: 'pass', durationMs });
    printTest('pass', category, name, durationMs);
  } catch (e) {
    const durationMs = Date.now() - start;
    if (e instanceof SkipError || e?.name === 'SkipError') {
      results.push({ category, name, status: 'skip', durationMs, reason: e.message });
      printTest('skip', category, name, durationMs, e.message);
    } else {
      const location = parseLocation(e);
      results.push({ category, name, status: 'fail', durationMs, error: e.message, location });
      printTest('fail', category, name, durationMs, e.message, location, [], e.stack);
    }
  }
}

function printTest(status, category, name, ms, message, location, captured = [], stack = null) {
  const msStr = `${c.dim}(${ms}ms)${c.reset}`;
  if (status === 'pass') {
    console.log(`  ${c.green}✓${c.reset} ${name} ${msStr}`);
  } else if (status === 'skip') {
    console.log(`  ${c.yellow}⚠${c.reset} ${name} ${c.yellow}SKIPPED${c.reset} — ${message} ${msStr}`);
  } else {
    const loc = location ? `${c.dim} @ ${location}${c.reset}` : '';
    console.log(`  ${c.red}✗${c.reset} ${name}${loc} ${msStr}`);
    console.log(`    ${c.red}${message}${c.reset}`);
    if (verbose && stack) {
      const stackLines = stack.split('\n').slice(1, 5);
      stackLines.forEach(l => console.log(`    ${c.dim}${l.trim()}${c.reset}`));
    }
  }
  if (verbose && captured.length > 0) {
    captured.forEach(line => console.log(`    ${c.dim}│ ${line}${c.reset}`));
  }
}

// ── Category runner ───────────────────────────────────────────────────────────

async function runCategory(dir, category) {
  if (!(await fs.pathExists(dir))) return;
  const files = (await fs.readdir(dir))
    .filter(f => f.endsWith('.test.js'))
    .sort()
    .map(f => path.join(dir, f));

  if (files.length === 0) return;

  console.log(`\n${c.cyan}${c.bold}── ${category.toUpperCase()} ──────────────────────────${c.reset}`);
  for (const f of files) await runTestFile(f, category);
}

// ── Summary printer ───────────────────────────────────────────────────────────

function printSummary(totalMs) {
  const byCategory = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { pass: 0, fail: 0, skip: 0 };
    byCategory[r.category][r.status]++;
  }

  const totalPass = results.filter(r => r.status === 'pass').length;
  const totalFail = results.filter(r => r.status === 'fail').length;
  const totalSkip = results.filter(r => r.status === 'skip').length;

  console.log(`\n${c.bold}────────────────────────────────────────${c.reset}`);
  console.log(`${c.bold}Results by category:${c.reset}`);
  for (const [cat, counts] of Object.entries(byCategory)) {
    const p = counts.pass > 0 ? `${c.green}${counts.pass} passed${c.reset}` : '';
    const f = counts.fail > 0 ? `${c.red}${counts.fail} failed${c.reset}` : '';
    const s = counts.skip > 0 ? `${c.yellow}${counts.skip} skipped${c.reset}` : '';
    const parts = [p, f, s].filter(Boolean).join(', ');
    console.log(`  ${c.cyan}${cat.padEnd(14)}${c.reset} ${parts}`);
  }

  console.log(`\n${c.bold}Overall:${c.reset} ` +
    (totalPass > 0 ? `${c.green}${totalPass} passed${c.reset}  ` : '') +
    (totalFail > 0 ? `${c.red}${totalFail} failed${c.reset}  ` : '') +
    (totalSkip > 0 ? `${c.yellow}${totalSkip} skipped${c.reset}  ` : '') +
    `${c.dim}in ${totalMs}ms${c.reset}`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const globalStart = Date.now();

  if (!jsonOut) {
    console.log(`${c.bold}${c.cyan}IterForge Test Suite${c.reset}`);
    if (catFilter) console.log(`${c.dim}Filter: category=${catFilter}${c.reset}`);
  }

  const categories = [
    { name: 'unit',        dir: path.join(__dirname, 'unit') },
    { name: 'integration', dir: path.join(__dirname, 'integration') },
    { name: 'api',         dir: path.join(__dirname, 'api') },
  ].filter(c => !catFilter || c.name === catFilter);

  for (const { name, dir } of categories) {
    await runCategory(dir, name);
  }

  const totalMs = Date.now() - globalStart;

  if (jsonOut) {
    console.log(JSON.stringify({ results, totalMs }, null, 2));
  } else {
    printSummary(totalMs);
  }

  const failed = results.filter(r => r.status === 'fail').length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
