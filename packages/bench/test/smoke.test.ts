import { expect, test } from 'vitest';
import { name } from '../src/index.ts';

test('package loads', () => {
  expect(name).toBe('@fiks/bench');
});
