import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildProbeArgs, findContract, type Recording, SHOP_CONTRACTS } from '@fiks/contracts';
import type { VendorVersion } from '@fiks/vendor-api';
import { startHarness } from '../harness.ts';
import { shopDir } from '../paths.ts';

/** The calls recorded as baseline fixtures. Every one must verify cleanly against v1. */
export const FIXTURE_CALLS: { slug: string; tool: string; args: Record<string, unknown> }[] = [
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

export async function recordFixtures(opts: {
  vendor: VendorVersion;
  drifts?: string;
  out?: string;
  shopDir?: string;
}) {
  const out = opts.out ?? join(opts.shopDir ?? shopDir(), 'test/fixtures', opts.vendor);
  mkdirSync(out, { recursive: true });
  const clock = new Date();
  const h = await startHarness({ vendor: opts.vendor, drifts: opts.drifts, clock, shopDir: opts.shopDir });
  const written: string[] = [];
  try {
    for (const c of FIXTURE_CALLS) {
      const capturedAt = clock.toISOString();
      const { result, http } = await h.call(c.tool, c.args);
      const rec: Recording = {
        id: `${opts.vendor}-${c.slug}`,
        capturedAt,
        tool: c.tool,
        args: c.args,
        result,
        http,
        vendorVersionHeader: http[0]?.response.headers['vendor-api-version'],
        upstream: { version: opts.vendor, drifts: h.vendor.state.drifts, clock: clock.toISOString() },
      };
      const post = findContract(SHOP_CONTRACTS, c.tool)?.postconditions?.[0];
      if (post && result.structuredContent && !result.isError) {
        const args = buildProbeArgs(post, result.structuredContent);
        const probe = await h.call(post.probeTool, args);
        rec.probe = { tool: post.probeTool, args, result: probe.result, http: probe.http };
      }
      const file = join(out, `${c.slug}.json`);
      writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
      written.push(file);
    }
  } finally {
    await h.close();
  }
  return { out, written };
}
