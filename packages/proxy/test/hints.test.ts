import type { ContractFile, EvalResult, HttpExchange } from '@fiks/contracts';
import { SHOP_CONTRACTS } from '@fiks/contracts';
import { expect, test } from 'vitest';
import { receiptHints } from '../src/index.ts';

const c = (tool: string) => (SHOP_CONTRACTS as ContractFile).contracts.find((x) => x.tool === tool);
const ex = (status: number, body: unknown): HttpExchange => ({
  seq: 0,
  startedAt: '',
  durationMs: 0,
  request: { method: 'GET', url: '/', headers: {}, body: null },
  response: { status, headers: {}, body: JSON.stringify(body) },
});
const violated = (
  contractId: string,
  propertyId: string,
  kind: string,
  path: string,
  checked: string[] = [],
): EvalResult => ({
  verdict: 'violated',
  contractId,
  checked: [propertyId, ...checked],
  violations: [{ propertyId, kind, path, expected: '', actual: null, message: '' }],
});

test("notNull: only dropped upstream numbers that pass the field's own range", () => {
  const hints = receiptHints({
    contract: c('get_product'),
    evaluation: violated('shop.get_product', 'shop.get_product/price.notNull', 'notNull', 'price'),
    structured: {
      id: 'p-1001',
      name: 'Aero',
      category: 'laptop',
      price: null,
      currency: 'USD',
      in_stock: true,
    },
    upstream: [
      ex(200, {
        id: 'p-1001',
        name: 'Aero',
        category: 'laptop',
        unit_amount: 1199,
        currency: 'USD',
        stock: 12,
      }),
    ],
    probeUpstream: undefined,
  });
  expect(hints).toEqual(['vendor sent unit_amount = 1199 (in 20-2000 USD)']); // stock = 12 fails the range
});

test('notNull: nothing plausible upstream, no hint', () => {
  const hints = receiptHints({
    contract: c('get_product'),
    evaluation: violated('shop.get_product', 'shop.get_product/price.notNull', 'notNull', 'price'),
    structured: { price: null },
    upstream: [ex(200, { unit_amount: 119900, stock: 3 })],
    probeUpstream: undefined,
  });
  expect(hints).toEqual([]);
});

test('countMatchesTotal: the total is reported only when its own check held', () => {
  const base = {
    contract: c('search_products'),
    structured: { items: [], count: 5, total: 7 },
    upstream: [ex(200, { items: [], total: 7, next_cursor: '5' })],
    probeUpstream: undefined,
  };
  const ok = receiptHints({
    ...base,
    evaluation: violated(
      'shop.search_products',
      'shop.search_products/countMatchesTotal',
      'countMatchesTotal',
      'items',
      ['shop.search_products/total.equalsUpstream'],
    ),
  });
  expect(ok).toEqual(['total 7 verified']);
  const unchecked = receiptHints({
    ...base,
    evaluation: violated(
      'shop.search_products',
      'shop.search_products/countMatchesTotal',
      'countMatchesTotal',
      'items',
    ),
  });
  expect(unchecked).toEqual([]);
});

test('readAfterWrite: the vendor answer to the read-back', () => {
  const hints = receiptHints({
    contract: c('create_order'),
    evaluation: violated(
      'shop.create_order',
      'shop.create_order/readAfterWrite',
      'readAfterWrite',
      'get_order',
    ),
    structured: { order_id: 'o-5002' },
    upstream: [ex(200, { id: 'o-5002' })],
    probeUpstream: [ex(404, { error: 'not_found' })],
  });
  expect(hints).toEqual(['vendor answered 404']);
});

test('no hints on verified results or without a contract', () => {
  const v: EvalResult = { verdict: 'verified', contractId: 'x', checked: [], violations: [] };
  expect(
    receiptHints({
      contract: c('get_product'),
      evaluation: v,
      structured: {},
      upstream: [],
      probeUpstream: undefined,
    }),
  ).toEqual([]);
  expect(
    receiptHints({
      contract: undefined,
      evaluation: v,
      structured: {},
      upstream: [],
      probeUpstream: undefined,
    }),
  ).toEqual([]);
});
