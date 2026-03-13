import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from '../test.ts';
import { vi } from 'vitest';

const withProcessArgv = (t: { after: (cleanup: () => void) => void }, argv: string[]) => {
  const originalArgv = [...process.argv];
  process.argv = argv;
  t.after(() => {
    process.argv = originalArgv;
  });
};

const withProcessExitTrap = (t: { after: (cleanup: () => void) => void }) => {
  const exitCalls: Array<number | undefined> = [];
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCalls.push(code);
    throw new Error(`process.exit:${code}`);
  }) as never);
  t.after(() => {
    exitSpy.mockRestore();
  });
  return exitCalls;
};

test('verify_infinite_generation entrypoint completes with tiny real sample sizes', async (t) => {
  const originalArgv = [...process.argv];
  const logs: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
    logs.push(String(message ?? ''));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  process.argv = [
    process.execPath,
    path.resolve(process.cwd(), 'scripts/verify_infinite_generation.ts'),
    '--samples', '2',
    '--coverage', '2',
    '--canonical-scan', '2',
    '--perf-runs', '2',
    '--solve-time-ms', '5',
    '--retry-solve-time-ms', '5',
    '--min-unique-ratio', '0',
    '--json',
  ];
  t.after(() => {
    process.argv = originalArgv;
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.resetModules();
  });

  const successModulePath = '../../scripts/verify_infinite_generation.ts?case=tiny-success';
  await import(successModulePath);
  assert.equal(logs.some((line) => line.includes('"ok": true')), true);
  assert.equal(logs.some((line) => line.includes('"performance"')), true);
});

test('verify_infinite_generation reports invalid feature-ratio specs', async (t) => {
  const exitCalls = withProcessExitTrap(t);
  const originalArgv = [...process.argv];
  const errors: string[] = [];
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
    errors.push(String(message ?? ''));
  });
  process.argv = [
    process.execPath,
    path.resolve(process.cwd(), 'scripts/verify_infinite_generation.ts'),
    '--min-feature-unique-ratio', 'badpair',
  ];
  t.after(() => {
    process.argv = originalArgv;
    errorSpy.mockRestore();
    vi.resetModules();
  });

  await assert.rejects(
    import('../../scripts/verify_infinite_generation.ts?case=tiny-error' as string),
    /process\.exit:1/,
  );
  assert.deepEqual(exitCalls, [1]);
  assert.equal(errors.some((line) => line.includes('Invalid feature ratio pair')), true);
});

test('verify_daily_pool entrypoint prints a JSON summary with mocked pool helpers', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-daily-pool-'));
  const manifestFile = path.join(tmpDir, 'manifest.json');
  const overridesFile = path.join(tmpDir, 'daily_overrides.bin.gz');
  fs.writeFileSync(manifestFile, JSON.stringify({
    maxSlots: 2,
    poolDigest: 'digest-ok',
    baseVariantId: 0,
  }));
  fs.writeFileSync(overridesFile, 'stub');

  const logs: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
    logs.push(String(message ?? ''));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.doMock('../../src/infinite.ts', () => ({
    INFINITE_MAX_LEVELS: 4,
  }));
  vi.doMock('../../scripts/daily_pool_tools.ts', () => ({
    DAILY_POOL_BASE_VARIANT_ID: 0,
    DAILY_POOL_MAX_SLOTS: 4,
    buildInfiniteCanonicalKeySet: () => new Set<string>(['infinite:0']),
    computePoolDigest: (records: Iterable<string>) => (
      Array.from(records).join('|') === '0:0:daily:0|1:0:daily:1' ? 'digest-ok' : 'digest-bad'
    ),
    materializeDailyLevelForSlot: (slot: number) => ({
      canonicalKey: `daily:${slot}`,
      level: { grid: ['..'] },
      variantId: 0,
    }),
    readDailyOverridesGzipFile: () => ({}),
    replayWitnessAndValidate: () => true,
  }));
  withProcessArgv(t, [
    process.execPath,
    path.resolve(process.cwd(), 'scripts/verify_daily_pool.ts'),
    '--manifest', manifestFile,
    '--overrides', overridesFile,
    '--max-slots', '2',
    '--json',
  ]);
  t.after(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    stdoutSpy.mockRestore();
    vi.resetModules();
    vi.doUnmock('../../src/infinite.ts');
    vi.doUnmock('../../scripts/daily_pool_tools.ts');
  });

  const summaryOkModulePath = '../../scripts/verify_daily_pool.ts?case=summary-ok';
  await import(summaryOkModulePath);
  assert.equal(logs.some((line) => line.includes('"ok": true')), true);
  assert.equal(logs.some((line) => line.includes('"checkedSlots": 2')), true);
});

test('verify_daily_pool exits non-zero when mocked slot validation fails', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-daily-pool-fail-'));
  const manifestFile = path.join(tmpDir, 'manifest.json');
  const overridesFile = path.join(tmpDir, 'daily_overrides.bin.gz');
  fs.writeFileSync(manifestFile, JSON.stringify({
    maxSlots: 1,
    poolDigest: 'digest-ok',
    baseVariantId: 0,
  }));
  fs.writeFileSync(overridesFile, 'stub');

  const exitCalls = withProcessExitTrap(t);
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.doMock('../../src/infinite.ts', () => ({
    INFINITE_MAX_LEVELS: 4,
  }));
  vi.doMock('../../scripts/daily_pool_tools.ts', () => ({
    DAILY_POOL_BASE_VARIANT_ID: 0,
    DAILY_POOL_MAX_SLOTS: 4,
    buildInfiniteCanonicalKeySet: () => new Set<string>(),
    computePoolDigest: () => 'digest-ok',
    materializeDailyLevelForSlot: () => ({
      canonicalKey: 'daily:0',
      level: { grid: ['..'] },
      variantId: 0,
    }),
    readDailyOverridesGzipFile: () => ({}),
    replayWitnessAndValidate: () => false,
  }));
  withProcessArgv(t, [
    process.execPath,
    path.resolve(process.cwd(), 'scripts/verify_daily_pool.ts'),
    '--manifest', manifestFile,
    '--overrides', overridesFile,
    '--max-slots', '1',
  ]);
  t.after(() => {
    stdoutSpy.mockRestore();
    errorSpy.mockRestore();
    vi.resetModules();
    vi.doUnmock('../../src/infinite.ts');
    vi.doUnmock('../../scripts/daily_pool_tools.ts');
  });

  await assert.rejects(
    import('../../scripts/verify_daily_pool.ts?case=summary-fail' as string),
    /process\.exit:1/,
  );
  assert.equal(exitCalls.length >= 1, true);
  assert.equal(exitCalls.every((code) => code === 1), true);
});
