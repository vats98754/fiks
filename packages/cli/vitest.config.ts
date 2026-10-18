import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    // Tests write traces and events to a throwaway folder, never the real .fiks.
    env: {
      FIKS_DIR: mkdtempSync(join(tmpdir(), 'fiks-test-')),
      FIKS_WORK_DIR: mkdtempSync(join(tmpdir(), 'fiks-work-')),
    },
  },
});
