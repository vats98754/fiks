// Pure parts of @fiks/frame: binomial design, path resolution, DET's per-property compare rule,
// drift attribution and IV sets, frame-k on hand-built records, and the enumeration layers.
import type { ContractFile, ToolContract } from '@fiks/contracts';
import type { DomainCall, EnumerateOptions, EnumRow } from '@fiks/interfaces';
import { describe, expect, test } from 'vitest';
import {
  attributeCall,
  binomCdf,
  type DetCallRecord,
  driftEnumeration,
  endpointMetaFor,
  entityOfUnit,
  frameDedupeKey,
  frameEnumeration,
  frameK,
  h1Design,
  ivSets,
  perPropertyVerdicts,
  resolvePath,
  ruleMatches,
  seededSample,
  sidecarPath,
  toolTouches,
  truthLabel,
} from '../src/index.ts';

describe('binomial design (PLAN 3.1)', () => {
  test('N_E 1500: crit 18, size 0.0123, power 0.821 / >= 0.99; N_E 1000: crit 10, power 0.583', () => {
    const d = h1Design(1500);
    expect(d.crit).toBe(18);
    expect(binomCdf(18, 1500, 0.02)).toBeCloseTo(0.0123, 4);
    expect(d.power.pi01).toBeCloseTo(0.821, 3);
    expect(d.power.pi005).toBeGreaterThanOrEqual(0.99);
    expect(d).toMatchObject({ m: 4, underpowered: false });
    const k = h1Design(1000);
    expect(k.crit).toBe(10);
    expect(k.power.pi01).toBeCloseTo(0.583, 3);
  });

  test('the test can reject only from N_E = 217 (crit -1 and m = 3 below)', () => {
    expect(h1Design(216)).toMatchObject({ crit: -1, m: 3, underpowered: true });
    expect(h1Design(217)).toMatchObject({ crit: 0, m: 4 });
    expect(h1Design(0)).toMatchObject({ crit: -1, m: 3, power: { pi01: 0, pi005: 0 } });
  });
});

test('resolvePath gives concrete element paths', () => {
  const data = { items: [{ price: 9 }, { price: 50 }, {}], total: 3 };
  expect(resolvePath(data, 'items[*].price')).toEqual([
    { at: 'items[0].price', value: 9 },
    { at: 'items[1].price', value: 50 },
    { at: 'items[2].price', value: undefined },
  ]);
  expect(resolvePath(data, 'total')).toEqual([{ at: 'total', value: 3 }]);
  expect(resolvePath(data, 'missing.x')).toEqual([{ at: 'missing.x', value: undefined }]);
});

const ORDER: ToolContract = {
  id: 'shop.create_order',
  tool: 'create_order',
  invariants: [{ id: 'total.range', kind: 'range', path: 'total', min: 0.5 }],
  postconditions: [
    { id: 'readAfterWrite', probeTool: 'get_order', probeArgs: { order_id: 'order_id' }, expect: [] },
  ],
};

describe('per-property verdicts (DET compare rule)', () => {
  test('violated / verified / unverifiable; a postcondition without a recorded probe is unverifiable', () => {
    const evaluation = {
      checked: [
        'shop.create_order/outputSchema',
        'shop.create_order/total.range',
        'shop.create_order/readAfterWrite',
      ],
      violations: [{ propertyId: 'shop.create_order/readAfterWrite' }],
    };
    expect(perPropertyVerdicts(evaluation, ORDER, { probeRecorded: false })).toEqual({
      'shop.create_order/total.range': 'verified',
      'shop.create_order/readAfterWrite': 'unverifiable',
      'shop.create_order/outputSchema': 'verified',
    });
    expect(
      perPropertyVerdicts(evaluation, ORDER, { probeRecorded: true })['shop.create_order/readAfterWrite'],
    ).toBe('violated');
    expect(perPropertyVerdicts(null, ORDER, { probeRecorded: true })).toEqual({
      'shop.create_order/total.range': 'unverifiable',
      'shop.create_order/readAfterWrite': 'unverifiable',
    });
  });
});

const SEARCH: ToolContract = {
  id: 'shop.search_products',
  tool: 'search_products',
  invariants: [
    { id: 'items.price.range', kind: 'range', path: 'items[*].price', min: 20, max: 2000 },
    { id: 'countMatchesTotal', kind: 'countMatchesTotal', itemsPath: 'items', totalPath: 'total' },
    { id: 'items.id.unique', kind: 'unique', path: 'items[*].id' },
    { id: 'items.nonEmpty', kind: 'nonEmpty', path: 'items', onlyKnownGood: true },
  ],
};

function rec(over: Partial<DetCallRecord> & { receipt?: unknown }): DetCallRecord {
  const { receipt, ...rest } = over;
  return {
    callId: 'c1',
    inputId: 'c1',
    seq: 0,
    domain: 'shop',
    stratum: 'S-grid',
    catalog: 'extended-only',
    drift: null,
    mutant: null,
    tool: 'search_products',
    args: { query: 'zephyr' },
    upstream: [
      {
        request: { method: 'GET', url: '/products?q=zephyr', headers: {}, body: null },
        response: { status: 200, headers: {}, body: '{"items":[],"total":3}' },
      },
    ],
    output: {
      structuredContent: {
        items: [
          { id: 'px-a', price: 9 },
          { id: 'px-b', price: 50 },
          { id: 'px-c', price: 5000 },
        ],
        count: 3,
        total: 3,
      },
    },
    events: [{ type: 'call', ...(receipt ? { receipt } : {}) }],
    entityClass: {
      '': 'all',
      'items[0].price': 'gadget',
      'items[1].price': 'gadget',
      'items[2].price': 'tool',
    },
    originUnit: {
      '': 'query:zephyr',
      items: 'query:zephyr',
      'items[0].price': 'px-a',
      'items[1].price': 'px-b',
      'items[2].price': 'px-c',
    },
    capturedAt: '2026-10-01T12:00:00.000Z',
    controlOf: null,
    truth: { inputValid: true, agrees: true, mismatches: [] },
    ...rest,
  };
}

const receipt = (violations: { propertyId: string; path: string }[], checked: string[]) => ({
  verdict: violations.length ? 'violated' : 'verified',
  contractId: 'shop.search_products',
  checked,
  violations: violations.map((v) => ({ ...v, kind: 'x', expected: '', actual: null, message: '' })),
});

describe('drift attribution and IV sets', () => {
  const ALL = [
    'shop.search_products/items.price.range',
    'shop.search_products/countMatchesTotal',
    'shop.search_products/items.id.unique',
  ];
  const drift = rec({
    receipt: receipt(
      [
        { propertyId: 'shop.search_products/items.price.range', path: 'items[0].price' },
        { propertyId: 'shop.search_products/countMatchesTotal', path: 'items' },
      ],
      ALL,
    ),
  });
  const control = rec({
    callId: 'c1~v1',
    controlOf: 'c1',
    receipt: receipt([{ propertyId: 'shop.search_products/items.price.range', path: 'items[0].price' }], ALL),
  });

  test('a violation is attributable iff its property verifies on the control', () => {
    const a = attributeCall(drift, control, SEARCH);
    expect(a.attributable).toEqual(['shop.search_products/countMatchesTotal']);
    expect(a.nonattributable).toEqual([
      expect.objectContaining({
        property: 'shop.search_products/items.price.range',
        entity: 'px-a',
        originUnit: 'px-a',
        entityClass: 'gadget',
        controlVerdict: 'violated',
        controlCallId: 'c1~v1',
      }),
    ]);
    // No control: nothing is attributable (fail closed).
    expect(attributeCall(drift, undefined, SEARCH).attributable).toEqual([]);
  });

  test('ivProperties = properties verified on the control; the rest excluded with their verdicts', () => {
    expect(ivSets(control, SEARCH)).toEqual({
      ivProperties: ['shop.search_products/countMatchesTotal', 'shop.search_products/items.id.unique'],
      ivExcluded: [
        { property: 'shop.search_products/items.price.range', controlVerdict: 'violated' },
        { property: 'shop.search_products/items.nonEmpty', controlVerdict: 'unverifiable' },
      ],
    });
    expect(sidecarPath('/x/D4-plantedfp.trace.json')).toBe('/x/D4-plantedfp.trace.iv.json');
    expect(entityOfUnit('query:zephyr')).toBeNull();
    expect(entityOfUnit('px-a')).toBe('px-a');
  });
});

describe('frame-k', () => {
  const contracts: ContractFile = { server: 'shop-mcp', version: 1, contracts: [SEARCH] };
  const entities = ['px-a', 'px-b', 'px-c', 'px-d'].map((id) => ({
    id,
    authorBatch: id === 'px-d' ? 'b02' : 'b01',
  }));

  test('per-element attribution, Clean, dedupe, families, cells; nothing is evaluated', () => {
    const a = rec({});
    const dup = rec({ callId: 'c2', inputId: 'c2', seq: 1 });
    const wrong = rec({
      callId: 'c3',
      inputId: 'c3',
      seq: 2,
      args: { query: 'other' },
      truth: { inputValid: true, agrees: false, mismatches: ['items[0].name'] },
    });
    const empty = rec({
      callId: 'c4',
      inputId: 'c4',
      seq: 3,
      args: { query: 'none' },
      output: { structuredContent: { items: [], count: 0, total: 0 } },
    });
    const r = frameK({
      domains: [{ id: 'shop', contracts, paginatedEndpoints: [], entities }],
      records: [a, dup, wrong, empty],
      recordSetSha256: 'a'.repeat(64),
    });
    expect(r.duplicates).toEqual(['c2']);
    expect(r.notClean).toEqual([{ inputId: 'c3', tool: 'search_products', mismatches: ['items[0].name'] }]);
    expect(r.ineligible).toBe(1);
    expect(r.spec.nF).toBe(3);
    expect(r.spec.eligibleInputs).toEqual(['c1']);
    expect(r.spec.attribution).toEqual({
      c1: { 'items[0].price': 'px-a', 'items[1].price': 'px-b', 'items[2].price': 'px-c' },
    });
    expect(r.spec.entities.map((e) => [e.id, e.eligible])).toEqual([
      ['px-a', true],
      ['px-b', true],
      ['px-c', true],
      ['px-d', false],
    ]);
    expect(r.spec.NE).toBe(3);
    expect(r.spec.families).toEqual({ 'shop.search_products/items.price.range': 'price' });
    expect(r.spec.entailedProps).toEqual([
      'shop.search_products/countMatchesTotal',
      'shop.search_products/items.id.unique',
      'shop.search_products/outputSchema',
    ]);
    expect(r.capability['shop.search_products/items.nonEmpty']).toBe('knownGoodOnly');
    expect(r.spec.cells).toEqual([
      {
        contract: 'shop.search_products',
        property: 'shop.search_products/items.price.range',
        class: 'gadget',
        nInputs: 1,
      },
      {
        contract: 'shop.search_products',
        property: 'shop.search_products/items.price.range',
        class: 'tool',
        nInputs: 1,
      },
    ]);
    expect(r.spec.K).toBe(2);
    expect(r.spec.crit).toBe(-1);
    expect(r.spec.neRule).toEqual({ topUpBatches: 0, underpowered: true, m: 3 });
    expect(frameDedupeKey(a)).toBe(frameDedupeKey(dup));
  });

  test('countMatchesTotal on a paginated endpoint is FP-capable and attributed to the S-grid query', () => {
    expect(
      endpointMetaFor('tracker', 'search_issues', [{ method: 'GET', pathPattern: '^/issues$' }]),
    ).toEqual({
      paginated: true,
      idFamilies: ['id', 'key'],
    });
    const paged = frameK({
      domains: [
        {
          id: 'shop',
          contracts,
          paginatedEndpoints: [{ method: 'GET', pathPattern: '^/products$' }],
          entities,
        },
      ],
      records: [rec({})],
      recordSetSha256: 'b'.repeat(64),
    });
    expect(paged.spec.families['shop.search_products/countMatchesTotal']).toBe('items');
    expect(paged.spec.attribution.c1?.items).toBe('query:zephyr');
  });
});

describe('enumerations', () => {
  const products = ['p-1', 'p-2', 'px-1', 'px-2', 'px-3'];
  const domain = {
    id: 'shop',
    enumerate(o: EnumerateOptions): EnumRow[] {
      const ids = products.filter((p) =>
        o.catalog === 'original'
          ? !p.startsWith('px')
          : o.catalog === 'extended-only'
            ? p.startsWith('px')
            : true,
      );
      const rows: EnumRow[] = [];
      const add = (stratum: string, tool: string, args: Record<string, unknown>, k: string) =>
        rows.push({ domain: 'shop', stratum, tool, args, dedupeKey: `${stratum}:${tool}:${k}` });
      if (!o.stratum || o.stratum === 'S-ext') for (const id of ids) add('S-ext', 'get_product', { id }, id);
      if (!o.stratum || o.stratum === 'S-grid') {
        add('S-grid', 'search_products', { query: 'laptop' }, 'laptop');
        add('S-grid', 'search_products', { query: 'p-1' }, 'p1q');
        add('S-grid', 'search_products', { query: 'gad' }, 'gad');
      }
      if (!o.stratum || o.stratum === 'S-write')
        for (const id of ids) {
          add('S-write', 'create_order', { items: [{ product_id: id, quantity: 1 }] }, id);
          add('S-write', 'get_order', { order_id: '$prev.order_id' }, id);
        }
      return rows;
    },
    originEntity(call: DomainCall): Record<string, string> {
      if (call.tool === 'get_product') return { '': String(call.args.id) };
      if (call.tool === 'create_order')
        return { '': String((call.args.items as { product_id: string }[])[0]?.product_id) };
      if (call.tool === 'search_products') return { '': `query:${String(call.args.query)}` };
      return { '': 'order:x' };
    },
  };

  test('frame: no known-good input, no row naming an original entity', () => {
    const r = frameEnumeration(domain, {
      catalog: 'extended-only',
      seed: 1,
      knownGood: { search_products: [{ query: 'laptop' }] },
    });
    expect(r.excluded).toMatchObject({ knownGood: 1, original: 1 });
    expect(r.rows.map((x) => x.dedupeKey)).not.toContain('S-grid:search_products:laptop');
    expect(r.rows.map((x) => x.dedupeKey)).not.toContain('S-grid:search_products:p1q');
    expect(r.rows.filter((x) => x.stratum === 'S-ext')).toHaveLength(3);
  });

  test('per drift: touching tools x (original + sample), the grid, S-write pairs kept together', () => {
    const products404 = { method: 'GET', pathPattern: '^/products/[^/]+$' };
    const r = driftEnumeration(domain, { match: products404, seed: 'X', sampleSize: 2, gridSize: 2 });
    expect(r.sample?.original).toEqual(['p-1', 'p-2']);
    expect(r.sample?.extended).toHaveLength(2);
    const ext = r.rows.filter((x) => x.stratum === 'S-ext').map((x) => x.args.id);
    expect(ext).toEqual(['p-1', 'p-2', ...products.filter((p) => r.sample?.extended.includes(p))]);
    expect(r.rows.filter((x) => x.stratum === 'S-grid')).toHaveLength(2);
    expect(r.rows.filter((x) => x.stratum === 'S-write')).toHaveLength(0);
    const orders = driftEnumeration(domain, {
      match: { method: 'POST', pathPattern: '^/orders$' },
      seed: 'X',
      sampleSize: 0,
    });
    const w = orders.rows.filter((x) => x.stratum === 'S-write').map((x) => x.tool);
    expect(w).toEqual(['create_order', 'get_order', 'create_order', 'get_order']);
    expect(orders.rows.filter((x) => x.stratum === 'S-ext')).toHaveLength(0);
    expect(seededSample(['a', 'b', 'c', 'd'], 2, 's')).toEqual(seededSample(['d', 'c', 'b', 'a'], 2, 's'));
  });

  test('rule matching follows the injector rule format', () => {
    expect(ruleMatches({ method: 'GET|POST', pathPattern: '^/orders(/[^/]+)?$' }, 'post', '/orders')).toBe(
      true,
    );
    expect(ruleMatches({ method: 'GET', pathPattern: '^/products$' }, 'GET', '/products/x')).toBe(false);
    expect(toolTouches('shop', 'search_products', { method: 'GET', pathPattern: '^/products$' })).toBe(true);
    expect(
      toolTouches('tracker', 'list_comments', { method: 'GET', pathPattern: '^/issues/[^/]+/comments$' }),
    ).toBe(true);
    expect(
      toolTouches('tracker', 'add_comment', { method: 'GET', pathPattern: '^/issues/[^/]+/comments$' }),
    ).toBe(false);
  });
});

test('truth labels', () => {
  expect(truthLabel({ inputValid: true, agrees: true, mismatches: [] })).toBe('correct');
  expect(truthLabel({ inputValid: true, agrees: false, mismatches: ['price'] })).toBe('wrong');
  expect(truthLabel({ inputValid: false, agrees: true, mismatches: [] })).toBe('invalid-input');
});
