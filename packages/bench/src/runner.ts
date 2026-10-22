import type { AgentRun, BenchAgent, McpServerSpec, TrialUsage } from './agent.ts';
import { runPool } from './pool.ts';
import type { BenchTask, TrialOutcome } from './tasks.ts';

/** One tool call of a trial as the proxy judged it (empty without a proxy). */
export interface CallSummary {
  tool: string;
  verdict: string;
  propertyIds: string[];
}

/** Which trial (and which try of it) a harness is serving. */
export interface TrialSlot {
  taskId: string;
  trial: number;
  /** 1-based try of this trial (> 1 only after an infrastructure error). */
  attempt: number;
  worker: number;
}

/**
 * Everything one worker needs to run trials of any domain: its own vendor (ground truth), the
 * MCP server command for a trial, and the trial's checked calls. Workers never share a harness,
 * so trials on different workers cannot see each other's vendor state.
 */
export interface BenchHarness {
  /** Ground-truth vendor state, read by the task graders. */
  readonly state: unknown;
  /** Back to the initial vendor state; called before every try of every trial. */
  reset(): void | Promise<void>;
  server(slot: TrialSlot): McpServerSpec;
  calls(slot: TrialSlot): CallSummary[];
  close(): Promise<void>;
}

/** Builds worker `worker`'s harness (0-based). */
export type HarnessFactory = (worker: number) => Promise<BenchHarness>;

/** A vendor as `Domain.createVendor` returns it (`DomainVendor` in `@fiks/interfaces`). */
export interface VendorLike {
  state: unknown;
  reset(): void;
  listen(port?: number): Promise<string>;
  close(): Promise<void>;
}

/**
 * The harness factory for any domain: one fresh vendor per worker, listening on its own port.
 * `server` builds the trial's MCP server command from that vendor's URL (e.g. fiks-proxy in
 * front of the domain's server, with the domain's base-URL env var), and `calls` reads the
 * trial's checked calls (e.g. the proxy's events file).
 */
export function vendorHarnessFactory(opts: {
  createVendor: () => VendorLike;
  server: (vendorUrl: string, slot: TrialSlot) => McpServerSpec;
  calls?: (slot: TrialSlot) => CallSummary[];
}): HarnessFactory {
  return async () => {
    const vendor = opts.createVendor();
    const url = await vendor.listen();
    return {
      get state() {
        return vendor.state;
      },
      reset: () => vendor.reset(),
      server: (slot) => opts.server(url, slot),
      calls: (slot) => opts.calls?.(slot) ?? [],
      close: () => vendor.close(),
    };
  };
}

export interface TrialResult {
  taskId: string;
  drift: string | null;
  trial: number;
  /** False for an infraError (it is excluded from pass rates, never counted as a fail). */
  pass: boolean;
  outcome: TrialOutcome;
  reason: string;
  answer: string | null;
  calls: CallSummary[];
  /** Start of the first try. */
  startedAt: string;
  /** All tries, backoff included. */
  durationMs: number;
  /** Turns of the last try. */
  turns: number;
  /** Summed over every try (retried tries cost tokens too). */
  usage: TrialUsage;
  /** Summed over every try. */
  costUsd: number;
  /** Tries used: 1 + retries after infrastructure errors. */
  attempts: number;
  worker: number;
  error?: string;
  /** The last try's infrastructure error, when every try failed that way. */
  infraError?: string;
  /** The infrastructure error of each failed try, in order. */
  infraAttempts?: string[];
}

export interface RunTrialsOptions {
  tasks: readonly BenchTask[];
  k: number;
  model: string;
  agent: BenchAgent;
  harness: HarnessFactory;
  /** Parallel workers (default 1 = sequential). */
  workers?: number;
  maxTurns?: number;
  systemPrompt?: string;
  serverName?: string;
  /** Retries after an infrastructure error (default 3, PLAN P10). */
  retries?: number;
  /** First backoff; doubles per retry (default 2000 ms). */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called as each trial finishes (completion order, not task order). */
  onTrial?: (result: TrialResult, transcript: string[]) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const addUsage = (a: TrialUsage, b: TrialUsage): TrialUsage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheCreate: a.cacheCreate + b.cacheCreate,
});

/**
 * Runs every task k times over a pool of workers and grades each trial against its worker's
 * vendor. The result is in task order, then trial order, whatever the worker count: with a
 * deterministic agent a 4-worker run equals the sequential run except for timing and worker ids.
 * A try that ends in an infrastructure error is retried (vendor reset first) with exponential
 * backoff; if every try fails that way the trial is `infraError`, not a model failure.
 */
export async function runTrials(opts: RunTrialsOptions): Promise<TrialResult[]> {
  if (!Number.isInteger(opts.k) || opts.k < 1) throw new Error(`k must be an integer >= 1: ${opts.k}`);
  const retries = opts.retries ?? 3;
  const backoff = opts.backoffMs ?? 2000;
  const sleep = opts.sleep ?? defaultSleep;
  const items = opts.tasks.flatMap((task) =>
    Array.from({ length: opts.k }, (_, i) => ({ task, trial: i + 1 })),
  );
  const harnesses = new Map<number, Promise<BenchHarness>>();
  const harnessFor = (worker: number) => {
    let h = harnesses.get(worker);
    if (!h) {
      h = opts.harness(worker);
      harnesses.set(worker, h);
    }
    return h;
  };
  try {
    return await runPool(items, opts.workers ?? 1, async ({ task, trial }, worker) => {
      const harness = await harnessFor(worker);
      const t0 = Date.now();
      let usage: TrialUsage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
      let costUsd = 0;
      const infraAttempts: string[] = [];
      let run: AgentRun | undefined;
      let slot: TrialSlot = { taskId: task.id, trial, attempt: 1, worker };
      for (let attempt = 1; attempt <= retries + 1; attempt++) {
        slot = { taskId: task.id, trial, attempt, worker };
        await harness.reset();
        run = await opts.agent({
          prompt: task.prompt,
          model: opts.model,
          server: harness.server(slot),
          maxTurns: opts.maxTurns,
          systemPrompt: opts.systemPrompt,
          serverName: opts.serverName,
        });
        usage = addUsage(usage, run.usage);
        costUsd += run.costUsd;
        if (!run.infraError) break;
        infraAttempts.push(run.infraError);
        if (attempt <= retries) await sleep(backoff * 2 ** (attempt - 1));
      }
      const r = run as AgentRun;
      const base = {
        taskId: task.id,
        drift: task.drift ?? null,
        trial,
        answer: r.answer,
        calls: harness.calls(slot),
        startedAt: new Date(t0).toISOString(),
        durationMs: Date.now() - t0,
        turns: r.turns,
        usage,
        costUsd,
        attempts: slot.attempt,
        worker,
        ...(r.error ? { error: r.error } : {}),
        ...(infraAttempts.length ? { infraAttempts } : {}),
      };
      let result: TrialResult;
      if (r.infraError) {
        result = {
          ...base,
          pass: false,
          outcome: 'infraError',
          reason: `infrastructure error after ${slot.attempt} tries: ${r.infraError}`,
          infraError: r.infraError,
        };
      } else if (r.answer === null) {
        result = {
          ...base,
          pass: false,
          outcome: 'wrong',
          reason: `no answer submitted${r.error ? ` (${r.error})` : ''}`,
        };
      } else {
        const g = task.grade(r.answer, harness.state);
        result = { ...base, pass: g.pass, outcome: g.outcome as TrialOutcome, reason: g.reason };
      }
      opts.onTrial?.(result, r.transcript);
      return result;
    });
  } finally {
    await Promise.allSettled([...harnesses.values()].map(async (h) => (await h).close()));
  }
}
