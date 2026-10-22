// The real fiks-proxy binary, as an agent would run it: stdio in front of shop-mcp, with the
// HTTP tap on VENDOR_BASE_URL.
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SHOP_CONTRACTS_PATH } from '@fiks/contracts';
import { createVendor } from '@fiks/vendor-api';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
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

const FS_SPY = join(ROOT, 'packages/proxy/test/support/fs-spy.cjs');
const readEvents = (file: string) =>
  readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>);

/** fiks-proxy (bin) over stdio in front of shop-mcp, with extra flags and env. */
function proxyTransport(flags: string[], env: Record<string, string>) {
  const shop = shopCommand(shopDir());
  return new StdioClientTransport({
    command: join(ROOT, 'node_modules/.bin/tsx'),
    args: [join(ROOT, 'packages/proxy/src/bin.ts'), ...flags, '--', shop.command, ...shop.args],
    cwd: shop.cwd,
    env: { ...getDefaultEnvironment(), ...env },
    stderr: 'pipe',
  });
}

test('--log-only on shop v2 D2: results byte-identical to a direct call; events hold the violation', {
  timeout: 60_000,
}, async () => {
  const vendor = createVendor({ version: 'v2', drifts: 'D2' });
  const vendorUrl = await vendor.listen();
  const events = join(mkdtempSync(join(tmpdir(), 'fiks-bin-')), 'events.jsonl');
  const shop = shopCommand(shopDir());
  const direct = new Client({ name: 'direct', version: '0' });
  const proxied = new Client({ name: 'proxied', version: '0' });
  try {
    await direct.connect(
      new StdioClientTransport({
        command: shop.command,
        args: shop.args,
        cwd: shop.cwd,
        env: { ...getDefaultEnvironment(), VENDOR_BASE_URL: vendorUrl },
        stderr: 'pipe',
      }),
    );
    await proxied.connect(
      proxyTransport(
        ['--contracts', SHOP_CONTRACTS_PATH, '--log-only', '--tap', 'VENDOR_BASE_URL', '--events', events],
        { VENDOR_BASE_URL: vendorUrl },
      ),
    );
    expect(JSON.stringify((await proxied.listTools()).tools)).toBe(
      JSON.stringify((await direct.listTools()).tools),
    );
    for (const id of ['p-1001', 'p-1004']) {
      const a = (await direct.callTool({ name: 'get_product', arguments: { id } })) as CallToolResult;
      const b = (await proxied.callTool({ name: 'get_product', arguments: { id } })) as CallToolResult;
      expect(a.structuredContent).toMatchObject({ id, price: null });
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
    const lines = readEvents(events);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatchObject({
        type: 'call',
        tool: 'get_product',
        logOnly: true,
        monitor: 'contracts',
        upstreamObserved: true,
        receipt: { verdict: 'violated', violations: [{ propertyId: 'shop.get_product/price.notNull' }] },
      });
      expect(typeof line.monitorMs).toBe('number');
      expect(line.at).toBe((line.receipt as { at: string }).at);
    }
  } finally {
    await direct.close();
    await proxied.close();
    await vendor.close();
  }
});

test('--monitor none: CallRecords with output and upstream exchange, no verdict; contracts never opened', {
  timeout: 90_000,
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fiks-bin-none-'));
  // A private copy, so any open of this path can only come from the proxy.
  const contracts = join(dir, 'contracts.json');
  copyFileSync(SHOP_CONTRACTS_PATH, contracts);

  async function run(monitor: 'none' | 'contracts') {
    const vendor = createVendor({ version: 'v2', drifts: 'D2' });
    const vendorUrl = await vendor.listen();
    const events = join(dir, `events-${monitor}.jsonl`);
    const spyLog = join(dir, `fs-${monitor}.log`);
    const client = new Client({ name: 'bin-test', version: '0' });
    try {
      await client.connect(
        proxyTransport(
          ['--monitor', monitor, '--contracts', contracts, '--tap', 'VENDOR_BASE_URL', '--events', events],
          {
            VENDOR_BASE_URL: vendorUrl,
            NODE_OPTIONS: `--require ${FS_SPY}`,
            FIKS_TEST_FS_SPY_LOG: spyLog,
          },
        ),
      );
      const r = (await client.callTool({
        name: 'get_product',
        arguments: { id: 'p-1001' },
      })) as CallToolResult;
      const w = (await client.callTool({
        name: 'create_order',
        arguments: { items: [{ product_id: 'p-1002', quantity: 1 }] },
      })) as CallToolResult;
      return {
        r,
        w,
        events: readEvents(events),
        opened: existsSync(spyLog) ? readFileSync(spyLog, 'utf8') : '',
      };
    } finally {
      await client.close();
      await vendor.close();
    }
  }

  const none = await run('none');
  // The spy works: the same run with the contracts monitor opens the file.
  const control = await run('contracts');
  expect(control.opened.split('\n')).toContain(contracts);
  expect(none.opened.length).toBeGreaterThan(0);
  expect(none.opened.split('\n')).not.toContain(contracts);

  expect(none.r._meta?.['fiks/receipt']).toBeUndefined();
  expect(none.r.content).toHaveLength(1);
  expect(none.events).toHaveLength(2);
  const [get = {}, order = {}] = none.events;
  expect(get).toMatchObject({
    type: 'call',
    tool: 'get_product',
    monitor: 'none',
    monitorMs: 0,
    upstreamObserved: true,
    result: { structuredContent: { id: 'p-1001', price: null } },
  });
  expect((get.http as { request: { url: string } }[])[0]?.request.url).toBe('/products/p-1001');
  expect(typeof get.at).toBe('string');
  // No read-back probe: create_order caused exactly its own upstream request.
  expect((order.http as { request: { method: string; url: string } }[]).map((x) => x.request)).toMatchObject([
    { method: 'POST', url: '/orders' },
  ]);
  for (const ev of none.events) {
    for (const k of ['receipt', 'probe', 'verdict', 'violations', 'checked'])
      expect(ev).not.toHaveProperty(k);
  }
  expect(control.events[1]).toHaveProperty('probe');
});
