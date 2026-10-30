// Checkouts for exp runs and evals: a standalone clone of the shop-mcp clone (not a `git worktree`),
// so its .git lives inside it and git works in a container where only the checkout is mounted.
// Nothing is fetched from the network; heads are kept as local refs (refs/fiks-exp/...) in the
// shop-mcp clone and never pushed.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { resolveLocalRef } from '@fiks/repro';
import type { DiffStats } from './types.ts';

export const EXP_GIT_IDENTITY = {
  name: 'fiks-exp',
  email: 'fiks-exp@localhost',
  date: '2026-10-01T12:00:00Z',
};

/** Hooks, fsmonitor and pagers off: code that ran in a checkout must never run through git. */
const SAFE_GIT = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat'];

export function git(cwd: string, args: string[], env?: Record<string, string>): string {
  return execFileSync('git', [...SAFE_GIT, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

export interface ExpCheckout {
  dir: string;
  baseCommit: string;
  remove(): void;
}

/**
 * A standalone clone of `repoDir` at `commit` (any local commit, e.g. a refs/fiks-exp head), with
 * no remote and its own objects. `linkNodeModules`: host runs use the clone's node_modules; a
 * container gets its own Linux copy instead.
 */
export function createCheckout(
  repoDir: string,
  commitish: string,
  dir: string,
  opts: { linkNodeModules?: boolean } = {},
): ExpCheckout {
  const baseCommit = resolveLocalRef(repoDir, commitish);
  if (existsSync(dir)) throw new Error(`checkout ${dir} already exists`);
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['clone', '--quiet', '--no-checkout', '--no-hardlinks', repoDir, dir], {
    stdio: 'pipe',
  });
  // A head kept under refs/fiks-exp is not cloned (only branches and tags are): fetch it locally.
  try {
    git(dir, ['cat-file', '-e', `${baseCommit}^{commit}`]);
  } catch {
    git(dir, ['fetch', '--quiet', '--no-tags', repoDir, baseCommit]);
  }
  git(dir, ['checkout', '--quiet', '--detach', baseCommit]);
  git(dir, ['remote', 'remove', 'origin']);
  git(dir, ['config', 'user.name', EXP_GIT_IDENTITY.name]);
  git(dir, ['config', 'user.email', EXP_GIT_IDENTITY.email]);
  appendFileSync(join(dir, '.git/info/exclude'), '\n/node_modules\n');
  const modules = join(repoDir, 'node_modules');
  if ((opts.linkNodeModules ?? true) && existsSync(modules))
    symlinkSync(realpathSync(modules), join(dir, 'node_modules'));
  return { dir, baseCommit, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

const commitEnv = () => ({
  GIT_AUTHOR_NAME: EXP_GIT_IDENTITY.name,
  GIT_AUTHOR_EMAIL: EXP_GIT_IDENTITY.email,
  GIT_AUTHOR_DATE: EXP_GIT_IDENTITY.date,
  GIT_COMMITTER_NAME: EXP_GIT_IDENTITY.name,
  GIT_COMMITTER_EMAIL: EXP_GIT_IDENTITY.email,
  GIT_COMMITTER_DATE: EXP_GIT_IDENTITY.date,
});

/** Commits exactly `paths` (added, changed or deleted) with the fixed identity; returns HEAD. */
export function commitPaths(dir: string, paths: string[], message: string): string {
  if (paths.length) {
    git(dir, ['add', '--all', '--', ...paths]);
    const staged = git(dir, ['diff', '--cached', '--name-only']);
    if (staged) git(dir, ['commit', '--quiet', '--no-verify', '-m', message], commitEnv());
  }
  return git(dir, ['rev-parse', 'HEAD']);
}

/** Changed and untracked files relative to `base` (repo-relative, node_modules excluded). */
export function changedSince(dir: string, base: string): string[] {
  const tracked = git(dir, ['diff', '--name-only', base, '--', '.', ':(exclude)node_modules'])
    .split('\n')
    .filter(Boolean);
  const untracked = git(dir, ['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .filter((f) => f && f !== 'node_modules' && !f.startsWith('node_modules/'));
  return [...new Set([...tracked, ...untracked])].sort();
}

/** Puts `files` back to their state at `base` (tracked: restored; untracked: deleted). */
export function revertFiles(dir: string, base: string, files: string[]): void {
  for (const f of files) {
    let tracked = true;
    try {
      git(dir, ['cat-file', '-e', `${base}:${f}`]);
    } catch {
      tracked = false;
    }
    if (tracked) git(dir, ['checkout', base, '--', f]);
    else rmSync(join(dir, f), { force: true, recursive: true });
  }
}

/** git diff --numstat between two commits, optionally limited to `pathspec`. */
export function diffStats(dir: string, from: string, to: string, pathspec: string[] = []): DiffStats {
  const out = git(dir, ['diff', '--numstat', from, to, '--', ...pathspec]);
  const files: string[] = [];
  let insertions = 0;
  let deletions = 0;
  for (const line of out.split('\n').filter(Boolean)) {
    const [a, d, f] = line.split('\t');
    files.push(f ?? '');
    insertions += Number(a) || 0;
    deletions += Number(d) || 0;
  }
  return { files, insertions, deletions };
}

/** Keeps `sha` (a commit in `checkout`) as `ref` in the shop-mcp clone. Local only, never pushed. */
export function keepHead(shopRepo: string, checkout: string, sha: string, ref: string): void {
  if (!/^refs\/fiks-exp\/[\w./-]+$/.test(ref) || ref.includes('..')) throw new Error(`bad exp ref ${ref}`);
  git(shopRepo, ['fetch', '--quiet', '--no-tags', checkout, sha]);
  git(shopRepo, ['update-ref', ref, sha]);
}

export const expRef = (runId: string) => `refs/fiks-exp/${runId}`;
