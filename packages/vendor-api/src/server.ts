import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CATALOG,
  type Catalog,
  type CatalogProduct,
  type ExtendedProduct,
  findProduct,
  resolveCatalog,
  searchCatalog,
} from './catalog.ts';
import { type DriftId, resolveDrifts, V2_PAGE_SIZE, VERSION_DATES, type VendorVersion } from './drifts.ts';
import { OPENAPI } from './openapi.ts';

export interface VendorOptions {
  version: VendorVersion;
  /** Comma list such as "D1,D3". Ignored for v1. Defaults to every drift in v2. */
  drifts?: string;
  /** Clock used for order timestamps and the seeded order. */
  now?: () => Date;
  /** Which products to serve (default `original`, the 15-product catalog). */
  catalog?: Catalog;
  /** Extended entities, or the JSON file holding them (default VENDOR_EXTENDED_CATALOG). */
  extended?: readonly ExtendedProduct[] | string;
}

export interface OrderLine {
  product_id: string;
  quantity: number;
  unit_price: number;
}

export interface StoredOrder {
  id: string;
  status: 'confirmed';
  items: OrderLine[];
  /** Total in US dollars. */
  total: number;
  created_at: Date;
}

export interface VendorState {
  version: VendorVersion;
  drifts: DriftId[];
  orders: StoredOrder[];
  /** Orders that v2 acknowledged with 200 but did not persist (D3). Ground truth for graders. */
  droppedOrders: string[];
  /** The catalog option this vendor serves. Not part of `/__admin/state`. */
  catalogMode: Catalog;
  /** The products this vendor serves (ground truth for `truth()`). Not part of `/__admin/state`. */
  products: readonly CatalogProduct[];
}

export interface Vendor {
  server: Server;
  state: VendorState;
  reset(): void;
  listen(port?: number): Promise<string>;
  close(): Promise<void>;
}

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The order every vendor starts with, placed two days before startup. */
export const SEED_ORDER_ID = 'o-5001';

export function createVendor(opts: VendorOptions): Vendor {
  const now = opts.now ?? (() => new Date());
  const drifts = resolveDrifts(opts.version, opts.drifts);
  const has = (d: DriftId) => drifts.has(d);
  const catalogMode = opts.catalog ?? 'original';
  const products = resolveCatalog(catalogMode, opts.extended);
  let nextOrder = 5002;

  const state: VendorState = {
    version: opts.version,
    drifts: [...drifts].sort(),
    orders: [],
    droppedOrders: [],
    catalogMode,
    products,
  };

  function reset() {
    nextOrder = 5002;
    state.droppedOrders = [];
    // The seed order is for an original product; an extended-only vendor serves no original id.
    const p = findProduct('p-1005', products);
    if (!p) {
      state.orders = [];
      return;
    }
    state.orders = [
      {
        id: SEED_ORDER_ID,
        status: 'confirmed',
        items: [{ product_id: p.id, quantity: 2, unit_price: p.price }],
        total: round2(p.price * 2),
        created_at: new Date(now().getTime() - 2 * DAY_MS),
      },
    ];
  }
  reset();

  function productBody(p: CatalogProduct, priceField: 'price' | 'unit_amount', cents: boolean) {
    // authorBatch is catalog metadata, never part of the API.
    const { price, authorBatch: _batch, ...rest } = p as ExtendedProduct;
    return { ...rest, [priceField]: cents ? Math.round(price * 100) : price };
  }

  function orderBody(o: StoredOrder) {
    return {
      id: o.id,
      status: o.status,
      items: o.items,
      total: o.total,
      created_at: has('D5') ? o.created_at.getTime() : o.created_at.toISOString(),
    };
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://vendor.local');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'vendor-api-version': VERSION_DATES[opts.version],
      });
      res.end(JSON.stringify(body));
    };
    const method = req.method ?? 'GET';
    const parts = url.pathname.split('/').filter(Boolean);

    if (method === 'GET' && url.pathname === '/openapi.json') return send(200, OPENAPI);

    if (method === 'GET' && url.pathname === '/__admin/state') {
      const { catalogMode: _mode, products: _products, ...admin } = state;
      return send(200, {
        ...admin,
        orders: state.orders.map((o) => ({ ...o, created_at: o.created_at.toISOString() })),
      });
    }
    if (method === 'POST' && url.pathname === '/__admin/reset') {
      reset();
      return send(200, { ok: true });
    }

    if (method === 'GET' && parts[0] === 'products' && parts.length === 1) {
      const matches = searchCatalog(url.searchParams.get('q') ?? '', products);
      let page = matches;
      let next: string | null = null;
      if (has('D4')) {
        const offset = Number(url.searchParams.get('cursor') ?? '0') || 0;
        page = matches.slice(offset, offset + V2_PAGE_SIZE);
        next = offset + V2_PAGE_SIZE < matches.length ? String(offset + V2_PAGE_SIZE) : null;
      }
      return send(200, {
        items: page.map((p) => productBody(p, 'price', has('D1'))),
        total: matches.length,
        next_cursor: next,
      });
    }

    if (method === 'GET' && parts[0] === 'products' && parts.length === 2) {
      const p = findProduct(decodeURIComponent(parts[1] as string), products);
      if (!p) return send(404, { error: 'not_found', message: 'Unknown product.' });
      return send(200, productBody(p, has('D2') ? 'unit_amount' : 'price', false));
    }

    if (method === 'POST' && url.pathname === '/orders') {
      const body = await readJson(req);
      const lines = parseOrderLines(body, products);
      if (typeof lines === 'string') return send(400, { error: 'invalid_order', message: lines });
      const order: StoredOrder = {
        id: `o-${nextOrder++}`,
        status: 'confirmed',
        items: lines,
        total: round2(lines.reduce((s, l) => s + l.unit_price * l.quantity, 0)),
        created_at: now(),
      };
      const persisted = !has('D3') || Boolean(req.headers['idempotency-key']);
      if (persisted) state.orders.push(order);
      else state.droppedOrders.push(order.id);
      return send(200, orderBody(order));
    }

    if (method === 'GET' && parts[0] === 'orders' && parts.length === 2) {
      const o = state.orders.find((x) => x.id === decodeURIComponent(parts[1] as string));
      if (!o) return send(404, { error: 'not_found', message: 'Unknown order.' });
      return send(200, orderBody(o));
    }

    return send(404, { error: 'not_found', message: `No route for ${method} ${url.pathname}` });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      res.writeHead(500, {
        'content-type': 'application/json',
        'vendor-api-version': VERSION_DATES[opts.version],
      });
      res.end(JSON.stringify({ error: 'internal', message: String(e) }));
    });
  });

  return {
    server,
    state,
    reset,
    listen: (port = 0) =>
      new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => {
          resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
        });
      }),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
  } catch {
    return null;
  }
}

export function parseOrderLines(
  body: unknown,
  products: readonly CatalogProduct[] = CATALOG,
): OrderLine[] | string {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0) return 'items must be a non-empty array';
  const out: OrderLine[] = [];
  for (const it of items) {
    const { product_id, quantity } = (it ?? {}) as { product_id?: unknown; quantity?: unknown };
    const p = typeof product_id === 'string' ? findProduct(product_id, products) : undefined;
    if (!p) return `unknown product_id ${JSON.stringify(product_id)}`;
    if (!Number.isInteger(quantity) || (quantity as number) < 1) return 'quantity must be a positive integer';
    out.push({ product_id: p.id, quantity: quantity as number, unit_price: p.price });
  }
  return out;
}

export { CATALOG };
