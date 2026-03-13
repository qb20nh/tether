import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from '../test.ts';
import { vi } from 'vitest';
import {
  buildMetricSummary,
  formatMetric,
  mean,
  median,
  pathsEqual,
  percentile,
} from '../../scripts/lib/stats.ts';
import {
  BLOCKED_PATTERNS,
  TEXT_EXTENSIONS,
  verifyReleaseNoDebugArtifacts,
} from '../../scripts/verify_release_no_debug_artifacts.ts';

interface MockSpawnChild {
  on: (event: string, handler: (value?: any) => unknown) => MockSpawnChild;
  emitExit: (code: number) => void;
}

test('stats helpers summarize values and compare paths', () => {
  assert.equal(mean([]), 0);
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(percentile([1, 2, 3, 4], 0.95), 4);
  assert.deepEqual(buildMetricSummary([1, 2, 3], median), {
    mean: 2,
    median: 2,
    p95: 3,
  });
  assert.equal(formatMetric(Number.NaN), 'n/a');
  assert.equal(formatMetric(1.23456), '1.235');
  assert.equal(pathsEqual([[0, 0], [1, 1]], [[0, 0], [1, 1]]), true);
  assert.equal(pathsEqual([[0, 0]], [[1, 1]]), false);
});

test('process utils run commands and poll servers', async (t) => {
  vi.resetModules();
  const spawnCalls: Array<{ command: string; args: readonly string[] }> = [];
  let latestChild: MockSpawnChild | null = null;
  vi.doMock('node:child_process', () => ({
    spawn: (command: string, args: readonly string[]) => {
      spawnCalls.push({ command, args });
      let exitHandler: ((code: number) => void) | undefined;
      latestChild = {
        on(event: string, handler: (value?: any) => void) {
          if (event === 'error') return this;
          if (event === 'exit') exitHandler = handler as (code: number) => void;
          return this;
        },
        emitExit(code: number) {
          exitHandler?.(code);
        },
      };
      return latestChild;
    },
  }));
  t.after(() => {
    vi.resetModules();
    vi.doUnmock('node:child_process');
    vi.unstubAllGlobals();
  });

  const { runCommand, waitForServer } = await import('../../scripts/lib/process_utils.ts');
  const pending = runCommand('pnpm', ['test']);
  const child: MockSpawnChild = latestChild as unknown as MockSpawnChild;
  child.emitExit(0);
  await pending;
  assert.deepEqual(spawnCalls, [{ command: 'pnpm', args: ['test'] }]);

  let attempts = 0;
  vi.stubGlobal('fetch', async () => {
    attempts += 1;
    if (attempts < 2) {
      throw new Error('retry');
    }
    return { ok: true, status: 200 };
  });
  await waitForServer('http://127.0.0.1:4173/', 200, 1);
  assert.equal(attempts, 2);
});

test('release no-debug verifier scans text artifacts and rejects blocked patterns', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-check-'));
  fs.mkdirSync(path.join(tmpDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'index.html'), '<html>clean</html>');
  fs.writeFileSync(path.join(tmpDir, 'assets', 'index.js'), 'console.log("clean");');

  const result = verifyReleaseNoDebugArtifacts({ distDir: tmpDir });
  assert.equal(result.distDir, tmpDir);
  assert.equal(result.fileCount >= 2, true);
  assert.equal(TEXT_EXTENSIONS.has('.html'), true);
  assert.equal(BLOCKED_PATTERNS.length > 0, true);

  fs.writeFileSync(path.join(tmpDir, 'assets', 'bad.js'), 'runtime_debug_plugin');
  assert.throws(() => {
    verifyReleaseNoDebugArtifacts({ distDir: tmpDir });
  }, /Debug-only artifact leaked/);
});
