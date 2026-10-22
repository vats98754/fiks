import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { AllowedEditPaths, TraceFormat } from '@fiks/interfaces';

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

/** Today's repair allow-list as a regex source (P8: the shop Domain's `allowedEditPaths`). */
export const DEFAULT_ALLOWED_EDIT_PATHS: AllowedEditPaths = ['^src/.+\\.ts$'];

/**
 * The edit guard for a set of regex sources (a Domain's `allowedEditPaths`): a repo-relative path
 * may change only if one of them matches. No option = today's `^src/.+\.ts$`.
 */
export function editGuard(allowedEditPaths: AllowedEditPaths = DEFAULT_ALLOWED_EDIT_PATHS) {
  const res = allowedEditPaths.map((src) => new RegExp(src));
  return (f: string) => res.some((r) => r.test(f));
}

/** The repair agent may only change source files. Tests, CI, manifests and lockfiles are off limits. */
export const REPAIR_ALLOWED = editGuard();
/** fiks's own re-recording commit may only add re-recorded fixtures/traces. */
export const RERECORD_ALLOWED = (f: string) => /^test\/.+\.rerecorded\.json$/.test(f);

export function checkPaths(
  files: string[],
  allowed: (f: string) => boolean,
): { ok: boolean; rejected: string[] } {
  const rejected = files.filter((f) => !allowed(f));
  return { ok: rejected.length === 0 && files.length > 0, rejected };
}

/** Is `p` (absolute or relative to the worktree) inside the worktree? Lexical only. */
export function insideWorktree(worktree: string, p: string): boolean {
  const abs = isAbsolute(p) ? resolve(p) : resolve(worktree, p);
  const rel = relative(worktree, abs);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Where `p` really points: `fs.realpathSync` of its longest existing prefix, plus the part that
 * does not exist yet (a file about to be created). `undefined` when an existing component cannot
 * be resolved (a dangling symlink: reading or writing through it would follow the link).
 */
export function realResolve(p: string): string | undefined {
  let cur = resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync.native(cur), ...tail);
    } catch {
      try {
        lstatSync(cur);
        return undefined; // exists, but does not resolve: dangling link or a loop
      } catch {
        // does not exist: resolve the parent
      }
    }
    const parent = dirname(cur);
    if (parent === cur) return resolve(p);
    tail.unshift(basename(cur));
    cur = parent;
  }
}

const toPosix = (p: string) => p.split(sep).join('/');

const within = (root: string, abs: string) => {
  const rel = relative(root, abs);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)) ? toPosix(rel) : undefined;
};

/**
 * Repo-relative form of `p` without following symlinks (`..` is still normalised away). The
 * worktree may be named by its own path or its realpath (macOS `/var` vs `/private/var`).
 */
function lexicalRel(worktree: string, p: string): string | undefined {
  const abs = isAbsolute(p) ? resolve(p) : resolve(worktree, p);
  const real = realResolve(worktree);
  return within(resolve(worktree), abs) ?? (real === undefined ? undefined : within(real, abs));
}

/** Repo-relative path of `p` after resolving symlinks, or undefined when it leaves every root. */
function realRel(worktree: string, p: string, extraRoots: readonly string[] = []): string | undefined {
  const lexical = lexicalRel(worktree, p);
  if (lexical === undefined) return undefined;
  const real = realResolve(join(worktree, lexical));
  if (real === undefined) return undefined;
  for (const [i, root] of [worktree, ...extraRoots].entries()) {
    const rootReal = realResolve(root);
    const rel = rootReal === undefined ? undefined : within(rootReal, real);
    if (rel !== undefined) return i === 0 ? rel : `<extra-root>/${rel}`;
  }
  return undefined;
}

/**
 * Strict trace format (P3, E6 only): raw vendor bytes stay out of the agent's reach. Fixtures,
 * stored repro traces, stored traces and rendered alerts all carry raw upstream bodies.
 */
export const STRICT_QUARANTINE: readonly RegExp[] = [
  /^test\/fixtures(\/|$)/i,
  /^test\/repro\/[^/]+\.json$/i,
  /^test\/traces(\/|$)/i,
  /^\.alerts(\/|$)/i,
];
/** Directories that hold quarantined files: a strict-mode content search may not start at or above them. */
const STRICT_QUARANTINE_DIRS = ['test/fixtures', 'test/repro', 'test/traces', '.alerts'];

export const isQuarantined = (rel: string) => STRICT_QUARANTINE.some((r) => r.test(rel));

export interface ReadPolicy {
  /** `raw` (default): every file in the worktree, incl. `.alerts/**` and `test/fiks/**`. */
  traceFormat?: TraceFormat;
  /** Further directories the agent may read (resolved with realpath too). Default none. */
  extraReadRoots?: readonly string[];
}

export interface WritePolicy {
  /** Regex sources for repo-relative paths that may be edited (default `^src/.+\.ts$`). */
  allowedEditPaths?: AllowedEditPaths;
}

/**
 * Pure check for an agent tool call: may it write to this path inside the worktree? The path
 * must match the edit guard both as given and after resolving symlinks, so `src/x.ts -> ../.env`
 * or `src/x.ts -> ../test/check.ts` is refused.
 */
export function mayWrite(worktree: string, filePath: string, policy: WritePolicy = {}): boolean {
  if (!filePath) return false;
  const allowed = editGuard(policy.allowedEditPaths);
  const lexical = lexicalRel(worktree, filePath);
  const real = realRel(worktree, filePath);
  return lexical !== undefined && real !== undefined && allowed(lexical) && allowed(real);
}

/**
 * Pure check for an agent Read/Glob path: inside the worktree after `fs.realpathSync`, so `..`
 * escapes and symlinks that resolve outside (e.g. `src/x.ts -> ../../.env`) are refused. In
 * strict mode the quarantined raw-byte files are refused too (lexically and after resolution).
 */
export function mayRead(worktree: string, p: string | undefined, policy: ReadPolicy = {}): boolean {
  if (p === undefined || p === '') return true;
  const real = realRel(worktree, p, policy.extraReadRoots);
  if (real === undefined) return false;
  if (policy.traceFormat !== 'strict') return true;
  const lexical = lexicalRel(worktree, p) ?? '';
  return !isQuarantined(lexical) && !isQuarantined(real);
}

/**
 * A content search (Grep) reads every file below its root. In strict mode the root may not be a
 * quarantined directory or an ancestor of one (the worktree root included).
 */
export function maySearch(worktree: string, p: string | undefined, policy: ReadPolicy = {}): boolean {
  const root = p === undefined || p === '' ? '.' : p;
  if (!mayRead(worktree, root, policy)) return false;
  if (policy.traceFormat !== 'strict') return true;
  const rel = (realRel(worktree, root, policy.extraReadRoots) ?? '').toLowerCase();
  const covers = (q: string) => rel === '' || rel === q || q.startsWith(`${rel}/`) || rel.startsWith(`${q}/`);
  return !STRICT_QUARANTINE_DIRS.some(covers);
}

/** A Glob pattern stays inside the worktree: no `..` segment, and an absolute prefix must be readable. */
export function mayGlob(worktree: string, pattern: string | undefined, policy: ReadPolicy = {}): boolean {
  if (pattern === undefined || pattern === '') return true;
  if (pattern.split(/[\\/]/).includes('..')) return false;
  if (!isAbsolute(pattern)) return true;
  const segs = pattern.split('/');
  const firstGlob = segs.findIndex((seg) => /[*?[{]/.test(seg));
  const fixed = (firstGlob === -1 ? segs : segs.slice(0, firstGlob)).join('/') || '/';
  return mayRead(worktree, fixed, { ...policy, traceFormat: 'raw' });
}

/**
 * Symlinks in the worktree that resolve outside it (or dangle). The CLI fallback runner cannot
 * consult `mayRead`, so it refuses to start while any exists. `node_modules` (fiks's own link to
 * the clone's dependencies) is not walked.
 */
export function escapingSymlinks(worktree: string, ignore: readonly string[] = ['node_modules', '.git']) {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(worktree, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (!dir && ignore.includes(e.name)) continue;
      if (e.isSymbolicLink()) {
        if (realRel(worktree, rel) === undefined) out.push(`${rel} -> ${readlinkSync(join(worktree, rel))}`);
      } else if (e.isDirectory()) walk(rel);
    }
  };
  walk('');
  return out.sort();
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
