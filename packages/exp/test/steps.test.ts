// K1 (PLAN 8.2, 13): ConfigStep ladder, projection, fit and the ollama rule.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ThroughputReport, ThroughputSchema } from '@fiks/llm';
import { describe, expect, test } from 'vitest';
import { measuredRate } from '../src/measured.ts';
import {
  assertStrictlyDecreasing,
  configSteps,
  DEFAULT_FIT,
  DEFAULT_PARAMS,
  type FitInputs,
  fit,
  fitStep,
  type K1Step,
  MODEL,
  ollamaRule,
  PROJECTED_RUNS,
  r5NonOverlapHours,
} from '../src/steps.ts';
import { runCli, tmp } from './support/harness.ts';

const steps = configSteps(DEFAULT_PARAMS);
const byId = (id: K1Step['id']) => steps.find((s) => s.id === id) as K1Step;
const fitWith = (rate: number, extra: Partial<FitInputs> = {}): FitInputs => ({
  ...DEFAULT_FIT,
  sustainedUnitsPerHour: rate,
  ...extra,
});

describe('ConfigStep ladder', () => {
  test('ids are S+, S0, 1..11; none is R10, B-OM or ollama', () => {
    expect(steps.map((s) => s.id)).toEqual(['S+', 'S0', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const s of steps) {
      expect(['R10', 'R11', 'B-OM', 'ollama']).not.toContain(String(s.id));
      expect(JSON.stringify(s.config)).not.toMatch(/ollama|B-OM/);
    }
  });

  test('projected Claude usage strictly decreases along S0, 1, 2, ..., 11', () => {
    const walk = steps.filter((s) => s.id !== 'S+');
    for (let i = 1; i < walk.length; i++)
      expect(walk[i]?.projectedUnits, `step ${walk[i]?.id}`).toBeLessThan(
        walk[i - 1]?.projectedUnits as number,
      );
    expect(() => assertStrictlyDecreasing(steps)).not.toThrow();
    expect(byId('S+').projectedUnits).toBeGreaterThan(byId('S0').projectedUnits);
  });

  test('each step removes what the PLAN 13 table says', () => {
    const d = (a: K1Step['id'], b: K1Step['id']) => byId(a).projectedUnits - byId(b).projectedUnits;
    for (const s of [1, 2, 3, 4] as const) expect(d(s === 1 ? 'S0' : ((s - 1) as 1), s)).toBeCloseTo(183, 6);
    expect(d(4, 5)).toBeCloseTo(40, 6);
    expect(d(5, 6)).toBeCloseTo(120, 6);
    expect(d(6, 7)).toBeCloseTo(30, 6);
    // a 4 -> 3 on FIKS/L1/COMP: 20.4 -> 15.3 units per drift.
    expect(d(7, 8)).toBeCloseTo(61 * (20.4 - 15.3), 6);
    // drop Haiku from R4 (15.3 -> 13.5 per drift) and from R3 (2 samples x 0.2 per drift).
    expect(d(8, 9)).toBeCloseTo(61 * (15.3 - 13.5) + 61 * 2 * 0.2, 6);
    expect(d(9, 10)).toBeCloseTo(DEFAULT_PARAMS.a2WorstDrifts * DEFAULT_PARAMS.a2UnitsPerDrift, 6);
    expect(d(10, 11)).toBeCloseTo(13.5 * (61 - 40), 6);
    expect(byId(11).drifts).toHaveLength(40);
    expect(byId(8).a).toBe(3);
    expect(byId(9).models).toEqual([MODEL.opus, MODEL.sonnet]);
    expect(byId('S+').a).toBe(5);
  });

  test('the projection holds A1 leftovers, R2, A2 worst case, P-pool, R9 Claude share, R3, R4 (+ rungs incl. L1-noIV), R6, R7, R8 and never R10/R11', () => {
    const s0 = byId('S0');
    expect(Object.keys(s0.breakdown).sort()).toEqual([...PROJECTED_RUNS].sort());
    expect(Object.keys(s0.breakdown)).not.toContain('R10');
    expect(Object.keys(s0.breakdown)).not.toContain('R11');
    const withLeft = configSteps({ ...DEFAULT_PARAMS, a1LeftoverUnits: 7 });
    expect((withLeft[1] as K1Step).breakdown.A1).toBe(7);
    expect(s0.breakdown.A2).toBeCloseTo(140, 6);
    expect(s0.breakdown.R9).toBeCloseTo(2 * 20 * 3 * 1.7, 6);
    expect(s0.breakdown.R3).toBeCloseTo(61 * 2 * 1.7, 6);
    expect(s0.breakdown.R4).toBeCloseTo(61 * 20.4 + 732, 6);
    expect(s0.arms).toContain('L1-noIV');
    expect(s0.breakdown.R6).toBe(270);
    expect(s0.breakdown.R7).toBe(240 + 40 + 232);
    expect(s0.breakdown.R8).toBe(60);
    expect(s0.breakdown.R2).toBeGreaterThan(0);
    expect(s0.breakdown['P-pool']).toBeGreaterThan(0);
  });

  test('a walk that does not decrease is rejected', () => {
    const broken = steps.map((s) => (s.id === 5 ? { ...s, projectedUnits: byId(4).projectedUnits } : s));
    expect(() => assertStrictlyDecreasing(broken)).toThrow(/strictly decreasing/);
  });

  test('S4 is skipped (not applicable) when the drifts are already at the floor', () => {
    const few = configSteps({ ...DEFAULT_PARAMS, detectedTestDrifts: 38 });
    expect((few[few.length - 1] as K1Step).applicable).toBe(false);
    expect(() => assertStrictlyDecreasing(few)).not.toThrow();
  });
});

describe('fit', () => {
  const units = (id: K1Step['id']) => byId(id).projectedUnits * 1.3;
  const fixedH = DEFAULT_FIT.r0Hours + DEFAULT_FIT.cp2Hours;
  const W = 8 * 24;

  test('S+ only when everything incl. the reserve fits at a = 5', () => {
    const huge = fit(steps, DEFAULT_PARAMS, fitWith(1e6, { r5Hours: 0 }));
    expect(huge.chosen.id).toBe('S+');
    // A rate where S0 fits but S+ (a = 5) does not, by the reserve: S0 is chosen.
    const rate = units('S0') / (W - fixedH - 0.5);
    expect(units('S+') / rate + fixedH).toBeGreaterThan(W);
    const r = fit(steps, DEFAULT_PARAMS, fitWith(rate, { r5Hours: 0 }));
    expect(r.chosen.id).toBe('S0');
    // At a rate where S+ fits only without the 30% reserve, the reserve keeps S+ out.
    const r2 = (1.15 * byId('S+').projectedUnits) / (W - fixedH);
    expect(fit(steps, { ...DEFAULT_PARAMS, reserve: 0 }, fitWith(r2, { r5Hours: 0 })).chosen.id).toBe('S+');
    expect(fit(steps, DEFAULT_PARAMS, fitWith(r2, { r5Hours: 0 })).chosen.id).not.toBe('S+');
  });

  test('walks to the first fitting step and flags a total miss at step 11', () => {
    const rate = units(6) / (W - fixedH - 0.1);
    expect(fit(steps, DEFAULT_PARAMS, fitWith(rate, { r5Hours: 0 })).chosen.id).toBe(6);
    const none = fit(steps, DEFAULT_PARAMS, fitWith(0.1));
    expect(none.fits).toBe(false);
    expect(none.chosen.id).toBe(11);
  });

  test('the fit adds R0, CP2 and the non-overlappable part of R5 to the wall-clock', () => {
    const f = fitWith(10, { r5Hours: 75 });
    const t = fitStep(byId('S0'), DEFAULT_PARAMS, f);
    expect(t.totalHours).toBeCloseTo(t.claudeHours + f.r0Hours + f.cp2Hours + t.r5NonOverlapHours, 6);
    // Memory rule fails (6 workers x 1 GB + 4 x 1.5 GB > 6 GB): R5 cannot overlap at all.
    const tight = { ...f, memory: { ...f.memory, workers: 6 } };
    expect(r5NonOverlapHours(byId('S0'), tight)).toBe(75);
    // Memory rule holds (1 worker): R5 overlaps R6-R8 Claude time.
    const loose = { ...f, memory: { ...f.memory, workers: 0 } };
    const overlap =
      ((byId('S0').breakdown.R6 ?? 0) + (byId('S0').breakdown.R7 ?? 0) + (byId('S0').breakdown.R8 ?? 0)) / 10;
    expect(r5NonOverlapHours(byId('S0'), loose)).toBeCloseTo(Math.max(0, 75 - overlap), 6);
    // More R5 hours can flip a fit.
    const rate = units('S0') / (W - fixedH - 1);
    expect(fit(steps, DEFAULT_PARAMS, fitWith(rate, { r5Hours: 0 })).chosen.id).toBe('S0');
    expect(
      fit(steps, DEFAULT_PARAMS, fitWith(rate, { r5Hours: 40, memory: tight.memory })).chosen.id,
    ).not.toBe('S0');
  });
});

describe('ollama wall-clock rule', () => {
  test('cuts the ollama share of R9 when the measured tokens/s projects > 10 h, and leaves the Claude fit unchanged', () => {
    const slow = ollamaRule(DEFAULT_PARAMS, 5);
    expect(slow.projectedHours).toBeGreaterThan(10);
    expect(slow.cut).toBe(true);
    const fast = ollamaRule(DEFAULT_PARAMS, 200);
    expect(fast.cut).toBe(false);
    expect(ollamaRule(DEFAULT_PARAMS, null).cut).toBe(true);
    const f = fitWith(20);
    expect(fit(steps, DEFAULT_PARAMS, f)).toEqual(fit(configSteps(DEFAULT_PARAMS), DEFAULT_PARAMS, f));
  });
});

function level(concurrency: number, aph: number, rate = 0) {
  return {
    concurrency,
    sessions: 10,
    ok: 10,
    modelErrors: 0,
    infraErrors: 0,
    caps: 0,
    notRun: 0,
    wallMs: 1000,
    attemptsPerHour: aph,
    rateLimitEvents: 0,
    overloadEvents: 0,
    sessionsWith429OrOverload: rate > 0 ? 1 : 0,
    rateLimitOverloadRate: rate,
    capEvents: [],
    spawnOverheadMs: { n: 1, meanMs: 1, medianMs: 1, p90Ms: 1 },
    costUsd: 0,
    tokens: { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 },
  };
}

export function throughput(tps: number | null): ThroughputReport {
  return ThroughputSchema.parse({
    schema: 'fiks-throughput/1',
    dry: true,
    createdAt: '2026-10-22T00:00:00.000Z',
    fiksCommit: null,
    host: { platform: 'darwin', arch: 'arm64', cpus: 8, memGb: 16, node: 'v22' },
    models: { authoring: MODEL.opus, repair: MODEL.opus },
    authoring: { levels: [level(1, 10), level(2, 18), level(4, 30)] },
    repairWorkers: { levels: [level(1, 12), level(2, 22), level(4, 40), level(6, 50, 0.05)] },
    ollama: {
      status: tps === null ? 'skipped' : 'measured',
      reason: null,
      model: null,
      digest: null,
      calls: 1,
      promptTokens: 1,
      completionTokens: 1,
      wallMs: 1,
      tokensPerSec: tps === null ? null : { mean: tps, median: tps, aggregate: tps },
    },
    capEventsTotal: 0,
    capStopped: null,
    recommendedConcurrency: 4,
  });
}

describe('measured rate (T0 throughput.json)', () => {
  test('workers = largest of {1,2,4,6} with < 2% 429/overload and RSS within 16 - 6 GB', () => {
    const t = throughput(50);
    expect(measuredRate(t, { source: 'x' }).workers).toBe(4);
    expect(measuredRate(t, { source: 'x' }).sustainedUnitsPerHour).toBe(40);
    expect(measuredRate(t, { source: 'x', peakRssMbPerWorker: 3000 }).workers).toBe(2);
    expect(measuredRate(t, { source: 'x', capPauseFraction: 0.25 }).sustainedUnitsPerHour).toBe(30);
    expect(measuredRate(t, { source: 'x' }).ollamaTokensPerSec).toBe(50);
  });

  test('pnpm tsx main.ts fit --measured <throughput.json> --window-days 8 prints the ladder and the choice', async () => {
    const dir = tmp('fit');
    const file = join(dir, 'throughput.json');
    writeFileSync(file, JSON.stringify(throughput(2)));
    const r = await runCli(
      ['fit', '--measured', file, '--window-days', '8', '--out', join(dir, 'K1', 'fit.json')],
      {
        PATH: process.env.PATH ?? '',
        HOME: dir,
      },
    );
    expect(r.code, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as {
      chosen: K1Step;
      steps: K1Step[];
      ollama: { cut: boolean };
      measured: { workers: number };
    };
    expect(out.steps.map((s) => s.id)).toEqual(['S+', 'S0', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(out.measured.workers).toBe(4);
    expect(out.ollama.cut).toBe(true);
    // results never overwrite
    const again = await runCli(['fit', '--measured', file, '--out', join(dir, 'K1', 'fit.json')], {
      PATH: process.env.PATH ?? '',
      HOME: dir,
    });
    expect(again.code).toBe(2);
  }, 60_000);
});
