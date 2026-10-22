// The shop tool calls the parity tests replay, and the vendor HTTP requests each one makes.
//
// SCENARIOS and FIXTURE_CALLS are copied from packages/cli/src/commands/scenario.ts and
// record-fixtures.ts (fiks c144b03); the injector may not import the CLI (it pulls in contracts).
// `httpFor` sends exactly what shop-mcp's vendor client sends at seed-v1 (src/vendor.ts and
// src/tools/*.ts): GET /products?q=, GET /products/{id}, POST /orders {items}, GET /orders/{id}.
// On top of that, every search follows `next_cursor` (as the D4 fix does), every create_order is
// followed by a get_order probe on the returned id (as record-fixtures does), and EXTRA_CALLS add
// the fixed-server variants (Idempotency-Key) and non-tool endpoints.

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  /** Extra request headers (the D3 fix sends an Idempotency-Key). */
  headers?: Record<string, string>;
}

export const FIXTURE_CALLS: (ToolCall & { slug: string })[] = [
  { slug: 'search-laptop', tool: 'search_products', args: { query: 'laptop' } },
  { slug: 'search-cable', tool: 'search_products', args: { query: 'cable' } },
  { slug: 'search-monitor', tool: 'search_products', args: { query: 'monitor' } },
  { slug: 'search-none', tool: 'search_products', args: { query: 'teapot' } },
  { slug: 'product-p-1001', tool: 'get_product', args: { id: 'p-1001' } },
  { slug: 'product-p-1004', tool: 'get_product', args: { id: 'p-1004' } },
  { slug: 'product-p-1107', tool: 'get_product', args: { id: 'p-1107' } },
  { slug: 'product-unknown', tool: 'get_product', args: { id: 'p-0000' } },
  { slug: 'order-create', tool: 'create_order', args: { items: [{ product_id: 'p-1004', quantity: 2 }] } },
  { slug: 'order-o-5001', tool: 'get_order', args: { order_id: 'o-5001' } },
];

export const SCENARIOS: Record<string, ToolCall[]> = {
  'v1-all': FIXTURE_CALLS.map(({ tool, args }) => ({ tool, args })),
  D1: [{ tool: 'search_products', args: { query: 'laptop' } }],
  D2: [{ tool: 'get_product', args: { id: 'p-1001' } }],
  D3: [{ tool: 'create_order', args: { items: [{ product_id: 'p-1004', quantity: 2 }] } }],
  D4: [{ tool: 'search_products', args: { query: 'cable' } }],
  D5: [{ tool: 'get_order', args: { order_id: 'o-5001' } }],
};

export const EXTRA_CALLS: ToolCall[] = [
  { tool: 'search_products', args: { query: '' } },
  {
    tool: 'create_order',
    args: { items: [{ product_id: 'p-1001', quantity: 1 }] },
    headers: { 'idempotency-key': 'k-1' },
  },
  { tool: 'create_order', args: { items: [{ product_id: 'p-1107', quantity: 3 }] } },
  { tool: 'create_order', args: { items: [{ product_id: 'p-0000', quantity: 1 }] } },
  { tool: 'get_order', args: { order_id: 'o-9999' } },
  { tool: 'GET', args: { path: '/openapi.json' } },
  { tool: 'GET', args: { path: '/no-such-route' } },
];

/** Each sequence runs on a fresh vendor (and a fresh injector). */
export const SEQUENCES: Record<string, ToolCall[]> = {
  ...Object.fromEntries(Object.entries(SCENARIOS).map(([k, v]) => [`scenario:${k}`, v])),
  fixtures: FIXTURE_CALLS,
  extras: EXTRA_CALLS,
};

export interface Observed {
  call: string;
  method: string;
  path: string;
  status: number;
  contentType: string | null;
  version: string | null;
  body: string;
  /** Every response header, sorted (for the determinism hash). */
  headers: [string, string][];
}

async function send(
  base: string,
  call: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Observed> {
  // Same request shape as shop-mcp's createVendorClient at seed-v1.
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    call,
    method,
    path,
    status: res.status,
    contentType: res.headers.get('content-type'),
    version: res.headers.get('vendor-api-version'),
    body: text,
    headers: [...res.headers.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  };
}

/** Sends the vendor requests of one tool call (plus follow-ups); returns every response. */
export async function httpFor(base: string, c: ToolCall): Promise<Observed[]> {
  const label = `${c.tool} ${JSON.stringify(c.args)}`;
  const out: Observed[] = [];
  const enc = encodeURIComponent;
  if (c.tool === 'search_products') {
    const q = enc(String(c.args.query));
    let r = await send(base, label, 'GET', `/products?q=${q}`);
    out.push(r);
    for (let guard = 0; r.status === 200 && guard < 20; guard++) {
      const cursor = (JSON.parse(r.body) as { next_cursor?: unknown }).next_cursor;
      if (typeof cursor !== 'string' || !cursor) break;
      r = await send(base, label, 'GET', `/products?q=${q}&cursor=${enc(cursor)}`);
      out.push(r);
    }
  } else if (c.tool === 'get_product') {
    out.push(await send(base, label, 'GET', `/products/${enc(String(c.args.id))}`));
  } else if (c.tool === 'create_order') {
    const r = await send(base, label, 'POST', '/orders', { items: c.args.items }, c.headers);
    out.push(r);
    const id = r.status === 200 ? (JSON.parse(r.body) as { id?: unknown }).id : undefined;
    if (typeof id === 'string') out.push(await send(base, `${label} probe`, 'GET', `/orders/${enc(id)}`));
  } else if (c.tool === 'get_order') {
    out.push(await send(base, label, 'GET', `/orders/${enc(String(c.args.order_id))}`));
  } else if (c.tool === 'GET') {
    out.push(await send(base, label, 'GET', String(c.args.path)));
  } else {
    throw new Error(`no HTTP mapping for tool ${c.tool}`);
  }
  return out;
}

export async function runSequence(base: string, calls: ToolCall[]): Promise<Observed[]> {
  const out: Observed[] = [];
  for (const c of calls) out.push(...(await httpFor(base, c)));
  return out;
}

/** What "byte-for-byte" compares: status, content type, version header and body bytes. */
export const wire = (o: Observed) => ({
  call: o.call,
  method: o.method,
  path: o.path,
  status: o.status,
  contentType: o.contentType,
  version: o.version,
  body: o.body,
});
