import { expect, test } from 'vitest';
import { runScenario } from '../src/commands/scenario.ts';

const T = 60_000;

test('v1: no false positives', { timeout: T }, async () => {
  const r = await runScenario('v1-all');
  const verdicts = r.calls.map((c) => c.receipt?.verdict);
  expect(verdicts).not.toContain('violated');
  expect(verdicts.filter((v) => v === 'verified')).toHaveLength(9);
});

const EXPECTED: Record<string, string[]> = {
  D1: ['shop.search_products/items.price.range'],
  D2: ['shop.get_product/price.notNull'],
  D3: ['shop.create_order/readAfterWrite'],
  D4: ['shop.search_products/countMatchesTotal'],
  D5: ['shop.get_order/created_at.freshness', 'shop.get_order/created_at.equalsUpstream'],
};

for (const [id, props] of Object.entries(EXPECTED)) {
  test(`${id}: violated receipt names ${props.join(', ')}`, { timeout: T }, async () => {
    const r = await runScenario(id);
    expect(r.calls.flatMap((c) => c.receipt?.violations.map((v) => v.propertyId) ?? [])).toEqual(props);
    expect(r.calls[0]?.text).toMatch(
      new RegExp(`^\\[fiks\\] VIOLATED ${r.calls[0]?.tool}: .+\\. (Do not|Don't|Not the full list)\\b`),
    );
  });
}

test('D2 over Streamable HTTP on both sides of the proxy', { timeout: T }, async () => {
  const r = await runScenario('D2', { transport: 'http' });
  expect(r.calls[0]?.receipt?.verdict).toBe('violated');
});
