import { defineConfig } from 'vitest/config';

// paper/prereg is not a workspace package, so the root `pnpm test` does not run these tests:
// pnpm exec vitest run --config paper/prereg/vitest.config.ts
export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    include: ['test/**/*.test.ts'],
    testTimeout: 600_000,
  },
});
