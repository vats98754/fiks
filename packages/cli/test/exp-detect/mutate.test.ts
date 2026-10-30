// E-B: operator application, the coupling table, and a small end-to-end clean + mutate run
// (vendor v1, shop-mcp seed-v1, offline replay) into a temp folder. No LLM: FIKS_LLM_FORBID=1.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type HttpExchange, SHOP_CONTRACTS } from '@fiks/contracts';
import { BENIGN_OPS, RESPONSE_OPS, readCatalog } from '@fiks/mutate';
import { beforeAll, describe, expect, test } from 'vitest';
import { runClean } from '../../src/exp-detect/clean.ts';
import { readJsonl } from '../../src/exp-detect/io.ts';
import {
  ALL_OPS,
  COUPLED,
  contractKinds,
  type MutateRow,
  mutateCall,
  runMutate,
} from '../../src/exp-detect/mutate.ts';
import { cleanPlan } from '../../src/exp-detect/plan.ts';

beforeAll(() => {
  process.env.FIKS_LLM_FORBID = '1';
});

const exchange = (url: string, body: unknown, method = 'GET'): HttpExchange => ({
  seq: 0,
  startedAt: '2026-10-30T00:00:00.000Z',
  durationMs: 1,
  request: { method, url, headers: {}, body: null },
  response: { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
});

const PRODUCT = exchange('/products/p-1001', {
  id: 'p-1001',
  name: 'Aero 14 Laptop',
  category: 'laptop',
  price: 1199,
  currency: 'USD',
  stock: 12,
});
const ORDER = exchange('/orders/o-5001', {
  id: 'o-5001',
  status: 'confirmed',
  items: [{ product_id: 'p-1005', quantity: 2, unit_price: 329 }],
  total: 658,
  created_at: '2026-10-28T00:00:00.000Z',
});

describe('coupling table', () => {
  test('covers every response and benign operator', () => {
    expect(Object.keys(COUPLED).sort()).toEqual([...RESPONSE_OPS, ...BENIGN_OPS].sort());
    expect(ALL_OPS).toEqual([...RESPONSE_OPS, ...BENIGN_OPS]);
  });

  test('mirrors coupledProperty in the frozen mutation catalog; benign never coupled', () => {
    const catalog = readCatalog() as unknown as {
      response: { id: string; coupledProperty: string | null }[];
    };
    expect(catalog.response.map((o) => o.id)).toEqual([...RESPONSE_OPS]);
    for (const op of catalog.response)
      expect(COUPLED[op.id as keyof typeof COUPLED], op.id).toBe(op.coupledProperty);
    for (const op of BENIGN_OPS) expect(COUPLED[op]).toBeNull();
  });

  test('contractKinds of the shop contracts', () => {
    const k = contractKinds(SHOP_CONTRACTS);
    for (const kind of ['range', 'countMatchesTotal', 'freshness', 'readAfterWrite'])
      expect(k.has(kind)).toBe(true);
    expect(k.has('enum')).toBe(false);
  });
});

describe('mutateCall', () => {
  test('deterministic per seed, input untouched', () => {
    const before = JSON.stringify(PRODUCT);
    const a = mutateCall('M1', [PRODUCT], 's#0');
    const b = mutateCall('M1', [PRODUCT], 's#0');
    expect(a).toEqual(b);
    expect(JSON.stringify(PRODUCT)).toBe(before);
  });

  test('M8 turns the order timestamp into epoch ms; M9 has no site in v1 data', () => {
    const m8 = mutateCall('M8', [ORDER], 'x');
    expect(m8.applicable).toBe(true);
    expect(JSON.parse(m8.exchanges[0]?.response.body ?? '{}').created_at).toBe(
      Date.parse('2026-10-28T00:00:00.000Z'),
    );
    const m9 = mutateCall('M9', [ORDER], 'x');
    expect(m9.applicable).toBe(false);
    expect(m9.exchanges[0]?.response.body).toBe(ORDER.response.body);
  });

  test('M14 on a read is a 404; B4 adds a header and keeps the body bytes', () => {
    const m14 = mutateCall('M14', [PRODUCT], 'x');
    expect(m14.exchanges[0]?.response.status).toBe(404);
    const b4 = mutateCall('B4', [PRODUCT], 'x');
    expect(b4.applicable).toBe(true);
    expect(b4.exchanges[0]?.response.body).toBe(PRODUCT.response.body);
    expect(
      Object.keys(b4.exchanges[0]?.response.headers ?? {}).some((h) => h.startsWith('x-fiks-benign-')),
    ).toBe(true);
  });

  test('M6 needs an array longer than 5', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ id: `p-${i}`, price: 70 + i }));
    expect(mutateCall('M6', [exchange('/products?q=', { items, total: 7 })], 'x').applicable).toBe(true);
    expect(
      mutateCall('M6', [exchange('/products?q=a', { items: items.slice(0, 3), total: 3 })], 'x').applicable,
    ).toBe(false);
  });

  test('several exchanges: each mutated with its own seed', () => {
    const m = mutateCall('B2', [PRODUCT, ORDER], 's');
    expect(m.mutations).toHaveLength(2);
    expect(m.mutations.map((x) => x.seed)).toEqual(['s:0', 's:1']);
  });

  test('every operator yields one result per exchange, applicable or not', () => {
    for (const op of ALL_OPS) {
      const m = mutateCall(op, [PRODUCT], 'x');
      expect(m.exchanges).toHaveLength(1);
      expect(m.applicable).toBe(m.mutations[0]?.applicable);
    }
  });
});

describe('clean + mutate end to end (temp results)', () => {
  const out = mkdtempSync(join(tmpdir(), 'fiks-exp-detect-'));
  const plan = cleanPlan().filter(
    (c) =>
      ['p-1001', 'o-5001'].includes(c.args.id ?? c.args.order_id ?? '') ||
      ['', 'cable'].includes(c.args.query ?? 'x'),
  );
  let rows: MutateRow[] = [];

  test('clean writes one row per planned call with a verdict', { timeout: 60_000 }, async () => {
    const r = await runClean({ runId: 'r1', outRoot: out, plan });
    expect(r.rows).toHaveLength(plan.length);
    expect(
      r.rows.map((x) => x.verdict).every((v) => ['verified', 'violated', 'unverifiable'].includes(v)),
    ).toBe(true);
    const file = readJsonl(join(out, 'r1', 'clean.jsonl'));
    expect(file).toHaveLength(plan.length);
    expect(existsSync(join(out, 'r1', 'calls.jsonl'))).toBe(true);
    const meta = JSON.parse(readFileSync(join(out, 'r1', 'meta.clean.json'), 'utf8'));
    expect(meta.vendor).toBe('v1');
    expect(meta.catalogSize).toBe(15);
  });

  test('mutate replays every applicable operator; controls reproduce the logged verdict', {
    timeout: 120_000,
  }, async () => {
    const r = await runMutate({ outRoot: out, ops: ['M1', 'M6', 'M8', 'M9', 'B3'] });
    expect(r.runId).toBe('r1');
    rows = readJsonl<MutateRow>(join(out, 'r1', 'mutate.jsonl'));
    expect(rows).toEqual(r.rows);
    const controls = rows.filter((x) => x.op === 'control');
    expect(controls).toHaveLength(plan.length);
    expect(controls.every((c) => c.matchesLogged === true)).toBe(true);
    expect(rows.every((x) => x.unmatched === 0)).toBe(true);
    // Not applicable: nothing replayed.
    for (const x of rows.filter((y) => !y.applicable)) expect(x.verdict).toBeNull();
    // M9 has no epoch timestamp to change in v1 data.
    expect(rows.filter((x) => x.op === 'M9').every((x) => !x.applicable)).toBe(true);
    // M6 truncates the 15- and 7-item searches; the count no longer matches the total.
    const m6 = rows.filter((x) => x.op === 'M6' && x.applicable);
    expect(m6.map((x) => x.args.query).sort()).toEqual(['', 'cable']);
    for (const x of m6) expect(x.propertyIds).toContain('shop.search_products/countMatchesTotal');
    // M8 on the seed order: shop-mcp parses epoch ms as 1970, freshness fails.
    const m8 = rows.find((x) => x.op === 'M8' && x.applicable);
    expect(m8?.propertyIds).toContain('shop.get_order/created_at.freshness');
    // B3 (whitespace) never changes what the tool returns.
    for (const x of rows.filter((y) => y.op === 'B3')) expect(x.flagged).toBe(false);
    expect(process.env.FIKS_LLM_FORBID).toBe('1');
  });
});
