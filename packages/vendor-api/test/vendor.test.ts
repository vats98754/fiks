import { afterEach, describe, expect, test } from 'vitest';
import { createVendor, type Vendor } from '../src/index.ts';

const NOW = new Date('2026-10-18T12:00:00.000Z');
let vendor: Vendor | undefined;

async function start(version: 'v1' | 'v2', drifts?: string) {
  vendor = createVendor({ version, drifts, now: () => NOW });
  return vendor.listen();
}

afterEach(async () => {
  await vendor?.close();
  vendor = undefined;
});

const getJson = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  return { status: res.status, headers: res.headers, body: await res.json() };
};

const postOrder = (base: string, headers: Record<string, string> = {}) =>
  getJson(`${base}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ items: [{ product_id: 'p-1004', quantity: 2 }] }),
  });

describe('v1 baseline', () => {
  test('search returns every match in dollars on one page', async () => {
    const base = await start('v1');
    const r = await getJson(`${base}/products?q=cable`);
    expect(r.headers.get('vendor-api-version')).toBe('2026-01-01');
    expect(r.body.total).toBe(7);
    expect(r.body.items).toHaveLength(7);
    expect(r.body.next_cursor).toBeNull();
    expect(r.body.items[0].price).toBe(69);
  });

  test('get_product has price; orders persist; created_at is ISO', async () => {
    const base = await start('v1');
    expect((await getJson(`${base}/products/p-1001`)).body.price).toBe(1199);
    const created = await postOrder(base);
    expect(created.body.total).toBe(1499);
    const read = await getJson(`${base}/orders/${created.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body.created_at).toBe(NOW.toISOString());
    const seed = await getJson(`${base}/orders/o-5001`);
    expect(seed.body.created_at).toBe('2026-10-16T12:00:00.000Z');
  });

  test('VENDOR_DRIFTS is ignored on v1', async () => {
    const base = await start('v1', 'D1,D2');
    expect((await getJson(`${base}/products/p-1001`)).body.price).toBe(1199);
  });
});

describe('v2 drifts, each isolated', () => {
  test('D1: search prices are integer cents', async () => {
    const base = await start('v2', 'D1');
    const r = await getJson(`${base}/products?q=laptop`);
    expect(r.headers.get('vendor-api-version')).toBe('2026-10-01');
    expect(r.body.items.map((p: { price: number }) => p.price)).toEqual([119900, 89900, 149900, 74950]);
    expect((await getJson(`${base}/products/p-1001`)).body.price).toBe(1199);
  });

  test('D2: get_product renames price to unit_amount', async () => {
    const base = await start('v2', 'D2');
    const r = await getJson(`${base}/products/p-1001`);
    expect(r.body.price).toBeUndefined();
    expect(r.body.unit_amount).toBe(1199);
  });

  test('D3: order acknowledged but only persisted with Idempotency-Key', async () => {
    const base = await start('v2', 'D3');
    const lost = await postOrder(base);
    expect(lost.status).toBe(200);
    expect((await getJson(`${base}/orders/${lost.body.id}`)).status).toBe(404);
    expect(vendor?.state.droppedOrders).toEqual([lost.body.id]);
    const kept = await postOrder(base, { 'idempotency-key': 'k-1' });
    expect((await getJson(`${base}/orders/${kept.body.id}`)).status).toBe(200);
  });

  test('D4: search is paginated by 5 with next_cursor', async () => {
    const base = await start('v2', 'D4');
    const p1 = await getJson(`${base}/products?q=cable`);
    expect(p1.body.items).toHaveLength(5);
    expect(p1.body.total).toBe(7);
    expect(p1.body.next_cursor).toBe('5');
    const p2 = await getJson(`${base}/products?q=cable&cursor=5`);
    expect(p2.body.items).toHaveLength(2);
    expect(p2.body.next_cursor).toBeNull();
  });

  test('D5: created_at is epoch milliseconds', async () => {
    const base = await start('v2', 'D5');
    const r = await getJson(`${base}/orders/o-5001`);
    expect(r.body.created_at).toBe(Date.parse('2026-10-16T12:00:00.000Z'));
  });

  test('v2 defaults to every drift and openapi.json is identical to v1', async () => {
    const v2 = await start('v2');
    expect(vendor?.state.drifts).toEqual(['D1', 'D2', 'D3', 'D4', 'D5']);
    const specV2 = (await getJson(`${v2}/openapi.json`)).body;
    await vendor?.close();
    const v1 = await start('v1');
    expect((await getJson(`${v1}/openapi.json`)).body).toEqual(specV2);
  });

  test('unknown drift ids are rejected', () => {
    expect(() => createVendor({ version: 'v2', drifts: 'D9' })).toThrow(/unknown drift/);
  });
});

describe('admin', () => {
  test('reset restores the seed order', async () => {
    const base = await start('v1');
    await postOrder(base);
    expect(vendor?.state.orders).toHaveLength(2);
    await fetch(`${base}/__admin/reset`, { method: 'POST' });
    const state = (await getJson(`${base}/__admin/state`)).body;
    expect(state.orders.map((o: { id: string }) => o.id)).toEqual(['o-5001']);
  });
});

test('packages/vendor-api/openapi.json is the served spec', async () => {
  const { readFileSync } = await import('node:fs');
  const file = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));
  const { OPENAPI } = await import('../src/index.ts');
  expect(file).toEqual(OPENAPI);
});
