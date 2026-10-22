// Per-property verdicts of one evaluated call: DET's compare rule (PLAN 3.0 drift attribution,
// 3.1 "Exception (round 5)"). It reads a receipt (or a replayed evaluation); it never evaluates.
//   violated      the property has >= 1 violation;
//   verified      it was checked and has none;
//   unverifiable  it was not checked (skipped, disabled, error result, no contract), or it is a
//                 postcondition and the record holds no read-back probe (no evidence either way:
//                 the evaluator reports "no probe ran", which offline means "not recorded").
import type { ToolContract, Verdict } from '@fiks/contracts';

export interface EvaluationLike {
  checked: readonly string[];
  violations: readonly { propertyId: string }[];
}

/** Full property ids of a contract: invariants, then postconditions. */
export function contractPropertyIds(contract: ToolContract | null | undefined): {
  invariants: string[];
  postconditions: string[];
} {
  if (!contract) return { invariants: [], postconditions: [] };
  return {
    invariants: contract.invariants.map((i) => `${contract.id}/${i.id}`),
    postconditions: (contract.postconditions ?? []).map((p) => `${contract.id}/${p.id}`),
  };
}

export interface VerdictOptions {
  /** False when the record holds no read-back probe (e.g. `--monitor none` records). */
  probeRecorded: boolean;
}

/**
 * Verdict per property id over the contract's properties plus anything the evaluation checked
 * (e.g. `<contract>/outputSchema`), in that order.
 */
export function perPropertyVerdicts(
  evaluation: EvaluationLike | null | undefined,
  contract: ToolContract | null | undefined,
  opts: VerdictOptions,
): Record<string, Verdict> {
  const { invariants, postconditions } = contractPropertyIds(contract);
  const post = new Set(postconditions);
  const ids = [
    ...new Set([
      ...invariants,
      ...postconditions,
      ...(evaluation?.checked ?? []),
      ...(evaluation?.violations.map((v) => v.propertyId) ?? []),
    ]),
  ];
  const violated = new Set(evaluation?.violations.map((v) => v.propertyId) ?? []);
  const checked = new Set(evaluation?.checked ?? []);
  const out: Record<string, Verdict> = {};
  for (const id of ids) {
    if (post.has(id) && !opts.probeRecorded) out[id] = 'unverifiable';
    else if (violated.has(id)) out[id] = 'violated';
    else if (checked.has(id)) out[id] = 'verified';
    else out[id] = 'unverifiable';
  }
  return out;
}

/** Ids of the postconditions of a contract (truth-entailed; never FP-capable). */
export const isPostcondition = (contract: ToolContract | null | undefined, id: string): boolean =>
  contractPropertyIds(contract).postconditions.includes(id);
