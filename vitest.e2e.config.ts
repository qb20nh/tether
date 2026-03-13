import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['tests/e2e/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 30_000,
  },
});
