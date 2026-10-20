import type { Violation } from '@fiks/contracts';
import { describe, expect, test } from 'vitest';
import { makeReceipt, receiptText } from '../src/index.ts';

const at = new Date('2026-10-18T00:00:00Z');
const TRACE = 'tr_3f9a1c2b7e';
const v = (propertyId: string, kind: string, path: string, message: string): Violation => ({
  propertyId,
  kind,
  path,
  expected: '',
  actual: null,
  message,
});
const violated = (vs: Violation[], hints: string[] = []) =>
  makeReceipt(
    { verdict: 'violated', contractId: 'shop.x', checked: [], violations: vs },
    at,
    true,
    TRACE,
    hints,
  );

// The real messages each drift produces (see packages/contracts/src/evaluate.ts).
const DRIFTS: Record<string, [string, Violation[]]> = {
  D1: [
    'search_products',
    [
      v(
        'shop.search_products/items.price.range',
        'range',
        'items[0].price',
        '4 of 4 prices outside 20-2000 USD (p-1001 = 119900)',
      ),
    ],
  ],
  D2: [
    'get_product',
    [v('shop.get_product/price.notNull', 'notNull', 'price', 'price is null, but p-1001 should have one')],
  ],
  D3: [
    'create_order',
    [
      v(
        'shop.create_order/readAfterWrite',
        'readAfterWrite',
        'get_order',
        'not found on read-back: get_order o-5002 returned an error',
      ),
    ],
  ],
  D4: [
    'search_products',
    [
      v(
        'shop.search_products/countMatchesTotal',
        'countMatchesTotal',
        'items',
        'list is incomplete, 5 of 7 matches returned',
      ),
    ],
  ],
  D5: [
    'get_order',
    [
      v(
        'shop.get_order/created_at.freshness',
        'freshness',
        'created_at',
        'created_at shows 1970-01-01, 20744 days old',
      ),
      v(
        'shop.get_order/created_at.equalsUpstream',
        'equalsUpstream',
        'created_at',
        'created_at shows 1970-01-01 but upstream sent 2026-10-16T08:28Z',
      ),
    ],
  ],
  'D1+D4': [
    'search_products',
    [
      v(
        'shop.search_products/items.price.range',
        'range',
        'items[0].price',
        '5 of 5 prices outside 20-2000 USD (p-1101 = 6900)',
      ),
      v(
        'shop.search_products/countMatchesTotal',
        'countMatchesTotal',
        'items',
        'list is incomplete, 5 of 7 matches returned',
      ),
    ],
  ],
};

/** Rough token count (words, 3-digit chunks, punctuation); reads 1-3 low vs o200k on these texts. */
const tokens = (s: string) => (s.match(/[A-Za-z]+|\d{1,3}|[^\sA-Za-z\d]/g) ?? []).length;

describe('violated receipts', () => {
  for (const [id, [tool, vs]] of Object.entries(DRIFTS)) {
    test(`${id}: status first, every distinct fact, an action, under 60 tokens`, () => {
      const text = receiptText(violated(vs), tool);
      expect(text.startsWith(`[fiks] VIOLATED ${tool}: `)).toBe(true);
      expect(text).not.toContain(TRACE); // the trace id is in _meta only
      expect(text).toMatch(/\. (Do not|Don't|Not the full list)\b/);
      expect(tokens(text), text).toBeLessThanOrEqual(60); // two-problem receipts reach ~65 real tokens
    });
  }

  test('D5 gives the real upstream time and says how to use it', () => {
    const text = receiptText(violated(DRIFTS.D5?.[1] ?? []), 'get_order');
    expect(text).toContain('upstream sent 2026-10-16T08:28Z');
    expect(text).toContain('give the upstream value if needed, as unconfirmed');
    expect(text).not.toContain('days old');
  });

  test('D2 with an observed upstream field: names it, as unconfirmed', () => {
    const text = receiptText(
      violated(DRIFTS.D2?.[1] ?? [], ['vendor sent unit_amount = 1199 (in 20-2000 USD)']),
      'get_product',
    );
    expect(text).toContain('vendor sent unit_amount = 1199 (in 20-2000 USD)');
    expect(text).toContain('if you use the vendor value, say unconfirmed');
    expect(tokens(text)).toBeLessThanOrEqual(60);
  });

  test('D2 says the missing value is not meaningful', () => {
    const text = receiptText(violated(DRIFTS.D2?.[1] ?? []), 'get_product');
    expect(text).toContain('price is null, but p-1001 should have one');
    expect(text).toContain("Don't say there is no price");
  });

  test('D1+D4 names both problems and both actions', () => {
    const text = receiptText(violated(DRIFTS['D1+D4']?.[1] ?? []), 'search_products');
    expect(text).toContain('prices outside');
    expect(text).toContain('list is incomplete');
    expect(text).toContain("Not the full list; don't quote flagged values");
  });

  test('D3 warns against claiming success and against blind retries', () => {
    const text = receiptText(violated(DRIFTS.D3?.[1] ?? []), 'create_order');
    expect(text).toContain('Do not tell the user it succeeded or retry without asking');
  });

  test('D4 says the list is incomplete, not that the values are wrong', () => {
    const text = receiptText(violated(DRIFTS.D4?.[1] ?? []), 'search_products');
    expect(text).toContain('Not the full list. Search narrower, then answer.');
    expect(text).not.toContain('flagged values');
  });

  test('more than 3 distinct facts: the rest are counted, not dropped silently', () => {
    const many = ['a', 'b', 'c', 'd'].map((f) => v(`shop.x/${f}`, 'range', f, `${f} is wrong`));
    expect(receiptText(violated(many), 't')).toContain(
      'a is wrong; b is wrong; c is wrong; 1 more in _meta.',
    );
  });
});

describe('other verdicts', () => {
  test('verified: coverage details stay in _meta', () => {
    const e = { verdict: 'verified' as const, contractId: 'c', checked: ['x', 'y'], violations: [] };
    expect(receiptText(makeReceipt(e, at, true), 'get_product')).toBe(
      '[fiks] VERIFIED get_product (2 checks)',
    );
    const r = makeReceipt({ ...e, checked: ['x'] }, at, false);
    expect(receiptText(r, 'get_product')).toBe('[fiks] VERIFIED get_product (1 check)');
    expect(r.upstreamObserved).toBe(false);
  });
  test('not checked', () => {
    const e = { verdict: 'unverifiable' as const, contractId: null, checked: [], violations: [] };
    expect(receiptText(makeReceipt(e, at, true), 'get_product', 'the tool returned an error')).toBe(
      '[fiks] NOT CHECKED get_product: the tool returned an error',
    );
  });
});
