// The contract-update outcome gate (PLAN P12). Deterministic: no clock, no network, no LLM; the
// same inputs always give the same result, in input order.
//
// A delta is accepted only if all of these hold:
//   scope    - the delta edits only the trigger's contract, amends only properties the trigger
//              violates under the current contract, and adds or removes no known-good input other
//              than the trigger's own (a known-good edit switches every onlyKnownGood property on
//              or off for the inputs it matches);
//   trigger  - the trigger verifies under the amended contract (verdict `verified`, every amended
//              property still checked);
//   stored   - every stored true-violation trace still violates each target property it violates
//              under the current contract;
//   corpus   - no clean v1 case violates a property it did not already violate;
//   mutation - every mutation variant of the trigger is still rejected on every property that
//              rejected it before, except on the amended properties (P12 as written; BA6). An
//              amended property that rejected at least one variant before must still reject at
//              least one after, so "amend" cannot mean "disable". Every variant must be a call of
//              the trigger's tool with the trigger's arguments.
// Every case is checked against the server's declared outputSchema (`declaredOutputSchemas`, from
// tools/list), as the live proxy does, so `<contract>/outputSchema` verdicts match production.
// Missing or unevaluable inputs fail closed (a case without a tool result, or a case of a contract
// with read-after-write postconditions that carries no probe), and so does a check that would pass
// vacuously: no stored trace that violates its target, no corpus case that verifies, no variant
// rejected before, a "variant" that is not a variant of the trigger.
import { type ContractFile, type EvalResult, evaluate, findContract, type Verdict } from '@fiks/contracts';
import { applyDelta } from './apply.ts';
import { type DeclaredOutputSchemas, evalInput, type GateCase, type GateInput, toGateCase } from './cases.ts';
import { type ContractDelta, parseDelta } from './outcome.ts';

export type GateCheck = 'delta' | 'input' | 'scope' | 'trigger' | 'stored' | 'corpus' | 'mutation';

export interface GateFinding {
  check: GateCheck;
  message: string;
  caseId?: string;
  property?: string;
}

export interface GateContext {
  /** The contract file in force (the base the delta applies to). */
  contracts: ContractFile;
  /** The call whose violation the agent says is legitimate (the frozen trace). */
  trigger: GateInput;
  /** Every stored true-violation trace. */
  storedViolations: GateInput[];
  /** The clean v1 corpus. */
  cleanCorpus: GateInput[];
  /** MUT variants (M1-M14) of the trigger. */
  mutationVariants: GateInput[];
  /**
   * The server's declared outputSchemas from tools/list, by tool name (`null` = declares none);
   * see `declaredOutputSchemas()`. Applied to every case. Missing, or missing a case's tool, fails
   * closed: without it the gate cannot see `<contract>/outputSchema` the way the proxy does.
   */
  declaredOutputSchemas: DeclaredOutputSchemas;
}

export interface GateSummary {
  trigger: { before: Verdict | null; after: Verdict | null };
  stored: { total: number; used: number; stillViolate: number };
  /** `verified`: cases that verify under the current contract. */
  corpus: { total: number; verified: number; regressions: number };
  mutation: { total: number; rejectedBefore: number; rejectedAfter: number };
}

export interface GateResult {
  accepted: boolean;
  /** One line per blocking finding; fed back to the agent on rejection. */
  reasons: string[];
  findings: GateFinding[];
  /** Non-blocking observations (stale stored traces, a corpus case that was never clean). */
  notes: string[];
  amended: string[];
  added: string[];
  contractLevel: string[];
  /** The contract file after the delta, when the delta applies. */
  proposed?: ContractFile;
  /** The parsed delta, when it parses. */
  delta?: ContractDelta;
  summary: GateSummary;
}

type Evaluated = { res: EvalResult; violated: Set<string> };

/** The read-after-write postconditions `file` declares for the case's tool, as property ids. */
function postconditionIds(file: ContractFile, tool: string): string[] {
  const c = findContract(file, tool);
  return (c?.postconditions ?? []).map((p) => `${c?.id}/${p.id}`);
}

/**
 * Why the case cannot be evaluated under `file`, or null. A case of a contract with postconditions
 * needs its read-after-write probe: without one, `evaluate` reports `readAfterWrite` violated ("no
 * probe ran"), which the gate would misread as a pre-existing violation (a corpus case dropped, a
 * variant "rejected"), so such a case fails closed instead.
 */
function unevaluableReason(file: ContractFile, c: GateCase): string | null {
  if (!c.result) return 'has no tool result';
  const post = postconditionIds(file, c.tool);
  if (post.length && !c.probe)
    return `has no read-after-write probe (neither \`probe\` nor a \`type: 'call'\` event in events[] carries one), but ${post.join(', ')} needs it`;
  return null;
}

function evalCase(
  file: ContractFile,
  c: GateCase,
  schemas: DeclaredOutputSchemas | undefined,
): Evaluated | null {
  if (!c.result || unevaluableReason(file, c)) return null;
  const declared = schemas && Object.hasOwn(schemas, c.tool) ? (schemas[c.tool] ?? undefined) : undefined;
  const res = evaluate(findContract(file, c.tool), evalInput({ ...c, result: c.result }, declared));
  return { res, violated: new Set(res.violations.map((v) => v.propertyId)) };
}

/**
 * Whether known-good pattern `pattern` covers exactly the trigger's input: it is non-empty and
 * every field equals the trigger's argument (the proxy's `isKnownGood` subset match). An empty
 * pattern matches every input, so it is never the trigger's own.
 */
function matchesInput(pattern: Record<string, unknown>, args: unknown): boolean {
  if (args === null || typeof args !== 'object') return false;
  const keys = Object.keys(pattern);
  return (
    keys.length > 0 &&
    keys.every((k) => JSON.stringify((args as Record<string, unknown>)[k]) === JSON.stringify(pattern[k]))
  );
}

/** The `onlyKnownGood` properties of a contract, as `${contractId}/${id}`. */
function onlyKnownGoodProps(file: ContractFile, contractId: string): string[] {
  const c = file.contracts.find((x) => x.id === contractId);
  return (c?.invariants ?? [])
    .filter((inv) => 'onlyKnownGood' in inv && inv.onlyKnownGood)
    .map((inv) => `${contractId}/${inv.id}`);
}

/** JSON with object keys sorted, so equal arguments compare equal whatever their key order. */
function canonical(x: unknown): string {
  return JSON.stringify(x, (_k, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  );
}

function describe(c: GateCase): string {
  const m = c.mutant ? ` [${c.mutant}]` : '';
  return `${c.id}${m} (${c.tool} ${JSON.stringify(c.args)})`;
}

function messageFor(e: Evaluated, property: string): string {
  return e.res.violations.find((v) => v.propertyId === property)?.message ?? '';
}

function emptySummary(ctx: Partial<GateContext>): GateSummary {
  return {
    trigger: { before: null, after: null },
    stored: { total: ctx.storedViolations?.length ?? 0, used: 0, stillViolate: 0 },
    corpus: { total: ctx.cleanCorpus?.length ?? 0, verified: 0, regressions: 0 },
    mutation: { total: ctx.mutationVariants?.length ?? 0, rejectedBefore: 0, rejectedAfter: 0 },
  };
}

export function acceptDelta(delta: unknown, ctx: GateContext): GateResult {
  const findings: GateFinding[] = [];
  const notes: string[] = [];
  const summary = emptySummary(ctx);
  const done = (extra: Partial<GateResult> = {}): GateResult => ({
    accepted: findings.length === 0,
    reasons: findings.map((f) => `[${f.check}] ${f.message}`),
    findings,
    notes,
    amended: [],
    added: [],
    contractLevel: [],
    summary,
    ...extra,
  });

  const parsed = parseDelta(delta);
  if (!parsed.ok) {
    for (const message of parsed.errors) findings.push({ check: 'delta', message });
    return done();
  }
  const applied = applyDelta(ctx.contracts, parsed.value);
  if (!applied.ok) {
    for (const message of applied.errors) findings.push({ check: 'delta', message });
    return done({ delta: parsed.value });
  }
  const { contracts: next, amended, added, contractLevel, touchedContracts, knownGoodEdits } = applied.value;
  const old = ctx.contracts;
  const amendedSet = new Set(amended);

  // Inputs: the gate never passes vacuously.
  const lists: [keyof GateContext, string][] = [
    ['storedViolations', 'stored true-violation traces'],
    ['cleanCorpus', 'clean v1 corpus'],
    ['mutationVariants', 'mutation variants of the trigger'],
  ];
  for (const [key, what] of lists) {
    const list = ctx[key];
    if (!Array.isArray(list) || list.length === 0)
      findings.push({ check: 'input', message: `no ${what} given; the gate fails closed` });
  }
  const unevaluable = (check: GateCheck, c: GateCase) =>
    findings.push({
      check: 'input',
      caseId: c.id,
      message: `${check} case ${describe(c)} ${unevaluableReason(old, c) ?? unevaluableReason(next, c)}, so it cannot be evaluated; the gate fails closed`,
    });

  // Declared outputSchemas: one finding if the map is missing, one per tool it does not cover.
  const schemas = ctx.declaredOutputSchemas;
  const haveSchemas = schemas !== null && typeof schemas === 'object' && !Array.isArray(schemas);
  if (!haveSchemas)
    findings.push({
      check: 'input',
      message:
        "no declared outputSchemas (the server's tools/list) given; the gate cannot check <contract>/outputSchema as the proxy does and fails closed",
    });
  const uncovered = new Set<string>();
  const evalBoth = (c: GateCase): [Evaluated | null, Evaluated | null] => {
    if (haveSchemas && !Object.hasOwn(schemas, c.tool) && !uncovered.has(c.tool)) {
      uncovered.add(c.tool);
      findings.push({
        check: 'input',
        message: `the declared outputSchemas have no entry for tool ${c.tool} (use null if it declares none); the gate fails closed`,
      });
    }
    const s = haveSchemas ? schemas : undefined;
    return [evalCase(old, c, s), evalCase(next, c, s)];
  };

  // Trigger and scope.
  const trigger = toGateCase(ctx.trigger);
  const [tBefore, tAfter] = evalBoth(trigger);
  if (!tBefore || !tAfter) unevaluable('trigger', trigger);
  else {
    summary.trigger = { before: tBefore.res.verdict, after: tAfter.res.verdict };
    const tContract = findContract(old, trigger.tool)?.id;
    for (const id of touchedContracts) {
      if (id !== tContract)
        findings.push({
          check: 'scope',
          message: `the delta edits ${id}, but the trigger is a ${tContract ?? trigger.tool} call; a contract update may change only the trigger's contract`,
        });
    }
    if (tBefore.res.verdict !== 'violated')
      findings.push({
        check: 'trigger',
        caseId: trigger.id,
        message: `the trigger ${describe(trigger)} does not violate the current contract (verdict ${tBefore.res.verdict}); there is nothing to update`,
      });
    for (const p of amended) {
      if (!tBefore.violated.has(p))
        findings.push({
          check: 'scope',
          property: p,
          message: `the delta amends ${p}, which the trigger does not violate (trigger violates: ${[...tBefore.violated].join(', ') || 'nothing'})`,
        });
    }
    // A known-good edit switches every onlyKnownGood property of the contract on or off for each
    // input it matches, so it may only edit the trigger's own input: the corpus and the trigger's
    // variants never cover other inputs, so nothing else would notice a check turned off (remove)
    // or a false positive turned on (add) for them.
    for (const e of knownGoodEdits) {
      if (e.contractId !== tContract) continue; // already a scope finding above
      if (matchesInput(e.input, trigger.args)) continue;
      const props = onlyKnownGoodProps(old, e.contractId);
      findings.push({
        check: 'scope',
        message: `the delta ${e.op === 'add' ? 'adds' : 'removes'} known-good input ${JSON.stringify(e.input)}, which ${Object.keys(e.input).length ? 'does not match' : 'matches every input, not just'} the trigger's arguments ${JSON.stringify(trigger.args)}; that switches ${props.join(', ') || 'its onlyKnownGood properties'} ${e.op === 'add' ? 'on' : 'off'} for inputs other than the trigger's. A contract update may edit only the trigger's own known-good input`,
      });
    }
    if (tAfter.res.verdict !== 'verified') {
      const left = tAfter.res.violations.map((v) => `${v.propertyId}: ${v.message}`).join('; ');
      findings.push({
        check: 'trigger',
        caseId: trigger.id,
        message:
          tAfter.res.verdict === 'violated'
            ? `the trigger still violates the amended contract: ${left}`
            : 'the trigger is unverifiable under the amended contract (no property checks it)',
      });
    }
    for (const p of amended) {
      if (!tAfter.res.checked.includes(p))
        findings.push({
          check: 'trigger',
          property: p,
          message: `the amended property ${p} is no longer checked on the trigger`,
        });
    }
  }

  // Stored true-violation traces still violate.
  for (const input of ctx.storedViolations ?? []) {
    const c = toGateCase(input);
    const [before, after] = evalBoth(c);
    if (!before || !after) {
      unevaluable('stored', c);
      continue;
    }
    const target = c.target?.length ? c.target : [...before.violated];
    const required = target.filter((p) => before.violated.has(p));
    for (const p of target) {
      if (!before.violated.has(p))
        notes.push(
          `stored trace ${describe(c)} does not violate ${p} under the current contract; not used for ${p}`,
        );
    }
    if (required.length === 0) continue;
    summary.stored.used++;
    const lost = required.filter((p) => !after.violated.has(p));
    if (lost.length === 0) summary.stored.stillViolate++;
    for (const p of lost)
      findings.push({
        check: 'stored',
        caseId: c.id,
        property: p,
        message: `stored true violation ${describe(c)} no longer violates ${p} (was: ${messageFor(before, p)})`,
      });
  }
  if (summary.stored.total > 0 && summary.stored.used === 0)
    findings.push({
      check: 'input',
      message: `none of the ${summary.stored.total} stored true-violation traces violates its target under the current contract, so the stored check would pass vacuously; the gate fails closed`,
    });

  // The clean v1 corpus verifies.
  for (const input of ctx.cleanCorpus ?? []) {
    const c = toGateCase(input);
    const [before, after] = evalBoth(c);
    if (!before || !after) {
      unevaluable('corpus', c);
      continue;
    }
    if (before.res.verdict === 'verified') summary.corpus.verified++;
    if (before.violated.size)
      notes.push(
        `corpus case ${describe(c)} already violates ${[...before.violated].join(', ')} under the current contract`,
      );
    const fresh = [...after.violated].filter((p) => !before.violated.has(p));
    if (fresh.length) summary.corpus.regressions++;
    for (const p of fresh)
      findings.push({
        check: 'corpus',
        caseId: c.id,
        property: p,
        message: `clean v1 case ${describe(c)} now violates ${p}: ${messageFor(after, p)}`,
      });
  }
  if (summary.corpus.total > 0 && summary.corpus.verified === 0)
    findings.push({
      check: 'input',
      message: `none of the ${summary.corpus.total} clean v1 corpus cases verifies under the current contract, so the corpus check would pass vacuously; the gate fails closed`,
    });

  // Mutation variants are still rejected, except on the amended properties (P12; BA6). An
  // amended property must still reject at least one of the variants it rejected before, so it is
  // amended, not disabled. Each variant must be a variant of the trigger (same tool, same
  // arguments; MUT operators edit the upstream body only), or the check would say nothing about
  // the amended contract.
  const tToolContract = findContract(old, trigger.tool)?.id;
  const amendedBefore = new Map<string, number>();
  const amendedAfter = new Map<string, number>();
  let usable = 0;
  for (const input of ctx.mutationVariants ?? []) {
    const c = toGateCase(input);
    const cContract = findContract(old, c.tool)?.id;
    const foreign: string[] = [];
    if (c.tool !== trigger.tool || cContract !== tToolContract)
      foreign.push(
        `is a ${cContract ?? c.tool} call, but the trigger is a ${tToolContract ?? trigger.tool} call`,
      );
    else if (canonical(c.args) !== canonical(trigger.args))
      foreign.push(
        `has arguments ${JSON.stringify(c.args)}, but the trigger's are ${JSON.stringify(trigger.args)}`,
      );
    if (foreign.length) {
      findings.push({
        check: 'input',
        caseId: c.id,
        message: `mutation variant ${describe(c)} ${foreign.join('; ')}; it is not a variant of the trigger, so it cannot show the amended contract still rejects the trigger's faults. The gate fails closed`,
      });
      continue;
    }
    const [before, after] = evalBoth(c);
    if (!before || !after) {
      unevaluable('mutation', c);
      continue;
    }
    usable++;
    if (before.violated.size) summary.mutation.rejectedBefore++;
    if (after.violated.size) summary.mutation.rejectedAfter++;
    for (const p of amended) {
      if (before.violated.has(p)) amendedBefore.set(p, (amendedBefore.get(p) ?? 0) + 1);
      if (after.violated.has(p)) amendedAfter.set(p, (amendedAfter.get(p) ?? 0) + 1);
    }
    for (const p of before.violated) {
      if (amendedSet.has(p) || after.violated.has(p)) continue;
      findings.push({
        check: 'mutation',
        caseId: c.id,
        property: p,
        message: `mutation variant ${describe(c)} is no longer rejected on ${p}, which the delta does not amend (was: ${messageFor(before, p)})`,
      });
    }
  }
  if (usable > 0 && summary.mutation.rejectedBefore === 0)
    findings.push({
      check: 'input',
      message: `none of the ${usable} mutation variants of the trigger is rejected under the current contract, so the mutation check would pass vacuously; the gate fails closed`,
    });
  for (const p of amended) {
    const n = amendedBefore.get(p) ?? 0;
    if (n > 0 && (amendedAfter.get(p) ?? 0) === 0)
      findings.push({
        check: 'mutation',
        property: p,
        message: `the amended ${p} rejected ${n} mutation variant(s) of the trigger before and rejects none after; the delta disables the property instead of amending it`,
      });
  }

  return done({ amended, added, contractLevel, proposed: next, delta: parsed.value });
}
