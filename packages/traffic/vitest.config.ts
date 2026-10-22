import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineProject } from 'vitest/config';

// Traffic tests write scratch output and worktrees: always in throwaway folders.
export default defineProject({
  test: {
    env: {
      FIKS_DIR: mkdtempSync(join(tmpdir(), 'fiks-traffic-test-')),
      FIKS_WORK_DIR: mkdtempSync(join(tmpdir(), 'fiks-traffic-work-')),
    },
    // Sessions spawn real MCP server processes; slow under full-suite load.
    testTimeout: 180_000,
  },
});
