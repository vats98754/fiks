// Structural validation of an authored contract file. VOCAB ships the types (packages/contracts/src/
// types.ts) and the evaluator but no runtime loader, so this mirrors `ContractFile` field by field:
// known kinds only, every required field with its type, no unknown keys, unique ids, tools that
// exist. `disabled` is refused: only scripts/contract-disable.mjs may set it (D11).
import type { ContractFile } from '@fiks/contracts';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const COMMON = ['id', 'kind'];
/** kind -> [required fields, optional fields] (besides id and kind). */
const KINDS: Record<
  string,
  [Record<string, (v: unknown) => boolean>, Record<string, (v: unknown) => boolean>]
> = {
  range: [{ path: isStr }, { min: isNum, max: isNum, unit: isStr }],
  notNull: [{ path: isStr }, { onlyKnownGood: (v) => typeof v === 'boolean' }],
  nonEmpty: [{ path: isStr }, { onlyKnownGood: (v) => typeof v === 'boolean' }],
  countMatchesTotal: [{ itemsPath: isStr, totalPath: isStr }, {}],
  freshness: [{ path: isStr, maxAgeDays: isNum }, { maxFutureDays: isNum }],
  equalsUpstream: [{ path: isStr, upstreamPath: isStr }, { compare: (v) => v === 'json' || v === 'instant' }],
  unique: [{ path: isStr }, {}],
  enum: [
    { path: isStr, values: (v) => Array.isArray(v) && v.length > 0 },
    { onlyKnownGood: (v) => typeof v === 'boolean' },
  ],
  crossField: [
    { left: isStr, op: (v) => ['==', '!=', '<', '<=', '>', '>='].includes(v as string), right: isStr },
    { path: isStr, tolerance: isNum },
  ],
  pageComplete: [{ upstreamCursorPath: isStr }, {}],
};

export const INVARIANT_KINDS = Object.keys(KINDS);

function checkKeys(o: Json, allowed: string[], where: string, errs: string[]) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) errs.push(`${where}: unknown field "${k}"`);
}

function checkInvariant(inv: unknown, where: string, errs: string[]) {
  if (!isObj(inv)) return errs.push(`${where}: must be an object`);
  if (!isStr(inv.id)) errs.push(`${where}: id must be a non-empty string`);
  if (inv.disabled !== undefined || inv.disabledReason !== undefined)
    errs.push(`${where}: "disabled" is set only by scripts/contract-disable.mjs`);
  const spec = typeof inv.kind === 'string' ? KINDS[inv.kind] : undefined;
  if (!spec)
    return errs.push(`${where}: unknown kind ${JSON.stringify(inv.kind)} (${INVARIANT_KINDS.join(', ')})`);
  const [req, opt] = spec;
  for (const [k, ok] of Object.entries(req))
    if (!ok(inv[k])) errs.push(`${where}: ${inv.kind}.${k} is missing or invalid`);
  for (const [k, ok] of Object.entries(opt))
    if (inv[k] !== undefined && !ok(inv[k])) errs.push(`${where}: ${inv.kind}.${k} is invalid`);
  checkKeys(inv, [...COMMON, ...Object.keys(req), ...Object.keys(opt)], where, errs);
  if (inv.kind === 'range' && inv.min === undefined && inv.max === undefined)
    errs.push(`${where}: range needs min or max`);
  if (inv.kind === 'range' && isNum(inv.min) && isNum(inv.max) && inv.min > inv.max)
    errs.push(`${where}: range min > max`);
}

function checkPost(p: unknown, where: string, tools: Set<string> | null, errs: string[]) {
  if (!isObj(p)) return errs.push(`${where}: must be an object`);
  if (p.id !== 'readAfterWrite') errs.push(`${where}: id must be "readAfterWrite"`);
  if (p.disabled !== undefined || p.disabledReason !== undefined)
    errs.push(`${where}: "disabled" is set only by scripts/contract-disable.mjs`);
  if (!isStr(p.probeTool)) errs.push(`${where}: probeTool must be a tool name`);
  else if (tools && !tools.has(p.probeTool))
    errs.push(`${where}: probeTool ${p.probeTool} is not a tool of the server`);
  if (!isObj(p.probeArgs) || !Object.values(p.probeArgs).every(isStr))
    errs.push(`${where}: probeArgs must map argument names to paths`);
  if (!Array.isArray(p.expect) || p.expect.length === 0)
    errs.push(`${where}: expect must be a non-empty array`);
  else
    p.expect.forEach((e, i) => {
      if (!isObj(e) || !isStr(e.probePath) || !isStr(e.equalsResultPath))
        errs.push(`${where}.expect[${i}]: needs probePath and equalsResultPath`);
      else checkKeys(e, ['probePath', 'equalsResultPath'], `${where}.expect[${i}]`, errs);
    });
  if (p.upstream !== undefined) {
    if (!isObj(p.upstream) || !isStr(p.upstream.idPath) || !isStr(p.upstream.equalsResultPath))
      errs.push(`${where}.upstream: needs idPath and equalsResultPath`);
    else checkKeys(p.upstream, ['idPath', 'equalsResultPath'], `${where}.upstream`, errs);
  }
  checkKeys(p, ['id', 'probeTool', 'probeArgs', 'expect', 'upstream'], where, errs);
}

export interface ContractCheckOptions {
  /** The server name the file must declare (e.g. `tracker-mcp`). */
  server?: string;
  /** The server's tool names; every contract must name one of them. */
  tools?: readonly string[];
  /** Tools that must each have a contract (e.g. every tool in the export's calls). */
  requireTools?: readonly string[];
}

/** Problems with a parsed contract file (empty = valid). */
export function contractFileErrors(raw: unknown, opts: ContractCheckOptions = {}): string[] {
  const errs: string[] = [];
  if (!isObj(raw)) return ['contract file must be a JSON object'];
  checkKeys(raw, ['server', 'version', 'contracts'], '$', errs);
  if (!isStr(raw.server)) errs.push('$: server must be a non-empty string');
  else if (opts.server && raw.server !== opts.server)
    errs.push(`$: server is ${raw.server}, expected ${opts.server}`);
  if (raw.version !== 1) errs.push('$: version must be 1');
  if (!Array.isArray(raw.contracts) || raw.contracts.length === 0) {
    errs.push('$: contracts must be a non-empty array');
    return errs;
  }
  const tools = opts.tools ? new Set(opts.tools) : null;
  const ids = new Set<string>();
  const seenTools = new Set<string>();
  for (const [i, c] of raw.contracts.entries()) {
    const where = `contracts[${i}]`;
    if (!isObj(c)) {
      errs.push(`${where}: must be an object`);
      continue;
    }
    checkKeys(
      c,
      ['id', 'tool', 'outputSchema', 'invariants', 'postconditions', 'knownGoodInputs'],
      where,
      errs,
    );
    if (!isStr(c.id)) errs.push(`${where}: id must be a non-empty string`);
    else if (ids.has(c.id)) errs.push(`${where}: duplicate contract id ${c.id}`);
    else ids.add(c.id);
    if (!isStr(c.tool)) errs.push(`${where}: tool must be a non-empty string`);
    else {
      if (tools && !tools.has(c.tool)) errs.push(`${where}: tool ${c.tool} is not a tool of the server`);
      if (seenTools.has(c.tool)) errs.push(`${where}: a second contract for tool ${c.tool}`);
      seenTools.add(c.tool);
    }
    if (c.outputSchema !== undefined && !isObj(c.outputSchema))
      errs.push(`${where}: outputSchema must be an object`);
    if (!Array.isArray(c.invariants)) errs.push(`${where}: invariants must be an array`);
    const propIds = new Set<string>();
    const noteId = (id: unknown, w: string) => {
      if (typeof id !== 'string') return;
      if (propIds.has(id) || id === 'outputSchema')
        errs.push(`${w}: duplicate or reserved property id ${id}`);
      propIds.add(id);
    };
    (Array.isArray(c.invariants) ? c.invariants : []).forEach((inv, j) => {
      checkInvariant(inv, `${where}.invariants[${j}]`, errs);
      if (isObj(inv)) noteId(inv.id, `${where}.invariants[${j}]`);
    });
    if (c.postconditions !== undefined) {
      if (!Array.isArray(c.postconditions)) errs.push(`${where}: postconditions must be an array`);
      else
        c.postconditions.forEach((p, j) => {
          checkPost(p, `${where}.postconditions[${j}]`, tools, errs);
          if (isObj(p)) noteId(p.id, `${where}.postconditions[${j}]`);
        });
    }
    if (
      c.knownGoodInputs !== undefined &&
      (!Array.isArray(c.knownGoodInputs) || !c.knownGoodInputs.every(isObj))
    )
      errs.push(`${where}: knownGoodInputs must be an array of objects`);
    const hasKnownGood = Array.isArray(c.knownGoodInputs) && c.knownGoodInputs.length > 0;
    for (const inv of Array.isArray(c.invariants) ? c.invariants : [])
      if (isObj(inv) && inv.onlyKnownGood === true && !hasKnownGood)
        errs.push(`${where}: ${String(inv.id)} is onlyKnownGood but the contract has no knownGoodInputs`);
  }
  for (const t of opts.requireTools ?? []) if (!seenTools.has(t)) errs.push(`$: no contract for tool ${t}`);
  return errs;
}

/** Parses and validates; throws with every problem listed. */
export function parseContractFile(text: string, opts: ContractCheckOptions = {}): ContractFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`contract file is not JSON: ${(e as Error).message}`);
  }
  const errs = contractFileErrors(raw, opts);
  if (errs.length) throw new Error(`invalid contract file:\n  ${errs.join('\n  ')}`);
  return raw as ContractFile;
}
