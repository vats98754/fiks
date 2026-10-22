// truth() labels for detector rows (E3, PLAN 6.1 "labels from truth()"). Pure functions of the
// record's truth() comparison: they never read a contract, a monitor or a verdict.
import type { TruthComparison } from './records.ts';

/**
 * `correct`: the tool output equals truth(); `wrong`: it differs (a true positive is possible);
 * `invalid-input`: truth() marks the input invalid and the tool returned an error or nothing.
 */
export type TruthLabel = 'correct' | 'wrong' | 'invalid-input';

export function truthLabel(t: TruthComparison): TruthLabel {
  if (!t.agrees) return 'wrong';
  return t.inputValid ? 'correct' : 'invalid-input';
}

/**
 * Clean (PLAN 3.1): the tool output equals truth() on v1 (for an invalid input, an error or an
 * empty result counts as equal). An input where the base tool disagrees is excluded from F.
 */
export const isClean = (t: TruthComparison): boolean => t.agrees;
