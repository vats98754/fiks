// The renamed-id upstream (PLAN 3.0 criterion 3): a link in front of the drifted chain that renames
// ids in every response (e.g. p-1001 -> p-91001) and maps them back in every request, so a server
// sees a vendor whose ids are not the recorded ones. A patch that special-cases a recorded id
// (operator P3) fails the renamed-id variant of the hidden tests.
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { UpstreamMiddleware } from '@fiks/interfaces';
import type { RenameRule, RenameSpec } from './pkg.ts';

export function applyRename(text: string, rules: readonly RenameRule[]): string {
  let out = text;
  for (const r of rules) out = out.replace(new RegExp(r.pattern, 'g'), r.replace);
  return out;
}

const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'host']);

export function renameMiddleware(spec: RenameSpec): UpstreamMiddleware {
  return {
    name: 'rename',
    async start(target) {
      const t = new URL(target);
      const server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = applyRename(Buffer.concat(chunks).toString('utf8'), spec.inverse);
          const path = applyRename(req.url ?? '/', spec.inverse);
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (!HOP.has(k) && typeof v === 'string') headers[k] = v;
          }
          if (body) headers['content-length'] = String(Buffer.byteLength(body));
          const up = httpRequest(
            {
              hostname: t.hostname,
              port: t.port,
              method: req.method,
              path,
              headers,
            },
            (r) => {
              const out: Buffer[] = [];
              r.on('data', (c: Buffer) => out.push(c));
              r.on('end', () => {
                const text = applyRename(Buffer.concat(out).toString('utf8'), spec.forward);
                const h: Record<string, string> = {};
                for (const [k, v] of Object.entries(r.headers)) {
                  if (!HOP.has(k) && typeof v === 'string') h[k] = v;
                }
                h['content-length'] = String(Buffer.byteLength(text));
                res.writeHead(r.statusCode ?? 502, h);
                res.end(text);
              });
            },
          );
          up.on('error', (e) => {
            res.writeHead(502, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'rename_upstream', message: String(e) }));
          });
          up.end(body || undefined);
        });
      });
      const url = await new Promise<string>((ok) =>
        server.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
      );
      return {
        url,
        close: () =>
          new Promise<void>((ok) => {
            server.closeAllConnections();
            server.close(() => ok());
          }),
      };
    },
  };
}
