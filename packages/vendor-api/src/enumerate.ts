// Shop input enumeration (Domain.enumerate; PLAN 3.1 frame strata, 5.7). Deterministic for a
// given catalog and seed. It reads no contract: the known-good queries excluded from the grid
// are the ones PLAN 3.1 names.
import { createHash } from 'node:crypto';
import type { EnumerateOptions, EnumRow } from '@fiks/interfaces';
import { type CatalogProduct, resolveCatalog } from './catalog.ts';

/** Placeholder in an S-write get_order row: the order_id the preceding create_order returned. */
export const ORDER_FROM_PREVIOUS = '$prev.order_id';

/** Shop known-good search queries; never part of the frame (PLAN 3.1 S-grid). */
export const SHOP_KNOWN_GOOD_QUERIES: readonly string[] = ['laptop', 'monitor', 'cable'];

/** Target size of the S-grid. */
export const SHOP_GRID_SIZE = 200;

export const SHOP_STRATA = ['S-ext', 'S-grid', 'S-write'] as const;

function rng(seed: string | number): () => number {
  let a = createHash('sha256').update(String(seed)).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(xs: readonly T[], seed: string | number): T[] {
  const out = [...xs];
  const r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Candidate search queries from the catalog: categories, names, word prefixes and word pairs. */
export function gridCandidates(products: readonly CatalogProduct[]): string[] {
  const out = new Set<string>();
  for (const p of products) {
    out.add(p.category.toLowerCase());
    const name = p.name.toLowerCase();
    out.add(name);
    const words = name.split(/[^a-z0-9.]+/).filter(Boolean);
    words.forEach((w, i) => {
      for (let n = 2; n <= w.length; n++) out.add(w.slice(0, n));
      const next = words[i + 1];
      if (next) out.add(`${w} ${next}`);
    });
  }
  for (const q of SHOP_KNOWN_GOOD_QUERIES) out.delete(q);
  return [...out].sort();
}

const key = (...parts: unknown[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);

/**
 * S-ext: get_product for every catalog entity. S-grid: up to SHOP_GRID_SIZE seeded queries.
 * S-write: one single-line create_order per entity and quantity in {1, 2}, each followed by its
 * get_order (args `{order_id: ORDER_FROM_PREVIOUS}`).
 */
export function shopEnumerate(opts: EnumerateOptions): EnumRow[] {
  const products = resolveCatalog(opts.catalog);
  const rows: EnumRow[] = [];
  const add = (stratum: string, tool: string, args: Record<string, unknown>, ...extra: unknown[]) =>
    rows.push({ domain: 'shop', stratum, tool, args, dedupeKey: key('shop', stratum, tool, args, ...extra) });
  const want = (s: string) => !opts.stratum || opts.stratum === s;
  if (want('S-ext')) for (const p of products) add('S-ext', 'get_product', { id: p.id });
  if (want('S-grid')) {
    for (const q of shuffled(gridCandidates(products), opts.seed).slice(0, SHOP_GRID_SIZE)) {
      add('S-grid', 'search_products', { query: q });
    }
  }
  if (want('S-write')) {
    for (const p of products) {
      for (const quantity of [1, 2]) {
        const pair = `${p.id}x${quantity}`;
        add('S-write', 'create_order', { items: [{ product_id: p.id, quantity }] }, pair);
        add('S-write', 'get_order', { order_id: ORDER_FROM_PREVIOUS }, pair);
      }
    }
  }
  return rows;
}
