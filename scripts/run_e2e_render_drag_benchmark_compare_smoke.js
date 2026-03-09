import { spawn } from 'node:child_process';

const run = () => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
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

run().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
