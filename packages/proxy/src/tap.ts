import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { HttpExchange } from '@fiks/contracts';

const REDACT = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization']);
/** Hop-by-hop or volatile headers that make recordings noisy and replays wrong. */
const DROP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'date', 'host']);

function cleanHeaders(h: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined || DROP.has(k)) continue;
    out[k] = REDACT.has(k) ? '[REDACTED]' : Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

export interface Tap {
  /** Base URL to hand to the upstream server instead of the real one. */
  url: string;
  /** Every exchange recorded so far. */
  readonly exchanges: HttpExchange[];
  /** Returns and forgets the exchanges recorded since the last call. */
  take(): HttpExchange[];
  close(): Promise<void>;
}

/** A recording reverse proxy in front of `target` (e.g. the vendor API). */
export async function startTap(target: string): Promise<Tap> {
  const base = new URL(target);
  const exchanges: HttpExchange[] = [];
  let cursor = 0;
  let seq = 0;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const started = Date.now();
      const reqBody = chunks.length ? Buffer.concat(chunks) : null;
      const path = req.url ?? '/';
      const upstream = httpRequest(
        {
          protocol: base.protocol,
          hostname: base.hostname,
          port: base.port,
          method: req.method,
          path: `${base.pathname.replace(/\/$/, '')}${path}`,
          // Ask for identity encoding so recorded bodies are plain text.
          headers: { ...req.headers, host: base.host, 'accept-encoding': 'identity' },
        },
        (up) => {
          const out: Buffer[] = [];
          up.on('data', (c: Buffer) => out.push(c));
          up.on('end', () => {
            const body = Buffer.concat(out);
            exchanges.push({
              seq: seq++,
              startedAt: new Date(started).toISOString(),
              durationMs: Date.now() - started,
              request: {
                method: req.method ?? 'GET',
                url: path,
                headers: cleanHeaders(req.headers),
                body: reqBody ? reqBody.toString('utf8') : null,
              },
              response: {
                status: up.statusCode ?? 0,
                headers: cleanHeaders(up.headers),
                body: body.toString('utf8'),
              },
            });
            res.writeHead(up.statusCode ?? 502, up.headers);
            res.end(body);
          });
        },
      );
      upstream.on('error', (e) => {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'tap_upstream_error', message: e.message }));
      });
      if (reqBody) upstream.write(reqBody);
      upstream.end();
    });
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    exchanges,
    take() {
      const out = exchanges.slice(cursor);
      cursor = exchanges.length;
      return out;
    },
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
