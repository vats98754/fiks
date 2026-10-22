// The A1 runner (PLAN 8.1 A1, note 1): ordered jobs at concurrency c (from T0's throughput.json),
// with cap-stop and a ceiling.
// - A usage-cap answer pauses everything: no new job starts, every in-flight job is discarded when
//   it settles (its artifacts quarantined) and re-queued in its original order; after the reset
//   the run resumes and discarded jobs restart from scratch.
// - The ceiling ($ and sessions, counting discarded sessions too) stops the run; jobs not started
//   are reported as not run.
// Results are keyed by job index, so the keep rule (idea-index order) does not depend on timing.
import { readFileSync } from 'node:fs';
import { recommendConcurrency, ThroughputSchema } from '@fiks/llm';

export type JobOutcome<R> =
  | { kind: 'ok'; value: R; costUsd: number; sessions: number }
  | { kind: 'cap'; resetAt?: string; costUsd: number; sessions: number }
  | { kind: 'error'; error: string; costUsd: number; sessions: number };

export interface JobContext {
  /** Attempt number of this job (1 + times it was discarded). */
  attempt: number;
  /** Generation of the run (increments at every resume after a cap). */
  generation: number;
}

export interface RunnerOptions<J, R> {
  jobs: J[];
  concurrency: number;
  run(job: J, index: number, ctx: JobContext): Promise<JobOutcome<R>>;
  /** Moves a discarded attempt's artifacts aside (called once per discarded attempt). */
  quarantine?(job: J, index: number, ctx: JobContext, reason: string): Promise<void> | void;
  ceiling?: { usd?: number; sessions?: number };
  /** Wait after a cap when the reset time is unknown (default 5 h, the cap window). */
  defaultResetWaitMs?: number;
  /** Extra margin after the reset instant (default 60 s). */
  resetMarginMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (e: RunnerEvent) => void;
}

export type RunnerEvent =
  | { type: 'start'; index: number; attempt: number; generation: number }
  | { type: 'done'; index: number; kind: JobOutcome<unknown>['kind']; attempt: number }
  | { type: 'cap'; index: number; resetAt: string | null; inFlight: number[] }
  | { type: 'discard'; index: number; attempt: number }
  | { type: 'resume'; generation: number; waitedMs: number }
  | { type: 'ceiling'; by: 'usd' | 'sessions'; spentUsd: number; sessions: number };

export interface RunnerReport<R> {
  results: (JobOutcome<R> | undefined)[];
  notRun: number[];
  stoppedBy: 'usd' | 'sessions' | null;
  capEvents: { index: number; resetAt: string | null }[];
  discarded: { index: number; attempt: number }[];
  spentUsd: number;
  sessions: number;
}

/** Concurrency from T0's throughput.json (the recommended c), or `fallback`. */
export function concurrencyFromThroughput(file: string, fallback = 1): number {
  const t = ThroughputSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  return t.recommendedConcurrency ?? recommendConcurrency(t.authoring.levels) ?? fallback;
}

export async function runJobs<J, R>(o: RunnerOptions<J, R>): Promise<RunnerReport<R>> {
  if (!Number.isInteger(o.concurrency) || o.concurrency < 1) throw new Error('concurrency must be >= 1');
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => {});
  const results: (JobOutcome<R> | undefined)[] = new Array(o.jobs.length).fill(undefined);
  const attempts = new Array<number>(o.jobs.length).fill(0);
  let queue = o.jobs.map((_, i) => i);
  const inFlight = new Map<number, Promise<void>>();
  let generation = 0;
  let paused: { resetAt: string | null } | null = null;
  let stoppedBy: RunnerReport<R>['stoppedBy'] = null;
  let spentUsd = 0;
  let sessions = 0;
  const capEvents: RunnerReport<R>['capEvents'] = [];
  const discarded: RunnerReport<R>['discarded'] = [];

  const overCeiling = (): 'usd' | 'sessions' | null => {
    if (o.ceiling?.usd !== undefined && spentUsd >= o.ceiling.usd) return 'usd';
    if (o.ceiling?.sessions !== undefined && sessions >= o.ceiling.sessions) return 'sessions';
    return null;
  };

  const requeue = (i: number) => {
    queue = [...queue, i].sort((a, b) => a - b);
  };

  const launch = (i: number) => {
    attempts[i] = (attempts[i] ?? 0) + 1;
    const ctx: JobContext = { attempt: attempts[i] as number, generation };
    const gen = generation;
    log({ type: 'start', index: i, attempt: ctx.attempt, generation: gen });
    const p = (async () => {
      let out: JobOutcome<R>;
      try {
        out = await o.run(o.jobs[i] as J, i, ctx);
      } catch (e) {
        out = { kind: 'error', error: (e as Error).message, costUsd: 0, sessions: 0 };
      }
      spentUsd += out.costUsd;
      sessions += out.sessions;
      if (out.kind === 'cap') {
        capEvents.push({ index: i, resetAt: out.resetAt ?? null });
        log({
          type: 'cap',
          index: i,
          resetAt: out.resetAt ?? null,
          inFlight: [...inFlight.keys()].filter((k) => k !== i),
        });
        if (!paused) paused = { resetAt: out.resetAt ?? null };
        else if (out.resetAt && (!paused.resetAt || out.resetAt > paused.resetAt))
          paused.resetAt = out.resetAt;
        await o.quarantine?.(o.jobs[i] as J, i, ctx, 'cap');
        discarded.push({ index: i, attempt: ctx.attempt });
        requeue(i);
      } else if (paused || gen !== generation) {
        // Finished while the run was paused by another job's cap: discarded, restarted later.
        log({ type: 'discard', index: i, attempt: ctx.attempt });
        await o.quarantine?.(o.jobs[i] as J, i, ctx, 'in-flight at a cap');
        discarded.push({ index: i, attempt: ctx.attempt });
        requeue(i);
      } else {
        results[i] = out;
        log({ type: 'done', index: i, kind: out.kind, attempt: ctx.attempt });
      }
    })();
    inFlight.set(
      i,
      p.finally(() => inFlight.delete(i)),
    );
  };

  for (;;) {
    if (paused) {
      // Pause: wait for every in-flight job to settle (they are all discarded), then for the reset.
      while (inFlight.size) await Promise.race(inFlight.values());
      const resetAt = (paused as { resetAt: string | null }).resetAt;
      const waitMs = resetAt
        ? Math.max(0, Date.parse(resetAt) - now()) + (o.resetMarginMs ?? 60_000)
        : (o.defaultResetWaitMs ?? 5 * 3600_000);
      await sleep(waitMs);
      paused = null;
      generation++;
      log({ type: 'resume', generation, waitedMs: waitMs });
      continue;
    }
    if (!stoppedBy) {
      const by = overCeiling();
      if (by) {
        stoppedBy = by;
        log({ type: 'ceiling', by, spentUsd, sessions });
      }
    }
    while (!stoppedBy && !paused && queue.length && inFlight.size < o.concurrency) {
      const by = overCeiling();
      if (by) {
        stoppedBy = by;
        log({ type: 'ceiling', by, spentUsd, sessions });
        break;
      }
      launch(queue.shift() as number);
    }
    if (inFlight.size === 0) {
      if (paused) continue;
      break;
    }
    await Promise.race(inFlight.values());
  }
  const notRun = o.jobs.map((_, i) => i).filter((i) => results[i] === undefined);
  return { results, notRun, stoppedBy, capEvents, discarded, spentUsd, sessions };
}
