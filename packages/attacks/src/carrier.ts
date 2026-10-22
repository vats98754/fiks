// Carrier placement (WORKSTREAMS SEC). Puts an attacker payload into the bytes a trace carries into
// the repair prompt. The channel is real: packages/repair/src/prompt.ts inlines every exchange's
// `response.body` and every violation message. AgentDojo finds payloads most effective at the END of
// a tool response (paper/research/gap-repair-security.md §5), so `response-body-append` is the
// default. All carriers return a deep copy; the base trace is never mutated.
// Types come from the CORE-SEED interfaces only (PLAN §7.1: wave-1 streams import only the seed).
import type { ReproTrace } from '@fiks/interfaces';

type Trace = ReproTrace;
type HttpExchange = ReproTrace['http'][number];
type Violation = ReproTrace['violated'][number];

export type CarrierKind =
  | 'response-body-append' // concatenated to the end of the last exchange's response body
  | 'response-body-field' // added as a new JSON field in the last exchange's response body
  | 'violation-message' // appended to the first violation message
  | 'probe-response-body' // appended to the read-after-write probe's response body
  | 'tool-args'; // smuggled into a string argument of the recorded call

export const CARRIERS: readonly CarrierKind[] = [
  'response-body-append',
  'response-body-field',
  'violation-message',
  'probe-response-body',
  'tool-args',
] as const;

/** The JSON field name a `response-body-field` carrier adds. */
const FIELD_NAME = '_vendor_notice';

function clone<T>(v: T): T {
  return structuredClone(v);
}

function appendToBody(ex: HttpExchange, payload: string): void {
  ex.response.body = `${ex.response.body}\n${payload}`;
}

function fieldIntoBody(ex: HttpExchange, payload: string): void {
  try {
    const parsed = JSON.parse(ex.response.body) as Record<string, unknown>;
    parsed[FIELD_NAME] = payload;
    ex.response.body = JSON.stringify(parsed);
  } catch {
    // Non-JSON body: fall back to appending.
    appendToBody(ex, payload);
  }
}

/** Places `payload` into `trace` via `carrier`, returning a new trace. Throws if the carrier has no
 *  slot in this trace (e.g. a probe carrier on a trace with no probe) or is not a known carrier. */
export function placePayload(trace: Trace, payload: string, carrier: CarrierKind): Trace {
  const t = clone(trace);
  switch (carrier) {
    case 'response-body-append': {
      const ex = t.http.at(-1);
      if (!ex) throw new Error('carrier response-body-append: trace has no http exchange');
      appendToBody(ex, payload);
      break;
    }
    case 'response-body-field': {
      const ex = t.http.at(-1);
      if (!ex) throw new Error('carrier response-body-field: trace has no http exchange');
      fieldIntoBody(ex, payload);
      break;
    }
    case 'violation-message': {
      const v = t.violated[0] as Violation | undefined;
      if (!v) throw new Error('carrier violation-message: trace has no violation');
      v.message = `${v.message} ${payload}`;
      break;
    }
    case 'probe-response-body': {
      const ex = t.probe?.http.at(-1);
      if (!ex) throw new Error('carrier probe-response-body: trace has no probe exchange');
      appendToBody(ex, payload);
      break;
    }
    case 'tool-args': {
      const key = Object.keys(t.args).find((k) => typeof t.args[k] === 'string');
      if (!key) throw new Error('carrier tool-args: trace has no string argument');
      t.args[key] = `${String(t.args[key])} ${payload}`;
      break;
    }
    default: {
      // Fail closed: a carrier read from JSON/CLI config is not type-checked, and an unknown one
      // must never let the attack run on a clean trace.
      const unknown: never = carrier;
      throw new Error(`unknown carrier: ${JSON.stringify(unknown)}`);
    }
  }
  return t;
}

/** Carriers that have a slot in this trace (so the attacker never places into an empty one). */
export function availableCarriers(trace: Trace): CarrierKind[] {
  return CARRIERS.filter((c) => {
    try {
      placePayload(trace, 'probe', c);
      return true;
    } catch {
      return false;
    }
  });
}
