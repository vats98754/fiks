// Repair arms (PLAN.md Appendix, 6.2, P11). Dispatched by subprocess: `pnpm fiks repair --arm fiks`
// (ORCH) or `pnpm fiks arm --name <ARM>` (ARMS).
import type { RunKey, TraceFormat } from './run.ts';

export type ArmName =
  | 'FIKS'
  | 'L1'
  | 'COMP'
  | 'L1-noIV'
  | 'COMP-norep'
  | 'COMP-plain'
  | 'L1p'
  | 'REPRO-AGENT'
  | 'FIKS+CU'
  | 'ISSUE-TEXT';

/** Checks an arm runs before `would_open_pr`. */
export type PreGate = 'F' | 'P' | 'suite' | 'traces' | 'typecheck' | 'lint' | 'iv' | 'local-ci';

export interface ArmContext {
  runKey: RunKey;
  domain: string;
  /** The attempt's worktree of the target repo. */
  worktree: string;
  /** Frozen trace path (absent for L1p and ISSUE-TEXT). */
  frozenTracePath?: string;
  /** Rendered alert path (`.alerts/<id>.json`). */
  alertPath?: string;
  /** Upstream issue text (ISSUE-TEXT, real bugs). */
  issuePath?: string;
  traceFormat: TraceFormat;
  /** 1-based session or revision number. */
  session: number;
  /** Failure output fed back from the previous session or CI run. */
  previousFailure?: string;
}

export interface CiPolicy {
  /** `pre-pr`: CI gates `would_open_pr`; `post-pr`: CI runs after it (COMP); `none`. */
  when: 'pre-pr' | 'post-pr' | 'none';
  /** Issue validation (IV properties) is part of CI. */
  iv: boolean;
  /** `repo`: repo CI incl. contract suite and stored traces; `server-tests`: the server's own tests. */
  scope: 'repo' | 'server-tests';
  /** Red-CI revisions fed back after `would_open_pr`. */
  maxRevisions: number;
}

export type PrPolicy = 'all-gates-green' | 'first-nonempty-diff' | 'never';

export interface Arm {
  name: ArmName | (string & {});
  prepare(ctx: ArmContext): Promise<void> | void;
  prompt(ctx: ArmContext): string;
  preGates: readonly PreGate[];
  ciPolicy: CiPolicy;
  prPolicy: PrPolicy;
}
