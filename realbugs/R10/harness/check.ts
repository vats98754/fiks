// R10 outcome check (servers #4887): the blind contract's args-driven read-after-write property,
// `readAfterWriteRequested`, and the held-out oracle. Pure functions over a create_entities
// result and its open_nodes read-back; same EvalResult/Violation shapes as @fiks/contracts.
// See ../contract-log.md for why the fiks result-driven `readAfterWrite` cannot express it.
import { readFileSync } from 'node:fs';
import type { EvalResult, ToolResultLike, Violation } from '../../../packages/contracts/src/index.ts';

export const CONTRACT_PATH = new URL('../contract.json', import.meta.url);

export interface RequestedReadBackProperty {
  id: string;
  kind: 'readAfterWriteRequested';
  tool: string;
  probeTool: string;
  probeArgs: { names: string };
  requested: string;
  key: string;
  probeItems: string;
  readBackContains: string[];
  claimedPath: string;
  signal: 'mention';
  rule: string;
}

export interface R10Contract {
  server: string;
  version: 1;
  contracts: { id: string; tool: string; invariants: unknown[] }[];
  realbug: { bugId: string; writtenFrom: string; properties: RequestedReadBackProperty[] };
}

export function loadContract(path: URL | string = CONTRACT_PATH): R10Contract {
  const c = JSON.parse(readFileSync(path, 'utf8')) as R10Contract;
  const p = c.realbug?.properties?.[0];
  if (p?.kind !== 'readAfterWriteRequested') throw new Error('contract has no readAfterWriteRequested');
  return c;
}

export interface EntityLike {
  name: string;
  entityType?: string;
  observations?: string[];
}

export interface CaseIO {
  args: { entities: EntityLike[] };
  result: ToolResultLike;
  probe?: { tool: string; args: Record<string, unknown>; result: ToolResultLike };
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object';

function asEntities(v: unknown): EntityLike[] {
  if (!Array.isArray(v)) return [];
  return v.filter((e): e is EntityLike => isObj(e) && typeof e.name === 'string');
}

/** The names the probe asks for: every requested entity's name, in request order, deduplicated. */
export function probeNames(args: CaseIO['args']): string[] {
  return [...new Set(asEntities(args?.entities).map((e) => e.name))];
}

/** Entities the create_entities response lists as created (`structuredContent.entities`). */
export function claimedEntities(result: ToolResultLike): EntityLike[] {
  return asEntities(result.structuredContent?.entities);
}

/** The probe holds an entity named `e.name` whose observations include all of `e.observations`. */
export function readBack(e: EntityLike, probe: CaseIO['probe']): boolean {
  if (!probe || probe.result.isError) return false;
  const got = asEntities(probe.result.structuredContent?.entities).filter((x) => x.name === e.name);
  if (got.length === 0) return false;
  const have = new Set(got.flatMap((x) => (Array.isArray(x.observations) ? x.observations : [])));
  return (e.observations ?? []).every((o) => have.has(o));
}

function stringsIn(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsIn(x, out);
  else if (isObj(v)) for (const x of Object.values(v)) stringsIn(x, out);
  return out;
}

function textBlocks(result: ToolResultLike): string[] {
  return (result.content ?? [])
    .filter(
      (b): b is { type: 'text'; text: string } => isObj(b) && b.type === 'text' && typeof b.text === 'string',
    )
    .map((b) => b.text);
}

function outsideEntities(result: ToolResultLike): string[] {
  const { entities: _created, ...rest } = result.structuredContent ?? {};
  return stringsIn(rest);
}

/**
 * Blind contract's signal: the response names `name` in structuredContent outside `entities`,
 * or in any text content block (contract.json `signal: "mention"`).
 */
export function mentioned(name: string, result: ToolResultLike): boolean {
  return [...outsideEntities(result), ...textBlocks(result)].some((s) => s.includes(name));
}

const show = (v: unknown) => JSON.stringify(v);

/** Evaluates the blind contract's property on one create_entities call and its read-back. */
export function evaluateCase(contract: R10Contract, io: CaseIO): EvalResult {
  const prop = contract.realbug.properties[0] as RequestedReadBackProperty;
  const contractId = contract.contracts[0]?.id ?? null;
  if (io.result.isError) return { verdict: 'unverifiable', contractId, checked: [], violations: [] };
  const claimed = new Set(claimedEntities(io.result).map((e) => e.name));
  const violations: Violation[] = [];
  for (const e of asEntities(io.args?.entities)) {
    if (readBack(e, io.probe)) continue;
    const isClaimed = claimed.has(e.name);
    if (!isClaimed && mentioned(e.name, io.result)) continue;
    const back = asEntities(io.probe?.result.structuredContent?.entities).filter((x) => x.name === e.name);
    const got = back.flatMap((x) => x.observations ?? []);
    const missing = (e.observations ?? []).filter((o) => !got.includes(o));
    violations.push({
      propertyId: prop.id,
      kind: 'readAfterWrite',
      path: `${prop.probeTool}.entities[name=${e.name}].observations`,
      expected: `${show(e.observations ?? [])} read back, or ${e.name} reported as not written`,
      actual: back.length ? got : null,
      message: isClaimed
        ? `${prop.tool} listed ${e.name} as created but ${prop.probeTool} ${e.name} read back ${show(got)}, missing ${show(missing)}`
        : `${prop.tool} dropped ${e.name} silently: ${prop.probeTool} ${e.name} read back ${back.length ? show(got) : 'nothing'}, missing ${show(missing)}, and the response does not name ${e.name}`,
    });
    break;
  }
  return {
    verdict: violations.length ? 'violated' : 'verified',
    contractId,
    checked: [prop.id],
    violations,
  };
}

/** A text block that is just the created list (or the structured result) serialised is no signal. */
function echoesCreated(text: string, result: ToolResultLike): boolean {
  try {
    const parsed = JSON.parse(text);
    return (
      show(parsed) === show(result.structuredContent?.entities ?? []) ||
      show(parsed) === show(result.structuredContent ?? null)
    );
  } catch {
    return false;
  }
}

export interface HeldoutItemVerdict {
  name: string;
  index: number;
  readBack: boolean;
  signalled: boolean;
  ok: boolean;
}

export interface HeldoutVerdict {
  ok: boolean;
  explicitError: boolean;
  items: HeldoutItemVerdict[];
  /** Created entities the response claims but the read-back does not hold. */
  claimedNotReadBack: string[];
  reasons: string[];
}

/**
 * Held-out oracle (stricter than the blind contract; accepts either fix direction): every
 * requested item is read back or named as not written outside the created list (structured
 * fields other than `entities`, or a text block that is not the created list serialised);
 * every entity claimed as created reads back; `control` cases must not error.
 */
export function heldoutVerdict(io: CaseIO, opts: { control: boolean }): HeldoutVerdict {
  const reasons: string[] = [];
  if (io.result.isError) {
    if (opts.control) reasons.push('create_entities returned an error on a control input');
    return { ok: !opts.control, explicitError: true, items: [], claimedNotReadBack: [], reasons };
  }
  const extra = [
    ...outsideEntities(io.result),
    ...textBlocks(io.result).filter((t) => !echoesCreated(t, io.result)),
  ];
  const items = asEntities(io.args?.entities).map((e, index) => {
    const rb = readBack(e, io.probe);
    const signalled = extra.some((s) => s.includes(e.name));
    const ok = rb || signalled;
    if (!ok) reasons.push(`item ${index} (${e.name}) neither read back nor reported as not written`);
    return { name: e.name, index, readBack: rb, signalled, ok };
  });
  const claimedNotReadBack = claimedEntities(io.result)
    .filter((c) => !readBack(c, io.probe))
    .map((c) => c.name);
  for (const n of claimedNotReadBack) reasons.push(`${n} listed as created but not read back`);
  return {
    ok: items.every((i) => i.ok) && claimedNotReadBack.length === 0,
    explicitError: false,
    items,
    claimedNotReadBack,
    reasons,
  };
}
