import { describe, expect, test } from 'vitest';
import {
  buildProbeArgs,
  evaluate,
  findContract,
  SHOP_CONTRACTS,
  schemaMismatch,
  select,
} from '../src/index.ts';

const NOW = new Date('2026-10-18T12:00:00.000Z');
const c = (tool: string) => findContract(SHOP_CONTRACTS, tool);
const ok = (structuredContent: Record<string, unknown>) => ({ structuredContent, content: [] });

describe('select', () => {
  test('wildcards expand with concrete locations', () => {
    expect(select({ items: [{ price: 1 }, { price: 2 }] }, 'items[*].price')).toEqual([
      { at: 'items[0].price', value: 1 },
      { at: 'items[1].price', value: 2 },
    ]);
    expect(select({ a: null }, 'a.b')).toEqual([{ at: 'a.b', value: undefined }]);
  });
});

describe('search_products', () => {
  const items = (prices: number[]) => prices.map((price, i) => ({ id: `p-${i}`, name: 'x', price }));
  test('v1 shaped result is verified', () => {
    const r = evaluate(c('search_products'), {
      args: { query: 'laptop' },
      result: ok({ items: items([1199, 899]), count: 2, total: 2 }),
      now: NOW,
    });
    expect(r.verdict).toBe('verified');
    expect(r.checked).toEqual([
      'shop.search_products/items.price.range',
      'shop.search_products/countMatchesTotal',
      'shop.search_products/items.id.unique',
      'shop.search_products/items.nonEmpty',
    ]);
  });
  test('D1: cents are out of range', () => {
    const r = evaluate(c('search_products'), {
      args: { query: 'laptop' },
      result: ok({ items: items([119900]), count: 1, total: 1 }),
      now: NOW,
    });
    expect(r.verdict).toBe('violated');
    expect(r.violations[0]).toMatchObject({
      propertyId: 'shop.search_products/items.price.range',
      path: 'items[0].price',
      actual: 119900,
    });
  });
  test('D4: page 1 only', () => {
    const r = evaluate(c('search_products'), {
      args: { query: 'cable' },
      result: ok({ items: items([69, 89, 60, 64, 99]), count: 5, total: 7 }),
      now: NOW,
    });
    expect(r.violations.map((v) => v.propertyId)).toEqual(['shop.search_products/countMatchesTotal']);
    expect(r.violations[0]?.message).toBe('list is incomplete, 5 of 7 matches returned');
  });
  test('a /100 on dollar prices is out of range too', () => {
    const r = evaluate(c('search_products'), {
      args: { query: 'laptop' },
      result: ok({ items: items([14.99]), count: 1, total: 1 }),
      now: NOW,
    });
    expect(r.violations[0]?.propertyId).toBe('shop.search_products/items.price.range');
  });
  test('total must equal the upstream total (no hiding pagination)', () => {
    const upstream = [
      {
        seq: 0,
        startedAt: '',
        durationMs: 0,
        request: { method: 'GET', url: '/products?q=cable', headers: {}, body: null },
        response: {
          status: 200,
          headers: {},
          body: JSON.stringify({ items: [], total: 7, next_cursor: '5' }),
        },
      },
    ];
    const run = (total: number, n: number) =>
      evaluate(c('search_products'), {
        args: { query: 'cable' },
        result: ok({ items: items(Array(n).fill(69)), count: n, total }),
        now: NOW,
        upstream,
      });
    expect(run(5, 5).violations.map((v) => v.propertyId)).toEqual([
      'shop.search_products/total.equalsUpstream',
    ]);
    expect(run(7, 7).verdict).toBe('verified');
    expect(run(7, 7).checked).toContain('shop.search_products/total.equalsUpstream');
  });
  test('nonEmpty only applies to known-good queries', () => {
    const empty = ok({ items: [], count: 0, total: 0 });
    expect(evaluate(c('search_products'), { args: { query: 'zzz' }, result: empty, now: NOW }).verdict).toBe(
      'verified',
    );
    expect(
      evaluate(c('search_products'), { args: { query: 'cable' }, result: empty, now: NOW }).verdict,
    ).toBe('violated');
  });
});

describe('get_product', () => {
  test('D2: null price on a known-good id', () => {
    const r = evaluate(c('get_product'), {
      args: { id: 'p-1001' },
      result: ok({ id: 'p-1001', price: null }),
      now: NOW,
    });
    expect(r.violations.map((v) => v.propertyId)).toEqual(['shop.get_product/price.notNull']);
  });
  test('unknown id: notNull skipped, not violated', () => {
    const r = evaluate(c('get_product'), { args: { id: 'p-9' }, result: ok({ price: null }), now: NOW });
    expect(r.verdict).toBe('verified');
    expect(r.checked).toEqual(['shop.get_product/price.range']);
  });
  test('isError and missing structuredContent are unverifiable', () => {
    expect(evaluate(c('get_product'), { args: {}, result: { isError: true }, now: NOW }).verdict).toBe(
      'unverifiable',
    );
    expect(evaluate(c('get_product'), { args: {}, result: { content: [] }, now: NOW }).verdict).toBe(
      'unverifiable',
    );
  });
  test('no contract is unverifiable with contractId null', () => {
    expect(evaluate(undefined, { args: {}, result: ok({}), now: NOW })).toEqual({
      verdict: 'unverifiable',
      contractId: null,
      checked: [],
      violations: [],
    });
  });
});

describe('create_order read-after-write', () => {
  const contract = c('create_order');
  const written = ok({ order_id: 'o-5002', status: 'confirmed', total: 1499 });
  test('probe args come from the result', () => {
    const post = contract?.postconditions?.[0];
    expect(post && buildProbeArgs(post, written.structuredContent)).toEqual({ order_id: 'o-5002' });
  });
  test('readable write is verified', () => {
    const r = evaluate(contract, {
      args: {},
      result: written,
      now: NOW,
      probe: {
        tool: 'get_order',
        args: { order_id: 'o-5002' },
        result: ok({ order_id: 'o-5002', total: 1499 }),
      },
    });
    expect(r.verdict).toBe('verified');
  });
  test('D3: probe errors -> violated', () => {
    const r = evaluate(contract, {
      args: {},
      result: written,
      now: NOW,
      probe: { tool: 'get_order', args: { order_id: 'o-5002' }, result: { isError: true } },
    });
    expect(r.violations[0]?.propertyId).toBe('shop.create_order/readAfterWrite');
    expect(r.violations[0]?.message).toMatch(/not found on read-back/);
  });
  test('missing probe -> violated, mismatched total -> violated', () => {
    expect(evaluate(contract, { args: {}, result: written, now: NOW }).verdict).toBe('violated');
    const r = evaluate(contract, {
      args: {},
      result: written,
      now: NOW,
      probe: { tool: 'get_order', args: {}, result: ok({ order_id: 'o-5002', total: 14.99 }) },
    });
    expect(r.violations[0]?.path).toBe('total');
  });
});

describe('get_order freshness', () => {
  test('D5: 1970 is stale; ISO and epoch-ms near now are fresh', () => {
    const run = (created_at: unknown) =>
      evaluate(c('get_order'), {
        args: {},
        result: ok({ order_id: 'o-5001', total: 658, created_at }),
        now: NOW,
      });
    expect(run('1970-01-01T00:00:00.000Z').violations[0]?.propertyId).toBe(
      'shop.get_order/created_at.freshness',
    );
    expect(run('2026-10-16T12:00:00.000Z').verdict).toBe('verified');
    expect(run(Date.parse('2026-10-16T12:00:00.000Z')).verdict).toBe('verified');
    expect(run('2026-12-01T00:00:00.000Z').verdict).toBe('violated');
    expect(run('not a date').violations[0]?.message).toMatch(/not a timestamp/);
  });
});

describe('outputSchema', () => {
  test('declared schema mismatches are violations', () => {
    const schema = { type: 'object', required: ['id'], properties: { price: { type: ['number', 'null'] } } };
    expect(schemaMismatch(schema, { id: 'x', price: null })).toBeNull();
    expect(schemaMismatch(schema, { price: 1 })).toBe('$.id is missing');
    expect(schemaMismatch(schema, { id: 'x', price: '1' })).toBe('$.price is string, expected number|null');
    const nullable = { anyOf: [{ type: 'number' }, { type: 'null' }] };
    expect(schemaMismatch(nullable, null)).toBeNull();
    expect(schemaMismatch(nullable, 'x')).toBe('$ is string, expected number and $ is string, expected null');
    const r = evaluate(c('get_product'), {
      args: { id: 'p-9' },
      result: ok({ price: 3 }),
      now: NOW,
      declaredOutputSchema: schema,
    });
    expect(r.violations[0]?.propertyId).toBe('shop.get_product/outputSchema');
  });
});

describe('unique and instant equalsUpstream', () => {
  const up = (body: unknown) => [
    {
      seq: 0,
      startedAt: '',
      durationMs: 0,
      request: { method: 'GET', url: '/', headers: {}, body: null },
      response: { status: 200, headers: {}, body: JSON.stringify(body) },
    },
  ];
  test('duplicated items are a violation', () => {
    const r = evaluate(c('search_products'), {
      args: { query: 'x' },
      result: ok({
        items: [
          { id: 'a', price: 60 },
          { id: 'a', price: 60 },
        ],
        count: 2,
        total: 2,
      }),
      now: NOW,
    });
    expect(r.violations.map((v) => v.propertyId)).toEqual(['shop.search_products/items.id.unique']);
  });
  test('created_at must be the instant upstream reported, in either format', () => {
    const iso = '2026-10-16T12:00:00.000Z';
    const run = (created_at: string, upstreamValue: unknown) =>
      evaluate(c('get_order'), {
        args: {},
        result: ok({ order_id: 'o-5001', total: 658, created_at }),
        now: NOW,
        upstream: up({ created_at: upstreamValue }),
      });
    expect(run(iso, iso).verdict).toBe('verified');
    expect(run(iso, Date.parse(iso)).verdict).toBe('verified');
    expect(run('2026-10-18T11:00:00.000Z', Date.parse(iso)).violations.map((v) => v.propertyId)).toEqual([
      'shop.get_order/created_at.equalsUpstream',
    ]);
  });
});

describe('readAfterWrite needs upstream confirmation', () => {
  const ex = (status: number, body: unknown) => ({
    seq: 0,
    startedAt: '',
    durationMs: 0,
    request: { method: 'GET', url: '/orders/o-5002', headers: {}, body: null },
    response: { status, headers: {}, body: JSON.stringify(body) },
  });
  const written = ok({ order_id: 'o-5002', status: 'confirmed', total: 1499 });
  const readBack = ok({ order_id: 'o-5002', total: 1499 });
  const run = (upstream?: ReturnType<typeof ex>[]) =>
    evaluate(c('create_order'), {
      args: {},
      result: written,
      now: NOW,
      probe: { tool: 'get_order', args: { order_id: 'o-5002' }, result: readBack, upstream },
    });
  test('upstream 2xx with the id confirms the write', () => {
    expect(run([ex(200, { id: 'o-5002' })]).verdict).toBe('verified');
  });
  test('tool reads back but upstream said 404 (e.g. a local cache): violated', () => {
    const r = run([ex(404, { error: 'not_found' })]);
    expect(r.violations[0]?.propertyId).toBe('shop.create_order/readAfterWrite');
    expect(r.violations[0]?.message).toMatch(/write not confirmed by upstream/);
  });
  test('tool made no upstream request at all: violated', () => {
    expect(run([]).verdict).toBe('violated');
  });
  test('unknown upstream (no tap): only the tool-level read-back is checked', () => {
    expect(run(undefined).verdict).toBe('verified');
  });
});

test('a declared outputSchema with no structuredContent is an outputSchema violation', () => {
  const r = evaluate(c('get_product'), {
    args: { id: 'p-1001' },
    result: { content: [{ type: 'text', text: '{}' }] },
    now: NOW,
    declaredOutputSchema: { type: 'object' },
  });
  expect(r.violations.map((v) => v.propertyId)).toEqual(['shop.get_product/outputSchema']);
  expect(evaluate(c('get_product'), { args: {}, result: { content: [] }, now: NOW }).verdict).toBe(
    'unverifiable',
  );
});
