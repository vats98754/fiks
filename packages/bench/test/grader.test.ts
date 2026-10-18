import { createVendor } from '@fiks/vendor-api';
import { expect, test } from 'vitest';
import { TASKS } from '../src/index.ts';

const vendor = createVendor({ version: 'v1', now: () => new Date('2026-10-18T12:00:00Z') });
const t = (id: string) => TASKS.find((x) => x.id === id) as (typeof TASKS)[number];

test('T1 price: correct, wrong (cents), declined', () => {
  expect(t('T1').grade('The price is $1,199.', vendor.state).outcome).toBe('correct');
  expect(t('T1').grade('It costs $119,900.', vendor.state).outcome).toBe('wrong');
  expect(t('T1').grade('The price is unavailable right now.', vendor.state).outcome).toBe('declined');
});

test('T2 cheap laptop needs id and price', () => {
  expect(t('T2').grade('p-1004 (Nimbus 15) at $749.50', vendor.state).pass).toBe(true);
  expect(t('T2').grade('p-1004', vendor.state).pass).toBe(false);
  expect(t('T2').grade('None: the cheapest is $74,950.', vendor.state).outcome).toBe('wrong');
});

test('T3 order must be persisted at the vendor', () => {
  expect(t('T3').grade('Order o-5002 placed.', vendor.state).outcome).toBe('wrong');
  vendor.state.orders.push({
    id: 'o-5002',
    status: 'confirmed',
    items: [{ product_id: 'p-1004', quantity: 2, unit_price: 749.5 }],
    total: 1499,
    created_at: new Date(),
  });
  expect(t('T3').grade('Order o-5002 placed.', vendor.state).outcome).toBe('correct');
  expect(t('T3').grade('I could not confirm the order was saved.', vendor.state).outcome).toBe('declined');
  vendor.reset();
});

test('T4, T5, T6', () => {
  expect(t('T4').grade('There are 7 cable products.', vendor.state).pass).toBe(true);
  expect(t('T4').grade('There are 5 cable products.', vendor.state).outcome).toBe('wrong');
  expect(t('T5').grade('2026-10-16', vendor.state).pass).toBe(true);
  expect(t('T5').grade('1970-01-01', vendor.state).outcome).toBe('wrong');
  expect(t('T6').grade('Thunderbolt 5 Cable 1m', vendor.state).pass).toBe(true);
});
