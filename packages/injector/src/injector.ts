// The third-party injector: a deterministic reverse proxy (vendor -> injector -> tap) that applies
// one InjectorRule to upstream responses. It knows nothing about contracts or tools: it sees HTTP.
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { isAbsolute, resolve } from 'node:path';
import { type InjectorRule, type LoadedRule, loadTransform, matcher, readRule, ruleHash } from './rule.ts';
import type { InjectorRequest, InjectorResponse, InjectorTransform, TransformContext } from './transform.ts';

/** The clock used when a rule is `clockFrozen` and the caller passes none. */
export const DEFAULT_FROZEN_CLOCK = '2026-01-01T00:00:00.000Z';

export type ClockInput = string | Date | (() => Date);

export interface InjectorOptions {
  /** Base URL of the upstream (the vendor, or the next link of the chain). */
  target: string;
  /** A rule file path, a loaded rule, or a rule object (its transform resolved against `ruleDir`). */
  rule: string | LoadedRule | InjectorRule;
  /** Directory for a plain rule object's relative `transform` (default: cwd). */
  ruleDir?: string;
  /**
   * The frozen clock (the Domain's `frozenClock`). Used for transform `ctx.now()` and the `date`
   * response header when the rule is `clockFrozen`; ignored otherwise.
   */
  clock?: ClockInput;
  /** Refuse a rule whose stored hash differs from its computed hash (default true). */
  verifyHash?: boolean;
  /** Port to listen on (default 0 = any free port). */
  port?: number;
}

export interface Injector {
  /** Base URL of the injector, to be used where the target URL was. */
  url: string;
  rule: LoadedRule;
  close(): Promise<void>;
  /** Clears the transform's per-instance state (same as a restart, keeping the URL). */
  reset(): void;
  /** Requests seen: total and the ones that matched the rule. */
  stats(): { requests: number; matched: number };
}

/** A link in the harness's upstream chain (structurally the interfaces' `UpstreamMiddleware`). */
export interface InjectorMiddleware {
  name: string;
  start(target: string): Promise<{ url: string; close(): Promise<void> }>;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'content-length',
  'date',
]);

function toClock(input: ClockInput | undefined, frozen: boolean): () => Date {
  if (!frozen) return () => new Date();
  if (typeof input === 'function') return input;
  const at = input === undefined ? new Date(DEFAULT_FROZEN_CLOCK) : new Date(input);
  if (Number.isNaN(at.getTime())) throw new Error(`invalid frozen clock ${JSON.stringify(input)}`);
  return () => new Date(at.getTime());
}

function asLoaded(rule: InjectorOptions['rule'], ruleDir?: string): LoadedRule {
  if (typeof rule === 'string') return readRule(rule);
  if ('transformPath' in rule && typeof rule.transformPath === 'string') return rule as LoadedRule;
  const dir = ruleDir ?? process.cwd();
  const transformPath = isAbsolute(rule.transform) ? rule.transform : resolve(dir, rule.transform);
  return { ...rule, file: '', transformPath };
}

function flatHeaders(h: IncomingHttpHeaders): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(h)) out[k] = Array.isArray(v) ? v.join(', ') : v;
  return out;
}

function forward(
  target: URL,
  method: string,
  pathAndQuery: string,
  headers: IncomingHttpHeaders,
  body: Buffer,
): Promise<InjectorResponse> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || HOP_BY_HOP.has(k) || k === 'host') continue;
    out[k] = v;
  }
  if (body.length) out['content-length'] = String(body.length);
  const base = target.pathname.replace(/\/$/, '');
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        method,
        path: `${base}${pathAndQuery}`,
        headers: out,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const h: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v === undefined || HOP_BY_HOP.has(k)) continue;
            h[k] = Array.isArray(v) ? v.join(', ') : v;
          }
          resolve({
            status: res.statusCode ?? 502,
            headers: h,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** Starts the injector in front of `target`. The rule's hash is verified before listening. */
export async function startInjector(opts: InjectorOptions): Promise<Injector> {
  const rule = asLoaded(opts.rule, opts.ruleDir);
  if (opts.verifyHash !== false) {
    const want = ruleHash(rule, rule.transformPath);
    if (rule.hash !== want) {
      throw new Error(`injector rule ${rule.id}: stored hash ${rule.hash} != computed ${want}`);
    }
  }
  const transform: InjectorTransform = await loadTransform(rule.transformPath);
  const target = new URL(opts.target);
  if (target.protocol !== 'http:') throw new Error(`injector target must be http://, got ${opts.target}`);
  const matches = matcher(rule.match);
  const now = toClock(opts.clock, rule.clockFrozen);
  const ctx: TransformContext = { now, state: new Map() };
  let requests = 0;
  let matched = 0;

  const server: Server = createServer((req, res) => {
    // Under a frozen clock the `date` header comes from the clock, never from Node's wall clock.
    res.sendDate = !rule.clockFrozen;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const body = Buffer.concat(chunks);
        const method = (req.method ?? 'GET').toUpperCase();
        const url = new URL(req.url ?? '/', 'http://injector.local');
        requests++;
        let out: InjectorResponse;
        try {
          const upstream = await forward(target, method, `${url.pathname}${url.search}`, req.headers, body);
          out = upstream;
          if (matches(method, url.pathname)) {
            matched++;
            const ireq: InjectorRequest = {
              method,
              path: url.pathname,
              query: url.searchParams,
              headers: flatHeaders(req.headers),
              body: body.toString('utf8'),
            };
            out = transform.response(ireq, upstream, ctx) ?? upstream;
          }
          if (transform.setHeaders) out = { ...out, headers: { ...out.headers, ...transform.setHeaders } };
        } catch (e) {
          out = {
            status: 502,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ error: 'injector_upstream', message: `${rule.id}: ${String(e)}` }),
          };
        }
        const bytes = Buffer.from(out.body, 'utf8');
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(out.headers)) {
          if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k.toLowerCase()] = v;
        }
        if (rule.clockFrozen) headers.date = now().toUTCString();
        headers['content-length'] = String(bytes.length);
        res.writeHead(out.status, headers);
        res.end(bytes);
      })();
    });
  });

  const url = await new Promise<string>((resolve) => {
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });

  return {
    url,
    rule,
    reset: () => ctx.state.clear(),
    stats: () => ({ requests, matched }),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * The injector as a harness middleware (`UpstreamMiddleware`): each `start(target)` is a fresh
 * injector (fresh transform state), as `rerecord()` restarts it in the chain (P7).
 */
export function injectorMiddleware(
  rule: InjectorOptions['rule'],
  opts: Omit<InjectorOptions, 'target' | 'rule'> = {},
): InjectorMiddleware {
  const loaded = asLoaded(rule, opts.ruleDir);
  return {
    name: `injector:${loaded.id}`,
    start: async (target) => {
      const inj = await startInjector({ ...opts, target, rule: loaded });
      return { url: inj.url, close: inj.close };
    },
  };
}
