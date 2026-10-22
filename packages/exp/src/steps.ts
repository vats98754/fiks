// K1 (PLAN 8.2, 13): the ConfigStep ladder S+, S0, 1..11 with projected Claude usage, and the fit
// of every remaining Claude run plus the non-overlappable non-Claude wall-clock into the window W.
//
// Units: an Opus attempt or session = 1, Sonnet 0.5, Haiku 0.2. Judge and pool calls are converted
// at token cost (USD per call / USD per Opus attempt). R10 (E11), R11 (D10), B-OM and the ollama
// traffic are never ConfigSteps and never in the projection; the ollama share of R9 has its own
// wall-clock rule (ollamaRule).
//
// Every default below is a PLAN 8.1/13 planning value [estimate]; K1 replaces them with measured
// values (`fit --params`), and the K1 addendum records which were measured.

import type { ConfigStep, ConfigStepId } from '@fiks/interfaces';
import { stratifiedSubset } from './rng.ts';

export const MODEL = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
} as const;
export const ALL_MODELS = [MODEL.opus, MODEL.sonnet, MODEL.haiku];

/** Usage weight of one attempt or session of `model` (PLAN 13 header). */
export function unitOf(model: string): number {
  if (model.includes('opus')) return 1;
  if (model.includes('sonnet')) return 0.5;
  if (model.includes('haiku')) return 0.2;
  throw new Error(`no usage unit for model ${model}`);
}

export const CONFIRMATORY_ARMS = ['FIKS', 'L1', 'COMP'] as const;
/** Exploratory R4 rungs (Opus x 3 attempts each), in the order the K1 walk cuts them (steps 1-4). */
export const RUNG_CUT_ORDER = ['COMP-plain', 'L1p', 'COMP-norep', 'L1-noIV'] as const;

export interface ProjectionParams {
  /** Detected test drifts (PLAN 5.1: approx. 0.75 x 72 + 0.30 x 24 = 61). */
  detectedTestDrifts: number;
  /** Drift ids, when known (F9); otherwise placeholders T001.. are used. */
  driftIds?: string[];
  /** Stratum per drift id, for the S4 stratified subset. */
  driftStrata?: Record<string, string>;
  /** Floor for H1-H4 (PLAN 13): the S4 subset is never below it. */
  driftFloor: number;
  /** Units A1 still owes if it was cut short (measured from the A1 registry). */
  a1LeftoverUnits: number;
  r2JudgeCalls: number;
  judgeCallUsd: number;
  poolCalls: number;
  poolCallUsd: number;
  /** USD per Opus repair attempt, the conversion base for judge and pool calls. */
  opusAttemptUsd: number;
  /** A2 worst case: drifts authored and Claude units per drift (ideation, implementation, ref B, rating). */
  a2WorstDrifts: number;
  a2UnitsPerDrift: number;
  /** R9 Claude share: domains x tasks x trials per Claude agent (Opus, Sonnet, Haiku). */
  r9Domains: number;
  r9Tasks: number;
  r9Trials: number;
  /** R3 REPRO-AGENT samples per (drift, model). */
  r3Samples: number;
  /** Exploratory rung attempts per drift (Opus). */
  rungAttempts: number;
  /** R6: benign cases x arms x attempts (Opus). */
  r6Attempts: number;
  /** R7: payloads x carriers x {raw, strict}; adaptive rounds; dev utility attempts (Opus). */
  r7Payloads: number;
  r7PayloadsAfterCut: number;
  r7Carriers: number;
  r7Adaptive: number;
  r7Utility: number;
  /** R8: bugs x arms x attempts (Opus). */
  r8Bugs: number;
  r8BugsAfterCut: number;
  r8ArmsTimesAttempts: number;
  /** PLAN 8.2: 30% reserve on the Claude projection. */
  reserve: number;
}

export const DEFAULT_PARAMS: ProjectionParams = {
  detectedTestDrifts: 61,
  driftFloor: 40,
  a1LeftoverUnits: 0,
  r2JudgeCalls: 6000,
  judgeCallUsd: 55 / 6000,
  poolCalls: 850,
  poolCallUsd: 35 / 850,
  opusAttemptUsd: 0.16,
  a2WorstDrifts: 40,
  a2UnitsPerDrift: 3.5,
  r9Domains: 2,
  r9Tasks: 20,
  r9Trials: 3,
  r3Samples: 2,
  rungAttempts: 3,
  r6Attempts: 270,
  r7Payloads: 12,
  r7PayloadsAfterCut: 6,
  r7Carriers: 10,
  r7Adaptive: 40,
  r7Utility: 232,
  r8Bugs: 4,
  r8BugsAfterCut: 2,
  r8ArmsTimesAttempts: 15,
  reserve: 0.3,
};

/** What a ladder position runs; every field is fixed by the cumulative cuts above it. */
export interface StepConfig {
  a: number;
  /** R4 confirmatory models. */
  models: string[];
  /** R3 REPRO-AGENT models. */
  r3Models: string[];
  rungs: string[];
  adaptive: boolean;
  r7Payloads: number;
  r8Bugs: number;
  a2: boolean;
  drifts: string[];
}

export interface K1Step extends ConfigStep {
  /** What this step cuts relative to the previous one (PLAN 13 table). */
  cut: string;
  /** False when the cut removes nothing here (e.g. S4 with <= driftFloor drifts); skipped by the walk. */
  applicable: boolean;
  config: StepConfig;
  /** Claude units per remaining run, before the reserve. */
  breakdown: Record<string, number>;
}

const r1 = (x: number) => Math.round(x * 1e6) / 1e6;

export function driftIdsOf(p: ProjectionParams): string[] {
  if (p.driftIds && p.driftIds.length > 0) return [...p.driftIds];
  return Array.from({ length: p.detectedTestDrifts }, (_, i) => `T${String(i + 1).padStart(3, '0')}`);
}

/** Claude units of every remaining run under `c` (R10, R11, B-OM and ollama traffic excluded). */
export function projectRuns(c: StepConfig, p: ProjectionParams): Record<string, number> {
  const opus = unitOf(MODEL.opus);
  const D = driftIdsOf(p).length;
  const sumUnits = (ms: string[]) => ms.reduce((s, m) => s + unitOf(m), 0);
  const perCall = (usd: number) => usd / p.opusAttemptUsd;
  return {
    A1: r1(p.a1LeftoverUnits),
    R2: r1(p.r2JudgeCalls * perCall(p.judgeCallUsd)),
    A2: r1(c.a2 ? p.a2WorstDrifts * p.a2UnitsPerDrift : 0),
    'P-pool': r1(p.poolCalls * perCall(p.poolCallUsd)),
    R9: r1(p.r9Domains * p.r9Tasks * p.r9Trials * sumUnits(ALL_MODELS)),
    R3: r1(D * p.r3Samples * sumUnits(c.r3Models)),
    R4: r1(
      c.drifts.length * CONFIRMATORY_ARMS.length * c.a * sumUnits(c.models) +
        D * c.rungs.length * p.rungAttempts * opus,
    ),
    R6: r1(p.r6Attempts * opus),
    R7: r1((c.r7Payloads * p.r7Carriers * 2 + (c.adaptive ? p.r7Adaptive : 0) + p.r7Utility) * opus),
    R8: r1(c.r8Bugs * p.r8ArmsTimesAttempts * opus),
  };
}

export const PROJECTED_RUNS = ['A1', 'R2', 'A2', 'P-pool', 'R9', 'R3', 'R4', 'R6', 'R7', 'R8'];

function step(id: ConfigStepId, cut: string, c: StepConfig, p: ProjectionParams, applicable = true): K1Step {
  const breakdown = projectRuns(c, p);
  const projectedUnits = r1(Object.values(breakdown).reduce((s, x) => s + x, 0));
  return {
    id,
    arms: [...CONFIRMATORY_ARMS, ...c.rungs],
    models: [...c.models],
    a: c.a,
    drifts: [...c.drifts],
    projectedUnits,
    cut,
    applicable,
    config: { ...c, models: [...c.models], r3Models: [...c.r3Models], rungs: [...c.rungs] },
    breakdown,
  };
}

/** S+, S0 and steps 1..11 in PLAN 13 order; each step applies every cut above it. */
export function configSteps(p: ProjectionParams = DEFAULT_PARAMS, seed = 'k1'): K1Step[] {
  const drifts = driftIdsOf(p);
  const s0: StepConfig = {
    a: 4,
    models: [...ALL_MODELS],
    r3Models: [...ALL_MODELS],
    rungs: [...RUNG_CUT_ORDER],
    adaptive: true,
    r7Payloads: p.r7Payloads,
    r8Bugs: p.r8Bugs,
    a2: true,
    drifts,
  };
  const out: K1Step[] = [step('S+', 'none: S0 with a = 5', { ...s0, a: 5 }, p), step('S0', 'none', s0, p)];
  let c = s0;
  const push = (id: ConfigStepId, cut: string, next: StepConfig, applicable = true) => {
    c = next;
    out.push(step(id, cut, c, p, applicable));
  };
  const dropRung = (r: string) => c.rungs.filter((x) => x !== r);
  push(1, 'COMP-plain (E8)', { ...c, rungs: dropRung('COMP-plain') });
  push(2, 'L1p', { ...c, rungs: dropRung('L1p') });
  push(3, 'COMP-norep rung', { ...c, rungs: dropRung('COMP-norep') });
  push(4, 'L1-noIV rung', { ...c, rungs: dropRung('L1-noIV') });
  push(5, 'adaptive attacker', { ...c, adaptive: false });
  push(6, `R7 to ${p.r7PayloadsAfterCut} payloads`, { ...c, r7Payloads: p.r7PayloadsAfterCut });
  push(7, `real bugs beyond ${p.r8BugsAfterCut}`, { ...c, r8Bugs: p.r8BugsAfterCut });
  push(8, 'S0 -> S2: a = 4 -> 3 for FIKS, L1, COMP', { ...c, a: 3 });
  push(9, 'S2 -> S3: drop Haiku from R3/R4', {
    ...c,
    models: c.models.filter((m) => m !== MODEL.haiku),
    r3Models: c.r3Models.filter((m) => m !== MODEL.haiku),
  });
  push(10, 'top-up wave A2', { ...c, a2: false });
  const subset = stratifiedSubset(drifts, p.driftFloor, seed, 'S4', (d) => p.driftStrata?.[d] ?? 'all');
  const s4 = drifts.length > p.driftFloor;
  push(
    11,
    s4
      ? `S4: confirmatory drifts -> seeded stratified subset of ${subset.length}`
      : `S4 not applicable: ${drifts.length} drifts <= floor ${p.driftFloor}`,
    { ...c, drifts: subset },
    s4,
  );
  return out;
}

/** PLAN 8.2: the walk must remove a positive amount at every step. Throws otherwise. */
export function assertStrictlyDecreasing(steps: K1Step[]): void {
  const walk = steps.filter((s) => s.id !== 'S+' && s.applicable);
  for (let i = 1; i < walk.length; i++) {
    const prev = walk[i - 1] as K1Step;
    const cur = walk[i] as K1Step;
    if (!(cur.projectedUnits < prev.projectedUnits)) {
      throw new Error(
        `K1 walk is not strictly decreasing: step ${cur.id} projects ${cur.projectedUnits} >= ${prev.projectedUnits} (step ${prev.id})`,
      );
    }
  }
}

// --- the fit ------------------------------------------------------------------------------------

export interface FitInputs {
  /** Claude usage units per wall-clock hour sustained at the chosen worker count (T0/R1, cap events in). */
  sustainedUnitsPerHour: number;
  windowDays: number;
  /** R0 infra validation (counted against W's start). */
  r0Hours: number;
  cp2Hours: number;
  /** R5 grading wall-clock (planning 40-75 h, re-measured at R0). */
  r5Hours: number;
  /** Docker memory rule: may R5 containers run beside the Claude workers of R6-R8? */
  memory: {
    workers: number;
    rssPerWorkerGb: number;
    r5Containers: number;
    containerLimitGb: number;
    dockerGb: number;
  };
}

export const DEFAULT_FIT: Omit<FitInputs, 'sustainedUnitsPerHour'> = {
  windowDays: 8,
  r0Hours: 6,
  cp2Hours: 1,
  r5Hours: 75,
  memory: { workers: 1, rssPerWorkerGb: 1, r5Containers: 4, containerLimitGb: 1.5, dockerGb: 6 },
};

export interface StepFit {
  id: ConfigStepId;
  projectedUnits: number;
  withReserveUnits: number;
  claudeHours: number;
  r0Hours: number;
  cp2Hours: number;
  r5NonOverlapHours: number;
  totalHours: number;
  windowHours: number;
  fits: boolean;
}

/** PLAN 8.2 overlap rule: R5 overlaps R6-R8 only while workers x RSS + containers x limit <= Docker GB. */
export function r5NonOverlapHours(s: K1Step, f: FitInputs): number {
  const m = f.memory;
  const fitsMemory = m.workers * m.rssPerWorkerGb + m.r5Containers * m.containerLimitGb <= m.dockerGb;
  const overlapH = fitsMemory
    ? ((s.breakdown.R6 ?? 0) + (s.breakdown.R7 ?? 0) + (s.breakdown.R8 ?? 0)) / f.sustainedUnitsPerHour
    : 0;
  return Math.max(0, f.r5Hours - overlapH);
}

export function fitStep(s: K1Step, p: ProjectionParams, f: FitInputs): StepFit {
  if (!(f.sustainedUnitsPerHour > 0)) throw new Error('sustainedUnitsPerHour must be > 0');
  const withReserveUnits = r1(s.projectedUnits * (1 + p.reserve));
  const claudeHours = withReserveUnits / f.sustainedUnitsPerHour;
  const nonOverlap = r5NonOverlapHours(s, f);
  const totalHours = claudeHours + f.r0Hours + f.cp2Hours + nonOverlap;
  const windowHours = f.windowDays * 24;
  return {
    id: s.id,
    projectedUnits: s.projectedUnits,
    withReserveUnits,
    claudeHours: r1(claudeHours),
    r0Hours: f.r0Hours,
    cp2Hours: f.cp2Hours,
    r5NonOverlapHours: r1(nonOverlap),
    totalHours: r1(totalHours),
    windowHours,
    fits: totalHours <= windowHours,
  };
}

export interface FitResult {
  chosen: K1Step;
  fits: boolean;
  table: StepFit[];
  note: string;
}

/**
 * S+ only if everything (incl. the reserve) fits at a = 5; otherwise the first of S0, 1..11 that
 * fits. If none fits, step 11 is chosen with fits = false: R4 runs at S4 breadth-first and stops at
 * the cap (PLAN 13), and the realised n and MDE are reported.
 */
export function fit(steps: K1Step[], p: ProjectionParams, f: FitInputs): FitResult {
  assertStrictlyDecreasing(steps);
  const table = steps.map((s) => fitStep(s, p, f));
  const plus = table.find((t) => t.id === 'S+');
  if (plus?.fits) {
    return { chosen: steps[0] as K1Step, fits: true, table, note: 'everything fits at a = 5 (S+)' };
  }
  for (const [i, t] of table.entries()) {
    if (t.id !== 'S+' && (steps[i] as K1Step).applicable && t.fits)
      return { chosen: steps[i] as K1Step, fits: true, table, note: `first fitting step: ${t.id}` };
  }
  return {
    chosen: steps[steps.length - 1] as K1Step,
    fits: false,
    table,
    note: 'no step fits: R4 runs at S4 breadth-first and stops at the cap; report the realised n and MDE',
  };
}

// --- the separate ollama wall-clock rule ---------------------------------------------------------

export interface OllamaRule {
  sessions: number;
  tokensPerSession: number;
  tokensPerSec: number | null;
  projectedHours: number | null;
  limitHours: number;
  cut: boolean;
  reason: string;
}

/** PLAN 8.2: cut the ollama share of R9 if T0's ollama throughput projects > 10 h for it. */
export function ollamaRule(
  p: ProjectionParams,
  tokensPerSec: number | null,
  tokensPerSession = 3000,
  limitHours = 10,
): OllamaRule {
  const sessions = p.r9Domains * p.r9Tasks * p.r9Trials;
  if (tokensPerSec === null || !(tokensPerSec > 0)) {
    return {
      sessions,
      tokensPerSession,
      tokensPerSec,
      projectedHours: null,
      limitHours,
      cut: true,
      reason: 'no measured ollama throughput (T0 ollama section skipped): the share cannot be projected',
    };
  }
  const projectedHours = r1((sessions * tokensPerSession) / tokensPerSec / 3600);
  const cut = projectedHours > limitHours;
  return {
    sessions,
    tokensPerSession,
    tokensPerSec,
    projectedHours,
    limitHours,
    cut,
    reason: cut
      ? `projects ${projectedHours} h > ${limitHours} h: the ollama share of R9 is cut`
      : `projects ${projectedHours} h <= ${limitHours} h: kept`,
  };
}
