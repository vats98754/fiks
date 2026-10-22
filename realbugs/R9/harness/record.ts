// Records what the server for a commit sends on the wire for the trigger (issue #468 step 2:
// zones_list, no arguments): the raw JSON-RPC tools/call response line, before any client-side
// schema parsing, plus the zones_list entry of tools/list. Upstream requests are answered by the
// RBX HTTPS shim from the trigger's exchanges (every other host is refused). Writes
// realbugs/R9/fixtures/<ref>-wire.json (label `recorded`).
//
// usage: pnpm tsx realbugs/R9/harness/record.ts [--sha prefix] [--out <file>]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import {
  createCertificateAuthority,
  createReplayHandler,
  startHttpsShim,
} from '../../../packages/replay-proc/src/index.ts';
import { BUG_DIR, loadCase, MATCHERS, prepareBuild, REPLAY_TOKEN, UPSTREAM_HOST } from './server.ts';

export interface WireRecord {
  id: string;
  label: 'recorded';
  recordedAt: string;
  ref: string;
  sha: string | null;
  serverKind: string;
  accountId: string;
  toolsListEntry: unknown;
  request: unknown;
  /** The tools/call response exactly as the server wrote it (one JSON-RPC line, parsed). */
  response: unknown;
  /** Upstream requests the server made (`METHOD path`), in order. */
  upstream: string[];
  denied: string[];
}

export async function recordWire(ref: string): Promise<WireRecord> {
  const c = loadCase(join(BUG_DIR, 'fixtures', 'trigger.json'));
  const build = await prepareBuild({ sha: ref });
  const ca = createCertificateAuthority();
  const replay = createReplayHandler(c.http, MATCHERS);
  const shim = await startHttpsShim({ hosts: [UPSTREAM_HOST], handle: replay.handle, ca });
  const home = mkdtempSync(join(tmpdir(), 'fiks-r9-home-'));
  const child = spawn(process.execPath, [build.entry, 'run', c.accountId], {
    cwd: build.tree,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      CLOUDFLARE_API_TOKEN: REPLAY_TOKEN,
      ...shim.env,
    },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const waiting = new Map<number, (m: unknown) => void>();
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      const m = JSON.parse(line) as { id?: number };
      if (typeof m.id === 'number') waiting.get(m.id)?.(m);
    } catch {}
  });
  let next = 0;
  const send = (method: string, params: unknown) => {
    const id = ++next;
    const msg = { jsonrpc: '2.0', id, method, params };
    return {
      msg,
      reply: new Promise<unknown>((res, rej) => {
        waiting.set(id, res);
        setTimeout(() => rej(new Error(`${method}: no reply in 30 s`)), 30_000).unref();
        child.stdin.write(`${JSON.stringify(msg)}\n`);
      }),
    };
  };
  try {
    await send('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'fiks-r9-record', version: '0.1.0' },
    }).reply;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const list = (await send('tools/list', {}).reply) as { result?: { tools?: { name: string }[] } };
    const call = send('tools/call', { name: c.tool, arguments: c.args });
    const response = await call.reply;
    return {
      id: `r9-${ref}-wire-${c.tool}`,
      label: 'recorded',
      recordedAt: new Date().toISOString(),
      ref,
      sha: build.sha,
      serverKind: build.kind,
      accountId: c.accountId,
      toolsListEntry: list.result?.tools?.find((t) => t.name === c.tool) ?? null,
      request: call.msg,
      response,
      upstream: replay.served.map((x) => `${x.request.method} ${x.request.url}`),
      denied: [...shim.denied],
    };
  } finally {
    child.kill();
    await shim.close();
    ca.dispose();
    rmSync(home, { recursive: true, force: true });
  }
}

async function main(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: { sha: { type: 'string', default: 'prefix' }, out: { type: 'string' } },
    strict: true,
  });
  const ref = values.sha as string;
  const rec = await recordWire(ref);
  const out = resolve((values.out as string | undefined) ?? join(BUG_DIR, 'fixtures', `${ref}-wire.json`));
  writeFileSync(out, `${JSON.stringify(rec, null, 2)}\n`);
  console.log(`[r9] wrote ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`[r9] ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
}
