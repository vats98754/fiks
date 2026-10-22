// Offline replay (replay-cli): rows, per-element rows, --reenable, --check, the evaluation
// instant rule (now := at ?? capturedAt, never the system clock) and refusals.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, SHOP_CONTRACTS } from '@fiks/contracts';
import type { DetectorVerdictRow } from '@fiks/interfaces';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { type EvaluateFn, elementIndexOf, type RecordedCall } from '../src/index.ts';
import { runReplayCli } from '../src/replay-cli.ts';
import { FROZEN, ok, respondShop, shopProxy, THREE_ITEMS } from './support/shop-like.ts';

const realEvaluate: EvaluateFn = evaluate;
const SEARCH = SHOP_CONTRACTS.contracts.find((c) => c.tool === 'search_products');
/** True once VOCAB's EvalOptions.perElement is in @fiks/contracts (PLAN 3.1, round 7). */
const EVALUATOR_HAS_PER_ELEMENT =
  realEvaluate(
    SEARCH,
    { args: {}, result: ok(THREE_ITEMS), now: FROZEN },
    { perElement: true },
  ).violations.filter((v) => v.kind === 'range').length === 2;

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const c of cleanups.splice(0).reverse()) await c();
});

const tmp = () => mkdtempSync(join(tmpdir(), 'fiks-replay-'));
const jsonl = (xs: unknown[]) => xs.map((x) => `${JSON.stringify(x)}\n`).join('');
const readRows = (file: string) =>
  readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as DetectorVerdictRow);

/** Live proxy calls (frozen clock), written as fiks-proxy --events lines. */
async function liveEvents(calls: [string, Record<string, unknown>][]) {
  const e = await shopProxy(respondShop, { now: () => FROZEN });
  cleanups.push(e.close);
  for (const [name, args] of calls) await e.client.callTool({ name, arguments: args });
  const dir = tmp();
  const file = join(dir, 'events.jsonl');
  writeFileSync(file, jsonl(e.events));
  return { dir, file, events: e.events };
}

function io(evaluator?: EvaluateFn) {
  const out = { log: [] as string[], error: [] as string[] };
  return {
    out,
    io: {
      log: (l: string) => void out.log.push(l),
      error: (l: string) => void out.error.push(l),
      ...(evaluator ? { evaluate: evaluator } : {}),
    },
  };
}

describe('per-element rows (PLAN 3.1, round 7)', () => {
  test('without --per-element: one items.price.range row, and the replayed receipt is the live one', async () => {
    const { dir, file, events } = await liveEvents([['search_products', { query: 'ext' }]]);
    const live = events[0]?.receipt;
    expect(live?.violations.filter((v) => v.kind === 'range').map((v) => v.path)).toEqual(['items[0].price']);
    const out = join(dir, 'rows.jsonl');
    expect(await runReplayCli(['--in', file, '--out', out], io().io)).toBe(0);
    const rows = readRows(out).filter((r) => r.property === 'shop.search_products/items.price.range');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      verdict: 'violated',
      detector: 'contracts',
      at: null,
      elementIndex: null,
    });
    const c = io();
    expect(await runReplayCli(['--check', file], c.io)).toBe(0);
    expect(c.out.log[0]).toMatch(/verdicts 1 byte-identical, 0 different; whole receipt 1 byte-identical/);
  });

  test('--per-element passes perElement: true to the evaluator and writes one row per violating element', async () => {
    const { dir, file } = await liveEvents([['search_products', { query: 'ext' }]]);
    // Stands in for VOCAB's per-element evaluator: one range violation per out-of-range item.
    const spy = vi.fn<EvaluateFn>((c, i, o) => {
      const e = realEvaluate(c, i, o);
      if (!o?.perElement || c?.tool !== 'search_products') return e;
      const items = (i.result.structuredContent?.items ?? []) as { id: string; price: number }[];
      const range = e.violations.find((v) => v.kind === 'range');
      if (!range) return e;
      const each = items.flatMap((it, k) =>
        it.price < 20 || it.price > 2000
          ? [{ ...range, path: `items[${k}].price`, actual: it.price, message: `${it.id} = ${it.price}` }]
          : [],
      );
      return { ...e, violations: [...each, ...e.violations.filter((v) => v.kind !== 'range')] };
    });
    const out = join(dir, 'rows.jsonl');
    expect(await runReplayCli(['--in', file, '--out', out, '--per-element'], io(spy).io)).toBe(0);
    expect(spy.mock.calls[0]?.[2]).toEqual({ perElement: true });
    const rows = readRows(out).filter((r) => r.property === 'shop.search_products/items.price.range');
    expect(rows.map((r) => [r.at, r.elementIndex])).toEqual([
      ['items[0].price', 0],
      ['items[2].price', 2],
    ]);
  });

  test.skipIf(!EVALUATOR_HAS_PER_ELEMENT)(
    'with the real evaluator: exactly two items.price.range rows, at items[0] and items[2]',
    async () => {
      const { dir, file } = await liveEvents([['search_products', { query: 'ext' }]]);
      const out = join(dir, 'rows.jsonl');
      expect(await runReplayCli(['--in', file, '--out', out, '--per-element'], io().io)).toBe(0);
      const rows = readRows(out).filter((r) => r.property === 'shop.search_products/items.price.range');
      expect(rows.map((r) => [r.at, r.elementIndex])).toEqual([
        ['items[0].price', 0],
        ['items[2].price', 2],
      ]);
    },
  );

  test('elementIndexOf takes the innermost index', () => {
    expect(elementIndexOf('items[2].price')).toBe(2);
    expect(elementIndexOf('orders[1].lines[3].qty')).toBe(3);
    expect(elementIndexOf('total')).toBeNull();
  });
});

describe('evaluator options and refusals', () => {
  test("'--reenable x' reaches the evaluator options; no flag passes no options", async () => {
    const { dir, file } = await liveEvents([['get_order', { order_id: 'o-1' }]]);
    const spy = vi.fn<EvaluateFn>(realEvaluate);
    const out = join(dir, 'rows.jsonl');
    expect(await runReplayCli(['--in', file, '--out', out, '--reenable', 'x'], io(spy).io)).toBe(0);
    expect(spy.mock.calls[0]?.[2]).toEqual({ reenable: ['x'] });
    spy.mockClear();
    expect(
      await runReplayCli(['--in', file, '--out', out, '--reenable', 'a,b', '--per-element'], io(spy).io),
    ).toBe(0);
    expect(spy.mock.calls[0]?.[2]).toEqual({ reenable: ['a', 'b'], perElement: true });
    spy.mockClear();
    expect(await runReplayCli(['--in', file, '--out', out], io(spy).io)).toBe(0);
    expect(spy.mock.calls[0]?.[2]).toBeUndefined();
  });

  test('a record with neither at nor capturedAt exits 2 (both record formats)', async () => {
    const { dir, events } = await liveEvents([['get_order', { order_id: 'o-1' }]]);
    const { at: _at, ...noInstant } = events[0] as RecordedCall;
    const f1 = join(dir, 'no-at.jsonl');
    writeFileSync(f1, jsonl([noInstant]));
    const r1 = io();
    expect(await runReplayCli(['--in', f1, '--out', join(dir, 'x.jsonl')], r1.io)).toBe(2);
    expect(r1.out.error.join('\n')).toMatch(/neither "at" nor "capturedAt"/);
    const f2 = join(dir, 'paper.jsonl');
    writeFileSync(
      f2,
      jsonl([
        { callId: 'c1', domain: 'shop', stratum: 'frame', tool: 'get_order', args: {}, output: ok({}) },
      ]),
    );
    expect(await runReplayCli(['--check', f2], io().io)).toBe(2);
  });

  test('usage: --monitor none, both or neither of --in/--check, --check with options: exit 2', async () => {
    const { file } = await liveEvents([['get_order', { order_id: 'o-1' }]]);
    expect(await runReplayCli(['--check', file, '--monitor', 'none'], io().io)).toBe(2);
    expect(await runReplayCli(['--check', file, '--in', file, '--out', '/dev/null'], io().io)).toBe(2);
    expect(await runReplayCli([], io().io)).toBe(2);
    expect(await runReplayCli(['--in', file], io().io)).toBe(2);
    expect(await runReplayCli(['--check', file, '--per-element'], io().io)).toBe(2);
  });
});

describe('--check', () => {
  test('identical on live logs; a changed verdict is a mismatch (exit 1)', async () => {
    const { dir, events } = await liveEvents([
      ['search_products', { query: 'ext' }],
      ['get_order', { order_id: 'o-2' }],
      ['create_order', { items: [] }],
    ]);
    const good = join(dir, 'good.jsonl');
    writeFileSync(good, jsonl(events));
    const ok1 = io();
    expect(await runReplayCli(['--check', good], ok1.io)).toBe(0);
    expect(ok1.out.log[0]).toMatch(/verdicts 3 byte-identical, 0 different/);
    const tampered = structuredClone(events);
    const r = tampered[1]?.receipt;
    if (r) r.violations = [];
    const bad = join(dir, 'bad.jsonl');
    writeFileSync(bad, jsonl(tampered));
    const no = io();
    expect(await runReplayCli(['--check', bad], no.io)).toBe(1);
    expect(no.out.error[0]).toMatch(/^MISMATCH /);
  });

  test('a hints-only difference keeps the verdict identical and is reported', async () => {
    const { dir, events } = await liveEvents([['get_order', { order_id: 'o-2' }]]);
    const withHint = structuredClone(events);
    const r = withHint[0]?.receipt;
    if (r) r.hints = ['an older proxy hint'];
    const f = join(dir, 'h.jsonl');
    writeFileSync(f, jsonl(withHint));
    const c = io();
    expect(await runReplayCli(['--check', f], c.io)).toBe(0);
    expect(c.out.log[0]).toMatch(/whole receipt 0 byte-identical \(other fields differ: hints x1\)/);
  });
});

describe('paper CallRecord format', () => {
  test('capturedAt is the evaluation instant; labels come from entityClass/originUnit', async () => {
    const dir = tmp();
    const record = {
      callId: 'frame-0001',
      domain: 'shop',
      stratum: 'S-grid',
      catalog: 'extended-only',
      drift: null,
      mutant: null,
      tool: 'search_products',
      args: { query: 'ext' },
      upstream: [],
      output: ok(THREE_ITEMS),
      events: [],
      entityClass: { 'items[*].price': 'extended', $: 'collection' },
      originUnit: { 'items[0].price': 'ext-a', 'items[2].price': 'ext-c', $: 'q-17' },
      capturedAt: FROZEN.toISOString(),
      controlOf: null,
    };
    const file = join(dir, 'frame.jsonl');
    writeFileSync(file, jsonl([record]));
    const out = join(dir, 'rows.jsonl');
    expect(await runReplayCli(['--in', file, '--out', out], io().io)).toBe(0);
    const rows = readRows(out);
    expect(rows.find((r) => r.property?.endsWith('items.price.range'))).toEqual({
      callId: 'frame-0001',
      domain: 'shop',
      drift: null,
      stratum: 'S-grid',
      entityClass: 'extended',
      originUnit: 'ext-a',
      detector: 'contracts',
      verdict: 'violated',
      property: 'shop.search_products/items.price.range',
      at: null,
      elementIndex: null,
      confidence: null,
      tokens: null,
      costUsd: null,
    });
  });

  test('a verified call is one row with property null', async () => {
    const { dir, file } = await liveEvents([['get_order', { order_id: 'o-1' }]]);
    const out = join(dir, 'rows.jsonl');
    expect(await runReplayCli(['--in', file, '--out', out, '--stratum', 'dev'], io().io)).toBe(0);
    expect(readRows(out)).toEqual([
      expect.objectContaining({
        verdict: 'verified',
        property: null,
        stratum: 'dev',
        entityClass: 'unknown',
      }),
    ]);
  });
});

test('fake system time +400 days in-process: identical rows (replay never reads the clock)', async () => {
  const { dir, file } = await liveEvents([
    ['get_order', { order_id: 'o-1' }],
    ['get_order', { order_id: 'o-2' }],
    ['get_order', { order_id: 'o-3' }],
  ]);
  const a = join(dir, 'a.jsonl');
  const b = join(dir, 'b.jsonl');
  expect(await runReplayCli(['--in', file, '--out', a], io().io)).toBe(0);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.now() + 400 * 86_400_000));
  expect(await runReplayCli(['--in', file, '--out', b], io().io)).toBe(0);
  vi.useRealTimers();
  expect(readFileSync(b, 'utf8')).toBe(readFileSync(a, 'utf8'));
});
