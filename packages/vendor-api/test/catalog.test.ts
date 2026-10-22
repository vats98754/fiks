// --catalog original|extended-only|all (PLAN P8, 3.1): disjoint id namespace, authorBatch kept,
// `original` byte-identical to the current catalog.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, test } from 'vitest';
import {
  CATALOG,
  type Catalog,
  createVendor,
  loadExtended,
  resolveCatalog,
  type Vendor,
  validateExtended,
} from '../src/index.ts';

const EXT = new URL('./fixtures/extended-sample.json', import.meta.url).pathname;
const ORIGINAL_IDS = CATALOG.map((p) => p.id);
const NOW = new Date('2026-10-01T12:00:00.000Z');

const vendors: Vendor[] = [];
afterEach(async () => {
  for (const v of vendors.splice(0)) await v.close();
});

async function start(catalog?: Catalog, version: 'v1' | 'v2' = 'v1') {
  const v = createVendor({ version, now: () => NOW, ...(catalog ? { catalog, extended: EXT } : {}) });
  vendors.push(v);
  return v.listen();
}

const text = async (url: string) => {
  const r = await fetch(url);
  return { status: r.status, body: await r.text(), version: r.headers.get('vendor-api-version') };
};

test('the original catalog has the 15 ids p-1001..p-1107', () => {
  expect(ORIGINAL_IDS).toHaveLength(15);
  expect(ORIGINAL_IDS[0]).toBe('p-1001');
  expect(ORIGINAL_IDS.at(-1)).toBe('p-1107');
});

describe('--catalog extended-only', () => {
  test('serves none of the 15 original ids, on any endpoint', async () => {
    const base = await start('extended-only');
    for (const id of ORIGINAL_IDS) expect((await text(`${base}/products/${id}`)).status).toBe(404);
    for (const q of ['', 'laptop', 'cable', 'monitor', 'dock', 'keyboard', 'p-1']) {
      const r = await text(`${base}/products?q=${encodeURIComponent(q)}`);
      for (const id of ORIGINAL_IDS) expect(r.body).not.toContain(`"${id}"`);
    }
    // No seed order either: it would name an original product.
    expect((await text(`${base}/orders/o-5001`)).status).toBe(404);
    const order = await fetch(`${base}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ product_id: 'p-1004', quantity: 1 }] }),
    });
    expect(order.status).toBe(400);
  });

  test('serves the extended entities, without their authorBatch', async () => {
    const base = await start('extended-only');
    const all = JSON.parse((await text(`${base}/products?q=`)).body);
    expect(all.items.map((p: { id: string }) => p.id)).toEqual(loadExtended(EXT).map((p) => p.id));
    const one = JSON.parse((await text(`${base}/products/px-0006`)).body);
    expect(one.id).toBe('px-0006');
    expect(one).not.toHaveProperty('authorBatch');
    const order = await fetch(`${base}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ product_id: 'px-0006', quantity: 2 }] }),
    });
    expect(order.status).toBe(200);
  });
});

describe('--catalog original', () => {
  test('equals the current catalog byte-for-byte', async () => {
    expect(resolveCatalog('original')).toBe(CATALOG);
    const def = await start();
    const orig = await start('original');
    const paths = ['/products?q=', '/products?q=cable', '/openapi.json', '/orders/o-5001', '/__admin/state'];
    for (const id of [...ORIGINAL_IDS, 'p-0000']) paths.push(`/products/${id}`);
    for (const p of paths) expect(await text(`${orig}${p}`), p).toEqual(await text(`${def}${p}`));
  });

  test('v2 with the original catalog is unchanged too', async () => {
    const def = createVendor({ version: 'v2', now: () => NOW });
    vendors.push(def);
    const a = await def.listen();
    const b = await start('original', 'v2');
    for (const p of ['/products?q=laptop', '/products/p-1001', '/orders/o-5001']) {
      expect(await text(`${b}${p}`)).toEqual(await text(`${a}${p}`));
    }
  });
});

describe('--catalog all', () => {
  test('serves original then extended entities', async () => {
    const base = await start('all');
    const all = JSON.parse((await text(`${base}/products?q=`)).body);
    expect(all.items.map((p: { id: string }) => p.id)).toEqual([
      ...ORIGINAL_IDS,
      ...loadExtended(EXT).map((p) => p.id),
    ]);
    expect((await text(`${base}/orders/o-5001`)).status).toBe(200);
  });
});

describe('extended entities', () => {
  test('keep authorBatch (in the vendor state and the loader)', () => {
    const ext = loadExtended(EXT);
    expect(new Set(ext.map((e) => e.authorBatch))).toEqual(new Set(['b01', 'b02']));
    const v = createVendor({ version: 'v1', catalog: 'extended-only', extended: EXT });
    expect(
      v.state.products.every((p) => typeof (p as { authorBatch?: string }).authorBatch === 'string'),
    ).toBe(true);
    expect(v.state.catalogMode).toBe('extended-only');
  });

  test('must live in the px- namespace, with unique ids', () => {
    const one = JSON.parse(readFileSync(EXT, 'utf8')).entities[0];
    expect(() => validateExtended([{ ...one, id: 'p-1001' }])).toThrow(/extended namespace/);
    expect(() => validateExtended([{ ...one, id: 'p-9999' }])).toThrow(/extended namespace/);
    expect(() => validateExtended([one, one])).toThrow(/duplicate id/);
    expect(() => validateExtended([{ ...one, authorBatch: undefined }])).toThrow(/authorBatch/);
    expect(validateExtended({ entities: [one] })).toHaveLength(1);
  });

  test('an unknown catalog option or a missing file is an error', () => {
    expect(() =>
      createVendor({ version: 'v1', catalog: 'extended-only', extended: '/nonexistent.json' }),
    ).toThrow(/not found/);
  });
});

test('vendor main accepts --catalog extended-only --extended <file>', async () => {
  const child = spawn(
    new URL('../../../node_modules/.bin/tsx', import.meta.url).pathname,
    ['src/main.ts', '--catalog', 'extended-only', '--extended', EXT],
    {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  try {
    const line = await new Promise<string>((resolve, reject) => {
      const rl = createInterface({ input: child.stderr as NodeJS.ReadableStream });
      rl.on('line', (l) => (l.includes('listening on') ? resolve(l) : undefined));
      child.on('exit', (code) => reject(new Error(`vendor exited ${code}`)));
    });
    expect(line).toContain('catalog=extended-only');
    const url = /(http:\/\/\S+)/.exec(line)?.[1] as string;
    expect((await fetch(`${url}/products/p-1001`)).status).toBe(404);
    expect((await fetch(`${url}/products/px-0001`)).status).toBe(200);
  } finally {
    child.kill();
  }
});
