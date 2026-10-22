// The coordinator: a pool of worker processes (one OS process each, own FIKS_DIR), block dispatch
// in schedule order, the RSS cap, cap-stop (pause all, discard in-flight blocks, quarantine their
// artifacts, resume after the reset or on the next start), the infra window (> 10% infra in the
// last 50 attempts pauses the run) and status-only output.

import { type ChildProcess, execFileSync, fork } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { killGroup } from './child.ts';
import type { Registry, RegistryState } from './registry.ts';
import type { Block } from './schedule.ts';
import type { Status } from './status.ts';
import type { BlockJobMsg, WorkerMsg } from './worker.ts';

const WORKER = join(dirname(fileURLToPath(import.meta.url)), 'worker.ts');

export interface PoolOptions {
  runId: string;
  runDir: string;
  cwd: string;
  registry: Registry;
  state: RegistryState;
  blocks: Block[];
  workers: number;
  env: Record<string, string>;
  session: number;
  timeoutMs: number;
  maxRequeues: number;
  rssCapMb: number;
  waitOnCap: boolean;
  infraWindow: number;
  infraMaxRate: number;
  emit: (s: Status) => void;
  startedAt: number;
  /** Prepare steps (all done by the time blocks start). */
  stepsTotal: number;
}

export type PoolEnd =
  | { state: 'complete' }
  | { state: 'paused'; reason: 'cap' | 'infra' | 'signal'; resetAt?: string | null }
  | { state: 'error'; message: string };

const slug = (s: string) => s.replace(/[^A-Za-z0-9._+-]+/g, '_');
const now = () => new Date().toISOString();

function inflightFile(runDir: string, block: string): string {
  return join(runDir, 'inflight', `${slug(block)}.json`);
}

/** Moves a discarded block's attempt dirs to quarantine/ and drops its in-flight marker. */
export function discardBlock(o: {
  runDir: string;
  registry: Registry;
  block: Block | { id: string; jobs: { dir: string }[] };
  reason: string;
  session: number;
}): void {
  const q = join('quarantine', `s${o.session}`, slug(o.block.id));
  let moved = false;
  for (const j of o.block.jobs) {
    const src = join(o.runDir, j.dir);
    if (!existsSync(src)) continue;
    const dst = join(o.runDir, q, j.dir);
    mkdirSync(dirname(dst), { recursive: true });
    renameSync(src, dst);
    moved = true;
  }
  rmSync(inflightFile(o.runDir, o.block.id), { force: true });
  o.registry.append({
    t: 'block_discarded',
    at: now(),
    block: o.block.id,
    reason: o.reason,
    quarantine: moved ? q : null,
  });
}

/**
 * Resume hygiene: kill subprocess groups a killed session left behind (pid files), then discard
 * every block that was in flight (marker present) so it is re-run whole.
 */
export function recoverIncomplete(
  runDir: string,
  registry: Registry,
  state: RegistryState,
  session: number,
): number {
  const pidDir = join(runDir, 'pids');
  if (existsSync(pidDir)) {
    for (const f of readdirSync(pidDir)) {
      const pid = Number(f);
      if (Number.isInteger(pid) && pid > 1) {
        let cmd = '';
        try {
          cmd = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
        } catch {
          cmd = '';
        }
        const info = JSON.parse(readFileSync(join(pidDir, f), 'utf8')) as { argv?: string[] };
        // Only a process still running one of this run's commands (pid reuse guard).
        if (cmd && (info.argv ?? []).slice(0, 3).every((a) => cmd.includes(a))) killGroup(pid, 'SIGKILL');
      }
      rmSync(join(pidDir, f), { force: true });
    }
  }
  const dir = join(runDir, 'inflight');
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const f of readdirSync(dir)) {
    const m = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { id: string; jobs: { dir: string }[] };
    if (state.completeBlocks.has(m.id) || state.droppedBlocks.has(m.id)) {
      rmSync(join(dir, f), { force: true });
      continue;
    }
    discardBlock({ runDir, registry, block: m, reason: 'incomplete at resume (killed session)', session });
    n++;
  }
  return n;
}

/** RSS (MB) of each worker's process tree. */
export function treeRssMb(roots: number[]): Map<number, number> {
  const out = new Map<number, number>();
  let table: string;
  try {
    table = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' });
  } catch {
    return out;
  }
  const kids = new Map<number, number[]>();
  const rss = new Map<number, number>();
  for (const line of table.split('\n')) {
    const [pid, ppid, kb] = line.trim().split(/\s+/).map(Number);
    if (!pid || ppid === undefined || kb === undefined) continue;
    rss.set(pid, kb);
    kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
  }
  for (const root of roots) {
    let sum = 0;
    const stack = [root];
    const seen = new Set<number>();
    while (stack.length) {
      const p = stack.pop() as number;
      if (seen.has(p)) continue;
      seen.add(p);
      sum += rss.get(p) ?? 0;
      stack.push(...(kids.get(p) ?? []));
    }
    out.set(root, sum / 1024);
  }
  return out;
}

export async function runPool(o: PoolOptions): Promise<PoolEnd> {
  const pending = o.blocks.filter(
    (b) => !o.state.completeBlocks.has(b.id) && !o.state.droppedBlocks.has(b.id),
  );
  const total = o.blocks.length;
  const attemptsTotal = o.blocks.reduce((s, b) => s + b.jobs.length, 0);
  let done = o.blocks.filter((b) => o.state.completeBlocks.has(b.id)).length;
  let dropped = o.blocks.filter((b) => o.state.droppedBlocks.has(b.id)).length;
  let discarded = 0;
  // Finished arm tries: every try that ended (incl. infra re-queues and tries of discarded blocks).
  let attemptsFinished = o.blocks
    .filter((b) => o.state.completeBlocks.has(b.id))
    .reduce((s, b) => s + b.jobs.length, 0);
  let infraRetries = 0;
  const window: boolean[] = [];
  let lastCheckpoint = Math.floor((done * 10) / Math.max(1, total));
  let rssMb: number | null = null;
  let rssHigh = false;
  let pausing: { reason: 'cap' | 'infra' | 'signal'; resetAt?: string | null } | null = null;
  let errorMsg: string | null = null;
  const byId = new Map(o.blocks.map((b) => [b.id, b]));
  const queue = [...pending];
  mkdirSync(join(o.runDir, 'inflight'), { recursive: true });

  interface W {
    idx: number;
    proc: ChildProcess;
    block: Block | null;
  }
  const workers: W[] = [];
  const status = (state: Status['state'], pauseReason: Status['pauseReason'] = null) =>
    o.emit({
      type: 'status',
      run: o.runId,
      at: now(),
      state,
      pauseReason,
      phase: workers.find((w) => w.block)?.block?.phase ?? queue[0]?.phase ?? null,
      blocksTotal: total,
      blocksDone: done,
      blocksDropped: dropped,
      blocksInFlight: workers.filter((w) => w.block).length,
      blocksDiscarded: discarded,
      attemptsTotal,
      attemptsFinished,
      infraRetries,
      stepsTotal: o.stepsTotal,
      stepsDone: o.stepsTotal,
      workers: workers.length,
      rssMb,
      elapsedMs: Date.now() - o.startedAt,
    });

  let resolveEnd: (e: PoolEnd) => void = () => {};
  const ended = new Promise<PoolEnd>((r) => {
    resolveEnd = r;
  });

  const busy = () => workers.filter((w) => w.block);

  const finishIfIdle = () => {
    if (busy().length > 0) return;
    if (errorMsg) return resolveEnd({ state: 'error', message: errorMsg });
    if (pausing) return resolveEnd({ state: 'paused', ...pausing });
    if (queue.length === 0) return resolveEnd({ state: 'complete' });
  };

  const dispatch = () => {
    if (pausing || errorMsg || rssHigh) return finishIfIdle();
    for (const w of workers) {
      if (w.block || queue.length === 0) continue;
      const b = queue.shift() as Block;
      w.block = b;
      writeFileSync(
        inflightFile(o.runDir, b.id),
        `${JSON.stringify({ id: b.id, jobs: b.jobs.map((j) => ({ dir: j.dir })) })}\n`,
      );
      const msg: BlockJobMsg = {
        type: 'block',
        block: b,
        runDir: o.runDir,
        cwd: o.cwd,
        env: o.env,
        session: o.session,
        timeoutMs: o.timeoutMs,
        maxRequeues: o.maxRequeues,
      };
      w.proc.send(msg);
    }
    status('running');
    finishIfIdle();
  };

  const pauseAll = (reason: 'cap' | 'infra' | 'signal', resetAt: string | null = null) => {
    if (pausing) return;
    pausing = { reason, resetAt };
    for (const w of busy()) w.proc.send({ type: 'abort' });
  };

  const onResult = (w: W, m: Extract<WorkerMsg, { type: 'block_result' }>) => {
    const b = w.block ?? byId.get(m.block);
    w.block = null;
    if (!b) return;
    if (m.status === 'complete') {
      o.registry.append({ t: 'block_complete', at: now(), block: b.id, worker: w.idx, rows: m.rows });
      rmSync(inflightFile(o.runDir, b.id), { force: true });
      done++;
      const cp = Math.floor((done * 10) / total);
      if (cp > lastCheckpoint) {
        lastCheckpoint = cp;
        o.registry.append({ t: 'checkpoint', at: now(), blocksDone: done, blocksTotal: total });
      }
    } else if (m.status === 'dropped') {
      const d = m.dropped ?? { arm: '-', tries: 0, reason: 'unknown' };
      o.registry.append({
        t: 'block_dropped',
        at: now(),
        block: b.id,
        reason: d.reason,
        arm: d.arm,
        tries: d.tries,
      });
      rmSync(inflightFile(o.runDir, b.id), { force: true });
      dropped++;
    } else {
      // cap, aborted or error: the block is incomplete and is discarded whole.
      const reason =
        m.status === 'cap'
          ? 'cap_stop'
          : m.status === 'error'
            ? `worker error: ${m.error}`
            : `paused: ${pausing?.reason ?? 'abort'}`;
      discardBlock({ runDir: o.runDir, registry: o.registry, block: b, reason, session: o.session });
      discarded++;
      queue.unshift(b);
      if (m.status === 'cap') {
        o.registry.append({
          t: 'cap_stop',
          at: now(),
          resetAt: m.cap?.resetAt ?? null,
          message: m.cap?.message ?? '',
        });
        pauseAll('cap', m.cap?.resetAt ?? null);
      }
      if (m.status === 'error' && !errorMsg) {
        errorMsg = `worker ${w.idx}: ${m.error}`;
        for (const x of busy()) x.proc.send({ type: 'abort' });
      }
    }
    dispatch();
  };

  for (let i = 0; i < o.workers; i++) {
    const fiksDir = join(o.runDir, 'workers', `w${i}`);
    mkdirSync(fiksDir, { recursive: true });
    const proc = fork(WORKER, [], {
      env: { ...o.env, FIKS_DIR: fiksDir },
      execArgv: process.execArgv,
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    const w: W = { idx: i, proc, block: null };
    proc.on('message', (raw) => {
      const m = raw as WorkerMsg;
      if (m.type === 'progress') {
        attemptsFinished++;
        if (m.class === 'infra') infraRetries++;
        window.push(m.class === 'infra');
        if (window.length > o.infraWindow) window.shift();
        const infra = window.filter(Boolean).length;
        if (window.length >= o.infraWindow && infra / window.length > o.infraMaxRate && !pausing) {
          o.registry.append({
            t: 'pause',
            at: now(),
            reason: `infra ${infra}/${window.length} in the last ${o.infraWindow} attempts`,
          });
          pauseAll('infra');
        }
        const p = pausing as { reason: 'cap' | 'infra' | 'signal' } | null;
        status(p ? 'paused' : 'running', p ? p.reason : null);
      } else if (m.type === 'block_result') onResult(w, m);
    });
    proc.on('exit', (code) => {
      if (w.block) {
        const b = w.block;
        w.block = null;
        discardBlock({
          runDir: o.runDir,
          registry: o.registry,
          block: b,
          reason: `worker exited (${code})`,
          session: o.session,
        });
        discarded++;
        queue.unshift(b);
        if (!errorMsg) errorMsg = `worker ${w.idx} exited unexpectedly (${code})`;
      }
      const i2 = workers.indexOf(w);
      if (i2 >= 0) workers.splice(i2, 1);
      finishIfIdle();
    });
    workers.push(w);
  }

  const rssLog = join(o.runDir, 'rss.jsonl');
  const sampler = setInterval(() => {
    const m = treeRssMb(workers.map((w) => w.proc.pid as number));
    rssMb = [...m.values()].reduce((s, x) => s + x, 0);
    appendFileSync(
      rssLog,
      `${JSON.stringify({ at: now(), totalMb: Math.round(rssMb), perWorkerMb: Object.fromEntries([...m].map(([k, v]) => [k, Math.round(v)])) })}\n`,
    );
    const high = rssMb > o.rssCapMb;
    if (high !== rssHigh) {
      rssHigh = high;
      status(high ? 'paused' : 'running', high ? 'rss' : null);
      if (!high) dispatch();
    }
  }, 2000);
  sampler.unref();

  const onSignal = () => pauseAll('signal');
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  status('running');
  dispatch();
  let end = await ended;

  // Cap stop with a known reset: wait, then resume in-process (PLAN 8.1 note 1).
  while (end.state === 'paused' && end.reason === 'cap' && o.waitOnCap && end.resetAt) {
    const waitMs = Math.max(0, Date.parse(end.resetAt) - Date.now()) + 60_000;
    status('paused', 'cap');
    await new Promise((r) => setTimeout(r, waitMs));
    pausing = null;
    const again = new Promise<PoolEnd>((r) => {
      resolveEnd = r;
    });
    dispatch();
    end = await again;
  }

  clearInterval(sampler);
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
  for (const w of workers) {
    w.proc.send({ type: 'exit' });
  }
  await Promise.all(
    workers.map((w) => new Promise((r) => (w.proc.exitCode !== null ? r(null) : w.proc.once('exit', r)))),
  );
  status(
    end.state === 'complete' ? 'complete' : end.state === 'paused' ? 'paused' : 'error',
    end.state === 'paused' ? end.reason : null,
  );
  return end;
}
