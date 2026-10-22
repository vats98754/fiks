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
  upstream: HttpExchange[];
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

function exchanges(list: Pick<HttpExchange, 'request' | 'response'>[], at: string): HttpExchange[] {
  return list.map((e, seq) => ({
    seq,
    startedAt: at,
    durationMs: 0,
    request: e.request,
    response: e.response,
  }));
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

/** `probe` is passed separately: a CallRecord carries no read-after-write probe of its own. */
export function fromCallRecord(r: CallRecord, probe?: EvalInput['probe']): GateCase {
  return {
    id: r.callId,
    tool: r.tool,
    args: r.args,
    result: r.output,
    upstream: exchanges(r.upstream, r.capturedAt),
    probe,
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
