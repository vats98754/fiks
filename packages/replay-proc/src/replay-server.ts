// An HTTP(S) server that answers a server process's upstream requests from recorded exchanges.
// Each exchange answers at most once (unless a matcher marks it reusable); anything else gets
// 599 UNMATCHED_REQUEST, as in the shop-mcp in-process harness.
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { HttpExchange, Recording } from '@fiks/contracts';
import { type MatcherConfig, requestKey } from './matchers.ts';

export const UNMATCHED_STATUS = 599;

export interface TlsMaterial {
  key: string;
  cert: string;
}

export interface ReplayServerOptions {
  matchers?: MatcherConfig;
  /** Serve HTTPS with this key/cert (see `https.ts` `localTls`) instead of plain HTTP. */
  tls?: TlsMaterial;
}

export type ReplayHandler = (req: IncomingMessage, res: ServerResponse, url?: string) => void;

export interface ReplayServer {
  /** Base URL to hand the server process (e.g. through its base-URL env var). */
  url: string;
  /** Keys of requests that matched no recording, in arrival order. */
  unmatched: string[];
  /** Recorded exchanges that were served, in request order. */
  served: HttpExchange[];
  /** The request handler, for an HTTPS shim that terminates TLS itself. */
  handle: ReplayHandler;
  close(): Promise<void>;
}

/** The upstream exchanges of recordings (call, then probe), or plain exchanges as given. */
export function exchangesOf(recordings: readonly (Recording | HttpExchange)[]): HttpExchange[] {
  const out: HttpExchange[] = [];
  for (const r of recordings) {
    if ('request' in r) out.push(r);
    else out.push(...r.http, ...(r.probe?.http ?? []));
  }
  return out;
}

/** Creates the matching logic without a listening socket. */
export function createReplayHandler(
  exchanges: HttpExchange[],
  matchers: MatcherConfig = {},
): { handle: ReplayHandler; unmatched: string[]; served: HttpExchange[] } {
  const pending = [...exchanges]
    .sort((a, b) => a.seq - b.seq)
    .map((e) => ({ e, ...requestKey(e.request, matchers) }));
  const unmatched: string[] = [];
  const served: HttpExchange[] = [];
  const handle: ReplayHandler = (req, res, url) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? Buffer.concat(chunks).toString('utf8') : null;
      const { key } = requestKey(
        { method: req.method ?? 'GET', url: url ?? req.url ?? '/', body, headers: req.headers },
        matchers,
      );
      const i = pending.findIndex((p) => p.key === key);
      if (i === -1) {
        unmatched.push(key);
        res.writeHead(UNMATCHED_STATUS, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'UNMATCHED_REQUEST', request: key }));
        return;
      }
      const p = pending[i] as (typeof pending)[number];
      if (!p.reusable) pending.splice(i, 1);
      served.push(p.e);
      res.writeHead(p.e.response.status, p.e.response.headers);
      res.end(p.e.response.body);
    });
  };
  return { handle, unmatched, served };
}

/** Starts a replay server on 127.0.0.1 (ephemeral port) for the given recordings. */
export async function replayServer(
  recordings: readonly (Recording | HttpExchange)[],
  opts: ReplayServerOptions = {},
): Promise<ReplayServer> {
  const { handle, unmatched, served } = createReplayHandler(exchangesOf(recordings), opts.matchers);
  const listener = (req: IncomingMessage, res: ServerResponse) => handle(req, res);
  const server = opts.tls
    ? createHttpsServer({ key: opts.tls.key, cert: opts.tls.cert }, listener)
    : createHttpServer(listener);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const scheme = opts.tls ? 'https' : 'http';
  return {
    url: `${scheme}://127.0.0.1:${(server.address() as AddressInfo).port}`,
    unmatched,
    served,
    handle,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
