import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const compareScript = path.resolve(process.cwd(), 'scripts', 'render_drag_benchmark_compare.js');

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

  for (let i = 0; i < report.results.length; i += 1) {
    const suite = report.results[i];
    assert.equal(suite.mode, 'normal');
    assert.equal(Array.isArray(suite.caseResults), true);
    assert.equal(suite.caseResults.length, 2);
    for (let j = 0; j < suite.caseResults.length; j += 1) {
      const caseResult = suite.caseResults[j];
      assert.deepEqual(caseResult.actualPathCells, caseResult.pathCells);
    }
  }
});
