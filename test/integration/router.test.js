import { resolveBackend } from '../../src/backends/router.js';

async function test() {
  // Test: resolveBackend throws when no backends available
  try {
    await resolveBackend({});
    throw new Error('router: should throw when no backends available');
  } catch (e) {
    if (!e.message.includes('ERR_BACKEND_UNAVAILABLE')) {
      throw new Error('router: wrong error code');
    }
  }

  // Test: resolveBackend rejects unknown override
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
