import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { publishDailyLevel } from '../../scripts/publish_daily_level.js';

const writeJson = (filePath, value) => {
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
  const history = JSON.parse(fs.readFileSync(fx.historyFile, 'utf8'));

  assert.equal(summary.ok, true);
  assert.equal(today.dailyId, '2026-01-01');
  assert.equal(Number.isInteger(today.dailySlot), true);
  assert.equal(Array.isArray(today.level.grid), true);
  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].dailyId, '2026-01-01');
});

test('publish_daily_level fails when pool ordinal is exhausted', () => {
  const fx = createFixture();
  const nowMs = Date.UTC(2026, 0, 3, 0, 0, 0);

  assert.throws(() => {
    publishDailyLevel({
      manifestFile: fx.manifestFile,
      overridesFile: fx.overridesFile,
      historyFile: fx.historyFile,
      todayFile: fx.todayFile,
      nowMs,
      dailySecret: 'test-secret',
    });
  }, /Daily pool exhausted/);
});
