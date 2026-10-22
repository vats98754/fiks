// Response-mutation operators M1-M14 and benign controls B1-B4 (paper/PLAN.md 5.4), as pure
// functions of (operator, JSON, seed). The definitions they implement are in ../catalog.json; the
// catalog hash covers this file, so any behaviour change shows up as a new hash.
import catalog from '../catalog.json' with { type: 'json' };
import { canonicalJson, deepClone, hex8, isRecord, pick, rng, sha256 } from './util.ts';
import { groupByNorm, renameKey, type Slot, setSlot, slots } from './walk.ts';

export const RESPONSE_OPS = [
  'M1',
  'M2',
  'M3',
  'M4',
  'M5',
  'M6',
  'M7',
  'M8',
  'M9',
  'M10',
  'M11',
  'M12',
  'M13',
  'M14',
] as const;
export const BENIGN_OPS = ['B1', 'B2', 'B3', 'B4'] as const;
export type ResponseOp = (typeof RESPONSE_OPS)[number];
export type BenignOp = (typeof BENIGN_OPS)[number];
export type ResponseOperator = ResponseOp | BenignOp;

export const isResponseOperator = (op: string): op is ResponseOperator =>
  (RESPONSE_OPS as readonly string[]).includes(op) || (BENIGN_OPS as readonly string[]).includes(op);

/** Optional facts about the exchange the JSON came from. Only M14 reads them. */
export interface ResponseContext {
  /** The upstream request method; POST, PUT and PATCH make M14 a phantom acknowledgement. */
  method?: string;
}

export interface ResponseMutation {
  op: ResponseOperator;
  seed: string;
  /** False when no site was eligible: `json` and `body` are then the input, unchanged. */
  applicable: boolean;
  /** Normalized path of the mutated site (`items[*].price`, `$` for the root), or null. */
  site: string | null;
  /** How many concrete values changed. */
  changed: number;
  /** The mutated JSON value. */
  json: unknown;
  /** The mutated body as sent upstream (JSON.stringify, except for B3). */
  body: string;
  /** Replacement response status (M14 on a read). */
  status?: number;
  /** Response headers to add (B4). */
  addHeaders?: Record<string, string>;
  /** One line saying what changed. */
  note: string;
}

const SYNONYMS: Record<string, string[]> = catalog.synonyms;

/** idKey (catalog conventions): `id`/`uuid` in any case, `*_id`, or camel-case `*Id`. */
export const isIdKey = (k: unknown): boolean =>
  typeof k === 'string' && (/^(?:id|uuid)$/i.test(k) || k.endsWith('_id') || /[a-z]Id$/.test(k));

const ISO = /^(\d{4}-\d{2}-\d{2})(?:([T ])(\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
export const isIsoTimestamp = (v: unknown): v is string =>
  typeof v === 'string' && ISO.test(v) && Number.isFinite(Date.parse(v));

export type EpochUnit = 's' | 'ms';
export function epochUnit(v: unknown): EpochUnit | null {
  if (typeof v !== 'number' || !Number.isInteger(v)) return null;
  if (v >= 1e9 && v < 1e10) return 's';
  if (v >= 1e12 && v < 1e13) return 'ms';
  return null;
}
const isTimestamp = (v: unknown) => isIsoTimestamp(v) || epochUnit(v) !== null;

const ENUM_LOWER = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;
const ENUM_UPPER = /^[A-Z][A-Z0-9_]{1,15}$/;
export const isEnumLike = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 32 && (ENUM_LOWER.test(v) || ENUM_UPPER.test(v));

const isProp = (s: Slot): s is Slot & { at: string; parent: Record<string, unknown> } =>
  typeof s.at === 'string';
const keyOk = (s: Slot) => !isIdKey(s.at);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const sig15 = (n: number) => Number(n.toPrecision(15));
const DAY_MS = 86_400_000;

/** `ms` written in the format of the recorded ISO string `like` (precision and offset style kept). */
function formatIsoLike(like: string, ms: number): string {
  const m = ISO.exec(like);
  if (!m) throw new Error(`not an ISO timestamp: ${like}`);
  const [, , sep, , sec, frac, zone] = m;
  // Keep the recorded offset: shift into it, print as UTC, then re-append it.
  let offsetMin = 0;
  if (zone && zone !== 'Z') {
    const z = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
    if (z) offsetMin = (z[1] === '-' ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3]));
  }
  const local = new Date(ms + offsetMin * 60_000).toISOString(); // YYYY-MM-DDTHH:MM:SS.mmmZ
  const date = local.slice(0, 10);
  if (!sep) return date;
  let out = `${date}${sep}${local.slice(11, 16)}`;
  if (sec !== undefined) out += `:${local.slice(17, 19)}`;
  if (frac !== undefined) out += `.${local.slice(20, 23).padEnd(frac.length, '0').slice(0, frac.length)}`;
  return out + (zone ?? '');
}

function shiftTimestamp(v: unknown, deltaMs: number): unknown {
  if (isIsoTimestamp(v)) return formatIsoLike(v, Date.parse(v) + deltaMs);
  const unit = epochUnit(v);
  if (unit === 's') return (v as number) + Math.round(deltaMs / 1000);
  if (unit === 'ms') return (v as number) + deltaMs;
  return v;
}

function nextLetter(s: string, r: () => number): string {
  const letters: number[] = [];
  for (let i = 0; i < s.length; i++) if (/[A-Za-z]/.test(s[i] as string)) letters.push(i);
  if (letters.length === 0) return s;
  const i = letters[pick(r, letters.length)] as number;
  const c = s.charCodeAt(i);
  const next = c === 122 ? 97 : c === 90 ? 65 : c + 1;
  return s.slice(0, i) + String.fromCharCode(next) + s.slice(i + 1);
}

/** The next identity: integer + 1, or the trailing number + 1 with its zero padding. */
function nextIdentity(v: unknown): unknown {
  if (typeof v === 'number' && Number.isInteger(v)) return v + 1;
  if (typeof v === 'string') {
    const m = /^(.*?)(\d+)$/.exec(v);
    if (m) return `${m[1]}${String(Number(m[2]) + 1).padStart((m[2] as string).length, '0')}`;
  }
  return undefined;
}

function phantomIdentity(v: unknown, r: () => number): unknown {
  if (typeof v === 'number' && Number.isInteger(v)) {
    const width = Math.max(String(Math.abs(v)).length, 4);
    let s = '9';
    while (s.length < width) s += String(pick(r, 10));
    const n = Number(s);
    return n === v ? n + 1 : n;
  }
  if (typeof v === 'string') {
    const m = /^(.*?)(\d+)$/.exec(v);
    if (!m) return `${v}-phantom`;
    const width = (m[2] as string).length;
    let s = '9';
    while (s.length < width) s += String(pick(r, 10));
    const out = `${m[1]}${s}`;
    return out === v ? `${v}-phantom` : out;
  }
  return undefined;
}

interface Plan {
  site: string | null;
  apply: () => number;
  note: string;
  status?: number;
  replaceRoot?: unknown;
  addHeaders?: Record<string, string>;
  body?: (json: unknown) => string;
}

type Planner = (root: unknown, all: Slot[], r: () => number, ctx: ResponseContext) => Plan | null;

/** Draws one site from groups (sorted by path); null when there is none. */
function drawGroup<T>(groups: [string, T][], r: () => number): [string, T] | null {
  if (groups.length === 0) return null;
  return groups[pick(r, groups.length)] as [string, T];
}

/** A planner that maps every value at one drawn site through `f`. */
function valueOp(eligible: (s: Slot) => boolean, f: (v: unknown) => unknown, verb: string): Planner {
  return (_root, all, r) => {
    const g = drawGroup(groupByNorm(all.filter((s) => s.parent !== null && eligible(s))), r);
    if (!g) return null;
    const [site, group] = g;
    return {
      site,
      note: `${verb} at ${site}`,
      apply: () => {
        let n = 0;
        for (const s of group) {
          const v = f(s.value);
          if (v !== s.value) {
            setSlot(s, v);
            n++;
          }
        }
        return n;
      },
    };
  };
}

// Zero is not a site: x100 or /100 would leave it unchanged.
const numericNonTime = (s: Slot) =>
  isNum(s.value) && s.value !== 0 && epochUnit(s.value) === null && keyOk(s);

const PLANNERS: Record<ResponseOperator, Planner> = {
  M1: valueOp(numericNonTime, (v) => sig15((v as number) * 100), 'multiplied numbers by 100'),
  M2: valueOp(numericNonTime, (v) => sig15((v as number) / 100), 'divided numbers by 100'),
  M3: (_root, all, r) => {
    // A site is eligible only if some synonym of its key collides with no key of its objects.
    const free = (group: Slot[], syn: string) => group.every((s) => !Object.hasOwn(s.parent as object, syn));
    const g = drawGroup(
      groupByNorm(all.filter((s) => isProp(s) && Object.hasOwn(SYNONYMS, s.at))).filter(([, group]) =>
        (SYNONYMS[group[0]?.at as string] ?? []).some((syn) => free(group, syn)),
      ),
      r,
    );
    if (!g) return null;
    const [site, group] = g;
    const from = group[0]?.at as string;
    const order = [...(SYNONYMS[from] ?? [])];
    for (let i = order.length - 1; i > 0; i--) {
      const j = pick(r, i + 1);
      [order[i], order[j]] = [order[j] as string, order[i] as string];
    }
    const to = order.find((syn) => free(group, syn)) as string;
    return {
      site,
      note: `renamed ${from} to ${to} at ${site}`,
      apply: () => {
        for (const s of group) renameKey(s.parent as Record<string, unknown>, from, to);
        return group.length;
      },
    };
  },
  M4: (_root, all, r) => {
    const g = drawGroup(groupByNorm(all.filter(isProp)), r);
    if (!g) return null;
    const [site, group] = g;
    return {
      site,
      note: `dropped ${site}`,
      apply: () => {
        for (const s of group) delete (s.parent as Record<string, unknown>)[s.at as string];
        return group.length;
      },
    };
  },
  M5: valueOp(
    (s) => isProp(s) && s.value !== null,
    () => null,
    'set null',
  ),
  M6: (_root, all, r) => {
    const g = drawGroup(groupByNorm(all.filter((s) => Array.isArray(s.value) && s.value.length > 5)), r);
    if (!g) return null;
    const [site, group] = g;
    return {
      site,
      note: `truncated arrays at ${site} to 5 elements`,
      apply: () => {
        for (const s of group) (s.value as unknown[]).splice(5);
        return group.length;
      },
    };
  },
  M7: valueOp(
    (s) => isNum(s.value) && keyOk(s),
    (v) => String(v),
    'stringified numbers',
  ),
  M8: valueOp(
    (s) => isIsoTimestamp(s.value),
    (v) => Date.parse(v as string),
    'ISO-8601 to epoch ms',
  ),
  M9: valueOp(
    (s) => epochUnit(s.value) !== null,
    (v) => (epochUnit(v) === 's' ? (v as number) * 1000 : Math.floor((v as number) / 1000)),
    'epoch s <-> ms',
  ),
  M10: (root, all, r, ctx) => {
    const token = hex8(r).slice(0, 4);
    return valueOp(
      (s) => isEnumLike(s.value) && !isIsoTimestamp(s.value) && keyOk(s),
      (v) => (ENUM_UPPER.test(v as string) ? `FIKS_UNKNOWN_${token.toUpperCase()}` : `fiks_unknown_${token}`),
      'unknown enum value',
    )(root, all, r, ctx);
  },
  M11: (root, all, r, ctx) =>
    valueOp(
      (s) =>
        typeof s.value === 'string' &&
        /[A-Za-z]/.test(s.value) &&
        !isTimestamp(s.value) &&
        !isEnumLike(s.value) &&
        keyOk(s),
      (v) => nextLetter(v as string, r),
      'perturbed strings',
    )(root, all, r, ctx),
  M12: (_root, all, r) => {
    type Site = { kind: 'swap'; arr: unknown[]; key: string } | { kind: 'next'; slot: Slot };
    const sites: [string, Site[]][] = [];
    for (const [norm, group] of groupByNorm(all.filter((s) => Array.isArray(s.value)))) {
      const list: Site[] = [];
      for (const s of group) {
        const arr = s.value as unknown[];
        if (arr.length < 2 || !arr.every(isRecord)) continue;
        const key = Object.keys(arr[0] as object).find(
          (k) => isIdKey(k) && arr.every((e) => Object.hasOwn(e as object, k)),
        );
        if (!key) continue;
        if (new Set(arr.map((e) => canonicalJson((e as Record<string, unknown>)[key]))).size < 2) continue;
        list.push({ kind: 'swap', arr, key });
      }
      const k = list[0]?.kind === 'swap' ? list[0].key : '';
      if (list.length) sites.push([`${norm === '$' ? '' : norm}[*].${k}`, list]);
    }
    for (const [norm, group] of groupByNorm(
      all.filter((s) => isProp(s) && isIdKey(s.at) && !s.inArray && nextIdentity(s.value) !== undefined),
    )) {
      sites.push([norm, group.map((slot) => ({ kind: 'next', slot }) as Site)]);
    }
    sites.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const g = drawGroup(sites, r);
    if (!g) return null;
    const [site, list] = g;
    return {
      site,
      note: `identity swap at ${site}`,
      apply: () => {
        let n = 0;
        for (const s of list) {
          if (s.kind === 'next') {
            setSlot(s.slot, nextIdentity(s.slot.value));
            n++;
            continue;
          }
          const els = s.arr as Record<string, unknown>[];
          const pairs: [number, number][] = [];
          for (let i = 0; i < els.length; i++)
            for (let j = i + 1; j < els.length; j++)
              if (canonicalJson(els[i]?.[s.key]) !== canonicalJson(els[j]?.[s.key])) pairs.push([i, j]);
          const [i, j] = pairs[pick(r, pairs.length)] as [number, number];
          const a = els[i] as Record<string, unknown>;
          const b = els[j] as Record<string, unknown>;
          [a[s.key], b[s.key]] = [b[s.key], a[s.key]];
          n += 2;
        }
        return n;
      },
    };
  },
  M13: valueOp(
    (s) => isTimestamp(s.value),
    (v) => shiftTimestamp(v, -400 * DAY_MS),
    'moved 400 days back',
  ),
  M14: (root, _all, r, ctx) => {
    if (!isRecord(root)) return null;
    const key = Object.keys(root).find((k) => isIdKey(k) && phantomIdentity(root[k], () => 0) !== undefined);
    if (!key) return null;
    const write = /^(?:POST|PUT|PATCH)$/i.test(ctx.method ?? '');
    if (write) {
      return {
        site: key,
        note: `phantom acknowledgement: ${key} replaced by an identity that was never persisted`,
        apply: () => {
          root[key] = phantomIdentity(root[key], r);
          return 1;
        },
      };
    }
    return {
      site: '$',
      note: 'phantom write seen from the read: the resource is absent (404)',
      status: 404,
      replaceRoot: { error: 'not_found', message: 'Not found.' },
      apply: () => 1,
    };
  },
  B1: (_root, all, r) => {
    const g = drawGroup(
      groupByNorm(
        all.filter((s) => Array.isArray(s.value) && new Set(s.value.map((e) => canonicalJson(e))).size >= 2),
      ),
      r,
    );
    if (!g) return null;
    const [site, group] = g;
    return {
      site,
      note: `reordered arrays at ${site}`,
      apply: () => {
        for (const s of group) {
          const arr = s.value as unknown[];
          const before = canonicalJson(arr);
          const idx = arr.map((_, i) => i);
          for (let i = idx.length - 1; i > 0; i--) {
            const j = pick(r, i + 1);
            [idx[i], idx[j]] = [idx[j] as number, idx[i] as number];
          }
          let next = idx.map((i) => arr[i]);
          if (canonicalJson(next) === before) next = [...arr.slice(1), arr[0]];
          arr.splice(0, arr.length, ...next);
        }
        return group.length;
      },
    };
  },
  B2: (_root, all, r) => {
    const g = drawGroup(groupByNorm(all.filter((s) => isRecord(s.value))), r);
    if (!g) return null;
    const [site, group] = g;
    const key = `fiks_extra_${hex8(r).slice(0, 4)}`;
    const value = hex8(r);
    return {
      site,
      note: `added ${key} at ${site}`,
      apply: () => {
        for (const s of group) (s.value as Record<string, unknown>)[key] = value;
        return group.length;
      },
    };
  },
  B3: (_root, _all, r) => {
    const indents = [' ', '  ', '   ', '    ', '\t'];
    const indent = indents[pick(r, indents.length)] as string;
    const newline = r() < 0.5 ? '\n' : '';
    return {
      site: '$',
      note: `re-serialized with indent ${JSON.stringify(indent)}${newline ? ' and a trailing newline' : ''}`,
      apply: () => 0,
      body: (json) => JSON.stringify(json, null, indent) + newline,
    };
  },
  B4: (_root, _all, r) => {
    const name = `x-fiks-benign-${hex8(r).slice(0, 4)}`;
    return {
      site: null,
      note: `added header ${name}`,
      apply: () => 0,
      addHeaders: { [name]: hex8(r) },
    };
  },
};

/**
 * Applies response operator `op` to a parsed JSON body. Pure: the input is not modified, and the
 * same (op, json, seed, ctx) always gives the same result.
 */
export function mutateResponse(
  op: ResponseOperator,
  json: unknown,
  seed: number | string,
  ctx: ResponseContext = {},
): ResponseMutation {
  if (!isResponseOperator(op)) throw new Error(`unknown response operator ${JSON.stringify(op)}`);
  if (json === undefined) throw new Error('mutateResponse: json is undefined');
  const root = deepClone(json);
  const r = rng(op, seed);
  const plan = PLANNERS[op](root, slots(root), r, ctx);
  const seedStr = String(seed);
  if (!plan) {
    return {
      op,
      seed: seedStr,
      applicable: false,
      site: null,
      changed: 0,
      json: deepClone(json),
      body: JSON.stringify(json),
      note: 'no eligible site',
    };
  }
  const changed = plan.apply();
  const out = plan.replaceRoot !== undefined && plan.status !== undefined ? plan.replaceRoot : root;
  const result: ResponseMutation = {
    op,
    seed: seedStr,
    applicable: true,
    site: plan.site,
    changed,
    json: out,
    body: plan.body ? plan.body(out) : JSON.stringify(out),
    note: plan.note,
  };
  if (plan.status !== undefined) result.status = plan.status;
  if (plan.addHeaders) result.addHeaders = plan.addHeaders;
  return result;
}

/** A recorded upstream response (the `response` of @fiks/contracts' HttpExchange). */
export interface RecordedResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface RecordedMutation {
  response: RecordedResponse;
  mutation: ResponseMutation;
}

/**
 * Applies `op` to a recorded response: parses the body, mutates it, and returns the response to
 * replay. The recorded body bytes are kept when the operator leaves the body unchanged (B4, or no
 * eligible site). A body that is not JSON admits only B4.
 */
export function mutateRecordedResponse(
  op: ResponseOperator,
  response: RecordedResponse,
  seed: number | string,
  request?: { method?: string },
): RecordedMutation {
  let json: unknown;
  let parsed = true;
  try {
    json = JSON.parse(response.body);
  } catch {
    parsed = false;
  }
  if (!parsed && op !== 'B4') {
    return {
      response: { ...response, headers: { ...response.headers } },
      mutation: {
        op,
        seed: String(seed),
        applicable: false,
        site: null,
        changed: 0,
        json: null,
        body: response.body,
        note: 'body is not JSON',
      },
    };
  }
  const m = mutateResponse(op, parsed ? json : null, seed, request?.method ? { method: request.method } : {});
  const bodyChanged = m.applicable && op !== 'B4';
  const headers = { ...response.headers, ...(m.addHeaders ?? {}) };
  const body = bodyChanged ? m.body : response.body;
  if (bodyChanged && 'content-length' in headers) headers['content-length'] = String(Buffer.byteLength(body));
  return {
    response: { status: m.status ?? response.status, headers, body },
    mutation: { ...m, body },
  };
}

/** sha256 of what a mutation sends upstream; equal hashes mean byte-identical replays. */
export function mutationHash(m: ResponseMutation): string {
  return sha256(
    canonicalJson({
      op: m.op,
      seed: m.seed,
      applicable: m.applicable,
      site: m.site,
      body: m.body,
      status: m.status ?? null,
      addHeaders: m.addHeaders ?? null,
    }),
  );
}
