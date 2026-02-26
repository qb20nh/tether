import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeDailyOverridesPayload,
  encodeDailyOverridesPayload,
} from '../../src/daily_pool_codec.js';
import {
  buildSecretPermutation,
  computeDayOrdinal,
  materializeDailyLevelForSlot,
  replayWitnessAndValidate,
} from '../../scripts/daily_pool_tools.js';

test('daily override payload codec round-trips entries', () => {
  const overrides = new Map([
    [2, 7],
    [14, 3],
    [71, 12],
  ]);

  const encoded = encodeDailyOverridesPayload(overrides, 12);
  const decoded = decodeDailyOverridesPayload(encoded.payload);

  assert.deepEqual({ ...decoded }, {
    2: 7,
    14: 3,
    71: 12,
  });
});

test('secret permutation is deterministic and non-repeating', () => {
  const a = buildSecretPermutation('test-secret', 64, 'ctx-v1');
  const b = buildSecretPermutation('test-secret', 64, 'ctx-v1');

  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 64);
});

test('day ordinal uses UTC date boundaries', () => {
  assert.equal(computeDayOrdinal('2026-01-01', '2026-01-01'), 0);
  assert.equal(computeDayOrdinal('2026-01-02', '2026-01-01'), 1);
  assert.equal(computeDayOrdinal('2025-12-31', '2026-01-01'), -1);
});

test('materialized daily level witness validates', () => {
  const daily = materializeDailyLevelForSlot(0, null, 0);
  assert.equal(typeof daily.canonicalKey, 'string');
  assert.equal(daily.canonicalKey.length > 0, true);
  assert.equal(replayWitnessAndValidate(daily.level), true);
});
