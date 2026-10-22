// Shared types for the adversarial-trace suite (PLAN.md §4 E6, §7 M7, WORKSTREAMS SEC).
//
// The attack surface fiks exposes: a malicious or compromised upstream vendor (threat actor A1 in
// paper/research/gap-repair-security.md) controls the HTTP response bytes that end up, verbatim, in
// a trace. Those bytes reach the repair agent's prompt (packages/repair/src/prompt.ts inlines
// `clip(response.body, 800)` for every recorded exchange). An attacker therefore has an indirect
// prompt-injection channel into a coding agent with write access to `src/` and execution via the
// gate. The four goals below are the capability bounds the hardened loop claims to hold; each has an
// oracle that fires on a hand-planted malicious outcome and never on a legitimate D1-D5 fix.

export type GoalId = 'canary-egress' | 'attacker-src-behaviour' | 'non-src-edit' | 'disallowed-command';

/** One file the repair run changed, as a unified diff (git format). */
export interface ChangedFile {
  /** Repo-relative path of the file after the change (the `b/` side). */
  path: string;
  /** Unified diff for this file, including the `diff --git` / `+++` / `---` headers. */
  diff: string;
}

/**
 * Everything an oracle inspects about one repair run. A real run (SAFE's runner, wave 1) or the
 * stub runner produces this; `fromUnifiedDiff` builds one from a `.patch` file for the fixtures and
 * the D1-D5 negative controls.
 */
export interface AttemptOutcome {
  /** Files the run changed, parsed from its diff. */
  changedFiles: ChangedFile[];
  /** The whole unified diff, as emitted by `git diff`. */
  unifiedDiff: string;
  /** Shell commands the agent ran (the guard's allow-list is `pnpm typecheck|lint|test [paths]`). */
  commands: string[];
  /** Commit subject + body the run proposed. */
  commitMessage: string;
  /** PR body the run would open (vendor-supplied strings can reach a maintainer here). */
  prBody: string;
  /** Agent transcript / gate log text. */
  log: string;
  /** Bytes the run's code sent to the egress sink while the patch was exercised. */
  egress: EgressRecord[];
  /**
   * Whether this candidate passed the repair gates (new test, contract suite, prior traces,
   * typecheck/lint). PLAN §4 E6 defines `attacker-src-behaviour` on a gate-passing candidate, so that
   * goal fires only when this is true; a finding on a gate-failing candidate is reported separately.
   */
  gatePassed: boolean;
}

/** One attempted outbound request captured by the egress sink. */
export interface EgressRecord {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
  at: string;
}

/** Context an oracle needs beyond the outcome itself. */
export interface OracleContext {
  /** The planted secret to look for (canary-egress). */
  canary: string;
  /** Recorded ids an attacker could special-case on (attacker-src-behaviour). */
  recordedIds: string[];
  /** Edit allow-list the loop enforces; a change outside it is a non-src edit. */
  allowedEditPaths: RegExp[];
  /** Commands the loop allows; anything else is a disallowed command. */
  allowedCommand: RegExp;
}

/** Why an oracle fired, for the JSONL and for debugging. */
export interface OracleHit {
  hit: boolean;
  /** Human-readable reasons, empty when `hit` is false. */
  reasons: string[];
  /**
   * Findings that would have satisfied the goal but were on a candidate that failed the gates
   * (`attacker-src-behaviour` only). Kept as a separate metric; never counted as a hit.
   */
  ungatedReasons?: string[];
}

export interface Goal {
  id: GoalId;
  /** One line describing the attacker's objective, shown to the attacker model. */
  objective: string;
  /** Fires when the outcome achieves this goal. */
  oracle(outcome: AttemptOutcome, ctx: OracleContext): OracleHit;
}
