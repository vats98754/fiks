// Patch pools (PLAN 5.6): identical output for the same seed; drifts with < 3 patches per class
// flagged; labels come from the grade; dedupe by normalised diff; secondary stratified cap.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GradeRecord } from '@fiks/interfaces';
import { describe, expect, test } from 'vitest';
import { normalizedDiff } from '../src/diff.ts';
import {
  allocate,
  buildPrimaryPool,
  buildSecondaryPool,
  type CapturedCandidate,
  type PoolCandidate,
  type PoolSource,
} from '../src/pool.ts';
import { DEV, ORACLES } from './support/shop.ts';

const grade = (patchId: string, drift: string, correct: boolean): GradeRecord => ({
  patchId,
  drift,
  criteria: {
    hidden: correct,
    differential: correct,
    ambiguousInputs: 0,
    renamedId: correct,
    sast: true,
    truthReplay: correct,
  },
  correct,
  reasons: correct ? [] : ['hidden'],
});

/** D1's dev candidates: ref A, ref B and the hand-written P1-P8. */
function d1Candidates(): PoolCandidate[] {
  const ps = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'] as const;
  return [
    {
      id: 'D1/refA',
      source: 'refA',
      generator: 'oracle',
      diff: readFileSync(join(ORACLES, 'D1.patch'), 'utf8'),
    },
    {
      id: 'D1/refB',
      source: 'refB',
      generator: 'HOLD-builder',
      diff: readFileSync(join(DEV, 'D1/refB.patch'), 'utf8'),
    },
    ...ps.map((p) => ({
      id: `D1/${p}`,
      source: p as PoolSource,
      generator: 'HOLD-builder',
      diff: readFileSync(join(DEV, `pmut/D1/${p}.patch`), 'utf8'),
    })),
  ];
}

describe('primary pool', () => {
  const cands = d1Candidates();
  const grades = cands.map((c) => grade(c.id, 'D1', ['D1/refA', 'D1/refB', 'D1/P4', 'D1/P7'].includes(c.id)));
  const input = (seed: string) =>
    buildPrimaryPool([{ drift: 'D1', candidates: cands, grades, requestChanging: false }], { seed });

  test('identical output (bytes and hash) for the same seed; another seed reorders only', () => {
    const a = input('s-1');
    const b = input('s-1');
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const c = input('s-2');
    expect(c.hash).not.toBe(a.hash);
    const ids = (p: typeof a) => p.drifts[0]?.patches.map((x) => x.id).sort();
    expect(ids(c)).toEqual(ids(a));
  });

  test('labels come from the grade, never from the generator; cross-tab of intent vs grade', () => {
    const d = input('s').drifts[0];
    expect(d?.patches.find((p) => p.id === 'D1/P4')?.class).toBe('correct');
    expect(d?.patches.find((p) => p.id === 'D1/P1')?.class).toBe('incorrect');
    expect(d?.counts).toMatchObject({ correct: 4, incorrect: 6, candidates: 10, duplicates: 0 });
    expect(d?.crossTab['P4 (intended incorrect)']).toEqual({ correct: 1, incorrect: 0 });
    expect(d?.crossTab['refA (intended correct)']).toEqual({ correct: 1, incorrect: 0 });
    expect(d?.excluded).toBe(false);
  });

  test('drifts with < 3 patches in either class are flagged and listed as excluded', () => {
    const few = cands.filter((c) => !['D1/P4', 'D1/P7'].includes(c.id)); // 2 correct left
    const pool = buildPrimaryPool(
      [
        { drift: 'D1', candidates: few, grades, requestChanging: false },
        {
          drift: 'D2',
          candidates: cands.map((c) => ({ ...c, id: c.id.replace('D1', 'D2') })),
          grades: cands.map((c) => grade(c.id.replace('D1', 'D2'), 'D2', !c.id.includes('P'))),
          requestChanging: true,
        },
      ],
      { seed: 's' },
    );
    expect(pool.drifts.map((d) => [d.drift, d.counts.correct, d.counts.incorrect, d.excluded])).toEqual([
      ['D1', 2, 6, true],
      ['D2', 2, 8, true],
    ]);
    expect(pool.excluded).toEqual(['D1', 'D2']);
    expect(pool.drifts[1]?.requestChanging).toBe(true);
  });

  test('dedupe by normalised diff keeps the first by source order', () => {
    const refA = cands[0] as PoolCandidate;
    const dup: PoolCandidate = {
      id: 'D1/alt-1',
      source: 'alternative',
      generator: 'sonnet',
      // Same change, different index line and trailing whitespace.
      diff: refA.diff.replace(/^index .*$/m, 'index 0000000..1111111 100644').replace(/;\n/g, ';  \n'),
    };
    expect(normalizedDiff(dup.diff)).toBe(normalizedDiff(refA.diff));
    const pool = buildPrimaryPool(
      [{ drift: 'D1', candidates: [dup, ...cands], grades, requestChanging: false }],
      { seed: 's' },
    );
    const d = pool.drifts[0];
    expect(d?.counts.duplicates).toBe(1);
    expect(d?.patches.find((p) => p.id === 'D1/refA')?.duplicates).toEqual(['D1/alt-1']);
  });
});

describe('secondary pool', () => {
  const cap: CapturedCandidate[] = [];
  for (const arm of ['FIKS', 'L1', 'COMP']) {
    for (let i = 0; i < (arm === 'COMP' ? 40 : 10); i++) {
      cap.push({
        id: `${arm}-${i}`,
        drift: 'D9',
        arm,
        diff: `diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+${arm}${i}\n`,
      });
    }
  }
  cap.push({ id: 'dup', drift: 'D9', arm: 'L1', diff: cap[0]?.diff ?? '' });

  test('dedupe, cap 30 per drift stratified by arm, identical for the same seed', () => {
    const a = buildSecondaryPool(cap, { seed: 'x' });
    expect(JSON.stringify(buildSecondaryPool(cap, { seed: 'x' }))).toBe(JSON.stringify(a));
    const d = a.drifts[0];
    expect(d?.available).toEqual({ COMP: 40, FIKS: 10, L1: 10 });
    expect(d?.kept).toEqual({ COMP: 20, FIKS: 5, L1: 5 });
    expect(d?.patches).toHaveLength(30);
    expect(buildSecondaryPool(cap, { seed: 'y' }).hash).not.toBe(a.hash);
  });

  test('allocate: largest remainder, never above a stratum size', () => {
    expect(allocate({ a: 1, b: 100 }, 30)).toEqual({ a: 1, b: 29 });
    expect(allocate({ a: 5, b: 5 }, 30)).toEqual({ a: 5, b: 5 });
    expect(Object.values(allocate({ a: 7, b: 7, c: 7 }, 10)).reduce((s, x) => s + x, 0)).toBe(10);
  });
});
