import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { buildSummary, summarize } from '../src/commands/summarize.ts';

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
