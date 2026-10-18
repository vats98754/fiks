import { join } from 'node:path';
import type { HttpExchange, ToolResultLike } from '@fiks/contracts';
import { startTap, type Tap } from '@fiks/proxy';
import { createVendor, type Vendor, type VendorVersion } from '@fiks/vendor-api';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { shopDir as defaultShopDir } from './paths.ts';

export interface HarnessOptions {
  vendor: VendorVersion;
  /** e.g. "D2". Defaults to every drift on v2. */
  drifts?: string;
  shopDir?: string;
  /** Freeze the vendor's clock (recordings), so re-recordings get identical timestamps. */
  clock?: Date;
}

export interface Harness {
  vendor: Vendor;
  vendorUrl: string;
  tap: Tap;
  client: Client;
  call(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ result: ToolResultLike; http: HttpExchange[] }>;
  close(): Promise<void>;
}

/** Command that starts shop-mcp from a checkout over stdio. */
export function shopCommand(dir: string): { command: string; args: string[]; cwd: string } {
  return { command: join(dir, 'node_modules/.bin/tsx'), args: ['src/main.ts'], cwd: dir };
}

/** vendor-api (in-process) <- HTTP tap <- shop-mcp (stdio child) <- MCP client. */
export async function startHarness(opts: HarnessOptions): Promise<Harness> {
  const clock = opts.clock;
  const vendor = createVendor({
    version: opts.vendor,
    drifts: opts.drifts,
    now: clock ? () => clock : undefined,
  });
  const vendorUrl = await vendor.listen();
  const tap = await startTap(vendorUrl);
  const cmd = shopCommand(opts.shopDir ?? defaultShopDir());
  const transport = new StdioClientTransport({
    ...cmd,
    env: { ...getDefaultEnvironment(), VENDOR_BASE_URL: tap.url },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'fiks-harness', version: '0.1.0' });
  await client.connect(transport);
  return {
    vendor,
    vendorUrl,
    tap,
    client,
    async call(tool, args) {
      tap.take();
      const result = (await client.callTool({ name: tool, arguments: args })) as ToolResultLike;
      return { result, http: tap.take() };
    },
    async close() {
      await client.close();
      await tap.close();
      await vendor.close();
    },
  };
}
