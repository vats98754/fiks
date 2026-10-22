// The pre-F4b frame pipeline on a synthetic 750-entity extension per domain (DET acceptance):
// enumerate (twice, same sha256), record --frame --monitor none (no verdict, contracts never
// opened, capturedAt = frozenClock), frame-k (FrameSpec valid; a planted base-tool/truth()
// disagreement excluded from Clean), and offline replay = live on every non-postcondition
// property, including under a +400-day system clock shift.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHOP_CONTRACTS_PATH } from '@fiks/contracts';
import type { EnumRow, FrameSpec } from '@fiks/interfaces';
import { CATALOG as SHOP_CATALOG, SHOP_FROZEN_CLOCK } from '@fiks/vendor-api';
import { CATALOG as TRACKER_CATALOG } from '@fiks/vendor-tracker';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { checkFrameSpec } from '../../../paper/prereg/lib/frame-spec.ts';
import { type DetCallRecord, isKnownGoodArgs, type KnownGood, sha256File } from '../src/index.ts';
import { commitAll, fiksOk, ROOT, readJson, readLines, run, shopWorktree, TSX, tmp } from './support/cli.ts';
import { shopExtension, trackerExtension, writeCatalog } from './support/synthetic.ts';

const FS_SPY = join(ROOT, 'packages/proxy/test/support/fs-spy.cjs');
const CLOCK_SHIFT = join(ROOT, 'packages/proxy/test/support/clock-shift.cjs');
const VERDICT_MAP = join(ROOT, 'packages/frame/test/support/verdict-map.ts');
const REPLAY_CLI = join(ROOT, 'packages/proxy/src/replay-cli.ts');
/** The entity the planted server mishandles (get_product returns its name upper-cased). */
const PLANTED = 'px-s0750';

let dir: string;
let env: Record<string, string>;
let contracts: string;
let planted: ReturnType<typeof shopWorktree>;
let plantedCommit: string;

const shaOf = (stdout: string) => /sha256 ([0-9a-f]{64})/.exec(stdout)?.[1];

beforeAll(() => {
  dir = tmp('frame');
  env = {
    VENDOR_EXTENDED_CATALOG: writeCatalog(join(dir, 'shop-ext.json'), shopExtension(750)),
    TRACKER_EXTENDED_CATALOG: writeCatalog(join(dir, 'tracker-ext.json'), trackerExtension(750)),
  };
  // A private copy of the frozen shop contracts: any open of this path can only come from `record`.
  contracts = join(dir, 'contracts.json');
  copyFileSync(SHOP_CONTRACTS_PATH, contracts);
  // base-shop plus one planted base-tool/truth() disagreement on a single entity.
  planted = shopWorktree('base-shop');
  const file = join(planted.dir, 'src/tools/get_product.ts');
  const src = readFileSync(file, 'utf8');
  expect(src).toContain('    name: p.name,');
  writeFileSync(
    file,
    src.replace('    name: p.name,', `    name: p.id === '${PLANTED}' ? p.name.toUpperCase() : p.name,`),
  );
  plantedCommit = commitAll(planted.dir, 'test: plant a get_product/truth() disagreement');
});

afterAll(() => planted?.remove());

describe('enumerate --frame', () => {
  test('shop: same sha256 twice; no original id, no known-good argument; single-line S-write orders', () => {
    const args = ['enumerate', '--domain', 'shop', '--frame', '--catalog', 'extended-only', '--seed', '1'];
    const a = fiksOk([...args, '--out', join(dir, 'shop-a.jsonl')], env);
    const b = fiksOk([...args, '--out', join(dir, 'shop.jsonl')], env);
    expect(shaOf(a.stdout)).toMatch(/^[0-9a-f]{64}$/);
    expect(shaOf(a.stdout)).toBe(shaOf(b.stdout));
    expect(readFileSync(join(dir, 'shop.jsonl.sha256'), 'utf8')).toContain(shaOf(b.stdout) as string);
    const rows = readLines<EnumRow>(join(dir, 'shop.jsonl'));
    expect(rows.length).toBeGreaterThan(750 * 4);
    const originals = new Set(SHOP_CATALOG.map((p) => p.id));
    const known: KnownGood = Object.fromEntries(
      (readJson(contracts).contracts as { tool: string; knownGoodInputs?: Record<string, unknown>[] }[]).map(
        (c) => [c.tool, c.knownGoodInputs ?? []],
      ),
    );
    for (const r of rows) {
      const text = JSON.stringify(r.args);
      for (const id of originals) expect(text).not.toContain(`"${id}"`);
      expect(isKnownGoodArgs(known, r.tool, r.args), JSON.stringify(r)).toBe(false);
      if (r.tool === 'create_order') expect((r.args.items as unknown[]).length).toBe(1);
    }
    const strata = new Set(rows.map((r) => r.stratum));
    expect([...strata].sort()).toEqual(['S-ext', 'S-grid', 'S-write']);
    const ext = rows.filter((r) => r.stratum === 'S-ext');
    expect(ext).toHaveLength(750);
    expect(new Set(rows.map((r) => r.dedupeKey)).size).toBe(rows.length);
  });

  test('tracker: same sha256 twice; no original key', () => {
    const args = ['enumerate', '--domain', 'tracker', '--frame', '--catalog', 'extended-only', '--seed', '1'];
    const a = fiksOk([...args, '--out', join(dir, 'tracker-a.jsonl')], env);
    const b = fiksOk([...args, '--out', join(dir, 'tracker.jsonl')], env);
    expect(shaOf(a.stdout)).toBe(shaOf(b.stdout));
    const rows = readLines<EnumRow>(join(dir, 'tracker.jsonl'));
    const originals = TRACKER_CATALOG.map((i) => i.key);
    for (const r of rows) {
      const text = JSON.stringify(r.args);
      for (const k of originals) expect(text).not.toContain(`"${k}"`);
    }
    expect(rows.filter((r) => r.stratum === 'S-ext')).toHaveLength(1500);
  });
});

describe('record --frame --monitor none, then frame-k', () => {
  test('CallRecords with outputs and truth(), no verdict, capturedAt = frozenClock; contracts never opened', () => {
    const spyLog = join(dir, 'fs-none.log');
    fiksOk(
      [
        'record',
        '--domain',
        'shop',
        '--frame',
        '--monitor',
        'none',
        '--contracts',
        contracts,
        '--in',
        join(dir, 'shop.jsonl'),
        '--out',
        join(dir, 'frame'),
        '--server-dir',
        planted.dir,
        '--server-ref',
        'base-shop',
      ],
      { ...env, NODE_OPTIONS: `--require ${FS_SPY}`, FIKS_TEST_FS_SPY_LOG: spyLog },
    );
    const opened = readFileSync(spyLog, 'utf8').split('\n');
    expect(opened.length).toBeGreaterThan(100); // the spy works
    expect(opened).not.toContain(contracts);
    const records = readLines<DetCallRecord>(join(dir, 'frame/calls.jsonl'));
    const enumRows = readLines<EnumRow>(join(dir, 'shop.jsonl'));
    expect(records).toHaveLength(enumRows.length);
    for (const r of records) {
      expect(r.capturedAt).toBe(SHOP_FROZEN_CLOCK);
      expect(r.output).toBeTruthy();
      expect(r.upstream.length).toBeGreaterThan(0);
      expect(typeof r.truth.agrees).toBe('boolean');
      expect(r.controlOf).toBeNull();
      for (const ev of r.events) {
        for (const k of ['receipt', 'verdict', 'violations', 'checked', 'probe'])
          expect(ev).not.toHaveProperty(k);
      }
      expect(r.events.some((e) => e.type === 'probe')).toBe(false);
    }
    // S-write: every create_order caused exactly its own POST (no read-back probe ran).
    for (const r of records.filter((x) => x.tool === 'create_order')) {
      expect(r.upstream.map((x) => `${x.request.method} ${x.request.url}`)).toEqual(['POST /orders']);
    }
    // get_order rows read the order their create_order placed.
    const order = records.find((r) => r.tool === 'get_order');
    expect(order?.args.order_id).toMatch(/^o-/);
    const manifest = readJson(join(dir, 'frame/manifest.json'));
    expect(manifest).toMatchObject({
      kind: 'frame',
      monitor: 'none',
      contracts: null,
      catalog: 'extended-only',
    });
    expect((manifest.server as { commit: string }).commit).toBe(plantedCommit);
    // The control run: the contracts monitor opens the same private copy (so the spy can see it).
    const ctlLog = join(dir, 'fs-contracts.log');
    fiksOk(
      [
        'record',
        '--domain',
        'shop',
        '--frame',
        '--monitor',
        'contracts',
        '--contracts',
        contracts,
        '--in',
        join(dir, 'shop.jsonl'),
        '--out',
        join(dir, 'frame-live'),
        '--server-dir',
        planted.dir,
        '--server-ref',
        'base-shop',
      ],
      { ...env, NODE_OPTIONS: `--require ${FS_SPY}`, FIKS_TEST_FS_SPY_LOG: ctlLog },
    );
    expect(readFileSync(ctlLog, 'utf8').split('\n')).toContain(contracts);
  });

  test('frame-k: a valid FrameSpec; N_E > 0; every eligible input attributed; planted disagreement not Clean', () => {
    const out = join(dir, 'frame-spec.json');
    const report = join(dir, 'frame-report.json');
    fiksOk(
      [
        'frame-k',
        '--records',
        join(dir, 'frame'),
        '--contracts',
        contracts,
        '--out',
        out,
        '--report',
        report,
      ],
      env,
    );
    const spec = readJson<FrameSpec>(out);
    expect(checkFrameSpec(spec)).toEqual([]);
    expect(spec.domain).toEqual(['shop']);
    expect(spec.hash).toBe(sha256File(join(dir, 'frame/calls.jsonl')));
    expect(spec.NE).toBeGreaterThan(0);
    expect(spec.entities).toHaveLength(750);
    expect(new Set(spec.entities.map((e) => e.authorBatch))).toEqual(new Set(['b01', 'b02']));
    for (const input of spec.eligibleInputs)
      expect(Object.keys(spec.attribution[input] ?? {}).length).toBeGreaterThan(0);
    // Planted: get_product on the planted entity disagrees with truth() -> excluded from Clean.
    const records = readLines<DetCallRecord>(join(dir, 'frame/calls.jsonl'));
    const bad = records.filter((r) => !r.truth.agrees);
    expect(bad.map((r) => [r.tool, r.args])).toEqual([['get_product', { id: PLANTED }]]);
    expect(bad[0]?.truth.mismatches).toEqual(['name']);
    const rep = readJson<{ notClean: { inputId: string }[] }>(report);
    expect(rep.notClean.map((x) => x.inputId)).toEqual([bad[0]?.inputId]);
    expect(spec.eligibleInputs).not.toContain(bad[0]?.inputId);
    expect(spec.nF).toBe(records.length);
    // Families: the five FP-capable shop properties (PLAN 3.1).
    expect(spec.families).toEqual({
      'shop.create_order/total.range': 'total',
      'shop.get_order/created_at.freshness': 'created_at',
      'shop.get_order/total.range': 'total',
      'shop.get_product/price.range': 'price',
      'shop.search_products/items.price.range': 'price',
    });
    for (const p of [
      'shop.search_products/countMatchesTotal',
      'shop.search_products/total.equalsUpstream',
      'shop.search_products/items.id.unique',
      'shop.get_order/created_at.equalsUpstream',
      'shop.create_order/readAfterWrite',
    ])
      expect(spec.entailedProps).toContain(p);
    // Search element paths are attributed to their own entities.
    const search = records.find(
      (r) => r.tool === 'search_products' && spec.eligibleInputs.includes(r.inputId),
    );
    const items = (search?.output.structuredContent?.items ?? []) as { id: string }[];
    for (const [i, it] of items.entries())
      expect(spec.attribution[search?.inputId as string]?.[`items[${i}].price`]).toBe(it.id);
    expect(spec.K).toBe(spec.cells.length);
    expect(spec.neRule.m).toBe(4);
  });

  test('offline replay = live on every non-postcondition property; postconditions unverifiable offline; +400-day clock shift changes nothing', () => {
    expect(existsSync(join(dir, 'frame-live/calls.jsonl'))).toBe(true);
    const map = (file: string, out: string, extra: string[] = [], shift = false) => {
      const r = run(
        TSX,
        [VERDICT_MAP, file, contracts, out, ...extra],
        shift ? { NODE_OPTIONS: `--require ${CLOCK_SHIFT}`, FIKS_TEST_CLOCK_SHIFT_DAYS: '400' } : {},
      );
      expect(r.code, r.stderr).toBe(0);
      return readFileSync(out, 'utf8');
    };
    const offline = map(join(dir, 'frame/calls.jsonl'), join(dir, 'offline.jsonl'));
    const shifted = map(join(dir, 'frame/calls.jsonl'), join(dir, 'offline-shifted.jsonl'), [], true);
    const live = map(join(dir, 'frame-live/calls.jsonl'), join(dir, 'live.jsonl'), ['--live']);
    expect(shifted).toBe(offline);
    const parse = (t: string) =>
      t
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as { callId: string; verdicts: Record<string, string> });
    const off = parse(offline);
    const on = parse(live);
    expect(off.map((x) => x.callId)).toEqual(on.map((x) => x.callId));
    let compared = 0;
    let freshness = 0;
    off.forEach((o, i) => {
      const l = on[i] as (typeof on)[number];
      for (const [p, v] of Object.entries(o.verdicts)) {
        if (p.endsWith('/readAfterWrite')) {
          expect(v, `${o.callId} ${p}`).toBe('unverifiable');
          continue;
        }
        expect(v, `${o.callId} ${p}`).toBe(l.verdicts[p]);
        compared++;
        if (p === 'shop.get_order/created_at.freshness' && v === 'verified') freshness++;
      }
      expect(Object.keys(o.verdicts).sort()).toEqual(Object.keys(l.verdicts).sort());
    });
    expect(compared).toBeGreaterThan(10_000);
    expect(freshness).toBe(1500); // every S-write get_order, evaluated at capturedAt
    // The live record ran the read-back probe; offline there is none.
    const liveWrite = on.find((x) => x.verdicts['shop.create_order/readAfterWrite']);
    expect(liveWrite?.verdicts['shop.create_order/readAfterWrite']).toBe('verified');
    // MON replay-cli itself: byte-identical rows with and without the clock shift.
    const rows = (out: string, shift: boolean) => {
      const r = run(
        TSX,
        [
          REPLAY_CLI,
          '--in',
          join(dir, 'frame/calls.jsonl'),
          '--out',
          out,
          '--contracts',
          contracts,
          '--per-element',
        ],
        shift ? { NODE_OPTIONS: `--require ${CLOCK_SHIFT}`, FIKS_TEST_CLOCK_SHIFT_DAYS: '400' } : {},
      );
      expect(r.code, r.stderr).toBe(0);
      return readFileSync(out, 'utf8');
    };
    expect(rows(join(dir, 'rows-shifted.jsonl'), true)).toBe(rows(join(dir, 'rows.jsonl'), false));
  });
});
