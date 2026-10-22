// Cost, token, turn and wall-time accounting per LLM call (PLAN P10), appended as JSONL.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TokenUsage } from '@fiks/interfaces';
import type { LlmFailure } from './classify.ts';

export type { TokenUsage };

export type LlmOutcome = 'ok' | 'model_error' | 'infra_error' | 'cap';

export interface LlmCallLog {
  ts: string;
  fn: 'complete' | 'agentSession' | 'ollamaChat' | 'ollamaToolLoop';
  model: string;
  label?: string;
  runKey?: string;
  outcome: LlmOutcome;
  failure?: LlmFailure;
  attempts: number;
  /** api_retry events (429/overload/5xx) seen inside the Claude Code process. */
  retryEvents: number;
  costUsd: number;
  tokens: TokenUsage;
  turns: number;
  wallMs: number;
  /** query() call to the init message: process spawn overhead. */
  spawnMs?: number;
  transcriptPath?: string;
}

export const zeroTokens = (): TokenUsage => ({ in: 0, out: 0, cacheRead: 0, cacheCreate: 0 });

export function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    in: a.in + b.in,
    out: a.out + b.out,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheCreate: a.cacheCreate + b.cacheCreate,
  };
}

interface ModelUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

/** Sums `modelUsage` (every model call of the query, incl. subagents); falls back to `usage`. */
export function tokensFromResult(r: {
  modelUsage?: Record<string, ModelUsageLike>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
}): TokenUsage {
  const mu = Object.values(r.modelUsage ?? {});
  if (mu.length > 0) {
    return mu.reduce<TokenUsage>(
      (t, m) =>
        addTokens(t, {
          in: m.inputTokens ?? 0,
          out: m.outputTokens ?? 0,
          cacheRead: m.cacheReadInputTokens ?? 0,
          cacheCreate: m.cacheCreationInputTokens ?? 0,
        }),
      zeroTokens(),
    );
  }
  const u = r.usage ?? {};
  return {
    in: u.input_tokens ?? 0,
    out: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheCreate: u.cache_creation_input_tokens ?? 0,
  };
}

/** Appends one line to `path`, or to $FIKS_LLM_LOG when no path is given; no-op when neither is set. */
export function logCall(entry: LlmCallLog, path: string | undefined = process.env.FIKS_LLM_LOG): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}
