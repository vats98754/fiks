// Shared types of the section 6.1 detection baselines (paper/PLAN.md). Every baseline is a Monitor
// (packages/interfaces) so DET can run it over the same CallRecords as the contract evaluator.
import type { Monitor, MonitorInput, MonitorResult } from '@fiks/interfaces';

/** Token counts of one LLM call, as LLMR's complete() reports them. */
export interface LlmTokens {
  in: number;
  out: number;
  cacheRead?: number;
  cacheCreate?: number;
}

export interface LlmRequest {
  model: string;
  system: string;
  prompt: string;
  /** JSON schema of the expected answer (LLMR passes it to the model as the output format). */
  schema?: Record<string, unknown>;
}

export interface LlmResponse {
  /** The model's answer as text (JSON expected). */
  text: string;
  tokens: LlmTokens;
  costUsd: number;
}

/**
 * The injected LLM route (LLMR `complete`, or a stub in tests). Baselines never import an SDK for
 * model calls, so a run decides the route and `FIKS_LLM_FORBID` applies.
 */
export type LlmFn = (req: LlmRequest) => Promise<LlmResponse>;

/** A Monitor with a required detector id (the DetectorVerdictRow `detector` value). */
export interface BaselineMonitor extends Monitor {
  readonly id: string;
  /** True when the verdict on a call depends on earlier calls (windowed detectors). */
  readonly stateful?: boolean;
  /** Clears any window or history; called before each independent replay. */
  reset?(): void;
}

/** A baseline that answers synchronously (every deterministic baseline except B-SCHEMA). */
export interface SyncBaselineMonitor {
  (input: MonitorInput): MonitorResult;
  readonly id: string;
  readonly stateful?: boolean;
  reset?(): void;
}

/** A MonitorResult plus baseline-specific details that DetectorVerdictRows carry. */
export interface BaselineResult extends MonitorResult {
  confidence?: number | null;
}
