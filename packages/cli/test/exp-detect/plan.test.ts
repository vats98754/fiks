// E-B clean plan: enumeration completeness against the vendor's own data module.
import { CATALOG, SEED_ORDER_ID } from '@fiks/vendor-api';
import { describe, expect, test } from 'vitest';
import {
  categoriesOf,
  cleanPlan,
  entitiesOf,
  FIXED_QUERIES,
  SEED_ORDER_IDS,
} from '../../src/exp-detect/plan.ts';

describe('cleanPlan', () => {
  const plan = cleanPlan();

  test('get_product once per catalog product: count equals the vendor catalog size', () => {
    const products = plan.filter((c) => c.tool === 'get_product');
    expect(products).toHaveLength(CATALOG.length);
    expect(CATALOG.length).toBe(15);
    expect(products.map((c) => c.args.id).sort()).toEqual(CATALOG.map((p) => p.id).sort());
  });

  test('search_products for every category and every fixed query', () => {
    const queries = plan.filter((c) => c.tool === 'search_products').map((c) => c.args.query);
    const cats = [...new Set(CATALOG.map((p) => p.category))].sort();
    expect(categoriesOf(CATALOG)).toEqual(cats);
    expect(cats).toHaveLength(5);
    for (const c of cats) expect(queries).toContain(c);
    for (const q of FIXED_QUERIES) expect(queries).toContain(q);
    expect(new Set(queries).size).toBe(queries.length);
    expect(plan.filter((c) => c.kind === 'category')).toHaveLength(cats.length);
  });

  test('get_order for the seed orders', () => {
    expect(SEED_ORDER_IDS).toEqual([SEED_ORDER_ID]);
    expect(plan.filter((c) => c.tool === 'get_order').map((c) => c.args.order_id)).toEqual([SEED_ORDER_ID]);
  });

  test('total and uniqueness', () => {
    const cats = categoriesOf(CATALOG);
    const extra = FIXED_QUERIES.filter((q) => !cats.includes(q)).length;
    expect(plan).toHaveLength(CATALOG.length + cats.length + extra + SEED_ORDER_IDS.length);
    expect(new Set(plan.map((c) => c.callId)).size).toBe(plan.length);
  });

  test('a fixed query equal to a category is asked once', () => {
    const p = cleanPlan(CATALOG, ['laptop', 'x'], []);
    expect(p.filter((c) => c.args.query === 'laptop')).toHaveLength(1);
    expect(p.find((c) => c.args.query === 'laptop')?.kind).toBe('category');
  });
});

test('entitiesOf: ids in args and structured results', () => {
  expect(entitiesOf({ id: 'p-1' }, { id: 'p-1', name: 'x' })).toEqual(['p-1']);
  expect(entitiesOf({ query: 'c' }, { items: [{ id: 'p-2' }, { id: 'p-1' }], total: 2 })).toEqual([
    'p-1',
    'p-2',
  ]);
  expect(
    entitiesOf({ order_id: 'o-1' }, { order_id: 'o-1', items: [{ product_id: 'p-9', quantity: 1 }] }),
  ).toEqual(['o-1', 'p-9']);
  expect(entitiesOf({ query: 'none' }, undefined)).toEqual([]);
});
