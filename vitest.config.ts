import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: process.env.API_E2E ? ['test/e2e/**/*.e2e.ts'] : ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
