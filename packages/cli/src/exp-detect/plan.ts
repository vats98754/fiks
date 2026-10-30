// E-B clean-traffic plan (paper/EXP-PLAN.md, E-B "Clean traffic"): every product, every category
// plus a fixed query list, and the seed orders, enumerated from the vendor's own data module so
// the plan always covers the whole v1 catalog.
import { CATALOG, type CatalogProduct, SEED_ORDER_ID } from '@fiks/vendor-api';

export type CleanKind = 'product' | 'category' | 'query' | 'order';

export interface PlannedCall {
  /** Stable id: `<tool>:<canonical args>`; also the per-call mutation seed prefix. */
  callId: string;
  kind: CleanKind;
  tool: 'get_product' | 'search_products' | 'get_order';
  args: Record<string, string>;
}

/**
 * The fixed search queries asked on top of the categories (written before any run; never tuned
 * on results). They cover the empty query (whole catalog), case, name words, multi-word phrases,
 * a version-like token and a query with no match.
 */
export const FIXED_QUERIES: readonly string[] = [
  '',
  'Laptop',
  'aero',
  'clarity',
  'thunderbolt',
  'usb4',
  'cable 2m',
  'hub pro',
  'mech',
  '2.1',
  'no-such-product-zz',
];

/** Seed orders every v1 vendor starts with (vendor-api server.ts). */
export const SEED_ORDER_IDS: readonly string[] = [SEED_ORDER_ID];

export const callIdOf = (tool: string, args: Record<string, unknown>) => `${tool}:${JSON.stringify(args)}`;

/** Sorted distinct categories of a catalog. */
export function categoriesOf(products: readonly CatalogProduct[]): string[] {
  return [...new Set(products.map((p) => p.category))].sort();
}

/**
 * The full clean plan: get_product per catalog product, search_products per category and per
 * fixed query (a fixed query equal to a category is asked once, as the category), get_order per
 * seed order. Deterministic order.
 */
export function cleanPlan(
  products: readonly CatalogProduct[] = CATALOG,
  queries: readonly string[] = FIXED_QUERIES,
  orders: readonly string[] = SEED_ORDER_IDS,
): PlannedCall[] {
  const out: PlannedCall[] = [];
  const add = (kind: CleanKind, tool: PlannedCall['tool'], args: Record<string, string>) =>
    out.push({ callId: callIdOf(tool, args), kind, tool, args });
  for (const p of products) add('product', 'get_product', { id: p.id });
  const cats = categoriesOf(products);
  for (const c of cats) add('category', 'search_products', { query: c });
  for (const q of queries) if (!cats.includes(q)) add('query', 'search_products', { query: q });
  for (const id of orders) add('order', 'get_order', { order_id: id });
  const ids = new Set(out.map((c) => c.callId));
  if (ids.size !== out.length) throw new Error('clean plan has duplicate calls');
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Entity ids a call touched: ids in its args and in its structured result (`id`, `order_id`,
 * `items[*].id`, `items[*].product_id`). Sorted, distinct.
 */
export function entitiesOf(args: Record<string, unknown>, structured: unknown): string[] {
  const out = new Set<string>();
  const take = (v: unknown) => {
    if (typeof v === 'string' && v) out.add(v);
  };
  take(args.id);
  take(args.order_id);
  if (isObj(structured)) {
    take(structured.id);
    take(structured.order_id);
    if (Array.isArray(structured.items)) {
      for (const it of structured.items) {
        if (!isObj(it)) continue;
        take(it.id);
        take(it.product_id);
      }
    }
  }
  return [...out].sort();
}
