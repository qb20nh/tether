import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['tests/e2e/**/*.test.ts'],
    fileParallelism: true,
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
  },
});
