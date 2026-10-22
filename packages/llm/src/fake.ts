// Deterministic stand-ins for the Agent SDK `query` and the ollama HTTP API. Used by tests and by
// `probe.ts --dry`; they make no network call and need no token.

import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { QueryFn } from './query.ts';

export interface FakeScript {
  /** Simulated spawn delay before the init message, ms. */
  spawnMs?: number;
  /** Simulated model latency before the result, ms. */
  latencyMs?: number;
  /** api_retry events emitted before the answer. */
  retries?: { status: number; error: 'rate_limit' | 'overloaded' | 'server_error' }[];
  /** Emit a rejected rate_limit_event and an error result (a usage cap). */
  cap?: { resetsAt: number; text?: string };
  /** Throw this from the iterator (transport failure). */
  throwError?: string;
  /** Final text; JSON-stringified structured output when `structured` is set. */
  text?: string;
  structured?: unknown;
  /** Error result subtype instead of success (e.g. error_max_turns). */
  errorSubtype?: 'error_max_turns' | 'error_max_budget_usd' | 'error_during_execution';
  /** A success result with is_error true and this text (API error surfaced as a result). */
  apiErrorText?: string;
  costUsd?: number;
  tokens?: { in: number; out: number };
}

export interface FakeQueryCall {
  prompt: string;
  options: Options;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A QueryFn that plays `script(callIndex, call)` and records every call. */
export function fakeQuery(script: (i: number, call: FakeQueryCall) => FakeScript): QueryFn & {
  calls: FakeQueryCall[];
} {
  const calls: FakeQueryCall[] = [];
  const fn = (args: { prompt: string; options: Options }) => {
    const i = calls.length;
    calls.push({ prompt: args.prompt, options: args.options });
    const s = script(i, args);
    return play(s, args.options);
  };
  return Object.assign(fn, { calls });
}

async function* play(s: FakeScript, o: Options): AsyncGenerator<SDKMessage> {
  const session_id = 'fake-session';
  const uuid = '00000000-0000-4000-8000-000000000000' as `${string}-${string}-${string}-${string}-${string}`;
  await sleep(s.spawnMs ?? 0);
  if (s.throwError) throw new Error(s.throwError);
  yield {
    type: 'system',
    subtype: 'init',
    apiKeySource: 'none',
    claude_code_version: 'fake',
    cwd: o.cwd ?? '',
    tools: Array.isArray(o.tools) ? o.tools : [],
    mcp_servers: [],
    model: o.model ?? 'fake',
    permissionMode: o.permissionMode ?? 'default',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
    uuid,
    session_id,
  } as unknown as SDKMessage;
  for (const [k, r] of (s.retries ?? []).entries()) {
    yield {
      type: 'system',
      subtype: 'api_retry',
      attempt: k + 1,
      max_retries: 10,
      retry_delay_ms: 1,
      error_status: r.status,
      error: r.error,
      uuid,
      session_id,
    } as SDKMessage;
  }
  await sleep(s.latencyMs ?? 0);
  const tokens = s.tokens ?? { in: 100, out: 20 };
  const base = {
    type: 'result' as const,
    duration_ms: s.latencyMs ?? 0,
    duration_api_ms: s.latencyMs ?? 0,
    num_turns: 1,
    stop_reason: 'end_turn',
    total_cost_usd: s.costUsd ?? 0.001,
    usage: { input_tokens: tokens.in, output_tokens: tokens.out },
    modelUsage: {
      [o.model ?? 'fake']: {
        inputTokens: tokens.in,
        outputTokens: tokens.out,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: s.costUsd ?? 0.001,
        contextWindow: 200000,
        maxOutputTokens: 32000,
      },
    },
    permission_denials: [],
    uuid,
    session_id,
  };
  if (s.cap) {
    yield {
      type: 'rate_limit_event',
      rate_limit_info: { status: 'rejected', resetsAt: s.cap.resetsAt, rateLimitType: 'five_hour' },
      uuid,
      session_id,
    } as SDKMessage;
    yield {
      ...base,
      subtype: 'success',
      is_error: true,
      result: s.cap.text ?? `Claude AI usage limit reached|${s.cap.resetsAt}`,
    } as unknown as SDKMessage;
    return;
  }
  yield {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: s.text ?? 'ok' }] },
    parent_tool_use_id: null,
    uuid,
    session_id,
  } as unknown as SDKMessage;
  if (s.errorSubtype) {
    yield { ...base, subtype: s.errorSubtype, is_error: true, errors: [] } as unknown as SDKMessage;
    return;
  }
  if (s.apiErrorText) {
    yield { ...base, subtype: 'success', is_error: true, result: s.apiErrorText } as unknown as SDKMessage;
    return;
  }
  yield {
    ...base,
    subtype: 'success',
    is_error: false,
    result: s.text ?? (s.structured !== undefined ? JSON.stringify(s.structured) : 'ok'),
    ...(s.structured !== undefined ? { structured_output: s.structured } : {}),
  } as unknown as SDKMessage;
}

/** A fetch for the ollama endpoints used here (/api/tags, /v1/chat/completions). */
export function fakeOllamaFetch(opts: {
  model: string;
  digest: string;
  latencyMs?: number;
  completionTokens?: number;
  reply?: (body: { messages: { role: string; content: string | null }[]; tools?: unknown[] }) => {
    content?: string;
    tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  };
}): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: [{ name: opts.model, digest: opts.digest }] }), {
        status: 200,
      });
    }
    if (url.endsWith('/v1/chat/completions')) {
      await sleep(opts.latencyMs ?? 0);
      const body = JSON.parse(String(init?.body ?? '{}'));
      const r = opts.reply?.(body) ?? { content: '{"ok":true}' };
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: r.content ?? '',
                ...(r.tool_calls ? { tool_calls: r.tool_calls } : {}),
              },
              finish_reason: r.tool_calls ? 'tool_calls' : 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: opts.completionTokens ?? 64 },
        }),
        { status: 200 },
      );
    }
    return new Response('not found', { status: 404 });
  };
  return Object.assign(f as typeof fetch, { calls });
}
