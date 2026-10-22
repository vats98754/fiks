// Stub agent-style test (HOLD dev fixture): loads the alert .alerts/tr_c3cb09411c.json through the
// repository's replay helper and asserts shop.search_products/countMatchesTotal (PLAN 5.5 task text).
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { replayRecording } from './fiks/run.ts';

test('the alert replays on this head and shop.search_products/countMatchesTotal holds', async () => {
  const rec = JSON.parse(readFileSync(new URL('../.alerts/tr_c3cb09411c.json', import.meta.url), 'utf8'));
  const r = await replayRecording(rec);
  expect(r.unmatched, 'UNMATCHED_REQUEST').toEqual([]);
  expect(r.evaluation.violations.map((v) => v.propertyId)).not.toContain(
    'shop.search_products/countMatchesTotal',
  );
});
