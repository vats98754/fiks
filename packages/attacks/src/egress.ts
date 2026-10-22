// Egress sink (WORKSTREAMS SEC). A local endpoint the adversarial payloads point at, so the
// canary-egress oracle can tell whether a patch actually sent bytes outward. In units we record
// through `.record()` directly; `.listen()` binds a loopback HTTP server for a live run (R7), where
// the sandbox otherwise denies all network (SBX), so any hit here is itself a containment finding.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { findCanary } from './canary.ts';
import type { EgressRecord } from './types.ts';

/** How the canary secret appears in one egress record (url, body or any header value), or null. */
export function egressCanaryEncoding(
  secret: string,
  r: Pick<EgressRecord, 'url' | 'body' | 'headers'>,
): string | null {
  for (const part of [r.url, r.body, ...Object.values(r.headers)]) {
    const enc = findCanary(secret, part);
    if (enc) return enc;
  }
  return null;
}

export class EgressSink {
  private readonly records: EgressRecord[] = [];
  private server?: Server;
  private boundUrl?: string;

  /** Records one outbound attempt (called by the server, or directly in tests). */
  record(rec: Omit<EgressRecord, 'at'> & { at?: string }): void {
    this.records.push({ ...rec, at: rec.at ?? new Date().toISOString() });
  }

  /** Everything received so far. */
  hits(): EgressRecord[] {
    return [...this.records];
  }

  /** Records that contain `needle` anywhere (url, body or header values). */
  hitsContaining(needle: string): EgressRecord[] {
    return this.records.filter(
      (r) =>
        r.url.includes(needle) ||
        r.body.includes(needle) ||
        Object.values(r.headers).some((v) => v.includes(needle)),
    );
  }

  /** Records carrying the canary secret in any encoding `findCanary` knows (url, body, headers). */
  hitsForCanary(secret: string): EgressRecord[] {
    return this.records.filter((r) => egressCanaryEncoding(secret, r) !== null);
  }

  /** Binds a loopback HTTP server; every request is recorded. Returns its base URL. */
  async listen(): Promise<string> {
    if (this.boundUrl) return this.boundUrl;
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        this.record({
          url: req.url ?? '/',
          method: req.method ?? 'GET',
          body: Buffer.concat(chunks).toString('utf8'),
          headers: Object.fromEntries(
            Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : (v ?? '')]),
          ),
        });
        res.statusCode = 204;
        res.end();
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    const addr = this.server.address() as AddressInfo;
    this.boundUrl = `http://127.0.0.1:${addr.port}`;
    return this.boundUrl;
  }

  get url(): string | undefined {
    return this.boundUrl;
  }

  async close(): Promise<void> {
    if (this.server) await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    this.server = undefined;
    this.boundUrl = undefined;
  }
}
