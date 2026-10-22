// Enumerations (PLAN 3.1 strata, 5.7). Thin, deterministic layers over `Domain.enumerate`:
//   - frame F: the domain's strata on a catalog, minus known-good inputs and (for an
//     extended-only frame) any row that names an original entity;
//   - per drift: tools touching the drifted endpoint x (original catalog + a seeded extended
//     sample) + the query grid.
// They read no contract verdicts; known-good inputs come in as plain data.
import { createHash } from 'node:crypto';
import type { Catalog, DomainCall, EnumerateOptions, EnumRow } from '@fiks/interfaces';
import { isWriteTool, type RuleMatch, toolTouches } from './endpoints.ts';

export interface EnumDomain {
  id: string;
  enumerate(opts: EnumerateOptions): EnumRow[];
  originEntity(call: DomainCall): Record<string, string>;
}

/** Known-good inputs per tool (a contract's `knownGoodInputs`, matched as subsets of the args). */
export type KnownGood = Record<string, readonly Record<string, unknown>[]>;

function isSubset(pattern: Record<string, unknown>, actual: unknown): boolean {
  if (actual === null || typeof actual !== 'object') return false;
  return Object.entries(pattern).every(
    ([k, v]) => JSON.stringify((actual as Record<string, unknown>)[k]) === JSON.stringify(v),
  );
}

export const isKnownGoodArgs = (known: KnownGood, tool: string, args: unknown): boolean =>
  (known[tool] ?? []).some((p) => isSubset(p, args));

/** Every string inside a JSON value. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v !== null && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

/** The entity a row is about: the origin unit of the whole output (`''`) without an output. */
export function rowEntity(domain: EnumDomain, row: Pick<EnumRow, 'tool' | 'args'>): string | undefined {
  try {
    return domain.originEntity({ tool: row.tool, args: row.args })[''];
  } catch {
    return undefined;
  }
}

/** Entity ids of a catalog: the entities its S-ext rows are about, in enumeration order. */
export function catalogEntities(domain: EnumDomain, catalog: Catalog, seed: string | number): string[] {
  let rows: EnumRow[];
  try {
    rows = domain.enumerate({ catalog, seed, stratum: 'S-ext' });
  } catch {
    return []; // no extended catalog yet (authored at A0)
  }
  const out: string[] = [];
  for (const r of rows) {
    const e = rowEntity(domain, r);
    if (e !== undefined && !out.includes(e)) out.push(e);
  }
  return out;
}

export interface FrameEnumOptions {
  catalog: Catalog;
  seed: string | number;
  knownGood?: KnownGood;
}

export interface EnumResult {
  rows: EnumRow[];
  excluded: Record<string, number>;
  /** Per drift: the original entities and the seeded extended sample. */
  sample?: { original: string[]; extended: string[] };
}

function dedupe(rows: EnumRow[], excluded: Record<string, number>): EnumRow[] {
  const seen = new Set<string>();
  const out: EnumRow[] = [];
  for (const r of rows) {
    if (seen.has(r.dedupeKey)) {
      excluded.duplicate = (excluded.duplicate ?? 0) + 1;
      continue;
    }
    seen.add(r.dedupeKey);
    out.push(r);
  }
  return out;
}

/**
 * Frame F (PLAN 3.1): the domain's strata on `catalog`, without known-good inputs; on an
 * extended-only frame also without any row whose arguments name an original entity.
 */
export function frameEnumeration(domain: EnumDomain, opts: FrameEnumOptions): EnumResult {
  const excluded: Record<string, number> = { knownGood: 0, original: 0, duplicate: 0 };
  const original = opts.catalog === 'extended-only' ? new Set(catalogEntities(domain, 'original', 0)) : null;
  const rows = domain.enumerate({ catalog: opts.catalog, seed: opts.seed }).filter((r) => {
    if (opts.knownGood && isKnownGoodArgs(opts.knownGood, r.tool, r.args)) {
      excluded.knownGood = (excluded.knownGood ?? 0) + 1;
      return false;
    }
    if (original && strings(r.args).some((s) => original.has(s))) {
      excluded.original = (excluded.original ?? 0) + 1;
      return false;
    }
    return true;
  });
  return { rows: dedupe(rows, excluded), excluded };
}

function rng(seed: string | number): () => number {
  let a = createHash('sha256')
    .update(`det:${String(seed)}`)
    .digest()
    .readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded sample of `n` items (Fisher-Yates over a sorted copy, then the first n). */
export function seededSample<T>(xs: readonly T[], n: number, seed: string | number): T[] {
  const out = [...xs].sort();
  const r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out.slice(0, n);
}

export interface DriftEnumOptions {
  /** The injector rule's match: rows whose tool touches it are kept. */
  match: RuleMatch;
  seed: string | number;
  /** Extended entities sampled per drift (PLAN 5.7: 50). */
  sampleSize?: number;
  /** S-grid rows kept (the first of the seeded grid). */
  gridSize?: number;
}

export const DRIFT_SAMPLE_SIZE = 50;
export const DRIFT_GRID_SIZE = 50;

/**
 * Per-drift enumeration (PLAN 5.7): tools touching the drifted endpoint x (original catalog +
 * seeded extended sample), the first `gridSize` S-grid queries, and the S-write pairs (write and
 * its read-back) whose write or read touches the endpoint, all on catalog `all`, in the domain's
 * stratum order.
 */
export function driftEnumeration(domain: EnumDomain, opts: DriftEnumOptions): EnumResult {
  const excluded: Record<string, number> = { untouched: 0, notSampled: 0, grid: 0, duplicate: 0 };
  const original = catalogEntities(domain, 'original', 0);
  const extended = seededSample(
    catalogEntities(domain, 'extended-only', 0),
    opts.sampleSize ?? DRIFT_SAMPLE_SIZE,
    opts.seed,
  );
  const keep = new Set([...original, ...extended]);
  let all: EnumRow[];
  try {
    all = domain.enumerate({ catalog: 'all', seed: opts.seed });
  } catch {
    all = domain.enumerate({ catalog: 'original', seed: opts.seed });
  }
  const touches = (tool: string) => toolTouches(domain.id, tool, opts.match);
  const out: EnumRow[] = [];
  let grid = 0;
  for (let i = 0; i < all.length; i++) {
    const r = all[i] as EnumRow;
    if (r.stratum === 'S-grid') {
      if (grid < (opts.gridSize ?? DRIFT_GRID_SIZE)) {
        grid++;
        out.push(r);
      } else excluded.grid = (excluded.grid ?? 0) + 1;
      continue;
    }
    if (r.stratum === 'S-write' && isWriteTool(domain.id, r.tool)) {
      // A write and the reads that follow it (its read-back) stay together.
      const pair = [r];
      while (i + 1 < all.length) {
        const next = all[i + 1] as EnumRow;
        if (next.stratum !== 'S-write' || isWriteTool(domain.id, next.tool)) break;
        pair.push(next);
        i++;
      }
      const e = rowEntity(domain, r);
      if (e === undefined || !keep.has(e)) excluded.notSampled = (excluded.notSampled ?? 0) + pair.length;
      else if (!pair.some((p) => touches(p.tool)))
        excluded.untouched = (excluded.untouched ?? 0) + pair.length;
      else out.push(...pair);
      continue;
    }
    const e = rowEntity(domain, r);
    if (e === undefined || !keep.has(e)) excluded.notSampled = (excluded.notSampled ?? 0) + 1;
    else if (!touches(r.tool)) excluded.untouched = (excluded.untouched ?? 0) + 1;
    else out.push(r);
  }
  return { rows: dedupe(out, excluded), excluded, sample: { original, extended } };
}
