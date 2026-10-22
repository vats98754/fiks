#!/usr/bin/env node
// A tiny stdio MCP server for the ollama tool-loop smoke and tests: one tool, `add`.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'calc', version: '1.0.0' });
server.registerTool(
  'add',
  { description: 'Add two integers and return the sum.', inputSchema: { a: z.number(), b: z.number() } },
  async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }),
);
await server.connect(new StdioServerTransport());
