// The collector over the fixture MCP server with stub agents: deterministic rows and hashes,
// per-session vendor reset, worker pool, cap-stop, no overwrite.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  type AgentSpec,
  type CollectOptions,
  collect,
  sha256,
  stubAgent,
  type TrafficAgent,
  type TrafficRow,
  tasksFromDomain,
} from '../src/index.ts';
import { fakeVendors, fixtureServer, tempDir } from './support.ts';

afterEach(() => vi.unstubAllEnvs());

const TASKS = tasksFromDomain({
  id: 'catalog',
  tasks: [
    { id: 'q1', prompt: 'What is item x-101?' },
    { id: 'q2', prompt: 'Order two of x-102 for me.' },
    { id: 'q3', prompt: 'Search for mugs.' },
  ],
});

const stubs = (names = ['opus', 'sonnet', 'haiku', 'ollama']): AgentSpec[] =>
  names.map((name) => ({
    name,
    model: `stub:${name}`,
    route: name === 'ollama' ? 'ollama' : 'stub',
    run: stubAgent(),
  }));

function opts(over: Partial<CollectOptions> = {}): CollectOptions {
  return {
    domain: 'catalog',
    agents: stubs(),
    tasks: TASKS,
    trials: 2,
    createVendor: fakeVendors().create,
    server: fixtureServer,
    serverName: 'catalog',
    system: 'sys',
    maxTurns: 4,
    out: join(tempDir(), 'run'),
    ...over,
  };
}

const readRows = (out: string) =>
  readFileSync(join(out, 'args.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as TrafficRow);

describe('collect', () => {
  test('rows carry agent, model, task id and trial; the args file and its sha256 agree', async () => {
    const r = await collect(opts());
    const rows = readRows(r.out);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toMatchObject({ domain: 'catalog', stratum: 'S-agent' });
      expect(['opus', 'sonnet', 'haiku', 'ollama']).toContain(row.agent);
      expect(row.model).toBe(`stub:${row.agent}`);
      expect(['q1', 'q2', 'q3']).toContain(row.taskId);
      expect([1, 2]).toContain(row.trial);
      expect(row.seq).toBeGreaterThanOrEqual(1);
      expect(row.dedupeKey).toMatch(/^[0-9a-f]{24}$/);
    }
    // Every (agent, task, trial) session ran; rows are in agent, task, trial, seq order.
    expect(r.sessions).toHaveLength(4 * 3 * 2);
    const order = rows.map((x) => [
      ['opus', 'sonnet', 'haiku', 'ollama'].indexOf(x.agent),
      x.taskId,
      x.trial,
      x.seq,
    ]);
    expect(order).toEqual([...order].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    const text = readFileSync(join(r.out, 'args.jsonl'), 'utf8');
    expect(r.argsSha256).toBe(sha256(text));
    expect(readFileSync(join(r.out, 'args.jsonl.sha256'), 'utf8')).toBe(`${r.argsSha256}  args.jsonl\n`);
    const meta = JSON.parse(readFileSync(join(r.out, 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({
      domain: 'catalog',
      stratum: 'S-agent',
      trials: 2,
      argsSha256: r.argsSha256,
      rows: rows.length,
      tasks: { source: 'Domain.tasks', sha256: TASKS.sha256, ids: ['q1', 'q2', 'q3'] },
      tools: { names: ['get_item', 'place_order', 'search'] },
    });
    expect(meta.perAgent.opus.sessions).toBe(6);
    expect(existsSync(join(r.out, 'sessions.jsonl'))).toBe(true);
  });

  test('repeated runs with stub agents give identical hashes, whatever the worker count', async () => {
    const a = await collect(opts({ agents: stubs(['opus', 'ollama']) }));
    const b = await collect(opts({ agents: stubs(['opus', 'ollama']) }));
    const c = await collect(opts({ agents: stubs(['opus', 'ollama']), workers: 3 }));
    expect(b.argsSha256).toBe(a.argsSha256);
    expect(c.argsSha256).toBe(a.argsSha256);
    expect(readFileSync(join(c.out, 'args.jsonl'), 'utf8')).toBe(
      readFileSync(join(a.out, 'args.jsonl'), 'utf8'),
    );
    // A different trial count is different traffic.
    const d = await collect(opts({ agents: stubs(['opus', 'ollama']), trials: 1 }));
    expect(d.argsSha256).not.toBe(a.argsSha256);
  });

  test('works under FIKS_LLM_FORBID=1 (the stub makes no LLM call)', async () => {
    vi.stubEnv('FIKS_LLM_FORBID', '1');
    const r = await collect(opts({ agents: stubs(['opus']), trials: 1 }));
    expect(r.sessions.every((s) => s.outcome === 'ok')).toBe(true);
  });

  test('a fresh vendor state per session: one vendor per worker, reset before every session', async () => {
    const v = fakeVendors();
    const seen: string[] = [];
    const spy: TrafficAgent = async (i) => {
      seen.push(i.server.env.FIXTURE_BASE_URL as string);
      return stubAgent()(i);
    };
    await collect(
      opts({
        createVendor: v.create,
        agents: [{ name: 'opus', model: 'm', route: 'claude', run: spy }],
        workers: 2,
      }),
    );
    expect(v.stats.created).toBe(2);
    expect(v.stats.resets).toBe(6);
    expect(v.stats.closed).toBe(2);
    expect(new Set(seen).size).toBe(2);
  });

  test('ollama sessions never run concurrently', async () => {
    let inFlight = 0;
    let max = 0;
    const slow: TrafficAgent = async (i) => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return { ...(await stubAgent()(i)) };
    };
    await collect(opts({ agents: [{ name: 'ollama', model: 'm', route: 'ollama', run: slow }], workers: 4 }));
    expect(max).toBe(1);
  });

  test('a usage cap stops every later Claude session (skipped_cap), other routes go on', async () => {
    let n = 0;
    const capOnSecond: TrafficAgent = async (i) => {
      n++;
      if (n === 2)
        return {
          calls: [],
          answer: null,
          outcome: 'cap',
          error: 'usage limit',
          turns: 0,
          costUsd: 0,
          tokens: { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 },
          wallMs: 1,
        };
      return stubAgent()(i);
    };
    const r = await collect(
      opts({
        trials: 1,
        agents: [
          { name: 'opus', model: 'a', route: 'claude', run: capOnSecond },
          { name: 'sonnet', model: 'b', route: 'claude', run: capOnSecond },
          { name: 'ollama', model: 'c', route: 'ollama', run: stubAgent() },
        ],
      }),
    );
    expect(r.sessions.map((s) => `${s.agent}/${s.taskId}:${s.outcome}`)).toEqual([
      'opus/q1:ok',
      'opus/q2:cap',
      'opus/q3:skipped_cap',
      'sonnet/q1:skipped_cap',
      'sonnet/q2:skipped_cap',
      'sonnet/q3:skipped_cap',
      'ollama/q1:ok',
      'ollama/q2:ok',
      'ollama/q3:ok',
    ]);
    expect(n).toBe(2);
    expect(
      (r.meta.perAgent as Record<string, { outcomes: Record<string, number> }>).sonnet?.outcomes,
    ).toEqual({
      skipped_cap: 3,
    });
  });

  test('never overwrites a run; validates trials, workers and agent names', async () => {
    const r = await collect(opts({ agents: stubs(['opus']), trials: 1 }));
    await expect(collect(opts({ out: r.out }))).rejects.toThrow(/refusing to overwrite/);
    await expect(collect(opts({ trials: 0 }))).rejects.toThrow(/trials must be an integer >= 1/);
    await expect(collect(opts({ workers: 0 }))).rejects.toThrow(/workers must be an integer >= 1/);
    await expect(collect(opts({ agents: [...stubs(['opus']), ...stubs(['opus'])] }))).rejects.toThrow(
      /duplicate agent/,
    );
  });

  test('skipped agents are listed in meta', async () => {
    const r = await collect(
      opts({
        agents: stubs(['opus']),
        trials: 1,
        skipped: [{ agent: 'ollama', model: null, reason: 'no ollama model is approved' }],
      }),
    );
    expect(r.meta.skipped).toEqual([{ agent: 'ollama', model: null, reason: 'no ollama model is approved' }]);
  });
});
