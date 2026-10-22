import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import {
  buildRunsSummary,
  monitorOf,
  passHatKCurve,
  type RunMeta,
  type RunStats,
  type RunsSummary,
  readRunDirs,
  TASKS,
} from '@fiks/bench';
import type { CliCommandModule } from '@fiks/interfaces';

/** A phase run counts only if it covers every task with at least this many trials each. */
export const FULL_K = 5;

/**
 * summary.json is the legacy shop view: the latest complete run per phase label, among older runs
 * and new runs in the default configuration (this model; see `isLegacyView`). Every run is in
 * summary.runs.json, keyed by `${phase}@${model}@${monitor}@${arm}`.
 */
export const LEGACY_MODEL = 'claude-sonnet-5-5';

import { type LoopEvent, readEvents } from '@fiks/repro';
import { FIKS_DIR, ROOT } from '../paths.ts';
import { LEGACY_GLOBAL_OPTIONS, noteIgnored, type TrialRecord } from './bench.ts';
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
  /** Trials lost to infrastructure errors (excluded above); present only when > 0. */
  infraErrors?: number;
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

/**
 * Runs that belong in the legacy summary.json. Runs from before BENCHX (no `monitor` in meta.json)
 * all do, exactly as before. A newer run does only in the default configuration: shop domain,
 * the proxy's own monitor or no proxy, no arm, and LEGACY_MODEL, so another model, monitor or
 * arm can never replace a phase here (all of them are in summary.runs.json).
 */
function isLegacyView(meta: RunMeta): boolean {
  if (meta.monitor === undefined) return true;
  return (
    (meta.domain ?? 'shop') === 'shop' &&
    meta.model === LEGACY_MODEL &&
    ['contracts', 'none'].includes(monitorOf(meta)) &&
    (meta.arm ?? 'none') === 'none'
  );
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
    const meta = JSON.parse(readFileSync(join(RESULTS, run, 'meta.json'), 'utf8')) as RunMeta & {
      shopMcpSha: string;
    };
    const file = join(RESULTS, run, 'trials.jsonl');
    if (!existsSync(file)) continue;
    if (!isLegacyView(meta)) continue;
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
    // Infrastructure errors are never graded as model failures (PLAN 9.3): they leave n.
    const trials = rows.filter((t) => t.outcome !== 'infraError');
    const infraErrors = rows.length - trials.length;
    const perTask: PhaseSummary['perTask'] = {};
    for (const t of trials) {
      if (!perTask[t.taskId])
        perTask[t.taskId] = { n: 0, pass: 0, correct: 0, wrong: 0, declined: 0, noAnswer: 0 };
      const s = perTask[t.taskId] as PhaseSummary['perTask'][string];
      s.n++;
      if (t.pass) s.pass++;
      if (t.answer === null) s.noAnswer++;
      else s[t.outcome as 'correct' | 'wrong' | 'declined']++;
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
      // Unbiased pass^1..K, K = the smallest per-task count (= k when no trial was lost).
      passHatK: passHatKCurve(tasks).map((x) => Number(x.toFixed(4))),
      outcomes: {
        correct: trials.filter((t) => t.outcome === 'correct').length,
        wrong: trials.filter((t) => t.outcome === 'wrong' && t.answer !== null).length,
        declined: trials.filter((t) => t.outcome === 'declined').length,
        noAnswer: trials.filter((t) => t.answer === null).length,
      },
      perTask,
      violatedCalls: trials.reduce((n, t) => n + t.calls.filter((c) => c.verdict === 'violated').length, 0),
      ...(infraErrors ? { infraErrors } : {}),
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

/** Every run in the results folder, keyed by `${phase}@${model}@${monitor}@${arm}`. */
export function buildRunsSummaryFromResults(): RunsSummary {
  return buildRunsSummary(readRunDirs(resultsDir()));
}

/**
 * The keyed summary must reproduce every number of the legacy view: for each phase in
 * summary.json, the same run's stats in the keyed summary. Returns the mismatches.
 */
export function crossCheck(legacy: Summary, keyed: RunsSummary): string[] {
  const byRun = new Map<string, RunStats>();
  for (const g of Object.values(keyed.groups)) for (const r of g.runs) byRun.set(r.runId, r);
  const out: string[] = [];
  for (const [phase, p] of Object.entries(legacy.phases)) {
    const r = byRun.get(p.runId);
    if (!r) {
      out.push(`${phase}: run ${p.runId} is missing from the keyed summary`);
      continue;
    }
    const same = (what: string, a: unknown, b: unknown) => {
      if (JSON.stringify(a) !== JSON.stringify(b))
        out.push(
          `${phase} (${p.runId}) ${what}: summary.json ${JSON.stringify(a)} vs keyed ${JSON.stringify(b)}`,
        );
    };
    same('model', p.model, r.model);
    same('shopMcpSha', p.shopMcpSha, r.targetSha);
    same('k', p.k, r.k);
    same('trials', p.trials, r.graded);
    same('tasks', p.tasks, r.tasks.length - r.droppedTasks.length);
    same('passHatK', p.passHatK, r.passHatK);
    same('outcomes', p.outcomes, {
      correct: r.outcomes.correct,
      wrong: r.outcomes.wrong,
      declined: r.outcomes.declined,
      noAnswer: r.outcomes.noAnswer,
    });
    same(
      'perTask',
      p.perTask,
      Object.fromEntries(
        Object.entries(r.perTask)
          .filter(([, t]) => t.n > 0)
          .map(([id, t]) => [
            id,
            {
              n: t.n,
              pass: t.pass,
              correct: t.correct,
              wrong: t.wrong,
              declined: t.declined,
              noAnswer: t.noAnswer,
            },
          ]),
      ),
    );
    same('violatedCalls', p.violatedCalls, r.violatedCalls);
    same('infraErrors', p.infraErrors ?? 0, r.infraErrors);
  }
  return out;
}

const stripGenerated = <T extends { generatedAt: string }>(s: T | null) =>
  s ? JSON.stringify({ ...s, generatedAt: '' }) : 'missing';

export function summarize(opts: { check?: boolean } = {}): {
  summary: Summary;
  runs: RunsSummary;
  file: string;
  runsFile: string;
  ok: boolean;
  diff?: string;
} {
  const RESULTS = resultsDir();
  const file = join(RESULTS, 'summary.json');
  const runsFile = join(RESULTS, 'summary.runs.json');
  if (!opts.check) exportLoop();
  const summary = buildSummary();
  const runs = buildRunsSummaryFromResults();
  if (opts.check) {
    const onDisk = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Summary) : null;
    const problems: string[] = [];
    if (stripGenerated(onDisk) !== stripGenerated(summary))
      problems.push('bench/results/summary.json does not match a rebuild from bench/results/**');
    problems.push(...crossCheck(summary, runs));
    // summary.runs.json is checked once a run step has committed one (older results have none).
    if (existsSync(runsFile)) {
      const runsOnDisk = JSON.parse(readFileSync(runsFile, 'utf8')) as RunsSummary;
      if (stripGenerated(runsOnDisk) !== stripGenerated(runs))
        problems.push('bench/results/summary.runs.json does not match a rebuild from bench/results/**');
    }
    const ok = problems.length === 0;
    return { summary, runs, file, runsFile, ok, diff: ok ? undefined : problems.join('\n') };
  }
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(runsFile, `${JSON.stringify(runs, null, 2)}\n`);
  return { summary, runs, file, runsFile, ok: true };
}

const DESCRIBE = 'bench/results/summary.json from logs only (--check: rebuild and compare)';

const HELP = `usage: fiks summarize [--check] [--json]

  ${DESCRIBE}

  Writes summary.json (legacy view: one run per phase label, default model/monitor/arm) and
  summary.runs.json (every run, keyed by \${phase}@\${model}@\${monitor}@\${arm}, with pass^1..K,
  Wilson intervals, infraError counts, cost and tokens). Results folder: $FIKS_RESULTS_DIR or bench/results.

  --check   rebuild both and compare with the files on disk (summary.runs.json only if present),
            and check that the keyed summary reproduces every number of summary.json; exit 1 on any difference
  --json    print JSON`;

/** `fiks summarize`, parsing its own argv (P18). Returns the exit code. */
export function runSummarizeCommand(argv: string[]): number {
  let values: ReturnType<typeof parse>;
  function parse() {
    return parseArgs({
      args: argv,
      options: { ...LEGACY_GLOBAL_OPTIONS, help: { type: 'boolean', short: 'h', default: false } },
      allowPositionals: false,
    }).values;
  }
  try {
    values = parse();
  } catch (e) {
    console.error(`${e instanceof Error ? e.message : String(e)}\n\n${HELP}`);
    return 2;
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  noteIgnored('summarize', argv, ['json', 'check']);
  const r = summarize({ check: values.check });
  const data = values.check ? { ok: r.ok, diff: r.diff } : r.summary;
  console.log(
    values.json
      ? JSON.stringify(data, null, 2)
      : values.check
        ? r.ok
          ? 'summary.json matches the logs'
          : (r.diff ?? 'mismatch')
        : `wrote ${r.file}`,
  );
  return r.ok ? 0 : 1;
}

const command: CliCommandModule = {
  name: 'summarize',
  describe: DESCRIBE,
  run: (argv) => runSummarizeCommand(argv),
};
export default command;
