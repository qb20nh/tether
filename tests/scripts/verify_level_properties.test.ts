import assert from 'node:assert/strict';
import path from 'node:path';
import test from '../test.ts';
import { vi } from 'vitest';
import {
  DIFFICULTY_PROFILES,
  buildLevelContext,
  runRandomSolveBatch,
  solveLevel,
} from '../../scripts/verify_level_properties.ts';

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

test('buildLevelContext and runRandomSolveBatch expose placement and difficulty metadata', () => {
  const level = {
    grid: [
      '.m.',
      '...',
      '..#',
    ],
    stitches: [[1, 1]] as Array<[number, number]>,
    cornerCounts: [[2, 1, 2]] as Array<[number, number, number]>,
  };
  const context = buildLevelContext(level);
  assert.equal(context.rows, 3);
  assert.equal(context.cols, 3);
  assert.equal(context.movableWallsCount, 1);
  assert.equal(context.movableCandidates.length > 1, true);
  assert.equal(context.wallPlacementsTotal > 0, true);

  const batch = runRandomSolveBatch(context, DIFFICULTY_PROFILES.lite96, 'verify-level-properties-extra');
  assert.equal(batch.trials, DIFFICULTY_PROFILES.lite96.trials);
  assert.equal(batch.successRate >= 0 && batch.successRate <= 1, true);
  assert.equal(batch.uniqueWallPlacementsSampled > 0, true);
  assert.equal(batch.meanNodeExpansions >= 0, true);
});

test('verify_level_properties CLI path prints JSON summary and exits cleanly', async (t) => {
  const originalArgv = [...process.argv];
  const exitCalls: Array<number | undefined> = [];
  const logs: string[] = [];
  process.argv = [
    process.execPath,
    path.resolve(process.cwd(), 'scripts/verify_level_properties.ts'),
    '--level', '0',
    '--json',
    '--time-ms', '25',
    '--max-solutions', '8',
    '--min-raw', '0',
    '--min-canonical', '0',
    '--min-hint-orders', '0',
    '--min-corner-orders', '0',
  ];
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCalls.push(code);
    throw new Error(`process.exit:${code}`);
  }) as never);
  const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
    logs.push(String(message ?? ''));
  });
  t.after(() => {
    process.argv = originalArgv;
    exitSpy.mockRestore();
    logSpy.mockRestore();
    vi.resetModules();
  });

  await assert.rejects(
    import('../../scripts/verify_level_properties.ts?case=cli' as string),
    /process\.exit:0/,
  );
  assert.deepEqual(exitCalls, [0]);
  assert.equal(logs.some((line) => line.includes('"summary"')), true);
});

test('verify_level_properties CLI rejects unknown options', async (t) => {
  const originalArgv = [...process.argv];
  const exitCalls: Array<number | undefined> = [];
  const errors: string[] = [];
  process.argv = [
    process.execPath,
    path.resolve(process.cwd(), 'scripts/verify_level_properties.ts'),
    '--unknown-option',
  ];
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCalls.push(code);
    throw new Error(`process.exit:${code}`);
  }) as never);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
    errors.push(String(message ?? ''));
  });
  t.after(() => {
    process.argv = originalArgv;
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    vi.resetModules();
  });

  await assert.rejects(
    import('../../scripts/verify_level_properties.ts?case=cli-invalid' as string),
    /process\.exit:2/,
  );
  assert.deepEqual(exitCalls, [2]);
  assert.equal(errors.some((line) => line.includes('Unknown option: --unknown-option')), true);
});

test('verify_level_properties difficulty mode writes difficulty metadata without touching the real levels file', async (t) => {
  const originalArgv = [...process.argv];
  const exitCalls: Array<number | undefined> = [];
  const logs: string[] = [];
  const writes: string[] = [];
  process.argv = [
    process.execPath,
    path.resolve(process.cwd(), 'scripts/verify_level_properties.ts'),
    '--level', '0',
    '--difficulty',
    '--difficulty-profile', 'lite96',
    '--difficulty-proof-time-ms', '1',
    '--difficulty-proof-node-cap', '8',
    '--json',
    '--time-ms', '5',
    '--max-solutions', '1',
    '--min-raw', '0',
    '--min-canonical', '0',
    '--min-hint-orders', '0',
    '--min-corner-orders', '0',
  ];
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCalls.push(code);
    throw new Error(`process.exit:${code}`);
  }) as never);
  const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
    logs.push(String(message ?? ''));
  });
  vi.doMock('node:fs', () => ({
    default: {
      writeFileSync: (_filePath: string, contents: string) => {
        writes.push(contents);
      },
    },
  }));
  t.after(() => {
    process.argv = originalArgv;
    exitSpy.mockRestore();
    logSpy.mockRestore();
    vi.resetModules();
    vi.doUnmock('node:fs');
  });

  await assert.rejects(
    import('../../scripts/verify_level_properties.ts?case=cli-difficulty' as string),
    /process\.exit:[01]/,
  );
  assert.equal(exitCalls.at(-1) === 0 || exitCalls.at(-1) === 1, true);
  assert.equal(logs.some((line) => line.includes('"difficulty"')), true);
  assert.equal(writes.length > 0, true);
});
