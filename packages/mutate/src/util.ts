// Deterministic helpers shared by the response and patch operators: hashing, canonical JSON and a
// seeded PRNG. Nothing here reads the clock, the environment or Math.random.
import { createHash } from 'node:crypto';

export const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

/** JSON with object keys sorted at every level; the input to every hash in this package. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeys((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

/** A seeded generator in [0, 1): mulberry32, keyed by sha256(`<label>:<seed>`). */
export function rng(label: string, seed: number | string): () => number {
  let a = Number.parseInt(sha256(`${label}:${String(seed)}`).slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An index in [0, n) drawn from `next`. */
export const pick = (next: () => number, n: number): number => Math.min(n - 1, Math.floor(next() * n));

/** Eight hex characters drawn from `next`. */
export const hex8 = (next: () => number): string =>
  Math.floor(next() * 4294967296)
    .toString(16)
    .padStart(8, '0');

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export const deepClone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
