// runAgent with the SDK's query() replaced: which failures are infrastructure, and what is logged.
import type { query } from '@anthropic-ai/claude-agent-sdk';
import { createVendor } from '@fiks/vendor-api';
import { expect, test } from 'vitest';
import { runAgent, runTrials, TASKS, usageFromResult, vendorHarnessFactory } from '../src/index.ts';

type Query = typeof query;
/** A fake query() that yields the given messages (or throws). */
const fake = (msgs: unknown[] | Error): Query =>
  (() =>
    (async function* () {
      if (msgs instanceof Error) throw msgs;
      for (const m of msgs) yield m;
    })()) as unknown as Query;

const input = { prompt: 'p', model: 'm', server: { command: 'x', args: [], env: {} } };
const result = (over: Record<string, unknown>) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 3,
  result: 'done',
  total_cost_usd: 0.0123,
  usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 11, cache_creation_input_tokens: 13 },
  modelUsage: {},
  ...over,
});

test('a forced SDK error yields outcome infraError (through runTrials, after 3 retries)', async () => {
  let calls = 0;
  const throwing = fake(new Error('Claude Code process exited with code 1'));
  const [r] = await runTrials({
    tasks: TASKS.slice(0, 1),
    k: 1,
    model: 'm',
    agent: (i) => {
      calls++;
      return runAgent(i, { query: throwing });
    },
    harness: vendorHarnessFactory({
      createVendor: () => createVendor({ version: 'v1' }),
      server: () => input.server,
    }),
    backoffMs: 0,
  });
  expect(calls).toBe(4);
  expect(r?.outcome).toBe('infraError');
  expect(r?.pass).toBe(false);
  expect(r?.infraError).toBe('sdk: Claude Code process exited with code 1');
});

test('API error results (429, overload) are infrastructure', async () => {
  const r429 = await runAgent(input, {
    query: fake([
      { type: 'assistant', error: 'rate_limit', message: { content: [] } },
      result({ is_error: true, api_error_status: 429, result: 'API Error: 429 rate limited' }),
    ]),
  });
  expect(r429.answer).toBeNull();
  expect(r429.infraError).toBe('api error 429: API Error: 429 rate limited');
  const exec = await runAgent(input, {
    query: fake([result({ subtype: 'error_during_execution', errors: ['spawn ENOENT'] })]),
  });
  expect(exec.infraError).toBe('error_during_execution: spawn ENOENT');
  const noResult = await runAgent(input, { query: fake([]) });
  expect(noResult.infraError).toBe('the SDK stream ended without a result message');
});

test('maxTurns and budget stops are model outcomes, not infrastructure', async () => {
  for (const subtype of ['error_max_turns', 'error_max_budget_usd']) {
    const r = await runAgent(input, { query: fake([result({ subtype })]) });
    expect(r.error).toBe(subtype);
    expect(r.infraError).toBeUndefined();
  }
  const plain = await runAgent(input, { query: fake([result({})]) });
  expect(plain.infraError).toBeUndefined();
  expect(plain.answer).toBeNull();
});

test('cost and cache tokens are recorded (modelUsage preferred, usage as fallback)', async () => {
  const r = await runAgent(input, {
    query: fake([
      result({
        modelUsage: {
          'claude-sonnet-5-5': {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 4000,
            cacheCreationInputTokens: 900,
          },
          'claude-haiku-5-5': {
            inputTokens: 1,
            outputTokens: 2,
            cacheReadInputTokens: 3,
            cacheCreationInputTokens: 4,
          },
        },
      }),
    ]),
  });
  expect(r.costUsd).toBe(0.0123);
  expect(r.turns).toBe(3);
  expect(r.usage).toEqual({ input: 101, output: 52, cacheRead: 4003, cacheCreate: 904 });
  expect(usageFromResult(result({}) as Parameters<typeof usageFromResult>[0])).toEqual({
    input: 5,
    output: 7,
    cacheRead: 11,
    cacheCreate: 13,
  });
});

test('the SDK gets the domain server name and system prompt', async () => {
  let seen: { options?: Record<string, unknown> } = {};
  const spy = ((args: { options?: Record<string, unknown> }) => {
    seen = args;
    return (async function* () {
      yield result({});
    })();
  }) as unknown as Query;
  await runAgent({ ...input, serverName: 'tracker', systemPrompt: 'SYS' }, { query: spy });
  expect(seen.options?.systemPrompt).toBe('SYS');
  expect(Object.keys(seen.options?.mcpServers as object)).toEqual(['tracker', 'bench']);
  expect(seen.options?.allowedTools).toEqual(['mcp__tracker__*', 'mcp__bench__submit_answer']);
});
