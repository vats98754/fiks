import { type ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { type ContractFile, type HttpExchange, SHOP_CONTRACTS } from '@fiks/contracts';
import {
  type CallRecord,
  type FiksProxy,
  listenHttp,
  type ProxyOptions,
  startProxy,
  startTap,
  type Tap,
} from '@fiks/proxy';
import { createVendor, type Vendor, type VendorVersion } from '@fiks/vendor-api';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { shopDir as defaultShopDir } from './paths.ts';

export interface HarnessOptions {
  vendor: VendorVersion;
  /** e.g. "D2". Defaults to every drift on v2. */
  drifts?: string;
  shopDir?: string;
  /** `direct`: the client talks to shop-mcp. `proxy`: through fiks-proxy (default direct). */
  via?: 'direct' | 'proxy';
  /** Transport on both sides of the proxy (default stdio). */
  transport?: 'stdio' | 'http';
  contracts?: ContractFile;
  onCall?: ProxyOptions['onCall'];
  /** Freeze the vendor's clock (recordings), so re-recordings get identical timestamps. */
  clock?: Date;
}

export interface Harness {
  vendor: Vendor;
  vendorUrl: string;
  vendorDrifts: string[];
  tap: Tap;
  client: Client;
  proxy?: FiksProxy;
  call(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ result: CallToolResult; http: HttpExchange[]; record?: CallRecord }>;
  close(): Promise<void>;
}

/** Command that starts shop-mcp from a checkout. */
export function shopCommand(dir: string): { command: string; args: string[]; cwd: string } {
  return { command: join(dir, 'node_modules/.bin/tsx'), args: ['src/main.ts'], cwd: dir };
}

/** Starts shop-mcp with `--http 0` and resolves its /mcp URL from the startup line. */
async function spawnShopHttp(
  dir: string,
  env: NodeJS.ProcessEnv,
): Promise<{ url: string; child: ChildProcess }> {
  const cmd = shopCommand(dir);
  const child = spawn(cmd.command, [...cmd.args, '--http', '0'], {
    cwd: cmd.cwd,
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const lines = createInterface({ input: child.stderr as NodeJS.ReadableStream });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('shop-mcp --http did not start in 15s')), 15_000);
    lines.on('line', (line) => {
      const m = /(http:\/\/\S+\/mcp)/.exec(line);
      if (m) {
        clearTimeout(timer);
        resolve(m[1] as string);
      }
    });
    child.on('exit', (code) => reject(new Error(`shop-mcp exited with ${code}`)));
  });
  return { url, child };
}

/**
 * vendor-api (in-process) <- HTTP tap <- shop-mcp <- [fiks-proxy] <- MCP client.
 * The tap always sits between shop-mcp and the vendor, so every call's upstream HTTP is known.
 */
export async function startHarness(opts: HarnessOptions): Promise<Harness> {
  const dir = opts.shopDir ?? defaultShopDir();
  const clock = opts.clock;
  const vendor = createVendor({
    version: opts.vendor,
    drifts: opts.drifts,
    now: clock ? () => clock : undefined,
  });
  const vendorUrl = await vendor.listen();
  const tap = await startTap(vendorUrl);
  const env = { ...getDefaultEnvironment(), VENDOR_BASE_URL: tap.url };
  const transport = opts.transport ?? 'stdio';
  const client = new Client({ name: 'fiks-harness', version: '0.1.0' });
  const cleanups: (() => Promise<unknown> | unknown)[] = [];
  let proxy: FiksProxy | undefined;
  let lastRecord: CallRecord | undefined;

  if (opts.via === 'proxy') {
    let upstream: ProxyOptions['upstream'];
    if (transport === 'http') {
      const shop = await spawnShopHttp(dir, env);
      cleanups.push(() => shop.child.kill());
      upstream = { transport: 'http', url: shop.url };
    } else {
      upstream = { transport: 'stdio', ...shopCommand(dir), env };
    }
    proxy = await startProxy({
      upstream,
      contracts: opts.contracts ?? SHOP_CONTRACTS,
      tap,
      onCall: async (rec) => {
        lastRecord = rec;
        return opts.onCall?.(rec);
      },
    });
    cleanups.push(() => proxy?.close());
    if (transport === 'http') {
      const listener = await listenHttp(proxy);
      cleanups.push(() => listener.close());
      await client.connect(new StreamableHTTPClientTransport(new URL(listener.url)));
    } else {
      const [a, b] = InMemoryTransport.createLinkedPair();
      await proxy.connect(a);
      await client.connect(b);
    }
  } else if (transport === 'http') {
    const shop = await spawnShopHttp(dir, env);
    cleanups.push(() => shop.child.kill());
    await client.connect(new StreamableHTTPClientTransport(new URL(shop.url)));
  } else {
    await client.connect(new StdioClientTransport({ ...shopCommand(dir), env, stderr: 'pipe' }));
  }

  return {
    vendor,
    vendorUrl,
    vendorDrifts: vendor.state.drifts,
    tap,
    client,
    proxy,
    async call(tool, args) {
      lastRecord = undefined;
      tap.take();
      const result = (await client.callTool({ name: tool, arguments: args })) as CallToolResult;
      // Through the proxy, the proxy drains the tap per call; its record holds the exchanges.
      const record = lastRecord as CallRecord | undefined; // set by onCall during the await
      const http = record ? record.http : tap.take();
      return { result, http, record };
    },
    async close() {
      await client.close();
      for (const c of cleanups.reverse()) await c();
      await tap.close();
      await vendor.close();
    },
  };
}
