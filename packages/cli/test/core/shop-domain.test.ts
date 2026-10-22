// The shop Domain registered by bootstrap/00-shop.ts: truth() against the real tool on v1, and
// entityClass/originEntity on the D1-D5 scenario calls (PLAN 3.0 criterion 5, 3.1).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Recording } from '@fiks/contracts';
import { getDomain } from '@fiks/domains';
import type { DomainCall } from '@fiks/interfaces';
import { createVendor, ORDER_FROM_PREVIOUS, SHOP_FROZEN_CLOCK } from '@fiks/vendor-api';
import { beforeAll, describe, expect, test } from 'vitest';
import { startHarness } from '../../src/harness.ts';
import { shopAt } from '../../src/paths.ts';

beforeAll(async () => {
  await import('../../src/bootstrap/00-shop.ts');
});

const shop = () => getDomain('shop');

test('getDomain("shop") is registered with every member, and allowedEditPaths = ec241bc REPAIR_ALLOWED', () => {
  const d = shop();
  expect(d.allowedEditPaths).toEqual(['^src/.+\\.ts$']);
  expect(d.frozenClock).toBe(SHOP_FROZEN_CLOCK);
  expect(Number.isNaN(Date.parse(d.frozenClock))).toBe(false);
  expect(d.seedTag).toBe('seed-v1');
  expect(d.baseUrlEnv).toBe('VENDOR_BASE_URL');
  expect(d.paginatedEndpoints).toEqual([]);
  expect(d.tasks.length).toBeGreaterThan(0);
  expect(Object.keys(d.scenarios)).toEqual(['v1-all', 'D1', 'D2', 'D3', 'D4', 'D5']);
  for (const k of [
    'reproEmitter',
    'suite',
    'truth',
    'entityClass',
    'originEntity',
    'injectorHook',
    'enumerate',
  ] as const) {
    expect(d[k], k).toBeDefined();
  }
});

describe('truth()', () => {
  test('equals the tool output on every v1 fixture (state rebuilt from the recorded requests)', async () => {
    const dir = join(shopAt('seed-v1'), 'test/fixtures/v1');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.rerecorded.json'));
    expect(files.length).toBe(10);
    for (const f of files) {
      const rec = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Recording;
      const clock = new Date(rec.upstream?.clock ?? rec.capturedAt);
      const v = createVendor({ version: 'v1', now: () => clock });
      const base = await v.listen();
      try {
        for (const e of [...rec.http, ...(rec.probe?.http ?? [])]) {
          await fetch(`${base}${e.request.url}`, {
            method: e.request.method,
            headers: Object.fromEntries(
              Object.entries(e.request.headers).filter(([k]) => /^(content-type|idempotency-key)$/.test(k)),
            ),
            body: e.request.body ?? undefined,
          });
        }
        const t = shop().truth({ tool: rec.tool, args: rec.args, output: rec.result }, v.state);
        expect(t.mismatches, f).toEqual([]);
        if (!rec.result?.isError) expect(t.inputValid, f).toBe(true);
      } finally {
        await v.close();
      }
    }
  }, 120_000);

  test('equals the tool output on 200 enumerated v1 calls through shop-mcp (seed-v1)', async () => {
    const rows = shop().enumerate({ catalog: 'original', seed: 1 });
    const grid = rows.filter((r) => r.stratum === 'S-grid');
    const picked = [...rows.filter((r) => r.stratum !== 'S-grid'), ...grid].slice(0, 200);
    expect(picked).toHaveLength(200);
    expect(new Set(picked.map((r) => r.tool))).toEqual(
      new Set(['get_product', 'search_products', 'create_order', 'get_order']),
    );
    const h = await startHarness({
      vendor: 'v1',
      clock: new Date(SHOP_FROZEN_CLOCK),
      shopDir: shopAt('seed-v1'),
    });
    let prevOrder: string | undefined;
    let compared = 0;
    try {
      for (const r of picked) {
        const args = r.args.order_id === ORDER_FROM_PREVIOUS ? { order_id: prevOrder } : r.args;
        const { result } = await h.call(r.tool, args);
        if (r.tool === 'create_order')
          prevOrder = (result.structuredContent as { order_id?: string } | undefined)?.order_id;
        const call: DomainCall = { tool: r.tool, args, output: result };
        const t = shop().truth(call, h.vendor.state);
        expect(t.mismatches, JSON.stringify(call)).toEqual([]);
        expect(t.inputValid).toBe(!result.isError);
        compared++;
      }
    } finally {
      await h.close();
    }
    expect(compared).toBe(200);
  }, 300_000);
});

test('entityClass and originEntity are defined for every call in the D1-D5 scenarios', async () => {
  const d = shop();
  for (const id of ['D1', 'D2', 'D3', 'D4', 'D5']) {
    const s = d.scenarios[id];
    if (!s) throw new Error(id);
    const h = await startHarness({
      vendor: 'v2',
      drifts: s.drift,
      clock: new Date(SHOP_FROZEN_CLOCK),
      shopDir: shopAt('seed-v1'),
    });
    try {
      for (const c of s.calls) {
        const { result } = await h.call(c.tool, c.args);
        for (const call of [
          { tool: c.tool, args: c.args },
          { tool: c.tool, args: c.args, output: result },
        ]) {
          const cls = d.entityClass(call);
          const origin = d.originEntity(call);
          expect(Object.keys(cls).length, id).toBeGreaterThan(1);
          expect(Object.keys(origin).sort()).toEqual(Object.keys(cls).sort());
          for (const v of [...Object.values(cls), ...Object.values(origin)]) expect(v, id).toMatch(/\S/);
        }
        if (c.tool === 'create_order') expect(d.originEntity({ ...c, output: result }).total).toBe('p-1004');
        if (c.tool === 'get_product') expect(d.originEntity({ ...c, output: result }).price).toBe('p-1001');
        if (c.tool === 'get_order')
          expect(d.originEntity({ ...c, output: result }).created_at).toBe('p-1005');
        if (c.tool === 'search_products') {
          const o = d.originEntity({ ...c, output: result });
          expect(o['items[0].price']).toMatch(/^p-1/);
          expect(o.total).toBe(`query:${c.args.query}`);
        }
      }
    } finally {
      await h.close();
    }
  }
}, 300_000);
