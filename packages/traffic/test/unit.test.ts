import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  callsFromTranscript,
  canonical,
  dedupeKey,
  defaultTaskFile,
  loadTaskFile,
  resolveTasks,
  rowsOf,
  schemaError,
  sdkStdio,
  selectTasks,
  synthArgs,
  tasksFromDomain,
} from '../src/index.ts';

const TRACKER_PROMPTS = fileURLToPath(new URL('../../vendor-tracker/tasks/prompts.json', import.meta.url));

describe('canonical JSON', () => {
  test('sorts keys recursively and drops undefined members; dedupeKey ignores key order', () => {
    expect(canonical({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[{"y":2,"z":1}]},"b":1}',
    );
    expect(dedupeKey('shop', 'S-agent', 't', { a: 1, b: 2 })).toBe(
      dedupeKey('shop', 'S-agent', 't', { b: 2, a: 1 }),
    );
    expect(dedupeKey('shop', 'S-agent', 't', { a: 1 })).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe('schemaError', () => {
  const order = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: { product_id: { type: 'string' }, quantity: { type: 'integer', minimum: 1 } },
          required: ['product_id', 'quantity'],
          additionalProperties: false,
        },
      },
      state: { type: 'string', enum: ['open', 'closed'] },
    },
    required: ['items'],
    additionalProperties: false,
  };
  test('accepts valid args', () => {
    expect(schemaError(order, { items: [{ product_id: 'p-1', quantity: 2 }] })).toBeNull();
    expect(schemaError(order, { items: [{ product_id: 'p-1', quantity: 1 }], state: 'open' })).toBeNull();
  });
  test.each([
    [{}, '$.items: required'],
    [{ items: [] }, '$.items: fewer than 1 items'],
    [{ items: [{ product_id: 'p', quantity: 0 }] }, '$.items[0].quantity: < 1'],
    [{ items: [{ product_id: 'p', quantity: 1.5 }] }, '$.items[0].quantity: expected integer, got number'],
    [{ items: [{ product_id: 7, quantity: 1 }] }, '$.items[0].product_id: expected string, got integer'],
    [{ items: [{ product_id: 'p', quantity: 1, x: 1 }] }, '$.items[0].x: not allowed'],
    [
      { items: [{ product_id: 'p', quantity: 1 }], state: 'gone' },
      '$.state: "gone" is not one of ["open","closed"]',
    ],
    [{ items: [{ product_id: 'p', quantity: 1 }], extra: true }, '$.extra: not allowed'],
  ])('rejects %j', (args, reason) => {
    expect(schemaError(order, args)).toBe(reason);
  });
  test('anyOf, nullable type lists, number accepts integers', () => {
    const s = { anyOf: [{ type: 'string' }, { type: 'integer' }] };
    expect(schemaError(s, 'a')).toBeNull();
    expect(schemaError(s, 3)).toBeNull();
    expect(schemaError(s, true)).not.toBeNull();
    expect(schemaError({ type: ['string', 'null'] }, null)).toBeNull();
    expect(schemaError({ type: 'number' }, 3)).toBeNull();
  });
});

describe('task prompts', () => {
  test('the shop has 20 held-out prompts in packages/traffic/tasks/shop.json', () => {
    const file = defaultTaskFile('shop');
    expect(file).toBeDefined();
    const set = loadTaskFile(file as string, 'shop');
    expect(set.source).toBe('packages/traffic/tasks/shop.json');
    expect(set.tasks.map((t) => t.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `s${String(i + 1).padStart(2, '0')}`),
    );
    expect(set.sha256).toMatch(/^[0-9a-f]{64}$/);
    // The bench's graded shop tasks (T1-T6) are a different set; the shop domain's own tasks are not used.
    const viaDomain = resolveTasks({ id: 'shop', tasks: [{ id: 'T1', prompt: 'x' }] });
    expect(viaDomain.tasks).toHaveLength(20);
  });
  test("the tracker's 20 prompts (DOM2 tasks/prompts.json) load as a task file and as Domain.tasks", () => {
    const set = loadTaskFile(TRACKER_PROMPTS, 'tracker');
    expect(set.tasks).toHaveLength(20);
    expect(defaultTaskFile('tracker')).toBeUndefined();
    const raw = JSON.parse(readFileSync(TRACKER_PROMPTS, 'utf8')) as {
      tasks: { id: string; prompt: string }[];
    };
    const fromDomain = resolveTasks({ id: 'tracker', tasks: raw.tasks });
    expect(fromDomain.source).toBe('Domain.tasks');
    expect(fromDomain.sha256).toBe(set.sha256);
    expect(() => loadTaskFile(TRACKER_PROMPTS, 'shop')).toThrow(/prompts for domain tracker, not shop/);
  });
  test('selection keeps set order, rejects unknown ids, and changes the hash', () => {
    const set = tasksFromDomain({
      id: 'd',
      tasks: [
        { id: 'a', prompt: 'A' },
        { id: 'b', prompt: 'B' },
        { id: 'c', prompt: 'C' },
      ],
    });
    const sel = selectTasks(set, ['c', 'a']);
    expect(sel.tasks.map((t) => t.id)).toEqual(['a', 'c']);
    expect(sel.sha256).not.toBe(set.sha256);
    expect(selectTasks(set, undefined)).toBe(set);
    expect(() => selectTasks(set, ['zz'])).toThrow(/unknown task id\(s\) for d: zz/);
    expect(() =>
      tasksFromDomain({
        id: 'd',
        tasks: [
          { id: 'a', prompt: 'x' },
          { id: 'a', prompt: 'y' },
        ],
      }),
    ).toThrow(/duplicate task id a/);
    expect(() => tasksFromDomain({ id: 'd', tasks: [] })).toThrow(/no task prompts/);
  });
});

describe('Claude transcript parsing', () => {
  const line = (v: unknown) => JSON.stringify(v);
  const use = (id: string, name: string, input: unknown) => ({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name, input }] },
  });
  const result = (id: string, isError: boolean) => ({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: 'x' }] },
  });
  test('keeps the last attempt, strips the server prefix, pairs tool results', () => {
    const text = [
      { type: 'fiks_session_header' },
      { type: 'fiks_attempt', attempt: 1 },
      use('old', 'mcp__shop__get_product', { id: 'stale' }),
      { type: 'fiks_attempt', attempt: 2 },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Looking.' }] } },
      use('u1', 'mcp__shop__search_products', { query: 'laptop' }),
      result('u1', false),
      use('u2', 'mcp__shop__get_product', { id: 'p-9' }),
      result('u2', true),
      use('u3', 'mcp__other__x', { a: 1 }),
      use('u4', 'mcp__shop__get_order', 'not an object'),
      { type: 'fiks_session_footer' },
    ]
      .map(line)
      .join('\n');
    expect(callsFromTranscript(text, 'shop')).toEqual([
      { tool: 'search_products', args: { query: 'laptop' }, toolError: false },
      { tool: 'get_product', args: { id: 'p-9' }, toolError: true },
      { tool: 'get_order', args: null, rawArgs: '"not an object"', toolError: null },
    ]);
  });
});

describe('rows', () => {
  test('rows carry agent, model, task id, trial and seq, and say why a call is invalid', () => {
    const tools = [
      {
        name: 'get_item',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
    ];
    const rows = rowsOf(
      'd',
      { name: 'opus', model: 'claude-opus-5-5' },
      { taskId: 'q1', trial: 2 },
      [
        { tool: 'get_item', args: { id: 'x' }, toolError: false },
        { tool: 'get_item', args: {}, toolError: true },
        { tool: 'nope', args: { id: 'x' }, toolError: true },
        { tool: 'get_item', args: null, rawArgs: '{bad', toolError: null },
      ],
      tools,
    );
    expect(rows.map((r) => [r.agent, r.model, r.taskId, r.trial, r.seq, r.stratum, r.valid])).toEqual([
      ['opus', 'claude-opus-5-5', 'q1', 2, 1, 'S-agent', true],
      ['opus', 'claude-opus-5-5', 'q1', 2, 2, 'S-agent', false],
      ['opus', 'claude-opus-5-5', 'q1', 2, 3, 'S-agent', false],
      ['opus', 'claude-opus-5-5', 'q1', 2, 4, 'S-agent', false],
    ]);
    expect(rows.map((r) => r.invalidReason)).toEqual([
      undefined,
      '$.id: required',
      'unknown tool nope',
      'arguments are not a JSON object',
    ]);
    expect(rows[3]).toMatchObject({ args: {}, rawArgs: '{bad' });
  });
});

describe('helpers', () => {
  test('sdkStdio starts a server that needs a cwd through /bin/sh', () => {
    expect(sdkStdio({ command: 'tsx', args: ['src/main.ts'], env: { A: '1' }, cwd: '/r' })).toEqual({
      command: '/bin/sh',
      args: ['-c', 'cd "$0" && exec "$@"', '/r', 'tsx', 'src/main.ts'],
      env: { A: '1' },
    });
    expect(sdkStdio({ command: 'node', args: ['x.mjs'], env: {} })).toEqual({
      command: 'node',
      args: ['x.mjs'],
      env: {},
    });
  });
  test('synthArgs builds required members from the prompt', () => {
    const s = {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, qty: { type: 'integer', minimum: 1 } },
            required: ['id', 'qty'],
          },
        },
        note: { type: 'string' },
      },
      required: ['items'],
    };
    expect(synthArgs(s, 'Order TRK-104 please')).toEqual({ items: [{ id: 'TRK-104', qty: 1 }] });
  });
});
