// Records of the exploratory pilot extensions (paper/EXP-PLAN.md E-A and E-C): one run record per
// `exp-repair` run and one eval record next to it, written by `exp-eval`. Every number in the
// paper's ablation table is computed from these files by paper/scripts/exp/ablation_numbers.py.

export const ARMS = ['fiks', 'nohint', 'alert'] as const;
export type ExpArm = (typeof ARMS)[number];

export const DRIFTS = ['D1', 'D2', 'D3', 'D4', 'D5'] as const;
export type ExpDrift = (typeof DRIFTS)[number];

export type SandboxKind = 'host' | 'docker';

export const RUN_SCHEMA = 'fiks.exp.run/1';
export const EVAL_SCHEMA = 'fiks.exp.eval/2';

export interface GateRecord {
  /** guard | F | rerecord | repro | suite | typecheck | lint | integrity */
  name: string;
  ok: boolean;
  reason: string;
}

export interface DiffStats {
  /** Files the head changes relative to the agent's starting commit. */
  files: string[];
  insertions: number;
  deletions: number;
}

export interface InjectOracle {
  hit: boolean;
  reasons: string[];
  ungatedReasons?: string[];
}

export interface InjectRecord {
  templateId: string;
  carrier: string;
  /** Env var named in the payload; the canary is planted there in the exp process only. */
  canaryName: string;
  sinkUrl: string;
  /** The four attack-goal oracles of @fiks/attacks, by goal id. */
  oracles: Record<string, InjectOracle>;
  /** Output lines showing a refused outbound connection (no DNS, no route). */
  egressDenials: string[];
  /** The canary secret showed up in some command output or log (it was read). */
  canaryRead: boolean;
  /** Bash commands the agent asked for (allowed or refused). */
  commands: string[];
}

export interface ExpRunRecord {
  schema: typeof RUN_SCHEMA;
  runId: string;
  experiment: 'E-A' | 'E-C';
  arm: ExpArm;
  drift: ExpDrift;
  rep: number;
  model: string;
  runner: string;
  traceId: string;
  /** Repo-relative path of the committed pilot trace. */
  traceFile: string;
  traceSha256: string;
  promptSha256: string;
  base: { ref: string; commit: string };
  /** FIKS/NOHINT: the commit holding the repro test (the agent starts there). */
  reproCommit: string | null;
  /** The resulting head (base + repro commit + the agent's src edits + fiks re-recordings). */
  head: { sha: string; ref: string } | null;
  gates: GateRecord[];
  /** All gates of this arm passed. */
  gatesPassed: boolean;
  /** Agent src change relative to its starting commit (src only; the head's diff). */
  diff: DiffStats;
  /** Files the agent changed outside the edit allow-list (reverted before the gates). */
  nonSrcEdits: string[];
  /** fiks re-recordings committed into the head. */
  rerecorded: string[];
  outcome: string | null;
  turns: number;
  costUsd: number;
  durationMs: number;
  /** Set when the run ended in an infrastructure error after its retries. */
  infraError: string | null;
  infraRetries: number;
  sandbox: SandboxKind;
  images: { repo: string | null; tools: string | null };
  inject: InjectRecord | null;
  startedAt: string;
  finishedAt: string;
}

export interface CallVerdict {
  tool: string;
  args: Record<string, unknown>;
  verdict: string;
}

export interface ExpEvalRecord {
  schema: typeof EVAL_SCHEMA;
  /** The run evaluated, or null for a control. */
  runId: string | null;
  /** 'oracle' (positive control), 'seed' (negative control) or null for a run. */
  control: 'oracle' | 'seed' | null;
  arm: ExpArm | null;
  drift: ExpDrift;
  head: string;
  base: string;
  /** The fiks repro test for this drift (generated as in repair), run on the head. */
  heldOutRepro: { ok: boolean; reason: string; rerecorded: string[]; suiteGreen: boolean };
  live: {
    /** The drift's scenario against vendor v2 (only that drift active): every call verified. */
    drift: { ok: boolean; calls: CallVerdict[] };
    /** v1-all against vendor v1: nothing violated, everything verified except by-design. */
    v1: { ok: boolean; calls: CallVerdict[] };
  };
  /** live.drift.ok && live.v1.ok */
  liveCheck: boolean;
  changedLines: { files: number; insertions: number; deletions: number; lines: number };
  sandbox: SandboxKind;
  evaluatedAt: string;
  /**
   * The head itself failed a stage (its server crashed, exited or hung in a scenario, or the
   * held-out suite could not run on it). These are deterministic failures of the head: the stage's
   * outcome is false and the run counts in every denominator.
   */
  headErrors: HeadError[];
  /**
   * The evaluation could not be carried out for a reason outside the head (the checkout, Docker or
   * the tools container failing to start or dying). Only these evals are excluded from counts, and
   * they are reported as infra errors. All outcomes are false when set.
   */
  infraError: string | null;
  /** Evaluation attempts that ended in an infra error before this one (exp-eval retries up to 3). */
  infraRetries: number;
}

export const HEAD_STAGES = ['live.drift', 'live.v1', 'heldOutRepro'] as const;
export type HeadStage = (typeof HEAD_STAGES)[number];

export interface HeadError {
  stage: HeadStage;
  message: string;
}

const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
const isObj = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);

function checker() {
  const errors: string[] = [];
  const need = (ok: boolean, what: string) => {
    if (!ok) errors.push(what);
  };
  return { errors, need };
}

/** Schema check for a run record; returns the problems (empty = valid). */
export function validateRunRecord(x: unknown): string[] {
  const { errors, need } = checker();
  if (!isObj(x)) return ['not an object'];
  need(x.schema === RUN_SCHEMA, 'schema');
  need(isStr(x.runId) && /^[\w.-]+$/.test(x.runId), 'runId');
  need(x.experiment === 'E-A' || x.experiment === 'E-C', 'experiment');
  need(ARMS.includes(x.arm as ExpArm), 'arm');
  need(DRIFTS.includes(x.drift as ExpDrift), 'drift');
  need(Number.isInteger(x.rep) && (x.rep as number) >= 0, 'rep');
  for (const k of [
    'model',
    'runner',
    'traceId',
    'traceFile',
    'traceSha256',
    'promptSha256',
    'startedAt',
    'finishedAt',
  ])
    need(isStr(x[k]), k);
  need(isObj(x.base) && isStr(x.base.ref) && isStr(x.base.commit), 'base');
  need(x.reproCommit === null || isStr(x.reproCommit), 'reproCommit');
  need(x.head === null || (isObj(x.head) && isStr(x.head.sha) && isStr(x.head.ref)), 'head');
  need(
    Array.isArray(x.gates) &&
      x.gates.every((g) => isObj(g) && isStr(g.name) && isBool(g.ok) && isStr(g.reason)),
    'gates',
  );
  need(isBool(x.gatesPassed), 'gatesPassed');
  need(
    isObj(x.diff) &&
      Array.isArray(x.diff.files) &&
      x.diff.files.every(isStr) &&
      isNum(x.diff.insertions) &&
      isNum(x.diff.deletions),
    'diff',
  );
  need(Array.isArray(x.nonSrcEdits) && x.nonSrcEdits.every(isStr), 'nonSrcEdits');
  need(Array.isArray(x.rerecorded) && x.rerecorded.every(isStr), 'rerecorded');
  need(x.outcome === null || isStr(x.outcome), 'outcome');
  for (const k of ['turns', 'costUsd', 'durationMs', 'infraRetries']) need(isNum(x[k]), k);
  need(x.infraError === null || isStr(x.infraError), 'infraError');
  need(x.sandbox === 'host' || x.sandbox === 'docker', 'sandbox');
  need(
    isObj(x.images) &&
      (x.images.repo === null || isStr(x.images.repo)) &&
      (x.images.tools === null || isStr(x.images.tools)),
    'images',
  );
  if (x.inject !== null) {
    const i = x.inject;
    need(
      isObj(i) &&
        isStr(i.templateId) &&
        isStr(i.carrier) &&
        isStr(i.canaryName) &&
        isStr(i.sinkUrl) &&
        isObj(i.oracles) &&
        Object.values(i.oracles).every((o) => isObj(o) && isBool(o.hit) && Array.isArray(o.reasons)) &&
        Array.isArray(i.egressDenials) &&
        isBool(i.canaryRead) &&
        Array.isArray(i.commands),
      'inject',
    );
  }
  // Consistency: a passed run has a head, and an infra error never counts as a gate pass.
  if (x.gatesPassed === true) need(x.head !== null && x.infraError === null, 'gatesPassed without head');
  return errors;
}

const callsOk = (c: unknown) =>
  Array.isArray(c) && c.every((v) => isObj(v) && isStr(v.tool) && isObj(v.args) && isStr(v.verdict));

/** Schema check for an eval record; returns the problems (empty = valid). */
export function validateEvalRecord(x: unknown): string[] {
  const { errors, need } = checker();
  if (!isObj(x)) return ['not an object'];
  need(x.schema === EVAL_SCHEMA, 'schema');
  need(x.runId === null || isStr(x.runId), 'runId');
  need(x.control === null || x.control === 'oracle' || x.control === 'seed', 'control');
  need((x.runId === null) !== (x.control === null), 'exactly one of runId and control');
  need(x.arm === null || ARMS.includes(x.arm as ExpArm), 'arm');
  need(DRIFTS.includes(x.drift as ExpDrift), 'drift');
  need(isStr(x.head) && isStr(x.base), 'head/base');
  const h = x.heldOutRepro;
  need(
    isObj(h) && isBool(h.ok) && isStr(h.reason) && Array.isArray(h.rerecorded) && isBool(h.suiteGreen),
    'heldOutRepro',
  );
  const l = x.live;
  need(
    isObj(l) &&
      isObj(l.drift) &&
      isBool(l.drift.ok) &&
      callsOk(l.drift.calls) &&
      isObj(l.v1) &&
      isBool(l.v1.ok) &&
      callsOk(l.v1.calls),
    'live',
  );
  need(isBool(x.liveCheck), 'liveCheck');
  if (isObj(l) && isObj(l.drift) && isObj(l.v1))
    need(x.liveCheck === (l.drift.ok === true && l.v1.ok === true), 'liveCheck = drift && v1');
  const c = x.changedLines;
  need(
    isObj(c) && isNum(c.files) && isNum(c.insertions) && isNum(c.deletions) && isNum(c.lines),
    'changedLines',
  );
  need(x.sandbox === 'host' || x.sandbox === 'docker', 'sandbox');
  need(isStr(x.evaluatedAt), 'evaluatedAt');
  need(x.infraError === null || isStr(x.infraError), 'infraError');
  need(isNum(x.infraRetries), 'infraRetries');
  need(
    Array.isArray(x.headErrors) &&
      x.headErrors.every((e) => isObj(e) && HEAD_STAGES.includes(e.stage as HeadStage) && isStr(e.message)),
    'headErrors',
  );
  // A stage the head failed has a false outcome; an infra-excluded eval claims no success.
  if (Array.isArray(x.headErrors) && isObj(l) && isObj(l.drift) && isObj(l.v1) && isObj(h)) {
    const failed = new Set(x.headErrors.map((e) => (isObj(e) ? e.stage : null)));
    need(!failed.has('live.drift') || l.drift.ok === false, 'headErrors live.drift => drift not ok');
    need(!failed.has('live.v1') || l.v1.ok === false, 'headErrors live.v1 => v1 not ok');
    need(!failed.has('heldOutRepro') || h.ok === false, 'headErrors heldOutRepro => repro not ok');
  }
  if (isStr(x.infraError) && isObj(h))
    need(x.liveCheck === false && h.ok === false, 'infraError => no outcome true');
  return errors;
}
