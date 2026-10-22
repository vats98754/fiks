import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    // Makes sure .work/shop-mcp (pinned base-shop) and .work/tracker-mcp (pinned main) exist.
    globalSetup: ['./test/support/global-setup.ts'],
    // test/stubs/* are stub authors (modules loaded by the CLI), not tests.
    exclude: ['**/node_modules/**', 'test/stubs/**'],
    testTimeout: 300_000,
    hookTimeout: 600_000,
  },
});
