import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

// Not trimmed: porcelain-style output keeps meaningful leading columns.
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const lines = (s: string) => s.split('\n').filter(Boolean);

/**
 * Files that differ from `base` (committed or not) plus untracked files. Comparing against a
 * fixed commit, not HEAD, means an agent cannot hide a change by committing it.
 */
export function changedFilesSince(repoDir: string, base: string): string[] {
  const changed = lines(git(repoDir, 'diff', '--name-only', base));
  const untracked = lines(git(repoDir, 'ls-files', '--others', '--exclude-standard'));
  return [...new Set([...changed, ...untracked])].filter((f) => f !== 'node_modules').sort();
}

/** Files changed in the working tree relative to HEAD (tracked changes and new files). */
export function changedFiles(repoDir: string): string[] {
  return changedFilesSince(repoDir, 'HEAD');
}

export const headOf = (repoDir: string) => git(repoDir, 'rev-parse', 'HEAD').trim();

/** The repair agent may only change source files. Tests, CI, manifests and lockfiles are off limits. */
export const REPAIR_ALLOWED = (f: string) => /^src\/.+\.ts$/.test(f);
/** fiks's own re-recording commit may only add re-recorded fixtures/traces. */
export const RERECORD_ALLOWED = (f: string) => /^test\/.+\.rerecorded\.json$/.test(f);

export function checkPaths(
  files: string[],
  allowed: (f: string) => boolean,
): { ok: boolean; rejected: string[] } {
  const rejected = files.filter((f) => !allowed(f));
  return { ok: rejected.length === 0 && files.length > 0, rejected };
}

/** Is `p` (absolute or relative to the worktree) inside the worktree? */
export function insideWorktree(worktree: string, p: string): boolean {
  const abs = isAbsolute(p) ? resolve(p) : resolve(worktree, p);
  const rel = relative(worktree, abs);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Pure check for an agent tool call: may it write to this path inside the worktree? */
export function mayWrite(worktree: string, filePath: string): boolean {
  if (!insideWorktree(worktree, filePath)) return false;
  const rel = relative(worktree, isAbsolute(filePath) ? resolve(filePath) : resolve(worktree, filePath));
  return REPAIR_ALLOWED(rel);
}

/** Pure check for an agent Read/Grep/Glob call: only inside the worktree (no .env, no home dir). */
export function mayRead(worktree: string, p: string | undefined): boolean {
  return p === undefined || p === '' || insideWorktree(worktree, p);
}

/**
 * Pure check for an agent Bash call: exactly `pnpm typecheck`, `pnpm lint`, `pnpm test [paths]`
 * or `pnpm exec vitest run [paths]`. No flags (so no --write, -u, --config or --outDir).
 */
export function mayRun(command: string): boolean {
  const parts = command.trim().split(/\s+/);
  const path = /^[\w./-]+$/;
  const paths = (xs: string[]) => xs.every((x) => path.test(x) && !x.startsWith('-') && !x.includes('..'));
  if (parts[0] !== 'pnpm') return false;
  if (parts.length === 2 && (parts[1] === 'typecheck' || parts[1] === 'lint')) return true;
  if (parts[1] === 'test') return paths(parts.slice(2));
  if (parts[1] === 'exec' && parts[2] === 'vitest' && parts[3] === 'run') return paths(parts.slice(4));
  return false;
}

/** sha256 of a file in the worktree, or of a blob at `commit:path`. */
export function fileHash(repoDir: string, path: string, commit?: string): string {
  const bytes = commit
    ? execFileSync('git', ['show', `${commit}:${path}`], { cwd: repoDir })
    : readFileSync(join(repoDir, path));
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * fiks owns these bytes: each path's content when fiks last vouched for it. Agent code runs
 * during the gates and could rewrite any file it can reach, so before committing, the working
 * files and the committed blobs must still match.
 */
export function changedSinceSnapshot(
  repoDir: string,
  snapshot: Record<string, string>,
  commit?: string,
): string[] {
  return Object.entries(snapshot)
    .filter(([path, hash]) => {
      try {
        return fileHash(repoDir, path, commit) !== hash;
      } catch {
        return true;
      }
    })
    .map(([path]) => path);
}
