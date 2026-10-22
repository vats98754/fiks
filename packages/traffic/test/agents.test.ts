// The Claude route (LLMR agentSession with a scripted SDK query) and the ollama route (LLMR tool
// loop with a fake ollama API) against the fixture MCP server. No model, no token, no network.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeOllamaFetch, LlmForbiddenError, type QueryFn } from '@fiks/llm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { claudeAgent, ollamaAgent, type SessionInput } from '../src/index.ts';
import { fixtureServer, tempDir } from './support.ts';

afterEach(() => vi.unstubAllEnvs());

type SDKMessage = QueryFn extends (...a: never[]) => AsyncIterable<infer M> ? M : never;

const input = (over: Partial<SessionInput> = {}): SessionInput => ({
  agent: 'opus',
  model: 'claude-opus-5-5',
  taskId: 'q1',
  trial: 1,
  prompt: 'What is item x-101?',
  system: 'You are an assistant.',
  serverName: 'catalog',
  server: { ...fixtureServer('http://127.0.0.1:9/v'), cwd: '/tmp' },
  maxTurns: 6,
  transcriptPath: join(tempDir(), 'transcript.jsonl'),
  ...over,
});

/** A scripted SDK query: two tool uses (one errors), then an answer. */
function scriptedQuery(): QueryFn & { options: unknown[] } {
  const options: unknown[] = [];
  const fn = (args: { prompt: string; options: unknown }) => {
    options.push(args.options);
    const msgs = [
      { type: 'system', subtype: 'init', tools: [], cwd: '/x', session_id: 's' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Let me look.' },
            { type: 'tool_use', id: 't1', name: 'mcp__catalog__get_item', input: { id: 'x-101' } },
          ],
        },
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'ok' }] },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't2', name: 'mcp__catalog__get_item', input: { id: 'zz' } }],
        },
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'nf' }] },
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'It is a red mug.' }] } },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'It is a red mug.',
        num_turns: 3,
        total_cost_usd: 0.01,
        usage: { input_tokens: 10, output_tokens: 5 },
        permission_denials: [],
      },
    ];
    return (async function* () {
      for (const m of msgs) yield m as unknown as SDKMessage;
    })();
  };
  return Object.assign(fn as unknown as QueryFn, { options });
}

describe('Claude route', () => {
  test('agentSession sees only the server tools; calls come from its transcript', async () => {
    const q = scriptedQuery();
    const i = input();
    const r = await claudeAgent({ query: q })(i);
    expect(r).toMatchObject({ outcome: 'ok', answer: 'It is a red mug.', turns: 3, costUsd: 0.01 });
    expect(r.calls).toEqual([
      { tool: 'get_item', args: { id: 'x-101' }, toolError: false },
      { tool: 'get_item', args: { id: 'zz' }, toolError: true },
    ]);
    const o = q.options[0] as Record<string, unknown> & {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    expect(o.model).toBe('claude-opus-5-5');
    expect(o.tools).toEqual([]);
    expect(o.allowedTools).toEqual(['mcp__catalog__*']);
    expect(o.settingSources).toEqual([]);
    expect(o.systemPrompt).toBe('You are an assistant.');
    expect(o.maxTurns).toBe(6);
    expect(o.mcpServers.catalog).toMatchObject({ type: 'stdio', command: '/bin/sh', alwaysLoad: true });
    expect((o.mcpServers.catalog?.args as string[] | undefined)?.slice(2)).toEqual([
      '/tmp',
      process.execPath,
      i.server.args[0],
    ]);
    // The transcript is LLMR's: header (no env values), every SDK message, footer.
    const lines = readFileSync(i.transcriptPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: 'fiks_session_header', label: 'traffic/opus/q1/1' });
    expect(lines.at(-1)).toMatchObject({ type: 'fiks_session_footer', outcome: 'ok' });
  });

  test('FIKS_LLM_FORBID=1 refuses the Claude route before any query', async () => {
    vi.stubEnv('FIKS_LLM_FORBID', '1');
    const q = scriptedQuery();
    await expect(claudeAgent({ query: q })(input())).rejects.toThrow(LlmForbiddenError);
    expect(q.options).toHaveLength(0);
  });
});

describe('ollama route', () => {
  const fetchWith = () =>
    fakeOllamaFetch({
      model: 'qwen2.5:7b-instruct',
      digest: 'd',
      reply: (body) =>
        body.messages.some((m) => m.role === 'tool')
          ? { content: 'It is a red mug.' }
          : {
              tool_calls: [
                { id: 'c1', type: 'function', function: { name: 'get_item', arguments: '{"id":"x-101"}' } },
                { id: 'c2', type: 'function', function: { name: 'search', arguments: '{not json' } },
                { id: 'c3', type: 'function', function: { name: 'get_item', arguments: '{"id":"nope"}' } },
              ],
            },
    });

  test('the MCP-client chat loop reports every call; non-object args are kept raw and not executed', async () => {
    const f = fetchWith();
    const i = input({ agent: 'ollama', model: 'qwen2.5:7b-instruct' });
    const r = await ollamaAgent({ deps: { fetch: f } })(i);
    expect(r.outcome).toBe('ok');
    expect(r.answer).toBe('It is a red mug.');
    expect(r.calls).toEqual([
      { tool: 'get_item', args: { id: 'x-101' }, toolError: false },
      { tool: 'search', args: null, rawArgs: '{not json', toolError: null },
      { tool: 'get_item', args: { id: 'nope' }, toolError: true },
    ]);
    expect(r.turns).toBe(2);
    expect(f.calls.every((u) => u.endsWith('/v1/chat/completions'))).toBe(true);
    const lines = readFileSync(i.transcriptPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(5);
  });

  test('an ollama transport failure after retries is an infra_error session', async () => {
    const failing = (async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    }) as unknown as typeof fetch;
    const r = await ollamaAgent({ deps: { fetch: failing, sleep: async () => {} } })(
      input({ agent: 'ollama', model: 'm' }),
    );
    expect(r.outcome).toBe('infra_error');
    expect(r.calls).toEqual([]);
  });

  test('FIKS_LLM_FORBID=1 refuses the ollama route', async () => {
    vi.stubEnv('FIKS_LLM_FORBID', '1');
    await expect(ollamaAgent({ deps: { fetch: fetchWith() } })(input({ agent: 'ollama' }))).rejects.toThrow(
      LlmForbiddenError,
    );
  });
});
