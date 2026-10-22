// Thin git helpers (execFileSync, no shell). Every ref check peels with ^{commit} (PLAN 0.1 item 9).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  }).trimEnd();
}

export function gitBuffer(repo: string, args: string[]): Buffer {
  return execFileSync('git', ['-C', repo, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** Like `git`, but returns null instead of throwing. */
export function gitTry(repo: string, args: string[]): string | null {
  try {
    return git(repo, args);
  } catch {
    return null;
  }
}

/** Object type of a sha (`commit`, `tag`, `tree`, `blob`) or null if absent. */
export function objectType(repo: string, sha: string): string | null {
  return gitTry(repo, ['cat-file', '-t', sha]);
}

/** `<ref>^{commit}` or null. */
export function peel(repo: string, ref: string): string | null {
  return gitTry(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
}

export function treeOf(repo: string, commit: string): string | null {
  return gitTry(repo, ['rev-parse', '--verify', '--quiet', `${commit}^{tree}`]);
}

/** True iff `a` is an ancestor of `b` (or equal). */
export function isAncestor(repo: string, a: string, b: string): boolean {
  try {
    execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', a, b], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function tagExists(repo: string, tag: string): boolean {
  return gitTry(repo, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]) !== null;
}

export function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Git blob id of raw bytes: sha1("blob <len>\0" + bytes). */
export function gitBlobId(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/** Bytes of `<commit>:<path>` or null if the path is not in that commit. */
export function showFile(repo: string, commit: string, path: string): Buffer | null {
  try {
    return gitBuffer(repo, ['cat-file', 'blob', `${commit}:${path}`]);
  } catch {
    return null;
  }
}

export function repoRoot(cwd: string): string {
  return git(cwd, ['rev-parse', '--show-toplevel']);
}
