import { defineConfig } from 'vitest/config';

// R9 harness tests: pnpm vitest run --config realbugs/R9/harness/vitest.config.ts
// The integration test needs the .work/realbugs/R9 clone (node scripts/ensure-realbugs.mjs --id R9);
// it installs the npx 0.2.0 artifact (npm ci) and PR #469's package (pnpm, filtered) on first use,
// and is skipped without the clone.
export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', 'npx-0.2.0/**'],
    testTimeout: 300_000,
    hookTimeout: 600_000,
  },
});
