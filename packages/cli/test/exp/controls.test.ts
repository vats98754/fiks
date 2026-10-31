// exp-eval controls (host sandbox): the D1-D5 oracle patches on seed-v1 have every outcome true
// (held-out repro, drift scenario verified, v1-all clean), and seed-v1 unpatched has held-out repro
// and live check false. These are the checks that the eval measures what it claims to.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { controlPasses, evaluateControl } from '../../src/exp/evaluate.ts';
import { DRIFTS, validateEvalRecord } from '../../src/exp/types.ts';
import { scratch, shopClone } from './support.ts';

let shop: string;
let tmp: string;
beforeAll(() => {
  shop = shopClone();
  tmp = scratch();
});

describe('positive control: oracle patches', () => {
  for (const d of DRIFTS) {
    test(`oracle ${d}: held-out repro, drift live check and v1 live check all pass`, {
      timeout: 300_000,
    }, async () => {
      const ev = await evaluateControl('oracle', d, join(tmp, `oracle-${d}`), {
        shopRepo: shop,
        workDir: join(tmp, 'wt'),
      });
      expect(
        validateEvalRecord(JSON.parse(readFileSync(join(tmp, `oracle-${d}`, 'eval.json'), 'utf8'))),
      ).toEqual([]);
      expect(ev.infraError).toBeNull();
      expect(ev.headErrors).toEqual([]);
      expect(ev.heldOutRepro.ok, ev.heldOutRepro.reason).toBe(true);
      expect(ev.heldOutRepro.suiteGreen).toBe(true);
      expect(ev.live.drift.ok, JSON.stringify(ev.live.drift.calls)).toBe(true);
      expect(ev.live.v1.ok, JSON.stringify(ev.live.v1.calls)).toBe(true);
      expect(ev.changedLines.lines).toBeGreaterThan(0);
      // Fixes that change the upstream requests need fiks's re-recording; the others do not.
      if (d === 'D3' || d === 'D4') expect(ev.heldOutRepro.rerecorded.length).toBeGreaterThan(0);
      else expect(ev.heldOutRepro.rerecorded).toEqual([]);
      expect(controlPasses(ev)).toBe(true);
    });
  }
});

describe('negative control: seed-v1 unpatched', () => {
  for (const d of DRIFTS) {
    test(`seed ${d}: held-out repro and live check fail`, { timeout: 300_000 }, async () => {
      const ev = await evaluateControl('seed', d, join(tmp, `seed-${d}`), {
        shopRepo: shop,
        workDir: join(tmp, 'wt'),
      });
      expect(ev.infraError).toBeNull();
      expect(ev.headErrors).toEqual([]);
      expect(ev.heldOutRepro.ok).toBe(false);
      expect(ev.heldOutRepro.reason).toMatch(/^repro test still fails: AssertionError: .* violated/);
      expect(ev.live.drift.ok).toBe(false);
      expect(ev.live.drift.calls.some((c) => c.verdict === 'violated')).toBe(true);
      expect(ev.liveCheck).toBe(false);
      // v1 still works on the seed: the drift is what breaks it.
      expect(ev.live.v1.ok).toBe(true);
      expect(ev.changedLines.lines).toBe(0);
      expect(controlPasses(ev)).toBe(true);
    });
  }
});
