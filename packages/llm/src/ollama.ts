// Minimal ollama client: OpenAI-compatible chat completions plus a minimal MCP tool loop (held-out
// traffic, PLAN 5.9; ideation, 5.1). Only the model approved in ../ollama.json is used by default.

import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { classifyLlmFailure, type LlmFailure, RETRYABLE } from './classify.ts';
import { assertLlmAllowed, LlmInfraError } from './errors.ts';
import { backoffMs, defaultSleep, type LlmDeps } from './query.ts';
import { logCall } from './usage.ts';

export interface OllamaConfig {
  model: string | null;
  digest?: string;
  quantization?: string;
  approval?: string;
}

const CONFIG_URL = new URL('../ollama.json', import.meta.url);

/** The approved model (PLAN 8.0); `model: null` means none is approved. */
export function ollamaConfig(): OllamaConfig {
  return JSON.parse(readFileSync(CONFIG_URL, 'utf8')) as OllamaConfig;
}

export function ollamaBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const h = env.OLLAMA_HOST?.trim();
  if (!h) return 'http://127.0.0.1:11434';
  const withScheme = /^https?:\/\//.test(h) ? h : `http://${h}`;
  return withScheme.replace(/\/$/, '');
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatTool {
  type: 'function';
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

export interface OllamaChatOptions {
  messages: ChatMessage[];
  model?: string;
  tools?: ChatTool[];
  temperature?: number;
  maxTokens?: number;
  /** `json_object` asks ollama for JSON output. */
  responseFormat?: 'json_object';
  timeoutMs?: number;
  retries?: number;
  retryBaseMs?: number;
  baseUrl?: string;
  label?: string;
  logPath?: string;
  deps?: LlmDeps;
}

export interface OllamaChatResult {
  message: ChatMessage;
  finishReason: string | null;
  promptTokens: number;
  completionTokens: number;
  wallMs: number;
  /** completionTokens per wall-clock second of the request (prompt eval included). */
  tokensPerSec: number;
  attempts: number;
}

interface ChatCompletionResponse {
  choices?: { message?: ChatMessage; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export async function ollamaChat(opts: OllamaChatOptions): Promise<OllamaChatResult> {
  assertLlmAllowed('ollamaChat');
  const model = opts.model ?? ollamaConfig().model;
  if (!model) throw new Error('no approved ollama model (packages/llm/ollama.json)');
  const f = opts.deps?.fetch ?? fetch;
  const sleep = opts.deps?.sleep ?? defaultSleep;
  const url = `${opts.baseUrl ?? ollamaBaseUrl()}/v1/chat/completions`;
  const body = JSON.stringify({
    model,
    messages: opts.messages,
    stream: false,
    ...(opts.tools?.length ? { tools: opts.tools } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.responseFormat ? { response_format: { type: opts.responseFormat } } : {}),
  });
  const retries = opts.retries ?? 3;
  let attempts = 0;
  let failure: LlmFailure;
  for (;;) {
    attempts++;
    const t0 = Date.now();
    try {
      const res = await f(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 600_000),
      });
      const text = await res.text();
      if (!res.ok) {
        failure = classifyLlmFailure(
          Object.assign(new Error(`ollama HTTP ${res.status}: ${text.slice(0, 300)}`), {
            status: res.status,
          }),
        );
      } else {
        const j = JSON.parse(text) as ChatCompletionResponse;
        const choice = j.choices?.[0];
        if (!choice?.message) throw new Error(`ollama: no choices in response: ${text.slice(0, 300)}`);
        const wallMs = Date.now() - t0;
        const completionTokens = j.usage?.completion_tokens ?? 0;
        const out: OllamaChatResult = {
          message: choice.message,
          finishReason: choice.finish_reason ?? null,
          promptTokens: j.usage?.prompt_tokens ?? 0,
          completionTokens,
          wallMs,
          tokensPerSec: wallMs > 0 ? completionTokens / (wallMs / 1000) : 0,
          attempts,
        };
        logCall(
          {
            ts: new Date().toISOString(),
            fn: 'ollamaChat',
            model,
            ...(opts.label ? { label: opts.label } : {}),
            outcome: 'ok',
            attempts,
            retryEvents: attempts - 1,
            costUsd: 0,
            tokens: { in: out.promptTokens, out: completionTokens, cacheRead: 0, cacheCreate: 0 },
            turns: 1,
            wallMs,
          },
          opts.logPath,
        );
        return out;
      }
    } catch (e) {
      failure = classifyLlmFailure(e);
    }
    if (!RETRYABLE.has(failure.kind) || attempts > retries) throw new LlmInfraError(failure, attempts);
    await sleep(backoffMs(attempts, opts.retryBaseMs ?? 1000));
  }
}

/** What the tool loop needs from an MCP client. */
export interface McpToolSource {
  listTools(): Promise<{ name: string; description?: string; inputSchema: Record<string, unknown> }[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<{ content?: unknown; isError?: boolean }>;
  close?(): Promise<void>;
}

/** Connects to a stdio MCP server (e.g. fiks-proxy in front of shop-mcp). */
export async function connectStdioMcp(cfg: {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}): Promise<McpToolSource> {
  assertLlmAllowed('connectStdioMcp');
  const client = new Client({ name: 'fiks-ollama', version: '0.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      ...(cfg.env ? { env: cfg.env } : {}),
      ...(cfg.cwd ? { cwd: cfg.cwd } : {}),
    }),
  );
  return {
    listTools: async () =>
      (await client.listTools()).tools.map((t) => ({
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        inputSchema: t.inputSchema as Record<string, unknown>,
      })),
    callTool: async (name, args) => {
      const r = await client.callTool({ name, arguments: args });
      return { content: r.content, isError: r.isError === true };
    },
    close: () => client.close(),
  };
}

export interface ToolLoopCall {
  name: string;
  args: Record<string, unknown>;
  /** Arguments that did not parse as a JSON object are kept raw and not executed. */
  rawArgs?: string;
  ok: boolean;
  result: unknown;
}

export interface ToolLoopResult {
  answer: string | null;
  calls: ToolLoopCall[];
  turns: number;
  completionTokens: number;
  promptTokens: number;
  wallMs: number;
  stoppedBy: 'answer' | 'max_turns';
}

/**
 * Chat with the MCP server's tools until the model answers without a tool call or maxTurns is hit.
 * Tool results go back as `tool` messages, text content joined.
 */
export async function ollamaToolLoop(opts: {
  mcp: McpToolSource;
  prompt: string;
  system?: string;
  model?: string;
  maxTurns?: number;
  temperature?: number;
  baseUrl?: string;
  label?: string;
  logPath?: string;
  deps?: LlmDeps;
}): Promise<ToolLoopResult> {
  assertLlmAllowed('ollamaToolLoop');
  const t0 = Date.now();
  const tools: ChatTool[] = (await opts.mcp.listTools()).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      parameters: t.inputSchema,
    },
  }));
  const messages: ChatMessage[] = [
    ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
    { role: 'user', content: opts.prompt },
  ];
  const calls: ToolLoopCall[] = [];
  let completionTokens = 0;
  let promptTokens = 0;
  const maxTurns = opts.maxTurns ?? 8;
  for (let turn = 1; turn <= maxTurns; turn++) {
    const r = await ollamaChat({
      messages,
      tools,
      ...(opts.model ? { model: opts.model } : {}),
      temperature: opts.temperature ?? 0,
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
      ...(opts.label ? { label: opts.label } : {}),
      ...(opts.logPath ? { logPath: opts.logPath } : {}),
      ...(opts.deps ? { deps: opts.deps } : {}),
    });
    completionTokens += r.completionTokens;
    promptTokens += r.promptTokens;
    messages.push({ ...r.message, content: r.message.content ?? '' });
    const tcs = r.message.tool_calls ?? [];
    if (tcs.length === 0) {
      return {
        answer: r.message.content ?? '',
        calls,
        turns: turn,
        completionTokens,
        promptTokens,
        wallMs: Date.now() - t0,
        stoppedBy: 'answer',
      };
    }
    for (const tc of tcs) {
      let args: Record<string, unknown> | undefined;
      try {
        const parsed: unknown = JSON.parse(tc.function.arguments || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
          args = parsed as Record<string, unknown>;
      } catch {
        args = undefined;
      }
      let content: string;
      if (!args) {
        calls.push({
          name: tc.function.name,
          args: {},
          rawArgs: tc.function.arguments,
          ok: false,
          result: null,
        });
        content = 'Error: tool arguments must be a JSON object.';
      } else {
        try {
          const res = await opts.mcp.callTool(tc.function.name, args);
          calls.push({ name: tc.function.name, args, ok: !res.isError, result: res.content });
          content = mcpText(res.content);
        } catch (e) {
          calls.push({ name: tc.function.name, args, ok: false, result: String(e) });
          content = `Error: ${(e as Error).message}`;
        }
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content });
    }
  }
  return {
    answer: null,
    calls,
    turns: maxTurns,
    completionTokens,
    promptTokens,
    wallMs: Date.now() - t0,
    stoppedBy: 'max_turns',
  };
}

function mcpText(content: unknown): string {
  if (!Array.isArray(content)) return JSON.stringify(content ?? null);
  return content
    .map((b: { type?: string; text?: string }) => (b.type === 'text' ? (b.text ?? '') : JSON.stringify(b)))
    .join('\n');
}

export interface OllamaReadiness {
  ready: boolean;
  reason?: string;
  model?: string;
  digest?: string;
}

/** Whether the approved model can run here: configured, server reachable, model pulled, digest pinned. */
export async function ollamaReadiness(
  deps: LlmDeps = {},
  baseUrl = ollamaBaseUrl(),
): Promise<OllamaReadiness> {
  assertLlmAllowed('ollamaReadiness');
  const cfg = ollamaConfig();
  if (!cfg.model)
    return { ready: false, reason: 'no ollama model is approved (packages/llm/ollama.json model: null)' };
  const f = deps.fetch ?? fetch;
  let tags: { models?: { name: string; digest: string }[] };
  try {
    const res = await f(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    tags = (await res.json()) as typeof tags;
  } catch (e) {
    return {
      ready: false,
      model: cfg.model,
      reason: `ollama server not reachable at ${baseUrl}: ${String(e)}`,
    };
  }
  const m = tags.models?.find((x) => x.name === cfg.model || x.name === `${cfg.model}:latest`);
  if (!m)
    return {
      ready: false,
      model: cfg.model,
      reason: `model ${cfg.model} is not pulled (ollama pull ${cfg.model})`,
    };
  if (cfg.digest && m.digest !== cfg.digest) {
    return {
      ready: false,
      model: cfg.model,
      digest: m.digest,
      reason: `local ${cfg.model} digest ${m.digest} != pinned ${cfg.digest}`,
    };
  }
  return { ready: true, model: cfg.model, digest: m.digest };
}
