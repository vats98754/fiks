// Gate inputs. ORCH hands the gate product-format traces (`Recording`, e.g. the frozen trace and
// the stored traces under `test/repro/`), CallRecords (the clean v1 corpus, MUT variants) or
// already-normalised GateCases. All three become one GateCase, which `evaluate` reads.
import type { EvalInput, HttpExchange, JsonSchema, Recording, ToolResultLike } from '@fiks/contracts';
import type { CallRecord } from '@fiks/interfaces';

export interface GateCase {
  /** Recording id or CallRecord callId; names the case in reasons. */
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** The tool's output. Absent = the case cannot be evaluated (the gate fails closed). */
  result?: ToolResultLike;
  /** Upstream exchanges of the call. Absent = the upstream was not observed (as MON passes it). */
  upstream?: HttpExchange[];
  probe?: EvalInput['probe'];
  /** ISO instant used as the evaluation `now` (the capture instant, never the system clock). */
  now: string;
  /** For stored traces: the property ids the trace is about. */
  target?: string[];
  /** MUT operator id (e.g. `M5`) for mutation variants. */
  mutant?: string | null;
}

export type GateInput = GateCase | Recording | CallRecord;

const isCallRecord = (x: GateInput): x is CallRecord => 'callId' in x && 'output' in x;
const isRecording = (x: GateInput): x is Recording => 'http' in x && Array.isArray(x.http);

/**
 * Paper-format upstream pairs carry no seq/timing; the proxy's own exchanges (a probe's `http`)
 * do. Fields present are kept, as MON's `asExchanges` keeps them; replay needs only request and
 * response.
 */
function exchanges(list: Pick<HttpExchange, 'request' | 'response'>[], at: string): HttpExchange[] {
  return list.map((e, seq) => {
    const x = e as Partial<HttpExchange>;
    return {
      seq: x.seq ?? seq,
      startedAt: x.startedAt ?? at,
      durationMs: x.durationMs ?? 0,
      request: e.request,
      response: e.response,
    };
  });
}

export function fromRecording(r: Recording): GateCase {
  return {
    id: r.id,
    tool: r.tool,
    args: r.args,
    result: r.result,
    upstream: r.http,
    probe: r.probe?.result
      ? { tool: r.probe.tool, args: r.probe.args, result: r.probe.result, upstream: r.probe.http }
      : undefined,
    now: r.capturedAt,
    target: r.target ?? r.violated?.map((v) => v.propertyId),
    mutant: null,
  };
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => x !== null && typeof x === 'object' && !Array.isArray(x);

/**
 * Whether the call's upstream was observed, read as MON's `normalizeRecord` reads it: the record's
 * own `upstreamObserved`, else its proxy event's, else true (record runs always tap the upstream).
 */
function upstreamObserved(r: Obj, ev: Obj | undefined): boolean {
  if (typeof r.upstreamObserved === 'boolean') return r.upstreamObserved;
  if (typeof ev?.upstreamObserved === 'boolean') return ev.upstreamObserved;
  return true;
}

/**
 * The read-after-write probe of a CallRecord, taken where MON's `normalizeRecord`
 * (packages/proxy/src/replay.ts) takes it: `probe` on the record, else on its proxy event (the
 * `events[]` entry with `type: 'call'`). The probe's upstream (`http`) is passed only when the
 * upstream was observed, as `replayRecord` does. A probe without a tool or a result is no probe.
 */
export function callRecordProbe(r: CallRecord): EvalInput['probe'] {
  const raw = r as unknown as Obj;
  const ev = Array.isArray(r.events) ? r.events.find((e) => isObj(e) && e.type === 'call') : undefined;
  const p = raw.probe ?? ev?.probe;
  if (!isObj(p) || typeof p.tool !== 'string' || !isObj(p.result)) return undefined;
  const http = Array.isArray(p.http) ? (p.http as Pick<HttpExchange, 'request' | 'response'>[]) : [];
  return {
    tool: p.tool,
    args: isObj(p.args) ? p.args : {},
    result: p.result as ToolResultLike,
    upstream: upstreamObserved(raw, ev) ? exchanges(http, r.capturedAt) : undefined,
  };
}

/**
 * A CallRecord's probe is its own (`callRecordProbe`); pass `probe` only to override it. When
 * the record's upstream was not observed (`upstreamObserved: false`), no upstream is passed.
 */
export function fromCallRecord(r: CallRecord, probe?: EvalInput['probe']): GateCase {
  const raw = r as unknown as Obj;
  const ev = Array.isArray(r.events) ? r.events.find((e) => isObj(e) && e.type === 'call') : undefined;
  return {
    id: r.callId,
    tool: r.tool,
    args: r.args,
    result: r.output,
    upstream: upstreamObserved(raw, ev) ? exchanges(r.upstream, r.capturedAt) : undefined,
    probe: probe ?? callRecordProbe(r),
    now: r.capturedAt,
    mutant: r.mutant,
  };
}

export function toGateCase(x: GateInput): GateCase {
  if (isCallRecord(x)) return fromCallRecord(x);
  if (isRecording(x)) return fromRecording(x);
  return x;
}

/**
 * The server's declared outputSchemas from `tools/list`, by tool name. `null` = the tool declares
 * none. The live proxy checks `<contract>/outputSchema` against these (proxy.ts, `schemas`), so the
 * gate applies the same schema to every case; a tool absent from the map makes the gate fail closed.
 */
export type DeclaredOutputSchemas = Record<string, JsonSchema | null>;

/** Builds the map from a `tools/list` result (tools without an outputSchema map to `null`). */
export function declaredOutputSchemas(
  tools: { name: string; outputSchema?: JsonSchema }[],
): DeclaredOutputSchemas {
  const out: DeclaredOutputSchemas = {};
  for (const t of tools) out[t.name] = t.outputSchema ?? null;
  return out;
}

export function evalInput(
  c: GateCase & { result: ToolResultLike },
  declaredOutputSchema?: JsonSchema,
): EvalInput {
  return {
    args: c.args,
    result: c.result,
    now: new Date(c.now),
    declaredOutputSchema,
    probe: c.probe,
    upstream: c.upstream,
  };
}
