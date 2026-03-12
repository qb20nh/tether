import { spawn } from 'node:child_process';
import { runCommand, waitForServer } from './lib/process_utils.js';

const HOST = process.env.E2E_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.E2E_PORT || '4173', 10);
const BASE_URL = `http://${HOST}:${PORT}/`;
const SERVER_READY_TIMEOUT_MS = 30_000;
const SERVER_POLL_INTERVAL_MS = 250;

const runE2e = async () => {
  await runCommand('pnpm', ['run', 'build']);

  const preview = spawn('pnpm', [
    'exec',
    'vite',
    'preview',
    '--host',
    HOST,
    '--port',
    String(PORT),
    '--strictPort',
  ], {
    stdio: 'inherit',
  });

  let previewClosed = false;
  preview.on('exit', () => {
    previewClosed = true;
  });

  const stopPreview = () => {
    if (previewClosed) return;
    preview.kill('SIGTERM');
  };

  process.once('SIGINT', stopPreview);
  process.once('SIGTERM', stopPreview);

  try {
    await waitForServer(BASE_URL, SERVER_READY_TIMEOUT_MS, SERVER_POLL_INTERVAL_MS);
    await runCommand('node', ['--test', 'tests/e2e/resize_recovery.e2e.test.js'], {
      env: {
        ...process.env,
        E2E_BASE_URL: BASE_URL,
      },
    });
  } finally {
    stopPreview();
  }
};

try {
  await runE2e();
} catch (error) {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
}
