// A minimal recording chain for authoring inputs and validity checks: vendor v1 (frozen clock)
// <- [injector rule] <- HTTP tap <- MCP server (stdio, from a checkout) <- MCP client. No contract
// is evaluated while recording (the `--monitor none` form); evaluation happens afterwards.
import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { HttpExchange, ToolContract, ToolResultLike } from '@fiks/contracts';
import { buildProbeArgs, type ContractFile, findContract } from '@fiks/contracts';
import { startInjector } from '@fiks/injector';
import type { CallRecord, Catalog, Domain, EnumRow } from '@fiks/interfaces';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { canonicalJson, seededRng, shuffle } from './rng.ts';

const DROP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'date', 'host']);
const REDACT = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization']);

function cleanHeaders(h: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(h).sort()) {
    const v = h[k];
    if (v === undefined || DROP.has(k)) continue;
    out[k] = REDACT.has(k) ? '[REDACTED]' : Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

interface Tap {
  url: string;
  take(): HttpExchange[];
  close(): Promise<void>;
}

async function startTap(target: string, clock: () => Date): Promise<Tap> {
  const base = new URL(target);
  let exchanges: HttpExchange[] = [];
  let seq = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const started = clock();
      const reqBody = chunks.length ? Buffer.concat(chunks) : null;
      const path = req.url ?? '/';
      const up = httpRequest(
        {
          protocol: base.protocol,
          hostname: base.hostname,
          port: base.port,
          method: req.method,
          path,
          headers: { ...req.headers, host: base.host, 'accept-encoding': 'identity' },
        },
        (upRes) => {
          const out: Buffer[] = [];
          upRes.on('data', (c: Buffer) => out.push(c));
          upRes.on('end', () => {
            const body = Buffer.concat(out);
            exchanges.push({
              seq: seq++,
              startedAt: started.toISOString(),
              durationMs: 0,
              request: {
                method: req.method ?? 'GET',
                url: path,
                headers: cleanHeaders(req.headers),
                body: reqBody ? reqBody.toString('utf8') : null,
              },
              response: {
                status: upRes.statusCode ?? 0,
                headers: cleanHeaders(upRes.headers),
                body: body.toString('utf8'),
              },
            });
            res.writeHead(upRes.statusCode ?? 502, upRes.headers);
            res.end(body);
          });
        },
      );
      up.on('error', (e) => {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'tap_upstream_error', message: e.message }));
      });
      if (reqBody) up.write(reqBody);
      up.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    take() {
      const out = exchanges;
      exchanges = [];
      return out;
    },
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

/** One recorded call, before labelling. */
export interface RecordedCall {
  tool: string;
  args: Record<string, unknown>;
  output: ToolResultLike;
  upstream: HttpExchange[];
  capturedAt: string;
}

export interface ChainOptions {
  domain: Domain;
  /** Checkout of the MCP server (needs node_modules). Default: the domain's repo dir. */
  repoDir?: string;
  catalog?: Catalog;
  /** An injector rule file applied in front of the vendor. */
  rulePath?: string;
  /** ISO instant; default the domain's frozen clock. */
  clock?: string;
}

export interface Chain {
  vendorUrl: string;
  /** URL the server talks to (the tap). */
  upstreamUrl: string;
  /** URL in front of the vendor (the injector when a rule is set, else the vendor). */
  frontUrl: string;
  call(tool: string, args: Record<string, unknown>): Promise<RecordedCall>;
  listTools(): Promise<ToolInfo[]>;
  close(): Promise<void>;
}

export async function startChain(opts: ChainOptions): Promise<Chain> {
  const clockIso = opts.clock ?? opts.domain.frozenClock;
  const clock = () => new Date(clockIso);
  const vendor = opts.domain.createVendor(opts.catalog ?? 'original', { version: 'v1', now: clock });
  const vendorUrl = await vendor.listen();
  const closers: (() => Promise<void>)[] = [() => vendor.close()];
  try {
    let front = vendorUrl;
    if (opts.rulePath) {
      const inj = await startInjector({ target: vendorUrl, rule: opts.rulePath, clock: clockIso });
      closers.unshift(() => inj.close());
      front = inj.url;
    }
    const tap = await startTap(front, clock);
    closers.unshift(() => tap.close());
    const cmd = opts.domain.serverCommand(opts.repoDir ?? opts.domain.repo.dir());
    const client = new Client({ name: 'blind-recorder', version: '0.1.0' });
    await client.connect(
      new StdioClientTransport({
        command: cmd.command,
        args: cmd.args,
        cwd: cmd.cwd,
        env: { ...getDefaultEnvironment(), [opts.domain.baseUrlEnv]: tap.url },
        stderr: 'pipe',
      }),
    );
    closers.unshift(() => client.close());
    return {
      vendorUrl,
      upstreamUrl: tap.url,
      frontUrl: front,
      async call(tool, args) {
        tap.take();
        const output = (await client.callTool({ name: tool, arguments: args })) as ToolResultLike;
        return { tool, args, output, upstream: tap.take(), capturedAt: clockIso };
      },
      async listTools() {
        const { tools } = await client.listTools();
        return tools.map((t) => ({
          name: t.name,
          ...(t.description !== undefined ? { description: t.description } : {}),
          inputSchema: t.inputSchema,
          ...(t.outputSchema !== undefined ? { outputSchema: t.outputSchema } : {}),
        }));
      },
      async close() {
        for (const c of closers) await c();
      },
    };
  } catch (e) {
    for (const c of closers) await c().catch(() => undefined);
    throw e;
  }
}

/**
 * `n` enumerated original-catalog rows, round-robin over the tools (sorted by name) after a seeded
 * shuffle of each tool's rows: deterministic for a (domain, seed, label).
 */
export function selectRows(domain: Domain, n: number, seed: string | number, label: string): EnumRow[] {
  const rows = domain.enumerate({ catalog: 'original', seed });
  const byTool = new Map<string, EnumRow[]>();
  for (const r of rows) byTool.set(r.tool, [...(byTool.get(r.tool) ?? []), r]);
  const tools = [...byTool.keys()].sort();
  const queues = tools.map((t) => shuffle(byTool.get(t) as EnumRow[], seededRng(seed, `${label}:${t}`)));
  const out: EnumRow[] = [];
  const seen = new Set<string>();
  for (let round = 0; out.length < n; round++) {
    let any = false;
    for (const q of queues) {
      const r = q[round];
      if (!r) continue;
      any = true;
      if (seen.has(r.dedupeKey)) continue;
      seen.add(r.dedupeKey);
      out.push(r);
      if (out.length === n) break;
    }
    if (!any) throw new Error(`${domain.id}: only ${out.length} distinct rows, ${n} requested`);
  }
  return out;
}

/** Records rows in order through one fresh chain. */
export async function recordRows(
  chain: ChainOptions,
  rows: { tool: string; args: Record<string, unknown> }[],
) {
  const c = await startChain(chain);
  try {
    const out: RecordedCall[] = [];
    for (const r of rows) out.push(await c.call(r.tool, r.args));
    return { calls: out, tools: await c.listTools() };
  } finally {
    await c.close();
  }
}

/** The Appendix CallRecord of a recorded call (record-only: no contract was evaluated). */
export function toCallRecord(
  domain: Domain,
  rec: RecordedCall,
  extra: { callId: string; stratum: string; catalog?: Catalog },
): CallRecord {
  const call = { tool: rec.tool, args: rec.args, output: rec.output };
  return {
    callId: extra.callId,
    domain: domain.id,
    stratum: extra.stratum,
    catalog: extra.catalog ?? 'original',
    drift: null,
    mutant: null,
    tool: rec.tool,
    args: rec.args,
    upstream: rec.upstream.map((x) => ({ request: x.request, response: x.response })),
    output: rec.output,
    events: [],
    entityClass: domain.entityClass(call),
    originUnit: domain.originEntity(call),
    capturedAt: rec.capturedAt,
    controlOf: null,
  };
}

/** What an author sees for one call: the tool, its arguments, the raw upstream exchanges, the result. */
export function authorView(rec: RecordedCall): Record<string, unknown> {
  return {
    tool: rec.tool,
    args: rec.args,
    upstream: rec.upstream.map((x) => ({ request: x.request, response: x.response })),
    result: rec.output,
  };
}

export type Probe = {
  tool: string;
  args: Record<string, unknown>;
  result: ToolResultLike;
  upstream: HttpExchange[];
};

/**
 * Re-runs `calls` in order on a fresh chain and, after each call whose contract declares a
 * read-after-write postcondition, runs the probe as the proxy would. Returns the probe per call
 * index and whether each replayed output equals the recorded one (determinism check).
 */
export async function replayWithProbes(
  chain: ChainOptions,
  calls: RecordedCall[],
  file: ContractFile,
): Promise<{ probes: (Probe | undefined)[]; sameOutput: boolean[] }> {
  const c = await startChain(chain);
  try {
    const probes: (Probe | undefined)[] = [];
    const sameOutput: boolean[] = [];
    for (const rec of calls) {
      const live = await c.call(rec.tool, rec.args);
      sameOutput.push(canonicalJson(live.output) === canonicalJson(rec.output));
      const contract: ToolContract | undefined = findContract(file, rec.tool);
      const post = contract?.postconditions?.[0];
      if (post && !live.output.isError && live.output.structuredContent) {
        const args = buildProbeArgs(post, live.output.structuredContent);
        const p = await c.call(post.probeTool, args);
        probes.push({ tool: post.probeTool, args, result: p.output, upstream: p.upstream });
      } else probes.push(undefined);
    }
    return { probes, sameOutput };
  } finally {
    await c.close();
  }
}
