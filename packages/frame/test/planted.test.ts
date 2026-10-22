// Planted false positive (round 6/7 DET acceptance). A shop extension with one extended product
// priced $9 ("Aero Sleeve") that the search "aero" returns on its first page:
//   (a) DEV-X1: the $9 search placed first is not frozen; its items.price.range violation is in
//       nonattributable.jsonl (it also violates on the v1 control);
//   (b) a no-op injector rule over the same enumeration: {detected: false} although violations exist;
//   (c) D4 (base seed-v1): the frozen search violates countMatchesTotal (drift) and
//       items.price.range ($9); sidecar ivProperties has countMatchesTotal, ivExcluded has
//       items.price.range (control verdict violated); violated holds both, target = [countMatchesTotal].
// FIKS parity: the repro of that trace is F PASS on seed-v1 naming countMatchesTotal only, and on
// a seed-v1 worktree with packages/cli/test/oracles/D4.patch the emitted repro passes (P gate)
// although items.price.range still violates on the $9 item (out of scope).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ruleHash } from '@fiks/injector';
import type { EnumRow } from '@fiks/interfaces';
import { generateRepro, passGate, type Trace } from '@fiks/repro';
import { beforeAll, describe, expect, test } from 'vitest';
import {
  asTraceExchanges,
  type DetCallRecord,
  type FrozenTraceFile,
  type IvSidecar,
  type NonAttributableRow,
  receiptOf,
  toJsonl,
} from '../src/index.ts';
import { commitAll, fiks, fiksOk, ROOT, readJson, readLines, shopWorktree, tmp } from './support/cli.ts';

const PKGS = join(ROOT, 'packages/injector/fixtures/driftpkgs');
const D4_PATCH = join(ROOT, 'packages/cli/test/oracles/D4.patch');
const COUNT = 'shop.search_products/countMatchesTotal';
const RANGE = 'shop.search_products/items.price.range';

const PLANTED_ROW: EnumRow = {
  domain: 'shop',
  stratum: 'S-grid',
  tool: 'search_products',
  args: { query: 'aero' },
  dedupeKey: 'planted-aero-9',
};

let dir: string;
let env: Record<string, string>;

/** The per-drift enumeration of `pkg` with the planted $9 search placed first. */
function plantedEnumeration(pkg: string, name: string): string {
  const base = join(dir, `${name}.base.jsonl`);
  fiksOk(['enumerate', '--drift', pkg, '--out', base], env);
  const rows = readLines<EnumRow>(base).filter(
    (r) => JSON.stringify(r.args) !== JSON.stringify(PLANTED_ROW.args),
  );
  const file = join(dir, `${name}.jsonl`);
  writeFileSync(file, toJsonl([PLANTED_ROW, ...rows]));
  return file;
}

beforeAll(() => {
  dir = tmp('planted');
  const entities = [
    {
      id: 'px-plant9',
      name: 'Aero Sleeve',
      category: 'sleeve',
      price: 9,
      currency: 'USD',
      stock: 5,
      authorBatch: 'b01',
    },
    ...[1, 2, 3, 4].map((i) => ({
      id: `px-aero-${i}`,
      name: `Aero Stand ${i}`,
      category: 'stand',
      price: 40 + 10 * i,
      currency: 'USD',
      stock: 5,
      authorBatch: 'b01',
    })),
  ];
  writeFileSync(join(dir, 'ext.json'), JSON.stringify({ entities }));
  env = { VENDOR_EXTENDED_CATALOG: join(dir, 'ext.json') };
});

describe('planted $9 extended product', () => {
  test('(a) DEV-X1 freezes the first drift-attributable call, not the earlier $9 search', () => {
    const enumFile = plantedEnumeration(join(PKGS, 'DEV-X1.json'), 'devx1');
    fiksOk(
      ['record', '--drift', join(PKGS, 'DEV-X1.json'), '--in', enumFile, '--out', join(dir, 'devx1')],
      env,
    );
    const calls = readLines<DetCallRecord>(join(dir, 'devx1/calls.jsonl'));
    expect(calls[0]?.callId).toBe(PLANTED_ROW.dedupeKey);
    expect(receiptOf(calls[0] as DetCallRecord)?.violations.map((v) => v.propertyId)).toEqual([RANGE]);
    const r = fiksOk(
      ['freeze-trace', '--records', join(dir, 'devx1'), '--out', join(dir, 'devx1.trace.json'), '--json'],
      env,
    );
    const frozen = (JSON.parse(r.stdout) as { frozen: { callId: string; target: string[] } }).frozen;
    expect(frozen.callId).not.toBe(PLANTED_ROW.dedupeKey);
    expect(frozen.target).toEqual(['shop.get_product/price.range']);
    const na = readLines<NonAttributableRow>(join(dir, 'devx1/nonattributable.jsonl'));
    expect(na).toContainEqual(
      expect.objectContaining({
        callId: PLANTED_ROW.dedupeKey,
        property: RANGE,
        entity: 'px-plant9',
        originUnit: 'px-plant9',
        controlVerdict: 'violated',
      }),
    );
  });

  test('(b) a no-op injector rule yields {detected: false} although violations exist', () => {
    const rules = join(dir, 'noop');
    mkdirSync(rules, { recursive: true });
    writeFileSync(
      join(rules, 'noop.ts'),
      "const transform = { description: 'no-op', response() { return undefined; } };\nexport default transform;\n",
    );
    const rule = {
      id: 'NOOP',
      domain: 'shop',
      match: { method: 'GET', pathPattern: '^/products/[^/]+$' },
      transform: 'noop.ts',
      clockFrozen: true,
    };
    const hash = ruleHash(rule, join(rules, 'noop.ts'));
    writeFileSync(join(rules, 'rule.json'), JSON.stringify({ ...rule, hash }, null, 2));
    const pkg = {
      id: 'NOOP',
      domain: 'shop',
      base: 'base-shop',
      stratum: 'dev',
      ideationFamily: 'control',
      authorSession: 'DET test',
      injectorRule: { path: 'rule.json', hash },
      hiddenTests: [],
      refA: '',
      refB: '',
      renamedIdVariant: '',
      generators: [],
    };
    writeFileSync(join(rules, 'NOOP.json'), JSON.stringify(pkg, null, 2));
    const enumFile = plantedEnumeration(join(PKGS, 'DEV-X1.json'), 'noop');
    fiksOk(
      ['record', '--drift', join(rules, 'NOOP.json'), '--in', enumFile, '--out', join(dir, 'noop')],
      env,
    );
    const calls = readLines<DetCallRecord>(join(dir, 'noop/calls.jsonl'));
    expect(calls.filter((c) => receiptOf(c)?.verdict === 'violated').length).toBeGreaterThan(0);
    expect(readJson(join(dir, 'noop/detection.json'))).toMatchObject({
      detected: false,
      attributableCalls: 0,
    });
    expect(readLines(join(dir, 'noop/nonattributable.jsonl')).length).toBeGreaterThan(0);
    const out = join(dir, 'noop.trace.json');
    fiksOk(['freeze-trace', '--records', join(dir, 'noop'), '--out', out], env);
    expect(readJson(out)).toMatchObject({ detected: false });
    expect(existsSync(join(dir, 'noop.trace.iv.json'))).toBe(false);
    // The same package as a benign evolution: benign stratum, a v1 control per call.
    fiksOk(
      [
        'record',
        '--benign',
        join(rules, 'NOOP.json'),
        '--in',
        enumFile,
        '--out',
        join(dir, 'benign'),
        '--limit',
        '5',
      ],
      env,
    );
    expect(readLines<DetCallRecord>(join(dir, 'benign/calls.jsonl')).map((c) => c.stratum)).toEqual(
      Array(5).fill('benign'),
    );
    expect(readLines(join(dir, 'benign/controls.jsonl'))).toHaveLength(5);
    expect(readJson(join(dir, 'benign/manifest.json'))).toMatchObject({ kind: 'benign' });
  });

  describe('(c) D4 on seed-v1', () => {
    const trace = () => join(dir, 'd4.trace.json');

    beforeAll(() => {
      const enumFile = plantedEnumeration(join(PKGS, 'D4.json'), 'd4');
      fiksOk(['record', '--drift', join(PKGS, 'D4.json'), '--in', enumFile, '--out', join(dir, 'd4')], env);
      fiksOk(['freeze-trace', '--records', join(dir, 'd4'), '--out', trace()], env);
    });

    test('the frozen search: violated = [items.price.range, countMatchesTotal], target = [countMatchesTotal]; sidecar', () => {
      const t = readJson<FrozenTraceFile>(trace());
      expect(t.args).toEqual(PLANTED_ROW.args);
      expect(t.violated.map((v) => v.propertyId).sort()).toEqual([COUNT, RANGE].sort());
      expect(t.target).toEqual([COUNT]);
      expect(t.profile).toMatchObject({ domain: 'shop', base: 'v1', ruleId: 'D4' });
      const side = readJson<IvSidecar>(join(dir, 'd4.trace.iv.json'));
      expect(side.callId).toBe(PLANTED_ROW.dedupeKey);
      expect(side.attributableProperties).toEqual([COUNT]);
      expect(side.ivProperties).toContain(COUNT);
      expect(side.ivProperties).not.toContain(RANGE);
      expect(side.ivExcluded).toContainEqual({ property: RANGE, controlVerdict: 'violated' });
    });

    test('FIKS parity: F PASS on seed-v1 naming countMatchesTotal only; P passes on the D4.patch head', () => {
      const f = fiks(['repro', '--trace', trace(), '--target', 'seed-v1', '--runs', '3'], env);
      expect(f.code, `${f.stdout}\n${f.stderr}`).toBe(0);
      expect(f.stdout).toContain('F gate on seed-v1: PASS');
      const failing = f.stdout.split('\n').filter((l) => /AssertionError/.test(l));
      expect(failing.length).toBeGreaterThan(0);
      for (const l of failing) {
        expect(l).toContain(COUNT);
        expect(l).not.toContain(RANGE);
      }

      // The fixed head: seed-v1 + the D4 oracle patch.
      const wt = shopWorktree('seed-v1');
      try {
        execFileSync('git', ['apply', D4_PATCH], { cwd: wt.dir, stdio: 'pipe' });
        commitAll(wt.dir, 'apply D4 oracle');
        const t = readJson<Trace>(trace());
        const spec = generateRepro(t, trace(), wt.dir, 'shop');
        // The fix follows next_cursor, so the frozen recording no longer applies; re-record the
        // same call against the same upstream (vendor v1 + extension + D4 rule, frozen clock) on
        // this head, as rerecord-head does (PLAN 3.0 re-record parity).
        writeFileSync(join(dir, 'one.jsonl'), toJsonl([PLANTED_ROW]));
        fiksOk(
          [
            'record',
            '--drift',
            join(PKGS, 'D4.json'),
            '--in',
            join(dir, 'one.jsonl'),
            '--out',
            join(dir, 'd4-fixed'),
            '--server-dir',
            wt.dir,
          ],
          env,
        );
        const [rec] = readLines<DetCallRecord>(join(dir, 'd4-fixed/calls.jsonl')) as [DetCallRecord];
        // The fixed head reads every page: countMatchesTotal holds, the $9 item still violates.
        expect(receiptOf(rec)?.violations.map((v) => v.propertyId)).toEqual([RANGE]);
        const http = asTraceExchanges(rec.upstream, rec.capturedAt);
        const rerecorded = {
          id: `${t.id}.rerecorded`,
          capturedAt: t.capturedAt,
          tool: t.tool,
          args: t.args,
          result: rec.output,
          http,
          vendorVersionHeader: http[0]?.response.headers['vendor-api-version'],
          upstream: t.upstream,
          violated: t.violated,
          target: t.target,
          profile: t.profile,
        };
        expect(rerecorded.vendorVersionHeader).toBe(t.vendorVersionHeader);
        writeFileSync(
          join(wt.dir, spec.tracePath.replace(/\.json$/, '.rerecorded.json')),
          `${JSON.stringify(rerecorded, null, 2)}\n`,
        );
        const p = passGate(wt.dir, spec, 'shop');
        expect(p.ok, `${p.reason}\n${JSON.stringify(p.evidence.failed)}`).toBe(true);
      } finally {
        wt.remove();
      }
    });
  });
});
