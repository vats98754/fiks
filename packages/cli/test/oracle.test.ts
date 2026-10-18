// The F->P gate on every drift. F: the generated repro test fails on seed-v1 for the stated
// reason. P: after a human-written ("oracle") fix and fiks's mechanical re-recording, the repro
// test and the whole shop-mcp suite pass. Oracle patches are test-only; the demo never uses them.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { passGate } from '@fiks/repro';
import { expect, test } from 'vitest';
import { repro } from '../src/commands/repro.ts';
import { rerecordStale } from '../src/commands/rerecord-stale.ts';
import { shopDir } from '../src/paths.ts';

const ORACLES = new URL('./oracles/', import.meta.url).pathname;

for (const drift of ['D1', 'D2', 'D3', 'D4', 'D5']) {
  test(`oracle ${drift}: F on seed-v1, then P after the fix`, { timeout: 180_000 }, async () => {
    const r = await repro({ scenario: drift, ref: 'seed-v1', runs: 2, keep: true });
    const wt = r.worktree as string;
    try {
      expect(r.gateF.ok, r.gateF.reason).toBe(true);
      expect(r.gateF.evidence.failed).toHaveLength(1);
      execFileSync('git', ['apply', join(ORACLES, `${drift}.patch`)], { cwd: wt });
      execFileSync(join(wt, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], { cwd: wt });
      execFileSync(join(wt, 'node_modules/.bin/biome'), ['check', '.'], { cwd: wt });
      const rerecorded = await rerecordStale(wt);
      // Only drifts whose fix changes upstream requests need re-recording.
      if (drift === 'D3' || drift === 'D4') expect(rerecorded.length).toBeGreaterThan(0);
      else expect(rerecorded).toEqual([]);
      const p = passGate(wt, r.spec);
      expect(p.ok, `${p.reason}\n${p.evidence.failed.map((f) => f.message).join('\n')}`).toBe(true);
    } finally {
      execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: shopDir() });
    }
  });
}
