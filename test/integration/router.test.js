import { resolveBackend } from '../../src/backends/router.js';

async function test() {
  // Test: resolveBackend throws ERR_BACKEND_UNAVAILABLE for unknown override.
  // Using an override forces a specific (nonexistent) backend so this test
  // is deterministic regardless of whether ComfyUI happens to be running.
  try {
    await resolveBackend({ override: '__test_nonexistent_backend__' });
    throw new Error('router: should throw for unknown backend');
  } catch (e) {
    if (!e.message.includes('ERR_BACKEND_UNAVAILABLE')) {
      throw new Error('router: wrong error code');
    }
  }

  // Test: resolveBackend rejects any unknown override name
  try {
    await resolveBackend({ override: 'nonexistent' });
    throw new Error('router: should throw for unknown backend');
  } catch (e) {
    if (!e.message.includes('ERR_BACKEND_UNAVAILABLE')) {
      throw new Error('router: wrong error for unknown backend');
    }
  }
}

export default test;
