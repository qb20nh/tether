import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from '../test.ts';
import { gzipSync } from 'node:zlib';
import { publishDailyLevel } from '../../scripts/publish_daily_level.ts';
import { normalizeDailyHistory } from '../../src/shared/daily_payload_schema.ts';

type DailyHistory = ReturnType<typeof normalizeDailyHistory>;
type DailyHistoryEntry = DailyHistory['entries'][number];

const writeJson = (filePath: string, value: unknown) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const createFixture = () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-publish-test-'));

  const manifestFile = path.join(tmpDir, 'daily_pool_manifest.json');
  const overridesFile = path.join(tmpDir, 'daily_overrides.bin.gz');
  const historyFile = path.join(tmpDir, 'daily', 'history.json');
  const todayFile = path.join(tmpDir, 'daily', 'today.json');

  writeJson(manifestFile, {
    schemaVersion: 1,
    poolVersion: 'test-v1',
    epochUtcDate: '2026-01-01',
    maxSlots: 2,
    baseVariantId: 0,
  });

  fs.writeFileSync(overridesFile, gzipSync(Buffer.from([0x44, 0x01, 0x01]), { level: 9 }));

  writeJson(historyFile, {
    schemaVersion: 1,
    entries: [],
  });

  return {
    tmpDir,
    manifestFile,
    overridesFile,
    historyFile,
    todayFile,
  };
};

const writeFixtureHistory = (historyFile: string, entries: DailyHistoryEntry[]) => {
  writeJson(historyFile, {
    schemaVersion: 1,
    entries,
  });
};

test('publish_daily_level emits today payload and appends history', () => {
  const fx = createFixture();
  const nowMs = Date.UTC(2026, 0, 1, 0, 0, 5);
  const summary = publishDailyLevel({
    manifestFile: fx.manifestFile,
    overridesFile: fx.overridesFile,
    historyFile: fx.historyFile,
    todayFile: fx.todayFile,
    nowMs,
    dailySecret: 'test-secret',
  });

  const today = JSON.parse(fs.readFileSync(fx.todayFile, 'utf8'));
  const history = JSON.parse(fs.readFileSync(fx.historyFile, 'utf8')) as DailyHistory;

  assert.equal(summary.ok, true);
  assert.equal(summary.preservedExistingDaily, false);
  assert.equal(today.dailyId, '2026-01-01');
  assert.equal(Number.isInteger(today.dailySlot), true);
  assert.equal(Array.isArray(today.level.grid), true);
  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].dailyId, '2026-01-01');
});

test('publish_daily_level keeps publishing past maxSlots by evicting oldest history', () => {
  const fx = createFixture();
  publishDailyLevel({
    manifestFile: fx.manifestFile,
    overridesFile: fx.overridesFile,
    historyFile: fx.historyFile,
    todayFile: fx.todayFile,
    nowMs: Date.UTC(2026, 0, 1, 0, 0, 1),
    dailySecret: 'test-secret',
  });
  publishDailyLevel({
    manifestFile: fx.manifestFile,
    overridesFile: fx.overridesFile,
    historyFile: fx.historyFile,
    todayFile: fx.todayFile,
    nowMs: Date.UTC(2026, 0, 2, 0, 0, 1),
    dailySecret: 'test-secret',
  });
  const summary = publishDailyLevel({
    manifestFile: fx.manifestFile,
    overridesFile: fx.overridesFile,
    historyFile: fx.historyFile,
    todayFile: fx.todayFile,
    nowMs: Date.UTC(2026, 0, 3, 0, 0, 1),
    dailySecret: 'test-secret',
  });

  const history = JSON.parse(fs.readFileSync(fx.historyFile, 'utf8'));
  assert.equal(summary.ok, true);
  assert.equal(summary.dailyId, '2026-01-03');
  assert.equal(history.entries.length, 2);
  assert.equal(history.entries.some((entry: DailyHistoryEntry) => entry.dailyId === '2026-01-01'), false);
  assert.equal(history.entries.some((entry: DailyHistoryEntry) => entry.dailyId === '2026-01-02'), true);
  assert.equal(history.entries.some((entry: DailyHistoryEntry) => entry.dailyId === '2026-01-03'), true);
});

test('publish_daily_level is idempotent within the same UTC day', () => {
  const fx = createFixture();
  const firstNowMs = Date.UTC(2026, 0, 1, 0, 0, 5);
  const secondNowMs = Date.UTC(2026, 0, 1, 12, 34, 56);

  publishDailyLevel({
    manifestFile: fx.manifestFile,
    overridesFile: fx.overridesFile,
    historyFile: fx.historyFile,
    todayFile: fx.todayFile,
    nowMs: firstNowMs,
    dailySecret: 'test-secret',
  });

  const firstTodayRaw = fs.readFileSync(fx.todayFile, 'utf8');
  const firstToday = JSON.parse(firstTodayRaw);

  publishDailyLevel({
    manifestFile: fx.manifestFile,
    overridesFile: fx.overridesFile,
    historyFile: fx.historyFile,
    todayFile: fx.todayFile,
    nowMs: secondNowMs,
    dailySecret: 'test-secret',
  });

  const secondTodayRaw = fs.readFileSync(fx.todayFile, 'utf8');
  const secondToday = JSON.parse(secondTodayRaw);
  const history = JSON.parse(fs.readFileSync(fx.historyFile, 'utf8')) as DailyHistory;

  assert.equal(secondToday.generatedAtUtcMs, firstToday.generatedAtUtcMs);
  assert.equal(secondTodayRaw, firstTodayRaw);
  assert.equal(history.entries.length, 1);
});

test('publish_daily_level preserves existing daily when artifacts drift mid-day', () => {
  const fx = createFixture();
  const firstNowMs = Date.UTC(2026, 0, 1, 0, 0, 5);
  const secondNowMs = Date.UTC(2026, 0, 1, 12, 34, 56);

  publishDailyLevel({
    manifestFile: fx.manifestFile,
    overridesFile: fx.overridesFile,
    historyFile: fx.historyFile,
    todayFile: fx.todayFile,
    nowMs: firstNowMs,
    dailySecret: 'test-secret',
  });

  const firstTodayRaw = fs.readFileSync(fx.todayFile, 'utf8');
  const firstHistoryRaw = fs.readFileSync(fx.historyFile, 'utf8');

  fs.writeFileSync(fx.overridesFile, Buffer.from('corrupt'));
  const manifest = JSON.parse(fs.readFileSync(fx.manifestFile, 'utf8'));
  manifest.poolVersion = 'test-v2';
  writeJson(fx.manifestFile, manifest);

  const summary = publishDailyLevel({
    manifestFile: fx.manifestFile,
    overridesFile: fx.overridesFile,
    historyFile: fx.historyFile,
    todayFile: fx.todayFile,
    nowMs: secondNowMs,
    dailySecret: 'test-secret',
  });

  const secondTodayRaw = fs.readFileSync(fx.todayFile, 'utf8');
  const secondHistoryRaw = fs.readFileSync(fx.historyFile, 'utf8');

  assert.equal(summary.ok, true);
  assert.equal(summary.preservedExistingDaily, true);
  assert.equal(secondTodayRaw, firstTodayRaw);
  assert.equal(secondHistoryRaw, firstHistoryRaw);
});

test('publish_daily_level trims history to manifest maxSlots', () => {
  const fx = createFixture();
  const manifest = JSON.parse(fs.readFileSync(fx.manifestFile, 'utf8'));
  manifest.maxSlots = 5;
  writeJson(fx.manifestFile, manifest);

  writeFixtureHistory(fx.historyFile, [
    {
      dailyId: '2025-12-27',
      dailySlot: 101,
      canonicalKey: 'key-101',
      poolVersion: 'test-v1',
      publishedAtUtcMs: Date.UTC(2025, 11, 27),
    },
    {
      dailyId: '2025-12-28',
      dailySlot: 102,
      canonicalKey: 'key-102',
      poolVersion: 'test-v1',
      publishedAtUtcMs: Date.UTC(2025, 11, 28),
    },
    {
      dailyId: '2025-12-29',
      dailySlot: 103,
      canonicalKey: 'key-103',
      poolVersion: 'test-v1',
      publishedAtUtcMs: Date.UTC(2025, 11, 29),
    },
    {
      dailyId: '2025-12-30',
      dailySlot: 104,
      canonicalKey: 'key-104',
      poolVersion: 'test-v1',
      publishedAtUtcMs: Date.UTC(2025, 11, 30),
    },
    {
      dailyId: '2025-12-31',
      dailySlot: 105,
      canonicalKey: 'key-105',
      poolVersion: 'test-v1',
      publishedAtUtcMs: Date.UTC(2025, 11, 31),
    },
  ]);

  const nowMs = Date.UTC(2026, 0, 1, 0, 0, 5);
  publishDailyLevel({
    manifestFile: fx.manifestFile,
    overridesFile: fx.overridesFile,
    historyFile: fx.historyFile,
    todayFile: fx.todayFile,
    nowMs,
    dailySecret: 'test-secret',
  });

  const history = JSON.parse(fs.readFileSync(fx.historyFile, 'utf8'));
  assert.equal(history.entries.length, 5);
  assert.equal(history.entries.some((entry: DailyHistoryEntry) => entry.dailyId === '2025-12-27'), false);
  assert.equal(history.entries.some((entry: DailyHistoryEntry) => entry.dailyId === '2026-01-01'), true);
});

test('publish_daily_level evicts the oldest entry even when history is unsorted on disk', () => {
  const fx = createFixture();
  writeFixtureHistory(fx.historyFile, [
    {
      dailyId: '2026-01-02',
      dailySlot: 2,
      canonicalKey: 'key-2',
      poolVersion: 'test-v1',
      publishedAtUtcMs: Date.UTC(2026, 0, 2),
    },
    {
      dailyId: '2026-01-01',
      dailySlot: 1,
      canonicalKey: 'key-1',
      poolVersion: 'test-v1',
      publishedAtUtcMs: Date.UTC(2026, 0, 1),
    },
  ]);

  publishDailyLevel({
    manifestFile: fx.manifestFile,
    overridesFile: fx.overridesFile,
    historyFile: fx.historyFile,
    todayFile: fx.todayFile,
    nowMs: Date.UTC(2026, 0, 3, 0, 0, 1),
    dailySecret: 'test-secret',
  });

  const history = JSON.parse(fs.readFileSync(fx.historyFile, 'utf8')) as DailyHistory;
  assert.deepEqual(
    history.entries.map((entry: DailyHistoryEntry) => entry.dailyId),
    ['2026-01-02', '2026-01-03'],
  );
});
