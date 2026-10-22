// R9 outcome check (cloudflare/mcp-server-cloudflare #468): the blind contract's bug-specific
// properties `textJson` and `carriesUpstream`, merged with the standard @fiks/contracts result
// (declared outputSchema), and the held-out oracle. Pure functions over a tools/call result as a
// spec client sees it (MCP SDK `CallToolResultSchema`) and the upstream exchanges it caused; same
// EvalResult/Violation shapes as @fiks/contracts. See ../contract-log.md for why the frozen fiks
// vocabulary cannot express these properties.
import { readFileSync } from 'node:fs';
import type {
  ContractFile,
  EvalResult,
  HttpExchange,
  ToolResultLike,
  Violation,
} from '../../../packages/contracts/src/index.ts';

export const CONTRACT_PATH = new URL('../contract.json', import.meta.url);

export interface TextJsonProperty {
  id: string;
  kind: 'textJson';
  tool: string;
  forbiddenSubstring: string;
  rule: string;
}

export interface CarriesUpstreamProperty {
  id: string;
  kind: 'carriesUpstream';
  tool: string;
  upstreamItems: 'result[*].id';
  rule: string;
}

export type R9Property = TextJsonProperty | CarriesUpstreamProperty;

export interface R9Contract extends ContractFile {
  realbug: {
    bugId: string;
    writtenFrom: string;
    toolNames: Record<string, string>;
    properties: R9Property[];
    standard: string;
  };
}

export function loadContract(path: URL | string = CONTRACT_PATH): R9Contract {
  const c = JSON.parse(readFileSync(path, 'utf8')) as R9Contract;
  const kinds = new Set((c.realbug?.properties ?? []).map((p) => p.kind));
  if (!kinds.has('textJson') || !kinds.has('carriesUpstream')) {
    throw new Error('contract has no textJson/carriesUpstream properties');
  }
  return c;
}

/** One replayed call: what the evaluator reads. */
export interface CaseIO {
  tool: string;
  args: Record<string, unknown>;
  result: ToolResultLike;
  /** Upstream exchanges the call caused, in order. */
  upstream: HttpExchange[];
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object';

/** The text of every `{type: 'text', text: string}` content block, in order. */
export function textBlocks(result: ToolResultLike): string[] {
  return (Array.isArray(result.content) ? result.content : [])
    .filter(
      (b): b is { type: 'text'; text: string } => isObj(b) && b.type === 'text' && typeof b.text === 'string',
    )
    .map((b) => b.text);
}

/** JSON.parse that returns undefined instead of throwing. */
export function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Every text block that parses to an object or an array, parsed. */
export function jsonPayloads(result: ToolResultLike): unknown[] {
  return textBlocks(result)
    .map(tryJson)
    .filter((v) => isObj(v));
}

/** Every string value anywhere in `v` (object values and array elements, recursively). */
export function stringValues(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === 'string') out.add(v);
  else if (Array.isArray(v)) for (const x of v) stringValues(x, out);
  else if (isObj(v)) for (const x of Object.values(v)) stringValues(x, out);
  return out;
}

/** String `id` values of `result[*]` in the call's 2xx JSON upstream responses (v4 envelope). */
export function upstreamItemIds(upstream: HttpExchange[]): string[] {
  const ids: string[] = [];
  for (const x of upstream) {
    if (x.response.status < 200 || x.response.status > 299) continue;
    const body = tryJson(x.response.body);
    if (!isObj(body) || !Array.isArray(body.result)) continue;
    for (const item of body.result) if (isObj(item) && typeof item.id === 'string') ids.push(item.id);
  }
  return [...new Set(ids)];
}

const preview = (s: string) => (s.length > 60 ? `${JSON.stringify(s.slice(0, 60))}…` : JSON.stringify(s));

/** `textJson`: no text block contains the forbidden substring; some text block is JSON when any exists. */
export function checkTextJson(contractId: string, p: TextJsonProperty, io: CaseIO): Violation[] {
  const propertyId = `${contractId}/textJson`;
  const texts = textBlocks(io.result);
  const out: Violation[] = [];
  const bad = texts.findIndex((t) => t.includes(p.forbiddenSubstring));
  if (bad !== -1) {
    out.push({
      propertyId,
      kind: 'textJson',
      path: `content[${bad}].text`,
      expected: `no ${JSON.stringify(p.forbiddenSubstring)}`,
      actual: texts[bad],
      message: `${io.tool} returned ${preview(texts[bad] as string)} in place of the JSON payload`,
    });
  }
  if (texts.length > 0 && jsonPayloads(io.result).length === 0) {
    out.push({
      propertyId,
      kind: 'textJson',
      path: 'content[*].text',
      expected: 'a text block that parses as a JSON object or array',
      actual: texts[0],
      message: `${io.tool} returned ${texts.length} text block(s) and none parses as JSON (first: ${preview(texts[0] as string)})`,
    });
  }
  return out.slice(0, 1);
}

/** `carriesUpstream`: every upstream `result[*].id` appears in the tool's payload. Null = skipped. */
export function checkCarriesUpstream(contractId: string, io: CaseIO): Violation[] | null {
  const ids = upstreamItemIds(io.upstream);
  if (ids.length === 0) return null;
  const have = new Set<string>();
  for (const v of jsonPayloads(io.result)) stringValues(v, have);
  if (io.result.structuredContent) stringValues(io.result.structuredContent, have);
  const missing = ids.filter((id) => !have.has(id));
  if (missing.length === 0) return [];
  return [
    {
      propertyId: `${contractId}/carriesUpstream`,
      kind: 'carriesUpstream',
      path: 'content[*].text',
      expected: `ids ${ids.join(', ')} from the upstream result`,
      actual: missing,
      message: `${io.tool} dropped ${missing.length} of ${ids.length} upstream item(s): ${missing.join(', ')}`,
    },
  ];
}

/**
 * The blind contract's verdict for one call: the standard @fiks/contracts result (`standard`,
 * e.g. from replay-proc's evaluation with the declared outputSchema) plus this tool's
 * bug-specific properties. An isError result is unverifiable, as in the fiks evaluator.
 */
export function evaluateCase(contract: R9Contract, io: CaseIO, standard?: EvalResult): EvalResult {
  const c = contract.contracts.find((x) => x.tool === io.tool);
  if (!c) return { verdict: 'unverifiable', contractId: null, checked: [], violations: [] };
  if (io.result.isError === true) {
    return { verdict: 'unverifiable', contractId: c.id, checked: [], violations: [] };
  }
  const checked = [...(standard?.checked ?? [])];
  const violations = [...(standard?.violations ?? [])];
  for (const p of contract.realbug.properties.filter((x) => x.tool === io.tool)) {
    if (p.kind === 'textJson') {
      checked.push(`${c.id}/textJson`);
      violations.push(...checkTextJson(c.id, p, io));
    } else {
      const r = checkCarriesUpstream(c.id, io);
      if (r === null) continue;
      checked.push(`${c.id}/carriesUpstream`);
      violations.push(...r);
    }
  }
  const verdict = violations.length ? 'violated' : checked.length ? 'verified' : 'unverifiable';
  return { verdict, contractId: c.id, checked, violations };
}

// ---- Held-out oracle (written after the PR #469 diff; direction-neutral) ----

/** A held-out case's expectation of a correct head. */
export type HeldoutExpect =
  /**
   * The agent gets the upstream data: a JSON text block holding every upstream id (and every
   * `mustContain` string, for items without an `id`), and no id the upstream did not send.
   */
  | { kind: 'data'; mustContain?: string[] }
  /** The upstream failed: the agent gets an explicit tool error (`isError: true`). */
  | { kind: 'error' };

export interface HeldoutGrade {
  ok: boolean;
  reasons: string[];
}

/** Every string value under a key named `id`, anywhere in `v`. */
export function idValues(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) idValues(x, out);
  else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'id' && typeof x === 'string') out.add(x);
      else idValues(x, out);
    }
  }
  return out;
}

/**
 * The held-out oracle. `data`: not an error; no text block contains `[object Object]`; some text
 * block (or structuredContent) is a JSON object/array that holds every `id` of the upstream
 * `result` items (and every `mustContain` string) and no `id` the upstream did not send (e.g.
 * hard-coded mock records); the call made an upstream request. `error`:
 * `isError === true`. Any fix direction that meets these passes (bare array, full envelope,
 * structuredContent, a JSON block plus prose).
 */
export function gradeHeldout(expect: HeldoutExpect, io: CaseIO): HeldoutGrade {
  const reasons: string[] = [];
  const texts = textBlocks(io.result);
  if (expect.kind === 'error') {
    if (io.result.isError !== true) {
      reasons.push(
        `upstream failed but the result is not an error (isError ${String(io.result.isError)}, ${texts.length} text block(s))`,
      );
    }
    return { ok: reasons.length === 0, reasons };
  }
  if (io.result.isError === true) reasons.push(`error result: ${preview(texts[0] ?? '')}`);
  if (texts.some((t) => t.includes('[object Object]'))) reasons.push('a text block contains [object Object]');
  const payloads = [...jsonPayloads(io.result)];
  if (io.result.structuredContent) payloads.push(io.result.structuredContent);
  if (payloads.length === 0) {
    reasons.push(`no JSON payload reaches the agent (${texts.length} text block(s), no structuredContent)`);
    return { ok: false, reasons };
  }
  const want = upstreamItemIds(io.upstream);
  const allowed = new Set<string>();
  for (const x of io.upstream) idValues(tryJson(x.response.body), allowed);
  const have = new Set<string>();
  for (const p of payloads) stringValues(p, have);
  const missing = want.filter((id) => !have.has(id));
  if (missing.length) reasons.push(`missing upstream ids: ${missing.join(', ')}`);
  const absent = (expect.mustContain ?? []).filter((x) => !have.has(x));
  if (absent.length) reasons.push(`missing upstream values: ${absent.join(', ')}`);
  const got = new Set<string>();
  for (const p of payloads) idValues(p, got);
  const foreign = [...got].filter((id) => !allowed.has(id));
  if (foreign.length) reasons.push(`ids the upstream never sent: ${foreign.join(', ')}`);
  if (io.upstream.length === 0) reasons.push('the call made no upstream request');
  return { ok: reasons.length === 0, reasons };
}
