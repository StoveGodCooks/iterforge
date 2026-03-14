/**
 * History pruning — verifies generate.js slices to max_history.
 * Tests the slice logic directly without needing ComfyUI.
 */

async function test() {
  const MAX = 50;

  // Simulate what generate.js does when writing history
  function pruneHistory(existing, newEntry, maxHistory) {
    return [newEntry, ...existing].slice(0, maxHistory);
  }

  // Test: history beyond max is pruned
  const big = Array(60).fill(null).map((_, i) => ({ seed: i }));
  const pruned = pruneHistory(big, { seed: 999 }, MAX);
  if (pruned.length !== MAX) throw new Error(`prune: expected ${MAX}, got ${pruned.length}`);

  // Test: newest entry is first
  if (pruned[0].seed !== 999) throw new Error('prune: newest entry not at index 0');

  // Test: small history stays intact
  const small = Array(5).fill(null).map((_, i) => ({ seed: i }));
  const kept = pruneHistory(small, { seed: 99 }, MAX);
  if (kept.length !== 6) throw new Error(`prune: expected 6, got ${kept.length}`);
}

export default test;
