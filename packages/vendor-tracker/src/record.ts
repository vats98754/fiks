// Records tracker-mcp tool calls in the fiks recording format (the shape of shop-mcp's
// `test/fixtures/**` files): vendor v1 under a frozen clock <- [middleware] <- HTTP tap <-
// tracker-mcp (stdio, `trackerDomain.serverCommand`) <- MCP client. Used to write tracker-mcp's
// v1 fixtures, the 30 contract-author calls and the TRK-DEV-1 hidden-test data, and by tests that
// compare truth() with the server's output. Self-contained (imports only the CORE seed and the MCP
// SDK); the product harness lives in packages/cli.
import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Catalog, ReproTrace, ServerCommand } from '@fiks/interfaces';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ExtendedIssue } from './catalog.ts';
import { createVendor, VERSION_HEADER, type Vendor } from './server.ts';

/** One upstream exchange (`HttpExchange` of the fiks contracts package). */
export type Exchange = ReproTrace['http'][number];

/** A recorded call: the product's `Recording` (fixtures and traces share it). */
export type TrackerRecording = Omit<ReproTrace, 'runId' | 'contractId' | 'violated' | 'server'>;

/** Hop-by-hop or volatile headers that make recordings noisy and replays wrong (as the fiks tap). */
const DROP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'date', 'host']);
const REDACT = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization']);

function cleanHeaders(h: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined || DROP.has(k)) continue;
    out[k] = REDACT.has(k) ? '[REDACTED]' : Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

export interface Tap {
  url: string;
  /** Returns and forgets the exchanges recorded since the last call. */
  take(): Exchange[];
  close(): Promise<void>;
}

/** A recording reverse proxy in front of `target`. `clock` stamps `startedAt` (default: wall clock). */
export async function startTap(target: string, clock?: () => Date): Promise<Tap> {
  const base = new URL(target);
  let exchanges: Exchange[] = [];
  let seq = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const started = (clock ?? (() => new Date()))();
      const reqBody = chunks.length ? Buffer.concat(chunks) : null;
      const path = req.url ?? '/';
      const up = httpRequest(
        {
          protocol: base.protocol,
          hostname: base.hostname,
          port: base.port,
          method: req.method,
          path: `${base.pathname.replace(/\/$/, '')}${path}`,
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

/** Something in front of the vendor (e.g. an injector): fronts `target`, returns its own URL. */
export type Middleware = (target: string) => Promise<{ url: string; close(): Promise<void> }>;

export interface RecorderOptions {
  /** The tracker-mcp checkout whose server runs (needs node_modules). */
  repoDir: string;
  serverCommand: (repoDir: string) => ServerCommand;
  /** Frozen clock (ISO instant) for the vendor and every `capturedAt`. */
  clock: string;
  catalog?: Catalog;
  extended?: readonly ExtendedIssue[] | string;
  middleware?: Middleware[];
  /** `upstream.drifts` in the recordings (default []). */
  drifts?: string[];
}

export interface Recorder {
  vendor: Vendor;
  vendorUrl: string;
  call(tool: string, args: Record<string, unknown>, id?: string): Promise<TrackerRecording>;
  close(): Promise<void>;
}

/** Starts vendor, middleware, tap and the tracker-mcp server; `call` returns one recording. */
export async function startRecorder(opts: RecorderOptions): Promise<Recorder> {
  const now = () => new Date(opts.clock);
  const vendor = createVendor({ catalog: opts.catalog ?? 'original', extended: opts.extended, now });
  const vendorUrl = await vendor.listen();
  const closers: (() => Promise<void>)[] = [() => vendor.close()];
  let upstream = vendorUrl;
  for (const m of opts.middleware ?? []) {
    const started = await m(upstream);
    closers.unshift(() => started.close());
    upstream = started.url;
  }
  const tap = await startTap(upstream, now);
  closers.unshift(() => tap.close());
  const cmd = opts.serverCommand(opts.repoDir);
  const client = new Client({ name: 'fiks-tracker-recorder', version: '0.1.0' });
  await client.connect(
    new StdioClientTransport({
      command: cmd.command,
      args: cmd.args,
      cwd: cmd.cwd,
      env: { ...getDefaultEnvironment(), TRACKER_BASE_URL: tap.url },
      stderr: 'pipe',
    }),
  );
  closers.unshift(() => client.close());
  let n = 0;
  return {
    vendor,
    vendorUrl,
    async call(tool, args, id) {
      tap.take();
      const result = (await client.callTool({ name: tool, arguments: args })) as TrackerRecording['result'];
      const http = tap.take();
      return {
        id: id ?? `rec-${++n}`,
        capturedAt: opts.clock,
        tool,
        args,
        result,
        http,
        vendorVersionHeader: http[0]?.response.headers[VERSION_HEADER],
        upstream: { version: 'v1', drifts: opts.drifts ?? [], clock: opts.clock },
      };
    },
    async close() {
      for (const c of closers) await c();
    },
  };
}
