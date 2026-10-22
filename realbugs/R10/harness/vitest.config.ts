import { defineConfig } from 'vitest/config';

// R10 harness tests: pnpm vitest run --config realbugs/R10/harness/vitest.config.ts
// The integration test needs the .work/realbugs/R10 clone (node scripts/ensure-realbugs.mjs --id R10)
// and builds the server at prefix and fix (npm ci on first use); it is skipped without the clone.
export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    include: ['**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 600_000,
  },
});
