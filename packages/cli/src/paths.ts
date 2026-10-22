import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getDomain, listDomains } from '@fiks/domains';
import { withWorktreeLock } from '@fiks/repro';

export const ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
/** Clones and worktrees. Tests point FIKS_WORK_DIR at a temp folder. */
export const WORK_DIR = process.env.FIKS_WORK_DIR ?? join(ROOT, '.work');
/**
 * Scratch output: traces and the event log. Per process (P6): parallel workers each set their
 * own FIKS_DIR; tests point it at a temp folder.
 */
export const FIKS_DIR = process.env.FIKS_DIR ?? join(ROOT, '.fiks');

/** The shop-mcp checkout the harness runs (override with FIKS_SHOP_DIR). */
export function shopDir(): string {
  return process.env.FIKS_SHOP_DIR ?? join(ROOT, '.work', 'shop-mcp');
}

/** The tool repo clone of `domain` (shop: `shopDir()`; others: their Domain's `repo.dir()`). */
export function repoDir(domain = 'shop'): string {
  if (domain === 'shop' && !listDomains().some((d) => d.id === 'shop')) return shopDir();
  return getDomain(domain).repo.dir();
}

/**
 * A cached, read-only checkout of shop-mcp at `ref` (default `seed-v1`, the tool as it was when
 * the vendor changed), sharing the clone's node_modules. Scenarios and single calls run here,
 * so they show the drift even after fixes are merged into main.
 */
export function shopAt(ref = 'seed-v1'): string {
  return repoAt(ref, 'shop');
}

/** `shopAt` for any domain: a cached detached worktree of its repo at `ref^{commit}`. */
export function repoAt(ref: string | undefined, domain = 'shop'): string {
  const want = ref ?? (domain === 'shop' ? 'seed-v1' : getDomain(domain).seedTag);
  const repo = repoDir(domain);
  if (want === 'main' || want === 'HEAD') return repo;
  // Tests (and anyone with a prepared seed checkout) point FIKS_SEED_DIR at it.
  if (domain === 'shop' && want === 'seed-v1' && process.env.FIKS_SEED_DIR) return process.env.FIKS_SEED_DIR;
  const prefix = domain === 'shop' ? 'ref' : `${domain}-ref`;
  const dir = join(WORK_DIR, 'wt', `${prefix}-${want.replace(/[^\w.-]+/g, '_')}`);
  if (!existsSync(join(dir, '.git'))) {
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, stdio: 'pipe' });
    withWorktreeLock(repo, () => {
      if (existsSync(join(dir, '.git'))) return; // another process made it while we waited
      git('worktree', 'prune');
      git('worktree', 'add', '--force', '--detach', dir, `${want}^{commit}`);
      if (existsSync(join(repo, 'node_modules'))) {
        symlinkSync(realpathSync(join(repo, 'node_modules')), join(dir, 'node_modules'));
      }
    });
  }
  return dir;
}
