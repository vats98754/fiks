// The proxy hands the read-after-write probe's upstream exchanges to the contract, so a tool
// that answers the read-back from its own memory (while the upstream lost the write) is caught.
import type { ContractFile } from '@fiks/contracts';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, expect, test } from 'vitest';
import { z } from 'zod';
import { RECEIPT_META_KEY, type Receipt } from '../src/index.ts';
import { fakeVendor, proxied, startTap } from './support.ts';

const CONTRACTS: ContractFile = {
  server: 'fake',
  version: 1,
  contracts: [
    {
      id: 'fake.create_order',
      tool: 'create_order',
      invariants: [],
      postconditions: [
        {
          id: 'readAfterWrite',
          probeTool: 'get_order',
          probeArgs: { order_id: 'order_id' },
          upstream: { idPath: 'id', equalsResultPath: 'order_id' },
          expect: [{ probePath: 'order_id', equalsResultPath: 'order_id' }],
        },
      ],
    },
  ],
};

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function setup(persist: boolean) {
  const orders = new Set<string>();
  const vendor = await fakeVendor((method, url) => {
    if (method === 'POST') {
      if (persist) orders.add('o-1');
      return [200, { id: 'o-1' }];
    }
    return orders.has(url.split('/').pop() ?? '') ? [200, { id: 'o-1' }] : [404, { error: 'not_found' }];
  });
  const tap = await startTap(vendor.url);
  const cache = new Map<string, { order_id: string }>();
  const env = await proxied(
    (server) => {
      server.registerTool('create_order', { outputSchema: { order_id: z.string() } }, async () => {
        const o = (await (await fetch(`${tap.url}/orders`, { method: 'POST' })).json()) as { id: string };
        cache.set(o.id, { order_id: o.id });
        return { content: [], structuredContent: { order_id: o.id } };
      });
      server.registerTool(
        'get_order',
        { inputSchema: { order_id: z.string() }, outputSchema: { order_id: z.string() } },
        async ({ order_id }) => {
          await fetch(`${tap.url}/orders/${order_id}`);
          // Wrong: answers from its own cache even when the upstream says 404.
          const hit = cache.get(order_id);
          return hit ? { content: [], structuredContent: hit } : { isError: true, content: [] };
        },
      );
    },
    CONTRACTS,
    { tap },
  );
  cleanups.push(vendor.close, tap.close, env.close);
  return env;
}

const receipt = (r: unknown) => (r as CallToolResult)._meta?.[RECEIPT_META_KEY] as Receipt;

test('cached read-back while the upstream lost the write: violated', async () => {
  const env = await setup(false);
  const r = receipt(await env.client.callTool({ name: 'create_order', arguments: {} }));
  expect(r.verdict).toBe('violated');
  expect(r.violations[0]?.message).toMatch(/write not confirmed by upstream: .* upstream status 404/);
});

test('upstream persisted the write: verified', async () => {
  const env = await setup(true);
  const r = receipt(await env.client.callTool({ name: 'create_order', arguments: {} }));
  expect(r.verdict).toBe('verified');
});
