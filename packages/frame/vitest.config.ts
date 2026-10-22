import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineProject } from 'vitest/config';

// The pipeline tests run the CLI (tool servers, vendors, injectors) as subprocesses: few workers,
// long timeouts, and every output under a throwaway folder (never paper/results or .fiks).
export default defineProject({
  test: {
    maxWorkers: 2,
    // Its own group (vitest needs a unique groupOrder when maxWorkers differs), after the CLI group.
    sequence: { groupOrder: 4 },
    testTimeout: 600_000,
    hookTimeout: 600_000,
    env: {
      FIKS_DIR: mkdtempSync(join(tmpdir(), 'fiks-det-')),
      FIKS_WORK_DIR: mkdtempSync(join(tmpdir(), 'fiks-det-work-')),
    },
  },
});
