import { expect, test } from 'vitest';
import { choose, maxK, numbers, passHatK, passHatKCurve, passHatKWithCi, wilson } from '../src/index.ts';

test('choose', () => {
  expect(choose(5, 2)).toBe(10);
  expect(choose(5, 0)).toBe(1);
  expect(choose(3, 5)).toBe(0);
});

test('pass^k on fixed inputs', () => {
  // one task 5/5, one task 3/5, one task 0/5
  const t = [
    { n: 5, c: 5 },
    { n: 5, c: 3 },
    { n: 5, c: 0 },
  ];
  expect(passHatK(t, 1)).toBeCloseTo((1 + 0.6 + 0) / 3);
  expect(passHatK(t, 2)).toBeCloseTo((1 + 3 / 10 + 0) / 3);
  expect(passHatK(t, 3)).toBeCloseTo((1 + 1 / 10) / 3);
  expect(passHatK(t, 4)).toBeCloseTo(1 / 3);
  expect(passHatK(t, 5)).toBeCloseTo(1 / 3);
  expect(passHatK([], 1)).toBe(0);
});

test('numbers in free text', () => {
  expect(numbers('It costs $1,199.00 (was 119900 cents)')).toEqual([1199, 119900]);
});

test('pass^1..K stops at the smallest per-task count (unbiased only for k <= n)', () => {
  const t = [
    { n: 5, c: 5 },
    { n: 4, c: 2 },
    { n: 6, c: 3 },
  ];
  expect(maxK(t)).toBe(4);
  const curve = passHatKCurve(t);
  expect(curve).toHaveLength(4);
  expect(curve[1]).toBeCloseTo((1 + 1 / 6 + 3 / 15) / 3);
  expect(passHatKCurve(t, 2)).toHaveLength(2);
  expect(passHatKCurve([])).toEqual([]);
  // The legacy passHatK at k = 5 would count the 4-trial task as 0 (biased); the curve never asks.
  expect(passHatK(t, 5)).toBeCloseTo((1 + 0 + 0) / 3);
});

test('C(c,k)/C(n,k) is unbiased for p^k (exact expectation over Binomial(n, p))', () => {
  const n = 6;
  const p = 0.7;
  for (let k = 1; k <= n; k++) {
    let e = 0;
    for (let c = 0; c <= n; c++)
      e += choose(n, c) * p ** c * (1 - p) ** (n - c) * (choose(c, k) / choose(n, k));
    expect(e).toBeCloseTo(p ** k, 12);
  }
});

test('Wilson intervals match published values', () => {
  // Brown, Cai and DasGupta (2001) / statsmodels proportion_confint(method="wilson").
  const a = wilson(0, 10);
  expect(a.lo).toBe(0);
  expect(a.hi).toBeCloseTo(0.27753, 4);
  const b = wilson(5, 10);
  expect(b.lo).toBeCloseTo(0.23659, 4);
  expect(b.hi).toBeCloseTo(0.76341, 4);
  const c = wilson(30, 30);
  expect(c.lo).toBeCloseTo(0.88649, 4);
  expect(c.hi).toBe(1);
  expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 1 });
});

test('pass^k intervals use tasks as the unit', () => {
  const t = Array.from({ length: 6 }, (_, i) => ({ n: 5, c: i < 5 ? 5 : 0 }));
  const ci = passHatKWithCi(t);
  expect(ci).toHaveLength(5);
  for (const x of ci) {
    expect(x.p).toBeCloseTo(5 / 6);
    const w = wilson(5, 6);
    expect(x.lo).toBeCloseTo(w.lo);
    expect(x.hi).toBeCloseTo(w.hi);
  }
});
