// Strict-format trace (P3, used only in E6). A Dual-LLM-style quarantine without the second model:
// the agent never sees vendor free text, only a typed view of the trace. Field paths are
// constrained to FIELD_PATH_RE, string values survive only in a closed set of machine formats
// (dates, ids, numbers, short identifiers), everything else becomes {type, length, hash}.
import { createHash } from 'node:crypto';
import type { HttpExchange, Recording } from '@fiks/contracts';
import type { TraceFormat } from '@fiks/interfaces';
import { scrubPaths } from './pr.ts';

/** Every field path in a strict trace matches this (gap-repair-security H-S2). */
export const FIELD_PATH_RE = /^[A-Za-z_][\w.[\]]{0,63}$/;
/** Rendered strict traces are capped at 64 KB. */
export const STRICT_MAX_BYTES = 64 * 1024;

export function parseTraceFormat(s: string | undefined): TraceFormat {
  if (s === undefined || s === '' || s === 'raw') return 'raw';
  if (s === 'strict') return 'strict';
  throw new Error(`--trace-format must be raw or strict, got ${JSON.stringify(s)}`);
}

/**
 * Hidden Unicode: C0/C1 controls (except tab and newline), zero-width and joiner characters,
 * bidi embeddings/overrides/isolates, the BOM, tag characters and variation selectors.
 */
const HIDDEN_RANGES: [number, number][] = [
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x61c, 0x61c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xe0000, 0xe01ef],
];
const isHidden = (cp: number) => HIDDEN_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences.
const ANSI_RE = /\u001B\[[0-9;?]*[ -/]*[@-~]|\u001B[@-Z\\-_]/g;

export const stripHidden = (s: string) =>
  Array.from(s.replace(ANSI_RE, ''))
    .filter((c) => !isHidden(c.codePointAt(0) ?? 0))
    .join('');

const h8 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 8);

export type StringFormat =
  | 'iso-datetime'
  | 'iso-date'
  | 'uuid'
  | 'int'
  | 'decimal'
  | 'currency'
  | 'id'
  | 'ident'
  | 'empty'
  | 'text';

/** Formats whose value is kept verbatim: machine tokens that cannot carry an instruction. */
const STRING_FORMATS: [StringFormat, RegExp][] = [
  ['iso-datetime', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/],
  ['iso-date', /^\d{4}-\d{2}-\d{2}$/],
  ['uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i],
  ['int', /^-?\d{1,18}$/],
  ['decimal', /^-?\d{1,15}\.\d{1,8}$/],
  ['currency', /^[A-Z]{3}$/],
  ['id', /^[A-Za-z]{1,8}[-_]?\d{1,12}$/],
  // A short identifier (enum value, status): at most 24 chars, no spaces or punctuation.
  ['ident', /^[A-Za-z][A-Za-z0-9]{0,23}$|^[A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+){1,3}$/],
];

export type StrictValue =
  | { t: 'null' }
  | { t: 'bool'; v: boolean }
  | { t: 'num'; v: number }
  | { t: 'str'; fmt: StringFormat; len: number; v?: string; h?: string }
  | { t: 'obj'; n: number }
  | { t: 'arr'; n: number };

export function typeString(s: string): Extract<StrictValue, { t: 'str' }> {
  if (s === '') return { t: 'str', fmt: 'empty', len: 0 };
  for (const [fmt, re] of STRING_FORMATS) {
    if ((fmt !== 'ident' || s.length <= 24) && re.test(s)) return { t: 'str', fmt, len: s.length, v: s };
  }
  return { t: 'str', fmt: 'text', len: s.length, h: h8(s) };
}

export function typeValue(v: unknown): StrictValue {
  if (v === null || v === undefined) return { t: 'null' };
  if (typeof v === 'boolean') return { t: 'bool', v };
  if (typeof v === 'number') return Number.isFinite(v) ? { t: 'num', v } : { t: 'null' };
  if (typeof v === 'string') return typeString(v);
  if (Array.isArray(v)) return { t: 'arr', n: v.length };
  if (typeof v === 'object') return { t: 'obj', n: Object.keys(v).length };
  return { t: 'null' };
}

const KEY_RE = /^[A-Za-z_]\w{0,31}$/;
/** A vendor-controlled key as a path segment: kept if it is a plain identifier, else hashed. */
export function safeKey(k: string): string {
  const dashed = k.replace(/-/g, '_');
  return KEY_RE.test(dashed) ? dashed : `_k${h8(k)}`;
}

/** Joins path segments and enforces FIELD_PATH_RE (long paths keep a hash prefix and their tail). */
export function fieldPath(prefix: string, seg: string): string {
  const p = !prefix ? seg : seg.startsWith('[') ? `${prefix}${seg}` : `${prefix}.${seg}`;
  if (FIELD_PATH_RE.test(p)) return p;
  const tail = p.slice(-50).replace(/^[^A-Za-z_]+/, '');
  const out = `_p${h8(p)}.${tail}`.slice(0, 64);
  return FIELD_PATH_RE.test(out) ? out : `_p${h8(p)}`;
}

export interface StrictLeaf {
  path: string;
  value: StrictValue;
}

/** Arrays longer than this keep their length and the first ARRAY_SAMPLE elements. */
const ARRAY_SAMPLE = 3;

export function flatten(v: unknown, prefix: string, out: StrictLeaf[] = [], depth = 0): StrictLeaf[] {
  const value = typeValue(v);
  if (value.t === 'obj' && depth < 12) {
    if (prefix) out.push({ path: prefix, value });
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      flatten(x, fieldPath(prefix, safeKey(k)), out, depth + 1);
    }
  } else if (value.t === 'arr' && depth < 12) {
    if (prefix) out.push({ path: prefix, value });
    (v as unknown[]).slice(0, ARRAY_SAMPLE).forEach((x, i) => {
      flatten(x, fieldPath(prefix, `[${i}]`), out, depth + 1);
    });
  } else if (prefix) {
    out.push({ path: prefix, value });
  }
  return out;
}

/** A body: JSON is flattened; anything else is one opaque text leaf. */
function bodyLeaves(body: string | null | undefined, prefix: string): StrictLeaf[] {
  if (body === null || body === undefined || body === '') return [];
  try {
    return flatten(JSON.parse(body), prefix);
  } catch {
    return [{ path: prefix, value: { t: 'str', fmt: 'text', len: body.length, h: h8(body) } }];
  }
}

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** URL path + query rebuilt from typed tokens only. */
export function strictUrl(url: string): string {
  const [path = '', query = ''] = url.split('?', 2);
  const seg = (s: string) => {
    let d = s;
    try {
      d = decodeURIComponent(s);
    } catch {}
    const t = typeString(d);
    if (t.v !== undefined) return t.v;
    return /^[a-z][a-z0-9_-]{0,31}$/.test(d) ? d : `{text:${t.len}:${t.h ?? ''}}`;
  };
  const p = path
    .split('/')
    .map((s) => (s === '' ? '' : seg(s)))
    .join('/');
  const q = query
    ? `?${query
        .split('&')
        .filter(Boolean)
        .map((kv) => {
          const [k = '', v = ''] = kv.split('=', 2);
          return `${safeKey(k)}=${v === '' ? '' : seg(v)}`;
        })
        .join('&')}`
    : '';
  return `${p}${q}`;
}

function headerLeaves(h: Record<string, string> | undefined, prefix: string): StrictLeaf[] {
  return Object.entries(h ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({ path: fieldPath(prefix, safeKey(k.toLowerCase())), value: typeString(String(v)) }));
}

export interface StrictExchange {
  method: string;
  url: string;
  status: number;
  request: { headers: StrictLeaf[]; body: StrictLeaf[] };
  response: { headers: StrictLeaf[]; body: StrictLeaf[] };
}

export interface StrictDiffEntry {
  path: string;
  op: 'added' | 'removed' | 'changed';
  before?: StrictValue;
  after?: StrictValue;
}

export interface StrictTrace {
  format: 'fiks-strict-trace/1';
  tool: string;
  args: StrictLeaf[];
  /** Violated contract property ids (fiks-owned identifiers, validated). */
  violated: string[];
  target: string[];
  exchanges: StrictExchange[];
  probe?: { tool: string; args: StrictLeaf[]; exchanges: StrictExchange[] };
  /** The tool's structured output as the server returned it. */
  output: StrictLeaf[];
  /** Typed difference against the baseline recording of the same call (v1), when given. */
  diff?: StrictDiffEntry[];
  truncated: boolean;
}

const PROPERTY_ID_RE = /^[A-Za-z_][\w.-]{0,63}\/[A-Za-z_][\w.-]{0,63}$/;
const TOOL_RE = /^[A-Za-z_][\w-]{0,63}$/;

function exchanges(http: Pick<HttpExchange, 'request' | 'response'>[] | undefined): StrictExchange[] {
  return (http ?? []).map((e, i) => ({
    method: METHODS.has(e.request.method.toUpperCase()) ? e.request.method.toUpperCase() : 'OTHER',
    url: strictUrl(e.request.url),
    status: Number.isInteger(e.response.status) ? e.response.status : 0,
    request: {
      headers: headerLeaves(e.request.headers, `http[${i}].request.headers`),
      body: bodyLeaves(e.request.body, `http[${i}].request.body`),
    },
    response: {
      headers: headerLeaves(e.response.headers, `http[${i}].response.headers`),
      body: bodyLeaves(e.response.body, `http[${i}].response.body`),
    },
  }));
}

function outputLeaves(rec: Pick<Recording, 'result'>): StrictLeaf[] {
  const r = rec.result as { structuredContent?: unknown; isError?: boolean } | undefined;
  if (!r) return [];
  return [
    { path: 'output.isError', value: typeValue(r.isError ?? false) },
    ...(r.structuredContent === undefined ? [] : flatten(r.structuredContent, 'output.structured')),
  ];
}

const sig = (v: StrictValue) => JSON.stringify(v);

/** Typed diff between two leaf lists (same paths compared by type, format and kept value or hash). */
export function diffLeaves(before: StrictLeaf[], after: StrictLeaf[]): StrictDiffEntry[] {
  const a = new Map(before.map((l) => [l.path, l.value]));
  const b = new Map(after.map((l) => [l.path, l.value]));
  const out: StrictDiffEntry[] = [];
  for (const [path, v] of b) {
    const old = a.get(path);
    if (old === undefined) out.push({ path, op: 'added', after: v });
    else if (sig(old) !== sig(v)) out.push({ path, op: 'changed', before: old, after: v });
  }
  for (const [path, v] of a) if (!b.has(path)) out.push({ path, op: 'removed', before: v });
  return out;
}

const allLeaves = (x: { exchanges: StrictExchange[]; output: StrictLeaf[] }) => [
  ...x.exchanges.flatMap((e, i) => [
    { path: `http[${i}].status`, value: { t: 'num', v: e.status } as StrictValue },
    ...e.response.headers.filter((l) => !/\.(date|x_request_id|etag)$/.test(l.path)),
    ...e.response.body,
  ]),
  ...x.output,
];

/** The strict view of a trace. Pure: reads nothing but its arguments. */
export function strictTrace(
  trace: Recording & { target?: string[] },
  opts: { baseline?: Recording } = {},
): StrictTrace {
  const st: StrictTrace = {
    format: 'fiks-strict-trace/1',
    tool: TOOL_RE.test(trace.tool) ? trace.tool : `_t${h8(trace.tool)}`,
    args: flatten(trace.args, 'args'),
    violated: (trace.violated ?? []).map((v) => v.propertyId).filter((p) => PROPERTY_ID_RE.test(p)),
    target: (trace.target ?? []).filter((p) => PROPERTY_ID_RE.test(p)),
    exchanges: exchanges(trace.http),
    output: outputLeaves(trace),
    truncated: false,
  };
  if (trace.probe) {
    st.probe = {
      tool: TOOL_RE.test(trace.probe.tool) ? trace.probe.tool : `_t${h8(trace.probe.tool)}`,
      args: flatten(trace.probe.args, 'probe.args'),
      exchanges: exchanges(trace.probe.http),
    };
  }
  if (opts.baseline) {
    const base = { exchanges: exchanges(opts.baseline.http), output: outputLeaves(opts.baseline) };
    st.diff = diffLeaves(allLeaves(base), allLeaves(st));
  }
  return st;
}

/** JSON of a strict trace, capped at `maxBytes` by sampling down leaf lists (never cut mid-token). */
export function renderStrictTrace(st: StrictTrace, maxBytes = STRICT_MAX_BYTES): string {
  let out = JSON.stringify(st, null, 1);
  for (let keep = 256; Buffer.byteLength(out) > maxBytes && keep >= 1; keep = Math.floor(keep / 2)) {
    const cut = <T>(xs: T[]) => xs.slice(0, keep);
    const ex = (e: StrictExchange): StrictExchange => ({
      ...e,
      request: { headers: cut(e.request.headers), body: cut(e.request.body) },
      response: { headers: cut(e.response.headers), body: cut(e.response.body) },
    });
    const small: StrictTrace = {
      ...st,
      args: cut(st.args),
      exchanges: cut(st.exchanges).map(ex),
      output: cut(st.output),
      ...(st.probe ? { probe: { ...st.probe, exchanges: cut(st.probe.exchanges).map(ex) } } : {}),
      ...(st.diff ? { diff: cut(st.diff) } : {}),
      truncated: true,
    };
    out = JSON.stringify(small, null, 1);
  }
  if (Buffer.byteLength(out) > maxBytes) {
    out = JSON.stringify({ format: st.format, tool: st.tool, violated: st.violated, truncated: true });
  }
  return out;
}

/**
 * Gate output (test runner, typecheck, lint) before it reaches the agent or a prompt. Always:
 * ANSI escapes and hidden Unicode stripped, local paths scrubbed. Strict: every quoted literal
 * that is not a machine token becomes <text len=N>, non-ASCII is dropped, lines are cut at 240
 * characters and the whole at `maxBytes`.
 */
export function sanitizeGateOutput(
  text: string,
  opts: { traceFormat?: TraceFormat; maxBytes?: number } = {},
): string {
  let s = scrubPaths(stripHidden(text));
  if (opts.traceFormat === 'strict') {
    const lit = (q: string, body: string) => {
      const t = typeString(body);
      return t.v !== undefined || body === '' ? `${q}${body}${q}` : `<text len=${body.length}>`;
    };
    s = s
      // Left to right, whichever quote opens first, so "don't" inside a double-quoted string pairs right.
      .replace(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g, (_, q: string, b: string) => lit(q, b))
      // biome-ignore lint/suspicious/noControlCharactersInRegex: keep printable ASCII, tab and newline.
      .replace(/[^\u0009\u000A -~]+/g, '')
      .split('\n')
      .map((l) => (l.length > 240 ? `${l.slice(0, 240)} <cut ${l.length - 240}>` : l))
      .join('\n');
  }
  const max = opts.maxBytes ?? (opts.traceFormat === 'strict' ? 16 * 1024 : 256 * 1024);
  return s.length > max ? `${s.slice(0, max)}\n<output cut at ${max} bytes>` : s;
}
