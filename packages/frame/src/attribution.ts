// Drift attribution, the frozen trace and its IV sidecar (PLAN 3.0 round 6/7, 7 P20, Appendix
// `FrozenTrace`). A violation of property p on call c is drift-attributable iff p's verdict on
// c's v1 control is `verified`. Pure functions over recorded receipts; nothing is evaluated here.
import type { HttpExchange, Recording, ToolContract, Verdict, Violation } from '@fiks/contracts';
import type { IvExclusion, RerecordProfile } from '@fiks/interfaces';
import { wildcard } from './paths.ts';
import { callEvent, type DetCallRecord } from './records.ts';
import { perPropertyVerdicts } from './verdicts.ts';

export interface ReceiptLike {
  verdict: Verdict;
  contractId: string | null;
  checked: string[];
  violations: Violation[];
}

/** The receipt the log-only proxy logged for this call (null under `--monitor none`). */
export function receiptOf(rec: Pick<DetCallRecord, 'events'>): ReceiptLike | null {
  const r = callEvent(rec)?.receipt as ReceiptLike | undefined;
  return r && Array.isArray(r.checked) && Array.isArray(r.violations) ? r : null;
}

/** True when the record holds a read-back probe. */
export const hasProbe = (rec: Pick<DetCallRecord, 'events'>): boolean =>
  callEvent(rec)?.probe !== undefined || rec.events.some((e) => e.type === 'probe');

export function verdictsOf(
  rec: Pick<DetCallRecord, 'events'>,
  contract: ToolContract | null | undefined,
): Record<string, Verdict> {
  return perPropertyVerdicts(receiptOf(rec), contract, { probeRecorded: hasProbe(rec) });
}

/** A record's label for a concrete path: exact, then wildcard, then the whole output. */
export function labelAt(table: Record<string, string>, at: string | null | undefined): string {
  if (at !== null && at !== undefined) {
    const hit = table[at] ?? table[wildcard(at)];
    if (hit !== undefined) return hit;
  }
  return table[''] ?? table.$ ?? 'unknown';
}

/** The entity behind an origin unit, or null for collection-level units (S-grid queries etc.). */
export const entityOfUnit = (unit: string): string | null =>
  /^(query|order|issue):/.test(unit) || unit.includes('#') || unit === 'unknown' ? null : unit;

export interface NonAttributableRow {
  callId: string;
  controlCallId: string | null;
  drift: string | null;
  mutant: string | null;
  stratum: string;
  tool: string;
  property: string;
  path: string;
  entity: string | null;
  originUnit: string;
  entityClass: string;
  controlVerdict: Verdict;
}

export interface CallAttribution {
  callId: string;
  controlCallId: string | null;
  /** The receipt's full violated list, in receipt order. */
  violated: Violation[];
  /** Violated property ids (unique, receipt order) that verify on the control. */
  attributable: string[];
  /** One row per violation whose property does not verify on the control. */
  nonattributable: NonAttributableRow[];
}

/** Attribution of one drift/benign/mutant call against its v1 control (missing control: none). */
export function attributeCall(
  call: DetCallRecord,
  control: DetCallRecord | undefined,
  contract: ToolContract | null | undefined,
): CallAttribution {
  const violated = receiptOf(call)?.violations ?? [];
  const controlVerdicts = control ? verdictsOf(control, contract) : {};
  const attributable: string[] = [];
  const nonattributable: NonAttributableRow[] = [];
  for (const v of violated) {
    const cv: Verdict = controlVerdicts[v.propertyId] ?? 'unverifiable';
    if (cv === 'verified') {
      if (!attributable.includes(v.propertyId)) attributable.push(v.propertyId);
      continue;
    }
    const unit = labelAt(call.originUnit, v.path);
    nonattributable.push({
      callId: call.callId,
      controlCallId: control?.callId ?? null,
      drift: call.drift,
      mutant: call.mutant,
      stratum: call.stratum,
      tool: call.tool,
      property: v.propertyId,
      path: v.path,
      entity: entityOfUnit(unit),
      originUnit: unit,
      entityClass: labelAt(call.entityClass, v.path),
      controlVerdict: cv,
    });
  }
  return {
    callId: call.callId,
    controlCallId: control?.callId ?? null,
    violated,
    attributable,
    nonattributable,
  };
}

export interface DetectionSummary {
  driftId: string | null;
  kind: string;
  detected: boolean;
  calls: number;
  controls: number;
  /** Calls with >= 1 violated verdict (attributable or not). */
  violatedCalls: number;
  /** Calls with >= 1 drift-attributable violation. */
  attributableCalls: number;
  nonattributableViolations: number;
  first: { callId: string; seq: number; attributable: string[] } | null;
}

export function summarize(
  driftId: string | null,
  kind: string,
  calls: DetCallRecord[],
  controls: number,
  attributions: CallAttribution[],
): DetectionSummary {
  const byId = new Map(calls.map((c) => [c.callId, c]));
  const seq = (a: CallAttribution) => byId.get(a.callId)?.seq ?? Number.MAX_SAFE_INTEGER;
  const first = [...attributions].sort((a, b) => seq(a) - seq(b)).find((a) => a.attributable.length > 0);
  const firstCall = first ? byId.get(first.callId) : undefined;
  return {
    driftId,
    kind,
    detected: first !== undefined,
    calls: calls.length,
    controls,
    violatedCalls: attributions.filter((a) => a.violated.length > 0).length,
    attributableCalls: attributions.filter((a) => a.attributable.length > 0).length,
    nonattributableViolations: attributions.reduce((n, a) => n + a.nonattributable.length, 0),
    first:
      first && firstCall
        ? { callId: first.callId, seq: firstCall.seq, attributable: first.attributable }
        : null,
  };
}

/** The `<trace>.iv.json` sidecar (round 6): never shown to an agent; its sha256 enters F9. */
export interface IvSidecar {
  driftId: string;
  callId: string;
  controlCallId: string;
  attributableProperties: string[];
  /** The triggering tool's contract properties whose verdict on the v1 control is `verified`. */
  ivProperties: string[];
  ivExcluded: IvExclusion[];
  /** sha256 of the agent-visible trace file this sidecar belongs to. */
  traceSha256: string;
}

export function ivSets(
  control: DetCallRecord,
  contract: ToolContract | null | undefined,
): { ivProperties: string[]; ivExcluded: IvExclusion[] } {
  const verdicts = verdictsOf(control, contract);
  const ivProperties: string[] = [];
  const ivExcluded: IvExclusion[] = [];
  for (const [property, controlVerdict] of Object.entries(verdicts)) {
    if (controlVerdict === 'verified') ivProperties.push(property);
    else ivExcluded.push({ property, controlVerdict });
  }
  return { ivProperties, ivExcluded };
}

/** The product trace format (@fiks/repro `Trace`): a Recording plus what it violated. */
export interface FrozenTraceFile extends Recording {
  runId: string;
  contractId: string;
  violated: Violation[];
  target: string[];
  server: { name: string; transport: 'stdio' | 'http'; gitSha?: string };
  profile?: RerecordProfile;
}

export interface TraceMeta {
  driftId: string;
  /** e.g. `shop-mcp`. */
  serverName: string;
  serverCommit: string | null;
  profile: RerecordProfile;
  /** Response header that carries the vendor version (Domain.versionHeader). */
  versionHeader: string;
}

type Pair = Pick<HttpExchange, 'request' | 'response'>;

/** Exchanges with deterministic seq/timing (the frozen clock), as fixtures carry them. */
export const asTraceExchanges = (pairs: readonly Pair[], at: string): HttpExchange[] =>
  pairs.map((p, seq) => ({ seq, startedAt: at, durationMs: 0, request: p.request, response: p.response }));

/**
 * The agent-visible frozen trace: the full receipt `violated` list and `target` = [the first
 * drift-attributable entry of that list] (round 7).
 */
export function frozenTrace(
  call: DetCallRecord,
  attribution: CallAttribution,
  meta: TraceMeta,
): FrozenTraceFile {
  const receipt = receiptOf(call);
  const firstAttributable = attribution.violated.find((v) => attribution.attributable.includes(v.propertyId));
  if (!receipt || !firstAttributable)
    throw new Error(`call ${call.callId} has no drift-attributable violation`);
  const ev = callEvent(call);
  const probe = ev?.probe as
    | { tool: string; args: Record<string, unknown>; result?: Recording['result']; http: Pair[] }
    | undefined;
  const http = asTraceExchanges(call.upstream, call.capturedAt);
  const header = http[0]?.response.headers[meta.versionHeader];
  const id = `tr_${meta.driftId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${call.callId.slice(0, 12)}`;
  return {
    id,
    capturedAt: call.capturedAt,
    runId: `freeze-${meta.driftId}`,
    contractId: receipt.contractId ?? '',
    tool: call.tool,
    args: call.args,
    result: call.output,
    http,
    ...(probe
      ? {
          probe: {
            tool: probe.tool,
            args: probe.args,
            ...(probe.result ? { result: probe.result } : {}),
            http: asTraceExchanges(probe.http, call.capturedAt),
          },
        }
      : {}),
    ...(header !== undefined ? { vendorVersionHeader: header } : {}),
    upstream: { version: meta.profile.base, clock: call.capturedAt },
    violated: attribution.violated,
    target: [firstAttributable.propertyId],
    server: {
      name: meta.serverName,
      transport: 'stdio',
      ...(meta.serverCommit ? { gitSha: meta.serverCommit } : {}),
    },
    profile: meta.profile,
  };
}

/** `<trace>.iv.json` next to `<trace>.json`. */
export const sidecarPath = (tracePath: string): string =>
  tracePath.endsWith('.json') ? `${tracePath.slice(0, -'.json'.length)}.iv.json` : `${tracePath}.iv.json`;
