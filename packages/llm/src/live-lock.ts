// live-lock: a machine-wide mutex for live-LLM acceptance items (PLAN 7.1). Builders, verifiers
// and runs share one OAuth token, so [LIVE] items run one at a time across all streams.
//
//   pnpm tsx packages/llm/src/live-lock.ts --run [--label <s>] [--timeout-min <n>] -- <cmd> [args...]
//   pnpm tsx packages/llm/src/live-lock.ts --status
//   pnpm tsx packages/llm/src/live-lock.ts --break      (removes a lock only if it is stale; logged)
//
// The lock is the directory $HOME/.fiks/live.lock (mkdir is atomic) holding holder.json. A second
// --run waits for it. A lock older than its recorded timeout, or whose holder process is gone, is
// stale: it is reported (exit 3) and never broken silently. --run refuses while
// $HOME/.fiks/run.active exists (a run step owns the token). Every run is logged to
// $HOME/.fiks/live-lock.log with holder, command, wait and duration.

import { spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LockHolder {
  pid: number;
  host: string;
  label: string;
  cmd: string[];
  cwd: string;
  startedAt: string;
  timeoutMs: number;
}

export interface LockPaths {
  root: string;
  lockDir: string;
  holderFile: string;
  logFile: string;
  runActive: string;
}

export function lockPaths(root = join(homedir(), '.fiks')): LockPaths {
  const lockDir = join(root, 'live.lock');
  return {
    root,
    lockDir,
    holderFile: join(lockDir, 'holder.json'),
    logFile: join(root, 'live-lock.log'),
    runActive: join(root, 'run.active'),
  };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readHolder(p: LockPaths): LockHolder | null {
  try {
    return JSON.parse(readFileSync(p.holderFile, 'utf8')) as LockHolder;
  } catch {
    return null;
  }
}

export type Staleness = { stale: false } | { stale: true; reason: string };

/**
 * Added to the command timeout when recording the lock's timeout: the holder kills its command at
 * the command timeout (SIGKILL 10 s later) and releases, so a lock older than its recorded timeout
 * means the holder itself died.
 */
export const RELEASE_MARGIN_MS = 30_000;

export function staleness(h: LockHolder | null, now = Date.now(), lockDirMtimeMs?: number): Staleness {
  if (!h) {
    // holder.json is written right after mkdir; give a fresh lock a moment before calling it broken.
    if (lockDirMtimeMs !== undefined && now - lockDirMtimeMs < 10_000) return { stale: false };
    return { stale: true, reason: 'lock directory has no readable holder.json' };
  }
  const age = now - Date.parse(h.startedAt);
  if (age > h.timeoutMs) {
    return {
      stale: true,
      reason: `held ${Math.round(age / 1000)} s by pid ${h.pid} (${h.label}), longer than its recorded timeout of ${Math.round(h.timeoutMs / 1000)} s`,
    };
  }
  if (h.host === hostname() && !pidAlive(h.pid)) {
    return { stale: true, reason: `holder pid ${h.pid} (${h.label}) on this host is no longer running` };
  }
  return { stale: false };
}

export type AcquireResult =
  | { acquired: true; holder: LockHolder; release: () => void }
  | { acquired: false; holder: LockHolder | null; staleness: Staleness };

/** One non-blocking attempt. Never removes an existing lock. */
export function tryAcquire(p: LockPaths, h: Omit<LockHolder, 'startedAt'>, now = Date.now()): AcquireResult {
  mkdirSync(p.root, { recursive: true });
  try {
    mkdirSync(p.lockDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    const holder = readHolder(p);
    let mtime: number | undefined;
    try {
      mtime = statSync(p.lockDir).mtimeMs;
    } catch {
      mtime = undefined;
    }
    return { acquired: false, holder, staleness: staleness(holder, now, mtime) };
  }
  const holder: LockHolder = { ...h, startedAt: new Date(now).toISOString() };
  writeFileSync(p.holderFile, `${JSON.stringify(holder, null, 2)}\n`);
  let released = false;
  return {
    acquired: true,
    holder,
    release: () => {
      if (released) return;
      released = true;
      const cur = readHolder(p);
      if (cur && cur.pid === holder.pid && cur.startedAt === holder.startedAt) {
        rmSync(p.lockDir, { recursive: true, force: true });
      }
    },
  };
}

export function appendLog(p: LockPaths, entry: Record<string, unknown>): void {
  mkdirSync(p.root, { recursive: true });
  appendFileSync(p.logFile, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

export interface RunOptions {
  cmd: string[];
  label?: string;
  timeoutMs?: number;
  pollMs?: number;
  paths?: LockPaths;
  log?: (line: string) => void;
}

/** Exit codes: the command's own; 2 run.active; 3 stale lock reported; 124 timeout. */
export async function runWithLiveLock(o: RunOptions): Promise<number> {
  const p = o.paths ?? lockPaths();
  const log = o.log ?? ((l: string) => process.stderr.write(`[live-lock] ${l}\n`));
  const timeoutMs = o.timeoutMs ?? 120 * 60_000;
  const label = o.label ?? o.cmd.join(' ').slice(0, 120);
  if (o.cmd.length === 0) {
    log('no command given (usage: live-lock.ts --run -- <cmd> [args...])');
    return 2;
  }
  const waitStart = Date.now();
  let announced = false;
  let acq: AcquireResult;
  for (;;) {
    if (existsSync(p.runActive)) {
      log(`refused: ${p.runActive} exists (a run step holds the OAuth token); live items wait for it to end`);
      return 2;
    }
    acq = tryAcquire(p, {
      pid: process.pid,
      host: hostname(),
      label,
      cmd: o.cmd,
      cwd: process.cwd(),
      timeoutMs: timeoutMs + RELEASE_MARGIN_MS,
    });
    if (acq.acquired) break;
    if (acq.staleness.stale) {
      log(`STALE lock at ${p.lockDir}: ${acq.staleness.reason}`);
      log(`holder: ${JSON.stringify(acq.holder)}`);
      log('not breaking it; inspect, then run live-lock.ts --break to remove a stale lock');
      appendLog(p, {
        event: 'stale_reported',
        holder: acq.holder,
        reason: acq.staleness.reason,
        waiter: label,
      });
      return 3;
    }
    if (!announced) {
      const h = acq.holder;
      log(`waiting: held by pid ${h?.pid ?? '?'} (${h?.label ?? '?'}) since ${h?.startedAt ?? '?'}`);
      announced = true;
    }
    await new Promise((r) => setTimeout(r, o.pollMs ?? 2000));
  }
  const waitedMs = Date.now() - waitStart;
  const holder = acq.holder;
  log(`acquired by pid ${holder.pid} (${label}) after waiting ${waitedMs} ms`);
  appendLog(p, { event: 'acquired', holder, waitedMs });
  const t0 = Date.now();
  const child = spawn(o.cmd[0] as string, o.cmd.slice(1), { stdio: 'inherit' });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    log(`timeout after ${timeoutMs} ms: terminating the command`);
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
  }, timeoutMs);
  const forward = (sig: NodeJS.Signals) => () => child.kill(sig);
  const onInt = forward('SIGINT');
  const onTerm = forward('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  const code = await new Promise<number>((resolve) => {
    child.on('error', (e) => {
      log(`could not start ${o.cmd[0]}: ${e.message}`);
      resolve(127);
    });
    child.on('exit', (c, sig) => resolve(c ?? (sig ? 128 : 1)));
  });
  clearTimeout(timer);
  process.off('SIGINT', onInt);
  process.off('SIGTERM', onTerm);
  const durationMs = Date.now() - t0;
  acq.release();
  const exit = timedOut ? 124 : code;
  appendLog(p, { event: 'released', holder, waitedMs, durationMs, exitCode: exit, timedOut });
  log(`released after ${durationMs} ms (exit ${exit})`);
  return exit;
}

/** Removes the lock only when it is stale; logged. */
export function breakStale(
  p: LockPaths = lockPaths(),
  log = (l: string) => process.stderr.write(`[live-lock] ${l}\n`),
) {
  if (!existsSync(p.lockDir)) {
    log('no lock held');
    return 0;
  }
  const h = readHolder(p);
  const s = staleness(h);
  if (!s.stale) {
    log(`not stale (held by pid ${h?.pid} ${h?.label} since ${h?.startedAt}); refusing to break`);
    return 1;
  }
  rmSync(p.lockDir, { recursive: true, force: true });
  appendLog(p, { event: 'broken', holder: h, reason: s.reason });
  log(`broke stale lock: ${s.reason}`);
  return 0;
}

export function parseArgs(argv: string[]): {
  mode: 'run' | 'status' | 'break' | 'help';
  cmd: string[];
  label?: string;
  timeoutMs?: number;
  pollMs?: number;
} {
  const sep = argv.indexOf('--');
  const flags = sep >= 0 ? argv.slice(0, sep) : argv;
  const cmd = sep >= 0 ? argv.slice(sep + 1) : [];
  let mode: 'run' | 'status' | 'break' | 'help' = 'help';
  let label: string | undefined;
  let timeoutMs: number | undefined;
  let pollMs: number | undefined;
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if (f === '--run') mode = 'run';
    else if (f === '--status') mode = 'status';
    else if (f === '--break') mode = 'break';
    else if (f === '--label') label = flags[++i];
    else if (f === '--timeout-min') timeoutMs = Number(flags[++i]) * 60_000;
    else if (f === '--poll-ms') pollMs = Number(flags[++i]);
    else throw new Error(`unknown flag ${f}`);
  }
  return {
    mode,
    cmd,
    ...(label ? { label } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(pollMs ? { pollMs } : {}),
  };
}

async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  const p = lockPaths();
  if (a.mode === 'run') {
    return runWithLiveLock({
      cmd: a.cmd,
      paths: p,
      ...(a.label ? { label: a.label } : {}),
      ...(a.timeoutMs ? { timeoutMs: a.timeoutMs } : {}),
      ...(a.pollMs ? { pollMs: a.pollMs } : {}),
    });
  }
  if (a.mode === 'status') {
    const h = existsSync(p.lockDir) ? readHolder(p) : null;
    if (!existsSync(p.lockDir)) console.log('free');
    else console.log(JSON.stringify({ holder: h, ...staleness(h) }, null, 2));
    if (existsSync(p.runActive)) console.log(`run.active present: ${p.runActive}`);
    return 0;
  }
  if (a.mode === 'break') return breakStale(p);
  console.log(
    'usage: live-lock.ts --run [--label s] [--timeout-min n] -- <cmd> [args...] | --status | --break',
  );
  return 2;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && realpathSync(process.argv[1]) === self) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`[live-lock] ${(e as Error).message}`);
      process.exit(2);
    },
  );
}
