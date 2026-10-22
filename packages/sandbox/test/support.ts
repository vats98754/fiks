// Shared test fixtures: the shop-mcp clone (scripts/ensure-shop-mcp.mjs) and throwaway worktrees of
// it laid out as CORE's addWorktree() makes them (node_modules = a symlink to the clone's macOS
// install), so the sandbox's handling of that symlink is exercised.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIKS_ROOT } from '../src/build-tools.ts';

export const SHOP = join(FIKS_ROOT, '.work', 'shop-mcp');

export function requireShop(): string {
  if (!existsSync(join(SHOP, '.git'))) {
    throw new Error(`${SHOP} is missing: run node scripts/ensure-shop-mcp.mjs first`);
  }
  return SHOP;
}

export interface TestWorktree {
  dir: string;
  remove(): void;
}

export function shopWorktree(ref: string, dir?: string): TestWorktree {
  const shop = requireShop();
  const wt = dir ?? join(realpathSync(mkdtempSync(join(tmpdir(), 'fiks-sbx-wt-'))), 'wt');
  const git = (...a: string[]) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...a], { cwd: shop, encoding: 'utf8' });
  git('worktree', 'add', '--detach', wt, `${ref}^{commit}`);
  symlinkSync(join(shop, 'node_modules'), join(wt, 'node_modules'));
  return {
    dir: wt,
    remove() {
      try {
        git('worktree', 'remove', '--force', wt);
      } catch {
        rmSync(wt, { recursive: true, force: true });
        git('worktree', 'prune');
      }
    },
  };
}
