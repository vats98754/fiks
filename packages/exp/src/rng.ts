// Seeded randomness for the runner. Every random choice (arm order inside a block, the S4 drift
// subset, the R11 showcase draw) derives from the run seed plus a stable label, so it is the same
// for any worker count, any resume point and any machine.

import { createHash } from 'node:crypto';

/** mulberry32 over a 32-bit state taken from sha256(seed | label). */
export function rngFor(seed: string, label: string): () => number {
  let s = createHash('sha256').update(`${seed}|${label}`).digest().readUInt32LE(0);
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates with the seeded generator; returns a new array. */
export function seededShuffle<T>(items: readonly T[], seed: string, label: string): T[] {
  const out = [...items];
  const r = rngFor(seed, label);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * A seeded subset of size `n`, stratified by `strata` (proportional allocation, largest remainder,
 * ties broken by stratum name). Order of the result follows the input order.
 */
export function stratifiedSubset<T>(
  items: readonly T[],
  n: number,
  seed: string,
  label: string,
  stratumOf: (x: T) => string = () => 'all',
): T[] {
  if (n >= items.length) return [...items];
  const groups = new Map<string, T[]>();
  for (const x of items) {
    const k = stratumOf(x);
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  const keys = [...groups.keys()].sort();
  const quota = new Map<string, number>();
  let used = 0;
  const rema: { k: string; r: number }[] = [];
  for (const k of keys) {
    const exact = ((groups.get(k)?.length ?? 0) * n) / items.length;
    quota.set(k, Math.floor(exact));
    used += Math.floor(exact);
    rema.push({ k, r: exact - Math.floor(exact) });
  }
  rema.sort((a, b) => b.r - a.r || a.k.localeCompare(b.k));
  for (let i = 0; used < n && i < rema.length; i++, used++) {
    const k = (rema[i] as { k: string }).k;
    quota.set(k, (quota.get(k) ?? 0) + 1);
  }
  const keep = new Set<T>();
  for (const k of keys) {
    for (const x of seededShuffle(groups.get(k) ?? [], seed, `${label}|${k}`).slice(0, quota.get(k) ?? 0))
      keep.add(x);
  }
  return items.filter((x) => keep.has(x));
}
