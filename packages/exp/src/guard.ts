// Run-start guards: the build-swarm guard and run.active (PLAN 7.1), the dirty-tree refusal (PLAN 7),
// the confirmatory.lock gate (R10, R11) and the containment preflight (P1, round 6).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

export class GuardError extends Error {
  override name = 'GuardError';
  constructor(
    message: string,
    readonly exitCode = 2,
  ) {
    super(message);
  }
}

export function fiksHome(): string {
  return join(homedir(), '.fiks');
}

/** `pnpm exp` refuses any run while the orchestrator's build-swarm marker exists; --dry is exempt. */
export function checkBuildSwarm(dry: boolean, home = fiksHome()): void {
  const marker = join(home, 'build-swarm.active');
  if (!dry && existsSync(marker)) {
    throw new GuardError(
      `refused: ${marker} exists (a builder swarm is active, PLAN 7.1). Live runs never overlap the build phase; only --dry (stub agents, FIKS_LLM_FORBID=1) may run now.`,
    );
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Holds $HOME/.fiks/run.active for a live run (LLMR's live-lock refuses while it exists). A marker
 * left by a dead process on this host is reported and replaced; a live one refuses the start.
 */
export function acquireRunActive(run: string, home = fiksHome()): () => void {
  const file = join(home, 'run.active');
  mkdirSync(home, { recursive: true });
  if (existsSync(file)) {
    let h: { pid?: number; host?: string; run?: string } = {};
    try {
      h = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      // unreadable marker: treat as held
    }
    const stale = h.host === hostname() && typeof h.pid === 'number' && !pidAlive(h.pid);
    if (!stale) throw new GuardError(`refused: ${file} is held by run ${h.run ?? '?'} (pid ${h.pid ?? '?'})`);
    process.stderr.write(`[exp] replacing stale run.active of dead pid ${h.pid} (run ${h.run ?? '?'})\n`);
  }
  const me = { pid: process.pid, host: hostname(), run, startedAt: new Date().toISOString() };
  writeFileSync(file, `${JSON.stringify(me)}\n`);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      const cur = JSON.parse(readFileSync(file, 'utf8')) as { pid?: number };
      if (cur.pid === process.pid) rmSync(file, { force: true });
    } catch {
      // already gone
    }
  };
}

const git = (repo: string, args: string[]) =>
  spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Paths a run step itself writes; they never make the tree dirty for the runner. */
export const RUN_OUTPUT_EXCLUDES = ['paper/results/raw'];

/** PLAN 7: runners refuse a dirty tree. Returns the frozen commit (HEAD). */
export function checkCleanTree(repo: string): string {
  const head = git(repo, ['rev-parse', 'HEAD']);
  if (head.status !== 0) throw new GuardError(`not a git checkout: ${repo} (${head.stderr.trim()})`);
  const st = git(repo, [
    'status',
    '--porcelain',
    '--untracked-files=normal',
    '--',
    '.',
    ...RUN_OUTPUT_EXCLUDES.map((p) => `:(exclude)${p}`),
  ]);
  if (st.status !== 0) throw new GuardError(`git status failed in ${repo}: ${st.stderr.trim()}`);
  const dirty = st.stdout.split('\n').filter((l) => l.trim() !== '');
  if (dirty.length > 0) {
    throw new GuardError(
      `refused: the tree at ${repo} is dirty (${dirty.length} path(s), e.g. ${dirty.slice(0, 3).join('; ')}). Runs record a frozen commit; commit or stash first.`,
    );
  }
  return head.stdout.trim();
}

export function checkConfirmatoryLock(repo: string, run: string): string {
  const lock = join(repo, 'paper', 'results', 'confirmatory.lock');
  if (!existsSync(lock)) {
    throw new GuardError(
      `refused: ${run} runs only after CP2 and needs ${lock} (PLAN 8.1); it does not exist yet`,
    );
  }
  return lock;
}

export interface PreflightResult {
  command: string[];
  exitCode: number | null;
  passed: boolean;
  fiksCommit: string;
  imageDigests: Record<string, string> | null;
  imageDigestError: string | null;
  at: string;
  durationMs: number;
  overridden: boolean;
  logPath: string;
}

export const PREFLIGHT_TEST = 'packages/cli/test/orch/rerecord-containment.test.ts';

/** Local fiks images (sandbox, tools) and their ids, for meta.json. Never fails the run. */
export function imageDigests(): { digests: Record<string, string> | null; error: string | null } {
  const r = spawnSync(
    'docker',
    [
      'image',
      'ls',
      '--no-trunc',
      '--filter',
      'label=fiks.sandbox.kind',
      '--format',
      '{{.Repository}}:{{.Tag}} {{.ID}}',
    ],
    { encoding: 'utf8', timeout: 15_000 },
  );
  if (r.error || r.status !== 0) return { digests: null, error: (r.error?.message ?? r.stderr ?? '').trim() };
  const out: Record<string, string> = {};
  for (const line of r.stdout.split('\n')) {
    const [name, id] = line.trim().split(' ');
    if (name && id) out[name] = id;
  }
  return { digests: out, error: null };
}

/**
 * Runs ORCH's containment test before R1 and R3-R8. `override` (a JSON argv) is honoured only
 * under --dry, for the runner's own tests; it is recorded as such in meta.json.
 */
export function runPreflight(o: {
  repo: string;
  fiksCommit: string;
  override: string[] | null;
  logPath: string;
}): PreflightResult {
  const command = o.override ?? ['pnpm', 'vitest', 'run', PREFLIGHT_TEST];
  const t0 = Date.now();
  const r = spawnSync(command[0] as string, command.slice(1), {
    cwd: o.repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30 * 60_000,
  });
  writeFileSync(o.logPath, `${r.stdout ?? ''}\n${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`);
  const img = o.override
    ? { digests: null, error: 'not queried: preflight command overridden (--dry runner test)' }
    : imageDigests();
  return {
    command,
    exitCode: r.status,
    passed: r.status === 0,
    fiksCommit: o.fiksCommit,
    imageDigests: img.digests,
    imageDigestError: img.error,
    at: new Date().toISOString(),
    durationMs: Date.now() - t0,
    overridden: o.override !== null,
    logPath: o.logPath,
  };
}
