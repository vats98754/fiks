import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
/** Clones and worktrees. Tests point FIKS_WORK_DIR at a temp folder. */
export const WORK_DIR = process.env.FIKS_WORK_DIR ?? join(ROOT, '.work');
/** Scratch output: traces and the event log. Tests point FIKS_DIR at a temp folder. */
export const FIKS_DIR = process.env.FIKS_DIR ?? join(ROOT, '.fiks');

/** The shop-mcp checkout the harness runs (override with FIKS_SHOP_DIR). */
export function shopDir(): string {
  return process.env.FIKS_SHOP_DIR ?? join(ROOT, '.work', 'shop-mcp');
}

/**
 * A cached, read-only checkout of shop-mcp at `ref` (default `seed-v1`, the tool as it was when
 * the vendor changed), sharing the clone's node_modules. Scenarios and single calls run here,
 * so they show the drift even after fixes are merged into main.
 */
export function shopAt(ref = 'seed-v1'): string {
  if (ref === 'main' || ref === 'HEAD') return shopDir();
  // Tests (and anyone with a prepared seed checkout) point FIKS_SEED_DIR at it.
  if (ref === 'seed-v1' && process.env.FIKS_SEED_DIR) return process.env.FIKS_SEED_DIR;
  const dir = join(WORK_DIR, 'wt', `ref-${ref.replace(/[^\w.-]+/g, '_')}`);
  if (!existsSync(join(dir, '.git'))) {
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: shopDir(), stdio: 'pipe' });
    git('worktree', 'prune');
    git('worktree', 'add', '--force', '--detach', dir, `${ref}^{commit}`);
    symlinkSync(realpathSync(join(shopDir(), 'node_modules')), join(dir, 'node_modules'));
  }
  return dir;
}
