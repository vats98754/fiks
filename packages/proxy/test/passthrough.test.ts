// The proxy never rewrites or replaces an upstream result; it only adds its receipt.
import type { ContractFile } from '@fiks/contracts';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, expect, test } from 'vitest';
import { type CallRecord, RECEIPT_META_KEY, type Receipt } from '../src/index.ts';
import { fakeVendor, rawProxied, startTap } from './support.ts';

const outputSchema = {
  type: 'object' as const,
  properties: { id: { type: 'string' }, price: { type: ['number', 'null'] } },
  required: ['id'],
};
const CONTRACTS: ContractFile = {
  server: 'raw',
  version: 1,
  contracts: [
    { id: 'raw.get', tool: 'get', invariants: [] },
    {
      id: 'raw.write',
      tool: 'write',
      invariants: [],
      postconditions: [
        {
          id: 'readAfterWrite',
          probeTool: 'read',
          probeArgs: { id: 'id' },
          expect: [{ probePath: 'id', equalsResultPath: 'id' }],
        },
      ],
    },
  ],
};
const TOOLS = [
  { name: 'get', inputSchema: { type: 'object' as const }, outputSchema },
  { name: 'write', inputSchema: { type: 'object' as const } },
  { name: 'read', inputSchema: { type: 'object' as const } },
];

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const receipt = (r: CallToolResult) => r._meta?.[RECEIPT_META_KEY] as Receipt;

test('a result that breaks its declared outputSchema passes through, with a violated receipt', async () => {
  const bad = { content: [{ type: 'text', text: 'x' }], structuredContent: { id: 'a', price: 'free' } };
  const env = await rawProxied(TOOLS, async () => bad, CONTRACTS);
  cleanups.push(env.close);
  const r = (await env.client.request(
    { method: 'tools/call', params: { name: 'get', arguments: {} } },
    (
      await import('@modelcontextprotocol/sdk/types.js')
    ).CallToolResultSchema,
  )) as CallToolResult;
  expect(r.structuredContent).toMatchObject(bad.structuredContent);
  expect(Object.keys(r.structuredContent ?? {}).sort()).toEqual(['fiks_receipt', 'id', 'price']);
  expect(r.content[0]).toEqual(bad.content[0]);
  expect(receipt(r).violations.map((v) => v.propertyId)).toEqual(['raw.get/outputSchema']);
});

test('a probe that throws does not replace the write result', async () => {
  const env = await rawProxied(
    TOOLS,
    async (name) => {
      if (name === 'read') throw new Error('backend exploded');
      return { content: [{ type: 'text', text: 'written' }], structuredContent: { id: 'w-1' } };
    },
    CONTRACTS,
  );
  cleanups.push(env.close);
  const r = (await env.client.callTool({ name: 'write', arguments: {} })) as CallToolResult;
  expect(r.isError).toBeFalsy();
  expect(r.structuredContent).toMatchObject({ id: 'w-1' });
  expect(receipt(r).verdict).toBe('violated');
  expect(receipt(r).violations[0]?.message).toMatch(/not found on read-back/);
});

test('an onCall that throws does not break the call', async () => {
  const env = await rawProxied(
    TOOLS,
    async () => ({ content: [], structuredContent: { id: 'a', price: 1 } }),
    CONTRACTS,
    {
      onCall: () => {
        throw new Error('disk full');
      },
    },
  );
  cleanups.push(env.close);
  const r = (await env.client.callTool({ name: 'get', arguments: {} })) as CallToolResult;
  expect(receipt(r).verdict).toBe('verified');
});

test('calls are serialized: each record holds only its own upstream exchanges', async () => {
  // Earlier calls are slower, so without the lock their exchanges would interleave.
  const vendor = await fakeVendor((_m, url) => [200, { url }]);
  const tap = await startTap(vendor.url);
  const records: CallRecord[] = [];
  const env = await rawProxied(
    TOOLS,
    async (_name, args) => {
      const id = String(args.id);
      await fetch(`${tap.url}/a?id=${id}`);
      await new Promise((r) => setTimeout(r, Number(args.delay)));
      await fetch(`${tap.url}/b?id=${id}`);
      return { content: [], structuredContent: { id, price: 1 } };
    },
    CONTRACTS,
    { tap, onCall: (rec) => void records.push(rec) },
  );
  cleanups.push(vendor.close, tap.close, env.close);
  await Promise.all(
    [
      ['1', 120],
      ['2', 80],
      ['3', 40],
      ['4', 0],
    ].map(([id, delay]) => env.client.callTool({ name: 'get', arguments: { id, delay } })),
  );
  expect(records).toHaveLength(4);
  for (const rec of records) {
    const id = String(rec.args.id);
    expect(rec.http.map((e) => e.request.url)).toEqual([`/a?id=${id}`, `/b?id=${id}`]);
  }
});
