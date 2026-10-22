// R20 in-sandbox case runner (Figma-Context-MCP #364). Runs inside the SBX per-repo container
// (--network none, read-only root, HOME=/tmp), with the server's build tree at /work. Node
// built-ins only: the container has no fiks code, so this file replays the upstream itself.
//
//   node case-runner.mjs <case.json> <certDir>
//
// 1. A loopback HTTPS forward proxy (CONNECT) terminates TLS for the case's upstream hosts with a
//    leaf certificate issued on the host by @fiks/replay-proc's throwaway CA (certDir/{ca.pem,
//    leaf.key, leaf.pem}) and answers every request from the case's recorded/synthesized
//    exchanges (strict key: method + absolute URL). Anything else gets 599 (unmatched) or 403
//    (a host the case does not name), and is listed.
// 2. The unmodified server (`node /work/dist/bin.js --stdio ...`) is spawned with cwd = the case's
//    project directory, HTTPS_PROXY pointing at the proxy and NODE_EXTRA_CA_CERTS at the CA.
// 3. A minimal MCP stdio client: initialize, notifications/initialized, tools/list, tools/call.
// 4. After the call, the whole case root is listed (path, type, size, sha256 of files): the filesystem read-back
//    the contract's fileWrittenRequested property is evaluated on (on the host, harness/check.ts).
// Prints one JSON object on stdout.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { join } from 'node:path';

const [casePath, certDir] = process.argv.slice(2);
if (!casePath || !certDir) {
  process.stderr.write('usage: case-runner.mjs <case.json> <certDir>\n');
  process.exit(2);
}
const c = JSON.parse(readFileSync(casePath, 'utf8'));
const TIMEOUT_MS = 60_000;

// ---- upstream replay ---------------------------------------------------------------------------
const exchanges = new Map();
const keyOf = (method, url) => `${method} ${new URL(url).href}`;
for (const x of c.upstream ?? []) exchanges.set(keyOf(x.request.method, x.request.url), x.response);
const hosts = new Set((c.upstream ?? []).map((x) => new URL(x.request.url).host));
const served = [];
const unmatched = [];
const denied = [];

function answer(key, res) {
  const r = exchanges.get(key);
  if (!r) {
    unmatched.push(key);
    res.writeHead(599, { 'content-type': 'text/plain' });
    res.end(`UNMATCHED_REQUEST ${key}`);
    return;
  }
  served.push(key);
  const body =
    r.bodyBase64 !== undefined
      ? Buffer.from(r.bodyBase64, 'base64')
      : Buffer.from(typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? null));
  res.writeHead(r.status ?? 200, { ...(r.headers ?? {}), 'content-length': String(body.length) });
  res.end(body);
}

const tlsServer = createHttpsServer(
  { key: readFileSync(join(certDir, 'leaf.key')), cert: readFileSync(join(certDir, 'leaf.pem')) },
  (req, res) => {
    req.resume();
    req.on('end', () => answer(keyOf(req.method, `https://${req.headers.host}${req.url}`), res));
  },
);
const proxy = createHttpServer((req, res) => {
  // Plain-HTTP forward requests: the case's upstream is HTTPS only.
  denied.push(`${req.method} ${req.url}`);
  res.writeHead(403);
  res.end();
});
proxy.on('connect', (req, socket, head) => {
  const target = req.url ?? '';
  const host = target.endsWith(':443') ? target.slice(0, -4) : target;
  if (!hosts.has(host)) {
    denied.push(`CONNECT ${target}`);
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  if (head?.length) socket.unshift(head);
  tlsServer.emit('connection', socket);
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;

// ---- filesystem ----------------------------------------------------------------------------------
const root = c.server.root;
rmSync(root, { recursive: true, force: true });
mkdirSync(c.server.cwd, { recursive: true });
for (const d of c.server.mkdirs ?? []) mkdirSync(d, { recursive: true });

function listTree(dir, out = []) {
  let names = [];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return out;
  }
  for (const n of names) {
    const p = join(dir, n);
    const st = lstatSync(p);
    const type = st.isFile() ? 'file' : st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'symlink' : 'other';
    const entry = { path: p, type, size: st.isFile() ? st.size : 0 };
    if (type === 'file') entry.sha256 = createHash('sha256').update(readFileSync(p)).digest('hex');
    out.push(entry);
    if (type === 'dir') listTree(p, out);
  }
  return out;
}

// ---- server + MCP stdio client -----------------------------------------------------------------
const env = {
  PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
  HOME: '/tmp',
  CI: '1',
  DO_NOT_TRACK: '1',
  HTTPS_PROXY: proxyUrl,
  HTTP_PROXY: proxyUrl,
  NODE_EXTRA_CA_CERTS: join(certDir, 'ca.pem'),
};
const argv = [
  '/work/dist/bin.js',
  '--stdio',
  '--figma-api-key=fiks-replay-dummy',
  '--no-telemetry',
  ...(c.server.args ?? []),
];
const child = spawn('node', argv, { cwd: c.server.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (b) => {
  stderr += b.toString('utf8');
});
let exited = null;
const exitP = new Promise((r) =>
  child.on('exit', (code, signal) => {
    exited = { code, signal };
    r(exited);
  }),
);
const pending = new Map();
let buf = '';
child.stdout.on('data', (b) => {
  buf += b.toString('utf8');
  for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
let nextId = 1;
function request(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return Promise.race([
    new Promise((r) => pending.set(id, r)),
    exitP.then(() => ({ error: { message: `server exited before answering ${method}` } })),
    new Promise((r) => setTimeout(() => r({ error: { message: `${method} timed out` } }), TIMEOUT_MS)),
  ]);
}

const out = { caseId: c.id, description: null, result: null, rpcError: null };
try {
  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'fiks-r20-replay', version: '0.1.0' },
  });
  if (init.error) throw new Error(`initialize: ${init.error.message}`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const list = await request('tools/list', {});
  if (list.error) throw new Error(`tools/list: ${list.error.message}`);
  out.description = (list.result?.tools ?? []).find((t) => t.name === c.tool)?.description ?? null;
  const call = await request('tools/call', { name: c.tool, arguments: c.args });
  if (call.error) out.rpcError = call.error;
  else out.result = call.result;
} catch (e) {
  out.rpcError = { message: e instanceof Error ? e.message : String(e) };
} finally {
  child.stdin.end();
  child.kill('SIGTERM');
  await Promise.race([exitP, new Promise((r) => setTimeout(r, 5_000))]);
  if (!exited) child.kill('SIGKILL');
}
out.files = listTree(root);
out.served = served;
out.unmatched = unmatched;
out.denied = denied;
out.stderr = stderr.length > 8_000 ? `${stderr.slice(0, 8_000)}…[truncated]` : stderr;
proxy.close();
tlsServer.close();
process.stdout.write(`${JSON.stringify(out)}\n`);
process.exit(0);
