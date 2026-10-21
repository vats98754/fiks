// Re-record service log (PLAN.md Appendix, P23): one JSONL line per `rerecord-head` call.

/** Injector-aware profile (P7): (domain, base version, injector rule id, rule hash). */
export interface RerecordProfile {
  domain: string;
  base: string;
  ruleId: string | null;
  ruleHash: string | null;
}

export type RerecordCheck = 'P' | 'IV' | 'suite' | 'traces' | 'ci' | 'accept';

export interface RerecordFile {
  path: string;
  /** `stale`: suite-detected stale recording; `overlay`: per-check overlay at the original path. */
  mode: 'stale' | 'overlay';
  requestKeysBefore: string[];
  requestKeysAfter: string[];
  outcome: 'rerecorded' | 'unchanged' | 'failed';
}

export interface RerecordLog {
  profile: RerecordProfile;
  /** Candidate head commit. */
  head: string;
  fromCommit: string;
  check: RerecordCheck;
  files: RerecordFile[];
}
