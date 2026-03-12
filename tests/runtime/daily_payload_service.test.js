import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDailyPayloadService,
  normalizeDailyPayload,
  utcDateIdFromMs,
} from '../../src/app/daily_payload_service.ts';

const DAILY_URL = 'https://example.com/daily/today.json';

const createResponse = ({ ok = true, json = null } = {}) => ({
  ok,
  async json() {
    return json;
  },
});

const createDailyPayload = ({
  dailyId = '2026-03-07',
  hardInvalidateAtUtcMs = Date.UTC(2026, 2, 7, 0, 0, 0),
} = {}) => ({
  schemaVersion: 1,
  poolVersion: 'pool-v1',
  dailyId,
  dailySlot: 7,
  canonicalKey: 'abc',
  generatedAtUtcMs: Date.UTC(2026, 2, 6, 12, 0, 0),
  hardInvalidateAtUtcMs,
  level: {
    name: `Daily ${dailyId}`,
    grid: ['..', '..'],
    stitches: [[0, 0]],
    cornerCounts: [[0, 0, 2]],
  },
});

test('normalizeDailyPayload accepts valid payload and rejects malformed payloads', () => {
  const valid = createDailyPayload();
  const normalized = normalizeDailyPayload(valid);
  assert.equal(normalized.dailyId, '2026-03-07');
  assert.equal(Array.isArray(normalized.level.grid), true);
  assert.equal(normalized.level.grid.length, 2);

  assert.equal(normalizeDailyPayload(null), null);
  assert.equal(normalizeDailyPayload({}), null);
  assert.equal(normalizeDailyPayload({ ...valid, dailyId: '20260307' }), null);
  assert.equal(normalizeDailyPayload({ ...valid, hardInvalidateAtUtcMs: 'x' }), null);
  assert.equal(normalizeDailyPayload({ ...valid, level: { ...valid.level, grid: [] } }), null);
  assert.equal(normalizeDailyPayload({ ...valid, level: { ...valid.level, stitches: [[0]] } }), null);
  assert.equal(normalizeDailyPayload({ ...valid, level: { ...valid.level, cornerCounts: [[0, 1]] } }), null);
});

test('resolveDailyBootPayload returns empty boot payload when fetch fails', async () => {
  const service = createDailyPayloadService({
    dailyPayloadUrl: DAILY_URL,
    fetchImpl: async () => createResponse({ ok: false }),
  });

  const out = await service.resolveDailyBootPayload();
  assert.deepEqual(out, {
    dailyLevel: null,
    dailyId: null,
    hardInvalidateAtUtcMs: null,
    stalePayload: null,
  });
});

test('resolveDailyBootPayload returns stale payload when remote daily is in the future', async () => {
  const nowMs = Date.UTC(2026, 2, 7, 12, 0, 0);
  const payload = createDailyPayload({ dailyId: '2026-03-08' });

  const service = createDailyPayloadService({
    dailyPayloadUrl: DAILY_URL,
    now: () => nowMs,
    fetchImpl: async () => createResponse({ json: payload }),
  });

  const out = await service.resolveDailyBootPayload();
  assert.equal(out.dailyLevel, null);
  assert.equal(out.dailyId, null);
  assert.equal(out.hardInvalidateAtUtcMs, payload.hardInvalidateAtUtcMs);
  assert.deepEqual(out.stalePayload, normalizeDailyPayload(payload));
});

test('resolveDailyBootPayload performs stale bypass fetch when grace window elapsed', async () => {
  const nowMs = Date.UTC(2026, 2, 7, 12, 0, 0);
  const graceMs = 60 * 1000;
  const stale = createDailyPayload({
    dailyId: '2026-03-06',
    hardInvalidateAtUtcMs: nowMs - graceMs - 1,
  });
  const fresh = createDailyPayload({ dailyId: '2026-03-07' });

  const urls = [];
  let callCount = 0;
  const service = createDailyPayloadService({
    dailyPayloadUrl: DAILY_URL,
    now: () => nowMs,
    dailyHardInvalidateGraceMs: graceMs,
    fetchImpl: async (url) => {
      urls.push(url);
      callCount += 1;
      return createResponse({ json: callCount === 1 ? stale : fresh });
    },
  });

  const out = await service.resolveDailyBootPayload();
  assert.equal(urls.length, 2);
  assert.equal(urls[1].includes('_dailycb='), true);
  assert.equal(out.dailyId, '2026-03-07');
  assert.equal(out.stalePayload, null);
  assert.deepEqual(out.dailyLevel, normalizeDailyPayload(fresh).level);
});

test('resolveDailyBootPayload keeps stale payload when still not today after bypass', async () => {
  const nowMs = Date.UTC(2026, 2, 7, 12, 0, 0);
  const stale = createDailyPayload({
    dailyId: '2026-03-05',
    hardInvalidateAtUtcMs: nowMs - (60 * 1000) - 1,
  });

  const service = createDailyPayloadService({
    dailyPayloadUrl: DAILY_URL,
    now: () => nowMs,
    fetchImpl: async () => createResponse({ json: stale }),
  });

  const out = await service.resolveDailyBootPayload();
  assert.equal(out.dailyLevel, null);
  assert.equal(out.dailyId, null);
  assert.equal(out.hardInvalidateAtUtcMs, stale.hardInvalidateAtUtcMs);
  assert.deepEqual(out.stalePayload, normalizeDailyPayload(stale));
});

test('setupDailyHardInvalidationWatcher refetches on visibilitychange once threshold passes', async () => {
  const baseMs = Date.UTC(2026, 2, 7, 0, 0, 0);
  let nowMs = baseMs + 500;
  let reloadCount = 0;

  const listeners = new Map();
  const windowObj = {
    location: {
      reload() {
        reloadCount += 1;
      },
    },
    setTimeout() {
      return 1;
    },
  };
  const documentObj = {
    visibilityState: 'hidden',
    addEventListener(eventName, handler) {
      listeners.set(eventName, handler);
    },
  };

  const payloadToday = createDailyPayload({ dailyId: utcDateIdFromMs(baseMs) });
  let fetchCount = 0;
  const service = createDailyPayloadService({
    dailyPayloadUrl: DAILY_URL,
    dailyHardInvalidateGraceMs: 1000,
    now: () => nowMs,
    fetchImpl: async () => {
      fetchCount += 1;
      return createResponse({ json: payloadToday });
    },
    windowObj,
    documentObj,
  });

  service.setupDailyHardInvalidationWatcher({
    dailyId: '2026-03-06',
    hardInvalidateAtUtcMs: baseMs,
  });

  assert.equal(typeof listeners.get('visibilitychange'), 'function');
  assert.equal(fetchCount, 0);
  assert.equal(reloadCount, 0);

  nowMs = baseMs + 1500;
  documentObj.visibilityState = 'visible';
  listeners.get('visibilitychange')();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(fetchCount, 1);
  assert.equal(reloadCount, 1);
});
