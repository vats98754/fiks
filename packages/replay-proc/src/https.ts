// HTTPS shim for servers whose upstream is HTTPS. Two modes:
//  - base-URL: the replay server itself speaks TLS on 127.0.0.1 (`localTls` + `replayServer({tls})`),
//    for servers whose base URL is configurable but must be https;
//  - proxy: a CONNECT proxy that terminates TLS for named hosts with a throwaway CA and answers
//    from the replay (`startHttpsShim`), for servers that hard-code `https://api.example.com`.
//    The child is pointed at it through HTTPS_PROXY/NODE_USE_ENV_PROXY and trusts the CA through
//    NODE_EXTRA_CA_CERTS (Node) or SSL_CERT_FILE/REQUESTS_CA_BUNDLE (Python, curl).
// Certificates come from the `openssl` CLI, valid for two days, in a fresh temp directory.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo, Socket } from 'node:net';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReplayHandler, TlsMaterial } from './replay-server.ts';

export interface CertificateAuthority {
  dir: string;
  /** PEM file a child process should trust. */
  caPath: string;
  caCert: string;
  caKey: string;
  /** A leaf certificate for these DNS names / IPs, signed by this CA. */
  issue(names: string[]): TlsMaterial;
  dispose(): void;
}

function openssl(args: string[], cwd: string) {
  try {
    execFileSync('openssl', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const err = e as { code?: string; stderr?: Buffer };
    if (err.code === 'ENOENT') throw new Error('the HTTPS shim needs the `openssl` CLI on PATH');
    throw new Error(`openssl ${args[0]} failed: ${err.stderr?.toString() ?? String(e)}`);
  }
}

const CA_CONF = `[req]
distinguished_name = dn
prompt = no
x509_extensions = v3_ca
[dn]
CN = fiks replay CA
[v3_ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
`;

/** A throwaway CA in a fresh temp directory. */
export function createCertificateAuthority(): CertificateAuthority {
  const dir = mkdtempSync(join(tmpdir(), 'fiks-replay-ca-'));
  writeFileSync(join(dir, 'ca.cnf'), CA_CONF);
  openssl(
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-config', 'ca.cnf'].concat([
      '-keyout',
      'ca.key',
      '-out',
      'ca.pem',
    ]),
    dir,
  );
  const caCert = readFileSync(join(dir, 'ca.pem'), 'utf8');
  const caKey = readFileSync(join(dir, 'ca.key'), 'utf8');
  let serial = 0;
  return {
    dir,
    caPath: join(dir, 'ca.pem'),
    caCert,
    caKey,
    issue(names) {
      if (names.length === 0) throw new Error('a leaf certificate needs at least one name');
      const n = ++serial;
      const san = names.map((h) => (isIP(h) ? `IP:${h}` : `DNS:${h}`)).join(',');
      writeFileSync(
        join(dir, `leaf${n}.ext`),
        `basicConstraints = CA:FALSE\nkeyUsage = digitalSignature, keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = ${san}\n`,
      );
      const cn = (names[0] as string).slice(0, 60);
      openssl(
        ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${cn}`].concat([
          '-keyout',
          `leaf${n}.key`,
          '-out',
          `leaf${n}.csr`,
        ]),
        dir,
      );
      openssl(
        [
          'x509',
          '-req',
          '-in',
          `leaf${n}.csr`,
          '-CA',
          'ca.pem',
          '-CAkey',
          'ca.key',
          '-set_serial',
          String(1000 + n),
        ].concat(['-days', '2', '-extfile', `leaf${n}.ext`, '-out', `leaf${n}.pem`]),
        dir,
      );
      return {
        key: readFileSync(join(dir, `leaf${n}.key`), 'utf8'),
        cert: readFileSync(join(dir, `leaf${n}.pem`), 'utf8'),
      };
    },
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Environment that makes a child trust `caPath` (Node, OpenSSL-based clients, Python requests). */
export function trustEnv(caPath: string): Record<string, string> {
  return { NODE_EXTRA_CA_CERTS: caPath, SSL_CERT_FILE: caPath, REQUESTS_CA_BUNDLE: caPath };
}

/** TLS material for a replay server on 127.0.0.1 (base-URL mode), plus the env to trust it. */
export function localTls(ca: CertificateAuthority): { tls: TlsMaterial; env: Record<string, string> } {
  return { tls: ca.issue(['127.0.0.1', 'localhost']), env: trustEnv(ca.caPath) };
}

export interface HttpsShim {
  /** `http://127.0.0.1:<port>`: the forward proxy. */
  proxyUrl: string;
  /** Env for the child: proxy variables, NODE_USE_ENV_PROXY and CA trust. */
  env: Record<string, string>;
  /** `host:port` of every CONNECT or proxied request the shim answered. */
  intercepted: string[];
  /** `host:port` of every CONNECT or proxied request to a host it does not shim (refused, 403). */
  denied: string[];
  close(): Promise<void>;
}

const hostOf = (authority: string) => authority.replace(/^\[(.*)\](:\d+)?$/, '$1').replace(/:\d+$/, '');

/**
 * A forward proxy that intercepts HTTPS (CONNECT) and plain HTTP proxy requests to `hosts` and
 * answers them with `handle` (a replay); every other destination is refused, so a replay never
 * reaches the network through it. Loopback stays direct (NO_PROXY).
 */
export async function startHttpsShim(opts: {
  hosts: string[];
  handle: ReplayHandler;
  ca: CertificateAuthority;
}): Promise<HttpsShim> {
  const hosts = new Set(opts.hosts.map((h) => h.toLowerCase()));
  const intercepted: string[] = [];
  const denied: string[] = [];
  const leaf = opts.ca.issue(opts.hosts);
  const tlsServer = createHttpsServer({ key: leaf.key, cert: leaf.cert }, (req, res) =>
    opts.handle(req, res),
  );
  const sockets = new Set<Socket>();
  const proxy = createHttpServer((req, res) => {
    // Plain-HTTP forward proxying: the request line carries an absolute URL.
    let target: URL | null = null;
    try {
      target = new URL(req.url ?? '');
    } catch {}
    if (!target || !hosts.has(target.hostname.toLowerCase())) {
      denied.push(target ? target.host : String(req.url));
      res.writeHead(403, { 'content-type': 'text/plain' }).end('fiks replay shim: host not shimmed');
      return;
    }
    intercepted.push(target.host);
    opts.handle(req, res, `${target.pathname}${target.search}`);
  });
  proxy.on('connect', (req, socket: Socket, head: Buffer) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    const authority = req.url ?? '';
    if (!hosts.has(hostOf(authority).toLowerCase())) {
      denied.push(authority);
      socket.end('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n');
      return;
    }
    intercepted.push(authority);
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) socket.unshift(head);
    tlsServer.emit('connection', socket);
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  const noProxy = 'localhost,127.0.0.1,::1';
  return {
    proxyUrl,
    env: {
      HTTPS_PROXY: proxyUrl,
      HTTP_PROXY: proxyUrl,
      https_proxy: proxyUrl,
      http_proxy: proxyUrl,
      NO_PROXY: noProxy,
      no_proxy: noProxy,
      NODE_USE_ENV_PROXY: '1',
      ...trustEnv(opts.ca.caPath),
    },
    intercepted,
    denied,
    close: () =>
      new Promise((r) => {
        for (const s of sockets) s.destroy();
        tlsServer.closeAllConnections();
        proxy.closeAllConnections();
        proxy.close(() => r());
      }),
  };
}
