// A shop-shaped upstream for monitor and replay tests: the real shop contracts and the real
// shop-mcp tools/list (outputSchemas), with tool results the test chooses.
import { readFileSync } from 'node:fs';
import { SHOP_CONTRACTS } from '@fiks/contracts';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { type ProxyOptions, type RecordedCall, SHOP_TOOLS_PATH } from '../../src/index.ts';
import { rawProxied } from '../support.ts';

export const SHOP_TOOLS = (JSON.parse(readFileSync(SHOP_TOOLS_PATH, 'utf8')) as { tools: Tool[] }).tools;

export type Responder = (name: string, args: Record<string, unknown>) => unknown;

/** Structured tool result in the shape shop-mcp returns. */
export const ok = (data: Record<string, unknown>) => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
  structuredContent: data,
});

/** The proxy in front of a fake shop; every record is collected as an events-file line would be. */
export async function shopProxy(respond: Responder, extra: Partial<ProxyOptions> = {}) {
  const events: (RecordedCall & { type: 'call' })[] = [];
  const env = await rawProxied(SHOP_TOOLS, async (n, a) => respond(n, a), SHOP_CONTRACTS, {
    onRecord: (rec) => void events.push(JSON.parse(JSON.stringify({ type: 'call', ...rec }))),
    ...extra,
  });
  return { ...env, events };
}

/** Three search results, two outside the 20-2000 USD range (PLAN 3.1 per-element example). */
export const THREE_ITEMS = {
  items: [
    { id: 'ext-a', name: 'Ext A', category: 'cable', price: 9, currency: 'USD' },
    { id: 'ext-b', name: 'Ext B', category: 'cable', price: 50, currency: 'USD' },
    { id: 'ext-c', name: 'Ext C', category: 'cable', price: 5000, currency: 'USD' },
  ],
  count: 3,
  total: 3,
};

export const FROZEN = new Date('2026-10-18T12:00:00.000Z');

/** get_order results: fresh, 1970 (D5-style epoch parse), and one with an ISO string 200 days old. */
export const ORDERS: Record<string, Record<string, unknown>> = {
  'o-1': { created_at: '2026-10-17T09:00:00.000Z' },
  'o-2': { created_at: '1970-01-21T07:00:00.000Z' },
  'o-3': { created_at: '2026-04-01T09:00:00.000Z' },
};

export const respondShop: Responder = (name, args) => {
  if (name === 'search_products') return ok(THREE_ITEMS);
  if (name === 'get_order') {
    const id = String(args.order_id);
    return ok({
      order_id: id,
      status: 'placed',
      items: [{ product_id: 'p-1002', quantity: 1, unit_price: 899 }],
      total: 899,
      created_at: ORDERS[id]?.created_at ?? '2026-10-17T09:00:00.000Z',
    });
  }
  if (name === 'create_order') return ok({ order_id: 'o-1', status: 'placed', total: 899 });
  return { isError: true, content: [{ type: 'text', text: `unknown tool ${name}` }] };
};
