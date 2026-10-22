// Ground truth for the shop tools (PLAN 3.0 criterion 5, 3.1 "Clean"): what each tool should
// return for a call, computed from the vendor's own state and catalog only. This module never
// imports the contracts package, the proxy package or any monitor (lint rule: ../biome.json).
import type { DomainCall, TruthResult } from '@fiks/interfaces';
import { CATALOG, type CatalogProduct, searchCatalog } from './catalog.ts';
import { parseOrderLines } from './server.ts';

/** The part of `VendorState` truth reads; `/__admin/state` JSON (ISO created_at) also works. */
export interface TruthState {
  products?: readonly CatalogProduct[];
  orders: {
    id: string;
    status: string;
    items: { product_id: string; quantity: number; unit_price: number }[];
    total: number;
    created_at: Date | string;
  }[];
  droppedOrders?: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString();

type Actual = { kind: 'error' } | { kind: 'empty' } | { kind: 'data'; value: unknown };

/** A tool result (`{structuredContent, isError}`) or a bare structured output, classified. */
export function actualOf(output: unknown): Actual {
  if (output === undefined || output === null) return { kind: 'empty' };
  if (typeof output === 'object' && output !== null) {
    const o = output as { isError?: unknown; structuredContent?: unknown; content?: unknown };
    if (o.isError === true) return { kind: 'error' };
    if ('structuredContent' in o || 'content' in o) {
      return o.structuredContent === undefined || o.structuredContent === null
        ? { kind: 'empty' }
        : { kind: 'data', value: o.structuredContent };
    }
  }
  return { kind: 'data', value: output };
}

const isInstantString = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v));

function sameNumber(a: number, b: number): boolean {
  if (Number.isInteger(a) && Number.isInteger(b)) return a === b;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Paths where `actual` differs from `expected` under the semantic equality of PLAN 3.0: integers
 * exact, floats to 1e-9 relative, null = absent, key order ignored, arrays ordered, strings NFC,
 * timestamps as instants.
 */
export function semanticDiff(expected: unknown, actual: unknown, path = ''): string[] {
  const absent = (v: unknown) => v === undefined || v === null;
  if (absent(expected) && absent(actual)) return [];
  if (absent(expected) || absent(actual)) return [path];
  if (typeof expected === 'number' && typeof actual === 'number') {
    return sameNumber(expected, actual) ? [] : [path];
  }
  if (typeof expected === 'string' && typeof actual === 'string') {
    if (isInstantString(expected) && isInstantString(actual)) {
      return Date.parse(expected) === Date.parse(actual) ? [] : [path];
    }
    return expected.normalize('NFC') === actual.normalize('NFC') ? [] : [path];
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) return [path];
    return expected.flatMap((e, i) => semanticDiff(e, actual[i], `${path}[${i}]`));
  }
  if (
    typeof expected === 'object' &&
    typeof actual === 'object' &&
    !Array.isArray(expected) &&
    !Array.isArray(actual)
  ) {
    const e = expected as Record<string, unknown>;
    const a = actual as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(e), ...Object.keys(a)])].sort();
    return keys.flatMap((k) => semanticDiff(e[k], a[k], path ? `${path}.${k}` : k));
  }
  return Object.is(expected, actual) ? [] : [path];
}

function expectedFor(call: DomainCall, state: TruthState): { inputValid: boolean; expected: unknown } {
  const products = state.products ?? CATALOG;
  const args = call.args ?? {};
  const invalid = { inputValid: false, expected: null };
  switch (call.tool) {
    case 'search_products': {
      if (typeof args.query !== 'string') return invalid;
      const items = searchCatalog(args.query, products).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        price: p.price,
        currency: p.currency,
      }));
      return { inputValid: true, expected: { items, count: items.length, total: items.length } };
    }
    case 'get_product': {
      const p = typeof args.id === 'string' ? products.find((x) => x.id === args.id) : undefined;
      if (!p) return invalid;
      const expected = {
        id: p.id,
        name: p.name,
        category: p.category,
        price: p.price,
        currency: p.currency,
        in_stock: p.stock > 0,
      };
      return { inputValid: true, expected };
    }
    case 'create_order': {
      const lines = parseOrderLines({ items: args.items }, products);
      if (typeof lines === 'string') return invalid;
      const total = round2(lines.reduce((s, l) => s + l.unit_price * l.quantity, 0));
      const sameLines = (o: TruthState['orders'][number]) =>
        o.items.length === lines.length &&
        o.items.every((l, i) => l.product_id === lines[i]?.product_id && l.quantity === lines[i]?.quantity);
      // The order this call placed: the persisted order the tool named, else the latest one with
      // the same lines. An id that names no persisted order (a lost write) has no true value.
      const actual = actualOf(call.output);
      const named =
        actual.kind === 'data' ? (actual.value as { order_id?: unknown } | null)?.order_id : undefined;
      const placed =
        state.orders.find((o) => o.id === named && sameLines(o)) ??
        (named === undefined ? [...state.orders].reverse().find(sameLines) : undefined);
      return { inputValid: true, expected: { order_id: placed?.id ?? null, status: 'confirmed', total } };
    }
    case 'get_order': {
      const o =
        typeof args.order_id === 'string' ? state.orders.find((x) => x.id === args.order_id) : undefined;
      if (!o) return invalid;
      const expected = {
        order_id: o.id,
        status: o.status,
        items: o.items.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          unit_price: l.unit_price,
        })),
        total: o.total,
        created_at: iso(o.created_at),
      };
      return { inputValid: true, expected };
    }
    default:
      throw new Error(`shop truth(): unknown tool ${call.tool}`);
  }
}

/**
 * What the shop tool should have returned for `call`, from vendor ground truth (`state`: the
 * vendor's state after the call). With `call.output`, `mismatches` lists the paths where the
 * output differs; for an invalid input an error or an empty result counts as equal.
 */
export function shopTruth(call: DomainCall, state: unknown): TruthResult {
  const { inputValid, expected } = expectedFor(call, state as TruthState);
  if (call.output === undefined) return { inputValid, expected };
  const actual = actualOf(call.output);
  let mismatches: string[];
  if (!inputValid) mismatches = actual.kind === 'data' ? [''] : [];
  else if (actual.kind !== 'data') mismatches = [''];
  else mismatches = semanticDiff(expected, actual.value);
  return { inputValid, expected, mismatches };
}
