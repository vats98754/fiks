// Candidate heads on the host: a standalone clone of the domain's repo (its own .git, so git works
// inside the container where the host repo is not mounted), checked out at the drift's base
// `<ref>^{commit}` from local refs only (no fetch), the patch applied with `git apply` and committed
// under a fixed identity and date, so the same patch always gives the same head commit. Nothing of
// the candidate's code runs here.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'fiks-heldout',
  GIT_AUTHOR_EMAIL: 'heldout@fiks.invalid',
  GIT_COMMITTER_NAME: 'fiks-heldout',
  GIT_COMMITTER_EMAIL: 'heldout@fiks.invalid',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
};

export function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    input,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', ...GIT_ENV },
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** `<ref>^{commit}` in a local repo (tags and branches; never fetched). */
export function resolveCommit(repoDir: string, ref: string): string {
  return git(repoDir, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
}

export interface Head {
  dir: string;
  baseCommit: string;
  headCommit: string;
  /** Tree of the head commit (`git rev-parse HEAD^{tree}`). */
  tree: string;
  /** False when the patch did not apply; then dir is at base. */
  applied: boolean;
  error?: string;
  remove(): void;
}

/** Clones `repoDir` at `base` and applies `diff` (an empty diff is the base itself). */
export function prepareHead(repoDir: string, base: string, diff: string, parent?: string): Head {
  const baseCommit = resolveCommit(repoDir, base);
  const root = realpathSync(mkdtempSync(join(parent ?? tmpdir(), 'fiks-heldout-head-')));
  const dir = join(root, 'repo');
  git(root, ['clone', '--quiet', '--no-checkout', '--local', repoDir, dir]);
  git(dir, ['checkout', '--quiet', '--detach', baseCommit]);
  let applied = true;
  let error: string | undefined;
  if (diff.trim()) {
    const file = join(root, 'patch.diff');
    writeFileSync(file, diff.endsWith('\n') ? diff : `${diff}\n`);
    try {
      git(dir, ['apply', '--whitespace=nowarn', file]);
      git(dir, ['add', '-A']);
      git(dir, ['commit', '--quiet', '--no-verify', '-m', 'candidate patch']);
    } catch (e) {
      applied = false;
      error = (e as { stderr?: string }).stderr?.trim() || String(e);
      git(dir, ['checkout', '--quiet', '--force', '--detach', baseCommit]);
      git(dir, ['clean', '-fdq']);
    }
  }
  return {
    dir,
    baseCommit,
    headCommit: git(dir, ['rev-parse', 'HEAD']).trim(),
    tree: git(dir, ['rev-parse', 'HEAD^{tree}']).trim(),
    applied,
    ...(error ? { error } : {}),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Writes the base versions of `paths` (as committed at `commit`) under `out`. */
export function exportBase(headDir: string, commit: string, paths: readonly string[], out: string): void {
  for (const p of paths) {
    let text: string;
    try {
      text = git(headDir, ['show', `${commit}:${p}`]);
    } catch {
      continue; // added by the patch
    }
    mkdirSync(dirname(join(out, p)), { recursive: true });
    writeFileSync(join(out, p), text);
  }
}

/** Writes files into a worktree (repo-relative paths; refuses `..` and absolute paths). */
export function writeInto(dir: string, files: readonly { path: string; bytes: string | Uint8Array }[]): void {
  for (const f of files) {
    if (f.path.startsWith('/') || f.path.split('/').includes('..')) throw new Error(`refusing ${f.path}`);
    mkdirSync(dirname(join(dir, f.path)), { recursive: true });
    writeFileSync(join(dir, f.path), f.bytes);
  }
}

export function removeFrom(dir: string, paths: readonly string[]): void {
  for (const p of paths) if (existsSync(join(dir, p))) rmSync(join(dir, p), { force: true });
}
