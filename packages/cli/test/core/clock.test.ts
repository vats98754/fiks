// Frozen clock (PLAN 3.1 "Clock", round 6): startHarness passes its clock to the vendor and to
// ProxyOptions.now, so freshness is judged at the frozen instant and CallRecord.at equals it.
import type { CallRecord } from '@fiks/proxy';
import { expect, test } from 'vitest';
import { startHarness } from '../../src/harness.ts';

const CLOCK = new Date('2024-01-01T00:00:00Z');

test('a 2024 clock: get_order created_at.freshness is verified with the wall clock in 2026; at = clock', async () => {
  expect(new Date().getUTCFullYear()).toBeGreaterThanOrEqual(2026);
  const records: CallRecord[] = [];
  const h = await startHarness({
    vendor: 'v1',
    via: 'proxy',
    clock: CLOCK,
    onCall: (rec) => {
      records.push(rec);
      return undefined;
    },
  });
  try {
    const created = await h.call('create_order', { items: [{ product_id: 'p-1004', quantity: 1 }] });
    const orderId = (created.result.structuredContent as { order_id: string }).order_id;
    const read = await h.call('get_order', { order_id: orderId });
    const out = read.result.structuredContent as { created_at: string };
    expect(out.created_at).toBe(CLOCK.toISOString()); // vendor clock
    const rec = records.at(-1) as CallRecord;
    expect(rec.tool).toBe('get_order');
    expect(rec.at).toBe(CLOCK.toISOString()); // proxy now = vendor clock
    expect(rec.receipt.checked).toContain('shop.get_order/created_at.freshness');
    expect(rec.receipt.violations.map((v) => v.propertyId)).not.toContain(
      'shop.get_order/created_at.freshness',
    );
    expect(rec.receipt.verdict).toBe('verified');
    for (const r of records) expect(r.at).toBe(CLOCK.toISOString());
  } finally {
    await h.close();
  }
}, 120_000);
