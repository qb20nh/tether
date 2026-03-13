import assert from 'node:assert/strict';
import test from '../test.ts';
import {
  DAILY_HISTORY_SCHEMA_VERSION,
  DAILY_PAYLOAD_SCHEMA_VERSION,
  normalizeDailyHistory,
  normalizeDailyPayload,
  normalizeDailyPayloadHeader,
} from '../../src/shared/daily_payload_schema.ts';

const createPayload = (overrides = {}) => ({
  schemaVersion: DAILY_PAYLOAD_SCHEMA_VERSION,
  poolVersion: 'pool-v1',
  dailyId: '2026-03-07',
  dailySlot: 7,
  canonicalKey: 'abc',
  generatedAtUtcMs: Date.UTC(2026, 2, 6, 12, 0, 0),
  hardInvalidateAtUtcMs: Date.UTC(2026, 2, 8, 0, 0, 0),
  level: {
    name: 'Daily 2026-03-07',
    grid: ['..', '..'],
    stitches: [[0, 0]],
    cornerCounts: [[0, 0, 2]],
  },
  ...overrides,
});

test('normalizeDailyPayloadHeader keeps publisher match fields only', () => {
  const header = normalizeDailyPayloadHeader({
    dailyId: 'not-validated-here',
    dailySlot: 5,
    canonicalKey: 'key-5',
    generatedAtUtcMs: 123,
  });

  assert.deepEqual(header, {
    schemaVersion: 0,
    poolVersion: '',
    dailyId: 'not-validated-here',
    dailySlot: 5,
    canonicalKey: 'key-5',
    generatedAtUtcMs: 123,
  });
  assert.equal(normalizeDailyPayloadHeader({ dailyId: '', dailySlot: 5, canonicalKey: 'x' }), null);
});

test('normalizeDailyPayload validates full consumer payload shape', () => {
  const payload = normalizeDailyPayload(createPayload());
  assert.ok(payload);

  assert.equal(payload.dailyId, '2026-03-07');
  assert.equal(payload.hardInvalidateAtUtcMs, Date.UTC(2026, 2, 8, 0, 0, 0));
  assert.deepEqual(payload.level.cornerCounts, [[0, 0, 2]]);
  assert.equal(normalizeDailyPayload(createPayload({ dailyId: '20260307' })), null);
});

test('normalizeDailyHistory filters malformed entries and preserves valid ones', () => {
  const history = normalizeDailyHistory({
    entries: [
      {
        dailyId: '2026-03-07',
        dailySlot: 7,
        canonicalKey: 'abc',
        poolVersion: 'pool-v1',
        publishedAtUtcMs: 123,
      },
      {
        dailyId: '',
        dailySlot: 8,
        canonicalKey: 'bad',
      },
      null,
    ],
  }, {
    schemaVersion: DAILY_HISTORY_SCHEMA_VERSION,
  });

  assert.deepEqual(history, {
    schemaVersion: DAILY_HISTORY_SCHEMA_VERSION,
    entries: [
      {
        dailyId: '2026-03-07',
        dailySlot: 7,
        canonicalKey: 'abc',
        poolVersion: 'pool-v1',
        publishedAtUtcMs: 123,
      },
    ],
  });
});
