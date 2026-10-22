#!/usr/bin/env node
// A tiny stdio MCP server for the traffic tests: three tools over a fixed catalog. It reads
// FIXTURE_BASE_URL only to report it (the tests' vendor is a stand-in), so it needs no network.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const ITEMS = { 'x-101': 'red mug', 'x-102': 'blue mug', 'x-103': 'green plate' };
const text = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
const server = new McpServer({ name: 'catalog', version: '1.0.0' });
server.registerTool(
  'get_item',
  { description: 'One catalog item by id.', inputSchema: { id: z.string() } },
  async ({ id }) =>
    ITEMS[id]
      ? text({ id, name: ITEMS[id] })
      : { isError: true, content: [{ type: 'text', text: 'not found' }] },
);
server.registerTool(
  'search',
  {
    description: 'Items whose name contains the query.',
    inputSchema: { query: z.string(), limit: z.number().int().min(1).optional() },
  },
  async ({ query, limit }) =>
    text(
      Object.entries(ITEMS)
        .filter(([, n]) => n.includes(query))
        .slice(0, limit ?? 10)
        .map(([id, name]) => ({ id, name })),
    ),
);
server.registerTool(
  'place_order',
  {
    description: 'Order items.',
    inputSchema: {
      items: z.array(z.object({ id: z.string(), qty: z.number().int().min(1) })).min(1),
    },
  },
  async ({ items }) =>
    text({ order: 'o-1', lines: items.length, vendor: process.env.FIXTURE_BASE_URL ?? null }),
);
await server.connect(new StdioServerTransport());
