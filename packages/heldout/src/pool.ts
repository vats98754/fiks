// Patch pools for H2 (PLAN 5.6).
//   Primary (arm-independent; built after F9, frozen at F10): P1-P8 applied to ref A, >= 4
//   "plausible but wrong" patches, ref A, ref B, >= 2 alternative fixes written without seeing A or
//   B. Every class label comes from the held-out grade, never from the generator; labels by
//   generator vs by grade are cross-tabulated. Dedupe by normalised diff. A drift with < 3 patches
//   in either class is flagged and excluded from H2 (counted). The pool manifest also carries the
//   drift's requestChanging flag (3.0, computed from ref A only).
//   Secondary (E5 only): every candidate captured at any gate or CI invocation in R4, deduped, with
//   a stratified cap of 30 per drift (strata = source arm), seeded.
// Builders are pure functions of their inputs and the seed: the same inputs and seed give the
// same bytes (hash included).
import type { GradeRecord } from '@fiks/interfaces';
import { diffSha } from './diff.ts';
import { canonicalJson, sha256 } from './hash.ts';

/** Where a primary-pool candidate came from (PLAN 5.6). */
export type PoolSource =
  | 'P1'
  | 'P2'
  | 'P3'
  | 'P4'
  | 'P5'
  | 'P6'
  | 'P7'
  | 'P8'
  | 'plausible-wrong'
  | 'refA'
  | 'refB'
  | 'alternative';

export const SOURCE_ORDER: readonly PoolSource[] = [
  'refA',
  'refB',
  'alternative',
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'P7',
  'P8',
  'plausible-wrong',
];

/** What a generator intends the patch to be (cross-tabulated against the grade, never used as a label). */
export const INTENDED: Record<PoolSource, 'correct' | 'incorrect'> = {
  refA: 'correct',
  refB: 'correct',
  alternative: 'correct',
  P1: 'incorrect',
  P2: 'incorrect',
  P3: 'incorrect',
  P4: 'incorrect',
  P5: 'incorrect',
  P6: 'incorrect',
  P7: 'incorrect',
  P8: 'incorrect',
  'plausible-wrong': 'incorrect',
};

export interface PoolCandidate {
  id: string;
  source: PoolSource;
  /** Model or author that wrote it (e.g. claude-haiku-5-5, HOLD-builder). */
  generator: string;
  diff: string;
}

export interface PoolPatch {
  id: string;
  source: PoolSource;
  generator: string;
  diffSha: string;
  class: 'correct' | 'incorrect';
  /** Ids of later candidates with the same normalised diff. */
  duplicates: string[];
}

export interface PrimaryDriftEntry {
  drift: string;
  requestChanging: boolean;
  patches: PoolPatch[];
  counts: { correct: number; incorrect: number; candidates: number; duplicates: number; ungraded: number };
  /** < 3 patches in either class: flagged, excluded from H2. */
  excluded: boolean;
  /** source -> {correct, incorrect}: generator intent vs grade. */
  crossTab: Record<string, { correct: number; incorrect: number }>;
}

export interface PrimaryPool {
  kind: 'primary';
  seed: string;
  minPerClass: number;
  drifts: PrimaryDriftEntry[];
  excluded: string[];
  hash: string;
}

export const MIN_PER_CLASS = 3;

/** Deterministic PRNG keyed by a label and the seed (sha256 counter mode). */
export function seededRandom(label: string, seed: string): () => number {
  let i = 0;
  return () => {
    const h = sha256(`${label}\u0000${seed}\u0000${i++}`);
    return Number.parseInt(h.slice(0, 13), 16) / 2 ** 52;
  };
}

export function seededShuffle<T>(xs: readonly T[], label: string, seed: string): T[] {
  const r = seededRandom(label, seed);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const bySource = (a: PoolCandidate, b: PoolCandidate) =>
  SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) || a.id.localeCompare(b.id);

/** One drift's primary pool entry from its candidates and their grades. */
export function primaryEntry(
  drift: string,
  candidates: readonly PoolCandidate[],
  grades: readonly GradeRecord[],
  opts: { seed: string; requestChanging: boolean; minPerClass?: number },
): PrimaryDriftEntry {
  const min = opts.minPerClass ?? MIN_PER_CLASS;
  const grade = new Map(grades.map((g) => [g.patchId, g]));
  const kept = new Map<string, PoolPatch>();
  let duplicates = 0;
  let ungraded = 0;
  for (const c of [...candidates].sort(bySource)) {
    const sha = diffSha(c.diff);
    const first = kept.get(sha);
    if (first) {
      first.duplicates.push(c.id);
      duplicates++;
      continue;
    }
    const g = grade.get(c.id);
    if (!g) {
      ungraded++;
      continue;
    }
    kept.set(sha, {
      id: c.id,
      source: c.source,
      generator: c.generator,
      diffSha: sha,
      class: g.correct ? 'correct' : 'incorrect',
      duplicates: [],
    });
  }
  const patches = seededShuffle([...kept.values()], `primary:${drift}`, opts.seed);
  const correct = patches.filter((p) => p.class === 'correct').length;
  const incorrect = patches.length - correct;
  const crossTab: PrimaryDriftEntry['crossTab'] = {};
  for (const p of patches) {
    const key = `${p.source} (intended ${INTENDED[p.source]})`;
    const row = crossTab[key] ?? { correct: 0, incorrect: 0 };
    row[p.class]++;
    crossTab[key] = row;
  }
  return {
    drift,
    requestChanging: opts.requestChanging,
    patches,
    counts: { correct, incorrect, candidates: candidates.length, duplicates, ungraded },
    excluded: correct < min || incorrect < min,
    crossTab: Object.fromEntries(Object.entries(crossTab).sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function buildPrimaryPool(
  drifts: readonly {
    drift: string;
    candidates: readonly PoolCandidate[];
    grades: readonly GradeRecord[];
    requestChanging: boolean;
  }[],
  opts: { seed: string; minPerClass?: number },
): PrimaryPool {
  const entries = [...drifts]
    .sort((a, b) => a.drift.localeCompare(b.drift))
    .map((d) =>
      primaryEntry(d.drift, d.candidates, d.grades, {
        seed: opts.seed,
        requestChanging: d.requestChanging,
        minPerClass: opts.minPerClass,
      }),
    );
  const body = {
    kind: 'primary' as const,
    seed: opts.seed,
    minPerClass: opts.minPerClass ?? MIN_PER_CLASS,
    drifts: entries,
    excluded: entries.filter((e) => e.excluded).map((e) => e.drift),
  };
  return { ...body, hash: sha256(canonicalJson(body)) };
}

// --- Secondary pool --------------------------------------------------------------------------

export interface CapturedCandidate {
  id: string;
  drift: string;
  /** Source arm (the stratum). */
  arm: string;
  diff: string;
}

export interface SecondaryDriftEntry {
  drift: string;
  /** Distinct candidates (after dedupe) per arm. */
  available: Record<string, number>;
  /** Kept per arm. */
  kept: Record<string, number>;
  patches: { id: string; arm: string; diffSha: string }[];
}

export interface SecondaryPool {
  kind: 'secondary';
  seed: string;
  cap: number;
  drifts: SecondaryDriftEntry[];
  hash: string;
}

export const SECONDARY_CAP = 30;

/**
 * Largest-remainder allocation of `cap` over strata by size, never above a stratum's size; ties
 * broken by stratum name.
 */
export function allocate(sizes: Record<string, number>, cap: number): Record<string, number> {
  const names = Object.keys(sizes).sort();
  const total = names.reduce((s, n) => s + (sizes[n] ?? 0), 0);
  if (total <= cap) return Object.fromEntries(names.map((n) => [n, sizes[n] ?? 0]));
  const quota = names.map((n) => ({ n, q: ((sizes[n] ?? 0) * cap) / total }));
  const out: Record<string, number> = Object.fromEntries(quota.map(({ n, q }) => [n, Math.floor(q)]));
  let left = cap - Object.values(out).reduce((s, v) => s + v, 0);
  const order = [...quota].sort(
    (a, b) => b.q - Math.floor(b.q) - (a.q - Math.floor(a.q)) || a.n.localeCompare(b.n),
  );
  for (const { n } of order) {
    if (left === 0) break;
    if ((out[n] ?? 0) < (sizes[n] ?? 0)) {
      out[n] = (out[n] ?? 0) + 1;
      left--;
    }
  }
  return out;
}

export function buildSecondaryPool(
  captured: readonly CapturedCandidate[],
  opts: { seed: string; cap?: number },
): SecondaryPool {
  const cap = opts.cap ?? SECONDARY_CAP;
  const drifts = [...new Set(captured.map((c) => c.drift))].sort();
  const entries: SecondaryDriftEntry[] = drifts.map((drift) => {
    const seen = new Set<string>();
    const strata = new Map<string, { id: string; arm: string; diffSha: string }[]>();
    for (const c of [...captured].filter((x) => x.drift === drift).sort((a, b) => a.id.localeCompare(b.id))) {
      const sha = diffSha(c.diff);
      if (seen.has(sha) || !c.diff.trim()) continue;
      seen.add(sha);
      const list = strata.get(c.arm) ?? [];
      list.push({ id: c.id, arm: c.arm, diffSha: sha });
      strata.set(c.arm, list);
    }
    const available = Object.fromEntries([...strata].map(([a, l]) => [a, l.length]).sort());
    const kept = allocate(available, cap);
    const patches = Object.keys(kept)
      .sort()
      .flatMap((arm) =>
        seededShuffle(strata.get(arm) ?? [], `secondary:${drift}:${arm}`, opts.seed).slice(0, kept[arm] ?? 0),
      );
    return { drift, available, kept, patches };
  });
  const body = { kind: 'secondary' as const, seed: opts.seed, cap, drifts: entries };
  return { ...body, hash: sha256(canonicalJson(body)) };
}
