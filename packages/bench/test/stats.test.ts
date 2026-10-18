import { expect, test } from 'vitest';
import { choose, numbers, passHatK } from '../src/index.ts';

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
