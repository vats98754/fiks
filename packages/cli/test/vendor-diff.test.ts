import { expect, test } from 'vitest';
import { vendorDiff } from '../src/commands/vendor-diff.ts';

test('spec is identical; each drift changes behavior', async () => {
  const r = await vendorDiff();
  expect(r.openapiIdentical).toBe(true);
  expect(r.behaviorDiffs.map((d) => d.drift)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5']);
});
