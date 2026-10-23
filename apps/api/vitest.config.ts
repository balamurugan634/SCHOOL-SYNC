import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // every test file provisions its own school (own database) so files are fully isolated and can run in parallel
    pool: 'forks',
    // Memory safety: vitest defaults to (CPU cores - 1) worker processes, each importing the whole app. On a 12-core dev
    // machine with several runs in parallel that is gigabytes. Two is plenty (each file also starts its own school DB).
    maxWorkers: 2,
    minWorkers: 1,
    env: { NODE_ENV: 'test' },
  },
});
