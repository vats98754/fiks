// The traffic agents (PLAN 5.9): Opus, Sonnet and Haiku through the Agent SDK (LLMR's
// `agentSession`: OAuth token, settingSources [], scrubbed env, JSONL transcript), and the one
// approved ollama model through LLMR's minimal MCP-client chat loop. Each agent works one task
// prompt against the domain's MCP server and reports the tool calls it made, in order.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentSession,
  connectStdioMcp,
  type LlmDeps,
  LlmInfraError,
  type LlmOutcome,
  ollamaConfig,
  ollamaToolLoop,
  type QueryFn,
} from '@fiks/llm';
import { type McpServerSpec, sdkStdio } from './mcp.ts';

export type AgentRoute = 'claude' | 'ollama' | 'stub';

/** The agent names `--agents` accepts and their default models. */
export const CLAUDE_MODELS = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
} as const;

export const AGENT_NAMES = ['opus', 'sonnet', 'haiku', 'ollama'] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export interface SessionInput {
  agent: string;
  model: string;
  taskId: string;
  trial: number;
  prompt: string;
  system: string;
  /** MCP server name the agent sees (Claude tools are `mcp__<serverName>__<tool>`). */
  serverName: string;
  server: McpServerSpec;
  maxTurns: number;
  /** Where the session writes its transcript (JSONL). */
  transcriptPath: string;
  /** LLM usage log (LLMR `logCall`). */
  logPath?: string;
}

/** One tool call as the agent sent it. */
export interface SessionCall {
  /** The server's tool name (prefix stripped). */
  tool: string;
  /** Parsed arguments; null when they were not a JSON object (then `rawArgs` holds them). */
  args: Record<string, unknown> | null;
  rawArgs?: string;
  /** Whether the server answered with an error; null when the call was never executed. */
  toolError: boolean | null;
}

export type SessionOutcome = LlmOutcome;

export interface SessionTokens {
  in: number;
  out: number;
  cacheRead: number;
  cacheCreate: number;
}

export interface SessionOutput {
  calls: SessionCall[];
  answer: string | null;
  outcome: SessionOutcome;
  error?: string;
  turns: number;
  costUsd: number;
  tokens: SessionTokens;
  wallMs: number;
}

export type TrafficAgent = (input: SessionInput) => Promise<SessionOutput>;

export const zeroTokens = (): SessionTokens => ({ in: 0, out: 0, cacheRead: 0, cacheCreate: 0 });

interface TranscriptBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
}

/**
 * The server tool calls in an `agentSession` transcript, in order: `tool_use` blocks named
 * `mcp__<serverName>__<tool>` of the last attempt, each with its `tool_result` error flag.
 */
export function callsFromTranscript(text: string, serverName: string): SessionCall[] {
  const lines = text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type?: string; message?: { content?: unknown } });
  let start = 0;
  lines.forEach((m, i) => {
    if (m.type === 'fiks_attempt') start = i + 1;
  });
  const prefix = `mcp__${serverName}__`;
  const calls: (SessionCall & { id?: string })[] = [];
  const errors = new Map<string, boolean>();
  for (const m of lines.slice(start)) {
    const content = m.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content as TranscriptBlock[]) {
      if (m.type === 'assistant' && b.type === 'tool_use' && b.name?.startsWith(prefix)) {
        const isObj = !!b.input && typeof b.input === 'object' && !Array.isArray(b.input);
        calls.push({
          tool: b.name.slice(prefix.length),
          args: isObj ? (b.input as Record<string, unknown>) : null,
          ...(isObj ? {} : { rawArgs: JSON.stringify(b.input ?? null) }),
          toolError: null,
          ...(b.id ? { id: b.id } : {}),
        });
      } else if (m.type === 'user' && b.type === 'tool_result' && b.tool_use_id) {
        errors.set(b.tool_use_id, b.is_error === true);
      }
    }
  }
  return calls.map(({ id, ...c }) =>
    id && errors.has(id) ? { ...c, toolError: errors.get(id) ?? null } : c,
  );
}

/** Claude through LLMR's agentSession; only the domain server's tools, no built-in tools. */
export function claudeAgent(opts: { query?: QueryFn; maxBudgetUsd?: number; timeoutMs?: number } = {}) {
  const agent: TrafficAgent = async (input) => {
    const cwd = mkdtempSync(join(tmpdir(), 'fiks-traffic-cwd-'));
    try {
      const r = await agentSession({
        cwd,
        prompt: input.prompt,
        model: input.model,
        systemPrompt: input.system,
        allowedTools: [`mcp__${input.serverName}__*`],
        mcpServers: { [input.serverName]: { type: 'stdio', ...sdkStdio(input.server), alwaysLoad: true } },
        budget: {
          maxTurns: input.maxTurns,
          maxBudgetUsd: opts.maxBudgetUsd ?? 2,
          timeoutMs: opts.timeoutMs ?? 15 * 60_000,
        },
        transcriptPath: input.transcriptPath,
        label: `traffic/${input.agent}/${input.taskId}/${input.trial}`,
        ...(input.logPath ? { logPath: input.logPath } : {}),
        ...(opts.query ? { deps: { query: opts.query } } : {}),
      });
      const error = r.modelError ?? r.failure?.message;
      return {
        calls: callsFromTranscript(readFileSync(r.transcriptPath, 'utf8'), input.serverName),
        answer: r.ok ? r.result : null,
        outcome: r.outcome,
        ...(error ? { error } : {}),
        turns: r.turns,
        costUsd: r.costUsd,
        tokens: { ...r.tokens },
        wallMs: r.wallMs,
      };
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  };
  return agent;
}

/** The approved ollama model (packages/llm/ollama.json), or null when none is approved. */
export function ollamaModel(): string | null {
  return ollamaConfig().model;
}

/** The ollama model through LLMR's MCP-client chat loop (temperature 0). */
export function ollamaAgent(opts: { deps?: LlmDeps; baseUrl?: string } = {}) {
  const agent: TrafficAgent = async (input) => {
    const t0 = Date.now();
    const transcript: unknown[] = [{ type: 'fiks_traffic_ollama', model: input.model, prompt: input.prompt }];
    const mcp = await connectStdioMcp({
      command: input.server.command,
      args: input.server.args,
      env: input.server.env,
      ...(input.server.cwd ? { cwd: input.server.cwd } : {}),
    });
    try {
      const r = await ollamaToolLoop({
        mcp,
        prompt: input.prompt,
        system: input.system,
        model: input.model,
        maxTurns: input.maxTurns,
        temperature: 0,
        label: `traffic/${input.agent}/${input.taskId}/${input.trial}`,
        ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
        ...(input.logPath ? { logPath: input.logPath } : {}),
        ...(opts.deps ? { deps: opts.deps } : {}),
      });
      transcript.push(...r.calls.map((c) => ({ type: 'tool_call', ...c })), {
        type: 'answer',
        answer: r.answer,
        stoppedBy: r.stoppedBy,
      });
      return {
        calls: r.calls.map((c) => ({
          tool: c.name,
          args: c.rawArgs === undefined ? c.args : null,
          ...(c.rawArgs === undefined ? {} : { rawArgs: c.rawArgs }),
          toolError: c.rawArgs === undefined ? !c.ok : null,
        })),
        answer: r.answer,
        outcome: r.stoppedBy === 'answer' ? 'ok' : 'model_error',
        ...(r.stoppedBy === 'answer' ? {} : { error: 'max_turns' }),
        turns: r.turns,
        costUsd: 0,
        tokens: { in: r.promptTokens, out: r.completionTokens, cacheRead: 0, cacheCreate: 0 },
        wallMs: r.wallMs,
      };
    } catch (e) {
      transcript.push({ type: 'error', error: String(e) });
      // Transport, 429 or 5xx after LLMR's retries is an infra_error; anything else is a bug.
      if (!(e instanceof LlmInfraError)) throw e;
      return {
        calls: [],
        answer: null,
        outcome: 'infra_error',
        error: e instanceof Error ? e.message : String(e),
        turns: 0,
        costUsd: 0,
        tokens: zeroTokens(),
        wallMs: Date.now() - t0,
      };
    } finally {
      await mcp.close?.().catch(() => {});
      writeFileSync(input.transcriptPath, transcript.map((x) => `${JSON.stringify(x)}\n`).join(''));
    }
  };
  return agent;
}
