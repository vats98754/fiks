// The attempt's checkout of the target repo. A standalone clone (not a `git worktree`): its .git
// directory lives inside it, so git works in the per-attempt container, where only the worktree
// is mounted (rerecord-head reads HEAD and blobs at the base commit). The base is resolved
// locally as `<ref>^{commit}` (P17, CORE resolveLocalRef); nothing is fetched. The clone has no
// remote, copies its objects (no hardlinks into the source clone) and ignores fiks's own files.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { resolveLocalRef } from '@fiks/repro';

export const ARM_GIT_IDENTITY = {
  name: 'fiks-arms',
  email: 'fiks-arms@localhost',
  /** Fixed commit time: the same diff on the same parent gives the same head sha in every arm. */
  date: '2026-10-01T12:00:00Z',
};

export interface AttemptCheckout {
  dir: string;
  baseRef: string;
  baseCommit: string;
  remove(): void;
}

const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 64 * 1024 * 1024,
  }).trim();

export function createAttemptCheckout(repoDir: string, baseRef: string, dir: string): AttemptCheckout {
  const baseCommit = resolveLocalRef(repoDir, baseRef);
  if (existsSync(dir)) throw new Error(`attempt checkout ${dir} already exists`);
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['clone', '--quiet', '--no-checkout', '--no-hardlinks', repoDir, dir], {
    stdio: 'pipe',
  });
  git(dir, ['checkout', '--quiet', '--detach', baseCommit]);
  git(dir, ['remote', 'remove', 'origin']);
  git(dir, ['config', 'user.name', ARM_GIT_IDENTITY.name]);
  git(dir, ['config', 'user.email', ARM_GIT_IDENTITY.email]);
  // fiks's files never enter a candidate: the alert copy and the dependency link.
  appendFileSync(join(dir, '.git/info/exclude'), '\n/.alerts/\n/node_modules\n');
  const modules = join(repoDir, 'node_modules');
  if (existsSync(modules)) symlinkSync(realpathSync(modules), join(dir, 'node_modules'));
  return {
    dir,
    baseRef,
    baseCommit,
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Commits every change in the checkout (the candidate) with the fixed identity; returns HEAD. */
export function commitCandidate(dir: string, message: string): string {
  git(dir, ['add', '--all', '--', '.']);
  const env = {
    GIT_AUTHOR_NAME: ARM_GIT_IDENTITY.name,
    GIT_AUTHOR_EMAIL: ARM_GIT_IDENTITY.email,
    GIT_AUTHOR_DATE: ARM_GIT_IDENTITY.date,
    GIT_COMMITTER_NAME: ARM_GIT_IDENTITY.name,
    GIT_COMMITTER_EMAIL: ARM_GIT_IDENTITY.email,
    GIT_COMMITTER_DATE: ARM_GIT_IDENTITY.date,
  };
  const staged = git(dir, ['diff', '--cached', '--name-only']);
  if (staged) git(dir, ['commit', '--quiet', '--no-verify', '-m', message], env);
  return git(dir, ['rev-parse', 'HEAD']);
}

export const headOf = (dir: string) => git(dir, ['rev-parse', 'HEAD']);
