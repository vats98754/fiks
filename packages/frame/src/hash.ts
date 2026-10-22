// Canonical JSON, sha256 and JSONL helpers. Every file the detection pipeline writes is a pure
// function of its inputs, so two runs give byte-identical files and identical hashes.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The value with object keys sorted at every level (arrays keep their order). */
export function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) if (o[k] !== undefined) out[k] = sortKeys(o[k]);
    return out;
  }
  return v;
}

/** JSON with sorted keys: equal values give equal strings. */
export const canonicalJson = (v: unknown): string => JSON.stringify(sortKeys(v));

export const sha256Hex = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

export const sha256File = (file: string): string => sha256Hex(readFileSync(file));

/** One canonical JSON line per value. */
export const toJsonl = (rows: readonly unknown[]): string =>
  rows.map((r) => `${canonicalJson(r)}\n`).join('');

export function writeJsonl(file: string, rows: readonly unknown[]): string {
  mkdirSync(dirname(file), { recursive: true });
  const text = toJsonl(rows);
  writeFileSync(file, text);
  return sha256Hex(text);
}

export function readJsonl<T>(file: string): T[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return JSON.parse(l) as T;
      } catch {
        throw new Error(`${file}:${i + 1}: not JSON`);
      }
    });
}

/** Pretty JSON with sorted keys and a trailing newline; returns the sha256 of the bytes written. */
export function writeJson(file: string, value: unknown): string {
  mkdirSync(dirname(file), { recursive: true });
  const text = `${JSON.stringify(sortKeys(value), null, 2)}\n`;
  writeFileSync(file, text);
  return sha256Hex(text);
}
