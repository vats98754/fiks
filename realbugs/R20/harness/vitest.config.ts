import { defineConfig } from 'vitest/config';

// R20 harness tests: pnpm vitest run --config realbugs/R20/harness/vitest.config.ts
// The integration test needs the .work/realbugs/R20 clone (node scripts/ensure-realbugs.mjs --id R20)
// and Docker (the server runs only in the SBX image); it is skipped without either.
export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    include: ['**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 900_000,
  },
});
