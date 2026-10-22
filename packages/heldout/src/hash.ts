// Canonical JSON and hashes for records that must be byte-stable across reruns.
import { createHash } from 'node:crypto';
import type { GradeRecord } from '@fiks/interfaces';

export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/** JSON with object keys sorted at every level; undefined members dropped. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** The hash two reruns of the same grade must share (PLAN 8.1 R5: re-grades must match exactly). */
export const gradeRecordHash = (g: GradeRecord) => sha256(canonicalJson(g));

/** Code-unit string order (locale-independent, so sorted output is the same on every machine). */
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
