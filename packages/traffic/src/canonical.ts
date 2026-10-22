// Canonical JSON (object keys sorted, recursively) and sha256, so the args file of two runs that made
// the same calls is byte-identical whatever key order the agent used.
import { createHash } from 'node:crypto';

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}

/** JSON with every object's keys in sorted order; `undefined` members are dropped. */
export function canonical(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** EnumRow-style dedupe key (24 hex) over the canonical form of `parts`. */
export function dedupeKey(...parts: unknown[]): string {
  return sha256(canonical(parts)).slice(0, 24);
}
