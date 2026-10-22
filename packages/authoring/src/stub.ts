// Stub LLM for tests and dry runs (no Claude or ollama call): a stub author module plays the model.
// It sees each request (prompt, cwd, model) and answers with files to write into the session's cwd
// (as the real author would with Write), tool uses to send through the session's permission hook
// (so containment and the Bash sandbox run for real), and a final text / structured result. The
// session machinery (agentSession, transcript, audit) is the real one.
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeOllamaFetch, type LlmDeps, type QueryFn } from '@fiks/llm';
import { isInside } from './export.ts';

export interface StubRequest {
  /** 'session' (agentSession), 'complete' (no tools), 'ollama' (open-weight chat). */
  route: 'session' | 'complete' | 'ollama';
  prompt: string;
  system?: string;
  cwd: string;
  model: string;
  /** Calls seen so far by this stub (0-based). */
  index: number;
}

export interface StubReply {
  /** Files to write, relative to the session cwd. */
  files?: Record<string, string>;
  /** Tool calls to send through the permission hook, in order, before the result. */
  toolUses?: { name: string; input: Record<string, unknown> }[];
  text?: string;
  structured?: unknown;
  /** A usage-cap answer (resets at this epoch second). */
  cap?: { resetsAt: number };
  costUsd?: number;
  /** Simulated model latency, ms. */
  latencyMs?: number;
}

export type StubAuthor = (req: StubRequest) => StubReply | Promise<StubReply>;

export async function loadStub(modulePath: string): Promise<StubAuthor> {
  const mod = (await import(pathToFileURL(resolve(modulePath)).href)) as { default?: unknown };
  if (typeof mod.default !== 'function')
    throw new Error(`${modulePath}: default export must be a stub author function`);
  return mod.default as StubAuthor;
}

const UUID = '00000000-0000-4000-8000-000000000000';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A QueryFn playing `stub`; every call is recorded in `calls`. */
export function stubQuery(stub: StubAuthor): QueryFn & { calls: StubRequest[] } {
  const calls: StubRequest[] = [];
  const fn: QueryFn = (args) => {
    const o = args.options;
    const req: StubRequest = {
      route: Array.isArray(o.tools) && o.tools.length === 0 && !o.canUseTool ? 'complete' : 'session',
      prompt: args.prompt,
      ...(typeof o.systemPrompt === 'string' ? { system: o.systemPrompt } : {}),
      cwd: o.cwd ?? process.cwd(),
      model: o.model ?? 'stub',
      index: calls.length,
    };
    calls.push(req);
    return play(stub, req, o);
  };
  return Object.assign(fn, { calls });
}

async function* play(stub: StubAuthor, req: StubRequest, o: Parameters<QueryFn>[0]['options']) {
  const session_id = `stub-${req.index}`;
  const base = { uuid: UUID, session_id };
  yield {
    type: 'system',
    subtype: 'init',
    apiKeySource: 'none',
    claude_code_version: 'stub',
    cwd: o.cwd ?? '',
    tools: Array.isArray(o.tools) ? o.tools : [],
    mcp_servers: [],
    model: o.model ?? 'stub',
    permissionMode: o.permissionMode ?? 'default',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
    ...base,
  } as never;
  const reply = await stub(req);
  if (reply.latencyMs) await sleep(reply.latencyMs);
  const result = {
    type: 'result' as const,
    duration_ms: 0,
    duration_api_ms: 0,
    num_turns: 1 + (reply.toolUses?.length ?? 0),
    stop_reason: 'end_turn',
    total_cost_usd: reply.costUsd ?? 0.001,
    usage: { input_tokens: 100, output_tokens: 20 },
    modelUsage: {},
    permission_denials: [] as unknown[],
    ...base,
  };
  if (reply.cap) {
    yield {
      type: 'rate_limit_event',
      rate_limit_info: { status: 'rejected', resetsAt: reply.cap.resetsAt, rateLimitType: 'five_hour' },
      ...base,
    } as never;
    yield {
      ...result,
      subtype: 'success',
      is_error: true,
      result: `Claude AI usage limit reached|${reply.cap.resetsAt}`,
    } as never;
    return;
  }
  const cwd = resolve(o.cwd ?? process.cwd());
  for (const [i, use] of (reply.toolUses ?? []).entries()) {
    const id = `toolu_stub_${req.index}_${i}`;
    yield {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', id, name: use.name, input: use.input }] },
      parent_tool_use_id: null,
      ...base,
    } as never;
    const decision = o.canUseTool
      ? await o.canUseTool(use.name, use.input, {
          signal: new AbortController().signal,
          toolUseID: id,
        } as never)
      : { behavior: 'allow' as const, updatedInput: use.input };
    if (decision && decision.behavior === 'deny')
      result.permission_denials.push({ tool_name: use.name, tool_use_id: id });
    yield {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: id,
            content:
              decision?.behavior === 'allow'
                ? JSON.stringify(decision.updatedInput ?? {})
                : String(decision?.message),
            is_error: decision?.behavior !== 'allow',
          },
        ],
      },
      parent_tool_use_id: null,
      ...base,
    } as never;
  }
  for (const [rel, text] of Object.entries(reply.files ?? {})) {
    const abs = isAbsolute(rel) ? rel : join(cwd, rel);
    if (!isInside(resolve(abs), cwd)) throw new Error(`stub file ${rel} is outside the session cwd`);
    mkdirSync(resolve(abs, '..'), { recursive: true });
    writeFileSync(abs, text);
  }
  const text = reply.text ?? (reply.structured !== undefined ? JSON.stringify(reply.structured) : 'done');
  yield {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
    ...base,
  } as never;
  yield {
    ...result,
    subtype: 'success',
    is_error: false,
    result: text,
    ...(reply.structured !== undefined ? { structured_output: reply.structured } : {}),
  } as never;
}

/** LlmDeps for the Claude routes (agentSession, complete) plus an ollama fetch, all from one stub. */
export function stubDeps(stub: StubAuthor): LlmDeps & { calls: StubRequest[]; ollamaModel: string } {
  const q = stubQuery(stub);
  let ollamaIndex = 0;
  const f = fakeOllamaFetch({
    model: 'stub-ollama',
    digest: 'sha256:stub',
    reply: (body) => {
      const prompt = body.messages.map((m) => m.content ?? '').join('\n\n');
      // fakeOllamaFetch's reply is synchronous: the stub must answer an ollama request synchronously.
      const r = stub({
        route: 'ollama',
        prompt,
        cwd: process.cwd(),
        model: 'stub-ollama',
        index: ollamaIndex++,
      });
      if (r instanceof Promise) throw new Error('stub ollama replies must be synchronous');
      return { content: r.text ?? JSON.stringify(r.structured ?? {}) };
    },
  });
  return { query: q, fetch: f, calls: q.calls, ollamaModel: 'stub-ollama' };
}
