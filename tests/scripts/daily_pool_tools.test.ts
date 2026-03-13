import assert from 'node:assert/strict';
import test from '../test.ts';
import {
  buildSecretPermutation,
  computeDayOrdinal,
  materializeDailyLevelForSlot,
  replayWitnessAndValidate,
  selectDailyCandidateForSlot,
  toDailyPayloadLevel,
  utcStartMsFromDateId,
  addUtcDaysToDateId,
} from '../../scripts/daily_pool_tools.ts';
import {
  decodeDailyOverridesPayload,
  encodeDailyOverridesPayload,
} from '../../src/daily_pool_codec.ts';

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

test('daily pool helpers validate inputs and normalize payload fields', () => {
  assert.throws(() => buildSecretPermutation('', 8), /non-empty string/);
  assert.throws(() => buildSecretPermutation('secret', 0), /positive integer/);
  assert.throws(() => utcStartMsFromDateId('not-a-date'), /Invalid UTC date id/);
  assert.throws(() => addUtcDaysToDateId('2026-01-01', 1.5), /deltaDays must be an integer/);

  assert.deepEqual(toDailyPayloadLevel(null, '2026-01-01'), {
    name: 'Daily 2026-01-01',
    grid: [],
    stitches: [],
    cornerCounts: [],
  });
});

test('selectDailyCandidateForSlot uses the best in-window variant and falls back past the difficulty window', () => {
  const baseCandidate = materializeDailyLevelForSlot(0, null, 0);
  const variantOne = materializeDailyLevelForSlot(0, { 0: 1 }, 0);
  const variantTwo = materializeDailyLevelForSlot(0, { 0: 2 }, 0);

  const bestWindowCandidate = selectDailyCandidateForSlot(0, {
    infiniteCanonicalKeys: new Set<string>(),
    dailyCanonicalKeys: new Set<string>(),
    maxVariantProbe: 2,
    baseVariantId: 0,
    difficultyVariantWindow: 2,
  });
  assert.equal(bestWindowCandidate.variantId === 0 || bestWindowCandidate.variantId === 1, true);

  const fallbackCandidate = selectDailyCandidateForSlot(0, {
    infiniteCanonicalKeys: new Set<string>(),
    dailyCanonicalKeys: new Set<string>([
      baseCandidate.canonicalKey,
      variantOne.canonicalKey,
    ]),
    maxVariantProbe: 2,
    baseVariantId: 0,
    difficultyVariantWindow: 1,
  });
  assert.equal(fallbackCandidate.variantId, 2);
  assert.equal(fallbackCandidate.canonicalKey, variantTwo.canonicalKey);
});

test('selectDailyCandidateForSlot rejects impossible or invalid ranges', () => {
  assert.throws(() => {
    selectDailyCandidateForSlot(0, {
      infiniteCanonicalKeys: new Set<string>(),
      dailyCanonicalKeys: new Set<string>(),
      maxVariantProbe: -1,
      baseVariantId: 0,
    });
  }, /maxVariantProbe/);

  assert.throws(() => {
    selectDailyCandidateForSlot(0, {
      infiniteCanonicalKeys: new Set<string>(),
      dailyCanonicalKeys: new Set<string>(),
      difficultyVariantWindow: 0,
    });
  }, /difficultyVariantWindow/);

  const lockedKeys = new Set<string>();
  for (let variantId = 0; variantId <= 2; variantId += 1) {
    lockedKeys.add(materializeDailyLevelForSlot(0, { 0: variantId }, 0).canonicalKey);
  }

  assert.throws(() => {
    selectDailyCandidateForSlot(0, {
      infiniteCanonicalKeys: lockedKeys,
      dailyCanonicalKeys: new Set<string>(),
      maxVariantProbe: 2,
      baseVariantId: 0,
      difficultyVariantWindow: 3,
    });
  }, /Unable to find unique solvable daily variant/);
});
