import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineProject } from 'vitest/config';

// Tests always run against the unfixed seed (tag seed-v1), whatever the local clone's main holds.
const clone = new URL('../../.work/shop-mcp', import.meta.url).pathname;
const seed = join(mkdtempSync(join(tmpdir(), 'fiks-seed-')), 'shop');
execFileSync('git', ['-C', clone, 'worktree', 'add', '--detach', seed, 'seed-v1^{commit}'], {
  stdio: 'pipe',
});
symlinkSync(realpathSync(join(clone, 'node_modules')), join(seed, 'node_modules'));

export default defineProject({
  test: {
    // Each test here runs whole shop-mcp suites (nested vitest); more parallelism only adds timeouts.
    maxWorkers: 3,
    // Its own group, after the light packages (vitest needs this when maxWorkers differs).
    sequence: { groupOrder: 1 },
    // Tests write traces, events and worktrees to throwaway folders, never the real ones.
    env: {
      FIKS_DIR: mkdtempSync(join(tmpdir(), 'fiks-test-')),
      FIKS_WORK_DIR: mkdtempSync(join(tmpdir(), 'fiks-work-')),
      FIKS_SHOP_DIR: seed,
      FIKS_SEED_DIR: seed,
    },
  },
});
