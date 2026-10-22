// fiks-iv (P21) on the host, plus ARMS's frozen-trace fixtures and hand-written IV sidecars:
//  - D2: base fails on price.notNull, the D2 oracle head passes; --run-key without --properties exits 2;
//  - planted FP (round 6/7): on D4-plantedfp.trace.json, with its sidecar, base fails on
//    countMatchesTotal and the D4.patch head passes; without the sidecar the same head fails on
//    items.price.range (the $9 extended item violates on the v1 control too: the bias the rule removes);
//  - every fixture regenerates byte-identically and every hand-written sidecar equals the one
//    derived from its v1 control run (SIDECARS.md).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InjectorRule } from '@fiks/interfaces';
import { createWorktree, type LocalWorktree } from '@fiks/repro';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ivMain } from '../src/iv-cli.ts';
import type { FrozenTraceFile } from '../src/trace.ts';
import {
  controlOfTrace,
  D2_TRACE,
  FIXTURES,
  freezeExchangeTimes,
  generate,
  ORACLES,
  ROOT,
  runCall,
  SHOP_DIR,
  SPECS,
} from './support/fixtures.ts';

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'arms-iv-')));
const trees: LocalWorktree[] = [];
afterAll(() => {
  for (const t of trees) t.remove();
  rmSync(tmp, { recursive: true, force: true });
});

function head(base: string, patch?: string, name = base): string {
  const wt = createWorktree(SHOP_DIR, base, { dir: join(tmp, `${name}-${trees.length}`) });
  trees.push(wt);
  if (patch) execFileSync('git', ['apply', patch], { cwd: wt.dir });
  return wt.dir;
}

async function iv(args: string[]) {
  let out = '';
  let err = '';
  const code = await ivMain(args, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

describe('fiks-iv on D2', () => {
  let base: string;
  let fixed: string;
  beforeAll(() => {
    base = head('seed-v1', undefined, 'd2-base');
    fixed = head('seed-v1', join(ORACLES, 'D2.patch'), 'd2-fixed');
  }, 120_000);

  test('base: exit 1 with the property id and message; D2 oracle head: exit 0 (bin, real process)', () => {
    const bin = (h: string) =>
      spawnSync(
        join(ROOT, 'node_modules/.bin/tsx'),
        [join(ROOT, 'packages/arms/src/iv-cli.ts'), '--trace', D2_TRACE, '--head', h],
        {
          encoding: 'utf8',
          env: { PATH: process.env.PATH ?? '', HOME: tmp },
        },
      );
    const b = bin(base);
    expect(b.status, b.stderr).toBe(1);
    expect(b.stdout).toMatch(
      /^IV FAIL shop\.get_product\/price\.notNull: price is null, but p-1001 should have one$/m,
    );
    const f = bin(fixed);
    expect(f.status, `${f.stdout}${f.stderr}`).toBe(0);
    expect(f.stdout).toMatch(/^IV PASS/m);
  }, 120_000);

  test("experiment mode: --run-key without --properties exits 2 ('IV sidecar required'); with the sidecar it evaluates ivProperties", async () => {
    const r = await iv(['--trace', D2_TRACE, '--head', base, '--run-key', 'unit/L1/m/shop/D2/1']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('IV sidecar required');
    const s = await iv([
      '--trace',
      D2_TRACE,
      '--head',
      base,
      '--run-key',
      'unit/L1/m/shop/D2/1',
      '--properties',
      join(FIXTURES, 'D2-trace.iv.json'),
    ]);
    expect(s.code).toBe(1);
    expect(s.out).toContain('3 ivProperties');
    expect(s.out).toContain('IV FAIL shop.get_product/price.notNull');
    expect((await iv(['--head', base])).code).toBe(2);
  }, 120_000);
});

describe('planted FP: D4-plantedfp with its sidecar', () => {
  const spec = SPECS['D4-plantedfp'];
  const tracePath = spec.file;
  const sidecar = join(FIXTURES, 'D4-plantedfp.trace.iv.json');
  let base: string;
  let fixed: string;
  let rerecorded: string;

  beforeAll(async () => {
    base = head('seed-v1', undefined, 'd4p-base');
    fixed = head('seed-v1', join(ORACLES, 'D4.patch'), 'd4p-fixed');
    // The D4.patch head fetches every page, so the frozen trace (page 1 only) no longer applies: it
    // is re-recorded on that head against the same upstream (vendor v1 + D4 rule, catalog `all`
    // with the extension, frozen clock). CORE's rerecord() would start the vendor with the
    // original catalog (the trace format does not carry the catalog), so the test builds the
    // re-recording through the harness with the trace's own catalog.
    const t = JSON.parse(readFileSync(tracePath, 'utf8')) as FrozenTraceFile;
    const rule = JSON.parse(readFileSync(spec.ruleFile, 'utf8')) as InjectorRule;
    let http: FrozenTraceFile['http'] = [];
    await runCall(spec, fixed, rule, new Date(t.capturedAt), (rec) => {
      http = rec.http;
    });
    const copy = freezeExchangeTimes({ ...t, http }, new Date(t.capturedAt));
    rerecorded = join(tmp, 'D4-plantedfp.rerecorded.json');
    writeFileSync(rerecorded, `${JSON.stringify(copy, null, 2)}\n`);
    expect(http.length).toBe(2);
  }, 300_000);

  test('base: exit 1 on countMatchesTotal; items.price.range is excluded (control: violated)', async () => {
    const r = await iv(['--trace', tracePath, '--head', base, '--properties', sidecar]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('ivExcluded: shop.search_products/items.price.range (control: violated)');
    expect(r.out).toMatch(
      /^IV FAIL shop\.search_products\/countMatchesTotal: list is incomplete, 5 of 6 matches returned$/m,
    );
    expect(r.out).not.toContain('IV FAIL shop.search_products/items.price.range');
  }, 120_000);

  test('D4.patch head: exit 0 with the sidecar; exit 1 on items.price.range without it', async () => {
    const withSidecar = await iv([
      '--trace',
      rerecorded,
      '--head',
      fixed,
      '--properties',
      sidecar,
      '--run-key',
      'unit/L1/m/shop/D4-plantedfp/1',
    ]);
    expect(withSidecar.code, withSidecar.out).toBe(0);
    const without = await iv(['--trace', rerecorded, '--head', fixed]);
    expect(without.code).toBe(1);
    expect(without.out).toMatch(/^IV FAIL shop\.search_products\/items\.price\.range: /m);
    expect(without.out).not.toContain('countMatchesTotal');
    // On the un-re-recorded trace the fixed head asks for page 2, which the trace never recorded.
    const stale = await iv(['--trace', tracePath, '--head', fixed, '--properties', sidecar]);
    expect(stale.code).toBe(1);
    expect(stale.out).toContain('IV FAIL iv/UNMATCHED_REQUEST');
  }, 120_000);
});

describe('fixtures and sidecars', () => {
  test.each(Object.keys(SPECS) as (keyof typeof SPECS)[])(
    '%s: regenerates byte-identically; its sidecar equals the one derived from the v1 control',
    async (id) => {
      const spec = SPECS[id];
      const g = await generate(spec);
      expect(g.bytes).toBe(readFileSync(spec.file, 'utf8'));
      const side = JSON.parse(readFileSync(spec.file.replace(/\.json$/, '.iv.json'), 'utf8'));
      expect({
        attributableProperties: side.attributableProperties,
        ivProperties: side.ivProperties,
        ivExcluded: side.ivExcluded,
      }).toEqual(g.derived);
      expect(g.trace.target).toEqual([g.derived.attributableProperties[0]]);
      if (id === 'D4-plantedfp') {
        expect(g.trace.violated?.map((v) => v.propertyId).sort()).toEqual([
          'shop.search_products/countMatchesTotal',
          'shop.search_products/items.price.range',
        ]);
        expect(g.trace.target).toEqual(['shop.search_products/countMatchesTotal']);
      }
    },
    300_000,
  );

  test('D2-trace.iv.json equals the sidecar derived from the D2 trace v1 control', async () => {
    const t = JSON.parse(readFileSync(D2_TRACE, 'utf8')) as FrozenTraceFile;
    const c = await controlOfTrace(t, { domain: 'shop', base: 'seed-v1' });
    const side = JSON.parse(readFileSync(join(FIXTURES, 'D2-trace.iv.json'), 'utf8'));
    const { controlCallId: _c, ...rest } = side;
    expect(rest).toEqual(c.derived);
  }, 300_000);
});
