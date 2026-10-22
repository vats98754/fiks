// The shop's scripted calls: baseline fixture calls and the D1-D5 scenarios (moved here from the
// CLI so the shop Domain carries them; the CLI re-exports them unchanged).
import type { VendorVersion } from './drifts.ts';

export interface ShopFixtureCall {
  slug: string;
  tool: string;
  args: Record<string, unknown>;
}

/** The calls recorded as baseline fixtures. Every one must verify cleanly against v1. */
export const FIXTURE_CALLS: ShopFixtureCall[] = [
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

export interface ScenarioCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface Scenario {
  id: string;
  vendor: VendorVersion;
  /** The drift this scenario isolates (v2 only). */
  drift?: string;
  calls: ScenarioCall[];
  /** The contract properties this drift breaks: a trace's `target`. */
  target: string[];
}

/**
 * Fixed call scripts. By default each D* scenario runs vendor v2 with only its drift active
 * (`profile: 'isolated'`, for detection checks). `profile: 'full'` runs the real v2 with every
 * drift; traces that go into shop-mcp are captured that way (see PLAN.md, trace profile rule).
 */
export const SCENARIOS: Record<string, Scenario> = {
  'v1-all': {
    id: 'v1-all',
    vendor: 'v1',
    calls: FIXTURE_CALLS.map(({ tool, args }) => ({ tool, args })),
    target: [],
  },
  D1: {
    id: 'D1',
    vendor: 'v2',
    drift: 'D1',
    calls: [{ tool: 'search_products', args: { query: 'laptop' } }],
    target: ['shop.search_products/items.price.range'],
  },
  D2: {
    id: 'D2',
    vendor: 'v2',
    drift: 'D2',
    calls: [{ tool: 'get_product', args: { id: 'p-1001' } }],
    target: ['shop.get_product/price.notNull'],
  },
  D3: {
    id: 'D3',
    vendor: 'v2',
    drift: 'D3',
    calls: [{ tool: 'create_order', args: { items: [{ product_id: 'p-1004', quantity: 2 }] } }],
    target: ['shop.create_order/readAfterWrite'],
  },
  D4: {
    id: 'D4',
    vendor: 'v2',
    drift: 'D4',
    calls: [{ tool: 'search_products', args: { query: 'cable' } }],
    target: ['shop.search_products/countMatchesTotal'],
  },
  D5: {
    id: 'D5',
    vendor: 'v2',
    drift: 'D5',
    calls: [{ tool: 'get_order', args: { order_id: 'o-5001' } }],
    target: ['shop.get_order/created_at.freshness', 'shop.get_order/created_at.equalsUpstream'],
  },
};
