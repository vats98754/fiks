import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' }).trim();

export interface Worktree {
  dir: string;
  ref: string;
  remove(): void;
}

/**
 * A throwaway git worktree of the shop-mcp clone at `ref` (detached, or on a new `branch`),
 * sharing the clone's node_modules (same lockfile at seed).
 */
export function addWorktree(shopDir: string, dir: string, ref: string, branch?: string): Worktree {
  if (existsSync(dir)) {
    try {
      git(shopDir, 'worktree', 'remove', '--force', dir);
    } catch {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  mkdirSync(dirname(dir), { recursive: true });
  git(shopDir, 'worktree', 'prune');
  if (branch) git(shopDir, 'worktree', 'add', '-B', branch, dir, ref);
  else git(shopDir, 'worktree', 'add', '--detach', dir, ref);
  symlinkSync(join(shopDir, 'node_modules'), join(dir, 'node_modules'));
  return {
    dir,
    ref,
    remove() {
      try {
        git(shopDir, 'worktree', 'remove', '--force', dir);
      } catch {
        rmSync(dir, { recursive: true, force: true });
        git(shopDir, 'worktree', 'prune');
      }
    },
  };
}
