// Stub agent-style test (HOLD dev fixture): loads the alert .alerts/tr_b703bf79d0.json through the
// repository's replay helper and asserts shop.create_order/readAfterWrite (PLAN 5.5 task text).
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { replayRecording } from './fiks/run.ts';

test('the alert replays on this head and shop.create_order/readAfterWrite holds', async () => {
  const rec = JSON.parse(readFileSync(new URL('../.alerts/tr_b703bf79d0.json', import.meta.url), 'utf8'));
  const r = await replayRecording(rec);
  expect(r.unmatched, 'UNMATCHED_REQUEST').toEqual([]);
  expect(r.evaluation.violations.map((v) => v.propertyId)).not.toContain('shop.create_order/readAfterWrite');
});
