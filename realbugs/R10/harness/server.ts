// R10 process-level replay (servers #4887): builds the memory server at a commit of the
// .work/realbugs/R10 clone (or in a given worktree), then runs one case through an unmodified
// server process over MCP stdio. The memory server has no HTTP upstream: its "upstream" is the
// JSONL file named by MEMORY_FILE_PATH, so a case's recorded state is copied to a fresh temp
// file per run, and the process clock is frozen at the case's capturedAt (RBX clock preload).
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { ToolResultLike } from '../../../packages/contracts/src/index.ts';
import { spawnServer } from '../../../packages/replay-proc/src/index.ts';
import type { CaseIO } from './check.ts';

export const BUG_DIR = fileURLToPath(new URL('..', import.meta.url));
export const FIKS_ROOT = resolve(BUG_DIR, '../..');
const CLOCK_PRELOAD = new URL('../../../packages/replay-proc/src/clock-preload.mjs', import.meta.url);

/** Path of the memory server package inside the repo. */
export const PKG = 'src/memory';
/** Entry point the server command runs, relative to the repo root. */
export const ENTRY = `${PKG}/dist/index.js`;

/** `.work/realbugs/R10` (FIKS_REALBUG_DIR overrides; relative paths resolve against the fiks root). */
export function repoDir(env = process.env): string {
  const d = env.FIKS_REALBUG_DIR ?? '.work/realbugs/R10';
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
      `${repo} is not a clone; run: node scripts/ensure-realbugs.mjs --id R10 (or set FIKS_REALBUG_DIR)`,
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
  log(`[r10] ${cwd}: ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
}

/** Installs the memory workspace's lockfile deps (npm ci) when absent, then compiles it with tsc. */
export function installAndBuild(tree: string, stamp: string, log: (s: string) => void = () => {}) {
  if (!existsSync(join(tree, 'node_modules', '.package-lock.json'))) {
    run(
      tree,
      'npm',
      [
        'ci',
        '--workspace',
        PKG,
        '--include-workspace-root=false',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
      ],
      log,
    );
  }
  const marker = join(tree, PKG, 'dist', '.fiks-r10-build');
  if (stamp && existsSync(marker) && readFileSync(marker, 'utf8') === stamp) return;
  rmSync(join(tree, PKG, 'dist'), { recursive: true, force: true });
  run(join(tree, PKG), join(tree, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json'], log);
  if (!existsSync(join(tree, ENTRY))) throw new SetupError(`build produced no ${ENTRY} in ${tree}`);
  if (stamp) writeFileSync(marker, stamp);
}

export interface Build {
  sha: string | null;
  tree: string;
  entry: string;
}

/**
 * A built server for `--sha <ref>` (a detached worktree of the clone, built once per SHA) or for
 * `--worktree <dir>` (an already checked-out tree, e.g. an agent's head; rebuilt every time).
 */
export async function prepareBuild(
  sel: { sha?: string; worktree?: string },
  log: (s: string) => void = (s) => process.stderr.write(`${s}\n`),
): Promise<Build> {
  if (sel.worktree) {
    const tree = resolve(sel.worktree);
    if (!existsSync(join(tree, PKG, 'package.json'))) throw new SetupError(`${tree} has no ${PKG}`);
    await withDirLock(tree, () => installAndBuild(tree, '', log));
    let sha: string | null = null;
    try {
      sha = git(tree, 'rev-parse', 'HEAD');
    } catch {}
    return { sha, tree, entry: join(tree, ENTRY) };
  }
  const repo = repoDir();
  const sha = resolveSha(sel.sha ?? 'prefix', repo);
  const tree = join(buildsDir(), sha);
  await withDirLock(tree, () => {
    if (!existsSync(join(tree, '.git'))) {
      mkdirSync(dirname(tree), { recursive: true });
      log(`[r10] worktree ${sha.slice(0, 12)} -> ${tree}`);
      git(repo, 'worktree', 'prune');
      git(repo, 'worktree', 'add', '--detach', tree, sha);
    }
    const head = git(tree, 'rev-parse', 'HEAD');
    if (head !== sha) throw new SetupError(`${tree} is at ${head}, expected ${sha}`);
    installAndBuild(tree, sha, log);
  });
  return { sha, tree, entry: join(tree, ENTRY) };
}

/** A replayable case: a fixture or held-out input. */
export interface Case {
  id: string;
  capturedAt: string;
  tool: string;
  args: CaseIO['args'];
  /** Memory JSONL state before the call: a file next to the case, or inline lines. */
  state?: { memoryFile?: string; lines?: unknown[] };
  probe?: { tool: string };
}

export function loadCase(path: string): Case & { file: string } {
  const c = JSON.parse(readFileSync(path, 'utf8')) as Case;
  if (c.tool !== 'create_entities') throw new Error(`${path}: tool ${c.tool} is not create_entities`);
  return { ...c, file: resolve(path) };
}

function writeState(c: Case & { file?: string }, dest: string) {
  if (c.state?.memoryFile) {
    const src = isAbsolute(c.state.memoryFile)
      ? c.state.memoryFile
      : resolve(dirname(c.file ?? BUG_DIR), c.state.memoryFile);
    copyFileSync(src, dest);
  } else if (c.state?.lines) {
    writeFileSync(
      dest,
      c.state.lines.map((l) => JSON.stringify(l)).join('\n') + (c.state.lines.length ? '\n' : ''),
    );
  }
}

export interface CaseRun extends CaseIO {
  stderr: string;
  /** Memory file contents after the call and probe. */
  after: string;
}

/** Runs one case through a fresh server process: create_entities, then the open_nodes probe. */
export async function runCase(build: Build, c: Case & { file?: string }): Promise<CaseRun> {
  const tmp = mkdtempSync(join(tmpdir(), 'fiks-r10-'));
  const mem = join(tmp, 'memory.jsonl');
  writeState(c, mem);
  const at = Date.parse(c.capturedAt);
  if (!Number.isFinite(at)) throw new Error(`${c.id}: no valid capturedAt`);
  const server = await spawnServer(['node', build.entry], {
    MEMORY_FILE_PATH: mem,
    FIKS_REPLAY_NOW_MS: String(at),
    NODE_OPTIONS: `--import ${CLOCK_PRELOAD.href}`,
  });
  try {
    await server.listTools();
    const result = (await server.callTool(
      c.tool,
      c.args as unknown as Record<string, unknown>,
    )) as ToolResultLike;
    const names = [...new Set((c.args.entities ?? []).map((e) => e.name))];
    const probeArgs = { names };
    const probeResult = (await server.callTool(c.probe?.tool ?? 'open_nodes', probeArgs)) as ToolResultLike;
    const after = existsSync(mem) ? readFileSync(mem, 'utf8') : '';
    return {
      args: c.args,
      result,
      probe: { tool: c.probe?.tool ?? 'open_nodes', args: probeArgs, result: probeResult },
      stderr: server.stderr(),
      after,
    };
  } finally {
    await server.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}
