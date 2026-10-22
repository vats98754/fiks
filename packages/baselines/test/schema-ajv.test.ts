import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import {
  createAjvMonitor,
  createSchemaMonitor,
  findOperation,
  m7StringPrice,
  mergeSpecConstraints,
  strictify,
  strictSchemaFor,
} from '../src/index.ts';
import { bench, find, input, ROOT } from './helpers.ts';

const OPENAPI = JSON.parse(readFileSync(join(ROOT, 'packages/vendor-api/openapi.json'), 'utf8'));
const { v1, v2 } = bench();
const v1Product = () => find(v1, (r) => r.tool === 'get_product');
const d2Product = () => find(v2, (r) => r.drift === 'D2');

describe('B-SCHEMA (MCP SDK client validation)', () => {
  const schema = createSchemaMonitor();
  afterAll(() => schema.close());

  test('a v1 result is verified', async () => {
    expect((await schema(input(v1Product()))).verdict).toBe('verified');
  });
  test('D2 (price null, declared nullable) passes the SDK check', async () => {
    const rec = d2Product();
    expect((rec.output.structuredContent as { price: unknown }).price).toBeNull();
    expect((await schema(input(rec))).verdict).toBe('verified');
  });
  test('an M7 string price is rejected by Client.callTool', async () => {
    const r = await schema(input(m7StringPrice(v1Product())));
    expect(r.verdict).toBe('violated');
    expect(r.violations[0]?.message).toMatch(/does not match the tool's output schema/);
  });
  test('missing structuredContent is rejected (SDK rule); isError is not', async () => {
    const rec = v1Product();
    const noStructured = { ...rec, output: { content: rec.output.content } };
    expect((await schema(input(noStructured))).verdict).toBe('violated');
    const err = { ...rec, output: { content: [{ type: 'text', text: 'boom' }], isError: true } };
    expect((await schema(input(err))).verdict).toBe('verified');
  });
  test('no declared outputSchema -> unverifiable', async () => {
    const r = await schema({ ...input(v1Product()), toolDef: { name: 'get_product' } });
    expect(r.verdict).toBe('unverifiable');
  });
  test('concurrent calls each get their own verdict', async () => {
    const rs = await Promise.all(
      [input(v1Product()), input(m7StringPrice(v1Product())), input(d2Product())].map(schema),
    );
    expect(rs.map((r) => r.verdict)).toEqual(['verified', 'violated', 'verified']);
  });
});

describe('B-AJV (Ajv 2020-12 strict + formats)', () => {
  const ajv = createAjvMonitor({ openapi: OPENAPI });

  test('strictify closes objects, requires every property and derives formats from descriptions', () => {
    const s = strictify({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        a: { type: 'string', description: 'When, ISO-8601 UTC.' },
        b: { type: 'object', properties: { c: { type: 'number' } } },
      },
    });
    expect(s).toEqual({
      type: 'object',
      properties: {
        a: { type: 'string', description: 'When, ISO-8601 UTC.', format: 'date-time' },
        b: {
          type: 'object',
          properties: { c: { type: 'number' } },
          additionalProperties: false,
          required: ['c'],
        },
      },
      additionalProperties: false,
      required: ['a', 'b'],
    });
  });
  test('findOperation matches path templates and resolves the response schema', () => {
    const op = findOperation(OPENAPI, 'GET', '/orders/o-5001');
    expect(op?.operationId).toBe('getOrder');
    expect((op?.responseSchema?.properties as Record<string, unknown> | undefined)?.created_at).toEqual({
      type: 'string',
      format: 'date-time',
    });
    expect(findOperation(OPENAPI, 'GET', '/products?q=laptop')?.operationId).toBe('searchProducts');
    expect(findOperation(OPENAPI, 'DELETE', '/orders/x')).toBeNull();
  });
  test('mergeSpecConstraints copies value constraints onto same-named, type-compatible properties', () => {
    const merged = mergeSpecConstraints(
      { type: 'object', properties: { q: { type: 'integer' }, s: { type: 'string' } } },
      {
        type: 'object',
        properties: { q: { type: 'integer', minimum: 1 }, s: { type: 'number', minimum: 3 } },
      },
    );
    expect(merged.properties).toEqual({ q: { type: 'integer', minimum: 1 }, s: { type: 'string' } });
  });
  test('get_order picks up the spec date-time format', () => {
    const rec = find(v1, (r) => r.tool === 'get_order' && r.output.isError !== true);
    const s = strictSchemaFor(input(rec), { openapi: OPENAPI });
    expect((s?.properties as Record<string, { format?: string }> | undefined)?.created_at?.format).toBe(
      'date-time',
    );
  });
  test('v1 results are verified; the M7 string price is violated', () => {
    for (const rec of v1)
      expect(ajv(input(rec)), rec.callId).toMatchObject({
        verdict: expect.stringMatching(/verified|unverifiable/),
      });
    const r = ajv(input(m7StringPrice(v1Product())));
    expect(r).toMatchObject({ verdict: 'violated' });
    expect(JSON.stringify(r)).toContain('/price');
  });
  test('an extra field and a malformed timestamp are violations', () => {
    const rec = v1Product();
    (rec.output.structuredContent as Record<string, unknown>).extra = 1;
    expect(ajv(input(rec))).toMatchObject({ verdict: 'violated' });
    const order = find(v1, (r) => r.tool === 'get_order' && r.output.isError !== true);
    (order.output.structuredContent as Record<string, unknown>).created_at = 'yesterday';
    expect(ajv(input(order))).toMatchObject({ verdict: 'violated' });
  });
  test('isError or no declared schema -> unverifiable', () => {
    const rec = v1Product();
    expect(ajv({ ...input(rec), result: { isError: true, content: [] } })).toMatchObject({
      verdict: 'unverifiable',
    });
    expect(ajv({ ...input(rec), toolDef: null, declaredOutputSchema: undefined })).toMatchObject({
      verdict: 'unverifiable',
    });
  });
});
