// Applies a ContractDelta to a ContractFile. Pure: the input file is never mutated.
import type { ContractFile, Invariant, ReadAfterWrite, ToolContract } from '@fiks/contracts';
import type { ContractDelta } from './outcome.ts';

/**
 * The fields that say what an invariant checks and where: its `kind` and every path it reads.
 * A replace keeps them; only parameters (bounds, unit, ages, compare mode, onlyKnownGood) change.
 * Otherwise a replace could swap e.g. a `range` on `price` for a `notNull` under the same id and
 * delete the range check while the property id lives on.
 */
const IDENTITY = ['kind', 'path', 'itemsPath', 'totalPath', 'upstreamPath'] as const;

function identityChanges(cur: Invariant, next: Invariant): string[] {
  const a = cur as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  return IDENTITY.filter((k) => !same(a[k], b[k])).map(
    (k) => `${k} (${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])})`,
  );
}

export interface AppliedDelta {
  contracts: ContractFile;
  /** Existing properties the delta changes (`${contractId}/${id}`), in first-touch order. */
  amended: string[];
  /** New properties the delta adds. */
  added: string[];
  /** Contracts whose contract-level fields (knownGoodInputs) the delta changes. */
  contractLevel: string[];
  /** Ids of every contract the delta touches. */
  touchedContracts: string[];
  /** Every known-good input the delta adds or removes, in op order. */
  knownGoodEdits: KnownGoodEdit[];
}

/** A contract-level edit: it switches every `onlyKnownGood` property on or off for `input`. */
export interface KnownGoodEdit {
  contractId: string;
  op: 'add' | 'remove';
  input: Record<string, unknown>;
}

export type ApplyResult = { ok: true; value: AppliedDelta } | { ok: false; errors: string[] };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function pushOnce(list: string[], x: string): void {
  if (!list.includes(x)) list.push(x);
}

export function applyDelta(file: ContractFile, delta: ContractDelta): ApplyResult {
  const contracts = structuredClone(file);
  const errors: string[] = [];
  const amended: string[] = [];
  const added: string[] = [];
  const contractLevel: string[] = [];
  const touched: string[] = [];
  const knownGoodEdits: KnownGoodEdit[] = [];

  delta.ops.forEach((op, i) => {
    const at = `delta.ops[${i}] (${op.op})`;
    const c: ToolContract | undefined = contracts.contracts.find((x) => x.id === op.contractId);
    if (!c) {
      errors.push(`${at}: no contract "${op.contractId}"`);
      return;
    }
    pushOnce(touched, c.id);
    switch (op.op) {
      case 'replaceInvariant': {
        const j = c.invariants.findIndex((inv) => inv.id === op.invariant.id);
        if (j < 0) {
          errors.push(
            `${at}: ${c.id} has no invariant "${op.invariant.id}" (use addInvariant for a new one)`,
          );
          return;
        }
        const cur = c.invariants[j] as Invariant;
        if (same(cur, op.invariant)) {
          errors.push(`${at}: ${c.id}/${op.invariant.id} is unchanged`);
          return;
        }
        const moved = identityChanges(cur, op.invariant);
        if (moved.length) {
          errors.push(
            `${at}: ${c.id}/${op.invariant.id} changes ${moved.join(', ')}; a replace may change only the property's parameters (it amends the check, it never swaps it for another)`,
          );
          return;
        }
        c.invariants[j] = structuredClone(op.invariant);
        pushOnce(amended, `${c.id}/${op.invariant.id}`);
        return;
      }
      case 'addInvariant': {
        const id = op.invariant.id;
        const taken =
          c.invariants.some((inv) => inv.id === id) ||
          (c.postconditions ?? []).some((p) => p.id === id) ||
          id === 'outputSchema';
        if (taken) {
          errors.push(`${at}: ${c.id}/${id} already exists (use replaceInvariant)`);
          return;
        }
        c.invariants.push(structuredClone(op.invariant));
        added.push(`${c.id}/${id}`);
        return;
      }
      case 'replacePostcondition': {
        const posts = c.postconditions ?? [];
        const j = posts.findIndex((p) => p.id === op.postcondition.id);
        if (j < 0) {
          errors.push(`${at}: ${c.id} has no postcondition "${op.postcondition.id}"`);
          return;
        }
        const cur = posts[j] as ReadAfterWrite;
        if (same(cur, op.postcondition)) {
          errors.push(`${at}: ${c.id}/${op.postcondition.id} is unchanged`);
          return;
        }
        if (cur.probeTool !== op.postcondition.probeTool) {
          errors.push(
            `${at}: ${c.id}/${op.postcondition.id} changes probeTool (${JSON.stringify(cur.probeTool)} -> ${JSON.stringify(op.postcondition.probeTool)}); a replace may change only the property's parameters`,
          );
          return;
        }
        posts[j] = structuredClone(op.postcondition);
        pushOnce(amended, `${c.id}/${op.postcondition.id}`);
        return;
      }
      case 'setOutputSchema': {
        if (same(c.outputSchema, op.outputSchema)) {
          errors.push(`${at}: ${c.id}/outputSchema is unchanged`);
          return;
        }
        c.outputSchema = structuredClone(op.outputSchema);
        pushOnce(amended, `${c.id}/outputSchema`);
        return;
      }
      case 'addKnownGoodInput': {
        const list = c.knownGoodInputs ?? [];
        if (list.some((x) => same(x, op.input))) {
          errors.push(`${at}: ${c.id} already lists ${JSON.stringify(op.input)} as known-good`);
          return;
        }
        c.knownGoodInputs = [...list, structuredClone(op.input)];
        pushOnce(contractLevel, c.id);
        knownGoodEdits.push({ contractId: c.id, op: 'add', input: structuredClone(op.input) });
        return;
      }
      case 'removeKnownGoodInput': {
        const list = c.knownGoodInputs ?? [];
        const rest = list.filter((x) => !same(x, op.input));
        if (rest.length === list.length) {
          errors.push(`${at}: ${c.id} does not list ${JSON.stringify(op.input)} as known-good`);
          return;
        }
        c.knownGoodInputs = rest;
        pushOnce(contractLevel, c.id);
        knownGoodEdits.push({ contractId: c.id, op: 'remove', input: structuredClone(op.input) });
        return;
      }
    }
  });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { contracts, amended, added, contractLevel, touchedContracts: touched, knownGoodEdits },
  };
}
