// complete(): one non-agentic LLM call (judges, raters, ideation, contract text) through the Agent
// SDK `query` on the OAuth token (PLAN P14): no tools, our system prompt replaces Claude Code's,
// no filesystem settings, no MCP servers, an empty temp cwd and a scrubbed env.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { LlmFailure } from './classify.ts';
import { freshHome, scrubbedEnv } from './env.ts';
import { assertLlmAllowed, LlmCapError, LlmConfigError, LlmInfraError, LlmOutputError } from './errors.ts';
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
  logCall,
  type TokenUsage,
  tokensFromResult,
  zeroTokens,
} from './usage.ts';

export type JsonSchema = Record<string, unknown>;

export interface CompleteOptions<T> {
  model: string;
  system: string;
  prompt: string;
  /** A zod schema (validated with it) or a JSON Schema object (validated via z.fromJSONSchema). */
  schema?: z.ZodType<T> | JsonSchema;
  /** Structured output can take an extra turn; default 3. */
  maxTurns?: number;
  maxBudgetUsd?: number;
  /** Per attempt; default 10 minutes. */
  timeoutMs?: number;
  /** API-level retries after the first attempt (PLAN 9.3); default 3. */
  retries?: number;
  retryBaseMs?: number;
  label?: string;
  runKey?: string;
  /** JSONL cost log; default $FIKS_LLM_LOG. */
  logPath?: string;
  deps?: LlmDeps;
}

export interface CompleteResult<T> {
  text: string;
  /** Parsed and validated when a schema was given. */
  data: T;
  model: string;
  costUsd: number;
  tokens: TokenUsage;
  turns: number;
  wallMs: number;
  spawnMs?: number;
  attempts: number;
  retryEvents: number;
  sessionId?: string;
}

const isZod = (s: unknown): s is z.ZodType => !!s && typeof (s as z.ZodType).safeParse === 'function';

function toJsonSchema(s: z.ZodType | JsonSchema): JsonSchema {
  if (!isZod(s)) return s;
  const { $schema: _drop, ...rest } = z.toJSONSchema(s) as JsonSchema;
  return rest;
}

/** Text JSON, tolerating a ```json fence or prose around one object/array. */
export function extractJson(text: string): unknown {
  const t = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  const candidates = [t, fenced?.[1]?.trim()];
  const firstObj = t.search(/[{[]/);
  if (firstObj >= 0) {
    const close = t[firstObj] === '{' ? '}' : ']';
    candidates.push(t.slice(firstObj, t.lastIndexOf(close) + 1));
  }
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c);
    } catch {
      // next candidate
    }
  }
  throw new Error('no JSON value found');
}

function validate<T>(schema: z.ZodType<T> | JsonSchema, value: unknown, text: string): T {
  const zs: z.ZodType = isZod(schema)
    ? schema
    : z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
  const r = zs.safeParse(value);
  if (!r.success) throw new LlmOutputError(`output does not match the schema: ${r.error.message}`, text);
  return r.data as T;
}

export function completeQueryOptions(
  opts: Pick<CompleteOptions<unknown>, 'model' | 'system' | 'schema' | 'maxTurns' | 'maxBudgetUsd'>,
  env: Record<string, string>,
  cwd: string,
): QueryOptions {
  return {
    model: opts.model,
    systemPrompt: opts.system,
    tools: [],
    allowedTools: [],
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: {},
    permissionMode: 'dontAsk',
    persistSession: false,
    maxTurns: opts.maxTurns ?? 3,
    ...(opts.maxBudgetUsd !== undefined ? { maxBudgetUsd: opts.maxBudgetUsd } : {}),
    ...(opts.schema ? { outputFormat: { type: 'json_schema', schema: toJsonSchema(opts.schema) } } : {}),
    cwd,
    env,
  };
}

export async function complete<T = string>(opts: CompleteOptions<T>): Promise<CompleteResult<T>> {
  assertLlmAllowed('complete');
  const home = freshHome();
  const cwd = mkdtempSync(join(tmpdir(), 'fiks-llm-complete-'));
  try {
    return await completeIn(opts, home, cwd);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function completeIn<T>(
  opts: CompleteOptions<T>,
  home: string,
  cwd: string,
): Promise<CompleteResult<T>> {
  const q = opts.deps?.query ?? realQuery;
  const sleep = opts.deps?.sleep ?? defaultSleep;
  const env = scrubbedEnv({ home, requireToken: !opts.deps?.query });
  const options = completeQueryOptions(opts, env, cwd);
  const retries = opts.retries ?? 3;
  const t0 = Date.now();
  let attempts = 0;
  let retryEvents = 0;
  let cost = 0;
  let tokens = zeroTokens();
  let obs: AttemptObservation | undefined;
  const log = (outcome: LlmCallLog['outcome'], failure?: LlmFailure) =>
    logCall(
      {
        ts: new Date().toISOString(),
        fn: 'complete',
        model: opts.model,
        ...(opts.label ? { label: opts.label } : {}),
        ...(opts.runKey ? { runKey: opts.runKey } : {}),
        outcome,
        ...(failure ? { failure } : {}),
        attempts,
        retryEvents,
        costUsd: cost,
        tokens,
        turns: obs?.result?.num_turns ?? 0,
        wallMs: Date.now() - t0,
        ...(obs?.spawnMs !== undefined ? { spawnMs: obs.spawnMs } : {}),
      },
      opts.logPath,
    );
  for (;;) {
    attempts++;
    obs = await observeQuery(q, opts.prompt, options, {
      timeoutMs: opts.timeoutMs ?? 600_000,
      ...(opts.deps?.now ? { now: opts.deps.now } : {}),
    });
    retryEvents += obs.retryEvents;
    if (obs.result) {
      cost += obs.result.total_cost_usd ?? 0;
      tokens = addTokens(tokens, tokensFromResult(obs.result));
    }
    if (!obs.failure || obs.modelError) break;
    if (obs.failure.kind === 'cap') {
      log('cap', obs.failure);
      throw new LlmCapError(obs.failure, attempts);
    }
    if (obs.failure.kind === 'auth' || obs.failure.kind === 'forbidden') {
      log('infra_error', obs.failure);
      throw new LlmConfigError(`${obs.failure.kind}: ${obs.failure.message}`);
    }
    if (!shouldRetry(obs, false) || attempts > retries) {
      log('infra_error', obs.failure);
      throw new LlmInfraError(obs.failure, attempts);
    }
    await sleep(backoffMs(attempts, opts.retryBaseMs ?? 2000));
  }
  const r = obs.result;
  const text = r && r.subtype === 'success' ? r.result : '';
  if (obs.modelError) {
    log('model_error', { kind: 'unknown', message: obs.modelError });
    throw new LlmOutputError(`model outcome: ${obs.modelError}`, text);
  }
  let data: unknown = text;
  if (opts.schema) {
    try {
      const structured = r && r.subtype === 'success' ? r.structured_output : undefined;
      data = validate(opts.schema, structured ?? extractJson(text), text);
    } catch (e) {
      log('model_error', { kind: 'unknown', message: (e as Error).message.slice(0, 300) });
      throw e instanceof LlmOutputError
        ? e
        : new LlmOutputError(`unparseable JSON: ${(e as Error).message}`, text);
    }
  }
  log('ok');
  return {
    text,
    data: data as T,
    model: opts.model,
    costUsd: cost,
    tokens,
    turns: r?.num_turns ?? 0,
    wallMs: Date.now() - t0,
    ...(obs.spawnMs !== undefined ? { spawnMs: obs.spawnMs } : {}),
    attempts,
    retryEvents,
    ...(obs.sessionId ? { sessionId: obs.sessionId } : {}),
  };
}
