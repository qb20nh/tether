import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from '../test.ts';
import { vi } from 'vitest';

const withTempCwd = (t: { after: (cleanup: () => void) => void }, name: string) => {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  process.chdir(tmpDir);
  t.after(() => {
    process.chdir(originalCwd);
  });
  return tmpDir;
};

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

test('build_infinite_overrides entrypoint writes payloads and handles invalid arguments', async (t) => {
  const tmpDir = withTempCwd(t, 'build-infinite-overrides-');
  const outFile = path.join(tmpDir, 'infinite_overrides.bin.gz');
  const logs: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
    logs.push(String(message ?? ''));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  t.after(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.resetModules();
  });

  withProcessArgv(t, [
    process.execPath,
    path.join(tmpDir, 'scripts', 'build_infinite_overrides.ts'),
    '--max-levels', '5',
    '--max-variant-probe', '12',
    '--out-bin', outFile,
    '--json',
  ]);
  const successModulePath = '../../scripts/build_infinite_overrides.ts?case=entry-success';
  await import(successModulePath);
  assert.equal(fs.existsSync(outFile), true);
  assert.equal(logs.some((line) => line.includes('"ok": true')), true);

  vi.resetModules();
  const exitCalls = withProcessExitTrap(t);
  withProcessArgv(t, [
    process.execPath,
    path.join(tmpDir, 'scripts', 'build_infinite_overrides.ts'),
    '--max-levels', '999999',
  ]);
  await assert.rejects(
    import('../../scripts/build_infinite_overrides.ts?case=entry-error' as string),
    /process\.exit:1/,
  );
  assert.deepEqual(exitCalls, [1]);
});

test('build_infinite_overrides resolves duplicate canonical signatures with fallback variants', async (t) => {
  const tmpDir = withTempCwd(t, 'build-infinite-overrides-collision-');
  const outFile = path.join(tmpDir, 'infinite_overrides.bin.gz');
  const logs: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
    logs.push(String(message ?? ''));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.doMock('../../src/infinite.ts', () => ({
    INFINITE_CANDIDATE_VARIANTS: 2,
    INFINITE_MAX_LEVELS: 3,
    selectDefaultInfiniteCandidate: (levelIndex: number) => ({
      canonicalSignature: levelIndex <= 1 ? 'dup' : `sig:${levelIndex}:default`,
    }),
    generateInfiniteLevelFromVariant: (levelIndex: number, variantId: number) => ({
      levelIndex,
      variantId,
    }),
  }));
  vi.doMock('../../src/infinite_canonical.ts', () => ({
    canonicalConstraintSignature: (level: { levelIndex: number; variantId?: number }) => (
      level.levelIndex === 1 && level.variantId === 2
        ? 'sig:1:resolved'
        : `sig:${level.levelIndex}:${level.variantId ?? 'default'}`
    ),
  }));
  vi.doMock('../../src/shared/packed_override_codec.ts', () => ({
    encodePackedOverridePayload: ({ overrides, maxVariantUsed }: { overrides: Map<number, number>; maxVariantUsed: number }) => ({
      payload: Uint8Array.from([0x49, 0x01, overrides.size, maxVariantUsed]),
      variantBits: maxVariantUsed > 1 ? 2 : 1,
      entryCount: overrides.size,
    }),
  }));
  t.after(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.resetModules();
    vi.doUnmock('../../src/infinite.ts');
    vi.doUnmock('../../src/infinite_canonical.ts');
    vi.doUnmock('../../src/shared/packed_override_codec.ts');
  });

  withProcessArgv(t, [
    process.execPath,
    path.join(tmpDir, 'scripts', 'build_infinite_overrides.ts'),
    '--max-levels', '3',
    '--max-variant-probe', '4',
    '--out-bin', outFile,
    '--json',
  ]);
  const collisionModulePath = '../../scripts/build_infinite_overrides.ts?case=collision';
  await import(collisionModulePath);

  assert.equal(fs.existsSync(outFile), true);
  assert.equal(logs.some((line) => line.includes('"collisionsResolved": 1')), true);
  assert.equal(logs.some((line) => line.includes('"overrideCount": 1')), true);
});

test('build_daily_overrides entrypoint writes manifest and override payloads', async (t) => {
  const tmpDir = withTempCwd(t, 'build-daily-overrides-');
  const outBinFile = path.join(tmpDir, 'daily_overrides.bin.gz');
  const outManifestFile = path.join(tmpDir, 'daily_pool_manifest.json');
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.doMock('../../src/infinite.ts', () => ({
    INFINITE_MAX_LEVELS: 8,
  }));
  vi.doMock('../../scripts/daily_pool_tools.ts', () => ({
    DAILY_POOL_BASE_VARIANT_ID: 0,
    DAILY_POOL_DIFFICULTY_VARIANT_WINDOW: 8,
    DAILY_POOL_EPOCH_UTC_DATE: '2026-01-01',
    DAILY_POOL_MAX_SLOTS: 30000,
    DAILY_POOL_MAX_VARIANT_PROBE: 255,
    DAILY_POOL_SCHEMA_VERSION: 1,
    DAILY_POOL_VERSION: 'v1',
    buildInfiniteCanonicalKeySet: () => new Set([
      'inf:0',
      'inf:1',
      'inf:2',
      'inf:3',
      'inf:4',
      'inf:5',
      'inf:6',
      'inf:7',
    ]),
    computePoolDigest: () => 'digest',
    selectDailyCandidateForSlot: (slot: number) => ({
      slot,
      variantId: 0,
      canonicalKey: `daily:${slot}`,
      difficultyScore: 12,
    }),
    writeDailyOverridesGzipFile: (filePath: string) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, Buffer.from('gzip-bytes'));
      return {
        variantBits: 1,
        packedBytes: 2,
        compressedBytes: 3,
      };
    },
  }));
  t.after(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.resetModules();
    vi.doUnmock('../../src/infinite.ts');
    vi.doUnmock('../../scripts/daily_pool_tools.ts');
  });

  withProcessArgv(t, [
    process.execPath,
    path.join(tmpDir, 'scripts', 'build_daily_overrides.ts'),
    '--max-slots', '1',
    '--max-variant-probe', '4',
    '--difficulty-variant-window', '1',
    '--out-bin', outBinFile,
    '--out-manifest', outManifestFile,
    '--json',
  ]);
  const dailyOverridesModulePath = '../../scripts/build_daily_overrides.ts?case=entry-success';
  await import(dailyOverridesModulePath);
  const manifest = JSON.parse(fs.readFileSync(outManifestFile, 'utf8'));
  assert.equal(fs.existsSync(outBinFile), true);
  assert.equal(manifest.maxSlots, 1);

  vi.resetModules();
  const exitCalls = withProcessExitTrap(t);
  withProcessArgv(t, [
    process.execPath,
    path.join(tmpDir, 'scripts', 'build_daily_overrides.ts'),
    '--difficulty-variant-window', '0',
  ]);
  await assert.rejects(
    import('../../scripts/build_daily_overrides.ts?case=entry-error' as string),
    /process\.exit:1/,
  );
  assert.deepEqual(exitCalls, [1]);
});

test('verify_pages_pwa_build entrypoint validates generated artifacts', async (t) => {
  const tmpDir = withTempCwd(t, 'verify-pages-pwa-build-');
  const publicDir = path.join(tmpDir, 'public');
  const distDir = path.join(tmpDir, 'dist');
  fs.mkdirSync(publicDir, { recursive: true });
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'CNAME'), 'example.com\n');
  fs.writeFileSync(path.join(distDir, 'CNAME'), 'example.com\n');
  fs.writeFileSync(path.join(distDir, 'index.html'), '<link rel="manifest" href="./manifest.webmanifest">');
  fs.writeFileSync(path.join(distDir, 'sw.js'), 'self.addEventListener("install", () => {})');
  fs.writeFileSync(path.join(distDir, 'manifest.webmanifest'), JSON.stringify({
    id: './',
    start_url: './',
    scope: './',
    icons: [{ src: './icon.png' }],
  }));
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  t.after(() => {
    logSpy.mockRestore();
    vi.resetModules();
  });

  const verifyPagesModulePath = '../../scripts/verify_pages_pwa_build.ts?case=valid';
  await import(verifyPagesModulePath);

  fs.writeFileSync(path.join(distDir, 'manifest.webmanifest'), JSON.stringify({
    id: './',
    start_url: './',
    scope: './',
    icons: [{ src: 'https://example.com/icon.png' }],
  }));
  await assert.rejects(
    import('../../scripts/verify_pages_pwa_build.ts?case=invalid' as string),
    /manifest icon src/,
  );
});

test('render drag smoke e2e entrypoint spawns node test runner', async (t) => {
  const spawns: Array<{ command: string; args: string[] }> = [];
  let exitHandler: ((code: number) => void) | undefined;
  t.after(() => {
    vi.restoreAllMocks();
  });

  const { runRenderDragBenchmarkCompareSmoke } = await import('../../scripts/run_e2e_render_drag_benchmark_compare_smoke.ts');
  const pending = runRenderDragBenchmarkCompareSmoke(((command: string, args: string[]) => {
    spawns.push({ command, args });
    return {
      on(event: string, handler: (value?: any) => void) {
        if (event === 'exit') exitHandler = handler as (code: number) => void;
        if (event === 'error') return this;
        return this;
      },
    } as any;
  }) as unknown as typeof import('node:child_process').spawn);
  exitHandler?.(0);
  await pending;
  assert.equal(spawns.length, 1);
  assert.deepEqual(spawns[0].args, ['--test', 'tests/e2e/render_drag_benchmark_compare.smoke.e2e.test.js']);
});

test('render drag smoke e2e entrypoint rejects non-zero exits and child errors', async () => {
  const { runRenderDragBenchmarkCompareSmoke } = await import('../../scripts/run_e2e_render_drag_benchmark_compare_smoke.ts');

  let exitHandler: ((code: number) => void) | undefined;
  const nonZeroPromise = runRenderDragBenchmarkCompareSmoke(((command: string, args: string[]) => {
    assert.equal(command, process.execPath);
    assert.deepEqual(args, ['--test', 'tests/e2e/render_drag_benchmark_compare.smoke.e2e.test.js']);
    return {
      on(event: string, handler: (value?: any) => void) {
        if (event === 'exit') exitHandler = handler as (code: number) => void;
        return this;
      },
    } as any;
  }) as typeof import('node:child_process').spawn);
  exitHandler?.(2);
  await assert.rejects(nonZeroPromise, /exited with code 2/);

  let errorHandler: ((error: Error) => void) | undefined;
  const errorPromise = runRenderDragBenchmarkCompareSmoke((() => ({
    on(event: string, handler: (value?: any) => void) {
      if (event === 'error') errorHandler = handler as (error: Error) => void;
      return this;
    },
  })) as unknown as typeof import('node:child_process').spawn);
  errorHandler?.(new Error('spawn failed'));
  await assert.rejects(errorPromise, /spawn failed/);
});

test('find_level entrypoint logs a best candidate using mocked solver helpers', async (t) => {
  const logs: string[] = [];
  t.after(() => {
    vi.restoreAllMocks();
  });

  const { runFindLevel } = await import('../../scripts/find_level.ts');
  const result = runFindLevel({
    generateCandidateFn: () => ({
      grid: [
        '.......',
        '.......',
        '...g...',
        '..bpb..',
        '.......',
        '.......',
        '.......',
      ],
      stitches: [[3, 3]],
      cornerCounts: [],
    }),
    solveLevelFn: () => ({
      timedOut: false,
      canonicalSolutions: 2,
      rawSolutions: 4,
    } as any),
    buildLevelContextFn: () => ({} as any),
    runRandomSolveBatchFn: () => ({
      meanBacktracksSolved: 3,
      meanDeadEnds: 1,
    } as any),
    log: (message) => {
      logs.push(message);
    },
    writeProgress: () => {},
    targetCandidates: 2,
  });

  assert.equal(result.bestDifficulty, 3);
  assert.equal(logs.some((line) => line.includes('SEARCH COMPLETE')), true);
  assert.equal(logs.some((line) => line.includes('Trinity Weave')), true);
});

test('find_level generateCandidate creates a 7x7 board with one of each RPS token', async () => {
  const { generateCandidate } = await import('../../scripts/find_level.ts');
  let seed = 123456789;
  const level = generateCandidate(() => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  });

  const joined = level.grid.join('');
  assert.equal(level.grid.length, 7);
  assert.equal(level.grid.every((row) => row.length === 7), true);
  assert.equal(joined.split('g').length - 1, 1);
  assert.equal(joined.split('b').length - 1, 1);
  assert.equal(joined.split('p').length - 1, 1);
  assert.deepEqual(level.stitches, [[3, 3]]);
});

test('find_level ignores transient solver failures and still completes the search', async () => {
  const { runFindLevel } = await import('../../scripts/find_level.ts');
  let solveCalls = 0;

  const result = runFindLevel({
    generateCandidateFn: () => ({
      grid: Array.from({ length: 7 }, () => '.......'),
      stitches: [[3, 3]],
      cornerCounts: [],
    }),
    solveLevelFn: () => {
      solveCalls += 1;
      if (solveCalls === 1) {
        throw new Error('transient solver failure');
      }
      return {
        timedOut: false,
        canonicalSolutions: 2,
        rawSolutions: 3,
      } as any;
    },
    buildLevelContextFn: () => ({} as any),
    runRandomSolveBatchFn: () => ({
      meanBacktracksSolved: 5,
      meanDeadEnds: 2,
    } as any),
    log: () => {},
    writeProgress: () => {},
    targetCandidates: 1,
  });

  assert.equal(solveCalls >= 2, true);
  assert.equal(result.bestDifficulty, 5);
});
