// Throwaway worktrees of the tracker-mcp clone (.work/tracker-mcp), sharing its node_modules.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trackerDomain } from '../../src/domain.ts';

export const clone = () => trackerDomain.repo.dir();

export const git = (dir: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();

export interface Worktree {
  dir: string;
  remove(): void;
}

/** A detached worktree of `ref^{commit}` with the clone's node_modules linked in. */
export function worktree(ref: string): Worktree {
  const src = clone();
  if (!existsSync(join(src, 'node_modules')))
    throw new Error(`${src} has no node_modules (run ensure-tracker-mcp)`);
  const dir = join(mkdtempSync(join(tmpdir(), 'fiks-tracker-wt-')), 'repo');
  git(src, 'worktree', 'add', '--detach', '--quiet', dir, `${ref}^{commit}`);
  symlinkSync(realpathSync(join(src, 'node_modules')), join(dir, 'node_modules'));
  return {
    dir,
    remove() {
      try {
        git(src, 'worktree', 'remove', '--force', dir);
      } catch {
        rmSync(dir, { recursive: true, force: true });
        git(src, 'worktree', 'prune');
      }
    },
  };
}

export const DRIFTPKGS = new URL('../../fixtures/driftpkgs/', import.meta.url).pathname;
