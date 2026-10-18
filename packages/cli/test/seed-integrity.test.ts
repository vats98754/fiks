// The shop-mcp seed's test harness is the gate every repair must pass. These tests apply
// correct and wrong fixes to a copy of the seed and check that only correct ones pass.
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { recordFixtures } from '../src/commands/record-fixtures.ts';
import { rerecord } from '../src/commands/rerecord.ts';
import { copyShop, patch, readRecording, runSuite, writeTrace } from './support/shop-copy.ts';

const T = 120_000;
let rec: { dir: string; cleanup(): void };
const recorded: Record<string, string> = {};

beforeAll(async () => {
  // v2 recordings from the unfixed seed: D3-only, D4-only, and every drift at once.
  rec = copyShop();
  for (const [key, drifts] of [
    ['d3', 'D3'],
    ['d2', 'D2'],
    ['d4', 'D4'],
    ['d5', 'D5'],
    ['all', 'D1,D2,D3,D4,D5'],
  ] as const) {
    const out = join(rec.dir, '.rec', key);
    await recordFixtures({ vendor: 'v2', drifts, out, shopDir: rec.dir });
    recorded[key] = out;
  }
}, T);
afterAll(() => rec?.cleanup());

const CREATE = 'src/tools/create_order.ts';
const SEARCH = 'src/tools/search_products.ts';
const D3_FIX: [string, string] = [
  "vendor.post('/orders', { items: args.items })",
  "vendor.post('/orders', { items: args.items }, { 'idempotency-key': crypto.randomUUID() })",
];
const D4_FIX: [string, string] = [
  `  const res = await vendor.get(\`/products?q=\${encodeURIComponent(args.query)}\`);
  const body = res.body as { items: VendorProduct[]; total: number };`,
  `  const q = encodeURIComponent(args.query);
  type Page = { items: VendorProduct[]; total: number; next_cursor?: string | null };
  const body = (await vendor.get(\`/products?q=\${q}\`)).body as Page;
  for (let c = body.next_cursor; c; ) {
    const page = (await vendor.get(\`/products?q=\${q}&cursor=\${encodeURIComponent(c)}\`)).body as Page;
    body.items = [...body.items, ...page.items];
    c = page.next_cursor;
  }`,
];

describe('seed harness accepts real fixes and rejects wrong ones', () => {
  test('unfixed: a D3 trace fails, naming readAfterWrite', { timeout: T }, () => {
    const c = copyShop();
    try {
      writeTrace(c.dir, 'd3', readRecording(`${recorded.d3}/order-create.json`), [
        'shop.create_order/readAfterWrite',
      ]);
      const r = runSuite(c.dir);
      expect(r.ok).toBe(false);
      expect(r.output).toContain('shop.create_order/readAfterWrite violated');
    } finally {
      c.cleanup();
    }
  });

  test('D3 fix without re-recording fails as UNMATCHED_REQUEST, with re-recording passes', {
    timeout: T,
  }, async () => {
    const c = copyShop();
    try {
      const trace = writeTrace(c.dir, 'd3', readRecording(`${recorded.d3}/order-create.json`), [
        'shop.create_order/readAfterWrite',
      ]);
      patch(c.dir, CREATE, ...D3_FIX);
      const before = runSuite(c.dir);
      expect(before.ok).toBe(false);
      expect(before.output).toContain('UNMATCHED_REQUEST');
      await rerecord(trace, { shopDir: c.dir });
      await rerecord(join(c.dir, 'test/fixtures/v1/order-create.json'), { shopDir: c.dir });
      const after = runSuite(c.dir);
      expect(after.output).not.toContain('FAIL');
      expect(after.ok).toBe(true);
    } finally {
      c.cleanup();
    }
  });

  test('D3 fix that also changes v1 output is caught by the golden fixture after re-recording', {
    timeout: T,
  }, async () => {
    const c = copyShop();
    try {
      const trace = writeTrace(c.dir, 'd3', readRecording(`${recorded.d3}/order-create.json`), [
        'shop.create_order/readAfterWrite',
      ]);
      patch(c.dir, CREATE, ...D3_FIX);
      patch(c.dir, CREATE, 'status: o.status', "status: 'pending'");
      await rerecord(trace, { shopDir: c.dir });
      await rerecord(join(c.dir, 'test/fixtures/v1/order-create.json'), { shopDir: c.dir });
      const r = runSuite(c.dir);
      expect(r.ok).toBe(false);
      expect(r.output).toContain('golden output changed');
    } finally {
      c.cleanup();
    }
  });

  test('fake D4 fix (total = items.length) fails total.equalsUpstream', { timeout: T }, () => {
    const c = copyShop();
    try {
      writeTrace(c.dir, 'd4', readRecording(`${recorded.d4}/search-cable.json`), [
        'shop.search_products/countMatchesTotal',
      ]);
      patch(c.dir, SEARCH, 'total: body.total', 'total: items.length');
      const r = runSuite(c.dir);
      expect(r.ok).toBe(false);
      expect(r.output).toContain('shop.search_products/total.equalsUpstream violated');
    } finally {
      c.cleanup();
    }
  });

  test('real D4 fix passes its trace after re-recording; an all-drift trace ignores the D1 fault', {
    timeout: T,
  }, async () => {
    const c = copyShop();
    try {
      const only = writeTrace(c.dir, 'd4', readRecording(`${recorded.d4}/search-cable.json`), [
        'shop.search_products/countMatchesTotal',
      ]);
      const mixed = writeTrace(
        c.dir,
        'd4-all',
        readRecording(`${recorded.all}/search-cable.json`),
        ['shop.search_products/items.price.range', 'shop.search_products/countMatchesTotal'],
        ['shop.search_products/countMatchesTotal'],
      );
      patch(c.dir, SEARCH, ...D4_FIX);
      await rerecord(only, { shopDir: c.dir });
      await rerecord(mixed, { shopDir: c.dir });
      const r = runSuite(c.dir);
      expect(r.output).not.toContain('FAIL');
      expect(r.ok).toBe(true);
    } finally {
      c.cleanup();
    }
  });

  test('wrong D1 fix (/100 always) breaks the v1 golden fixtures', { timeout: T }, () => {
    const c = copyShop();
    try {
      patch(c.dir, SEARCH, 'price: p.price,', 'price: p.price / 100,');
      const r = runSuite(c.dir);
      expect(r.ok).toBe(false);
      expect(r.output).toContain('golden output changed');
    } finally {
      c.cleanup();
    }
  });
  test('lazy D5 fix (|| Date.now()) fails: the replay clock is not the capture clock', { timeout: T }, () => {
    const c = copyShop();
    try {
      writeTrace(c.dir, 'd5', readRecording(`${recorded.d5}/order-o-5001.json`), [
        'shop.get_order/created_at.freshness',
        'shop.get_order/created_at.equalsUpstream',
      ]);
      patch(c.dir, 'src/tools/get_order.ts', '|| 0', '|| Date.now()');
      const r = runSuite(c.dir);
      expect(r.ok).toBe(false);
      expect(r.output).toMatch(/shop\.get_order\/created_at\.(freshness|equalsUpstream)/);
    } finally {
      c.cleanup();
    }
  });

  test('real D5 fix passes', { timeout: T }, () => {
    const c = copyShop();
    try {
      writeTrace(c.dir, 'd5', readRecording(`${recorded.d5}/order-o-5001.json`), [
        'shop.get_order/created_at.freshness',
        'shop.get_order/created_at.equalsUpstream',
      ]);
      patch(
        c.dir,
        'src/tools/get_order.ts',
        'new Date(Date.parse(String(o.created_at)) || 0)',
        'new Date(typeof o.created_at === "number" ? o.created_at : Date.parse(String(o.created_at)))',
      );
      const r = runSuite(c.dir);
      expect(r.output).not.toContain('FAIL');
      expect(r.ok).toBe(true);
    } finally {
      c.cleanup();
    }
  });

  test('padding items to reach total fails items.id.unique', { timeout: T }, () => {
    const c = copyShop();
    try {
      writeTrace(c.dir, 'd4', readRecording(`${recorded.d4}/search-cable.json`), [
        'shop.search_products/countMatchesTotal',
      ]);
      patch(
        c.dir,
        SEARCH,
        'return ok({ items, count: items.length, total: body.total });',
        'while (items.length < body.total && items[0]) items.push(items[0]);\n  return ok({ items, count: items.length, total: body.total });',
      );
      const r = runSuite(c.dir);
      expect(r.ok).toBe(false);
      expect(r.output).toContain('shop.search_products/items.id.unique violated');
    } finally {
      c.cleanup();
    }
  });

  test('turning a 404 into a made-up product breaks the v1 golden fixture', { timeout: T }, () => {
    const c = copyShop();
    try {
      patch(
        c.dir,
        'src/tools/get_product.ts',
        'return fail(`No product with id ${args.id}.`);',
        "return ok({ id: args.id, name: '', category: '', price: null, currency: 'USD', in_stock: false });",
      );
      const r = runSuite(c.dir);
      expect(r.ok).toBe(false);
      expect(r.output).toContain('golden output changed');
    } finally {
      c.cleanup();
    }
  });
  const REFUSALS: [string, string, string, string, [string, string]][] = [
    [
      'D2',
      'd2',
      'product-p-1001.json',
      'shop.get_product/price.notNull',
      [
        'const p = res.body as VendorProduct;',
        "const p = res.body as VendorProduct;\n  if (p.price == null) return fail('Price unavailable.');",
      ],
    ],
    [
      'D4',
      'd4',
      'search-cable.json',
      'shop.search_products/countMatchesTotal',
      [
        'const body = res.body as { items: VendorProduct[]; total: number };',
        "const body = res.body as { items: VendorProduct[]; total: number; next_cursor?: string };\n  if (body.next_cursor) return fail('Too many results.');",
      ],
    ],
  ];
  for (const [drift, key, fixture, propertyId, [from, to]] of REFUSALS) {
    test(`${drift}: returning an error instead of the data fails`, { timeout: T }, () => {
      const c = copyShop();
      try {
        writeTrace(c.dir, key, readRecording(`${recorded[key]}/${fixture}`), [propertyId]);
        const file = drift === 'D2' ? 'src/tools/get_product.ts' : SEARCH;
        patch(c.dir, file, from, to);
        if (drift === 'D4')
          patch(
            c.dir,
            SEARCH,
            "import { ok } from '../result.ts';",
            "import { fail, ok } from '../result.ts';",
          );
        const r = runSuite(c.dir);
        expect(r.ok).toBe(false);
        expect(r.output).toContain('tool now returns an error instead of data');
      } finally {
        c.cleanup();
      }
    });
  }

  test('D3: failing on the read-back instead of fixing the write fails', { timeout: T }, async () => {
    const c = copyShop();
    try {
      const trace = writeTrace(c.dir, 'd3', readRecording(`${recorded.d3}/order-create.json`), [
        'shop.create_order/readAfterWrite',
      ]);
      patch(
        c.dir,
        CREATE,
        'const o = res.body as VendorOrder;',
        "const o = res.body as VendorOrder;\n  if ((await vendor.get(`/orders/${o.id}`)).status === 404) return fail('Order was not saved.');",
      );
      await rerecord(trace, { shopDir: c.dir });
      await rerecord(join(c.dir, 'test/fixtures/v1/order-create.json'), { shopDir: c.dir });
      const r = runSuite(c.dir);
      expect(r.ok).toBe(false);
      expect(r.output).toContain('tool now returns an error instead of data');
    } finally {
      c.cleanup();
    }
  });
  test('D3: caching orders inside shop-mcp instead of fixing the write fails', { timeout: T }, () => {
    const c = copyShop();
    try {
      writeTrace(c.dir, 'd3', readRecording(`${recorded.d3}/order-create.json`), [
        'shop.create_order/readAfterWrite',
      ]);
      patch(
        c.dir,
        CREATE,
        'export const name =',
        'export const placed = new Map<string, unknown>();\n\nexport const name =',
      );
      patch(
        c.dir,
        CREATE,
        'const o = res.body as VendorOrder;',
        'const o = res.body as VendorOrder;\n  placed.set(o.id, res.body);',
      );
      patch(
        c.dir,
        'src/tools/get_order.ts',
        "import type { VendorClient } from '../vendor.ts';",
        "import type { VendorClient } from '../vendor.ts';\nimport { placed } from './create_order.ts';",
      );
      patch(
        c.dir,
        'src/tools/get_order.ts',
        'if (res.status === 404) return fail(`No order with id ${args.order_id}.`);\n  const o = res.body as VendorOrder;',
        'const cached = placed.get(args.order_id);\n  if (res.status === 404 && !cached) return fail(`No order with id ${args.order_id}.`);\n  const o = (res.status === 404 ? cached : res.body) as VendorOrder;',
      );
      const r = runSuite(c.dir);
      expect(r.ok).toBe(false);
      expect(r.output).toContain('write not confirmed by upstream');
    } finally {
      c.cleanup();
    }
  });
});
