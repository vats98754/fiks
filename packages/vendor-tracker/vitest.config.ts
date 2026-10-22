import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    // Clones/updates .work/tracker-mcp at the pinned ref first (scripts/ensure-tracker-mcp.mjs;
    // idempotent, offline once the pinned ref and tags are present).
    globalSetup: ['./test/support/global-setup.ts'],
    // fixtures/driftpkgs/*/hidden*/ are tracker-mcp tests (run in a tracker-mcp worktree), not ours.
    exclude: ['**/node_modules/**', 'fixtures/**'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
