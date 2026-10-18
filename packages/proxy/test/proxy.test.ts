import type { ContractFile } from '@fiks/contracts';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type CallRecord, RECEIPT_META_KEY, type Receipt } from '../src/index.ts';
import { proxied } from './support.ts';

const CONTRACTS: ContractFile = {
  server: 'fake',
  version: 1,
  contracts: [
    {
      id: 'fake.get_product',
      tool: 'get_product',
      invariants: [{ id: 'price.notNull', kind: 'notNull', path: 'price', onlyKnownGood: true }],
      knownGoodInputs: [{ id: 'p-1' }],
    },
  ],
};

let env: Awaited<ReturnType<typeof proxied>> | undefined;
afterEach(async () => {
  await env?.close();
  env = undefined;
});

function build(server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer) {
  server.registerTool(
    'get_product',
    { inputSchema: { id: z.string() }, outputSchema: { id: z.string(), price: z.number().nullable() } },
    async ({ id }) => {
      const data = { id, price: id === 'p-1' ? null : 10 };
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    },
  );
  server.registerTool('echo', { inputSchema: { s: z.string() } }, async ({ s }) => ({
    content: [{ type: 'text', text: s }],
  }));
  server.registerTool('boom', {}, async () => ({
    isError: true,
    content: [{ type: 'text', text: 'it broke' }],
  }));
}

const receiptOf = (r: CallToolResult) => r._meta?.[RECEIPT_META_KEY] as Receipt;
const lastText = (r: CallToolResult) => (r.content.at(-1) as { text: string }).text;

describe('fiks proxy', () => {
  test('violation: upstream content kept, receipt in _meta and a final text block', async () => {
    const records: CallRecord[] = [];
    env = await proxied(build, CONTRACTS, {
      onCall: (rec) => {
        records.push(rec);
        return { traceId: 'tr_test' };
      },
    });
    const r = (await env.client.callTool({
      name: 'get_product',
      arguments: { id: 'p-1' },
    })) as CallToolResult;
    const { fiks_receipt, ...upstream } = r.structuredContent as Record<string, unknown>;
    expect(upstream).toEqual({ id: 'p-1', price: null });
    // Claude Code shows the model only structuredContent: the receipt must be in it too.
    expect(fiks_receipt).toBe(lastText(r));
    expect(r.content[0]).toEqual({ type: 'text', text: '{"id":"p-1","price":null}' });
    expect(r.content).toHaveLength(2);
    expect(receiptOf(r)).toMatchObject({
      v: 1,
      verdict: 'violated',
      contractId: 'fake.get_product',
      traceId: 'tr_test',
    });
    expect(lastText(r)).toMatch(/^\[fiks\] VIOLATED get_product: price is null, but p-1 should have one\. /);
    expect(records[0]?.result).toEqual({
      content: [{ type: 'text', text: '{"id":"p-1","price":null}' }],
      structuredContent: { id: 'p-1', price: null },
    });
  });

  test('verified result', async () => {
    env = await proxied(build, CONTRACTS);
    const r = (await env.client.callTool({
      name: 'get_product',
      arguments: { id: 'p-2' },
    })) as CallToolResult;
    expect(receiptOf(r).verdict).toBe('verified');
    expect(receiptOf(r).checked).toContain('fake.get_product/outputSchema');
    expect(lastText(r)).toBe('[fiks] VERIFIED get_product (1 check)');
  });

  test('a tool with no contract is unverifiable and otherwise untouched', async () => {
    env = await proxied(build, CONTRACTS);
    const r = (await env.client.callTool({ name: 'echo', arguments: { s: 'hi' } })) as CallToolResult;
    expect(receiptOf(r)).toMatchObject({ verdict: 'unverifiable', contractId: null });
    expect(r.content[0]).toEqual({ type: 'text', text: 'hi' });
    expect(lastText(r)).toBe('[fiks] NOT CHECKED echo: no contract for this tool');
  });

  test('upstream isError passes through as isError', async () => {
    env = await proxied(build, CONTRACTS);
    const r = (await env.client.callTool({ name: 'boom', arguments: {} })) as CallToolResult;
    expect(r.isError).toBe(true);
    expect(r.content[0]).toEqual({ type: 'text', text: 'it broke' });
    expect(receiptOf(r).verdict).toBe('unverifiable');
  });

  test('tools/list is forwarded with output schemas', async () => {
    env = await proxied(build, CONTRACTS);
    const { tools } = await env.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['boom', 'echo', 'get_product']);
    const schema = tools.find((t) => t.name === 'get_product')?.outputSchema as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties).sort()).toEqual(['fiks_receipt', 'id', 'price']);
  });

  test('the receipt field can be disabled', async () => {
    env = await proxied(build, CONTRACTS, { receiptField: null });
    const r = (await env.client.callTool({
      name: 'get_product',
      arguments: { id: 'p-1' },
    })) as CallToolResult;
    expect(r.structuredContent).toEqual({ id: 'p-1', price: null });
    const { tools } = await env.client.listTools();
    const schema = tools.find((t) => t.name === 'get_product')?.outputSchema as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties).sort()).toEqual(['id', 'price']);
  });
});
