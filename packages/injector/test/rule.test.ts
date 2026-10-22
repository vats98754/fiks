// InjectorRule schema, validator, hash; DriftPackage manifests; the validate-rule CLI.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVendor } from '@fiks/vendor-api';
import { afterAll, describe, expect, test } from 'vitest';
import {
  canonicalJson,
  driftPkgSchemaErrors,
  injectorMiddleware,
  loadDriftPackage,
  readRule,
  ruleHash,
  ruleSchemaErrors,
  startInjector,
  validateDriftPackage,
  validateRule,
} from '../src/index.ts';
import { main } from '../src/validate-rule.ts';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(PKG, '../..');
const RULES = join(PKG, 'fixtures/rules');
const DRIFTPKGS = join(PKG, 'fixtures/driftpkgs');
const manifests = readdirSync(DRIFTPKGS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => join(DRIFTPKGS, f));

const tmp = mkdtempSync(join(tmpdir(), 'fiks-injector-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A copy of the fixtures tree (rules + transforms keep their relative layout). */
function copyFixtures(): { rules: string; driftpkgs: string } {
  const dir = mkdtempSync(join(tmp, 'copy-'));
  cpSync(join(PKG, 'fixtures'), join(dir, 'fixtures'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  cpSync(join(PKG, 'src'), join(dir, 'src'), { recursive: true });
  return { rules: join(dir, 'fixtures/rules'), driftpkgs: join(dir, 'fixtures/driftpkgs') };
}

const VALID = {
  id: 'X',
  domain: 'shop',
  match: { method: 'GET', pathPattern: '^/products$' },
  transform: './t.ts',
  clockFrozen: true,
  hash: 'a'.repeat(64),
};

describe('rule schema', () => {
  test('a valid rule has no schema errors', () => {
    expect(ruleSchemaErrors(VALID)).toEqual([]);
    expect(ruleSchemaErrors({ ...VALID, match: { method: '*', pathPattern: '.' } })).toEqual([]);
    expect(ruleSchemaErrors({ ...VALID, match: { method: 'GET|POST', pathPattern: '.' } })).toEqual([]);
  });

  test.each([
    ['unknown field', { ...VALID, extra: 1 }, 'unknown field "extra"'],
    ['bad id', { ...VALID, id: '-x' }, 'id must match'],
    ['bad domain', { ...VALID, domain: 'Shop' }, 'domain must match'],
    ['lower-case method', { ...VALID, match: { method: 'get', pathPattern: '.' } }, 'match.method'],
    ['bad regex', { ...VALID, match: { method: 'GET', pathPattern: '(' } }, 'does not compile'],
    ['no match', { ...VALID, match: undefined }, 'match must be an object'],
    ['extra match key', { ...VALID, match: { method: 'GET', pathPattern: '.', q: 1 } }, 'match.q'],
    ['non-ts transform', { ...VALID, transform: './t.js' }, 'transform must be'],
    ['clockFrozen not boolean', { ...VALID, clockFrozen: 'yes' }, 'clockFrozen'],
    ['short hash', { ...VALID, hash: 'abc' }, 'hash must be'],
  ])('%s is rejected', (_name, raw, msg) => {
    expect(ruleSchemaErrors(raw).join('\n')).toContain(msg);
  });

  test('canonical JSON sorts keys at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"x":2,"y":1}]},"b":1}',
    );
  });
});

describe('rule hash', () => {
  test('every shipped rule validates and its stored hash is the computed hash', async () => {
    for (const f of readdirSync(RULES)) {
      const r = await validateRule(join(RULES, f));
      expect(r.errors, f).toEqual([]);
      const rule = readRule(join(RULES, f));
      expect(rule.hash).toBe(ruleHash(rule, rule.transformPath));
      expect(rule.clockFrozen).toBe(true);
    }
  });

  test('the hash is independent of rule-file formatting and key order', () => {
    const rule = readRule(join(RULES, 'D1.json'));
    const shuffled = { hash: rule.hash, clockFrozen: true, transform: rule.transform, match: rule.match };
    expect(ruleHash({ ...shuffled, id: rule.id, domain: rule.domain }, rule.transformPath)).toBe(rule.hash);
  });

  test('changing the match, a flag or one byte of the transform changes the hash', async () => {
    const { rules } = copyFixtures();
    const f = join(rules, 'D2.json');
    const rule = readRule(f);
    const h0 = ruleHash(rule, rule.transformPath);
    expect(ruleHash({ ...rule, match: { ...rule.match, method: 'POST' } }, rule.transformPath)).not.toBe(h0);
    expect(ruleHash({ ...rule, clockFrozen: false }, rule.transformPath)).not.toBe(h0);
    writeFileSync(rule.transformPath, `${readFileSync(rule.transformPath, 'utf8')} `);
    expect(ruleHash(rule, rule.transformPath)).not.toBe(h0);
    const r = await validateRule(f);
    expect(r.errors.join('\n')).toContain('hash mismatch');
    await expect(startInjector({ target: 'http://127.0.0.1:9', rule: f })).rejects.toThrow(/stored hash/);
  });

  test('a transform with a value import is rejected (only `import type` is allowed)', async () => {
    const { rules } = copyFixtures();
    const f = join(rules, 'D5.json');
    const rule = readRule(f);
    writeFileSync(
      rule.transformPath,
      `import { readFileSync } from 'node:fs';\n${readFileSync(rule.transformPath, 'utf8')}`,
    );
    writeFileSync(
      f,
      JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), hash: ruleHash(rule, rule.transformPath) }),
    );
    const r = await validateRule(f);
    expect(r.errors.join('\n')).toContain('self-contained');
  });

  test('a transform without a valid default export is rejected', async () => {
    const { rules } = copyFixtures();
    const f = join(rules, 'D1.json');
    const rule = readRule(f);
    writeFileSync(rule.transformPath, 'export default { description: 1 };\n');
    writeFileSync(
      f,
      JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), hash: ruleHash(rule, rule.transformPath) }),
    );
    expect((await validateRule(f)).errors.join('\n')).toContain('default export');
  });

  test('a missing transform file is reported', async () => {
    const { rules } = copyFixtures();
    const f = join(rules, 'D1.json');
    writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), transform: './nope.ts' }));
    expect((await validateRule(f)).errors.join('\n')).toContain('transform not found');
  });
});

describe('DriftPackage manifests', () => {
  test('six manifests: D1-D5 on seed-v1, DEV-X1 on base-shop; each has a base and validates', async () => {
    const byId = Object.fromEntries(manifests.map((f) => [loadDriftPackage(f).pkg.id, loadDriftPackage(f)]));
    expect(Object.keys(byId).sort()).toEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'DEV-X1']);
    for (const id of ['D1', 'D2', 'D3', 'D4', 'D5']) expect(byId[id]?.pkg.base).toBe('seed-v1');
    expect(byId['DEV-X1']?.pkg.base).toBe('base-shop');
    for (const f of manifests) {
      const raw = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
      expect(typeof raw.base === 'string' && raw.base.length > 0, f).toBe(true);
      expect((await validateDriftPackage(f)).errors, f).toEqual([]);
      const l = loadDriftPackage(f);
      expect(l.pkg.injectorRule.hash).toBe(l.rule.hash);
      expect(l.pkg.domain).toBe('shop');
    }
  });

  test('a manifest without base, with a stale rule hash, or a foreign rule fails', async () => {
    const { driftpkgs } = copyFixtures();
    const f = join(driftpkgs, 'D1.json');
    const raw = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
    const { base: _b, ...noBase } = raw;
    expect(driftPkgSchemaErrors(noBase).join('\n')).toContain('base must be');
    writeFileSync(
      f,
      JSON.stringify({ ...raw, injectorRule: { path: '../rules/D1.json', hash: 'f'.repeat(64) } }),
    );
    expect((await validateDriftPackage(f)).errors.join('\n')).toContain('injectorRule.hash');
    const d2 = JSON.parse(readFileSync(join(driftpkgs, 'D2.json'), 'utf8')) as { injectorRule: unknown };
    writeFileSync(f, JSON.stringify({ ...raw, injectorRule: d2.injectorRule }));
    expect((await validateDriftPackage(f)).errors.join('\n')).toContain('rule id D2 != manifest id D1');
  });

  test('--complete requires the grader part, which INJ manifests leave to HOLD', async () => {
    const f = join(DRIFTPKGS, 'DEV-X1.json');
    const errs = (await validateDriftPackage(f, { complete: true })).errors.join('\n');
    expect(errs).toContain('hiddenTests is empty');
    expect(errs).toContain('refA is empty');
  });
});

describe('validate-rule CLI', () => {
  test('main(): 0 on the shipped manifests and rules, 1 on a broken file, 2 without files', async () => {
    expect(await main(manifests)).toBe(0);
    expect(await main(readdirSync(RULES).map((f) => join(RULES, f)))).toBe(0);
    const bad = join(tmp, 'bad.json');
    writeFileSync(bad, '{"id": 1}');
    expect(await main([bad])).toBe(1);
    expect(await main([])).toBe(2);
  });

  test('`pnpm tsx packages/injector/src/validate-rule.ts fixtures/driftpkgs/*.json` exits 0', () => {
    const r = spawnSync(
      join(ROOT, 'node_modules/.bin/tsx'),
      ['packages/injector/src/validate-rule.ts', ...manifests],
      { cwd: ROOT, encoding: 'utf8' },
    );
    expect(r.stdout).toContain('6/6 valid');
    expect(r.status).toBe(0);
  });

  test('--write-hash repairs stale hashes in rules and manifests', async () => {
    const { rules, driftpkgs } = copyFixtures();
    const rf = join(rules, 'D4.json');
    const mf = join(driftpkgs, 'D4.json');
    writeFileSync(rf, JSON.stringify({ ...JSON.parse(readFileSync(rf, 'utf8')), hash: '0'.repeat(64) }));
    expect(await main([mf])).toBe(1);
    expect(await main(['--write-hash', mf])).toBe(0);
  });
});

describe('injector behaviour', () => {
  test('middleware: each start() is a fresh injector with fresh transform state', async () => {
    const vendor = createVendor({ version: 'v1', now: () => new Date('2026-10-18T12:00:00.000Z') });
    const target = await vendor.listen();
    const mw = injectorMiddleware(join(RULES, 'D3.json'), { clock: '2026-10-18T12:00:00.000Z' });
    expect(mw.name).toBe('injector:D3');
    const post = (url: string) =>
      fetch(`${url}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ product_id: 'p-1004', quantity: 1 }] }),
      }).then((r) => r.json() as Promise<{ id: string }>);
    try {
      const a = await mw.start(target);
      const { id } = await post(a.url);
      expect((await fetch(`${a.url}/orders/${id}`)).status).toBe(404);
      await a.close();
      const b = await mw.start(target);
      // The vendor kept the order; the new injector has no memory of dropping it.
      expect((await fetch(`${b.url}/orders/${id}`)).status).toBe(200);
      await b.close();
    } finally {
      await vendor.close();
    }
  });

  test('request bodies, query strings and headers reach the upstream unchanged', async () => {
    const vendor = createVendor({ version: 'v2', drifts: 'D3' });
    const target = await vendor.listen();
    const inj = await startInjector({ target, rule: join(RULES, 'DEV-X1.json') });
    try {
      const r = await fetch(`${inj.url}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'k' },
        body: JSON.stringify({ items: [{ product_id: 'p-1001', quantity: 2 }] }),
      });
      const order = (await r.json()) as { id: string; total: number };
      expect(order.total).toBe(2398);
      // v2 D3 persists only with the key: it reached the vendor.
      expect(vendor.state.orders.map((o) => o.id)).toContain(order.id);
      const page = (await (await fetch(`${inj.url}/products?q=laptop`)).json()) as { total: number };
      expect(page.total).toBe(4);
      expect(inj.stats()).toEqual({ requests: 2, matched: 0 });
    } finally {
      await inj.close();
      await vendor.close();
    }
  });

  test('an unreachable upstream gives a 502 naming the rule', async () => {
    const inj = await startInjector({ target: 'http://127.0.0.1:9', rule: join(RULES, 'D1.json') });
    try {
      const r = await fetch(`${inj.url}/products`);
      expect(r.status).toBe(502);
      expect(await r.text()).toContain('D1');
    } finally {
      await inj.close();
    }
  });

  test('a non-frozen rule passes the wall clock; a frozen one stamps the frozen clock', async () => {
    const vendor = createVendor({ version: 'v1' });
    const target = await vendor.listen();
    const rule = readRule(join(RULES, 'D1.json'));
    const frozen = await startInjector({ target, rule, clock: '2030-01-02T03:04:05.000Z' });
    const live = await startInjector({ target, rule: { ...rule, clockFrozen: false }, verifyHash: false });
    try {
      expect((await fetch(`${frozen.url}/products`)).headers.get('date')).toBe(
        'Wed, 02 Jan 2030 03:04:05 GMT',
      );
      const d = new Date((await fetch(`${live.url}/products`)).headers.get('date') ?? 0).getTime();
      expect(Math.abs(d - Date.now())).toBeLessThan(60_000);
    } finally {
      await frozen.close();
      await live.close();
      await vendor.close();
    }
  });
});
