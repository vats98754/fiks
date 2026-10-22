// The keep rule (first valid in idea-index order, per-stratum quotas, S12 minimum) and the seeded
// split (`pnpm fiks split --seed <s>` twice gives identical split-file hashes).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { sha256 } from '../src/export.ts';
import { type KeepCandidate, keepRule } from '../src/keep.ts';
import { makeSplit, type SplitItem } from '../src/split.ts';
import { fiks } from './support/cli.ts';

const cand = (i: number, over: Partial<KeepCandidate> = {}): KeepCandidate => ({
  id: `c${i}`,
  domain: 'shop',
  stratum: 'realistic',
  ideaIndex: i,
  valid: true,
  ...over,
});

describe('keep rule', () => {
  test('first valid in idea-index order until the quota; input order does not matter', () => {
    const cs = [cand(3), cand(0, { valid: false }), cand(1), cand(2, { valid: false }), cand(4), cand(5)];
    const r = keepRule(cs, { realistic: { n: 3 } });
    expect(r.kept.map((c) => c.id)).toEqual(['c1', 'c3', 'c4']);
    expect(keepRule([...cs].reverse(), { realistic: { n: 3 } }).kept.map((c) => c.id)).toEqual([
      'c1',
      'c3',
      'c4',
    ]);
    expect(r.cells['shop/realistic']).toMatchObject({ quota: 3, kept: 3, shortfall: 0 });
    expect(keepRule(cs, { realistic: { n: 9 } }).cells['shop/realistic']?.shortfall).toBe(5);
  });

  test('evasive: the S12 minimum reserves slots for plausible-string drifts', () => {
    const cs = Array.from({ length: 10 }, (_, i) => cand(i, { stratum: 'evasive', plausibleString: i >= 6 }));
    const r = keepRule(cs, { evasive: { n: 4, minPlausibleString: 2 } });
    expect(r.kept.map((c) => c.id)).toEqual(['c0', 'c1', 'c6', 'c7']);
    expect(r.cells['shop/evasive']).toMatchObject({ kept: 4, plausibleString: 2, s12Shortfall: 0 });
  });

  test('domains are separate cells', () => {
    const cs = [cand(0), cand(1, { domain: 'tracker' }), cand(2), cand(3, { domain: 'tracker' })];
    expect(keepRule(cs, { realistic: { n: 1 } }).kept.map((c) => c.id)).toEqual(['c0', 'c1']);
  });
});

/** 120 kept drifts: 2 domains x (45 realistic + 15 evasive), half per ideation family. */
function kept120(): SplitItem[] {
  const out: SplitItem[] = [];
  for (const domain of ['shop', 'tracker'])
    for (const [stratum, n] of [
      ['realistic', 45],
      ['evasive', 15],
    ] as const)
      for (let i = 0; i < n; i++)
        out.push({
          id: `${domain}-${stratum}-${String(i).padStart(3, '0')}`,
          domain,
          stratum,
          ideationFamily: i % 2 ? 'ollama' : 'opus',
        });
  return out;
}

describe('split', () => {
  test('20% dev (24 of 120) + D1-D5, stratified; test = 96; every cell is represented', () => {
    const s = makeSplit(kept120(), 'seed-1');
    expect(s.dev).toHaveLength(24);
    expect(s.test).toHaveLength(96);
    expect(s.seededDev).toEqual(['D1', 'D2', 'D3', 'D4', 'D5']);
    expect(new Set([...s.dev, ...s.test]).size).toBe(120);
    expect(s.cells).toHaveLength(8);
    for (const c of s.cells) expect(c.dev).toBeGreaterThanOrEqual(Math.floor(c.n * 0.2));
    expect(makeSplit(kept120(), 'seed-2').dev).not.toEqual(s.dev);
    expect(() =>
      makeSplit([...kept120(), { id: 'D3', domain: 'shop', stratum: 'dev', ideationFamily: 'x' }], 's'),
    ).toThrow();
  });

  test("'pnpm fiks split --seed <s>' twice gives identical split-file hashes", () => {
    const d = mkdtempSync(join(tmpdir(), 'blind-split-'));
    const input = join(d, 'kept.json');
    writeFileSync(input, JSON.stringify([...kept120()].reverse()));
    const hashes: string[] = [];
    for (const out of ['a.json', 'b.json']) {
      const r = fiks(['split', '--seed', 'F7-seed', '--in', input, '--out', join(d, out)]);
      expect(r.code, r.out).toBe(0);
      const printed = /sha256 ([0-9a-f]{64})/.exec(r.out)?.[1];
      expect(printed).toBe(sha256(readFileSync(join(d, out))));
      hashes.push(printed as string);
    }
    expect(hashes[0]).toBe(hashes[1]);
    expect(readFileSync(join(d, 'a.json'), 'utf8')).toBe(readFileSync(join(d, 'b.json'), 'utf8'));
  });
});
