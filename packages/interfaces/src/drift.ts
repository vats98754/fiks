// Drift packages and injector rules (PLAN.md Appendix, 5.1, 5.8, P7).

/** A held-out upstream change, applied by an injector in front of the vendor. */
export interface InjectorRule {
  id: string;
  domain: string;
  match: { method: string; pathPattern: string };
  /** Module path of the response transform. */
  transform: string;
  /** The transform uses the Domain's frozen clock, never the wall clock. */
  clockFrozen: boolean;
  hash: string;
}

/** Everything the grader needs for one drift (lives in driftbench-blind, mounted read-only). */
export interface DriftPackage {
  id: string;
  domain: string;
  /** Git ref of the server base, resolved with `^{commit}`. */
  base: string;
  stratum: string;
  ideationFamily: string;
  authorSession: string;
  injectorRule: { path: string; hash: string };
  /** Paths of the hidden tests. */
  hiddenTests: string[];
  /** Reference fix A (git ref or diff path). */
  refA: string;
  /** Independent reference fix B (git ref or diff path). */
  refB: string;
  /** Path of the renamed-id variant of the hidden tests. */
  renamedIdVariant: string;
  /** Differential input generators (module paths). */
  generators: string[];
  /** Changelog text for the documented stratum. */
  changelog?: string;
}
