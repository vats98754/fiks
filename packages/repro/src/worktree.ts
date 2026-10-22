import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' }).trim();

export interface Worktree {
  dir: string;
  ref: string;
  remove(): void;
}

// --- Worktree lock (PLAN P6) ---------------------------------------------------------------
// `git worktree prune|add|remove` edit the shared `.git/worktrees` folder. Two processes doing
// that at once (parallel workers, each with its own FIKS_DIR) can corrupt it or fail on a git
// lock file, so every such call runs under one lock per repository.

const LOCK_STALE_MS = 120_000;
const sleepMs = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function lockDir(repoDir: string): string {
  const common = git(repoDir, 'rev-parse', '--git-common-dir');
  return join(isAbsolute(common) ? common : resolve(repoDir, common), 'fiks-worktree.lock');
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lockIsStale(dir: string): boolean {
  try {
    const pid = Number(readFileSync(join(dir, 'owner'), 'utf8').trim());
    if (pid > 0 && !pidAlive(pid)) return true;
  } catch {
    // Owner file not written yet, or the lock was just released: judge by age only.
  }
  try {
    return Date.now() - statSync(dir).mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

/** Runs `fn` while holding the repository's worktree lock (a directory created atomically). */
export function withWorktreeLock<T>(repoDir: string, fn: () => T): T {
  const dir = lockDir(repoDir);
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, 'owner'), `${process.pid}\n`);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (lockIsStale(dir)) rmSync(dir, { recursive: true, force: true });
      else if (Date.now() > deadline) throw new Error(`timed out waiting for the worktree lock ${dir}`);
      else sleepMs(20 + Math.floor(Math.random() * 30));
    }
  }
  try {
    return fn();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function removeWorktree(repoDir: string, dir: string): void {
  withWorktreeLock(repoDir, () => {
    try {
      git(repoDir, 'worktree', 'remove', '--force', dir);
    } catch {
      rmSync(dir, { recursive: true, force: true });
      git(repoDir, 'worktree', 'prune');
    }
  });
}

function addUnderLock(repoDir: string, dir: string, args: string[]): void {
  withWorktreeLock(repoDir, () => {
    if (existsSync(dir)) {
      try {
        git(repoDir, 'worktree', 'remove', '--force', dir);
      } catch {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    mkdirSync(dirname(dir), { recursive: true });
    git(repoDir, 'worktree', 'prune');
    git(repoDir, 'worktree', 'add', ...args);
  });
}

/**
 * A throwaway git worktree of the shop-mcp clone at `ref` (detached, or on a new `branch`),
 * sharing the clone's node_modules (same lockfile at seed).
 */
export function addWorktree(shopDir: string, dir: string, ref: string, branch?: string): Worktree {
  addUnderLock(shopDir, dir, branch ? ['-B', branch, dir, ref] : ['--detach', dir, ref]);
  symlinkSync(join(shopDir, 'node_modules'), join(dir, 'node_modules'));
  return { dir, ref, remove: () => removeWorktree(shopDir, dir) };
}

// --- Local-ref worktrees (PLAN P17) --------------------------------------------------------

export interface CreateWorktreeOptions {
  /** Where to put it (default: a fresh, uniquely named folder under `parent`). */
  dir?: string;
  /**
   * Without `dir`: the folder in which a fresh `mkdtemp` directory is made for this worktree
   * (default: the OS temp dir). Each call gets its own directory, so concurrent processes never
   * share one (P6), and `remove()` deletes that directory too.
   */
  parent?: string;
  /** Prefix of the `mkdtemp` directory made under `parent` (default `fiks-wt-`). */
  prefix?: string;
  /** Create (or reset) this branch at the resolved commit instead of a detached HEAD. */
  branch?: string;
  /** Fetch tags and branches from origin first. Only when asked, and never with a run key. */
  fetch?: boolean;
  /** Set in experiment runs; a fetch is then refused. */
  runKey?: string;
  /** Symlink the repository's node_modules into the worktree (default: when it exists). */
  linkNodeModules?: boolean;
}

export interface LocalWorktree extends Worktree {
  /** The commit `ref^{commit}` resolved to, which the worktree holds. */
  commit: string;
}

/**
 * Resolves `ref` with `git rev-parse --verify <ref>^{commit}`: a local branch, an annotated or
 * lightweight tag (peeled), or a commit. Never fetches.
 */
export function resolveLocalRef(repoDir: string, ref: string): string {
  if (!ref || ref.startsWith('-')) throw new Error(`invalid ref ${JSON.stringify(ref)}`);
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], {
      cwd: repoDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(
      `unknown ref ${JSON.stringify(ref)} in ${repoDir}: no local branch, tag or commit by that name (fiks never fetches it unless --fetch is given)`,
    );
  }
}

/**
 * A git worktree of `repoDir` at the commit `ref` resolves to locally (P17). There is no fetch
 * unless `fetch` is set, and a fetch is refused when a `runKey` is set.
 */
export function createWorktree(
  repoDir: string,
  ref: string,
  opts: CreateWorktreeOptions = {},
): LocalWorktree {
  if (opts.fetch) {
    if (opts.runKey) throw new Error(`--fetch is refused with a run key (${opts.runKey}); use a local ref`);
    git(repoDir, 'fetch', '--tags', 'origin');
  }
  const commit = resolveLocalRef(repoDir, ref);
  let own: string | undefined;
  if (!opts.dir) {
    const parent = opts.parent ?? tmpdir();
    mkdirSync(parent, { recursive: true });
    own = mkdtempSync(join(parent, opts.prefix ?? 'fiks-wt-'));
  }
  const dir = opts.dir ?? join(own as string, 'repo');
  try {
    addUnderLock(repoDir, dir, opts.branch ? ['-B', opts.branch, dir, commit] : ['--detach', dir, commit]);
  } catch (e) {
    if (own) rmSync(own, { recursive: true, force: true });
    throw e;
  }
  const modules = join(repoDir, 'node_modules');
  if ((opts.linkNodeModules ?? true) && existsSync(modules)) symlinkSync(modules, join(dir, 'node_modules'));
  const remove = () => {
    removeWorktree(repoDir, dir);
    if (own) rmSync(own, { recursive: true, force: true });
  };
  return { dir, ref, commit, remove };
}
