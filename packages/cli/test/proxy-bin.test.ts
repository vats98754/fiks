// The real fiks-proxy binary, as an agent would run it: stdio in front of shop-mcp, with the
// HTTP tap on VENDOR_BASE_URL.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SHOP_CONTRACTS_PATH } from '@fiks/contracts';
import { createVendor } from '@fiks/vendor-api';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, test } from 'vitest';
import { shopCommand } from '../src/harness.ts';
import { ROOT, shopDir } from '../src/paths.ts';

test('fiks-proxy bin: receipts over stdio, events log written', { timeout: 60_000 }, async () => {
  const vendor = createVendor({ version: 'v2', drifts: 'D2' });
  const vendorUrl = await vendor.listen();
  const events = join(mkdtempSync(join(tmpdir(), 'fiks-bin-')), 'events.jsonl');
  const shop = shopCommand(shopDir());
  const transport = new StdioClientTransport({
    command: join(ROOT, 'node_modules/.bin/tsx'),
    args: [
      join(ROOT, 'packages/proxy/src/bin.ts'),
      '--contracts',
      SHOP_CONTRACTS_PATH,
      '--tap',
      'VENDOR_BASE_URL',
      '--events',
      events,
      '--',
      shop.command,
      ...shop.args,
    ],
    cwd: shop.cwd,
    env: { ...getDefaultEnvironment(), VENDOR_BASE_URL: vendorUrl },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'bin-test', version: '0' });
  try {
    await client.connect(transport);
    const r = await client.callTool({ name: 'get_product', arguments: { id: 'p-1001' } });
    const text = (r.content as { text: string }[]).at(-1)?.text;
    expect(text).toMatch(/^\[fiks\] VIOLATED get_product: price is null/);
    const lines = readFileSync(events, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: 'call', tool: 'get_product', receipt: { verdict: 'violated' } });
    expect(lines[0].http[0].request.url).toBe('/products/p-1001');
  } finally {
    await client.close();
    await vendor.close();
  }
});

test('fiks-proxy bin without --tap: the upstream inherits the agent environment', {
  timeout: 60_000,
}, async () => {
  const vendor = createVendor({ version: 'v1' });
  const vendorUrl = await vendor.listen();
  const shop = shopCommand(shopDir());
  const transport = new StdioClientTransport({
    command: join(ROOT, 'node_modules/.bin/tsx'),
    args: [
      join(ROOT, 'packages/proxy/src/bin.ts'),
      '--contracts',
      SHOP_CONTRACTS_PATH,
      '--',
      shop.command,
      ...shop.args,
    ],
    cwd: shop.cwd,
    // Only the agent's own environment carries VENDOR_BASE_URL; the proxy must pass it on.
    env: { ...getDefaultEnvironment(), VENDOR_BASE_URL: vendorUrl },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'bin-test', version: '0' });
  try {
    await client.connect(transport);
    const r = await client.callTool({ name: 'get_product', arguments: { id: 'p-1002' } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ id: 'p-1002', price: 899 });
    const meta = r._meta?.['fiks/receipt'] as { verdict: string; upstreamObserved: boolean };
    expect(meta).toMatchObject({ verdict: 'verified', upstreamObserved: false });
  } finally {
    await client.close();
    await vendor.close();
  }
});
