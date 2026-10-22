import type { CallRecord } from '@fiks/interfaces';
import { describe, expect, test } from 'vitest';
import {
  buildSnapshot,
  callsToFirstDetection,
  createSnapMonitor,
  createStatMonitor,
  createTrigMonitor,
  evidentlyColumnDrift,
  runDetector,
  runTypecheck,
} from '../src/index.ts';
import { bench, find, input, TOOL_DEFS } from './helpers.ts';

const { v1, v2 } = bench();
const ctx = { toolDefs: TOOL_DEFS };

describe('B-SNAP', () => {
  const snap = createSnapMonitor(buildSnapshot(v1));
  test('v1 traffic replayed against its own snapshot is clean', () => {
    for (const rec of v1) expect(snap(input(rec)), rec.callId).toMatchObject({ verdict: 'verified' });
  });
  test('D1: the same request shows prices two magnitude buckets up', () => {
    const r = snap(input(find(v2, (x) => x.drift === 'D1')));
    expect(r.verdict).toBe('violated');
    expect(r.violations.map((v) => v.propertyId)).toContain('B-SNAP/magnitude');
    expect(r.violations.find((v) => v.kind === 'magnitude')).toMatchObject({
      path: 'items[0].price',
      expected: '10^3',
      actual: '10^5',
    });
  });
  test('D2: price type number -> null', () => {
    const r = snap(input(find(v2, (x) => x.drift === 'D2')));
    expect(r.violations).toContainEqual(
      expect.objectContaining({ propertyId: 'B-SNAP/type', path: 'price', actual: 'null' }),
    );
  });
  test('D4: array length vs total changes', () => {
    const r = snap(input(find(v2, (x) => x.drift === 'D4')));
    expect(r.violations.map((v) => v.kind)).toContain('length');
  });
  test('D5: an ISO string stays an ISO string, so the shape diff is silent', () => {
    expect(snap(input(find(v2, (x) => x.drift === 'D5'))).verdict).toBe('verified');
  });
  test('a request never recorded falls back to the tool profile; an unknown tool is unverifiable', () => {
    const rec = find(v1, (x) => x.tool === 'get_product');
    rec.args = { id: 'p-9999' };
    const r = snap(input(rec));
    expect(r).toMatchObject({ verdict: 'verified', checked: ['B-SNAP/toolProfile'] });
    (rec.output.structuredContent as Record<string, unknown>).price = 5_000_000;
    expect(snap(input(rec)).violations.map((v) => v.kind)).toEqual(['magnitude']);
    expect(snap({ ...input(rec), tool: 'nope' }).verdict).toBe('unverifiable');
  });
});

/** n synthetic get_product calls with the given prices. */
function products(prices: (number | null)[], at = '2026-10-20T00:00:00.000Z'): CallRecord[] {
  const base = find(v1, (x) => x.tool === 'get_product');
  return prices.map((price, i) => {
    const r = structuredClone(base);
    r.callId = `syn-${i}-${price}`;
    r.output = { content: [], structuredContent: { ...(base.output.structuredContent as object), price } };
    r.capturedAt = at;
    return r;
  });
}

describe('B-STAT', () => {
  // A stationary reference: the same 40 prices in a scrambled order, so any 20-call tail looks alike.
  const level = (i: number) => 100 + ((i * 17) % 40) * 10;
  const ref = products(Array.from({ length: 40 }, (_, i) => level(i)));
  test('unverifiable until the window is full; a x100 shift is then detected (aegis)', async () => {
    const m = createStatMonitor({ mode: 'aegis', window: 20, reference: ref });
    const drift = products(Array.from({ length: 25 }, (_, i) => (100 + i * 10) * 100));
    const rows = (await runDetector(m, drift, ctx)).map((d) => d.row);
    expect(rows.slice(0, 19).every((r) => r.verdict === 'unverifiable')).toBe(true);
    expect(rows[19]?.verdict).toBe('violated');
    expect(callsToFirstDetection(rows)).toBe(20);
    expect(m.id).toBe('B-STAT:aegis:w20');
  });
  test('a window pre-filled with v1 traffic detects after a share of drifted calls', async () => {
    const m = createStatMonitor({ mode: 'aegis', window: 20, reference: ref, prefill: ref });
    const drift = products(Array.from({ length: 25 }, (_, i) => (100 + i * 10) * 100));
    const rows = (await runDetector(m, drift, ctx)).map((d) => d.row);
    const first = callsToFirstDetection(rows);
    expect(first).not.toBeNull();
    expect(first as number).toBeGreaterThan(1);
    expect(first as number).toBeLessThanOrEqual(20);
    // Same input, same answer after reset (runDetector resets stateful monitors).
    expect((await runDetector(m, drift, ctx)).map((d) => d.row)).toEqual(rows);
  });
  test('null-rate jump fires; stable traffic does not', async () => {
    const m = createStatMonitor({ mode: 'aegis', window: 20, reference: ref, prefill: ref });
    const nulls = (await runDetector(m, products(Array(20).fill(null)), ctx)).map((d) => d.row);
    expect(nulls.at(-1)?.property).toBe('B-STAT:aegis:w20/nullRate');
    const same = (
      await runDetector(m, products(Array.from({ length: 20 }, (_, i) => level(i + 3))), ctx)
    ).map((d) => d.row);
    expect(same.every((r) => r.verdict === 'verified')).toBe(true);
  });
  test('evidently mode picks scipy-style tests by size and cardinality', () => {
    const many = Array.from({ length: 30 }, (_, i) => i);
    expect(evidentlyColumnDrift(many, many)?.test).toBe('ks');
    expect(evidentlyColumnDrift(['a', 'b', 'c'], ['a', 'b', 'c'])?.test).toBe('chisquare');
    expect(evidentlyColumnDrift([true, false], [true, true])?.test).toBe('z');
    const big = Array.from({ length: 1200 }, (_, i) => i % 97);
    expect(
      evidentlyColumnDrift(
        big,
        big.map((x) => x + 50),
      ),
    ).toMatchObject({ test: 'wasserstein', drift: true });
    expect(evidentlyColumnDrift(Array(1200).fill('x'), ['x'])).toMatchObject({
      test: 'jensenshannon',
      drift: false,
    });
    expect(evidentlyColumnDrift([null], [1])).toBeNull();
  });
  test('evidently dataset drift needs half the columns to drift', async () => {
    const m = createStatMonitor({ mode: 'evidently', window: 20, reference: ref });
    const drift = products(Array.from({ length: 20 }, (_, i) => (100 + i * 10) * 100));
    const rows = (await runDetector(m, drift, ctx)).map((d) => d.row);
    // Only price drifts (1 of 6 columns): no dataset drift.
    expect(rows.at(-1)?.verdict).toBe('verified');
  });
});

describe('B-TRIG', () => {
  test('silent drift calls fire nothing; isError, exceptions, spec diffs and typecheck failures do', () => {
    const t = createTrigMonitor({ specDiff: { findings: 0 }, typecheck: { ok: true } });
    for (const rec of v2.filter((r) => r.drift))
      expect(t(input(rec)), rec.callId).toMatchObject({ verdict: 'verified' });
    const err = find(v2, (r) => r.output.isError === true);
    expect(t(input(err))).toMatchObject({
      verdict: 'violated',
      violations: [expect.objectContaining({ kind: 'isError' })],
    });
    const ex = { ...input(find(v1, () => true)), events: [{ type: 'exception', message: 'ECONNRESET' }] };
    expect(t(ex).violations.map((v) => v.kind)).toEqual(['exception']);
    const spec = createTrigMonitor({ specDiff: { findings: 2 } });
    expect(spec(input(find(v1, () => true))).violations.map((v) => v.kind)).toEqual(['specDiff']);
    const tc = createTrigMonitor({ typecheck: { ok: false } });
    expect(tc(input(find(v1, () => true))).violations.map((v) => v.kind)).toEqual(['typecheck']);
  });
  test('runTypecheck reports the command exit code', () => {
    expect(runTypecheck(process.cwd(), [process.execPath, '-e', 'process.exit(0)'])).toEqual({
      ok: true,
      code: 0,
    });
    expect(runTypecheck(process.cwd(), [process.execPath, '-e', 'process.exit(2)'])).toEqual({
      ok: false,
      code: 2,
    });
  });
});
