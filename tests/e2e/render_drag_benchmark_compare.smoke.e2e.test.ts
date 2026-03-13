import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../test.ts';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const compareScript = path.resolve(process.cwd(), 'scripts', 'render_drag_benchmark_compare.ts');

test('e2e: render drag benchmark compare smoke run produces a valid report', async (t) => {
  try {
    await import('playwright');
  } catch {
    t.skip('playwright is not installed; run `pnpm add -D playwright` and `pnpm exec playwright install chromium`');
    return;
  }

  const reportPath = path.join(os.tmpdir(), `tether-render-drag-smoke-${Date.now()}.json`);
  t.after(async () => {
    await fs.rm(reportPath, { force: true });
  });

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    '--import',
    'tsx',
    compareScript,
    '--prev',
    'HEAD',
    '--next',
    '',
    '--boards',
    '2',
    '--repeats',
    '1',
    '--modes',
    'normal',
    '--out',
    reportPath,
  ], {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });

  assert.equal(typeof stdout, 'string');
  assert.equal(typeof stderr, 'string');

  const raw = await fs.readFile(reportPath, 'utf8');
  const report = JSON.parse(raw);

  assert.equal(report.prevRev.length > 0, true);
  assert.equal(report.nextRev, 'WORKTREE');
  assert.equal(report.boardCount, 2);
  assert.equal(report.repeats, 1);
  assert.deepEqual(report.modes, ['normal']);
  assert.equal(report.workload?.cases?.length, 2);
  assert.equal(Array.isArray(report.results), true);
  assert.equal(report.results.length, 2);
  assert.deepEqual(report.failures, []);

  for (const element of report.results) {
    const suite = element;
    assert.equal(suite.mode, 'normal');
    assert.equal(Array.isArray(suite.caseResults), true);
    assert.equal(suite.caseResults.length, 2);
    for (const element of suite.caseResults) {
      const caseResult = element;
      assert.deepEqual(caseResult.actualPathCells, caseResult.pathCells);
    }
  }
});
