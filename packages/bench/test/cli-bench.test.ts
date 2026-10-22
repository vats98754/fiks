// `fiks bench` end to end with a stub agent: the default-export command module parses its own
// argv, refuses a dirty tree, runs a worker pool, and logs infraError trials. The shop repo is a
// throwaway git repo tagged seed-v1 (the stub agent never starts the MCP server).

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { query } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import benchCommand, { bench, runBenchCommand, type TrialRecord } from '../../cli/src/commands/bench.ts';
import { DirtyTreeError, runAgent, summarizeRun } from '../src/index.ts';
import { tempRepo } from './support/repo.ts';
import { stubShopAgent } from './support/stub-agent.ts';

let root: string;
beforeAll(() => {
  process.env.FIKS_SHOP_DIR = tempRepo('seed-v1');
  root = tempRepo();
});
afterEach(() => vi.restoreAllMocks());

const outDir = () => join(mkdtempSync(join(tmpdir(), 'fiks-bench-out-')), 'run');
const readTrials = (out: string) =>
  readFileSync(join(out, 'trials.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TrialRecord);
const comparable = (rows: TrialRecord[]) =>
  rows.map(({ runId: _r, startedAt: _s, durationMs: _d, worker: _w, ...rest }) => rest);

test('the module is a P18 command: {name, describe, run(argv)}', async () => {
  expect(benchCommand.name).toBe('bench');
  expect(benchCommand.describe).toMatch(/agent trials/);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(await benchCommand.run(['--help'])).toBe(0);
  expect(String(log.mock.calls[0]?.[0])).toMatch(/--workers <n>/);
  expect(await benchCommand.run(['--phase', 'A', '--bogus'])).toBe(2);
  expect(await benchCommand.run(['--k', '2'])).toBe(2);
  expect(await benchCommand.run(['--phase', 'A', '--shop-ref', 'main'])).toBe(2);
  expect(await runBenchCommand(['--phase', 'A', '--workers', '0'], { root, agent: stubShopAgent() })).toBe(1);
  expect(err.mock.calls.flat().join('\n')).toMatch(/--workers must be an integer >= 1/);
});

test('pnpm fiks bench refuses to start on a dirty tree', async () => {
  const dirty = tempRepo();
  writeFileSync(join(dirty, 'uncommitted.ts'), 'export {};\n');
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const out = outDir();
  let agentCalls = 0;
  const code = await runBenchCommand(['--phase', 'A', '--k', '1', '--out', out], {
    root: dirty,
    agent: async (i) => {
      agentCalls++;
      return stubShopAgent()(i);
    },
  });
  expect(code).toBe(2);
  expect(err.mock.calls.flat().join('\n')).toMatch(
    /refusing to start: .* uncommitted changes[\s\S]*uncommitted\.ts/,
  );
  expect(agentCalls).toBe(0);
  expect(existsSync(out)).toBe(false);
  await expect(bench({ phase: 'B', k: 1, root: dirty, agent: stubShopAgent() })).rejects.toThrow(
    DirtyTreeError,
  );
  // The refusal comes before the credential check.
  vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', '');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  await expect(bench({ phase: 'A', k: 1, root: dirty })).rejects.toThrow(DirtyTreeError);
  await expect(bench({ phase: 'A', k: 1, root })).rejects.toThrow(/needs a Claude credential/);
  vi.unstubAllEnvs();
});

test('a 4-worker bench of 6 tasks x k=2 equals the sequential bench (stub agent)', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const seqOut = outDir();
  const parOut = outDir();
  expect(
    await runBenchCommand(['--phase', 'A', '--k', '2', '--out', seqOut], { root, agent: stubShopAgent() }),
  ).toBe(0);
  expect(
    await runBenchCommand(['--phase', 'A', '--k', '2', '--workers', '4', '--out', parOut], {
      root,
      agent: stubShopAgent(),
    }),
  ).toBe(0);
  const seq = readTrials(seqOut);
  const par = readTrials(parOut);
  expect(par).toHaveLength(12);
  expect(new Set(par.map((t) => t.worker)).size).toBeGreaterThan(1);
  expect(comparable(par)).toEqual(comparable(seq));
  expect(par.map((t) => `${t.taskId}#${t.trial}`)).toEqual(
    ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'].flatMap((id) => [`${id}#1`, `${id}#2`]),
  );
  expect(seq.filter((t) => !t.pass).map((t) => `${t.taskId}#${t.trial}`)).toEqual(['T6#2']);
  const meta = JSON.parse(readFileSync(join(parOut, 'meta.json'), 'utf8'));
  expect(meta).toMatchObject({
    phase: 'A_v1',
    domain: 'shop',
    monitor: 'contracts',
    arm: 'none',
    workers: 4,
    fiksDirty: false,
    groupKey: 'A_v1@claude-sonnet-5-5@contracts@none',
    tasks: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'],
  });
  expect(meta.finishedAt).not.toBe('');
  expect(par[0]).toMatchObject({ costUsd: 0.001, usage: { cacheRead: 100, cacheCreate: 20 }, attempts: 1 });
  // Results are never overwritten.
  await expect(bench({ phase: 'A', k: 1, out: parOut, root, agent: stubShopAgent() })).rejects.toThrow(
    /refusing to overwrite/,
  );
});

test('a forced SDK error is logged as outcome infraError and left out of the graded trials', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  // query() whose stream rejects on the first read, as the SDK does when its transport fails.
  const failing = (() => ({
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.reject(new Error('connect ECONNREFUSED api.anthropic.com')),
    }),
  })) as unknown as typeof query;
  const out = outDir();
  const code = await runBenchCommand(
    ['--phase', 'B', '--k', '1', '--tasks', 'T1,T6', '--retries', '1', '--backoff-ms', '0', '--out', out],
    { root, agent: (i) => runAgent(i, { query: failing }) },
  );
  expect(code).toBe(0);
  const rows = readTrials(out);
  expect(rows.map((r) => [r.taskId, r.outcome, r.attempts, r.pass])).toEqual([
    ['T1', 'infraError', 2, false],
    ['T6', 'infraError', 2, false],
  ]);
  expect(rows[0]?.infraError).toBe('sdk: connect ECONNREFUSED api.anthropic.com');
  const meta = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'));
  const s = summarizeRun(meta, rows);
  expect(s.infraErrors).toBe(2);
  expect(s.graded).toBe(0);
  expect(s.outcomes.wrong + s.outcomes.noAnswer).toBe(0);
});
