// Run-level bench summary for any domain: one entry per run, grouped by
// `${phase}@${model}@${monitor}@${arm}`. Every run is kept (none replaces another); each carries
// pass^1..K (unbiased), Wilson intervals, outcome counts, infrastructure errors, cost and tokens.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CallSummary } from './runner.ts';
import { type Interval, passHatKWithCi, round4, wilson } from './stats.ts';

/** The fields of a run's meta.json the summary reads (older runs lack the optional ones). */
export interface RunMeta {
  runId: string;
  phase: string;
  model: string;
  k: number;
  tasks: string[];
  startedAt?: string;
  finishedAt: string;
  domain?: string;
  /** Monitor the proxy ran; absent in runs before BENCHX (then derived from `proxy`). */
  monitor?: string;
  /** The repair arm whose code the run exercised; absent = `none`. */
  arm?: string;
  /** False = the agent talked to the server directly (no fiks-proxy). */
  proxy?: boolean;
  receiptField?: boolean;
  workers?: number;
  fiksSha?: string;
  fiksDirty?: boolean;
  shopMcpSha?: string;
}

/** The fields of a trials.jsonl row the summary reads. */
export interface TrialRow {
  taskId: string;
  trial: number;
  pass: boolean;
  outcome: string;
  answer: string | null;
  calls: CallSummary[];
  durationMs?: number;
  costUsd?: number;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheCreate?: number };
}

export interface TaskCounts {
  /** Graded trials (infrastructure errors excluded). */
  n: number;
  pass: number;
  correct: number;
  wrong: number;
  declined: number;
  noAnswer: number;
  infraError: number;
}

export interface RunStats {
  runId: string;
  phase: string;
  model: string;
  monitor: string;
  arm: string;
  domain: string;
  k: number;
  tasks: string[];
  /** Finished, and every task x trial cell present exactly once. */
  complete: boolean;
  fiksSha: string | null;
  fiksDirty: boolean | null;
  targetSha: string | null;
  trials: number;
  graded: number;
  infraErrors: number;
  /** Tasks with no graded trial (every trial an infrastructure error): left out of pass^k. */
  droppedTasks: string[];
  /** pass^1..pass^K, K = the smallest graded trial count of a task. */
  passHatK: number[];
  /** Task-level Wilson 95% interval per pass^k (descriptive). */
  passHatKCi: [number, number][];
  /** Trial-level rates over graded trials, Wilson 95%. */
  rates: { pass: Interval; correct: Interval; wrong: Interval; declined: Interval; noAnswer: Interval };
  /** Infrastructure errors over all trials, Wilson 95%. */
  infraRate: Interval;
  outcomes: Omit<TaskCounts, 'n' | 'pass'>;
  perTask: Record<string, TaskCounts>;
  violatedCalls: number;
  /** Sum of SDK cost estimates; null when the run logged none (runs before BENCHX). */
  costUsd: number | null;
  tokens: { input: number; output: number; cacheRead: number | null; cacheCreate: number | null };
  /** finishedAt - startedAt; null when either is missing. */
  wallMs: number | null;
}

export interface RunGroup {
  phase: string;
  model: string;
  monitor: string;
  arm: string;
  /** Every run with this key, oldest first. */
  runs: RunStats[];
  /** The newest complete run, if any. */
  latestComplete: string | null;
}

export interface RunsSummary {
  generatedAt: string;
  groups: Record<string, RunGroup>;
}

/** The monitor label of a run: `none` without the proxy; `+no-receipt-field` when that was off. */
export function monitorOf(meta: RunMeta): string {
  const base = meta.monitor ?? (meta.proxy === false ? 'none' : 'contracts');
  return meta.proxy !== false && meta.receiptField === false ? `${base}+no-receipt-field` : base;
}

export const armOf = (meta: RunMeta) => meta.arm ?? 'none';

/** `${phase}@${model}@${monitor}@${arm}`. */
export function groupKey(meta: RunMeta): string {
  return `${meta.phase}@${meta.model}@${monitorOf(meta)}@${armOf(meta)}`;
}

const r4 = (i: Interval): Interval => ({ p: round4(i.p), lo: round4(i.lo), hi: round4(i.hi) });

/** Stats of one run, from its meta and rows only. */
export function summarizeRun(meta: RunMeta, rows: TrialRow[]): RunStats {
  const perTask: Record<string, TaskCounts> = {};
  for (const id of meta.tasks)
    perTask[id] = { n: 0, pass: 0, correct: 0, wrong: 0, declined: 0, noAnswer: 0, infraError: 0 };
  for (const t of rows) {
    perTask[t.taskId] ??= { n: 0, pass: 0, correct: 0, wrong: 0, declined: 0, noAnswer: 0, infraError: 0 };
    const s = perTask[t.taskId] as TaskCounts;
    if (t.outcome === 'infraError') {
      s.infraError++;
      continue;
    }
    s.n++;
    if (t.pass) s.pass++;
    if (t.answer === null) s.noAnswer++;
    else if (t.outcome === 'correct' || t.outcome === 'wrong' || t.outcome === 'declined') s[t.outcome]++;
  }
  const counts = Object.values(perTask);
  const total = (f: keyof TaskCounts) => counts.reduce((n, s) => n + s[f], 0);
  const graded = total('n');
  const infra = total('infraError');
  const cells = new Set(rows.map((t) => `${t.taskId}#${t.trial}`));
  const complete =
    Boolean(meta.finishedAt) &&
    rows.length === meta.tasks.length * meta.k &&
    cells.size === rows.length &&
    meta.tasks.every((id) =>
      Array.from({ length: meta.k }, (_, i) => cells.has(`${id}#${i + 1}`)).every(Boolean),
    );
  const kept = Object.entries(perTask).filter(([, s]) => s.n > 0);
  const curve = passHatKWithCi(kept.map(([, s]) => ({ n: s.n, c: s.pass })));
  const withCost = rows.filter((t) => typeof t.costUsd === 'number');
  const withCache = rows.filter((t) => typeof t.usage?.cacheRead === 'number');
  const sum = (xs: TrialRow[], f: (t: TrialRow) => number) => xs.reduce((n, t) => n + f(t), 0);
  const started = meta.startedAt ? Date.parse(meta.startedAt) : Number.NaN;
  const finished = meta.finishedAt ? Date.parse(meta.finishedAt) : Number.NaN;
  return {
    runId: meta.runId,
    phase: meta.phase,
    model: meta.model,
    monitor: monitorOf(meta),
    arm: armOf(meta),
    domain: meta.domain ?? 'shop',
    k: meta.k,
    tasks: meta.tasks,
    complete,
    fiksSha: meta.fiksSha ?? null,
    fiksDirty: meta.fiksDirty ?? null,
    targetSha: meta.shopMcpSha ?? null,
    trials: rows.length,
    graded,
    infraErrors: infra,
    droppedTasks: Object.entries(perTask)
      .filter(([, s]) => s.n === 0)
      .map(([id]) => id),
    passHatK: curve.map((c) => round4(c.p)),
    passHatKCi: curve.map((c) => [round4(c.lo), round4(c.hi)]),
    rates: {
      pass: r4(wilson(total('pass'), graded)),
      correct: r4(wilson(total('correct'), graded)),
      wrong: r4(wilson(total('wrong'), graded)),
      declined: r4(wilson(total('declined'), graded)),
      noAnswer: r4(wilson(total('noAnswer'), graded)),
    },
    infraRate: r4(wilson(infra, rows.length)),
    outcomes: {
      correct: total('correct'),
      wrong: total('wrong'),
      declined: total('declined'),
      noAnswer: total('noAnswer'),
      infraError: infra,
    },
    perTask,
    violatedCalls: rows.reduce((n, t) => n + t.calls.filter((c) => c.verdict === 'violated').length, 0),
    costUsd: withCost.length ? round4(sum(withCost, (t) => t.costUsd ?? 0)) : null,
    tokens: {
      input: sum(rows, (t) => t.usage?.input ?? 0),
      output: sum(rows, (t) => t.usage?.output ?? 0),
      cacheRead: withCache.length ? sum(withCache, (t) => t.usage?.cacheRead ?? 0) : null,
      cacheCreate: withCache.length ? sum(withCache, (t) => t.usage?.cacheCreate ?? 0) : null,
    },
    wallMs: Number.isFinite(started) && Number.isFinite(finished) ? finished - started : null,
  };
}

export function readJsonl<T>(file: string): T[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

export interface RunDir {
  dir: string;
  meta: RunMeta;
  rows: TrialRow[];
}

/** Every `<resultsDir>/<run>/` with a meta.json and a trials.jsonl, sorted by folder name. */
export function readRunDirs(resultsDir: string): RunDir[] {
  if (!existsSync(resultsDir)) return [];
  return readdirSync(resultsDir)
    .filter(
      (d) => existsSync(join(resultsDir, d, 'meta.json')) && existsSync(join(resultsDir, d, 'trials.jsonl')),
    )
    .sort()
    .map((d) => ({
      dir: join(resultsDir, d),
      meta: JSON.parse(readFileSync(join(resultsDir, d, 'meta.json'), 'utf8')) as RunMeta,
      rows: readJsonl<TrialRow>(join(resultsDir, d, 'trials.jsonl')),
    }));
}

/** Groups every run by `groupKey`; nothing is dropped or replaced. */
export function buildRunsSummary(runs: { meta: RunMeta; rows: TrialRow[] }[]): RunsSummary {
  const groups: Record<string, RunGroup> = {};
  const stats = runs.map((r) => ({ key: groupKey(r.meta), s: summarizeRun(r.meta, r.rows) }));
  for (const { key, s } of stats.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    groups[key] ??= {
      phase: s.phase,
      model: s.model,
      monitor: s.monitor,
      arm: s.arm,
      runs: [],
      latestComplete: null,
    };
    (groups[key] as RunGroup).runs.push(s);
  }
  for (const g of Object.values(groups)) {
    g.runs.sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));
    g.latestComplete = g.runs.filter((r) => r.complete).at(-1)?.runId ?? null;
  }
  return { generatedAt: new Date().toISOString(), groups };
}
