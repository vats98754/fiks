// Injector-aware profiles (PLAN P7): a trace captured through an injector rule carries
// {domain, base, ruleId, ruleHash}; it round-trips through the trace store, and rerecord()
// restarts the chain (vendor -> injector -> tap) with that rule and keeps the profile.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InjectorRule, RerecordProfile } from '@fiks/interfaces';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { rerecord, sameCallAndUpstream } from '../../cli/src/commands/rerecord.ts';
import { startHarness } from '../../cli/src/harness.ts';
import { clearInjectorFactory, registerInjectorFactory } from '../../vendor-api/src/index.ts';
import {
  createWorktree,
  type LocalWorktree,
  loadTrace,
  saveTrace,
  type Trace,
  traceFromCall,
} from '../src/index.ts';

const SHOP = new URL('../../../.work/shop-mcp', import.meta.url).pathname;
const CLOCK = new Date('2026-10-01T12:00:00.000Z');

/** A test injector: renames `price` to `unit_amount` on GET /products/{id} (a D2-style rule). */
const RULE: InjectorRule = {
  id: 'TEST-RENAME',
  domain: 'shop',
  match: { method: 'GET', pathPattern: '^/products/[^/]+$' },
  transform: 'inline:rename-price',
  clockFrozen: true,
  hash: 'sha256:test-rename-1',
};
const PROFILE: RerecordProfile = { domain: 'shop', base: 'v1', ruleId: RULE.id, ruleHash: RULE.hash };

const started: string[] = [];
function factory({ target, rule }: { target: string; rule: InjectorRule }) {
  started.push(rule.id);
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const up = await fetch(`${target}${req.url}`, {
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(
          ([k]) => k !== 'host' && k !== 'connection' && k !== 'content-length',
        ),
      ) as Record<string, string>,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    let body = await up.text();
    if (req.method === rule.match.method && new RegExp(rule.match.pathPattern).test(req.url ?? '') && up.ok) {
      const { price, ...rest } = JSON.parse(body);
      body = JSON.stringify({ ...rest, unit_amount: price });
    }
    res.writeHead(up.status, {
      'content-type': up.headers.get('content-type') ?? 'application/json',
      'vendor-api-version': up.headers.get('vendor-api-version') ?? '',
    });
    res.end(body);
  });
  return new Promise<{ url: string; close(): Promise<void> }>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections();
            server.close(() => r());
          }),
      }),
    ),
  );
}

let tmp: string;
let wt: LocalWorktree;

beforeAll(() => {
  registerInjectorFactory(factory);
  tmp = mkdtempSync(join(tmpdir(), 'fiks-profile-'));
  wt = createWorktree(SHOP, 'seed-v1', { dir: join(tmp, 'shop') });
}, 60_000);

afterAll(() => {
  clearInjectorFactory();
  wt?.remove();
  rmSync(tmp, { recursive: true, force: true });
});

async function capture(): Promise<Trace> {
  let trace: Trace | undefined;
  const h = await startHarness({
    vendor: 'v1',
    injector: RULE,
    via: 'proxy',
    clock: CLOCK,
    shopDir: wt.dir,
    onCall: (rec) => {
      if (rec.receipt.verdict !== 'violated') return undefined;
      trace = traceFromCall(rec, {
        runId: 'profile-test',
        upstream: { version: 'v1', drifts: [], clock: CLOCK.toISOString() },
        server: { name: 'shop-mcp', transport: 'stdio' },
        target: ['shop.get_product/price.notNull'],
        profile: PROFILE,
      });
      return { traceId: trace.id };
    },
  });
  try {
    expect(h.chain).toEqual(['vendor', 'injector:TEST-RENAME', 'tap']);
    await h.call('get_product', { id: 'p-1001' });
  } finally {
    await h.close();
  }
  if (!trace) throw new Error('the injected rename did not violate price.notNull');
  return trace;
}

test('a profile with injector {ruleId, hash} round-trips through trace-store and rerecord()', async () => {
  const trace = await capture();
  expect(trace.profile).toEqual(PROFILE);
  expect(JSON.parse(trace.http[0]?.response.body ?? '{}')).toHaveProperty('unit_amount', 1199);

  // trace-store
  const dir = join(tmp, 'traces');
  const file = saveTrace(dir, trace);
  expect(loadTrace(file)).toEqual(trace);
  expect(loadTrace(file).profile).toEqual(PROFILE);

  // rerecord(): a fresh chain with the same rule; same call, same upstream, same responses.
  mkdirSync(join(wt.dir, 'test/traces'), { recursive: true });
  const inRepo = join(wt.dir, 'test/traces', `${trace.id}.json`);
  writeFileSync(inRepo, readFileSync(file));
  const before = started.length;
  const r = await rerecord(inRepo, { shopDir: wt.dir, profile: PROFILE, rule: RULE });
  expect(started.length).toBe(before + 1); // the chain (incl. the injector) was restarted
  const out = JSON.parse(r.bytes) as Trace;
  expect(out.profile).toEqual(PROFILE);
  expect(out.upstream).toEqual(trace.upstream);
  expect(sameCallAndUpstream(out, trace)).toBe(true);
  expect(out.http.map((e) => e.response.body)).toEqual(trace.http.map((e) => e.response.body));
  expect(out.http.map((e) => `${e.request.method} ${e.request.url}`)).toEqual(
    trace.http.map((e) => `${e.request.method} ${e.request.url}`),
  );

  // The recording's own profile is enforced: a different rule (hash) or profile is refused.
  await expect(
    rerecord(inRepo, { shopDir: wt.dir, profile: PROFILE, rule: { ...RULE, hash: 'sha256:other' } }),
  ).rejects.toThrow(/needs the matching injector rule/);
  await expect(
    rerecord(inRepo, {
      shopDir: wt.dir,
      profile: { ...PROFILE, ruleHash: 'sha256:other' },
      rule: { ...RULE, hash: 'sha256:other' },
    }),
  ).rejects.toThrow(/captured under a different profile/);
  // Without a profile argument the trace's own profile applies (and still needs its rule).
  await expect(rerecord(inRepo, { shopDir: wt.dir })).rejects.toThrow(/needs the matching injector rule/);
  const again = JSON.parse((await rerecord(inRepo, { shopDir: wt.dir, rule: RULE })).bytes) as Trace;
  expect(again.profile).toEqual(PROFILE);
  expect(again.http.map((e) => e.response.body)).toEqual(out.http.map((e) => e.response.body));
}, 120_000);
