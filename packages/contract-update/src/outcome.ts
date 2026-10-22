// The `{outcome: 'contract_update', delta}` outcome a FIKS+CU repair agent may end with (PLAN P12,
// 6.2 FIKS+CU). A delta changes the outcome contract, never code. It is plain data: this module
// declares its shape, a JSON Schema for the agent prompt, and a strict parser.
import type { Invariant, JsonSchema, ReadAfterWrite } from '@fiks/contracts';

/**
 * One edit to a contract file. Properties are named `${contractId}/${id}` as in receipts.
 * There is deliberately no remove op: a contract update amends a property, it never deletes one.
 */
export type DeltaOp =
  /** Replace the invariant with the same `id` (amends `${contractId}/${invariant.id}`). */
  | { op: 'replaceInvariant'; contractId: string; invariant: Invariant }
  /** Add a new invariant; its id must not exist yet (adds a property, amends none). */
  | { op: 'addInvariant'; contractId: string; invariant: Invariant }
  /** Replace the postcondition with the same `id` (amends `${contractId}/${postcondition.id}`). */
  | { op: 'replacePostcondition'; contractId: string; postcondition: ReadAfterWrite }
  /** Set the contract's outputSchema override (amends `${contractId}/outputSchema`). */
  | { op: 'setOutputSchema'; contractId: string; outputSchema: JsonSchema }
  /** Contract-level: add a known-good input (affects every `onlyKnownGood` property). */
  | { op: 'addKnownGoodInput'; contractId: string; input: Record<string, unknown> }
  /** Contract-level: remove a known-good input (affects every `onlyKnownGood` property). */
  | { op: 'removeKnownGoodInput'; contractId: string; input: Record<string, unknown> };

export interface ContractDelta {
  ops: DeltaOp[];
  /** Why the observed behaviour is legitimate (e.g. the vendor changelog entry). */
  rationale: string;
}

export interface ContractUpdateOutcome {
  outcome: 'contract_update';
  delta: ContractDelta;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const INVARIANT_KINDS = [
  'range',
  'notNull',
  'nonEmpty',
  'countMatchesTotal',
  'freshness',
  'equalsUpstream',
  'unique',
] as const;

const OP_NAMES = [
  'replaceInvariant',
  'addInvariant',
  'replacePostcondition',
  'setOutputSchema',
  'addKnownGoodInput',
  'removeKnownGoodInput',
] as const;

const invariantSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'kind'],
  properties: {
    id: { type: 'string' },
    kind: { type: 'string', enum: [...INVARIANT_KINDS] },
    path: { type: 'string' },
    min: { type: 'number' },
    max: { type: 'number' },
    unit: { type: 'string' },
    onlyKnownGood: { type: 'boolean' },
    itemsPath: { type: 'string' },
    totalPath: { type: 'string' },
    maxAgeDays: { type: 'number' },
    maxFutureDays: { type: 'number' },
    upstreamPath: { type: 'string' },
    compare: { type: 'string', enum: ['json', 'instant'] },
  },
  additionalProperties: false,
};

/** JSON Schema of the outcome, for the agent prompt. The parser below is the authority. */
export const CONTRACT_UPDATE_OUTCOME_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['outcome', 'delta'],
  additionalProperties: false,
  properties: {
    outcome: { type: 'string', enum: ['contract_update'] },
    delta: {
      type: 'object',
      required: ['ops', 'rationale'],
      additionalProperties: false,
      properties: {
        rationale: { type: 'string' },
        ops: {
          type: 'array',
          items: {
            type: 'object',
            required: ['op', 'contractId'],
            properties: {
              op: { type: 'string', enum: [...OP_NAMES] },
              contractId: { type: 'string' },
              invariant: invariantSchema,
              postcondition: { type: 'object' },
              outputSchema: { type: 'object' },
              input: { type: 'object' },
            },
          },
        },
      },
    },
  },
};

const isObj = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function checkKeys(o: Record<string, unknown>, allowed: string[], at: string, errors: string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) errors.push(`${at}: unknown field "${k}"`);
}

function validateInvariant(x: unknown, at: string, errors: string[]): void {
  if (!isObj(x)) {
    errors.push(`${at}: must be an object`);
    return;
  }
  if (!isStr(x.id)) errors.push(`${at}.id: must be a non-empty string`);
  else if (x.id.includes('/')) errors.push(`${at}.id: must not contain "/"`);
  const need = (k: string, pred: (v: unknown) => boolean, what: string) => {
    if (!pred(x[k])) errors.push(`${at}.${k}: must be ${what}`);
  };
  const opt = (k: string, pred: (v: unknown) => boolean, what: string) => {
    if (x[k] !== undefined && !pred(x[k])) errors.push(`${at}.${k}: must be ${what}`);
  };
  const bool = (v: unknown) => typeof v === 'boolean';
  switch (x.kind) {
    case 'range':
      checkKeys(x, ['id', 'kind', 'path', 'min', 'max', 'unit'], at, errors);
      need('path', isStr, 'a path');
      opt('min', isNum, 'a finite number');
      opt('max', isNum, 'a finite number');
      opt('unit', isStr, 'a string');
      if (x.min === undefined && x.max === undefined) errors.push(`${at}: a range needs min or max`);
      if (isNum(x.min) && isNum(x.max) && x.min > x.max) errors.push(`${at}: min > max`);
      return;
    case 'notNull':
    case 'nonEmpty':
      checkKeys(x, ['id', 'kind', 'path', 'onlyKnownGood'], at, errors);
      need('path', isStr, 'a path');
      opt('onlyKnownGood', bool, 'a boolean');
      return;
    case 'countMatchesTotal':
      checkKeys(x, ['id', 'kind', 'itemsPath', 'totalPath'], at, errors);
      need('itemsPath', isStr, 'a path');
      need('totalPath', isStr, 'a path');
      return;
    case 'freshness':
      checkKeys(x, ['id', 'kind', 'path', 'maxAgeDays', 'maxFutureDays'], at, errors);
      need('path', isStr, 'a path');
      need('maxAgeDays', (v) => isNum(v) && v >= 0, 'a number >= 0');
      opt('maxFutureDays', (v) => isNum(v) && v >= 0, 'a number >= 0');
      return;
    case 'equalsUpstream':
      checkKeys(x, ['id', 'kind', 'path', 'upstreamPath', 'compare'], at, errors);
      need('path', isStr, 'a path');
      need('upstreamPath', isStr, 'a path');
      opt('compare', (v) => v === 'json' || v === 'instant', '"json" or "instant"');
      return;
    case 'unique':
      checkKeys(x, ['id', 'kind', 'path'], at, errors);
      need('path', isStr, 'a path');
      return;
    default:
      errors.push(`${at}.kind: must be one of ${INVARIANT_KINDS.join(', ')}`);
  }
}

function validatePostcondition(x: unknown, at: string, errors: string[]): void {
  if (!isObj(x)) {
    errors.push(`${at}: must be an object`);
    return;
  }
  checkKeys(x, ['id', 'probeTool', 'probeArgs', 'expect', 'upstream'], at, errors);
  if (x.id !== 'readAfterWrite') errors.push(`${at}.id: must be "readAfterWrite"`);
  if (!isStr(x.probeTool)) errors.push(`${at}.probeTool: must be a non-empty string`);
  if (!isObj(x.probeArgs) || !Object.values(x.probeArgs).every(isStr))
    errors.push(`${at}.probeArgs: must map argument names to paths`);
  if (
    !Array.isArray(x.expect) ||
    !x.expect.every((e) => isObj(e) && isStr(e.probePath) && isStr(e.equalsResultPath))
  )
    errors.push(`${at}.expect: must be [{probePath, equalsResultPath}]`);
  if (
    x.upstream !== undefined &&
    !(isObj(x.upstream) && isStr(x.upstream.idPath) && isStr(x.upstream.equalsResultPath))
  )
    errors.push(`${at}.upstream: must be {idPath, equalsResultPath}`);
}

function validateOp(x: unknown, at: string, errors: string[]): void {
  if (!isObj(x)) {
    errors.push(`${at}: must be an object`);
    return;
  }
  if (!isStr(x.contractId)) errors.push(`${at}.contractId: must be a non-empty string`);
  switch (x.op) {
    case 'replaceInvariant':
    case 'addInvariant':
      checkKeys(x, ['op', 'contractId', 'invariant'], at, errors);
      validateInvariant(x.invariant, `${at}.invariant`, errors);
      return;
    case 'replacePostcondition':
      checkKeys(x, ['op', 'contractId', 'postcondition'], at, errors);
      validatePostcondition(x.postcondition, `${at}.postcondition`, errors);
      return;
    case 'setOutputSchema':
      checkKeys(x, ['op', 'contractId', 'outputSchema'], at, errors);
      if (!isObj(x.outputSchema)) errors.push(`${at}.outputSchema: must be an object`);
      return;
    case 'addKnownGoodInput':
    case 'removeKnownGoodInput':
      checkKeys(x, ['op', 'contractId', 'input'], at, errors);
      if (!isObj(x.input)) errors.push(`${at}.input: must be an object`);
      return;
    default:
      errors.push(`${at}.op: must be one of ${OP_NAMES.join(', ')}`);
  }
}

/** Validates a delta's shape (not its effect: that is `acceptDelta`'s job). */
export function parseDelta(x: unknown): ParseResult<ContractDelta> {
  const errors: string[] = [];
  if (!isObj(x)) return { ok: false, errors: ['delta: must be an object'] };
  checkKeys(x, ['ops', 'rationale'], 'delta', errors);
  if (!isStr(x.rationale)) errors.push('delta.rationale: must be a non-empty string');
  if (!Array.isArray(x.ops) || x.ops.length === 0) errors.push('delta.ops: must be a non-empty array');
  else for (const [i, op] of x.ops.entries()) validateOp(op, `delta.ops[${i}]`, errors);
  if (errors.length) return { ok: false, errors };
  // Validated above; a structured clone keeps the caller's object out of later mutation.
  return { ok: true, value: structuredClone(x) as unknown as ContractDelta };
}

/** Parses the agent's final outcome, given as an object or as JSON text. */
export function parseOutcome(input: unknown): ParseResult<ContractUpdateOutcome> {
  let x = input;
  if (typeof input === 'string') {
    try {
      x = JSON.parse(input);
    } catch (e) {
      return { ok: false, errors: [`outcome: not JSON (${(e as Error).message})`] };
    }
  }
  if (!isObj(x)) return { ok: false, errors: ['outcome: must be an object'] };
  const errors: string[] = [];
  checkKeys(x, ['outcome', 'delta'], 'outcome', errors);
  if (x.outcome !== 'contract_update') errors.push('outcome.outcome: must be "contract_update"');
  const d = parseDelta(x.delta);
  if (!d.ok) errors.push(...d.errors);
  if (errors.length || !d.ok) return { ok: false, errors };
  return { ok: true, value: { outcome: 'contract_update', delta: d.value } };
}
