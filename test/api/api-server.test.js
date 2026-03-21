/**
 * API test: Live Express server endpoints
 * Requires the IterForge server to be running on localhost:3000.
 * Run: node src/server/dev-server.js  (in a separate terminal)
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let SkipError;
try {
  const runnerPath = path.resolve(__dirname, '../runner.js');
  const { SkipError: SE } = await import(pathToFileURL(runnerPath).href);
  SkipError = SE;
} catch {
  SkipError = class SkipError extends Error {
    constructor(msg) { super(msg); this.name = 'SkipError'; }
  };
}

// Server port — matches src/server/dev-server.js
const PORT = process.env.ITERFORGE_PORT ?? 3000;
const BASE = `http://127.0.0.1:${PORT}`;

async function get(endpoint, opts = {}) {
  const res = await fetch(`${BASE}${endpoint}`, opts);
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function post(endpoint, body) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export default async function test() {
  // ── Connectivity check — skip if server not reachable ────────────────────
  try {
    await fetch(`${BASE}/api/status`, { timeout: 3000 });
  } catch {
    throw new SkipError(`Server not running on ${BASE} — start with: node src/server/dev-server.js`);
  }
  console.log(`Connected to IterForge server at ${BASE}`);

  // ── GET /api/status ──────────────────────────────────────────────────────
  {
    const { status, body } = await get('/api/status');
    if (status !== 200) throw new Error(`GET /api/status returned ${status}`);
    if (!body || body.server !== 'ok') {
      throw new Error(`GET /api/status: expected { server: 'ok' }, got ${JSON.stringify(body)}`);
    }
    console.log(`GET /api/status → server=${body.server}, version=${body.version}`);
  }

  // ── GET /api/history ─────────────────────────────────────────────────────
  {
    const { status, body } = await get('/api/history');
    if (status !== 200) throw new Error(`GET /api/history returned ${status}`);
    if (!body || typeof body !== 'object') {
      throw new Error('GET /api/history: response is not an object');
    }
    if (!Array.isArray(body.generations)) {
      throw new Error('GET /api/history: .generations is not an array');
    }
    console.log(`GET /api/history → ${body.generations.length} entries`);
  }

  // ── GET /api/models ──────────────────────────────────────────────────────
  {
    const { status, body } = await get('/api/models');
    if (status !== 200) throw new Error(`GET /api/models returned ${status}`);
    if (!body || typeof body !== 'object') {
      throw new Error('GET /api/models: response is not an object');
    }
    if (!Array.isArray(body.available)) {
      throw new Error('GET /api/models: .available is not an array');
    }
    if (!('default' in body)) {
      throw new Error('GET /api/models: missing .default field');
    }
    console.log(`GET /api/models → ${body.available.length} models, default="${body.default}"`);
  }

  // ── GET /api/masterforge/status ──────────────────────────────────────────
  {
    const { status, body } = await get('/api/masterforge/status');
    if (status !== 200) throw new Error(`GET /api/masterforge/status returned ${status}`);
    if (!body || typeof body !== 'object') {
      throw new Error('GET /api/masterforge/status: response is not an object');
    }
    if (typeof body.available !== 'boolean') {
      throw new Error('GET /api/masterforge/status: .available is not a boolean');
    }
    console.log(`GET /api/masterforge/status → available=${body.available}`);
  }

  // ── POST /api/masterforge/reset-lock ────────────────────────────────────
  {
    const { status, body } = await post('/api/masterforge/reset-lock', {});
    if (status !== 200) throw new Error(`POST /api/masterforge/reset-lock returned ${status}`);
    if (!body || body.success !== true) {
      throw new Error(`POST /api/masterforge/reset-lock: expected { success: true }, got ${JSON.stringify(body)}`);
    }
    console.log('POST /api/masterforge/reset-lock → success=true');
  }

  // ── GET /api/generate/:jobId — nonexistent job returns 404 ───────────────
  {
    const fakeJobId = 'job-nonexistent-00000-xxxxx';
    const { status } = await get(`/api/generate/${fakeJobId}`);
    if (status !== 404) {
      throw new Error(`GET /api/generate/${fakeJobId}: expected 404, got ${status}`);
    }
    console.log(`GET /api/generate/${fakeJobId} → 404 (correct)`);
  }

  console.log('\nAll API endpoint tests passed');
}
