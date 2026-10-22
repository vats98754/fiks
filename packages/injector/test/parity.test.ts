// D1-D5 rules on vendor v1 reproduce vendor v2 single-drift responses byte-for-byte on every
// scenario and fixture call; 10 runs of every rule under the frozen clock hash identically; DEV-X1
// keeps statuses, the OpenAPI document and the version header, and changes get_product.
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createVendor } from '@fiks/vendor-api';
import { describe, expect, test } from 'vitest';
import { type Injector, startInjector } from '../src/index.ts';
import { type Observed, runSequence, SEQUENCES, wire } from './calls.ts';

const CLOCK = new Date('2026-10-18T12:00:00.000Z');
const ruleFile = (id: string) => fileURLToPath(new URL(`../fixtures/rules/${id}.json`, import.meta.url));
const SEEDED = ['D1', 'D2', 'D3', 'D4', 'D5'] as const;

async function onVendor(
  version: 'v1' | 'v2',
  drifts: string | undefined,
  rule: string | undefined,
  run: (base: string, inj?: Injector) => Promise<Observed[]>,
): Promise<Observed[]> {
  const vendor = createVendor({ version, drifts, now: () => CLOCK });
  const vendorUrl = await vendor.listen();
  const inj = rule
    ? await startInjector({ target: vendorUrl, rule: ruleFile(rule), clock: CLOCK })
    : undefined;
  try {
    return await run(inj?.url ?? vendorUrl, inj);
  } finally {
    await inj?.close();
    await vendor.close();
  }
}

const seq = (name: string) => (base: string) => runSequence(base, SEQUENCES[name] ?? []);

describe('D1-D5 rules on v1 = vendor v2 with that single drift', () => {
  for (const id of SEEDED) {
    test(`${id}: every scenario, fixture and extra call is byte-identical`, async () => {
      let differsFromV1 = 0;
      let matched = 0;
      for (const name of Object.keys(SEQUENCES)) {
        const v2 = await onVendor('v2', id, undefined, seq(name));
        const injected = await onVendor('v1', undefined, id, async (base, inj) => {
          const r = await seq(name)(base);
          matched += inj?.stats().matched ?? 0;
          return r;
        });
        const v1 = await onVendor('v1', undefined, undefined, seq(name));
        expect(injected.map(wire), `${id} ${name}`).toEqual(v2.map(wire));
        expect(v2.length).toBeGreaterThan(0);
        differsFromV1 += JSON.stringify(v1.map(wire)) === JSON.stringify(v2.map(wire)) ? 0 : 1;
      }
      // Not vacuous: the drift is visible somewhere, and the rule matched some requests.
      expect(differsFromV1).toBeGreaterThan(0);
      expect(matched).toBeGreaterThan(0);
    }, 60_000);
  }

  test('the drifted scenario of each rule differs from v1 (the injector does the work)', async () => {
    for (const id of SEEDED) {
      const v1 = await onVendor('v1', undefined, undefined, seq(`scenario:${id}`));
      const injected = await onVendor('v1', undefined, id, seq(`scenario:${id}`));
      expect(
        injected.map((o) => o.body),
        id,
      ).not.toEqual(v1.map((o) => o.body));
    }
  });
});

const ALL_RULES = [...SEEDED, 'DEV-X1'] as const;

function responseHash(all: Observed[]): string {
  const h = createHash('sha256');
  for (const o of all) h.update(JSON.stringify([o.method, o.path, o.status, o.headers, o.body]));
  return h.digest('hex');
}

describe('frozen clock: 10 runs of each rule give identical response hashes', () => {
  for (const id of ALL_RULES) {
    test(id, async () => {
      const hashes = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const all: Observed[] = [];
        for (const name of Object.keys(SEQUENCES)) {
          all.push(...(await onVendor('v1', undefined, id, seq(name))));
        }
        // The date header is the frozen clock, not the wall clock.
        for (const o of all) expect(Object.fromEntries(o.headers).date).toBe(CLOCK.toUTCString());
        hashes.add(responseHash(all));
      }
      expect(hashes.size).toBe(1);
    }, 60_000);
  }
});

describe('DEV-X1 (silent, get_product only)', () => {
  test('status, OpenAPI and version header unchanged; get_product differs; nothing else does', async () => {
    let getProductDiffs = 0;
    for (const name of Object.keys(SEQUENCES)) {
      const v1 = await onVendor('v1', undefined, undefined, seq(name));
      const x = await onVendor('v1', undefined, 'DEV-X1', seq(name));
      expect(x.length).toBe(v1.length);
      x.forEach((o, i) => {
        const base = v1[i] as Observed;
        expect(o.status, `${name} ${o.path}`).toBe(base.status);
        expect(o.version).toBe(base.version);
        expect(o.contentType).toBe(base.contentType);
        if (o.call.startsWith('get_product') && o.body !== base.body) getProductDiffs++;
        else expect(o.body, `${name} ${o.path}`).toBe(base.body);
      });
    }
    expect(getProductDiffs).toBeGreaterThan(0);

    const spec = await onVendor('v1', undefined, 'DEV-X1', (b) =>
      runSequence(b, [{ tool: 'GET', args: { path: '/openapi.json' } }]),
    );
    const specV1 = await onVendor('v1', undefined, undefined, (b) =>
      runSequence(b, [{ tool: 'GET', args: { path: '/openapi.json' } }]),
    );
    expect(spec[0]?.body).toBe(specV1[0]?.body);
    expect(spec[0]?.status).toBe(200);
  });

  test('get_product p-1004: price in cents, currency moved after it', async () => {
    const [o] = await onVendor('v1', undefined, 'DEV-X1', (b) =>
      runSequence(b, [{ tool: 'get_product', args: { id: 'p-1004' } }]),
    );
    expect(JSON.parse(o?.body ?? '{}')).toEqual({
      id: 'p-1004',
      name: 'Nimbus 15 Laptop',
      category: 'laptop',
      stock: 18,
      price: 74950,
      currency: 'USD',
    });
    expect(Object.keys(JSON.parse(o?.body ?? '{}')).slice(-2)).toEqual(['price', 'currency']);
  });
});
