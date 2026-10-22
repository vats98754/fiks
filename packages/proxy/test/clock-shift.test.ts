// PLAN 3.1 "Clock" (round 6): replay-cli evaluates with now := capturedAt, so a +400-day shift
// of the system clock (node --require test/support/clock-shift.cjs) gives byte-identical rows.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, SHOP_CONTRACTS } from '@fiks/contracts';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { FROZEN, ORDERS, respondShop, shopProxy } from './support/shop-like.ts';

const ROOT = new URL('../../..', import.meta.url).pathname;
const CLOCK_SHIFT = join(ROOT, 'packages/proxy/test/support/clock-shift.cjs');
const REPLAY_CLI = join(ROOT, 'packages/proxy/src/replay-cli.ts');
const DAY = 86_400_000;

let dir = '';
let records = '';
let close: () => Promise<unknown> = async () => undefined;

beforeAll(async () => {
  // The fixture set: live proxy calls under a frozen clock (fresh, 1970 and 200-day-old orders,
  // plus a search), as fiks-proxy --events lines, and one paper-format CallRecord (capturedAt only).
  const e = await shopProxy(respondShop, { now: () => FROZEN });
  close = e.close;
  for (const id of Object.keys(ORDERS))
    await e.client.callTool({ name: 'get_order', arguments: { order_id: id } });
  await e.client.callTool({ name: 'search_products', arguments: { query: 'ext' } });
  const last = e.events[0];
  const paper = last && {
    callId: 'paper-o-1',
    domain: 'shop',
    stratum: 'frame',
    catalog: 'original',
    drift: null,
    mutant: null,
    tool: last.tool,
    args: last.args,
    upstream: [],
    output: last.result,
    events: [{ ...last, at: undefined }],
    entityClass: {},
    originUnit: {},
    capturedAt: last.at,
    controlOf: null,
    upstreamObserved: false,
  };
  dir = mkdtempSync(join(tmpdir(), 'fiks-clock-'));
  records = join(dir, 'records.jsonl');
  writeFileSync(records, [...e.events, paper].map((x) => `${JSON.stringify(x)}\n`).join(''));
});
afterAll(() => close());

function replay(out: string, shiftDays?: number) {
  const pre = shiftDays === undefined ? [] : ['--require', CLOCK_SHIFT];
  const r = spawnSync(
    process.execPath,
    [...pre, '--import', 'tsx', REPLAY_CLI, '--in', records, '--out', out],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        ...(shiftDays === undefined ? {} : { FIKS_TEST_CLOCK_SHIFT_DAYS: String(shiftDays) }),
      },
      encoding: 'utf8',
    },
  );
  expect(r.status, r.stderr).toBe(0);
  return readFileSync(out, 'utf8');
}

test('the preload really shifts Date and Date.now by 400 days', () => {
  const r = spawnSync(
    process.execPath,
    [
      '--require',
      CLOCK_SHIFT,
      '-e',
      'process.stdout.write(JSON.stringify([Date.now(), new Date().getTime()]))',
    ],
    { env: { ...process.env, FIKS_TEST_CLOCK_SHIFT_DAYS: '400' }, encoding: 'utf8' },
  );
  const [now, constructed] = JSON.parse(r.stdout) as [number, number];
  for (const t of [now, constructed]) expect(Math.round((t - Date.now()) / DAY)).toBe(400);
});

test('the fixture is clock-sensitive: evaluated at the shifted instant, freshness verdicts change', () => {
  const contract = SHOP_CONTRACTS.contracts.find((c) => c.tool === 'get_order');
  const verdictAt = (created_at: string, now: Date) =>
    evaluate(contract, {
      args: {},
      result: { structuredContent: { order_id: 'o', status: 's', items: [], total: 1, created_at } },
      now,
    }).violations.some((v) => v.propertyId === 'shop.get_order/created_at.freshness');
  const shifted = new Date(FROZEN.getTime() + 400 * DAY);
  for (const o of Object.values(ORDERS)) {
    const created = String(o.created_at);
    if (created.startsWith('1970')) continue;
    expect(verdictAt(created, FROZEN)).toBe(false);
    expect(verdictAt(created, shifted)).toBe(true);
  }
});

test('replay-cli under a +400-day clock shift writes byte-identical DetectorVerdictRow JSONL', () => {
  const normal = replay(join(dir, 'normal.jsonl'));
  const shifted = replay(join(dir, 'shifted.jsonl'), 400);
  expect(shifted).toBe(normal);
  const rows = normal
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { callId: string; property: string | null; verdict: string });
  const fresh = rows.filter((r) => r.property === 'shop.get_order/created_at.freshness');
  // Only the 1970 order violates freshness at capturedAt; the fresh and 200-day-old ones verify.
  expect(fresh).toHaveLength(1);
  expect(rows.filter((r) => r.verdict === 'verified')).toHaveLength(3);
  expect(rows.some((r) => r.callId === 'paper-o-1' && r.verdict === 'verified')).toBe(true);
});
