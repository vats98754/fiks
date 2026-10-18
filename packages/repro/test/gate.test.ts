import { expect, test } from 'vitest';
import { classifyFailure } from '../src/index.ts';

const T = ['shop.get_product/price.notNull'];
const at = ' (test/repro/tr_x.json): expected [ Array(1) ] to deeply equal []\n    at check.ts:79';

test('the stated reason: exactly the target properties violated', () => {
  expect(classifyFailure(`AssertionError: shop.get_product/price.notNull violated${at}`, T)).toEqual({
    ok: true,
    reason: 'fails for the stated reason',
  });
  const two = ['shop.get_order/created_at.freshness', 'shop.get_order/created_at.equalsUpstream'];
  const msg = `AssertionError: shop.get_order/created_at.equalsUpstream, shop.get_order/created_at.freshness violated${at}`;
  expect(classifyFailure(msg, two).ok).toBe(true);
});

test('extra violated properties are the wrong reason', () => {
  const r = classifyFailure(
    `AssertionError: shop.get_product/outputSchema, shop.get_product/price.notNull violated${at}`,
    T,
  );
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/expected exactly shop.get_product\/price.notNull/);
});

test('a subset of the target is the wrong reason', () => {
  const two = ['shop.get_order/created_at.freshness', 'shop.get_order/created_at.equalsUpstream'];
  expect(classifyFailure(`AssertionError: shop.get_order/created_at.freshness violated${at}`, two).ok).toBe(
    false,
  );
});

test('other assertion failures are the wrong reason even if they mention the property', () => {
  for (const first of [
    "AssertionError: target properties were not evaluated (x.json): expected [ 'shop.get_product/price.notNull' ] to deeply equal []",
    'AssertionError: tool now returns an error instead of data (x.json): shop.get_product/price.notNull',
    'AssertionError: golden output changed (x.json vs y.json): expected false to be true',
    'AssertionError: UNMATCHED_REQUEST: the current code makes upstream requests x.json never recorded',
    'TypeError: cannot read properties of undefined (shop.get_product/price.notNull violated (',
  ]) {
    expect(classifyFailure(first, T).ok, first).toBe(false);
  }
});

test('an empty target never passes', () => {
  expect(classifyFailure(`AssertionError: shop.get_product/outputSchema violated${at}`, []).ok).toBe(false);
});
