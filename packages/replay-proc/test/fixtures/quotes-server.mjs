#!/usr/bin/env node
// A small real MCP stdio server for replay tests. Its upstream calls carry what real servers send
// and strict replay cannot match: an OAuth token fetch with a fresh nonce, a random request id,
// a nonce and a timestamp in the query. QUOTES_BASE_URL overrides the hard-coded https host.
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = (process.env.QUOTES_BASE_URL ?? 'https://api.quotes.example').replace(/\/$/, '');
const OTHER = 'https://other.example';

async function token() {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=fiks-test&nonce=${randomUUID()}`,
  });
  return (await res.json()).access_token;
}

const server = new McpServer({ name: 'quotes', version: '0.0.1' });

server.registerTool(
  'get_quote',
  {
    description: 'Latest quote for a symbol.',
    inputSchema: { symbol: z.string() },
    outputSchema: { symbol: z.string(), price: z.number(), as_of: z.string() },
  },
  async ({ symbol }) => {
    const auth = await token();
    const q = `nonce=${randomUUID()}&ts=${Date.now()}`;
    const res = await fetch(`${BASE}/quotes/${encodeURIComponent(symbol)}?${q}`, {
      headers: { authorization: `Bearer ${auth}`, 'x-request-id': randomUUID() },
    });
    if (res.status !== 200) {
      return {
        isError: true,
        content: [{ type: 'text', text: `upstream ${res.status}: ${await res.text()}` }],
      };
    }
    const body = await res.json();
    const out = { symbol: body.symbol, price: body.price, as_of: body.as_of };
    return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
  },
);

server.registerTool(
  'clock',
  { description: 'The server process clock.', inputSchema: {}, outputSchema: { now: z.string() } },
  async () => {
    const out = { now: new Date().toISOString(), nowMs: Date.now() };
    return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: { now: out.now } };
  },
);

server.registerTool(
  'reach_other',
  { description: 'Calls a host the replay does not shim.', inputSchema: {} },
  async () => {
    try {
      const res = await fetch(`${OTHER}/x`);
      return { content: [{ type: 'text', text: `status ${res.status}` }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `failed: ${e.cause?.message ?? e.message}` }] };
    }
  },
);

await server.connect(new StdioServerTransport());
