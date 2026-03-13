import assert from 'node:assert/strict';
import test from 'node:test';
import { solveLevel } from '../../scripts/verify_level_properties.ts';

test('solveLevel preserves distinct canonical path counts', () => {
  const result = solveLevel({
    grid: ['...', '...'],
    stitches: [],
    cornerCounts: [],
  }, {
    timeMs: 1000,
    minRaw: 999,
    minCanonical: 999,
    minHintOrders: 999,
    minCornerOrders: 999,
    maxSolutions: 1000,
  });

  assert.equal(result.rawSolutions, 16);
  assert.equal(result.canonicalSolutions, 8);
});
