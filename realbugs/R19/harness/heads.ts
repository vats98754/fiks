// Where the R19 clone lives and how a head of it is built (PLAN 5.10, round 6: the clone is under
// the gitignored .work/, never inside realbugs/R19).
//   clone   FIKS_REALBUG_DIR, default <fiks>/.work/realbugs/R19 (scripts/ensure-realbugs.mjs --id R19)
//   heads   <clone>-heads/<sha>: a detached `git worktree` of the clone per commit, with
//           `npm ci --ignore-scripts` (the repo's own package-lock.json) and `npm run build:esm`.
// Building a head is the only step that needs the network (the npm registry, for npm ci); replay
// runs are offline. A head directory given directly (--head-dir) is used as it is, built or not.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUG_ID = 'R19';
export const BUG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FIKS_ROOT = resolve(BUG_DIR, '../..');
/** The server entry point inside a built head (package.json `bin`). */
export const SERVER_ENTRY = 'dist/esm/index.js';

export function repoDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.FIKS_REALBUG_DIR ?? join(FIKS_ROOT, '.work/realbugs', BUG_ID));
}

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

/** `prefix`, `fix`, a tag, branch or SHA of the clone -> the full commit SHA. */
export function resolveSha(ref: string, dir = repoDir()): string {
  if (!existsSync(join(dir, '.git'))) {
    throw new Error(`no clone at ${dir}; run: node scripts/ensure-realbugs.mjs --id ${BUG_ID}`);
  }
  try {
    return git(dir, ['rev-parse', '--verify', `${ref}^{commit}`]);
  } catch {
    throw new Error(`${ref} is not a commit of ${dir}`);
  }
}

export function headDir(sha: string, dir = repoDir()): string {
  return `${dir}-heads/${sha}`;
}

const MARKER = '.fiks-r19-built';

/** A built head for `sha`: worktree + npm ci + build:esm, reused when already built. */
export function ensureHead(sha: string, opts: { dir?: string; log?: (s: string) => void } = {}): string {
  const dir = opts.dir ?? repoDir();
  const log = opts.log ?? ((s: string) => console.error(s));
  const out = headDir(sha, dir);
  const marker = join(out, MARKER);
  if (
    existsSync(marker) &&
    readFileSync(marker, 'utf8').trim() === sha &&
    existsSync(join(out, SERVER_ENTRY))
  ) {
    return out;
  }
  if (existsSync(out)) {
    // A half-built head from an interrupted run: start over.
    try {
      git(dir, ['worktree', 'remove', '--force', out]);
    } catch {
      rmSync(out, { recursive: true, force: true });
      git(dir, ['worktree', 'prune']);
    }
  }
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.tmp-${process.pid}`;
  log(`[r19] building head ${sha.slice(0, 12)} in ${out}`);
  git(dir, ['worktree', 'add', '--detach', tmp, sha]);
  const npm = (args: string[]) =>
    execFileSync('npm', args, { cwd: tmp, stdio: ['ignore', 'ignore', 'inherit'], env: process.env });
  npm(['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error']);
  npm(['run', '--silent', 'build:esm']);
  writeFileSync(join(tmp, MARKER), `${sha}\n`);
  git(dir, ['worktree', 'move', tmp, out]);
  if (!existsSync(join(out, SERVER_ENTRY))) throw new Error(`build of ${sha} produced no ${SERVER_ENTRY}`);
  return out;
}
