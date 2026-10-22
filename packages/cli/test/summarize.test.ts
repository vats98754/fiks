import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import summarizeCommand, {
  buildRunsSummaryFromResults,
  buildSummary,
  crossCheck,
  summarize,
} from '../src/commands/summarize.ts';

afterEach(() => {
  delete process.env.FIKS_RESULTS_DIR;
  vi.restoreAllMocks();
});

const TASK_IDS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
type Outcome = 'correct' | 'wrong' | 'declined' | 'none';

function trial(phase: string, taskId: string, n: number, outcome: Outcome, violated = false) {
  return {
    runId: phase,
    phase,
    taskId,
    drift: null,
    trial: n,
    pass: outcome === 'correct',
    outcome: outcome === 'none' ? 'wrong' : outcome,
    reason: '',
    answer: outcome === 'none' ? null : 'x',
    calls: [
      {
        tool: 'get_product',
        verdict: violated ? 'violated' : 'verified',
        propertyIds: violated ? ['shop.get_product/price.notNull'] : [],
      },
    ],
    model: 'm',
    shopMcpSha: 'abc',
    startedAt: '',
    durationMs: 0,
    turns: 1,
    usage: { input: 0, output: 0 },
  };
}

function writeRun(
  dir: string,
  run: string,
  phase: string,
  k: number,
  tasks: string[],
  outcomeFor: (t: string, i: number) => Outcome,
) {
  mkdirSync(join(dir, run));
  writeFileSync(
    join(dir, run, 'meta.json'),
    JSON.stringify({ runId: run, phase, model: 'm', k, shopMcpSha: 'abc', tasks, finishedAt: 'x' }),
  );
  const rows = tasks.flatMap((t) =>
    Array.from({ length: k }, (_, i) =>
      trial(phase, t, i + 1, outcomeFor(t, i), t === 'T1' && phase === 'B_v2'),
    ),
  );
  writeFileSync(join(dir, run, 'trials.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
}

test('summary comes only from full runs, and --check catches a hand edit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fiks-results-'));
  process.env.FIKS_RESULTS_DIR = dir;
  writeRun(dir, 'A_v1_1', 'A_v1', 5, TASK_IDS, () => 'correct');
  // B: T1 fails every trial (3 declined, 2 never answered); everything else passes.
  writeRun(dir, 'B_v2_1', 'B_v2', 5, TASK_IDS, (t, i) =>
    t === 'T1' ? (i < 3 ? 'declined' : 'none') : 'correct',
  );
  const s = buildSummary();
  expect(s.phases.A_v1?.passHatK).toEqual([1, 1, 1, 1, 1]);
  expect(s.phases.B_v2?.passHatK).toEqual([0.8333, 0.8333, 0.8333, 0.8333, 0.8333]);
  expect(s.phases.B_v2?.outcomes).toEqual({ correct: 25, wrong: 0, declined: 3, noAnswer: 2 });
  expect(s.phases.B_v2?.perTask.T1).toEqual({
    n: 5,
    pass: 0,
    correct: 0,
    wrong: 0,
    declined: 3,
    noAnswer: 2,
  });
  expect(s.falsePositivesV1).toBe(0);
  expect(s.drifts.D2.detected).toBe(true);
  expect(s.drifts.D1.detected).toBe(false);

  // Smoke runs never replace a phase: one task at k=1 (what `bench --k 1 --tasks T6` writes),
  // and all tasks at k=1.
  writeRun(dir, 'A_v1_2', 'A_v1', 1, ['T6'], () => 'wrong');
  writeRun(dir, 'A_v1_3', 'A_v1', 1, TASK_IDS, () => 'wrong');
  const s2 = buildSummary();
  expect(s2.phases.A_v1?.runId).toBe('A_v1_1');
  expect(s2.incompleteRuns).toEqual(['A_v1_2', 'A_v1_3']);

  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ ...s2, generatedAt: 'x' }));
  expect(summarize({ check: true }).ok).toBe(true);
  writeFileSync(
    join(dir, 'summary.json'),
    JSON.stringify({
      ...s2,
      phases: { ...s2.phases, B_v2: { ...s2.phases.B_v2, passHatK: [1, 1, 1, 1, 1] } },
    }),
  );
  expect(summarize({ check: true }).ok).toBe(false);
  delete process.env.FIKS_RESULTS_DIR;
});

/** A run as BENCHX's bench writes it: monitor, arm, domain in meta; cost, cache tokens, infraError rows. */
function writeNewRun(
  dir: string,
  run: string,
  meta: Record<string, unknown>,
  outcomeFor: (t: string, i: number) => Outcome | 'infraError',
  k = 5,
) {
  mkdirSync(join(dir, run));
  const phase = String(meta.phase ?? 'B_v2');
  writeFileSync(
    join(dir, run, 'meta.json'),
    JSON.stringify({
      runId: run,
      phase,
      model: 'claude-sonnet-5-5',
      monitor: 'contracts',
      arm: 'none',
      domain: 'shop',
      proxy: true,
      receiptField: true,
      k,
      shopMcpSha: 'abc',
      tasks: TASK_IDS,
      startedAt: '2026-10-21T00:00:00.000Z',
      finishedAt: '2026-10-21T00:02:00.000Z',
      ...meta,
    }),
  );
  const rows = TASK_IDS.flatMap((t) =>
    Array.from({ length: k }, (_, i) => {
      const o = outcomeFor(t, i);
      return {
        ...trial(phase, t, i + 1, o === 'infraError' ? 'none' : o),
        ...(o === 'infraError' ? { outcome: 'infraError', infraError: 'sdk: x', attempts: 4 } : {}),
        costUsd: 0.01,
        usage: { input: 1, output: 2, cacheRead: 30, cacheCreate: 4 },
      };
    }),
  );
  writeFileSync(join(dir, run, 'trials.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
}

test('re-summarizing the committed 2026-10-20 runs reproduces every number in summary.json', () => {
  const r = summarize({ check: true });
  expect(r.diff).toBeUndefined();
  expect(r.ok).toBe(true);
  expect(crossCheck(r.summary, r.runs)).toEqual([]);
  // The legacy view holds the 2026-10-20 runs; the keyed view keeps the 2026-10-18 runs too.
  expect(Object.values(r.summary.phases).map((p) => p.runId)).toEqual([
    'A_v1_20261020T223642',
    'B_v2_20261020T224015',
    'B_v2_direct_20261020T224445',
    'C_v2_fixed_20261020T224903',
  ]);
  const b = r.runs.groups['B_v2@claude-sonnet-5-5@contracts@none'];
  expect(b?.runs.map((x) => x.runId)).toEqual(['B_v2_20261018T093754', 'B_v2_20261020T224015']);
  expect(b?.latestComplete).toBe('B_v2_20261020T224015');
  expect(r.runs.groups['B_v2_direct@claude-sonnet-5-5@none@none']?.runs).toHaveLength(2);
});

test('keyed summary keeps every run; another model or arm never replaces a legacy phase', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fiks-results-'));
  process.env.FIKS_RESULTS_DIR = dir;
  writeRun(dir, 'B_v2_1', 'B_v2', 5, TASK_IDS, () => 'correct');
  writeNewRun(dir, 'B_v2_2', { model: 'claude-haiku-5-5' }, () => 'wrong');
  writeNewRun(dir, 'B_v2_3', { arm: 'COMP' }, () => 'declined');
  writeNewRun(dir, 'B_v2_4', { monitor: 'llm-judge' }, () => 'declined');
  const s = buildSummary();
  expect(s.phases.B_v2?.runId).toBe('B_v2_1');
  const runs = buildRunsSummaryFromResults();
  expect(Object.keys(runs.groups)).toEqual([
    'B_v2@claude-haiku-5-5@contracts@none',
    'B_v2@claude-sonnet-5-5@contracts@COMP',
    'B_v2@claude-sonnet-5-5@llm-judge@none',
    // The pre-BENCHX fixture run (model "m", no monitor field in meta.json).
    'B_v2@m@contracts@none',
  ]);
  expect(crossCheck(s, runs)).toEqual([]);
  // A new default-configuration run is the latest B_v2 in both views.
  writeNewRun(dir, 'B_v2_5', {}, (t, i) => (t === 'T2' && i === 0 ? 'infraError' : 'correct'), 10);
  const s2 = buildSummary();
  expect(s2.phases.B_v2?.runId).toBe('B_v2_5');
  // The infraError trial leaves n: T2 has 9 graded trials, so pass^k runs to K = 9.
  expect(s2.phases.B_v2?.perTask.T2).toEqual({
    n: 9,
    pass: 9,
    correct: 9,
    wrong: 0,
    declined: 0,
    noAnswer: 0,
  });
  expect(s2.phases.B_v2?.passHatK).toHaveLength(9);
  expect(s2.phases.B_v2?.infraErrors).toBe(1);
  expect(s2.phases.B_v2?.trials).toBe(59);
  const r5 = buildRunsSummaryFromResults().groups['B_v2@claude-sonnet-5-5@contracts@none']?.runs.at(-1);
  expect(r5).toMatchObject({ runId: 'B_v2_5', infraErrors: 1, graded: 59, costUsd: 0.6 });
  expect(r5?.tokens).toEqual({ input: 60, output: 120, cacheRead: 1800, cacheCreate: 240 });
  expect(r5?.infraRate.p).toBe(0.0167);
  expect(crossCheck(s2, buildRunsSummaryFromResults())).toEqual([]);
});

test('--check covers summary.runs.json and the cross-check; the command module returns exit codes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fiks-results-'));
  process.env.FIKS_RESULTS_DIR = dir;
  writeRun(dir, 'A_v1_1', 'A_v1', 5, TASK_IDS, () => 'correct');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(summarizeCommand.name).toBe('summarize');
  expect(summarizeCommand.run([])).toBe(0);
  expect(existsSync(join(dir, 'summary.runs.json'))).toBe(true);
  expect(summarizeCommand.run(['--check'])).toBe(0);
  expect(log.mock.calls.at(-1)?.[0]).toBe('summary.json matches the logs');
  // A hand edit of summary.runs.json is caught.
  const runsFile = join(dir, 'summary.runs.json');
  const runs = JSON.parse(readFileSync(runsFile, 'utf8'));
  runs.groups['A_v1@m@contracts@none'].runs[0].passHatK = [0.5];
  writeFileSync(runsFile, JSON.stringify(runs));
  expect(summarizeCommand.run(['--check'])).toBe(1);
  expect(String(log.mock.calls.at(-1)?.[0])).toMatch(/summary\.runs\.json does not match/);
  // The cross-check names a number the keyed view does not reproduce.
  const r = summarize({ check: true });
  const legacy = { ...r.summary, phases: { A_v1: { ...r.summary.phases.A_v1, violatedCalls: 3 } } };
  expect(crossCheck(legacy as typeof r.summary, r.runs)).toEqual([
    'A_v1 (A_v1_1) violatedCalls: summary.json 3 vs keyed 0',
  ]);
  expect(summarizeCommand.run(['--help'])).toBe(0);
  expect(summarizeCommand.run(['--bogus'])).toBe(2);
  // Legacy global flags still parse (ignored, with a note).
  expect(summarizeCommand.run(['--vendor', 'v2', '--json'])).toBe(0);
});
