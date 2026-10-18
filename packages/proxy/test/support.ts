import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ContractFile } from '@fiks/contracts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type ProxyOptions, startProxy, startTap } from '../src/index.ts';

/** A tiny HTTP "vendor" with a handler per request. */
export async function fakeVendor(handler: (method: string, url: string) => [number, unknown]) {
  const server: Server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const [status, body] = handler(req.method ?? 'GET', req.url ?? '/');
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** fake upstream MCP server (in-memory) <- fiks proxy <- client. */
export async function proxied(
  build: (server: McpServer) => void,
  contracts: ContractFile,
  extra: Partial<ProxyOptions> = {},
) {
  const upstreamServer = new McpServer({ name: 'fake', version: '1.0.0' });
  build(upstreamServer);
  const proxy = await startProxy({
    contracts,
    upstream: {
      transport: 'custom',
      create: () => {
        const [a, b] = InMemoryTransport.createLinkedPair();
        void upstreamServer.connect(a);
        return b;
      },
    },
    ...extra,
  });
  const [c, d] = InMemoryTransport.createLinkedPair();
  await proxy.connect(c);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(d);
  return {
    client,
    proxy,
    async close() {
      await client.close();
      await proxy.close();
      await upstreamServer.close();
    },
  };
}

export { startTap };

/** A low-level upstream server with arbitrary tools/list and tools/call handlers (no SDK validation). */
export async function rawProxied(
  tools: import('@modelcontextprotocol/sdk/types.js').Tool[],
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  contracts: ContractFile,
  extra: Partial<ProxyOptions> = {},
) {
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import(
    '@modelcontextprotocol/sdk/types.js'
  );
  const upstreamServer = new Server({ name: 'raw', version: '1.0.0' }, { capabilities: { tools: {} } });
  upstreamServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  upstreamServer.setRequestHandler(
    CallToolRequestSchema,
    async (req) =>
      (await call(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>)) as never,
  );
  const proxy = await startProxy({
    contracts,
    upstream: {
      transport: 'custom',
      create: () => {
        const [a, b] = InMemoryTransport.createLinkedPair();
        void upstreamServer.connect(a);
        return b;
      },
    },
    ...extra,
  });
  const [c, d] = InMemoryTransport.createLinkedPair();
  await proxy.connect(c);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(d);
  return {
    client,
    async close() {
      await client.close();
      await proxy.close();
      await upstreamServer.close();
    },
  };
}
