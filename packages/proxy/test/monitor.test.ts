// The monitor hook in handleCall (paper/PLAN.md P9): pluggable monitors, monitor id and latency
// in every event, log-only mode, --monitor none, and the evaluation instant in every record.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, SHOP_CONTRACTS } from '@fiks/contracts';
import type { MonitorInput } from '@fiks/interfaces';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  contractsMonitor,
  type EvaluateFn,
  loadMonitor,
  makeReceipt,
  RECEIPT_META_KEY,
  type Receipt,
  startProxy,
} from '../src/index.ts';
import { FROZEN, ok, respondShop, SHOP_TOOLS, shopProxy, THREE_ITEMS } from './support/shop-like.ts';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
/** The evaluator with its options argument (VOCAB EvalOptions); options pass through untouched. */
const realEvaluate: EvaluateFn = evaluate;
const receiptOf = (r: CallToolResult) => r._meta?.[RECEIPT_META_KEY] as Receipt | undefined;

async function env(extra: Parameters<typeof shopProxy>[1] = {}) {
  const e = await shopProxy(respondShop, { now: () => FROZEN, ...extra });
  cleanups.push(e.close);
  return e;
}

describe('default monitor (contracts)', () => {
  test('every event carries the monitor id, its latency and the evaluation instant', async () => {
    const e = await env();
    await e.client.callTool({ name: 'search_products', arguments: { query: 'cable' } });
    await e.client.callTool({ name: 'get_order', arguments: { order_id: 'o-2' } });
    expect(e.events).toHaveLength(2);
    for (const ev of e.events) {
      expect(ev.monitor).toBe('contracts');
      expect(typeof ev.monitorMs).toBe('number');
      expect(ev.monitorMs).toBeGreaterThanOrEqual(0);
      expect(ev.at).toBe(FROZEN.toISOString());
      expect(ev.receipt?.at).toBe(ev.at);
      expect(ev.toolDef?.name).toBe(ev.tool);
      expect(ev.upstreamObserved).toBe(false);
    }
    expect(e.events[1]?.receipt?.violations.map((v) => v.propertyId)).toEqual([
      'shop.get_order/created_at.freshness',
    ]);
  });

  test('the receipt is the one evaluate() gives, byte for byte (default monitor = evaluator)', async () => {
    const e = await env();
    const r = (await e.client.callTool({
      name: 'search_products',
      arguments: { query: 'cable' },
    })) as CallToolResult;
    const contract = SHOP_CONTRACTS.contracts.find((c) => c.tool === 'search_products');
    const direct = evaluate(contract, {
      args: { query: 'cable' },
      result: ok(THREE_ITEMS),
      now: FROZEN,
      declaredOutputSchema: SHOP_TOOLS.find((t) => t.name === 'search_products')?.outputSchema as never,
    });
    expect(JSON.stringify(receiptOf(r))).toBe(JSON.stringify(makeReceipt(direct, FROZEN, false)));
  });

  test('the live proxy never passes evaluator options (no perElement, no reenable)', async () => {
    const spy = vi.fn<EvaluateFn>((c, i, o) => realEvaluate(c, i, o));
    const e = await env({ monitor: contractsMonitor(spy) });
    await e.client.callTool({ name: 'search_products', arguments: { query: 'cable' } });
    await e.client.callTool({ name: 'get_order', arguments: { order_id: 'o-1' } });
    await e.client.callTool({ name: 'create_order', arguments: { items: [] } });
    expect(spy).toHaveBeenCalledTimes(3);
    for (const call of spy.mock.calls) {
      expect(call[2]).toBeUndefined();
    }
    // The violation shown is the first element's only (live receipts are not per element).
    const search = e.events[0]?.receipt?.violations.filter((v) => v.kind === 'range') ?? [];
    expect(search.map((v) => v.path)).toEqual(['items[0].price']);
  });

  test('a disabled property listed by the evaluator is named in the receipt; none by default', async () => {
    const fake: EvaluateFn = (c, i) => ({ ...evaluate(c, i), disabled: ['shop.get_order/total.range'] });
    const e = await env({ monitor: contractsMonitor(fake) });
    const r = (await e.client.callTool({
      name: 'get_order',
      arguments: { order_id: 'o-1' },
    })) as CallToolResult;
    expect(receiptOf(r)?.disabled).toEqual(['shop.get_order/total.range']);
    const plain = await env();
    const r2 = (await plain.client.callTool({
      name: 'get_order',
      arguments: { order_id: 'o-1' },
    })) as CallToolResult;
    expect(receiptOf(r2)).not.toHaveProperty('disabled');
  });
});

describe('module monitors', () => {
  test('a custom monitor gets the call, contract and tool definition; its id is in every event', async () => {
    const seen: MonitorInput[] = [];
    const monitor = Object.assign(
      (input: MonitorInput) => {
        seen.push(input);
        return {
          verdict: 'verified' as const,
          checked: ['judge/ok'],
          violations: [],
          disabled: [],
          tokens: 7,
        };
      },
      { id: 'judge-v1' },
    );
    const e = await env({ monitor });
    const r = (await e.client.callTool({
      name: 'get_order',
      arguments: { order_id: 'o-2' },
    })) as CallToolResult;
    expect(seen[0]).toMatchObject({ tool: 'get_order', contract: { id: 'shop.get_order' } });
    expect(seen[0]?.toolDef?.outputSchema).toBeTruthy();
    expect(seen[0]?.now).toEqual(FROZEN);
    expect(receiptOf(r)).toMatchObject({ verdict: 'verified', checked: ['judge/ok'] });
    expect(e.events[0]).toMatchObject({ monitor: 'judge-v1', tokens: 7 });
  });

  test('a monitor that throws leaves the call intact with an unverifiable receipt', async () => {
    const e = await env({
      monitor: () => {
        throw new Error('judge down');
      },
    });
    const r = (await e.client.callTool({
      name: 'get_order',
      arguments: { order_id: 'o-1' },
    })) as CallToolResult;
    expect(r.structuredContent).toMatchObject({ order_id: 'o-1' });
    expect(receiptOf(r)?.verdict).toBe('unverifiable');
    expect(e.events[0]).toMatchObject({ monitor: 'custom', monitorError: 'judge down' });
  });

  test('loadMonitor: contracts, none, and a module path (default export, id)', async () => {
    expect(await loadMonitor('none')).toBe('none');
    const c = await loadMonitor('contracts');
    expect(c !== 'none' && c.id).toBe('contracts');
    const dir = mkdtempSync(join(tmpdir(), 'fiks-mon-'));
    writeFileSync(
      join(dir, 'm.mjs'),
      "const m = () => ({ verdict: 'violated', checked: ['x'], violations: [], disabled: [] });\nm.id = 'mod-x';\nexport default m;\n",
    );
    writeFileSync(
      join(dir, 'anon.mjs'),
      "export default () => ({ verdict: 'verified', checked: [], violations: [], disabled: [] });\n",
    );
    writeFileSync(join(dir, 'bad.mjs'), 'export const x = 1;\n');
    const m = await loadMonitor('m.mjs', dir);
    expect(m !== 'none' && m.id).toBe('mod-x');
    const anon = await loadMonitor(join(dir, 'anon.mjs'));
    expect(anon !== 'none' && anon.id).toBe(join(dir, 'anon.mjs'));
    await expect(loadMonitor('bad.mjs', dir)).rejects.toThrow(/no default-export function/);
  });
});

describe('log-only', () => {
  test('results and tools/list pass through untouched; the event keeps the verdict', async () => {
    const direct = respondShop('search_products', {});
    const e = await env({ logOnly: true });
    const r = await e.client.request(
      { method: 'tools/call', params: { name: 'search_products', arguments: { query: 'cable' } } },
      (await import('@modelcontextprotocol/sdk/types.js')).CallToolResultSchema,
    );
    expect(JSON.stringify(r)).toBe(JSON.stringify(direct));
    const { tools } = await e.client.listTools();
    expect(JSON.stringify(tools)).toBe(JSON.stringify(SHOP_TOOLS));
    expect(e.events[0]).toMatchObject({
      logOnly: true,
      monitor: 'contracts',
      receipt: { verdict: 'violated', contractId: 'shop.search_products' },
    });
  });
});

describe('--monitor none', () => {
  test('records output and evaluation instant, with no receipt, no probe and no evaluation', async () => {
    const calls: string[] = [];
    const e = await shopProxy(
      (n, a) => {
        calls.push(n);
        return respondShop(n, a);
      },
      { monitor: 'none', now: () => FROZEN },
    );
    cleanups.push(e.close);
    const r = (await e.client.callTool({ name: 'create_order', arguments: { items: [] } })) as CallToolResult;
    expect(receiptOf(r)).toBeUndefined();
    expect(r.content).toHaveLength(1);
    // No read-back probe: create_order only.
    expect(calls).toEqual(['create_order']);
    const ev = e.events[0] as unknown as Record<string, unknown>;
    expect(ev).toMatchObject({
      monitor: 'none',
      monitorMs: 0,
      at: FROZEN.toISOString(),
      tool: 'create_order',
    });
    for (const k of ['receipt', 'probe', 'verdict', 'violations']) expect(ev).not.toHaveProperty(k);
  });

  test('needs no contracts; the contracts monitor without contracts is refused', async () => {
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const upstream = () => {
      const s = new McpServer({ name: 'x', version: '0' });
      const [a, b] = InMemoryTransport.createLinkedPair();
      void s.connect(a);
      return b;
    };
    const p = await startProxy({ upstream: { transport: 'custom', create: upstream }, monitor: 'none' });
    await p.close();
    await expect(startProxy({ upstream: { transport: 'custom', create: upstream } })).rejects.toThrow(
      /needs contracts/,
    );
  });
});
