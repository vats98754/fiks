import { readFileSync } from 'node:fs';
import type { Catalog } from '@fiks/interfaces';

export type { Catalog } from '@fiks/interfaces';

export interface Product {
  id: string;
  name: string;
  /** Original catalog: laptop, monitor, cable, dock or keyboard. Extended entities may add more. */
  category: string;
  /** Unit price in US dollars (v1 wire format). */
  price: number;
  currency: string;
  stock: number;
}

/** An entity of the blind-extended catalog (PLAN 3.1): authored in batches, in its own id space. */
export interface ExtendedProduct extends Product {
  /** The authoring batch the entity came from (kept for the batch-cluster bootstrap). */
  authorBatch: string;
}

export type CatalogProduct = Product | ExtendedProduct;

/** Fixed catalog. Every price is between $60 and $1,500. */
export const CATALOG: readonly Product[] = [
  { id: 'p-1001', name: 'Aero 14 Laptop', category: 'laptop', price: 1199, currency: 'USD', stock: 12 },
  { id: 'p-1002', name: 'Volt 13 Laptop', category: 'laptop', price: 899, currency: 'USD', stock: 30 },
  { id: 'p-1003', name: 'Titan 16 Laptop', category: 'laptop', price: 1499, currency: 'USD', stock: 4 },
  { id: 'p-1004', name: 'Nimbus 15 Laptop', category: 'laptop', price: 749.5, currency: 'USD', stock: 18 },
  { id: 'p-1005', name: 'Clarity 27 Monitor', category: 'monitor', price: 329, currency: 'USD', stock: 25 },
  { id: 'p-1006', name: 'Clarity 32 Monitor', category: 'monitor', price: 459, currency: 'USD', stock: 9 },
  { id: 'p-1007', name: 'Hub Pro Dock', category: 'dock', price: 189, currency: 'USD', stock: 40 },
  { id: 'p-1008', name: 'Quiet Mech Keyboard', category: 'keyboard', price: 129, currency: 'USD', stock: 50 },
  { id: 'p-1101', name: 'Thunderbolt 5 Cable 1m', category: 'cable', price: 69, currency: 'USD', stock: 100 },
  { id: 'p-1102', name: 'Thunderbolt 5 Cable 2m', category: 'cable', price: 89, currency: 'USD', stock: 80 },
  { id: 'p-1103', name: 'USB4 Cable 1m', category: 'cable', price: 60, currency: 'USD', stock: 120 },
  { id: 'p-1104', name: 'USB4 Cable 2m', category: 'cable', price: 64, currency: 'USD', stock: 90 },
  {
    id: 'p-1105',
    name: 'Active Optical HDMI Cable 10m',
    category: 'cable',
    price: 99,
    currency: 'USD',
    stock: 35,
  },
  {
    id: 'p-1106',
    name: 'DisplayPort 2.1 Cable 3m',
    category: 'cable',
    price: 72,
    currency: 'USD',
    stock: 60,
  },
  {
    id: 'p-1107',
    name: 'Braided Power Cable 2m',
    category: 'cable',
    price: 61.5,
    currency: 'USD',
    stock: 75,
  },
];

export function findProduct(
  id: string,
  products: readonly CatalogProduct[] = CATALOG,
): CatalogProduct | undefined {
  return products.find((p) => p.id === id);
}

/** Case-insensitive match on name or category. An empty query matches everything. */
export function searchCatalog(
  query: string,
  products: readonly CatalogProduct[] = CATALOG,
): CatalogProduct[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...products];
  return products.filter((p) => p.name.toLowerCase().includes(q) || p.category === q);
}

// --- Catalog option (P8): original | extended-only | all ------------------------------------

export const CATALOG_MODES: readonly Catalog[] = ['original', 'extended-only', 'all'];

/** Extended ids live in their own namespace (`px-...`), never the original `p-NNNN` one. */
export const EXTENDED_ID = /^px-[a-z0-9][a-z0-9-]*$/i;

/** Where the A0 catalog author's entities are committed (override: VENDOR_EXTENDED_CATALOG). */
export const DEFAULT_EXTENDED_CATALOG = new URL('../catalog/extended.json', import.meta.url).pathname;

export function extendedCatalogPath(): string {
  return process.env.VENDOR_EXTENDED_CATALOG ?? DEFAULT_EXTENDED_CATALOG;
}

export function parseCatalogMode(raw: string | undefined): Catalog {
  const mode = raw ?? 'original';
  if (!(CATALOG_MODES as readonly string[]).includes(mode)) {
    throw new Error(`catalog must be one of ${CATALOG_MODES.join(', ')}, got ${JSON.stringify(raw)}`);
  }
  return mode as Catalog;
}

/**
 * Validates extended entities: product fields as in the original catalog plus `authorBatch`,
 * unique ids in the extended namespace. No value bound is checked (the brief states none).
 */
export function validateExtended(raw: unknown, source = 'extended catalog'): ExtendedProduct[] {
  const list = Array.isArray(raw) ? raw : (raw as { entities?: unknown } | null)?.entities;
  if (!Array.isArray(list)) throw new Error(`${source}: expected an array or {"entities": [...]}`);
  const original = new Set(CATALOG.map((p) => p.id));
  const seen = new Set<string>();
  return list.map((e: unknown, i: number) => {
    const x = (e ?? {}) as Record<string, unknown>;
    const where = `${source}[${i}]`;
    const str = (k: string) => {
      if (typeof x[k] !== 'string' || !(x[k] as string).trim())
        throw new Error(`${where}: ${k} must be a string`);
      return x[k] as string;
    };
    const id = str('id');
    if (!EXTENDED_ID.test(id) || original.has(id)) {
      throw new Error(`${where}: id ${JSON.stringify(id)} is outside the extended namespace (px-...)`);
    }
    if (seen.has(id)) throw new Error(`${where}: duplicate id ${id}`);
    seen.add(id);
    if (typeof x.price !== 'number' || !Number.isFinite(x.price))
      throw new Error(`${where}: price must be a number`);
    if (!Number.isInteger(x.stock)) throw new Error(`${where}: stock must be an integer`);
    return {
      id,
      name: str('name'),
      category: str('category'),
      price: x.price,
      currency: str('currency'),
      stock: x.stock as number,
      authorBatch: str('authorBatch'),
    };
  });
}

const extendedCache = new Map<string, ExtendedProduct[]>();

/** Extended entities from a JSON file (default: `extendedCatalogPath()`), validated and cached. */
export function loadExtended(file = extendedCatalogPath()): ExtendedProduct[] {
  let hit = extendedCache.get(file);
  if (!hit) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      throw new Error(
        `extended catalog ${file} not found (set VENDOR_EXTENDED_CATALOG or pass extendedFile)`,
      );
    }
    hit = validateExtended(JSON.parse(text), file);
    extendedCache.set(file, hit);
  }
  return hit;
}

/** The products a vendor serves for `mode`. `original` is exactly `CATALOG`. */
export function resolveCatalog(
  mode: Catalog,
  extended?: readonly ExtendedProduct[] | string,
): readonly CatalogProduct[] {
  if (mode === 'original') return CATALOG;
  const ext = typeof extended === 'string' || extended === undefined ? loadExtended(extended) : extended;
  return mode === 'extended-only' ? ext : [...CATALOG, ...ext];
}
