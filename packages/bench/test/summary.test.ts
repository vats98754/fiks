import { expect, test } from 'vitest';
import {
  buildRunsSummary,
  groupKey,
  monitorOf,
  type RunMeta,
  summarizeRun,
  type TrialRow,
} from '../src/index.ts';

const meta = (over: Partial<RunMeta> = {}): RunMeta => ({
  runId: 'B_v2_1',
  phase: 'B_v2',
  model: 'claude-sonnet-5-5',
  k: 3,
  tasks: ['T1', 'T2'],
  startedAt: '2026-10-21T00:00:00.000Z',
  finishedAt: '2026-10-21T00:01:00.000Z',
  ...over,
});

const row = (taskId: string, trial: number, outcome: string, extra: Partial<TrialRow> = {}): TrialRow => ({
  taskId,
  trial,
  pass: outcome === 'correct',
  outcome,
  answer: outcome === 'infraError' || outcome === 'none' ? null : 'x',
  calls: [{ tool: 't', verdict: outcome === 'declined' ? 'violated' : 'verified', propertyIds: [] }],
  ...extra,
});

test('group keys: phase@model@monitor@arm, with legacy runs mapped to their monitor', () => {
  expect(groupKey(meta())).toBe('B_v2@claude-sonnet-5-5@contracts@none');
  expect(groupKey(meta({ phase: 'B_v2_direct', proxy: false }))).toBe(
    'B_v2_direct@claude-sonnet-5-5@none@none',
  );
  expect(groupKey(meta({ monitor: 'llm-judge', arm: 'COMP', model: 'claude-haiku-5-5' }))).toBe(
    'B_v2@claude-haiku-5-5@llm-judge@COMP',
  );
  expect(monitorOf(meta({ receiptField: false }))).toBe('contracts+no-receipt-field');
});

test('infraError trials leave n and pass^k, and are counted with a Wilson rate', () => {
  const rows = [
    row('T1', 1, 'correct', { costUsd: 0.01, usage: { input: 1, output: 2, cacheRead: 3, cacheCreate: 4 } }),
    row('T1', 2, 'infraError', { costUsd: 0.002 }),
    row('T1', 3, 'correct'),
    row('T2', 1, 'correct'),
    row('T2', 2, 'declined'),
    row('T2', 3, 'none', { outcome: 'wrong' }),
  ];
  const s = summarizeRun(meta(), rows);
  expect(s.complete).toBe(true);
  expect(s.trials).toBe(6);
  expect(s.graded).toBe(5);
  expect(s.infraErrors).toBe(1);
  expect(s.perTask.T1).toEqual({
    n: 2,
    pass: 2,
    correct: 2,
    wrong: 0,
    declined: 0,
    noAnswer: 0,
    infraError: 1,
  });
  expect(s.perTask.T2).toEqual({
    n: 3,
    pass: 1,
    correct: 1,
    wrong: 0,
    declined: 1,
    noAnswer: 1,
    infraError: 0,
  });
  // K = min n = 2; T1 2/2, T2 1/3: pass^1 = (1 + 1/3)/2, pass^2 = (1 + 0)/2.
  expect(s.passHatK).toEqual([0.6667, 0.5]);
  expect(s.passHatKCi).toHaveLength(2);
  expect(s.rates.pass.p).toBe(0.6);
  expect(s.infraRate.p).toBe(0.1667);
  expect(s.outcomes).toEqual({ correct: 3, wrong: 0, declined: 1, noAnswer: 1, infraError: 1 });
  expect(s.violatedCalls).toBe(1);
  expect(s.costUsd).toBe(0.012);
  expect(s.tokens).toEqual({ input: 1, output: 2, cacheRead: 3, cacheCreate: 4 });
  expect(s.wallMs).toBe(60_000);
});

test('a task whose every trial is infraError is dropped from pass^k and listed', () => {
  const rows = [row('T1', 1, 'infraError'), row('T2', 1, 'correct')];
  const s = summarizeRun(meta({ k: 1 }), rows);
  expect(s.droppedTasks).toEqual(['T1']);
  expect(s.passHatK).toEqual([1]);
});

test('every run is kept; incomplete runs are marked, never dropped', () => {
  const full = (id: string, model = 'claude-sonnet-5-5') => ({
    meta: meta({ runId: id, model, k: 1 }),
    rows: [row('T1', 1, 'correct'), row('T2', 1, 'correct')],
  });
  const partial = { meta: meta({ runId: 'B_v2_3', k: 1 }), rows: [row('T1', 1, 'correct')] };
  const unfinished = { meta: meta({ runId: 'B_v2_4', k: 1, finishedAt: '' }), rows: full('x').rows };
  const s = buildRunsSummary([
    full('B_v2_2'),
    full('B_v2_1'),
    partial,
    unfinished,
    full('B_v2_5', 'claude-haiku-5-5'),
  ]);
  expect(Object.keys(s.groups)).toEqual([
    'B_v2@claude-haiku-5-5@contracts@none',
    'B_v2@claude-sonnet-5-5@contracts@none',
  ]);
  const g = s.groups['B_v2@claude-sonnet-5-5@contracts@none'];
  expect(g?.runs.map((r) => [r.runId, r.complete])).toEqual([
    ['B_v2_1', true],
    ['B_v2_2', true],
    ['B_v2_3', false],
    ['B_v2_4', false],
  ]);
  expect(g?.latestComplete).toBe('B_v2_2');
});
