// agentSession(): one isolated agentic session (authoring, repair-like work, traffic collection)
// through the Agent SDK on the OAuth token. settingSources: [] (no CLAUDE.md, no user or project
// settings), only the listed tools, web tools refused unless explicitly allowed, a scrubbed env
// with a temp HOME, and a full JSONL transcript: a header with the effective configuration, every
// SDK message, and a footer with the outcome.

import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { CanUseTool, McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { LlmFailure } from './classify.ts';
import { envKeys, freshHome, scrubbedEnv } from './env.ts';
import { assertLlmAllowed, LlmConfigError } from './errors.ts';
import {
  type AttemptObservation,
  backoffMs,
  defaultSleep,
  type LlmDeps,
  observeQuery,
  type QueryOptions,
  realQuery,
  shouldRetry,
} from './query.ts';
import {
  addTokens,
  type LlmCallLog,
  type LlmOutcome,
  logCall,
  type TokenUsage,
  tokensFromResult,
  zeroTokens,
} from './usage.ts';

export const WEB_TOOLS = ['WebFetch', 'WebSearch'] as const;

export interface SessionBudget {
  maxTurns: number;
  maxBudgetUsd: number;
  /** Wall-clock cap per attempt (e.g. 90 min for repair). Default 90 minutes. */
  timeoutMs?: number;
}

export interface AgentSessionOptions {
  cwd: string;
  prompt: string;
  model: string;
  /** Built-in tool names (e.g. Read, Grep, Edit, Bash) and MCP tool names (mcp__server__tool, wildcards ok). */
  allowedTools: string[];
  budget: SessionBudget;
  /** Replaces Claude Code's system prompt; omit to keep the preset. */
  systemPrompt?: string;
  /** WebFetch/WebSearch are refused unless this is true. */
  allowWebTools?: boolean;
  mcpServers?: Record<string, McpServerConfig>;
  /** Per-call permission hook (e.g. sandbox Bash rewrite, read containment). Allowed tools then go through it. */
  canUseTool?: CanUseTool;
  outputSchema?: Record<string, unknown>;
  /** Extra env vars, explicitly allowed by the caller (names logged, values never). */
  extraEnv?: Record<string, string>;
  /** HOME for the child; a temp dir (removed afterwards) when omitted. */
  home?: string;
  /** JSONL transcript path; default a new file under $TMPDIR. */
  transcriptPath?: string;
  /** Retries after the first attempt, only when the failed attempt produced no model output. Default 3. */
  retries?: number;
  retryBaseMs?: number;
  label?: string;
  runKey?: string;
  logPath?: string;
  deps?: LlmDeps;
}

export interface AgentSessionResult {
  ok: boolean;
  outcome: LlmOutcome;
  failure?: LlmFailure;
  /** Max turns, budget, structured-output retries or timeout after model output. */
  modelError?: string;
  result: string;
  structuredOutput?: unknown;
  turns: number;
  costUsd: number;
  tokens: TokenUsage;
  wallMs: number;
  spawnMs?: number;
  attempts: number;
  retryEvents: number;
  rateLimitEvents: number;
  overloadEvents: number;
  capEvents: LlmFailure[];
  permissionDenials: number;
  /** Tools the Claude Code process reported in its init message. */
  initTools: string[];
  transcriptPath: string;
  sessionId?: string;
}

/** The SDK options of a session; exported so tests can check them without a query. */
export function sessionQueryOptions(opts: AgentSessionOptions, env: Record<string, string>): QueryOptions {
  const web = new Set<string>(WEB_TOOLS);
  const asked = opts.allowedTools.filter((t) => web.has(t));
  if (asked.length > 0 && !opts.allowWebTools) {
    throw new LlmConfigError(`web tools need allowWebTools: true (asked for ${asked.join(', ')})`);
  }
  const builtins = opts.allowedTools.filter((t) => !t.startsWith('mcp__'));
  return {
    cwd: resolve(opts.cwd),
    model: opts.model,
    tools: builtins,
    // With a canUseTool hook nothing is auto-allowed: every call goes through the hook.
    allowedTools: opts.canUseTool ? [] : opts.allowedTools,
    disallowedTools: opts.allowWebTools ? [] : [...WEB_TOOLS],
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: opts.mcpServers ?? {},
    permissionMode: opts.canUseTool ? 'default' : 'dontAsk',
    ...(opts.canUseTool ? { canUseTool: opts.canUseTool } : {}),
    ...(opts.systemPrompt !== undefined ? { systemPrompt: opts.systemPrompt } : {}),
    ...(opts.outputSchema ? { outputFormat: { type: 'json_schema', schema: opts.outputSchema } } : {}),
    maxTurns: opts.budget.maxTurns,
    maxBudgetUsd: opts.budget.maxBudgetUsd,
    persistSession: false,
    env,
  };
}

function jsonLine(path: string, v: unknown): void {
  appendFileSync(path, `${JSON.stringify(v)}\n`);
}

export async function agentSession(opts: AgentSessionOptions): Promise<AgentSessionResult> {
  assertLlmAllowed('agentSession');
  const ownHome = opts.home === undefined;
  const home = opts.home ?? freshHome();
  try {
    return await runSession(opts, home);
  } finally {
    if (ownHome) rmSync(home, { recursive: true, force: true });
  }
}

async function runSession(opts: AgentSessionOptions, home: string): Promise<AgentSessionResult> {
  const q = opts.deps?.query ?? realQuery;
  const sleep = opts.deps?.sleep ?? defaultSleep;
  const env = scrubbedEnv({
    home,
    ...(opts.extraEnv ? { extra: opts.extraEnv } : {}),
    requireToken: !opts.deps?.query,
  });
  const options = sessionQueryOptions(opts, env);
  const transcriptPath =
    opts.transcriptPath ?? join(mkdtempSync(join(tmpdir(), 'fiks-llm-session-')), 'transcript.jsonl');
  mkdirSync(dirname(transcriptPath), { recursive: true });
  writeFileSync(transcriptPath, '');
  jsonLine(transcriptPath, {
    type: 'fiks_session_header',
    startedAt: new Date().toISOString(),
    label: opts.label ?? null,
    runKey: opts.runKey ?? null,
    model: opts.model,
    cwd: options.cwd,
    settingSources: options.settingSources,
    tools: options.tools,
    allowedTools: opts.allowedTools,
    disallowedTools: options.disallowedTools,
    webTools: opts.allowWebTools ? 'allowed' : 'excluded',
    permissionMode: options.permissionMode,
    canUseTool: !!opts.canUseTool,
    mcpServers: Object.keys(options.mcpServers ?? {}),
    systemPrompt: opts.systemPrompt === undefined ? 'preset' : 'override',
    budget: opts.budget,
    envKeys: envKeys(env),
    home,
    prompt: opts.prompt,
  });

  const retries = opts.retries ?? 3;
  const t0 = Date.now();
  let attempts = 0;
  let cost = 0;
  let tokens = zeroTokens();
  let retryEvents = 0;
  let rateLimitEvents = 0;
  let overloadEvents = 0;
  const capEvents: LlmFailure[] = [];
  let obs: AttemptObservation;
  for (;;) {
    attempts++;
    jsonLine(transcriptPath, { type: 'fiks_attempt', attempt: attempts, at: new Date().toISOString() });
    obs = await observeQuery(q, opts.prompt, options, {
      timeoutMs: opts.budget.timeoutMs ?? 90 * 60_000,
      onMessage: (m) => jsonLine(transcriptPath, m),
      ...(opts.deps?.now ? { now: opts.deps.now } : {}),
    });
    retryEvents += obs.retryEvents;
    rateLimitEvents += obs.rateLimitEvents;
    overloadEvents += obs.overloadEvents;
    capEvents.push(...obs.capEvents);
    if (obs.result) {
      cost += obs.result.total_cost_usd ?? 0;
      tokens = addTokens(tokens, tokensFromResult(obs.result));
    }
    if (!obs.failure || obs.modelError || obs.failure.kind === 'cap') break;
    if (!shouldRetry(obs, true) || attempts > retries) break;
    jsonLine(transcriptPath, { type: 'fiks_retry', attempt: attempts, failure: obs.failure });
    await sleep(backoffMs(attempts, opts.retryBaseMs ?? 5000));
  }

  const r = obs.result;
  const outcome: LlmOutcome = obs.modelError
    ? 'model_error'
    : obs.failure
      ? obs.failure.kind === 'cap'
        ? 'cap'
        : 'infra_error'
      : 'ok';
  const result: AgentSessionResult = {
    ok: outcome === 'ok',
    outcome,
    ...(obs.failure && !obs.modelError ? { failure: obs.failure } : {}),
    ...(obs.modelError ? { modelError: obs.modelError } : {}),
    result: r && r.subtype === 'success' ? r.result : '',
    ...(r && r.subtype === 'success' && r.structured_output !== undefined
      ? { structuredOutput: r.structured_output }
      : {}),
    turns: r?.num_turns ?? 0,
    costUsd: cost,
    tokens,
    wallMs: Date.now() - t0,
    ...(obs.spawnMs !== undefined ? { spawnMs: obs.spawnMs } : {}),
    attempts,
    retryEvents,
    rateLimitEvents,
    overloadEvents,
    capEvents,
    permissionDenials: r?.permission_denials?.length ?? 0,
    initTools: obs.initTools ?? [],
    transcriptPath,
    ...(obs.sessionId ? { sessionId: obs.sessionId } : {}),
  };
  const { result: _text, structuredOutput: _so, ...footer } = result;
  jsonLine(transcriptPath, { type: 'fiks_session_footer', endedAt: new Date().toISOString(), ...footer });
  const entry: LlmCallLog = {
    ts: new Date().toISOString(),
    fn: 'agentSession',
    model: opts.model,
    ...(opts.label ? { label: opts.label } : {}),
    ...(opts.runKey ? { runKey: opts.runKey } : {}),
    outcome,
    ...(result.failure ? { failure: result.failure } : {}),
    attempts,
    retryEvents,
    costUsd: cost,
    tokens,
    turns: result.turns,
    wallMs: result.wallMs,
    ...(result.spawnMs !== undefined ? { spawnMs: result.spawnMs } : {}),
    transcriptPath,
  };
  logCall(entry, opts.logPath);
  return result;
}
