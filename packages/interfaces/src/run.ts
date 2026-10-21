// Run bookkeeping shared by every experiment stream (PLAN.md Appendix, P6, P10, P11).

/** One unit of work. Results are keyed by it and never overwritten (P6). */
export interface RunKey {
  experiment: string;
  arm: string;
  model: string;
  domain: string;
  drift: string;
  /** Attempt index within the (arm, model, domain, drift) cell. */
  attempt: number;
}

const RUN_KEY_FIELDS = ['experiment', 'arm', 'model', 'domain', 'drift', 'attempt'] as const;

/** String form `exp/arm/model/domain/drift/attempt`. No component may contain `/` or be empty. */
export function formatRunKey(k: RunKey): string {
  const parts = RUN_KEY_FIELDS.map((f) => String(k[f]));
  RUN_KEY_FIELDS.forEach((f, i) => {
    const p = parts[i] ?? '';
    if (p === '' || p.includes('/'))
      throw new Error(`RunKey.${f} must be non-empty and contain no '/': ${p}`);
  });
  if (!Number.isInteger(k.attempt) || k.attempt < 0) {
    throw new Error(`RunKey.attempt must be a non-negative integer: ${k.attempt}`);
  }
  return parts.join('/');
}

/** Inverse of `formatRunKey`; throws on anything that is not exactly six components. */
export function parseRunKey(s: string): RunKey {
  const parts = s.split('/');
  const [experiment, arm, model, domain, drift, attempt] = parts;
  if (
    parts.length !== 6 ||
    parts.some((p) => p === '') ||
    attempt === undefined ||
    !/^\d+$/.test(attempt) ||
    experiment === undefined ||
    arm === undefined ||
    model === undefined ||
    domain === undefined ||
    drift === undefined
  ) {
    throw new Error(`not a RunKey (want exp/arm/model/domain/drift/attempt): ${JSON.stringify(s)}`);
  }
  return { experiment, arm, model, domain, drift, attempt: Number(attempt) };
}

export type CiFinal = 'green' | 'red' | 'none';
export type IssueValidation = 'pass' | 'fail' | 'n/a';
export type IvPlacement = 'pre' | 'post' | 'none';
export type TraceFormat = 'raw' | 'strict';

/** Filled by `paper/scripts/classify_outcome.py`; `contract_update_proposed` only for FIKS+CU (E4). */
export type AttemptOutcome = string;

export interface TokenUsage {
  in: number;
  out: number;
  cacheRead: number;
  cacheCreate: number;
}

/** One repair attempt of one arm. */
export interface AttemptRecord {
  runKey: RunKey;
  /** The arm reached `would_open_pr` (experiments) or opened a PR (product). */
  prExposed: boolean;
  ciFinal: CiFinal;
  issueValidation: IssueValidation;
  ivPlacement: IvPlacement;
  headSha: string | null;
  /** Null until `classify_outcome.py` fills it. */
  outcome: AttemptOutcome | null;
  sessions: number;
  turns: number;
  tokens: TokenUsage;
  costUsd: number;
  /** Wall-clock milliseconds per phase (e.g. `repro`, `agent`, `gates`, `ci`). */
  wallMs: Record<string, number>;
  candidateIds: string[];
  fiksCommit: string;
  imageDigest: string | null;
  traceFormat: TraceFormat;
  frozenTraceSha: string;
  /** Path of this attempt's RerecordLog JSONL. */
  rerecordLog: string | null;
}

export type ReproSource = 'fiks' | 'agent';
export type FOnBase = 'pass' | 'fail' | 'error';

/** A reproduction test, written by fiks or by an agent, and how it behaves on the base. */
export interface ReproTestRecord {
  runKey: RunKey;
  source: ReproSource;
  /** Session or revision round that produced it (0 = before the agent ran). */
  round: number;
  /** Relative to the target repo. */
  path: string;
  sha: string;
  fOnBase: FOnBase;
  isFinal: boolean;
  isFirst: boolean;
  /** Recording files the test read while running (fs-read log). */
  recordingsRead: string[];
  /** The test inlines its recording, so it cannot be re-recorded (counted, reported). */
  inlineRecording: boolean;
}

export type CandidateStage = 'gate' | 'iv' | 'ci' | 'revision';

/** A candidate patch captured at a gate or CI invocation (P11). */
export interface CandidateRecord {
  id: string;
  runKey: RunKey;
  stage: CandidateStage;
  diffSha: string;
  diffPath: string;
}

/** The held-out grading criteria of one patch (PLAN 3.0). */
export interface GradeCriteria {
  /** Hidden tests pass. */
  hidden: boolean;
  /** Two-reference semantic differential agrees. */
  differential: boolean;
  /** Inputs where references A and B disagree (kept, counted, reported). */
  ambiguousInputs: number;
  /** The renamed-id variant of the hidden tests passes. */
  renamedId: boolean;
  /** No new SAST finding confirmed by >= 2 tools. */
  sast: boolean;
  /** Replay against `truth()` agrees. */
  truthReplay: boolean;
}

export interface GradeRecord {
  patchId: string;
  drift: string;
  criteria: GradeCriteria;
  correct: boolean;
  reasons: string[];
}

/** A step of the pre-registered configuration ladder (PLAN 8.2). */
export type ConfigStepId = 'S+' | 'S0' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export interface ConfigStep {
  id: ConfigStepId;
  arms: string[];
  models: string[];
  /** Attempts per (arm, model, drift) cell. */
  a: number;
  /** Drift ids in the step. */
  drifts: string[];
  /** Projected attempt units, used by the K1 fit. */
  projectedUnits: number;
}
