// entityClass / originEntity (PLAN 3.1 "Attribution") and truth() unit tests on synthetic inputs.
// The live checks (D1-D5 scenario calls, v1 fixtures, 200 enumerated calls through shop-mcp)
// are in packages/cli/test/core/shop-domain.test.ts.
import { readFileSync } from 'node:fs';
import type { DomainCall } from '@fiks/interfaces';
import { beforeAll, describe, expect, test } from 'vitest';
import {
  CATALOG,
  type CatalogProduct,
  concretePaths,
  createShopDomain,
  createVendor,
  loadExtended,
  ORDER_FROM_PREVIOUS,
  queryId,
  SHOP_KNOWN_GOOD_QUERIES,
  searchCatalog,
  semanticDiff,
  shopEnumerate,
  shopTruth,
} from '../src/index.ts';

const EXT = new URL('./fixtures/extended-sample.json', import.meta.url).pathname;
const SRC = new URL('../src/', import.meta.url).pathname;

const domain = createShopDomain({
  reproEmitter: () => ({ files: [], testPath: '' }),
  suite: {
    scope: ['**'],
    run: () => ({ exitCode: 0, failed: [], files: [], suiteErrors: [], logPath: '', command: '' }),
    oneFailingInScope: () => false,
  },
});

beforeAll(() => {
  process.env.VENDOR_EXTENDED_CATALOG = EXT;
});

/** A synthetic but well-formed output for a frame input (what v1 shop-mcp would return). */
function syntheticOutput(tool: string, args: Record<string, unknown>, products: readonly CatalogProduct[]) {
  switch (tool) {
    case 'get_product': {
      const p = products.find((x) => x.id === args.id) as CatalogProduct;
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        price: p.price,
        currency: p.currency,
        in_stock: p.stock > 0,
      };
    }
    case 'search_products': {
      const items = searchCatalog(String(args.query), products).map(
        ({ id, name, category, price, currency }) => ({
          id,
          name,
          category,
          price,
          currency,
        }),
      );
      return { items, count: items.length, total: items.length };
    }
    case 'create_order': {
      const line = (args.items as { product_id: string; quantity: number }[])[0] as {
        product_id: string;
        quantity: number;
      };
      const p = products.find((x) => x.id === line.product_id) as CatalogProduct;
      return { order_id: 'o-6001', status: 'confirmed', total: p.price * line.quantity };
    }
    default:
      return undefined;
  }
}

describe('entityClass and originEntity', () => {
  test('defined for 200 synthetic frame inputs (all strata) with and without outputs', () => {
    const ext = loadExtended(EXT);
    const rows = shopEnumerate({ catalog: 'extended-only', seed: 7 });
    const strata = new Set(rows.map((r) => r.stratum));
    expect(strata).toEqual(new Set(['S-ext', 'S-grid', 'S-write']));
    // 200 inputs: every S-ext and S-write row (30 + 120) plus the first 50 grid queries.
    const picked = [
      ...rows.filter((r) => r.stratum !== 'S-grid'),
      ...rows.filter((r) => r.stratum === 'S-grid').slice(0, 50),
    ];
    expect(picked).toHaveLength(200);
    let prev: Record<string, unknown> | undefined;
    let prevProduct: string | undefined;
    for (const r of picked) {
      if (r.tool === 'create_order') prevProduct = (r.args.items as { product_id: string }[])[0]?.product_id;
      let args = r.args;
      let output: unknown = syntheticOutput(r.tool, r.args, ext);
      if (r.tool === 'get_order') {
        expect(args.order_id).toBe(ORDER_FROM_PREVIOUS);
        args = { order_id: prev?.order_id };
        const created = prev as { order_id: string; total: number };
        output = {
          order_id: created.order_id,
          status: 'confirmed',
          items: [
            {
              product_id: prevProduct,
              quantity: 1,
              unit_price: 1,
            },
          ],
          total: created.total,
          created_at: '2026-10-01T12:00:00.000Z',
        };
      }
      prev = output as Record<string, unknown>;
      for (const call of [
        { tool: r.tool, args },
        { tool: r.tool, args, output },
      ] as DomainCall[]) {
        const cls = domain.entityClass(call);
        const origin = domain.originEntity(call);
        expect(Object.keys(cls).length, JSON.stringify(call)).toBeGreaterThan(0);
        expect(Object.keys(origin).sort()).toEqual(Object.keys(cls).sort());
        for (const v of [...Object.values(cls), ...Object.values(origin)]) {
          expect(typeof v).toBe('string');
          expect(v.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test('single-line create_order and get_order: the origin is the product', () => {
    const create: DomainCall = {
      tool: 'create_order',
      args: { items: [{ product_id: 'px-0004', quantity: 2 }] },
      output: { order_id: 'o-5002', status: 'confirmed', total: 259 },
    };
    expect(new Set(Object.values(domain.originEntity(create)))).toEqual(new Set(['px-0004']));
    expect(domain.originEntity(create).total).toBe('px-0004');
    expect(domain.entityClass(create).total).toBe('webcam');
    const get: DomainCall = {
      tool: 'get_order',
      args: { order_id: 'o-5002' },
      output: {
        order_id: 'o-5002',
        status: 'confirmed',
        items: [{ product_id: 'px-0004', quantity: 2, unit_price: 129.5 }],
        total: 259,
        created_at: '2026-10-01T12:00:00.000Z',
      },
    };
    const o = domain.originEntity(get);
    expect(new Set(Object.values(o))).toEqual(new Set(['px-0004']));
    expect(o.created_at).toBe('px-0004');
    expect(o['items[0].unit_price']).toBe('px-0004');
  });

  test('a search: each element path is attributed to its own entity, collection paths to the query', () => {
    const ext = loadExtended(EXT);
    const output = syntheticOutput('search_products', { query: 'webcam' }, ext) as {
      items: { id: string }[];
    };
    expect(output.items.length).toBeGreaterThan(2);
    const call: DomainCall = { tool: 'search_products', args: { query: 'webcam' }, output };
    const o = domain.originEntity(call);
    output.items.forEach((it, i) => {
      expect(o[`items[${i}].price`]).toBe(it.id);
      expect(o[`items[${i}]`]).toBe(it.id);
    });
    // The offending item of an item-level property (e.g. the 2nd item's price) is that item.
    expect(o['items[1].price']).toBe(output.items[1]?.id);
    for (const p of ['', 'items', 'count', 'total']) expect(o[p]).toBe(queryId('webcam'));
    const cls = domain.entityClass(call);
    expect(cls.total).toBe('webcam'); // the query is a category filter
    expect(cls['items[0].price']).toBe('webcam');
    const free = domain.entityClass({
      tool: 'search_products',
      args: { query: 'orbit' },
      output: { items: [] },
    });
    expect(free['']).toBe('all');
  });

  test('get_product: entity id and category, also for an unknown id', () => {
    const p = CATALOG[0] as CatalogProduct;
    expect(domain.originEntity({ tool: 'get_product', args: { id: p.id } }).price).toBe(p.id);
    expect(domain.entityClass({ tool: 'get_product', args: { id: p.id } }).price).toBe('laptop');
    expect(domain.entityClass({ tool: 'get_product', args: { id: 'px-0001' } }).price).toBe('headphones');
    expect(domain.entityClass({ tool: 'get_product', args: { id: 'p-0000' } }).price).toBe('unknown');
  });

  test('concretePaths lists every element path', () => {
    expect(concretePaths({ items: [{ a: 1 }, { a: 2 }], n: 2 })).toEqual([
      '',
      'items',
      'items[0]',
      'items[0].a',
      'items[1]',
      'items[1].a',
      'n',
    ]);
  });
});

describe('enumerate', () => {
  test('is deterministic, excludes known-good queries and original ids, and S-write is single-line', () => {
    const a = shopEnumerate({ catalog: 'extended-only', seed: 1 });
    expect(shopEnumerate({ catalog: 'extended-only', seed: 1 })).toEqual(a);
    expect(shopEnumerate({ catalog: 'extended-only', seed: 2 })).not.toEqual(a);
    const original = new Set(CATALOG.map((p) => p.id));
    for (const r of a) {
      expect(JSON.stringify(r.args)).not.toMatch(/"p-\d{4}"/);
      if (r.tool === 'search_products') expect(SHOP_KNOWN_GOOD_QUERIES).not.toContain(r.args.query);
      if (r.tool === 'create_order') expect(r.args.items).toHaveLength(1);
      if (r.tool === 'get_product') expect(original.has(r.args.id as string)).toBe(false);
    }
    expect(new Set(a.map((r) => r.dedupeKey)).size).toBe(a.length);
    expect(
      shopEnumerate({ catalog: 'extended-only', seed: 1, stratum: 'S-grid' }).every(
        (r) => r.stratum === 'S-grid',
      ),
    ).toBe(true);
    expect(shopEnumerate({ catalog: 'original', seed: 1, stratum: 'S-grid' }).length).toBeGreaterThanOrEqual(
      100,
    );
  });
});

describe('truth()', () => {
  test('semantic equality: floats, null = absent, key order, instants', () => {
    expect(semanticDiff({ a: 1.1, b: null }, { a: 1.1 + 1e-12 })).toEqual([]);
    expect(semanticDiff({ a: 1 }, { a: 2 })).toEqual(['a']);
    expect(semanticDiff({ t: '2026-01-01T00:00:00Z' }, { t: '2026-01-01T00:00:00.000Z' })).toEqual([]);
    expect(semanticDiff({ x: [1, 2] }, { x: [2, 1] })).toEqual(['x[0]', 'x[1]']);
    expect(semanticDiff({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
  });

  test('invalid inputs: error or empty equals truth; data does not', () => {
    const state = { orders: [] };
    const err = { isError: true, content: [{ type: 'text', text: 'No product with id p-0000.' }] };
    expect(shopTruth({ tool: 'get_product', args: { id: 'p-0000' }, output: err }, state)).toMatchObject({
      inputValid: false,
      mismatches: [],
    });
    expect(
      shopTruth({ tool: 'get_product', args: { id: 'p-0000' }, output: { id: 'p-0000' } }, state).mismatches,
    ).toEqual(['']);
  });

  test('a lost write (D3) is a mismatch on order_id; drifted values (D1, D2, D5) are mismatches', async () => {
    const v = createVendor({ version: 'v2', drifts: 'D3', now: () => new Date('2026-10-01T12:00:00Z') });
    const base = await v.listen();
    try {
      const r = await fetch(`${base}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ product_id: 'p-1004', quantity: 2 }] }),
      });
      const o = await r.json();
      const call: DomainCall = {
        tool: 'create_order',
        args: { items: [{ product_id: 'p-1004', quantity: 2 }] },
        output: { order_id: o.id, status: o.status, total: o.total },
      };
      expect(shopTruth(call, v.state).mismatches).toEqual(['order_id']);
    } finally {
      await v.close();
    }
    const state = createVendor({ version: 'v1', now: () => new Date('2026-10-01T12:00:00Z') }).state;
    const p = { id: 'p-1001', name: 'Aero 14 Laptop', category: 'laptop', currency: 'USD', in_stock: true };
    expect(
      shopTruth({ tool: 'get_product', args: { id: 'p-1001' }, output: { ...p, price: null } }, state)
        .mismatches,
    ).toEqual(['price']);
    expect(
      shopTruth({ tool: 'get_product', args: { id: 'p-1001' }, output: { ...p, price: 119900 } }, state)
        .mismatches,
    ).toEqual(['price']);
    expect(
      shopTruth({ tool: 'get_product', args: { id: 'p-1001' }, output: { ...p, price: 1199 } }, state)
        .mismatches,
    ).toEqual([]);
  });
});

test('static: truth.ts and originEntity.ts import neither @fiks/contracts nor @fiks/proxy', () => {
  for (const f of ['truth.ts', 'originEntity.ts']) {
    const src = readFileSync(`${SRC}${f}`, 'utf8');
    expect(src, f).not.toMatch(/@fiks\/(contracts|proxy)/);
    expect(src, f).not.toMatch(/\bevaluate\b|checkInvariant/);
  }
});

test('docs/shop.md states no numeric bound on a contract-constrained field', () => {
  const docs = readFileSync(new URL('../docs/shop.md', import.meta.url), 'utf8');
  expect(docs.match(/\b(20|2000|0\.5|365)\b/g)).toBeNull();
});
