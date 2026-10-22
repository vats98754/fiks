import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import {
  describeViolation,
  type EvalInput,
  evaluate,
  findContract,
  fpCapability,
  fpCapabilityTable,
  type Invariant,
  propertyFamily,
  SHOP_CONTRACTS,
  type ToolContract,
} from '../src/index.ts';
import type { ScenarioRecord, ToolSchemas } from './capture-scenarios.ts';
import { type Evaluator, fiksEvaluator, inputOf } from './replay-lib.ts';

const root = new URL('../../..', import.meta.url).pathname;
const NOW = new Date('2026-10-18T12:00:00.000Z');
const ok = (structuredContent: Record<string, unknown>) => ({ structuredContent, content: [] });
const contract = (invariants: Invariant[], extra: Partial<ToolContract> = {}): ToolContract => ({
  id: 't.tool',
  tool: 'tool',
  invariants,
  ...extra,
});
const run = (c: ToolContract, data: Record<string, unknown>, more: Partial<EvalInput> = {}) =>
  evaluate(c, { args: {}, result: ok(data), now: NOW, ...more });
const upstream = (bodies: unknown[], status = 200): EvalInput['upstream'] =>
  bodies.map((b, seq) => ({
    seq,
    startedAt: '',
    durationMs: 0,
    request: { method: 'GET', url: `/x?page=${seq + 1}`, headers: {}, body: null },
    response: { status, headers: {}, body: JSON.stringify(b) },
  }));

/** The evaluator at fiks ec241bc (= the one vendored at shop-mcp seed-v1). */
let ec241bc: Evaluator;
beforeAll(async () => {
  ec241bc = await fiksEvaluator(root, 'ec241bc');
});

describe('enum (closed world)', () => {
  const c = contract([
    { id: 'state.enum', kind: 'enum', path: 'items[*].state', values: ['open', 'closed'] },
  ]);
  test('known values verify; an unknown value violates', () => {
    expect(run(c, { items: [{ state: 'open' }, { state: 'closed' }] }).verdict).toBe('verified');
    const r = run(c, {
      items: [
        { id: 'a', state: 'open' },
        { id: 'b', state: 'archived' },
      ],
    });
    expect(r.verdict).toBe('violated');
    expect(r.violations).toEqual([
      {
        propertyId: 't.tool/state.enum',
        kind: 'enum',
        path: 'items[1].state',
        expected: 'one of "open", "closed"',
        actual: 'archived',
        message: '1 of 2 states not one of "open", "closed" (b = "archived")',
      },
    ]);
  });
  test('a single value reads plainly; null and absent are notNull’s job', () => {
    const one = contract([{ id: 'state.enum', kind: 'enum', path: 'state', values: ['open', 1] }]);
    expect(run(one, { state: 2 }).violations[0]?.message).toBe('state = 2 is not one of "open", 1');
    expect(run(one, { state: 1 }).verdict).toBe('verified');
    expect(run(one, { state: null }).verdict).toBe('verified');
    expect(run(one, {}).verdict).toBe('verified');
  });
  test('onlyKnownGood scopes it to known-good inputs', () => {
    const kg = contract(
      [{ id: 'state.enum', kind: 'enum', path: 'state', values: ['open'], onlyKnownGood: true }],
      { knownGoodInputs: [{ id: 'k' }] },
    );
    expect(run(kg, { state: 'x' }, { args: { id: 'other' } }).checked).toEqual([]);
    expect(run(kg, { state: 'x' }, { args: { id: 'k' } }).verdict).toBe('violated');
  });
  test('perElement: one violation per unknown value', () => {
    const r = evaluate(
      c,
      { args: {}, result: ok({ items: [{ state: 'x' }, { state: 'open' }, { state: 'y' }] }), now: NOW },
      { perElement: true },
    );
    expect(r.violations.map((v) => [v.path, v.actual])).toEqual([
      ['items[0].state', 'x'],
      ['items[2].state', 'y'],
    ]);
  });
});

describe('crossField', () => {
  const c = contract([
    {
      id: 'discount.lte.price',
      kind: 'crossField',
      path: 'items[*]',
      left: 'discount',
      op: '<=',
      right: 'price',
    },
  ]);
  test('holds on every element: verified; fails on one: violated at that element', () => {
    expect(
      run(c, {
        items: [
          { price: 10, discount: 2 },
          { price: 5, discount: 5 },
        ],
      }).verdict,
    ).toBe('verified');
    const r = run(c, {
      items: [
        { price: 10, discount: 2 },
        { price: 5, discount: 9 },
      ],
    });
    expect(r.violations).toEqual([
      {
        propertyId: 't.tool/discount.lte.price',
        kind: 'crossField',
        path: 'items[1].discount',
        expected: 'discount <= price',
        actual: 9,
        message: 'items[1].discount = 9 but items[1].price = 5, expected discount <= price',
      },
    ]);
  });
  test('top-level fields, tolerance, timestamps, JSON equality', () => {
    const eq = contract([
      { id: 'sum', kind: 'crossField', left: 'total', op: '==', right: 'sum', tolerance: 0.01 },
    ]);
    expect(run(eq, { total: 10.004, sum: 10 }).verdict).toBe('verified');
    expect(run(eq, { total: 10.5, sum: 10 }).violations[0]?.message).toBe(
      'total = 10.5 but sum = 10, expected total == sum',
    );
    const time = contract([{ id: 'order', kind: 'crossField', left: 'created', op: '<=', right: 'updated' }]);
    expect(
      run(time, { created: '2026-10-01T00:00:00Z', updated: Date.parse('2026-10-02T00:00:00Z') }).verdict,
    ).toBe('verified');
    expect(run(time, { created: '2026-10-03T00:00:00Z', updated: '2026-10-02T00:00:00Z' }).verdict).toBe(
      'violated',
    );
    const same = contract([{ id: 'cur', kind: 'crossField', left: 'a.cur', op: '==', right: 'b.cur' }]);
    expect(run(same, { a: { cur: 'USD' }, b: { cur: 'USD' } }).verdict).toBe('verified');
    expect(run(same, { a: { cur: 'USD' }, b: { cur: 'EUR' } }).verdict).toBe('violated');
  });
  test('missing sides and incomparable values are skipped, not violated', () => {
    const c2 = contract([{ id: 'x', kind: 'crossField', left: 'a', op: '<', right: 'b' }]);
    expect(run(c2, { a: 1 }).verdict).toBe('verified');
    expect(run(c2, { a: 'abc', b: 2 }).verdict).toBe('verified');
    expect(run(c2, { a: null, b: 2 }).verdict).toBe('verified');
  });
  test('perElement: every violating element', () => {
    const r = evaluate(
      c,
      {
        args: {},
        result: ok({
          items: [
            { price: 1, discount: 3 },
            { price: 9, discount: 1 },
            { price: 2, discount: 4 },
          ],
        }),
        now: NOW,
      },
      { perElement: true },
    );
    expect(r.violations.map((v) => v.path)).toEqual(['items[0].discount', 'items[2].discount']);
  });
});

describe('pageComplete', () => {
  const c = contract([{ id: 'pages', kind: 'pageComplete', upstreamCursorPath: 'next_cursor' }]);
  test('last page read has no cursor: verified', () => {
    const r = run(c, { items: [] }, { upstream: upstream([{ next_cursor: 'c2' }, { next_cursor: null }]) });
    expect(r.verdict).toBe('verified');
    expect(r.checked).toEqual(['t.tool/pages']);
  });
  test('a final page that omits the cursor ends the list: verified', () => {
    const r = run(
      c,
      { items: [1, 2] },
      { upstream: upstream([{ items: [1], next_cursor: 'c2' }, { items: [2] }]) },
    );
    expect(r.verdict).toBe('verified');
    expect(r.checked).toEqual(['t.tool/pages']);
    for (const done of [null, false, '']) {
      const end = run(c, {}, { upstream: upstream([{ next_cursor: 'c2' }, { next_cursor: done }]) });
      expect(end.verdict).toBe('verified');
    }
  });
  test('only responses for the paginated request path decide; other 2xx calls do not', () => {
    const mixed: EvalInput['upstream'] = [
      ...(upstream([{ items: [1], next_cursor: 'c2' }]) ?? []),
      {
        seq: 1,
        startedAt: '',
        durationMs: 0,
        request: { method: 'GET', url: '/stock/1', headers: {}, body: null },
        response: { status: 200, headers: {}, body: JSON.stringify({ qty: 3 }) },
      },
    ];
    const r = run(c, {}, { upstream: mixed });
    expect(r.verdict).toBe('violated');
    expect(r.violations[0]?.message).toBe(
      'list is incomplete, the tool stopped after 1 upstream page but upstream next_cursor = "c2"',
    );
  });
  test('the tool stopped while upstream still had a cursor: violated', () => {
    const r = run(c, { items: [] }, { upstream: upstream([{ items: [1], next_cursor: 'c2' }]) });
    expect(r.violations).toEqual([
      {
        propertyId: 't.tool/pages',
        kind: 'pageComplete',
        path: 'next_cursor',
        expected: 'upstream next_cursor empty on the last page read',
        actual: 'c2',
        message: 'list is incomplete, the tool stopped after 1 upstream page but upstream next_cursor = "c2"',
      },
    ]);
  });
  test('boolean has_more style cursors', () => {
    const hm = contract([{ id: 'pages', kind: 'pageComplete', upstreamCursorPath: 'has_more' }]);
    expect(run(hm, {}, { upstream: upstream([{ has_more: true }, { has_more: false }]) }).verdict).toBe(
      'verified',
    );
    expect(
      run(hm, {}, { upstream: upstream([{ has_more: true }, { has_more: true }]) }).violations[0]?.message,
    ).toBe('list is incomplete, the tool stopped after 2 upstream pages but upstream has_more = true');
  });
  test('skipped when no upstream response carries the cursor, or upstream is unknown', () => {
    expect(run(c, {}, { upstream: upstream([{ items: [] }]) }).checked).toEqual([]);
    expect(run(c, {}, { upstream: upstream([{ next_cursor: 'c' }], 500) }).checked).toEqual([]);
    expect(run(c, {}).checked).toEqual([]);
  });
});

test('describeViolation: one receipt line naming the property', () => {
  const r = run(contract([{ id: 'p', kind: 'range', path: 'price', min: 20, max: 2000, unit: 'USD' }]), {
    price: 5,
  });
  const v = r.violations[0];
  expect(v && describeViolation(v)).toBe('t.tool/p: price = 5 is outside 20-2000 USD (expected 20-2000 USD)');
});

describe('perElement (round 7)', () => {
  const search = findContract(SHOP_CONTRACTS, 'search_products');
  const page = (prices: number[]) =>
    ok({
      items: prices.map((price, i) => ({ id: `ext-${i}`, name: 'x', price })),
      count: prices.length,
      total: prices.length,
    });
  test('items.price.range on [9, 50, 5000]: two violations with perElement, ec241bc single one by default', () => {
    const input: EvalInput = { args: { query: 'grid-q' }, result: page([9, 50, 5000]), now: NOW };
    const per = evaluate(search, input, { perElement: true });
    expect(per.violations.map((v) => [v.propertyId, v.path, v.actual])).toEqual([
      ['shop.search_products/items.price.range', 'items[0].price', 9],
      ['shop.search_products/items.price.range', 'items[2].price', 5000],
    ]);
    const dflt = evaluate(search, input);
    expect(dflt.violations).toHaveLength(1);
    expect(dflt.violations[0]?.path).toBe('items[0].price');
    const old = ec241bc.evaluate(findContract(ec241bc.contracts, 'search_products'), input);
    expect(JSON.stringify(dflt)).toBe(JSON.stringify(old));
  });

  const cases: [string, Invariant, Record<string, unknown>, string[]][] = [
    [
      'notNull',
      { id: 'n', kind: 'notNull', path: 'items[*].price' },
      { items: [{ price: null }, { price: 1 }, {}] },
      ['items[0].price', 'items[2].price'],
    ],
    [
      'nonEmpty',
      { id: 'e', kind: 'nonEmpty', path: 'groups[*].items' },
      { groups: [{ items: [] }, { items: [1] }, { items: [] }] },
      ['groups[0].items', 'groups[2].items'],
    ],
    [
      'unique',
      { id: 'u', kind: 'unique', path: 'items[*].id' },
      { items: [{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'b' }] },
      ['items[2].id', 'items[3].id'],
    ],
    [
      'freshness',
      { id: 'f', kind: 'freshness', path: 'items[*].at', maxAgeDays: 30 },
      { items: [{ at: '1970-01-01T00:00:00Z' }, { at: '2026-10-17T00:00:00Z' }, { at: 'soon' }] },
      ['items[0].at', 'items[2].at'],
    ],
  ];
  test.each(cases)(
    '%s: every bad element with perElement; default byte-identical to ec241bc',
    (_k, inv, data, paths) => {
      const c = contract([inv]);
      const input: EvalInput = { args: {}, result: ok(data), now: NOW };
      expect(evaluate(c, input, { perElement: true }).violations.map((v) => v.path)).toEqual(paths);
      const dflt = evaluate(c, input);
      expect(dflt.violations.map((v) => v.path)).toEqual([paths[0]]);
      expect(JSON.stringify(dflt)).toBe(JSON.stringify(ec241bc.evaluate(c, input)));
    },
  );
});

describe('disabled properties (round 6)', () => {
  const base = findContract(SHOP_CONTRACTS, 'get_product') as ToolContract;
  const off: ToolContract = {
    ...base,
    invariants: base.invariants.map((i) =>
      i.id === 'price.range' ? { ...i, disabled: true as const, disabledReason: 'S-dev' } : i,
    ),
  };
  const input: EvalInput = { args: { id: 'p-1001' }, result: ok({ id: 'p-1001', price: 119900 }), now: NOW };
  test('skipped, listed under disabled[], absent from checked[]', () => {
    expect(evaluate(base, input).verdict).toBe('violated');
    const r = evaluate(off, input);
    expect(r.verdict).toBe('verified');
    expect(r.violations).toEqual([]);
    expect(r.disabled).toEqual(['shop.get_product/price.range']);
    expect(r.checked).not.toContain('shop.get_product/price.range');
    expect(r.checked).toEqual(['shop.get_product/price.notNull']);
  });
  test('reenable evaluates it as if enabled', () => {
    const r = evaluate(off, input, { reenable: ['shop.get_product/price.range'] });
    expect(r.verdict).toBe('violated');
    expect(r.violations[0]?.propertyId).toBe('shop.get_product/price.range');
    expect(r.disabled).toBeUndefined();
    expect(JSON.stringify(r)).toBe(JSON.stringify(evaluate(base, input)));
  });
  test('a disabled postcondition is skipped too', () => {
    const order = findContract(SHOP_CONTRACTS, 'create_order') as ToolContract;
    const offPost: ToolContract = {
      ...order,
      postconditions: order.postconditions?.map((p) => ({ ...p, disabled: true as const })),
    };
    const r = evaluate(offPost, { args: {}, result: ok({ order_id: 'o-1', total: 30 }), now: NOW });
    expect(r.verdict).toBe('verified');
    expect(r.disabled).toEqual(['shop.create_order/readAfterWrite']);
  });
  test('no disabled flags: receipts byte-identical to ec241bc on the D1–D5 scenario traces', () => {
    const fixture = (name: string) =>
      JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')) as unknown;
    const records = fixture('scenario-records.json') as ScenarioRecord[];
    const schemas = fixture('tool-schemas.seed-v1.json') as ToolSchemas;
    expect(new Set(records.map((r) => r.scenario))).toEqual(
      new Set(['v1-all', 'D1', 'D2', 'D3', 'D4', 'D5']),
    );
    for (const rec of records) {
      const inp = inputOf(rec, schemas.tools[rec.tool]);
      const now = evaluate(findContract(SHOP_CONTRACTS, rec.tool), inp);
      const old = ec241bc.evaluate(findContract(ec241bc.contracts, rec.tool), inp);
      expect(JSON.stringify(now)).toBe(JSON.stringify(old));
      // v1 never violates (the unknown-id call is an isError result: unverifiable); every drift does.
      if (rec.scenario === 'v1-all') expect(now.verdict).not.toBe('violated');
      else expect(now.verdict).toBe('violated');
    }
  });
});

describe('fpCapability (PLAN §3.1, frozen at F2)', () => {
  test('the shop table', () => {
    const rows = fpCapabilityTable(SHOP_CONTRACTS, () => ({ paginated: false }));
    const pick = (cap: string) =>
      rows
        .filter((r) => r.capability === cap)
        .map((r) => r.propertyId)
        .sort();
    expect(rows).toHaveLength(12);
    expect(pick('capable')).toEqual(
      [
        'shop.search_products/items.price.range',
        'shop.get_product/price.range',
        'shop.create_order/total.range',
        'shop.get_order/created_at.freshness',
        'shop.get_order/total.range',
      ].sort(),
    );
    expect(pick('knownGoodOnly')).toEqual([
      'shop.get_product/price.notNull',
      'shop.search_products/items.nonEmpty',
    ]);
    expect(pick('entailed')).toEqual(
      [
        'shop.search_products/countMatchesTotal',
        'shop.search_products/total.equalsUpstream',
        'shop.search_products/items.id.unique',
        'shop.get_order/created_at.equalsUpstream',
        'shop.create_order/readAfterWrite',
      ].sort(),
    );
    expect(Object.fromEntries(rows.map((r) => [r.propertyId, r.family]))).toMatchObject({
      'shop.search_products/items.price.range': 'price',
      'shop.get_order/created_at.freshness': 'created_at',
      'shop.get_order/total.range': 'total',
      'shop.search_products/items.id.unique': 'id',
    });
  });
  test('the kind rules', () => {
    const unpaged = { paginated: false };
    const paged = { paginated: true };
    const count: Invariant = { id: 'c', kind: 'countMatchesTotal', itemsPath: 'items', totalPath: 'total' };
    expect(fpCapability(count, unpaged)).toBe('entailed');
    expect(fpCapability(count, paged)).toBe('capable');
    expect(fpCapability({ id: 'u', kind: 'unique', path: 'items[*].id' }, unpaged)).toBe('entailed');
    expect(fpCapability({ id: 'u', kind: 'unique', path: 'items[*].name' }, unpaged)).toBe('capable');
    expect(
      fpCapability({ id: 'u', kind: 'unique', path: 'issues[*].key' }, { ...unpaged, idFamilies: ['key'] }),
    ).toBe('entailed');
    expect(fpCapability({ id: 'e', kind: 'equalsUpstream', path: 'a', upstreamPath: 'a' }, unpaged)).toBe(
      'entailed',
    );
    for (const inv of [
      { id: 'r', kind: 'range', path: 'a' },
      { id: 'f', kind: 'freshness', path: 'a', maxAgeDays: 1 },
      { id: 'n', kind: 'notNull', path: 'a' },
      { id: 'ne', kind: 'nonEmpty', path: 'a' },
      { id: 'en', kind: 'enum', path: 'a', values: [1] },
      { id: 'x', kind: 'crossField', left: 'a', op: '<', right: 'b' },
      { id: 'p', kind: 'pageComplete', upstreamCursorPath: 'next' },
    ] as Invariant[]) {
      expect(fpCapability(inv, unpaged)).toBe('capable');
    }
    expect(
      fpCapability({ id: 'en', kind: 'enum', path: 'a', values: [1], onlyKnownGood: true }, unpaged),
    ).toBe('knownGoodOnly');
  });
  test('propertyFamily = last non-index path segment (D12)', () => {
    expect(propertyFamily('items[*].price')).toBe('price');
    expect(propertyFamily('total')).toBe('total');
    expect(propertyFamily('created_at')).toBe('created_at');
    expect(propertyFamily('items[2].price')).toBe('price');
    expect(propertyFamily('orders[*].lines[*]')).toBe('lines');
  });
});
