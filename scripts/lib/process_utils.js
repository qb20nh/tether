import { spawn } from 'node:child_process';

export const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });

export const waitForServer = async (url, timeoutMs = 30000, intervalMs = 250) => {
  const startMs = Date.now();
  while ((Date.now() - startMs) < timeoutMs) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok || response.status === 404) return;
    } catch {
      // Keep polling until timeout.
    }
    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }
  throw new Error(`Timed out waiting for preview server at ${url}`);
};
