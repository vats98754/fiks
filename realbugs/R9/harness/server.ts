// R9 process-level replay (cloudflare/mcp-server-cloudflare #468). The issue's server is the
// stdio package `@cloudflare/mcp-server-cloudflare`, run as `npx -y @cloudflare/mcp-server-cloudflare
// run <account-id>`. For a tree of the .work/realbugs/R9 clone the harness runs what that command
// would run for the tree:
//   - `repo-package`: the tree ships a non-private `@cloudflare/mcp-server-cloudflare` package with
//     a bin (PR #469 adds one at packages/mcp-server-cloudflare): install it from the tree's
//     lockfile (pnpm, filtered) and run its bin;
//   - `npx-artifact`: the tree ships none (the prefix: its root package.json carries the name but
//     is private and has no bin), so npx resolves the published 0.2.0, installed from the
//     committed lock in ./npx-0.2.0 (integrity-pinned, the version PR #469's lockfile pins).
// The server's upstream is api.cloudflare.com, hard-coded, so the RBX HTTPS shim (proxy mode)
// answers it from the case's exchanges; every other host is refused. One fresh process per run.
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { ContractFile, HttpExchange, Recording } from '../../../packages/contracts/src/index.ts';
import { type ProcessReplayed, replayRecordingProcess } from '../../../packages/replay-proc/src/index.ts';

export const BUG_DIR = fileURLToPath(new URL('..', import.meta.url));
export const FIKS_ROOT = resolve(BUG_DIR, '../..');
const NPX_LOCK_DIR = fileURLToPath(new URL('./npx-0.2.0/', import.meta.url));

/** The package the issue runs with npx. */
export const PACKAGE = '@cloudflare/mcp-server-cloudflare';
/** Its published version at the prefix (pinned by integrity in ./npx-0.2.0/package-lock.json). */
export const NPX_VERSION = '0.2.0';
/** The only upstream host the server talks to. */
export const UPSTREAM_HOST = 'api.cloudflare.com';
/** A dummy API token (the replay never checks it; no real credential is used). */
export const REPLAY_TOKEN = 'fiks-replay-token';
/** Where workspace packages live in the clone (checked for a publishable PACKAGE). */
const PACKAGE_DIRS = ['packages', 'apps'];

/** `.work/realbugs/R9` (FIKS_REALBUG_DIR overrides; relative paths resolve against the fiks root). */
export function repoDir(env = process.env): string {
  const d = env.FIKS_REALBUG_DIR ?? '.work/realbugs/R9';
  return isAbsolute(d) ? d : resolve(FIKS_ROOT, d);
}

/** Where per-commit build trees live: `<repoDir>.builds/<sha>` (FIKS_REALBUG_BUILDS_DIR overrides). */
export function buildsDir(env = process.env): string {
  const d = env.FIKS_REALBUG_BUILDS_DIR;
  if (!d) return `${repoDir(env)}.builds`;
  return isAbsolute(d) ? d : resolve(FIKS_ROOT, d);
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

export class SetupError extends Error {}

/** `prefix`, `fix` (local tags made by ensure-realbugs) or any commit-ish -> full SHA. */
export function resolveSha(ref: string, repo = repoDir()): string {
  if (!existsSync(join(repo, '.git'))) {
    throw new SetupError(
      `${repo} is not a clone; run: node scripts/ensure-realbugs.mjs --id R9 (or set FIKS_REALBUG_DIR)`,
    );
  }
  try {
    return git(repo, 'rev-parse', '--verify', '-q', `${ref}^{commit}`);
  } catch {
    throw new SetupError(`${ref} does not name a commit in ${repo}`);
  }
}

async function withDirLock<T>(target: string, fn: () => T): Promise<T> {
  const lock = `${target}.lock`;
  mkdirSync(dirname(lock), { recursive: true });
  for (let i = 0; ; i++) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, 'pid'), String(process.pid));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let pid = 0;
      try {
        pid = Number(readFileSync(join(lock, 'pid'), 'utf8'));
      } catch {}
      let alive = false;
      if (pid > 0) {
        try {
          process.kill(pid, 0);
          alive = true;
        } catch (err) {
          alive = (err as NodeJS.ErrnoException).code === 'EPERM';
        }
      }
      if (pid > 0 && !alive) rmSync(lock, { recursive: true, force: true });
      else if (i > 1200) throw new Error(`timed out waiting for ${lock}`);
      else await sleep(500);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function run(cwd: string, cmd: string, args: string[], log: (s: string) => void) {
  log(`[r9] ${cwd}: ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
}

interface PackageJson {
  name?: string;
  private?: boolean;
  bin?: string | Record<string, string>;
}

/** The bin entry of a publishable PACKAGE in `tree` (relative to the tree), or null. */
export function findRepoPackage(tree: string): { dir: string; bin: string } | null {
  const dirs = ['.'];
  for (const top of PACKAGE_DIRS) {
    const base = join(tree, top);
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base, { withFileTypes: true })) {
      if (d.isDirectory()) dirs.push(join(top, d.name));
    }
  }
  for (const dir of dirs) {
    const file = join(tree, dir, 'package.json');
    if (!existsSync(file)) continue;
    let pkg: PackageJson;
    try {
      pkg = JSON.parse(readFileSync(file, 'utf8')) as PackageJson;
    } catch {
      continue;
    }
    if (pkg.name !== PACKAGE || pkg.private === true || !pkg.bin) continue;
    const bin =
      typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin['mcp-server-cloudflare'] ?? Object.values(pkg.bin)[0]);
    if (bin) return { dir, bin: join(dir, bin) };
  }
  return null;
}

/** Installs the published 0.2.0 from the committed lock (npm ci) once; returns its entry point. */
export function installNpxArtifact(log: (s: string) => void = () => {}): string {
  const dir = join(buildsDir(), `npx-${NPX_VERSION}`);
  const entry = join(dir, 'node_modules', PACKAGE, 'dist', 'index.js');
  const lock = readFileSync(join(NPX_LOCK_DIR, 'package-lock.json'), 'utf8');
  const marker = join(dir, '.fiks-r9-lock');
  if (existsSync(entry) && existsSync(marker) && readFileSync(marker, 'utf8') === lock) return entry;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) copyFileSync(join(NPX_LOCK_DIR, f), join(dir, f));
  run(dir, 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], log);
  if (!existsSync(entry)) throw new SetupError(`npm ci produced no ${entry}`);
  writeFileSync(marker, lock);
  return entry;
}

/** Installs the tree's own PACKAGE (filtered pnpm install from its lockfile) when absent. */
export function installRepoPackage(tree: string, pkgDir: string, log: (s: string) => void = () => {}) {
  if (existsSync(join(tree, pkgDir, 'node_modules'))) return;
  run(
    tree,
    'pnpm',
    [
      'install',
      '--frozen-lockfile',
      '--ignore-scripts',
      '--config.confirmModulesPurge=false',
      '--filter',
      PACKAGE,
    ],
    log,
  );
}

export interface Build {
  sha: string | null;
  tree: string;
  kind: 'repo-package' | 'npx-artifact';
  /** `node <entry>`; the case's `run <account-id>` is appended per run. */
  entry: string;
}

/**
 * A runnable server for `--sha <ref>` (a detached worktree of the clone, installed once per SHA)
 * or for `--worktree <dir>` (an already checked-out tree, e.g. an agent's head).
 */
export async function prepareBuild(
  sel: { sha?: string; worktree?: string },
  log: (s: string) => void = (s) => process.stderr.write(`${s}\n`),
): Promise<Build> {
  let tree: string;
  let sha: string | null = null;
  if (sel.worktree) {
    tree = resolve(sel.worktree);
    if (!existsSync(join(tree, 'package.json'))) throw new SetupError(`${tree} has no package.json`);
    try {
      sha = git(tree, 'rev-parse', 'HEAD');
    } catch {}
  } else {
    const repo = repoDir();
    const s = resolveSha(sel.sha ?? 'prefix', repo);
    sha = s;
    tree = join(buildsDir(), s);
    await withDirLock(tree, () => {
      if (!existsSync(join(tree, '.git'))) {
        mkdirSync(dirname(tree), { recursive: true });
        log(`[r9] worktree ${s.slice(0, 12)} -> ${tree}`);
        git(repo, 'worktree', 'prune');
        git(repo, 'worktree', 'add', '--detach', tree, s);
      }
      const head = git(tree, 'rev-parse', 'HEAD');
      if (head !== s) throw new SetupError(`${tree} is at ${head}, expected ${s}`);
    });
  }
  const pkg = findRepoPackage(tree);
  if (pkg) {
    await withDirLock(tree, () => installRepoPackage(tree, pkg.dir, log));
    const entry = join(tree, pkg.bin);
    if (!existsSync(entry)) throw new SetupError(`${tree}: bin ${pkg.bin} does not exist`);
    return { sha, tree, kind: 'repo-package', entry };
  }
  const entry = await withDirLock(join(buildsDir(), `npx-${NPX_VERSION}`), () => installNpxArtifact(log));
  return { sha, tree, kind: 'npx-artifact', entry };
}

/** A replayable case: the trigger fixture or a held-out input. */
export interface Case {
  id: string;
  capturedAt: string;
  /** The `run <account-id>` argument. */
  accountId: string;
  tool: string;
  args: Record<string, unknown>;
  /** Upstream exchanges (url = path + query on api.cloudflare.com). */
  http: HttpExchange[];
}

export function loadCase(path: string): Case & { file: string } {
  const c = JSON.parse(readFileSync(path, 'utf8')) as Case;
  for (const k of ['id', 'capturedAt', 'accountId', 'tool'] as const) {
    if (typeof c[k] !== 'string' || c[k] === '') throw new Error(`${path}: missing ${k}`);
  }
  if (!Array.isArray(c.http)) throw new Error(`${path}: http is not an array`);
  return { ...c, file: resolve(path) };
}

/**
 * Request matching: the query of a list endpoint is ignored (a head may page or filter
 * differently and still be correct), so exchanges match on method, path and header names.
 */
export const MATCHERS = {
  normalisers: [{ kind: 'pattern' as const, in: 'url' as const, pattern: '\\?.*$', replace: '' }],
};

export interface CaseRun {
  replayed: ProcessReplayed;
  /** Exchanges the replay answered for this call. */
  upstream: HttpExchange[];
}

/** Runs one case through a fresh server process (stdio) with the upstream replayed. */
export async function runCase(build: Build, c: Case, contracts?: ContractFile): Promise<CaseRun> {
  const home = mkdtempSync(join(tmpdir(), 'fiks-r9-home-'));
  try {
    const rec: Recording = { id: c.id, capturedAt: c.capturedAt, tool: c.tool, args: c.args, http: c.http };
    const replayed = await replayRecordingProcess(rec, {
      server: { command: process.execPath, args: [build.entry, 'run', c.accountId], cwd: build.tree },
      contracts: contracts ?? { server: 'cloudflare', version: 1, contracts: [] },
      upstream: { mode: 'proxy', hosts: [UPSTREAM_HOST] },
      matchers: MATCHERS,
      clock: 'capture',
      env: { CLOUDFLARE_API_TOKEN: REPLAY_TOKEN, HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
    });
    return { replayed, upstream: replayed.served };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
