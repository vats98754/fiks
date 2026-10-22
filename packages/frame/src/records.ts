// The records the detection pipeline writes (PLAN Appendix `CallRecord`, 3.0, 3.1, 5.7). A
// `DetCallRecord` is a CallRecord plus the input id, the enumeration position and the truth()
// comparison; the files of one `record` run sit in one directory:
//
//   calls.jsonl            the run's CallRecords (frame, drift, benign or mutant traffic)
//   controls.jsonl         the v1 controls (drift/benign: same rows, fresh v1 vendor, no rule;
//                          mutant: the unmutated replay); absent for --frame
//   nonattributable.jsonl  violations on calls.jsonl whose property does not verify on the control
//   detection.json         drift-attributable summary (drift, benign, mutant)
//   manifest.json          what was run (domain, refs, clock, hashes)
import type { CallRecord, Catalog } from '@fiks/interfaces';

export const CALLS_FILE = 'calls.jsonl';
export const CONTROLS_FILE = 'controls.jsonl';
export const NONATTRIBUTABLE_FILE = 'nonattributable.jsonl';
export const DETECTION_FILE = 'detection.json';
export const MANIFEST_FILE = 'manifest.json';

/** `Domain.truth()` against the vendor state right after the call. */
export interface TruthComparison {
  inputValid: boolean;
  /** Tool output equals truth() under PLAN 3.0 semantic equality (no mismatching path). */
  agrees: boolean;
  /** Paths where the output differs (`''` = the whole output). */
  mismatches: string[];
}

export interface DetCallRecord extends CallRecord {
  /** The EnumRow dedupe key this call came from (the frame input id). */
  inputId: string;
  /** Position in the enumeration (0-based). */
  seq: number;
  truth: TruthComparison;
  /** --mutant only: what the operator changed, per upstream exchange. */
  mutation?: MutationNote[];
}

export interface MutationNote {
  exchange: number;
  applicable: boolean;
  site: string | null;
  note: string;
}

export type RunKind = 'frame' | 'drift' | 'benign' | 'mutant';

export interface ExtendedEntity {
  id: string;
  authorBatch: string;
}

export interface RecordManifest {
  kind: RunKind;
  domain: string;
  catalog: Catalog;
  /** `contracts` | `none` | a module id. */
  monitor: string;
  contracts: { path: string; sha256: string } | null;
  server: { ref: string | null; dir: string; commit: string | null };
  frozenClock: string;
  enumeration: { path: string; sha256: string; rows: number } | null;
  /** The drift or benign package; for --mutant, the operator. */
  drift: { id: string; package: string; ruleId: string; ruleHash: string; base: string } | null;
  mutant: { op: string; input: string } | null;
  /** The extended catalog the vendor served (frame-k reads entities and authorBatch from it). */
  extended: { path: string; sha256: string; entities: ExtendedEntity[] } | null;
  files: Record<string, string>;
  counts: Record<string, number>;
}

/** The proxy event of a record (`events[]` entry with type `call`). */
export function callEvent(rec: Pick<CallRecord, 'events'>): Record<string, unknown> | undefined {
  return rec.events.find((e) => e.type === 'call');
}
