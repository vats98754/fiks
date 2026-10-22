// Small pure helpers shared by the baselines: JSON leaves, canonical keys, CallRecord -> MonitorInput.
import { createHash } from 'node:crypto';
import type { HttpExchange, ToolContract, ToolResultLike } from '@fiks/contracts';
import type { CallRecord, MonitorInput, MonitorOptions, MonitorToolDef } from '@fiks/interfaces';

export type JsonType = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';

export function jsonType(v: unknown): JsonType {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'number' || t === 'string' || t === 'boolean') return t;
  return 'object';
}

/** JSON with sorted object keys, so equal values give equal strings. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, sortKeys(o[k])]),
    );
  }
  return v;
}

/** The tool's data: structuredContent, else the first text block parsed as JSON, else undefined. */
export function resultData(result: ToolResultLike | undefined): unknown {
  if (!result) return undefined;
  if (result.structuredContent !== undefined) return result.structuredContent;
  for (const block of result.content ?? []) {
    const b = block as { type?: string; text?: unknown };
    if (b?.type === 'text' && typeof b.text === 'string') {
      try {
        return JSON.parse(b.text);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export interface Leaf {
  /** Concrete location, e.g. `items[3].price` (`$` for the root). */
  at: string;
  /** Normalised location with `[*]` for array elements, e.g. `items[*].price`. */
  path: string;
  type: JsonType;
  value: unknown;
}

/**
 * Every node of a JSON value, depth first, keys in sorted order. Containers are listed too (with
 * type `object`/`array`), so a field set includes paths whose value is an object or an array.
 */
export function walk(value: unknown): Leaf[] {
  const out: Leaf[] = [];
  const visit = (v: unknown, at: string, path: string) => {
    const type = jsonType(v);
    out.push({ at: at || '$', path: path || '$', type, value: v });
    if (type === 'array') {
      for (const [i, x] of (v as unknown[]).entries()) visit(x, `${at}[${i}]`, `${path}[*]`);
    } else if (type === 'object') {
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o).sort()) {
        if (o[k] === undefined) continue;
        visit(o[k], at ? `${at}.${k}` : k, path ? `${path}.${k}` : k);
      }
    }
  };
  if (value !== undefined) visit(value, '', '');
  return out;
}

/** floor(log10(|x|)); 0 and non-finite numbers get their own buckets. */
export function magnitudeBucket(x: number): number | 'zero' | 'nonfinite' {
  if (!Number.isFinite(x)) return 'nonfinite';
  if (x === 0) return 'zero';
  return Math.floor(Math.log10(Math.abs(x)));
}

/** Stable key for "the same request": tool + canonical args. */
export function callKey(tool: string, args: unknown): string {
  return `${tool} ${canonicalJson(args ?? {})}`;
}

/**
 * The read-after-write probe of a mutating call. CallRecord has no probe field: recorders put it
 * in `events` as `{ type: 'probe', tool, args, result, http? }` (the proxy's `probe` shape).
 */
export function probeOf(rec: CallRecord): MonitorInput['probe'] {
  const ev = rec.events.find((e) => e.type === 'probe');
  if (!ev) return undefined;
  const http = Array.isArray(ev.http) ? (ev.http as HttpExchange[]) : undefined;
  return {
    tool: String(ev.tool),
    args: ev.args,
    result: (ev.result ?? {}) as ToolResultLike,
    upstream: http ? toExchanges(http, rec.capturedAt) : undefined,
  };
}

type LooseExchange = Pick<HttpExchange, 'request' | 'response'> & Partial<HttpExchange>;

function toExchanges(xs: LooseExchange[], at: string): HttpExchange[] {
  return xs.map((x, i) => ({
    seq: typeof x.seq === 'number' ? x.seq : i,
    startedAt: typeof x.startedAt === 'string' ? x.startedAt : at,
    durationMs: typeof x.durationMs === 'number' ? x.durationMs : 0,
    request: x.request,
    response: x.response,
  }));
}

/** The MonitorInput for one CallRecord. Offline, `now` is the record's capturedAt (never the clock). */
export function toMonitorInput(
  rec: CallRecord,
  ctx: { contract?: ToolContract | null; toolDef?: MonitorToolDef | null; opts?: MonitorOptions } = {},
): MonitorInput {
  const now = new Date(rec.capturedAt);
  if (Number.isNaN(now.getTime())) throw new Error(`CallRecord ${rec.callId} has no valid capturedAt`);
  return {
    tool: rec.tool,
    args: rec.args,
    result: rec.output,
    now,
    declaredOutputSchema: ctx.toolDef?.outputSchema,
    upstream: toExchanges(rec.upstream, rec.capturedAt),
    probe: probeOf(rec),
    contract: ctx.contract ?? null,
    toolDef: ctx.toolDef ?? null,
    opts: ctx.opts,
  };
}

/** The map's value for `key`, created with `init()` on first use. */
export function getOrInit<K, V>(map: Map<K, V>, key: K, init: () => V): V {
  let v = map.get(key);
  if (v === undefined) {
    v = init();
    map.set(key, v);
  }
  return v;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
