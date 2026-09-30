import { defineConfig } from 'vitest/config';

// Database tests run against a real PostgreSQL (ADR-31 s4.4). global-setup builds one template database from
// db/migrations; each test file clones it.
export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
