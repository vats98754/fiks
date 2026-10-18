import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { passHatK, TASKS } from '@fiks/bench';

/** A phase run counts only if it covers every task with at least this many trials each. */
export const FULL_K = 5;

import { type LoopEvent, readEvents } from '@fiks/repro';
import { FIKS_DIR, ROOT } from '../paths.ts';
import type { TrialRecord } from './bench.ts';
import type { RepairResult } from './repair.ts';
import { SCENARIOS } from './scenario.ts';

/** Committed evidence. Tests point FIKS_RESULTS_DIR at a temp folder. */
const resultsDir = () => process.env.FIKS_RESULTS_DIR ?? join(ROOT, 'bench/results');
const loopDir = () => join(resultsDir(), 'loop');
const DRIFTS = ['D1', 'D2', 'D3', 'D4', 'D5'] as const;

export interface DriftStatus {
  detected: boolean;
  reproValid: boolean;
  prGreen: boolean;
  prUrl: string | null;
  minutesDriftToPr: number | null;
  merged: boolean;
  confirmed: boolean;
  repairAttempts: number | null;
  repairTurns: number | null;
}

export interface PhaseSummary {
  runId: string;
  model: string;
  shopMcpSha: string;
  tasks: number;
  k: number;
  trials: number;
  passHatK: number[];
  /** wrong = a submitted answer that is wrong; noAnswer = the agent never called submit_answer. */
  outcomes: { correct: number; wrong: number; declined: number; noAnswer: number };
  perTask: Record<
    string,
    { n: number; pass: number; correct: number; wrong: number; declined: number; noAnswer: number }
  >;
  violatedCalls: number;
}

export interface Summary {
  generatedAt: string;
  phases: Record<string, PhaseSummary>;
  drifts: Record<(typeof DRIFTS)[number], DriftStatus>;
  falsePositivesV1: number | null;
  /** Runs left out because they were not complete (smoke runs, aborted runs). */
  incompleteRuns: string[];
  sources: string[];
}

/**
 * Copies the loop evidence (events, repair results, PR bodies) for every repair that opened a PR
 * from the scratch folder into bench/results/loop, so the summary only depends on committed logs.
 */
export function exportLoop(): string[] {
  const dir = join(FIKS_DIR, 'repairs');
  if (!existsSync(dir)) return [];
  const LOOP = loopDir();
  mkdirSync(LOOP, { recursive: true });
  const repairs = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as RepairResult)
    .filter((r) => r.status === 'pr_opened');
  const traceIds = new Set(repairs.map((r) => r.traceId));
  const events = readEvents(join(FIKS_DIR, 'events.jsonl')).filter(
    (e) => e.traceId && traceIds.has(e.traceId),
  );
  writeFileSync(
    join(LOOP, 'events.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''),
  );
  mkdirSync(join(LOOP, 'repairs'), { recursive: true });
  for (const r of repairs) {
    copyFileSync(join(dir, `${r.traceId}.json`), join(LOOP, 'repairs', `${r.traceId}.json`));
    const body = join(dir, `${r.traceId}.pr.md`);
    if (existsSync(body)) copyFileSync(body, join(LOOP, 'repairs', `${r.traceId}.pr.md`));
  }
  return [...traceIds];
}

function readJsonl<T>(file: string): T[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

/** Pure: derives the summary from bench/results only. */
export function buildSummary(): Summary {
  const RESULTS = resultsDir();
  const LOOP = loopDir();
  const sources: string[] = [];
  const phases: Record<string, PhaseSummary> = {};
  const incomplete: string[] = [];
  const runs = existsSync(RESULTS)
    ? readdirSync(RESULTS)
        .filter((d) => existsSync(join(RESULTS, d, 'meta.json')))
        .sort()
    : [];
  for (const run of runs) {
    const meta = JSON.parse(readFileSync(join(RESULTS, run, 'meta.json'), 'utf8')) as {
      runId: string;
      phase: string;
      model: string;
      k: number;
      shopMcpSha: string;
      tasks: string[];
      finishedAt: string;
    };
    const file = join(RESULTS, run, 'trials.jsonl');
    if (!existsSync(file)) continue;
    // Only complete runs count: every task, k trials each, and the run finished. A smoke run or
    // an aborted run never replaces a phase.
    const rows = readJsonl<TrialRecord>(file);
    const allTasks = TASKS.every((t) => meta.tasks.includes(t.id));
    const unique = new Set(rows.map((t) => `${t.taskId}#${t.trial}`)).size;
    const expected = meta.tasks.length * meta.k;
    if (!meta.finishedAt || !allTasks || meta.k < FULL_K || rows.length !== expected || unique !== expected) {
      incomplete.push(run);
      continue;
    }
    sources.push(relative(ROOT, join(RESULTS, run, 'meta.json')), relative(ROOT, file));
    const trials = rows;
    const perTask: PhaseSummary['perTask'] = {};
    for (const t of trials) {
      if (!perTask[t.taskId])
        perTask[t.taskId] = { n: 0, pass: 0, correct: 0, wrong: 0, declined: 0, noAnswer: 0 };
      const s = perTask[t.taskId] as PhaseSummary['perTask'][string];
      s.n++;
      if (t.pass) s.pass++;
      if (t.answer === null) s.noAnswer++;
      else s[t.outcome]++;
    }
    const tasks = Object.values(perTask).map((s) => ({ n: s.n, c: s.pass }));
    // The latest complete run per phase label wins (run ids sort by time).
    phases[meta.phase] = {
      runId: meta.runId,
      model: meta.model,
      shopMcpSha: meta.shopMcpSha,
      tasks: tasks.length,
      k: meta.k,
      trials: trials.length,
      passHatK: [1, 2, 3, 4, 5].filter((k) => k <= meta.k).map((k) => Number(passHatK(tasks, k).toFixed(4))),
      outcomes: {
        correct: trials.filter((t) => t.outcome === 'correct').length,
        wrong: trials.filter((t) => t.outcome === 'wrong' && t.answer !== null).length,
        declined: trials.filter((t) => t.outcome === 'declined').length,
        noAnswer: trials.filter((t) => t.answer === null).length,
      },
      perTask,
      violatedCalls: trials.reduce((n, t) => n + t.calls.filter((c) => c.verdict === 'violated').length, 0),
    };
  }

  const eventsFile = join(LOOP, 'events.jsonl');
  const events: LoopEvent[] = existsSync(eventsFile) ? readJsonl<LoopEvent>(eventsFile) : [];
  if (existsSync(eventsFile)) sources.push(relative(ROOT, eventsFile));
  const repairDir = join(LOOP, 'repairs');
  const repairs: RepairResult[] = existsSync(repairDir)
    ? readdirSync(repairDir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => {
          sources.push(relative(ROOT, join(repairDir, f)));
          return JSON.parse(readFileSync(join(repairDir, f), 'utf8')) as RepairResult;
        })
    : [];

  const drifts = {} as Summary['drifts'];
  for (const d of DRIFTS) {
    const target = new Set(SCENARIOS[d]?.target ?? []);
    const r = repairs
      .filter((x) => x.scenario === d)
      .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt))
      .at(-1);
    const ev = (type: string) => events.filter((e) => e.traceId === r?.traceId && e.type === type);
    const firstViolation = ev('violation')[0];
    const prOpened = ev('pr_opened')[0];
    const detectedInPhaseB = (() => {
      const b = phases.B_v2?.runId;
      if (!b) return false;
      return readJsonl<TrialRecord>(join(RESULTS, b, 'trials.jsonl')).some((t) =>
        t.calls.some((c) => c.propertyIds.some((p) => target.has(p))),
      );
    })();
    drifts[d] = {
      detected: Boolean(firstViolation) || detectedInPhaseB,
      reproValid: Boolean(ev('gate_F').some((e) => e.ok) && ev('gate_local').some((e) => e.ok)),
      prGreen: Boolean(prOpened && ev('gate_ci').some((e) => e.ok)),
      prUrl: (prOpened?.data?.url as string | undefined) ?? null,
      minutesDriftToPr:
        firstViolation && prOpened
          ? Number(((Date.parse(prOpened.ts) - Date.parse(firstViolation.ts)) / 60_000).toFixed(1))
          : null,
      merged: ev('pr_merged').length > 0,
      confirmed: ev('confirmed').some((e) => e.ok),
      repairAttempts: r?.attempts ?? null,
      repairTurns: r?.turns ?? null,
    };
  }
  const a = phases.A_v1;
  return {
    generatedAt: new Date().toISOString(),
    phases,
    drifts,
    falsePositivesV1: a ? a.violatedCalls : null,
    incompleteRuns: incomplete,
    sources: [...new Set(sources)],
  };
}

export function summarize(opts: { check?: boolean } = {}): {
  summary: Summary;
  file: string;
  ok: boolean;
  diff?: string;
} {
  const RESULTS = resultsDir();
  const file = join(RESULTS, 'summary.json');
  if (!opts.check) exportLoop();
  const summary = buildSummary();
  if (opts.check) {
    const onDisk = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Summary) : null;
    const strip = (s: Summary | null) => (s ? JSON.stringify({ ...s, generatedAt: '' }) : 'missing');
    const ok = strip(onDisk) === strip(summary);
    return {
      summary,
      file,
      ok,
      diff: ok ? undefined : 'bench/results/summary.json does not match a rebuild from bench/results/**',
    };
  }
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
  return { summary, file, ok: true };
}
