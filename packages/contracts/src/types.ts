// Outcome contracts for MCP tools. Dependency-free: this file and evaluate.ts are vendored
// byte-for-byte into the shop-mcp test suite by scripts/sync-contracts.mjs.

export type Verdict = 'verified' | 'violated' | 'unverifiable';

/** Dotted path with `[*]` for "every array element", e.g. `items[*].price`. */
export type Path = string;

/**
 * Optional on every contract property (round 6). A disabled property is not evaluated: it is
 * listed under `EvalResult.disabled`, never in `checked`, unless `EvalOptions.reenable` names it.
 * Set only by `scripts/contract-disable.mjs`.
 */
export interface PropertyFlags {
  disabled?: true;
  disabledReason?: string;
}

/** Operators for `crossField`. */
export type CrossFieldOp = '==' | '!=' | '<' | '<=' | '>' | '>=';

export type Invariant = PropertyFlags &
  (
    | { id: string; kind: 'range'; path: Path; min?: number; max?: number; unit?: string }
    | { id: string; kind: 'notNull'; path: Path; onlyKnownGood?: boolean }
    | { id: string; kind: 'nonEmpty'; path: Path; onlyKnownGood?: boolean }
    | { id: string; kind: 'countMatchesTotal'; itemsPath: Path; totalPath: Path }
    | { id: string; kind: 'freshness'; path: Path; maxAgeDays: number; maxFutureDays?: number }
    /**
     * The tool must report what the upstream said: `path` equals `upstreamPath` in the first
     * upstream JSON response. `compare: 'instant'` compares timestamps (ISO-8601 or epoch ms)
     * as the same point in time.
     */
    | { id: string; kind: 'equalsUpstream'; path: Path; upstreamPath: Path; compare?: 'json' | 'instant' }
    /** No two values at `path` are equal (e.g. no duplicated items). */
    | { id: string; kind: 'unique'; path: Path }
    /**
     * Closed-world enum: every value at `path` is one of `values` (JSON equality); an unknown
     * value is a violation. Absent and null values are skipped (that is `notNull`'s job).
     */
    | { id: string; kind: 'enum'; path: Path; values: unknown[]; onlyKnownGood?: boolean }
    /**
     * A relation between two fields of the same object: for every object at `path` (the
     * structured result when omitted), `left op right`, both relative to that object. Two numbers
     * compare numerically (`==`/`!=` within `tolerance`, default 0); a timestamp string against a
     * timestamp (ISO-8601 or epoch ms) compares as instants; anything else by JSON equality
     * (`==`/`!=` only, otherwise not comparable). Objects missing either side are skipped.
     */
    | {
        id: string;
        kind: 'crossField';
        path?: Path;
        left: Path;
        op: CrossFieldOp;
        right: Path;
        tolerance?: number;
      }
    /**
     * The tool read every upstream page: of this call's 2xx JSON upstream responses that carry
     * `upstreamCursorPath` (e.g. `next_cursor`, `has_more`), the last one says there is no more
     * (null, absent, false or ''). Skipped when no upstream response carries it.
     */
    | { id: string; kind: 'pageComplete'; upstreamCursorPath: Path }
  );

export type InvariantKind = Invariant['kind'];

/** After a mutating call, call `probeTool` and check that it reads back what was written. */
export interface ReadAfterWrite extends PropertyFlags {
  id: 'readAfterWrite';
  probeTool: string;
  /** Probe argument name -> path into the mutating call's structured result. */
  probeArgs: Record<string, Path>;
  expect: { probePath: Path; equalsResultPath: Path }[];
  /**
   * The read-back must come from the upstream, not from the tool's own memory: some upstream
   * response during the probe is 2xx and its JSON `idPath` equals the write's `equalsResultPath`.
   * Checked whenever the probe's upstream exchanges are known.
   */
  upstream?: { idPath: Path; equalsResultPath: Path };
}

export interface ToolContract {
  /** e.g. `shop.get_product` */
  id: string;
  tool: string;
  /** Overrides the tool's declared outputSchema when set. */
  outputSchema?: JsonSchema;
  invariants: Invariant[];
  postconditions?: ReadAfterWrite[];
  /** Inputs for which the tool is known to have real data (used by `onlyKnownGood`). */
  knownGoodInputs?: Record<string, unknown>[];
}

export interface ContractFile {
  server: string;
  version: 1;
  contracts: ToolContract[];
}

export interface Violation {
  /** `${contract.id}/${invariant.id}` */
  propertyId: string;
  kind: string;
  path: string;
  expected: string;
  actual: unknown;
  message: string;
}

export interface EvalResult {
  verdict: Verdict;
  contractId: string | null;
  /** propertyIds that were actually checked. */
  checked: string[];
  violations: Violation[];
  /** propertyIds skipped because the contract marks them `disabled` (present only when non-empty). */
  disabled?: string[];
}

export interface EvalOptions {
  /**
   * Every violating element per invariant (one Violation each, `path` = the element's concrete
   * location) instead of the first. Offline H1 replay only; live receipts never set it.
   */
  perElement?: boolean;
  /** Full property ids (`shop.get_product/price.range`) to evaluate even though they are disabled. */
  reenable?: string[];
}

/** The subset of an MCP CallToolResult that contracts read. */
export interface ToolResultLike {
  content?: unknown[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** The subset of JSON Schema that MCP outputSchema declarations use here. */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  additionalProperties?: boolean | JsonSchema;
  [k: string]: unknown;
}

export interface EvalInput {
  args: unknown;
  result: ToolResultLike;
  now: Date;
  /** The tool's declared outputSchema from tools/list (MCP 2025-11-25). */
  declaredOutputSchema?: JsonSchema;
  /** Result of the read-after-write probe, when the contract declares one. */
  probe?: { tool: string; args: unknown; result: ToolResultLike; upstream?: HttpExchange[] };
  /** Upstream HTTP exchanges caused by this call, in order (for `equalsUpstream`). */
  upstream?: HttpExchange[];
}

/** One upstream HTTP request/response pair, recorded by the fiks HTTP tap. */
export interface HttpExchange {
  seq: number;
  startedAt: string;
  durationMs: number;
  /** `url` is path + query relative to the upstream base, so replays are port-independent. */
  request: { method: string; url: string; headers: Record<string, string>; body: string | null };
  response: { status: number; headers: Record<string, string>; body: string };
}

/** A tool call plus the upstream HTTP it caused. Fixtures and traces share this shape. */
export interface Recording {
  id: string;
  capturedAt: string;
  tool: string;
  args: Record<string, unknown>;
  result?: ToolResultLike;
  http: HttpExchange[];
  probe?: { tool: string; args: Record<string, unknown>; result?: ToolResultLike; http: HttpExchange[] };
  vendorVersionHeader?: string;
  /** For traces: every contract property this call violated when it was captured. */
  violated?: Violation[];
  /**
   * For traces: the violated properties this trace is about (what its fix must repair).
   * Other properties violated at capture (other faults, fixed elsewhere) are not asserted;
   * every property that held at capture must still hold. Default: all of `violated`.
   */
  target?: string[];
  /**
   * Which upstream environment produced the recording; re-recording uses the same one.
   * `clock` is the upstream's frozen time, so a re-recording returns the same timestamps.
   */
  upstream?: { version: string; drifts?: string[]; clock?: string };
}
