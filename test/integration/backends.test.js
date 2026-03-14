/**
 * Backend router tests — no live ComfyUI needed.
 * Tests the priority chain logic and error paths.
 */
import { resolveBackend } from '../../src/backends/router.js';
import * as comfyui from '../../src/backends/comfyui.js';

async function test() {
  // Test: resolveBackend with explicit unavailable override
  try {
    await resolveBackend({ override: 'comfyui' });
    // If ComfyUI happens to be running, this passes — that's fine
  } catch (e) {
    if (!e.message.includes('ERR_BACKEND_UNAVAILABLE')) {
      throw new Error('router override: wrong error code — got: ' + e.message);
    }
  }

  // Test: healthCheck returns { ok: false } when ComfyUI not running
  const health = await comfyui.healthCheck();
  if (typeof health.ok !== 'boolean') throw new Error('healthCheck: missing ok field');
  if (!health.ok && !health.code) throw new Error('healthCheck: failed result missing code');
  if (!health.ok && !health.fix)  throw new Error('healthCheck: failed result missing fix');

  // Test: generate throws meaningful error when ComfyUI not running
  if (!health.ok) {
    try {
      await comfyui.generate({ type: 'arena', positive: 'test', negative: 'test', outputDir: '/tmp' });
      throw new Error('generate: should throw when ComfyUI not running');
    } catch (e) {
      if (e.message.includes('should throw')) throw e;
      // Any connection error is acceptable — just not a silent failure
    }
  }
}

export default test;
