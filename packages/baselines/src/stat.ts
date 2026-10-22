// B-STAT (PLAN 6.1): windowed statistics over the tool's output leaves, per tool, in two modes.
//
// mode 'aegis' (AegisFlow-style; AegisFlow released no code [awan2026aegisflow], so these rules are
// ours, fixed here before any data):
//   ks         two-sample KS (exact p) of every numeric leaf path, window vs reference;
//              fires when p < alpha / (number of paths tested at this step) (Bonferroni);
//   nullRate   |null share in window - null share in reference| >= nullJump at a leaf path;
//   range      share of window values outside the reference [min, max] >= rangeShare.
// mode 'evidently' (emulation of Evidently's default data-drift preset [evidently-drift-docs]
// [verify]): one column per leaf path (nulls dropped); reference n <= 1000: numeric with > 5 unique
// values -> KS, otherwise chi-square (> 2 unique) or z-test (<= 2); reference n > 1000: numeric
// with > 5 unique values -> normed Wasserstein >= 0.1, otherwise Jensen-Shannon >= 0.1 on
// Sturges / category bins (zeros replaced by 1e-4); p-value tests drift at p < 0.05; the dataset
// drifts when the share of drifted columns >= 0.5.
//
// The window is the last `window` calls of the tool, optionally pre-filled with the tail of v1
// traffic (a monitor in steady state). Until it holds `window` calls the verdict is unverifiable,
// which is what makes calls-to-first-detection meaningful for these detectors.
import type { Violation } from '@fiks/contracts';
import type { CallRecord, MonitorInput, MonitorResult } from '@fiks/interfaces';
import {
  chiSquare,
  histogram,
  jensenShannon,
  ks2samp,
  proportionZTest,
  stdPop,
  sturgesEdges,
  wasserstein,
} from './stats.ts';
import type { SyncBaselineMonitor } from './types.ts';
import { getOrInit, resultData, walk } from './util.ts';

export type StatMode = 'aegis' | 'evidently';

export interface StatMonitorOptions {
  mode: StatMode;
  /** Window size w (PLAN: 20 or 50). */
  window: number;
  /** Reference (history) calls, e.g. v1 traffic. */
  reference: CallRecord[];
  /** Calls that fill the window before the first evaluated call (default: none). */
  prefill?: CallRecord[];
  /** aegis: family-wise alpha for KS (default 0.05). */
  alpha?: number;
  /** aegis: null-share jump that fires (default 0.2). */
  nullJump?: number;
  /** aegis: share of window values outside the reference range that fires (default 0.2). */
  rangeShare?: number;
}

/** Leaf values of one call: path -> values (containers excluded; null kept). */
type Sample = Map<string, unknown[]>;

function sampleOf(result: MonitorInput['result']): Sample {
  const out: Sample = new Map();
  if (result.isError) return out;
  for (const leaf of walk(resultData(result))) {
    if (leaf.type === 'object' || leaf.type === 'array') continue;
    getOrInit(out, leaf.path, () => []).push(leaf.value ?? null);
  }
  return out;
}

function pool(samples: Sample[]): Sample {
  const out: Sample = new Map();
  for (const s of samples) {
    for (const [path, xs] of s) {
      getOrInit(out, path, () => []).push(...xs);
    }
  }
  return out;
}

const numbers = (xs: unknown[]) => xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
const nonNull = (xs: unknown[]) => xs.filter((x) => x !== null && x !== undefined);
const sortedPaths = (s: Sample) => [...s.keys()].sort();

function v(
  id: string,
  kind: string,
  path: string,
  expected: string,
  actual: unknown,
  message: string,
): Violation {
  return { propertyId: `${id}/${kind}`, kind, path, expected, actual, message };
}

function aegis(
  id: string,
  ref: Sample,
  win: Sample,
  o: Required<Pick<StatMonitorOptions, 'alpha' | 'nullJump' | 'rangeShare'>>,
): Violation[] {
  const out: Violation[] = [];
  const numericPaths = sortedPaths(ref).filter(
    (p) => numbers(ref.get(p) ?? []).length > 0 && numbers(win.get(p) ?? []).length > 0,
  );
  const bonferroni = o.alpha / Math.max(1, numericPaths.length);
  for (const path of numericPaths) {
    const r = numbers(ref.get(path) ?? []);
    const w = numbers(win.get(path) ?? []);
    const ks = ks2samp(r, w);
    if (ks.pValue < bonferroni)
      out.push(
        v(
          id,
          'ks',
          path,
          `p >= ${bonferroni.toPrecision(3)}`,
          ks.pValue,
          `${path}: KS D=${ks.statistic.toFixed(3)}, p=${ks.pValue.toPrecision(3)}`,
        ),
      );
    const lo = Math.min(...r);
    const hi = Math.max(...r);
    const outside = w.filter((x) => x < lo || x > hi).length / w.length;
    if (outside >= o.rangeShare)
      out.push(
        v(
          id,
          'range',
          path,
          `[${lo}, ${hi}]`,
          outside,
          `${path}: ${(outside * 100).toFixed(0)}% of window outside history [${lo}, ${hi}]`,
        ),
      );
  }
  for (const path of sortedPaths(ref)) {
    const r = ref.get(path) ?? [];
    const w = win.get(path) ?? [];
    if (r.length === 0 || w.length === 0) continue;
    const nr = (r.length - nonNull(r).length) / r.length;
    const nw = (w.length - nonNull(w).length) / w.length;
    if (Math.abs(nw - nr) >= o.nullJump)
      out.push(
        v(
          id,
          'nullRate',
          path,
          `null share ${nr.toFixed(2)}`,
          nw,
          `${path}: null share ${nr.toFixed(2)} -> ${nw.toFixed(2)}`,
        ),
      );
  }
  return out;
}

const FEEL_ZERO = 1e-4;

/** Evidently-default per-column drift; returns null when the column cannot be tested. */
export function evidentlyColumnDrift(
  ref: unknown[],
  cur: unknown[],
): { test: string; drift: boolean; score: number } | null {
  const r = nonNull(ref);
  const c = nonNull(cur);
  if (r.length === 0 || c.length === 0) return null;
  const numeric = r.every((x) => typeof x === 'number') && c.every((x) => typeof x === 'number');
  const key = (x: unknown) => JSON.stringify(x);
  const nUnique = new Set([...r, ...c].map(key)).size;
  const categories = [...new Set([...r, ...c].map(key))].sort();
  const counts = (xs: unknown[]) => categories.map((k) => xs.filter((x) => key(x) === k).length);
  if (r.length <= 1000) {
    if (numeric && nUnique > 5) {
      const p = ks2samp(r as number[], c as number[]).pValue;
      return { test: 'ks', drift: p < 0.05, score: p };
    }
    if (nUnique > 2) {
      const ro = counts(r);
      const scale = c.length / r.length;
      const p = chiSquare(
        counts(c),
        ro.map((x) => x * scale),
      ).pValue;
      return { test: 'chisquare', drift: p < 0.05, score: p };
    }
    const first = categories[0] as string;
    const p = proportionZTest(r.map(key), c.map(key), first);
    return { test: 'z', drift: p < 0.05, score: p };
  }
  if (numeric && nUnique > 5) {
    const d = wasserstein(r as number[], c as number[]) / Math.max(stdPop(r as number[]), 0.001);
    return { test: 'wasserstein', drift: d >= 0.1, score: d };
  }
  let pr: number[];
  let pc: number[];
  if (numeric) {
    const edges = sturgesEdges([...(r as number[]), ...(c as number[])]);
    pr = histogram(r as number[], edges);
    pc = histogram(c as number[], edges);
  } else {
    pr = counts(r);
    pc = counts(c);
  }
  const norm = (xs: number[]) => {
    const s = xs.reduce((a, b) => a + b, 0);
    return xs.map((x) => (x === 0 ? FEEL_ZERO : x / s));
  };
  const d = jensenShannon(norm(pr), norm(pc));
  return { test: 'jensenshannon', drift: d >= 0.1, score: d };
}

function evidently(id: string, ref: Sample, win: Sample): Violation[] {
  const drifted: string[] = [];
  let tested = 0;
  for (const path of sortedPaths(ref)) {
    const res = evidentlyColumnDrift(ref.get(path) ?? [], win.get(path) ?? []);
    if (!res) continue;
    tested++;
    if (res.drift) drifted.push(`${path} (${res.test} ${res.score.toPrecision(3)})`);
  }
  if (tested === 0) return [];
  const share = drifted.length / tested;
  if (share < 0.5) return [];
  return [
    v(
      id,
      'datasetDrift',
      '$',
      'drifted column share < 0.5',
      share,
      `${drifted.length} of ${tested} columns drifted: ${drifted.join(', ')}`,
    ),
  ];
}

/** B-STAT monitor (stateful: feed calls in traffic order; `reset()` before an independent replay). */
export function createStatMonitor(opts: StatMonitorOptions): SyncBaselineMonitor {
  const id = `B-STAT:${opts.mode}:w${opts.window}`;
  const tuning = {
    alpha: opts.alpha ?? 0.05,
    nullJump: opts.nullJump ?? 0.2,
    rangeShare: opts.rangeShare ?? 0.2,
  };
  const reference = new Map<string, Sample>();
  {
    const byTool = new Map<string, Sample[]>();
    for (const rec of opts.reference) {
      getOrInit(byTool, rec.tool, () => []).push(sampleOf(rec.output));
    }
    for (const [tool, xs] of byTool) reference.set(tool, pool(xs));
  }
  const windows = new Map<string, Sample[]>();
  const push = (tool: string, s: Sample) => {
    const w = getOrInit(windows, tool, () => []);
    w.push(s);
    if (w.length > opts.window) w.shift();
    return w;
  };
  const reset = () => {
    windows.clear();
    for (const rec of opts.prefill ?? []) push(rec.tool, sampleOf(rec.output));
  };
  reset();
  const monitor = (input: MonitorInput): MonitorResult => {
    const w = push(input.tool, sampleOf(input.result));
    const ref = reference.get(input.tool);
    if (!ref || w.length < opts.window)
      return { verdict: 'unverifiable', checked: [], violations: [], disabled: [] };
    const win = pool(w);
    const violations = opts.mode === 'aegis' ? aegis(id, ref, win, tuning) : evidently(id, ref, win);
    return { verdict: violations.length ? 'violated' : 'verified', checked: [id], violations, disabled: [] };
  };
  return Object.assign(monitor, { id, stateful: true, reset });
}
