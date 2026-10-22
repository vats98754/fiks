// Stub agent-style test (HOLD dev fixture): loads the alert .alerts/tr_bc59dbbff1.json through the
// repository's replay helper and asserts tracker.list_comments/countMatchesTotal (PLAN 5.5 task text).
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { replayRecording } from './fiks/run.ts';

test('the alert replays on this head and tracker.list_comments/countMatchesTotal holds', async () => {
  const rec = JSON.parse(readFileSync(new URL('../.alerts/tr_bc59dbbff1.json', import.meta.url), 'utf8'));
  const r = await replayRecording(rec);
  expect(r.unmatched, 'UNMATCHED_REQUEST').toEqual([]);
  expect(r.evaluation.violations.map((v) => v.propertyId)).not.toContain(
    'tracker.list_comments/countMatchesTotal',
  );
});
