import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineProject } from 'vitest/config';

// The CLI-level bench tests create worktrees and scratch output: always in throwaway folders.
export default defineProject({
  test: {
    env: {
      FIKS_DIR: mkdtempSync(join(tmpdir(), 'fiks-bench-test-')),
      FIKS_WORK_DIR: mkdtempSync(join(tmpdir(), 'fiks-bench-work-')),
    },
  },
});
