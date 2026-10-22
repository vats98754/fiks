// Request matching for replay. With no configuration the key is exactly the strict key of the
// shop-mcp harness (test/fiks/replay.ts): method, path+query, body and the set of significant
// header names. Real servers send nonces, timestamps and token refreshes, so a replay can name
// normalisers that rewrite those parts of a request (recorded and live alike) before keying.

/** Headers every HTTP client sends on its own; they never make two requests different. */
export const INCIDENTAL =
  /^(accept|accept-.*|user-agent|sec-.*|connection|keep-alive|host|content-length|transfer-encoding|date)$/;

/** Headers a CONNECT/forward proxy adds or that only describe the proxy hop. */
const PROXY_HOP = /^(proxy-.*|via|forwarded|x-forwarded-.*)$/;

export const NONCE = '<nonce>';
export const TIMESTAMP = '<timestamp>';

export type Normaliser =
  /** Values that differ on every request (request ids, idempotency keys, OAuth nonces). */
  | { kind: 'nonce'; query?: string[]; body?: string[] }
  /**
   * Time-dependent values. `query`/`body` name the fields; `auto` also replaces every query value
   * and JSON or form leaf that looks like ISO-8601 or epoch seconds/milliseconds.
   */
  | { kind: 'timestamp'; query?: string[]; body?: string[]; auto?: boolean }
  /**
   * Token (re)fetches: requests with this method and a path matching `path` (regex source,
   * path only, no query) match the recorded token exchange whatever their body or query, and that
   * exchange can answer any number of times (a server may refresh more or less often in replay).
   */
  | { kind: 'authRefresh'; path: string; method?: string }
  /** Free-form rewrite of the url (path+query) or the raw body. */
  | { kind: 'pattern'; in: 'url' | 'body'; pattern: string; flags?: string; replace: string };

export interface MatcherConfig {
  normalisers?: Normaliser[];
  /** More header names that never make two requests different (e.g. `x-request-id`). */
  ignoreHeaders?: string[];
  /** Header names whose value must match too (e.g. an API version header). */
  headerValues?: string[];
}

export interface RequestLike {
  method: string;
  /** path + query, relative to the upstream base. */
  url: string;
  headers: Record<string, unknown>;
  body: string | null;
}

export interface MatchKey {
  key: string;
  /** The recorded exchange may answer this request more than once. */
  reusable: boolean;
}

const lower = (xs: string[] | undefined) => new Set((xs ?? []).map((x) => x.toLowerCase()));

export function significantHeaderNames(headers: Record<string, unknown>, config: MatcherConfig = {}): string {
  const ignore = lower(config.ignoreHeaders);
  return Object.keys(headers)
    .map((h) => h.toLowerCase())
    .filter((h) => !INCIDENTAL.test(h) && !PROXY_HOP.test(h) && !ignore.has(h))
    .sort()
    .join(',');
}

/** The shop-mcp strict key, unchanged (no normalisers). */
export function strictRequestKey(
  method: string,
  url: string,
  body: string | null,
  headers: Record<string, unknown>,
): string {
  return `${method} ${url} body=${body ?? ''} headers=[${significantHeaderNames(headers)}]`;
}

const ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const EPOCH = /^1\d{9}(\d{3})?$/;

export function looksLikeTimestamp(v: unknown): boolean {
  if (typeof v === 'number') return Number.isInteger(v) && EPOCH.test(String(v));
  return typeof v === 'string' && (ISO.test(v) || EPOCH.test(v));
}

/** Calls `fn` on every value at a dotted path with `[*]` wildcards; replaces it in place. */
function rewriteAt(root: unknown, path: string, fn: (v: unknown) => unknown): void {
  const segs = path.split('.');
  const walk = (node: unknown, i: number): void => {
    if (node === null || typeof node !== 'object') return;
    const seg = segs[i] as string;
    const wild = seg.endsWith('[*]');
    const key = wild ? seg.slice(0, -3) : seg;
    const obj = node as Record<string, unknown>;
    if (!(key in obj)) return;
    const last = i === segs.length - 1;
    if (wild) {
      const arr = obj[key];
      if (!Array.isArray(arr)) return;
      for (let j = 0; j < arr.length; j++) {
        if (last) arr[j] = fn(arr[j]);
        else walk(arr[j], i + 1);
      }
    } else if (last) obj[key] = fn(obj[key]);
    else walk(obj[key], i + 1);
  };
  walk(root, 0);
}

function rewriteLeaves(node: unknown, fn: (v: unknown) => unknown): unknown {
  if (Array.isArray(node)) return node.map((x) => rewriteLeaves(x, fn));
  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, rewriteLeaves(v, fn)]));
  }
  return fn(node);
}

type Body =
  | { kind: 'raw'; text: string | null }
  | { kind: 'json'; value: unknown }
  | { kind: 'form'; value: URLSearchParams };

function parseBody(text: string | null): Body {
  if (text === null || text === '') return { kind: 'raw', text };
  try {
    return { kind: 'json', value: JSON.parse(text) };
  } catch {
    if (/^[^=&\s]+=[^&\s]*(&[^=&\s]+=[^&\s]*)*$/.test(text)) {
      return { kind: 'form', value: new URLSearchParams(text) };
    }
    return { kind: 'raw', text };
  }
}

function serialiseBody(b: Body): string | null {
  if (b.kind === 'raw') return b.text;
  if (b.kind === 'json') return JSON.stringify(b.value);
  return b.value.toString();
}

function rewriteFields(b: Body, fields: string[] | undefined, placeholder: string): Body {
  if (!fields?.length) return b;
  if (b.kind === 'json') {
    for (const f of fields) rewriteAt(b.value, f, () => placeholder);
    return b;
  }
  if (b.kind === 'form') {
    for (const f of fields) if (b.value.has(f)) b.value.set(f, placeholder);
  }
  return b;
}

function splitUrl(url: string): { path: string; query: URLSearchParams | null } {
  const i = url.indexOf('?');
  return i === -1
    ? { path: url, query: null }
    : { path: url.slice(0, i), query: new URLSearchParams(url.slice(i + 1)) };
}

/** Rewrites a request with the configured normalisers. Pure; the same for recorded and live. */
export function normaliseRequest(
  req: RequestLike,
  config: MatcherConfig = {},
): RequestLike & { reusable: boolean } {
  const norms = config.normalisers ?? [];
  const method = req.method.toUpperCase();
  const { path } = splitUrl(req.url);
  const refresh = norms.find(
    (n): n is Extract<Normaliser, { kind: 'authRefresh' }> =>
      n.kind === 'authRefresh' &&
      (n.method ?? method).toUpperCase() === method &&
      new RegExp(n.path).test(path),
  );
  if (refresh) return { method, url: path, headers: req.headers, body: '<auth-refresh>', reusable: true };

  let url = req.url;
  let body: string | null = req.body;
  for (const n of norms) {
    if (n.kind === 'pattern') {
      const re = new RegExp(n.pattern, n.flags ?? 'g');
      if (n.in === 'url') url = url.replace(re, n.replace);
      else if (body !== null) body = body.replace(re, n.replace);
    }
  }
  const fieldNorms = norms.filter(
    (n): n is Extract<Normaliser, { kind: 'nonce' | 'timestamp' }> =>
      n.kind === 'nonce' || n.kind === 'timestamp',
  );
  if (fieldNorms.length) {
    const u = splitUrl(url);
    let b = parseBody(body);
    for (const n of fieldNorms) {
      const ph = n.kind === 'nonce' ? NONCE : TIMESTAMP;
      if (u.query) for (const q of n.query ?? []) if (u.query.has(q)) u.query.set(q, ph);
      b = rewriteFields(b, n.body, ph);
      if (n.kind === 'timestamp' && n.auto) {
        if (u.query) for (const [k, v] of [...u.query]) if (looksLikeTimestamp(v)) u.query.set(k, ph);
        if (b.kind === 'json')
          b = { kind: 'json', value: rewriteLeaves(b.value, (v) => (looksLikeTimestamp(v) ? ph : v)) };
        if (b.kind === 'form')
          for (const [k, v] of [...b.value]) if (looksLikeTimestamp(v)) b.value.set(k, ph);
      }
    }
    url = u.query ? `${u.path}?${u.query.toString()}` : u.path;
    body = serialiseBody(b);
  }
  return { method, url, headers: req.headers, body, reusable: false };
}

/** The replay key of a request under `config`; without config it is `strictRequestKey`. */
export function requestKey(req: RequestLike, config: MatcherConfig = {}): MatchKey {
  const n = normaliseRequest(req, config);
  let key = `${n.method} ${n.url} body=${n.body ?? ''} headers=[${significantHeaderNames(n.headers, config)}]`;
  const values = [...lower(config.headerValues)].sort();
  if (values.length) {
    const lc = Object.fromEntries(Object.entries(n.headers).map(([k, v]) => [k.toLowerCase(), v]));
    key += ` values=[${values.map((h) => `${h}=${String(lc[h] ?? '')}`).join(',')}]`;
  }
  return { key, reusable: n.reusable };
}
