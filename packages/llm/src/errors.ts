// Error types of the LLM route (PLAN P10, P14; 9.3 infra-error policy).

import type { LlmFailure } from './classify.ts';

/** Thrown by every LLM entry point when FIKS_LLM_FORBID=1 (`pnpm exp --dry`, INTEG's dry run). */
export class LlmForbiddenError extends Error {
  override name = 'LlmForbiddenError';
  constructor(readonly entry: string) {
    super(`LLM call refused: FIKS_LLM_FORBID=1 is set (${entry}); no Claude or ollama call may run here`);
  }
}

/** A subscription usage cap was hit. Never retried; the caller pauses until `resetAt` (A1/R4 cap-stop). */
export class LlmCapError extends Error {
  override name = 'LlmCapError';
  constructor(
    readonly failure: Extract<LlmFailure, { kind: 'cap' }>,
    readonly attempts: number,
  ) {
    super(`usage cap reached${failure.resetAt ? ` (resets ${failure.resetAt})` : ''}: ${failure.message}`);
  }
}

/** Transport, 429, overload or 5xx after all retries: graded `infra_error`, never a model failure. */
export class LlmInfraError extends Error {
  override name = 'LlmInfraError';
  readonly infraError = true;
  constructor(
    readonly failure: LlmFailure,
    readonly attempts: number,
  ) {
    super(`infra_error after ${attempts} attempt(s) [${failure.kind}]: ${failure.message}`);
  }
}

/** The model answered but the answer is unusable (bad JSON, schema mismatch, max turns): a model outcome. */
export class LlmOutputError extends Error {
  override name = 'LlmOutputError';
  constructor(
    message: string,
    readonly text: string,
  ) {
    super(message);
  }
}

/** Misconfiguration found before any call (e.g. no OAuth token, a web tool without allowWebTools). */
export class LlmConfigError extends Error {
  override name = 'LlmConfigError';
}

export const FORBID_ENV = 'FIKS_LLM_FORBID';

/** Throws LlmForbiddenError when FIKS_LLM_FORBID=1. Called first by every entry point, before any I/O. */
export function assertLlmAllowed(entry: string, env: NodeJS.ProcessEnv = process.env): void {
  if (env[FORBID_ENV] === '1') throw new LlmForbiddenError(entry);
}
