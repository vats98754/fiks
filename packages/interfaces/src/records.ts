// Recorded traffic, frames, frozen traces and detector verdicts (PLAN.md Appendix, 3.1, 5.7, P9).
import type { HttpExchange, ToolResultLike, Verdict, Violation } from '@fiks/contracts';

export type Catalog = 'original' | 'extended-only' | 'all';

/** Dotted contract path with `[*]` for array elements, e.g. `items[*].price`. */
export type PropertyPath = string;

/** One recorded tool call with its upstream exchanges and labels. */
export interface CallRecord {
  callId: string;
  domain: string;
  /** e.g. `realistic`, `evasive`, `S12`, `benign`, `frame`, `dev`. */
  stratum: string;
  catalog: Catalog;
  drift: string | null;
  mutant: string | null;
  tool: string;
  args: Record<string, unknown>;
  /** Raw upstream request/response pairs, in order. */
  upstream: Pick<HttpExchange, 'request' | 'response'>[];
  /** The tool's output exactly as the server returned it. */
  output: ToolResultLike;
  /** Proxy/harness events for this call (receipts, monitor ids, latencies). */
  events: Record<string, unknown>[];
  /** Entity class per property path (Domain.entityClass). */
  entityClass: Record<PropertyPath, string>;
  /** Origin unit per property path (Domain.originEntity). */
  originUnit: Record<PropertyPath, string>;
  /** ISO instant = the proxy's evaluation `now` (= Domain.frozenClock in record runs). */
  capturedAt: string;
  /** callId of the drift/benign call this v1 control mirrors, else null. */
  controlOf: string | null;
}

/** One enumerated input (`fiks enumerate`). */
export interface EnumRow {
  domain: string;
  stratum: string;
  tool: string;
  args: Record<string, unknown>;
  dedupeKey: string;
}

export interface FrameEntity {
  id: string;
  domain: string;
  authorBatch: string;
  eligible: boolean;
}

export interface FrameCell {
  contract: string;
  property: string;
  class: string;
  nInputs: number;
}

export interface NeRule {
  topUpBatches: number;
  underpowered: boolean;
  m: number;
}

/** The H1 frame F, frozen at F4b (PLAN 3.1, 5.7). */
export interface FrameSpec {
  domain: string[];
  nF: number;
  /** Ids of the eligible inputs (EnumRow dedupe keys). */
  eligibleInputs: string[];
  entities: FrameEntity[];
  NE: number;
  /** inputId -> property path -> originUnit. */
  attribution: Record<string, Record<PropertyPath, string>>;
  /** property id -> family. */
  families: Record<string, string>;
  cells: FrameCell[];
  K: number;
  entailedProps: string[];
  neRule: NeRule;
  /** Critical value of the pre-registered test. */
  crit: number;
  power: { pi01: number; pi005: number };
  hash: string;
}

export interface IvExclusion {
  property: string;
  controlVerdict: Verdict;
}

/**
 * The frozen trace of one drift. `violated` and `target` are in the agent-visible trace (as in
 * the product format); the round-6 fields live only in the `<trace>.iv.json` sidecar.
 */
export interface FrozenTrace {
  driftId: string;
  callId: string;
  path: string;
  sha256: string;
  /** The full receipt list. */
  violated: Violation[];
  /** [first drift-attributable entry of `violated`] (property ids). */
  target: string[];
  controlCallId: string;
  attributableProperties: string[];
  /** The triggering tool's properties whose verdict on the v1 control is `verified`. */
  ivProperties: string[];
  ivExcluded: IvExclusion[];
  ivSidecarSha256: string;
}

/** One detector verdict on one CallRecord (offline replay, E3/H1). */
export interface DetectorVerdictRow {
  callId: string;
  domain: string;
  drift: string | null;
  stratum: string;
  entityClass: string;
  originUnit: string;
  detector: string;
  verdict: Verdict;
  property: string | null;
  /** Path of the violating element (`replay-cli --per-element` rows only). */
  at: string | null;
  /** Index of the violating element (`replay-cli --per-element` rows only). */
  elementIndex: number | null;
  confidence: number | null;
  tokens: number | null;
  costUsd: number | null;
}
