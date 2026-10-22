// Dev drift tooling for TRK-DEV-1 (PLAN 5.1 "Build-phase dev drift"): the InjectorRule hash, a
// minimal rule-applying reverse proxy (the packages/injector transform contract, used here so the
// hidden-test data is produced "under the injector rule" before INJ is merged), the hidden-test
// renderer and the renamed-id mapping. Dev only; never part of a confirmatory run.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DriftPackage, InjectorRule } from '@fiks/interfaces';

/** JSON with object keys sorted at every level (the rule-hash input, as packages/injector). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/** sha256(canonical rule without `hash` + "\n" + transform module bytes) (packages/injector ruleHash). */
export function ruleHash(rule: Omit<InjectorRule, 'hash'>, transformPath: string): string {
  const body = canonicalJson({
    id: rule.id,
    domain: rule.domain,
    match: { method: rule.match.method, pathPattern: rule.match.pathPattern },
    transform: rule.transform,
    clockFrozen: rule.clockFrozen,
  });
  return sha256(Buffer.concat([Buffer.from(`${body}\n`), readFileSync(transformPath)]));
}

export interface LoadedRule extends InjectorRule {
  file: string;
  transformPath: string;
}

export function readRule(file: string): LoadedRule {
  const rule = JSON.parse(readFileSync(file, 'utf8')) as InjectorRule;
  const transformPath = isAbsolute(rule.transform) ? rule.transform : resolve(dirname(file), rule.transform);
  return { ...rule, file, transformPath };
}

export interface DevDriftPackage extends DriftPackage {
  /** Absolute directory of the manifest (paths inside it are relative to it). */
  dir: string;
}

export function readDriftPackage(file: string): DevDriftPackage {
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as DriftPackage;
  return { ...pkg, dir: dirname(resolve(file)) };
}

interface TransformRes {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface Transform {
  description: string;
  setHeaders?: Record<string, string>;
  response(
    req: {
      method: string;
      path: string;
      query: URLSearchParams;
      headers: Record<string, string | undefined>;
      body: string;
    },
    res: TransformRes,
    ctx: { now(): Date; state: Map<string, unknown> },
  ): TransformRes | undefined;
}

const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'date', 'host']);

/**
 * Applies `rule` in front of `target` (a minimal injector: forward, then rewrite matched responses
 * with the transform, then set `setHeaders` on every response). Refuses a rule whose hash differs.
 */
export async function startRuleProxy(
  target: string,
  rule: LoadedRule,
  clock: string,
): Promise<{ url: string; close(): Promise<void> }> {
  const want = ruleHash(rule, rule.transformPath);
  if (rule.hash !== want) throw new Error(`rule ${rule.id}: stored hash ${rule.hash} != computed ${want}`);
  const mod = (await import(pathToFileURL(rule.transformPath).href)) as { default: Transform };
  const t = mod.default;
  const methods = rule.match.method === '*' ? null : new Set(rule.match.method.split('|'));
  const re = new RegExp(rule.match.pathPattern);
  const base = new URL(target);
  const ctx = { now: () => new Date(clock), state: new Map<string, unknown>() };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers))
        if (v !== undefined && !HOP.has(k)) headers[k] = String(v);
      if (body.length) headers['content-length'] = String(body.length);
      const up = httpRequest(
        {
          hostname: base.hostname,
          port: base.port,
          method: req.method,
          path: req.url,
          headers,
          agent: false,
        },
        (upRes) => {
          const out: Buffer[] = [];
          upRes.on('data', (c: Buffer) => out.push(c));
          upRes.on('end', () => {
            const h: Record<string, string> = {};
            for (const [k, v] of Object.entries(upRes.headers)) {
              if (v !== undefined && !HOP.has(k)) h[k] = Array.isArray(v) ? v.join(', ') : v;
            }
            let r: TransformRes = {
              status: upRes.statusCode ?? 502,
              headers: h,
              body: Buffer.concat(out).toString('utf8'),
            };
            const url = new URL(req.url ?? '/', 'http://injector.local');
            const method = req.method ?? 'GET';
            if ((methods === null || methods.has(method)) && re.test(url.pathname)) {
              const reqView = {
                method,
                path: url.pathname,
                query: url.searchParams,
                headers: req.headers as Record<string, string | undefined>,
                body: body.toString('utf8'),
              };
              r = t.response(reqView, r, ctx) ?? r;
            }
            r = { ...r, headers: { ...r.headers, ...(t.setHeaders ?? {}) } };
            res.writeHead(r.status, r.headers);
            res.end(r.body);
          });
        },
      );
      up.on('error', (e) => {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'injector_upstream_error', message: e.message }));
      });
      up.end(body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

// --- Hidden tests ------------------------------------------------------------------------------

/** One upstream response a hidden test's stub serves (matched by method and path, in order). */
export interface HiddenExchange {
  method: string;
  path: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface HiddenStep {
  tool: string;
  args: Record<string, unknown>;
  /** The tool's structured output on a correct server (from v1 ground truth, truth()). */
  expected: unknown;
}

export interface HiddenCase {
  /** File name stem, e.g. `comments-other-issue`. */
  slug: string;
  title: string;
  /** What the case checks, in one line (a PLAN 3.0 manifestation). */
  manifestation: string;
  /** `drifted`: vendor v1 + the rule; `v1`: vendor v1 alone (v1 behaviour preserved). */
  upstream: 'drifted' | 'v1';
  exchanges: HiddenExchange[];
  steps: HiddenStep[];
}

/** Renames every issue key (`TRK-<n>` -> `TRK-9<n>`) and comment id (`cm-<n>` -> `cm-9<n>`). */
export function renameIds(text: string): string {
  return text.replace(/\b(TRK-|cm-)(\d+)\b/g, (_m, p: string, n: string) => `${p}9${n}`);
}

export function renamedCase(c: HiddenCase): HiddenCase {
  return JSON.parse(renameIds(JSON.stringify(c))) as HiddenCase;
}

const tsString = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** A self-contained vitest file for tracker-mcp `test/hidden/` (imports only src/ and vitest). */
export function renderHiddenTest(driftId: string, c: HiddenCase, variant: 'hidden' | 'renamed-id'): string {
  return `// Hidden test for ${driftId} (fiks dev DriftPackage; ${variant}): ${c.title}
// Manifestation: ${c.manifestation}
// Generated by fiks packages/vendor-tracker/src/build-trk-dev-1.ts: upstream responses recorded from
// tracker vendor v1${c.upstream === 'drifted' ? ` behind the ${driftId} injector rule` : ''} under the frozen clock; expected outputs from
// v1 ground truth. Self-contained: copy into <tracker-mcp>/test/hidden/ and run with vitest.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { expect, test } from 'vitest';
import * as tools from '../../src/tools/handlers.ts';
import { createVendorClient } from '../../src/vendor.ts';

interface Exchange {
  method: string;
  path: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface Step {
  tool: string;
  args: Record<string, unknown>;
  expected: unknown;
}

const UPSTREAM: Exchange[] = ${JSON.stringify(c.exchanges, null, 2)};

const STEPS: Step[] = ${JSON.stringify(c.steps, null, 2)};

type Tool = { name: string; handler(args: never, vendor: ReturnType<typeof createVendorClient>): Promise<CallToolResult> };
const TOOLS = new Map((Object.values(tools) as unknown as Tool[]).map((t) => [t.name, t]));

/** Serves each recorded response once, matched by method and path (query and headers ignored). */
async function serve(exchanges: Exchange[]) {
  const pending = [...exchanges];
  const unmatched: string[] = [];
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const path = new URL(req.url ?? '/', 'http://upstream.local').pathname;
      const i = pending.findIndex((e) => e.method === req.method && e.path === path);
      if (i === -1) {
        unmatched.push(\`\${req.method} \${req.url}\`);
        res.writeHead(599, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'UNMATCHED_REQUEST' }));
        return;
      }
      const [e] = pending.splice(i, 1) as [Exchange];
      res.writeHead(e.status, e.headers);
      res.end(e.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = \`http://127.0.0.1:\${(server.address() as AddressInfo).port}\`;
  const close = () =>
    new Promise<void>((r) => {
      server.closeAllConnections();
      server.close(() => r());
    });
  return { url, unmatched, close };
}

test(${tsString(`[${driftId} ${variant}] ${c.title}`)}, async () => {
  const upstream = await serve(UPSTREAM);
  try {
    const vendor = createVendorClient(upstream.url);
    for (const step of STEPS) {
      const tool = TOOLS.get(step.tool);
      if (!tool) throw new Error(\`unknown tool \${step.tool}\`);
      const result = await tool.handler(step.args as never, vendor);
      const text = (result.content as { text?: string }[] | undefined)?.map((x) => x.text).join(' ');
      expect(result.isError, \`\${step.tool} returned an error: \${text}\`).toBeFalsy();
      expect(result.structuredContent, \`\${step.tool}(\${JSON.stringify(step.args)})\`).toEqual(step.expected);
    }
    expect(upstream.unmatched, 'requests the recorded upstream never answered').toEqual([]);
  } finally {
    await upstream.close();
  }
});
`;
}
