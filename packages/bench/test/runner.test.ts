import { createVendor } from '@fiks/vendor-api';
import { beforeEach, expect, test } from 'vitest';
import {
  type AgentRun,
  type BenchAgent,
  runPool,
  runTrials,
  TASKS,
  type TrialResult,
  vendorHarnessFactory,
} from '../src/index.ts';
import { resetStubStats, stubShopAgent, stubStats } from './support/stub-agent.ts';

const NOW = () => new Date('2026-10-18T12:00:00Z');

/** One vendor per worker; the "server" is never started (the stub agent calls the vendor). */
function harness(created: number[] = []) {
  return vendorHarnessFactory({
    createVendor: () => {
      created.push(1);
      return createVendor({ version: 'v1', now: NOW });
    },
    server: (url, slot) => ({
      command: 'unused',
      args: [],
      env: { VENDOR_BASE_URL: url, STUB_TRIAL: String(slot.trial) },
    }),
  });
}

/** Everything but timing and worker ids. */
const comparable = (rs: TrialResult[]) =>
  rs.map(({ startedAt: _s, durationMs: _d, worker: _w, ...rest }) => rest);

beforeEach(() => resetStubStats());

test('a 4-worker run of 6 tasks x k=2 equals the sequential run (deterministic stub agent)', async () => {
  const seqVendors: number[] = [];
  const sequential = await runTrials({
    tasks: TASKS,
    k: 2,
    model: 'stub',
    agent: stubShopAgent(),
    harness: harness(seqVendors),
    workers: 1,
  });
  expect(stubStats.maxInFlight).toBe(1);
  resetStubStats();
  const parVendors: number[] = [];
  const completion: string[] = [];
  const parallel = await runTrials({
    tasks: TASKS,
    k: 2,
    model: 'stub',
    agent: stubShopAgent(),
    harness: harness(parVendors),
    workers: 4,
    onTrial: (r) => completion.push(`${r.taskId}#${r.trial}`),
  });
  expect(stubStats.maxInFlight).toBeGreaterThan(1);
  expect(seqVendors).toHaveLength(1);
  expect(parVendors).toHaveLength(4);
  expect(new Set(parallel.map((r) => r.worker)).size).toBe(4);

  expect(parallel).toHaveLength(12);
  expect(comparable(parallel)).toEqual(comparable(sequential));
  // Results come back in task, then trial order even though workers finished out of order.
  expect(parallel.map((r) => `${r.taskId}#${r.trial}`)).toEqual(
    TASKS.flatMap((t) => [`${t.id}#1`, `${t.id}#2`]),
  );
  // The stub declines T6 trial 2 only; everything else is graded correct against its own vendor.
  expect(sequential.filter((r) => !r.pass).map((r) => `${r.taskId}#${r.trial}:${r.outcome}`)).toEqual([
    'T6#2:declined',
  ]);
  // T3 orders were placed on separate vendors, each reset before the trial: same id everywhere.
  expect(parallel.filter((r) => r.taskId === 'T3').map((r) => r.answer)).toEqual([
    'Order o-5002 placed.',
    'Order o-5002 placed.',
  ]);
  expect(sequential[0]?.costUsd).toBe(0.001);
  expect(sequential[0]?.usage).toEqual({ input: 10, output: 5, cacheRead: 100, cacheCreate: 20 });
});

const infraRun = (infraError: string): AgentRun => ({
  answer: null,
  toolCalls: [],
  turns: 0,
  costUsd: 0.01,
  usage: { input: 1, output: 0, cacheRead: 0, cacheCreate: 0 },
  transcript: [],
  error: infraError,
  infraError,
});

test('infrastructure errors are retried with exponential backoff, then recorded as infraError', async () => {
  const sleeps: number[] = [];
  let calls = 0;
  const agent: BenchAgent = async () => {
    calls++;
    return infraRun('sdk: socket hang up');
  };
  const [r] = await runTrials({
    tasks: TASKS.slice(0, 1),
    k: 1,
    model: 'stub',
    agent,
    harness: harness(),
    backoffMs: 100,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  expect(calls).toBe(4);
  expect(sleeps).toEqual([100, 200, 400]);
  expect(r?.outcome).toBe('infraError');
  expect(r?.pass).toBe(false);
  expect(r?.attempts).toBe(4);
  expect(r?.infraAttempts).toHaveLength(4);
  expect(r?.costUsd).toBeCloseTo(0.04);
  expect(r?.reason).toMatch(/^infrastructure error after 4 tries: sdk: socket hang up/);
});

test('a retry that succeeds is graded normally, on a reset vendor', async () => {
  let calls = 0;
  const good = stubShopAgent();
  const agent: BenchAgent = async (input) => {
    calls++;
    if (calls === 1) {
      // A half-finished first try mutates the vendor; the retry must not see it.
      await fetch(new URL('/orders', input.server.env.VENDOR_BASE_URL), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'x' },
        body: JSON.stringify({ items: [{ product_id: 'p-1004', quantity: 2 }] }),
      });
      return infraRun('api error 529: overloaded');
    }
    return good(input);
  };
  const t3 = TASKS.filter((t) => t.id === 'T3');
  const [r] = await runTrials({ tasks: t3, k: 1, model: 'stub', agent, harness: harness(), backoffMs: 0 });
  expect(r?.attempts).toBe(2);
  expect(r?.outcome).toBe('correct');
  expect(r?.answer).toBe('Order o-5002 placed.');
  expect(r?.infraAttempts).toEqual(['api error 529: overloaded']);
  expect(r?.infraError).toBeUndefined();
});

test('no answer without an infrastructure cause is a model failure, not infraError', async () => {
  const agent: BenchAgent = async () => ({
    answer: null,
    toolCalls: [],
    turns: 12,
    costUsd: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    transcript: [],
    error: 'error_max_turns',
  });
  const [r] = await runTrials({ tasks: TASKS.slice(0, 1), k: 1, model: 'm', agent, harness: harness() });
  expect(r?.outcome).toBe('wrong');
  expect(r?.attempts).toBe(1);
  expect(r?.reason).toBe('no answer submitted (error_max_turns)');
});

test('runPool keeps item order, caps concurrency and rethrows the first failure', async () => {
  let inFlight = 0;
  let max = 0;
  const out = await runPool([5, 1, 4, 2, 3, 0], 3, async (x) => {
    inFlight++;
    max = Math.max(max, inFlight);
    await new Promise((r) => setTimeout(r, x * 3));
    inFlight--;
    return x * 10;
  });
  expect(out).toEqual([50, 10, 40, 20, 30, 0]);
  expect(max).toBe(3);
  const started: number[] = [];
  await expect(
    runPool([1, 2, 3, 4], 1, async (x) => {
      started.push(x);
      if (x === 2) throw new Error('boom');
      return x;
    }),
  ).rejects.toThrow('boom');
  expect(started).toEqual([1, 2]);
  await expect(runPool([1], 0, async (x) => x)).rejects.toThrow(/workers/);
});
