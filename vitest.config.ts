import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      all: true,
      exclude: [
        'dist/**',
        'node_modules/**',
        'public/**',
        'src/**/*.d.ts',
        'src/app.ts',
        'src/contracts/ports.ts',
        'src/generated/**',
        'src/state.ts',
        'src/styles.ts',
        'tests/**',
        'vite.config.ts',
        'vitest.config.ts',
        'vitest.e2e.config.ts',
      ],
      include: ['scripts/**/*.ts', 'src/**/*.ts', 'src/**/*.tsx'],
      provider: 'v8',
      thresholds: {
        branches: 50,
        functions: 50,
        perFile: true,
        statements: 50,
      },
    },
    environment: 'node',
    exclude: ['tests/e2e/**/*.test.ts'],
    fileParallelism: true,
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
  },
});
