// Seeded randomness for selections, idea order and the split: sha256(seed) seeds a 128-bit xorshift
// generator, so a (seed, label) pair always gives the same sequence on every machine.
import { createHash } from 'node:crypto';

export type Rng = () => number;

export function seededRng(seed: string | number, label = ''): Rng {
  const h = createHash('sha256')
    .update(`${String(seed)}\0${label}`)
    .digest();
  let a = h.readUInt32LE(0) | 0;
  let b = h.readUInt32LE(4) | 0;
  let c = h.readUInt32LE(8) | 0;
  let d = h.readUInt32LE(12) | 0;
  if ((a | b | c | d) === 0) a = 1;
  return () => {
    // xorshift128
    const t = a ^ (a << 11);
    a = b;
    b = c;
    c = d;
    d = (d ^ (d >>> 19) ^ (t ^ (t >>> 8))) | 0;
    return (d >>> 0) / 4294967296;
  };
}

/** Fisher-Yates on a copy. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** JSON with sorted keys at every level (hash input). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
