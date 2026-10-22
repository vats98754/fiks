// One Agent SDK `query` attempt, observed: spawn overhead, api_retry events, cap events, result.

import type { Options, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { classifyLlmFailure, type LlmFailure, RETRYABLE } from './classify.ts';

export type { Options as QueryOptions, SDKMessage, SDKResultMessage };

/** The SDK's `query`, narrowed to what fiks uses; tests and `probe --dry` inject a fake. */
export type QueryFn = (args: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export interface LlmDeps {
  query?: QueryFn;
  fetch?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export const realQuery: QueryFn = (args) => sdkQuery(args);

export interface AttemptObservation {
  result?: SDKResultMessage;
  failure?: LlmFailure;
  /** The failure is a model outcome (max turns, budget, structured-output retries, timeout after output). */
  modelError?: string;
  spawnMs?: number;
  retryEvents: number;
  rateLimitEvents: number;
  overloadEvents: number;
  capEvents: LlmFailure[];
  hasModelOutput: boolean;
  initTools?: string[];
  initCwd?: string;
  sessionId?: string;
  wallMs: number;
}

const MODEL_OUTCOME_SUBTYPES = new Set([
  'error_max_turns',
  'error_max_budget_usd',
  'error_max_structured_output_retries',
]);

/**
 * Runs one query to completion. Never throws for API/transport problems: they come back as
 * `failure` (classified), so the caller decides on retry, cap-stop or infra_error.
 */
export async function observeQuery(
  q: QueryFn,
  prompt: string,
  options: Options,
  opts: { timeoutMs?: number; onMessage?: (m: SDKMessage) => void; now?: () => Date } = {},
): Promise<AttemptObservation> {
  const now = opts.now ?? (() => new Date());
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = opts.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined;
  const obs: AttemptObservation = {
    retryEvents: 0,
    rateLimitEvents: 0,
    overloadEvents: 0,
    capEvents: [],
    hasModelOutput: false,
    wallMs: 0,
  };
  let lastError: LlmFailure | undefined;
  try {
    for await (const m of q({ prompt, options: { ...options, abortController: controller } })) {
      opts.onMessage?.(m);
      if (m.type === 'system' && m.subtype === 'init') {
        obs.spawnMs ??= Date.now() - t0;
        obs.initTools = m.tools;
        obs.initCwd = m.cwd;
        obs.sessionId = m.session_id;
      } else if (m.type === 'system' && m.subtype === 'api_retry') {
        obs.retryEvents++;
        const f = classifyLlmFailure(m, now());
        if (f.kind === 'rate_limit') obs.rateLimitEvents++;
        if (f.kind === 'overload') obs.overloadEvents++;
        lastError = f;
      } else if (m.type === 'rate_limit_event') {
        if (m.rate_limit_info.status === 'rejected') {
          const f = classifyLlmFailure(m, now());
          obs.capEvents.push(f);
          lastError = f;
        }
      } else if (m.type === 'assistant') {
        if (m.error) {
          const f = classifyLlmFailure(m, now());
          if (f.kind === 'cap') obs.capEvents.push(f);
          lastError = f;
        } else {
          obs.hasModelOutput = true;
        }
      } else if (m.type === 'result') {
        obs.result = m;
      }
    }
  } catch (e) {
    obs.failure = controller.signal.aborted
      ? { kind: 'transport', message: `timeout after ${opts.timeoutMs} ms` }
      : classifyLlmFailure(e, now());
    if (controller.signal.aborted && obs.hasModelOutput) obs.modelError = 'timeout';
  } finally {
    if (timer) clearTimeout(timer);
    obs.wallMs = Date.now() - t0;
  }
  if (obs.failure) {
    if (obs.failure.kind !== 'cap' && obs.capEvents[0]) obs.failure = obs.capEvents[0];
    return obs;
  }
  const r = obs.result;
  if (!r) {
    obs.failure = lastError ?? { kind: 'transport', message: 'query ended without a result message' };
    return obs;
  }
  if (r.subtype === 'success' && !r.is_error) return obs;
  if (MODEL_OUTCOME_SUBTYPES.has(r.subtype)) {
    obs.modelError = r.subtype;
    return obs;
  }
  const fromResult = classifyLlmFailure(r, now());
  if (obs.capEvents[0] && fromResult.kind !== 'cap') obs.failure = obs.capEvents[0];
  else if (fromResult.kind === 'unknown' && lastError) obs.failure = lastError;
  else obs.failure = fromResult;
  return obs;
}

/** Retry rule for one observation (PLAN 9.3): transient kinds only; never caps or model outcomes. */
export function shouldRetry(obs: AttemptObservation, onlyWithoutOutput: boolean): boolean {
  if (!obs.failure || obs.modelError) return false;
  if (onlyWithoutOutput && obs.hasModelOutput) return false;
  return RETRYABLE.has(obs.failure.kind) || obs.failure.kind === 'unknown';
}

export function backoffMs(attempt: number, baseMs: number): number {
  return baseMs * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5);
}

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
