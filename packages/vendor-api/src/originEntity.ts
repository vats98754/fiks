// Entity class and origin unit per property path of one shop call (PLAN 3.1 "Attribution",
// D12 cells). Pure functions of the call (tool, args, output) and the product index; they read
// no contract (lint rule in ../biome.json forbids importing the contracts or proxy package).
import type { DomainCall } from '@fiks/interfaces';
import type { CatalogProduct } from './catalog.ts';

/** Top-level output fields per tool, used when the call carries no output. */
export const SHOP_TOOL_FIELDS: Record<string, readonly string[]> = {
  search_products: ['items', 'count', 'total'],
  get_product: ['id', 'name', 'category', 'price', 'currency', 'in_stock'],
  create_order: ['order_id', 'status', 'total'],
  get_order: ['order_id', 'status', 'items', 'total', 'created_at'],
};

/** Element-level array fields: each element's paths belong to that element's own entity. */
const ELEMENT_ARRAYS: Record<string, string> = { search_products: 'items', get_order: 'items' };

export type ProductIndex = (id: string) => CatalogProduct | undefined;

/** The structured output of a call: `call.output` may be a tool result or the bare output. */
function structured(call: DomainCall): Record<string, unknown> | undefined {
  const o = call.output as { isError?: unknown; structuredContent?: unknown } | undefined | null;
  if (!o || typeof o !== 'object') return undefined;
  if (o.isError === true) return undefined;
  if ('structuredContent' in o || 'content' in o) {
    const s = o.structuredContent;
    return s && typeof s === 'object' ? (s as Record<string, unknown>) : undefined;
  }
  return o as Record<string, unknown>;
}

/** Every concrete path of a JSON value: '' (root), `a`, `a.b`, `items[2]`, `items[2].price`, ... */
export function concretePaths(value: unknown, prefix = ''): string[] {
  const out: string[] = prefix ? [] : [''];
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      const p = `${prefix}[${i}]`;
      out.push(p, ...concretePaths(v, p));
    });
  } else if (value && typeof value === 'object') {
    for (const k of Object.keys(value as object).sort()) {
      const p = prefix ? `${prefix}.${k}` : k;
      out.push(p, ...concretePaths((value as Record<string, unknown>)[k], p));
    }
  }
  return out;
}

function pathsOf(call: DomainCall): string[] {
  const s = structured(call);
  if (s) return concretePaths(s);
  return ['', ...(SHOP_TOOL_FIELDS[call.tool] ?? [])];
}

/** `items[3]...` -> 3 when `items` is the tool's element array, else undefined. */
function elementIndex(tool: string, path: string): number | undefined {
  const arr = ELEMENT_ARRAYS[tool];
  if (!arr) return undefined;
  const m = new RegExp(`^${arr}\\[(\\d+)\\]`).exec(path);
  return m ? Number(m[1]) : undefined;
}

type Line = { product_id?: unknown; quantity?: unknown };

function orderLines(call: DomainCall): Line[] | undefined {
  if (call.tool === 'create_order') {
    return Array.isArray(call.args.items) ? (call.args.items as Line[]) : undefined;
  }
  const items = structured(call)?.items;
  return Array.isArray(items) ? (items as Line[]) : undefined;
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** The S-grid query id of a search (collection-level origin unit). */
export const queryId = (query: unknown) =>
  `query:${typeof query === 'string' ? query : JSON.stringify(query)}`;

/**
 * Origin unit per concrete property path (PLAN 3.1): the entity for entity-level tools; for
 * element paths (`items[i]...`) the element's own entity; for order tools the order's single
 * product; for collection-level search paths the S-grid query.
 */
export function shopOriginEntity(call: DomainCall): Record<string, string> {
  const out: Record<string, string> = {};
  const s = structured(call);
  const lines = orderLines(call);
  const single = lines?.length === 1 ? str(lines[0]?.product_id) : undefined;
  const orderUnit = () =>
    single ?? `order:${str(call.args.order_id) ?? str(s?.order_id) ?? JSON.stringify(call.args)}`;
  for (const path of pathsOf(call)) {
    const i = elementIndex(call.tool, path);
    switch (call.tool) {
      case 'search_products': {
        const items = s?.items as { id?: unknown }[] | undefined;
        out[path] =
          i === undefined
            ? queryId(call.args.query)
            : (str(items?.[i]?.id) ?? `${queryId(call.args.query)}#${i}`);
        break;
      }
      case 'get_product':
        out[path] = str(call.args.id) ?? JSON.stringify(call.args.id);
        break;
      case 'create_order':
        out[path] = orderUnit();
        break;
      case 'get_order':
        out[path] = i === undefined ? orderUnit() : (str(lines?.[i]?.product_id) ?? orderUnit());
        break;
      default:
        throw new Error(`shop originEntity(): unknown tool ${call.tool}`);
    }
  }
  return out;
}

/**
 * Entity class per concrete property path: the product category. Element paths take their
 * element's category; a search's collection-level paths take the query's category filter, else
 * 'all'; a multi-line order is 'mixed'; an unknown product is 'unknown'.
 */
export function shopEntityClass(
  call: DomainCall,
  index: ProductIndex,
  categories: ReadonlySet<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const s = structured(call);
  const categoryOf = (id: unknown, fallback?: unknown) =>
    str(fallback) ?? (typeof id === 'string' ? index(id)?.category : undefined) ?? 'unknown';
  const lines = orderLines(call);
  const orderClass = () =>
    !lines?.length ? 'unknown' : lines.length === 1 ? categoryOf(lines[0]?.product_id) : 'mixed';
  for (const path of pathsOf(call)) {
    const i = elementIndex(call.tool, path);
    switch (call.tool) {
      case 'search_products': {
        if (i === undefined) {
          const q = typeof call.args.query === 'string' ? call.args.query.trim().toLowerCase() : '';
          out[path] = categories.has(q) ? q : 'all';
        } else {
          const item = (s?.items as { id?: unknown; category?: unknown }[] | undefined)?.[i];
          out[path] = categoryOf(item?.id, item?.category);
        }
        break;
      }
      case 'get_product':
        out[path] = categoryOf(call.args.id, s?.category);
        break;
      case 'create_order':
        out[path] = orderClass();
        break;
      case 'get_order':
        out[path] = i === undefined ? orderClass() : categoryOf(lines?.[i]?.product_id);
        break;
      default:
        throw new Error(`shop entityClass(): unknown tool ${call.tool}`);
    }
  }
  return out;
}
