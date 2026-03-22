import * as comfyui from './comfyui.js';

// Priority chain per spec §7.1 (V1 scope — ComfyUI only)
const BACKENDS = [
  { name: 'comfyui', backend: comfyui }
];

/**
 * Find the best available backend.
 * @param {object} opts
 * @param {string|null} opts.override  - force a specific backend name
 * @param {boolean}     opts.noCloud   - never use cloud backends
 * @returns {{ name: string, backend: object }}
 */
export async function resolveBackend({ override = null, noCloud = false } = {}) {
  const candidates = override
    ? BACKENDS.filter(b => b.name === override)
    : BACKENDS;

  for (const { name, backend } of candidates) {
    const health = await backend.healthCheck();
    if (health.ok) return { name, backend };
  }

  const tried = candidates.map(b => b.name).join(', ');
  throw new Error(
    `[ERR_BACKEND_UNAVAILABLE] No backends available (tried: ${tried}).\n` +
    `Fix: iterforge start comfyui`
  );
}

/**
 * Generate via the best available backend.
 * Thin wrapper — all generate logic lives in the backend modules.
 */
export async function generate(opts) {
  const { name, backend } = await resolveBackend({
    override: opts.backend ?? null,
    noCloud:  opts.noCloud ?? false
  });
  const result = await backend.generate(opts);
  return { ...result, backend: name };
}
