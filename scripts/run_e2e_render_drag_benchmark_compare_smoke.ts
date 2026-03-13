import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const runRenderDragBenchmarkCompareSmoke = (
  spawnImpl: typeof spawn = spawn,
): Promise<void> => new Promise((resolve, reject) => {
  const child = spawnImpl(process.execPath, [
    '--test',
    'tests/e2e/render_drag_benchmark_compare.smoke.e2e.test.js',
  ], {
    stdio: 'inherit',
  });

  child.on('error', reject);
  child.on('exit', (code) => {
    if (code === 0) {
      resolve();
      return;
    }
    reject(new Error(`render drag benchmark compare smoke test exited with code ${code}`));
  });
});

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    await runRenderDragBenchmarkCompareSmoke();
  } catch (error) {
    const errorMessage = error instanceof Error ? (error.stack || error.message) : String(error);
    process.stderr.write(`${errorMessage}\n`);
    process.exitCode = 1;
  }
}
