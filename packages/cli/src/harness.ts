import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { type ContractFile, type HttpExchange, SHOP_CONTRACTS } from '@fiks/contracts';
import { getDomain, listDomains } from '@fiks/domains';
import type {
  Catalog,
  Domain,
  DomainVendor,
  InjectorRule,
  ServerCommand,
  UpstreamMiddleware,
} from '@fiks/interfaces';
import {
  type CallRecord,
  type FiksProxy,
  listenHttp,
  type ProxyOptions,
  startProxy,
  startTap,
  type Tap,
} from '@fiks/proxy';
import { createVendor, injectorMiddleware } from '@fiks/vendor-api';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { shopDir as defaultShopDir } from './paths.ts';

export {
  clearInjectorFactory,
  getInjectorFactory,
  type InjectorFactory,
  registerInjectorFactory,
} from '@fiks/vendor-api';

export interface HarnessOptions {
  /** Vendor version, e.g. `v1` | `v2`. */
  vendor: string;
  /** e.g. "D2". Defaults to every drift on v2. */
  drifts?: string;
  /** The Domain to run (default `shop`). */
  domain?: string;
  /** Vendor catalog option (default `original`). */
  catalog?: Catalog;
  /** An injector rule applied in front of the vendor (P7); its middleware comes from the Domain. */
  injector?: InjectorRule;
  /** More upstream links, in order after the injector and before the tap. */
  middleware?: UpstreamMiddleware[];
  /** Checkout of the tool server (default: the domain's repo; shop: .work/shop-mcp). */
  shopDir?: string;
  /** `direct`: the client talks to the server. `proxy`: through fiks-proxy (default direct). */
  via?: 'direct' | 'proxy';
  /** Transport on both sides of the proxy (default stdio). */
  transport?: 'stdio' | 'http';
  contracts?: ContractFile;
  onCall?: ProxyOptions['onCall'];
  /**
   * Freeze the clock: the vendor's (recordings, so re-recordings get identical timestamps) and
   * the proxy's evaluation `now` (so `CallRecord.at` equals it; PLAN 3.1 "Clock").
   */
  clock?: Date;
}

export interface Harness {
  domain: string;
  vendor: DomainVendor;
  vendorUrl: string;
  vendorDrifts: string[];
  /** Upstream chain, vendor first: e.g. ['vendor', 'injector:D3', 'tap']. */
  chain: string[];
  tap: Tap;
  client: Client;
  proxy?: FiksProxy;
  call(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ result: CallToolResult; http: HttpExchange[]; record?: CallRecord }>;
  close(): Promise<void>;
}

/** The Domain `id`; `shop` resolves even when the CLI bootstrap has not registered it. */
export function harnessDomain(id = 'shop'): Domain | undefined {
  if (listDomains().some((d) => d.id === id)) return getDomain(id);
  if (id === 'shop') return undefined;
  return getDomain(id);
}

/** Command that starts shop-mcp from a checkout. */
export function shopCommand(dir: string): { command: string; args: string[]; cwd: string } {
  return { command: join(dir, 'node_modules/.bin/tsx'), args: ['src/main.ts'], cwd: dir };
}

/** Starts the server with `--http 0` and resolves its /mcp URL from the startup line. */
async function spawnServerHttp(
  cmd: ServerCommand,
  env: NodeJS.ProcessEnv,
): Promise<{ url: string; child: ChildProcess }> {
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
 * vendor (in-process) <- [injector] <- [middleware...] <- HTTP tap <- server <- [fiks-proxy] <-
 * MCP client. The tap always sits right in front of the server, so every call's upstream HTTP
 * is known. Each harness starts its own chain; `rerecord()` restarts it per recording (P7).
 */
export async function startHarness(opts: HarnessOptions): Promise<Harness> {
  const domain = harnessDomain(opts.domain);
  const dir = opts.shopDir ?? domain?.repo.dir() ?? defaultShopDir();
  const clock = opts.clock;
  const now = clock ? () => clock : undefined;
  const vendor: DomainVendor = domain
    ? domain.createVendor(opts.catalog ?? 'original', { version: opts.vendor, drifts: opts.drifts, now })
    : createVendor({
        version: opts.vendor as 'v1' | 'v2',
        drifts: opts.drifts,
        now,
        catalog: opts.catalog,
      });
  const vendorUrl = await vendor.listen();
  const links: UpstreamMiddleware[] = [
    ...(opts.injector
      ? [domain ? domain.injectorHook(opts.injector) : injectorMiddleware(opts.injector)]
      : []),
    ...(opts.middleware ?? []),
  ];
  const chain = ['vendor'];
  const linkClosers: (() => Promise<void>)[] = [];
  let upstreamUrl = vendorUrl;
  try {
    for (const link of links) {
      const started = await link.start(upstreamUrl);
      linkClosers.push(() => started.close());
      upstreamUrl = started.url;
      chain.push(link.name);
    }
  } catch (e) {
    for (const c of linkClosers.reverse()) await c();
    await vendor.close();
    throw e;
  }
  const tap = await startTap(upstreamUrl);
  chain.push('tap');
  const baseUrlEnv = domain?.baseUrlEnv ?? 'VENDOR_BASE_URL';
  const env = { ...getDefaultEnvironment(), [baseUrlEnv]: tap.url };
  const serverCmd = domain ? domain.serverCommand(dir) : shopCommand(dir);
  const contracts =
    opts.contracts ??
    (domain && domain.id !== 'shop'
      ? (JSON.parse(readFileSync(domain.contractsPath, 'utf8')) as ContractFile)
      : SHOP_CONTRACTS);
  const transport = opts.transport ?? 'stdio';
  const client = new Client({ name: 'fiks-harness', version: '0.1.0' });
  const cleanups: (() => Promise<unknown> | unknown)[] = [];
  let proxy: FiksProxy | undefined;
  let lastRecord: CallRecord | undefined;

  if (opts.via === 'proxy') {
    let upstream: ProxyOptions['upstream'];
    if (transport === 'http') {
      const server = await spawnServerHttp(serverCmd, env);
      cleanups.push(() => server.child.kill());
      upstream = { transport: 'http', url: server.url };
    } else {
      upstream = { transport: 'stdio', ...serverCmd, env };
    }
    proxy = await startProxy({
      upstream,
      contracts,
      tap,
      // The proxy evaluates at the frozen clock too, so CallRecord.at equals the vendor clock.
      ...(now ? { now } : {}),
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
    const server = await spawnServerHttp(serverCmd, env);
    cleanups.push(() => server.child.kill());
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
  } else {
    await client.connect(new StdioClientTransport({ ...serverCmd, env, stderr: 'pipe' }));
  }

  const state = vendor.state as { drifts?: unknown };
  return {
    domain: domain?.id ?? 'shop',
    vendor,
    vendorUrl,
    vendorDrifts: Array.isArray(state?.drifts) ? (state.drifts as string[]) : [],
    chain,
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
      for (const c of linkClosers.reverse()) await c();
      await vendor.close();
    },
  };
}
