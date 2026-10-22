// Drift, mutant and detector runs (DET acceptance): record --drift DEV-X1 (log-only outputs =
// a run without the proxy; >= 1 violated verdict), freeze-trace (3 runs, identical sha256) and
// the FIKS repro's F gate on base-shop, detect-eval (20 replays identical), --mutant M1/M14, and
// record --domain tracker --drift TRK-DEV-1 through the DOM2 bootstrap registration.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrozenTrace } from '@fiks/interfaces';
import { SHOP_FROZEN_CLOCK } from '@fiks/vendor-api';
import { beforeAll, describe, expect, test } from 'vitest';
import { type DetCallRecord, receiptOf, sha256File } from '../src/index.ts';
import { fiks, fiksOk, ROOT, readJson, readLines, tmp } from './support/cli.ts';
import { shopExtension, writeCatalog } from './support/synthetic.ts';

const DEVX1 = join(ROOT, 'packages/injector/fixtures/driftpkgs/DEV-X1.json');
const TRK = join(ROOT, 'packages/vendor-tracker/fixtures/driftpkgs/TRK-DEV-1.json');
const TRK_STUB = join(ROOT, 'packages/vendor-tracker/fixtures/dev-stub.contracts.json');

let dir: string;
let env: Record<string, string>;

beforeAll(() => {
  dir = tmp('drift');
  env = { VENDOR_EXTENDED_CATALOG: writeCatalog(join(dir, 'shop-ext.json'), shopExtension(60)) };
  fiksOk(['enumerate', '--drift', DEVX1, '--out', join(dir, 'devx1.jsonl')], env);
  fiksOk(['record', '--drift', DEVX1, '--in', join(dir, 'devx1.jsonl'), '--out', join(dir, 'devx1')], env);
});

describe('record --drift DEV-X1', () => {
  test('log-only: tool outputs equal a run without the proxy; >= 1 violated verdict; v1 controls', () => {
    fiksOk(
      [
        'record',
        '--drift',
        DEVX1,
        '--direct',
        '--in',
        join(dir, 'devx1.jsonl'),
        '--out',
        join(dir, 'direct'),
      ],
      env,
    );
    const calls = readLines<DetCallRecord>(join(dir, 'devx1/calls.jsonl'));
    const direct = readLines<DetCallRecord>(join(dir, 'direct/calls.jsonl'));
    expect(calls.length).toBeGreaterThan(60);
    expect(direct.map((d) => d.callId)).toEqual(calls.map((c) => c.callId));
    for (const [i, c] of calls.entries())
      expect(JSON.stringify(c.output)).toBe(JSON.stringify(direct[i]?.output));
    expect(calls.filter((c) => receiptOf(c)?.verdict === 'violated').length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.capturedAt).toBe(SHOP_FROZEN_CLOCK);
      expect(c.drift).toBe('DEV-X1');
      expect(c.events[0]).toMatchObject({ type: 'call', logOnly: true, monitor: 'contracts' });
    }
    // Every drift call has a v1 control: same rows, fresh vendor, no rule.
    const controls = readLines<DetCallRecord>(join(dir, 'devx1/controls.jsonl'));
    expect(controls.map((c) => c.controlOf)).toEqual(calls.map((c) => c.callId));
    for (const c of controls) {
      expect(c.drift).toBeNull();
      expect(c.capturedAt).toBe(SHOP_FROZEN_CLOCK);
    }
    // DEV-X1 moves get_product to cents: v1 prices verify on the control, the drift violates.
    const p1001 = calls.find((c) => c.tool === 'get_product' && c.args.id === 'p-1001') as DetCallRecord;
    expect(receiptOf(p1001)?.violations.map((v) => v.propertyId)).toEqual(['shop.get_product/price.range']);
    const ctl = controls.find((c) => c.controlOf === p1001.callId) as DetCallRecord;
    expect(receiptOf(ctl)?.verdict).toBe('verified');
    expect(readJson(join(dir, 'devx1/detection.json'))).toMatchObject({ detected: true, driftId: 'DEV-X1' });
  });

  test('freeze-trace: 3 runs give identical sha256; repro --target base-shop --runs 3 is F PASS', () => {
    const shas = [1, 2, 3].map((i) => {
      const r = fiksOk(
        ['freeze-trace', '--records', join(dir, 'devx1'), '--out', join(dir, `t${i}.json`), '--json'],
        env,
      );
      const f = (JSON.parse(r.stdout) as { frozen: FrozenTrace }).frozen;
      expect(sha256File(join(dir, `t${i}.json`))).toBe(f.sha256);
      expect(sha256File(join(dir, `t${i}.iv.json`))).toBe(f.ivSidecarSha256);
      return [f.sha256, f.ivSidecarSha256].join(':');
    });
    expect(new Set(shas).size).toBe(1);
    const trace = readJson<{ target: string[]; violated: { propertyId: string }[]; profile: unknown }>(
      join(dir, 't1.json'),
    );
    expect(trace.target).toEqual(['shop.get_product/price.range']);
    expect(trace.profile).toMatchObject({ domain: 'shop', base: 'v1', ruleId: 'DEV-X1' });
    // The sidecar never travels in the agent-visible trace.
    for (const k of ['ivProperties', 'ivExcluded', 'controlCallId', 'attributableProperties'])
      expect(trace).not.toHaveProperty(k);
    const r = fiks(['repro', '--trace', join(dir, 't1.json'), '--target', 'base-shop', '--runs', '3'], env);
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain('F gate on base-shop: PASS');
    expect(r.stdout).toContain('shop.get_product/price.range');
  });

  test('detect-eval contracts,b-snap,b-schema: truth() labels and origin units; 20 replays identical', () => {
    const r = fiksOk(
      [
        'detect-eval',
        '--detectors',
        'contracts,b-snap,b-schema',
        '--inputs',
        join(dir, 'devx1'),
        '--out',
        join(dir, 'detect'),
        '--replays',
        '20',
        '--json',
      ],
      env,
    );
    expect(JSON.parse(r.stdout)).toMatchObject({ replays: 20, distinctHashes: 1 });
    const rows = readLines<Record<string, unknown>>(join(dir, 'detect/rows.jsonl'));
    expect(new Set(rows.map((x) => x.detector))).toEqual(new Set(['contracts', 'B-SNAP', 'B-SCHEMA']));
    for (const row of rows) {
      expect(['correct', 'wrong', 'invalid-input']).toContain(row.truthLabel);
      expect(typeof row.originUnit).toBe('string');
    }
    const p1001 = rows.find(
      (x) => x.detector === 'contracts' && x.originUnit === 'p-1001' && x.role === 'call',
    );
    expect(p1001).toMatchObject({
      verdict: 'violated',
      truthLabel: 'wrong',
      property: 'shop.get_product/price.range',
    });
    const again = fiksOk(
      [
        'detect-eval',
        '--detectors',
        'contracts,b-snap,b-schema',
        '--inputs',
        join(dir, 'devx1'),
        '--out',
        join(dir, 'detect2'),
      ],
      env,
    );
    expect(again.code).toBe(0);
    expect(readFileSync(join(dir, 'detect2/rows.jsonl'), 'utf8')).toBe(
      readFileSync(join(dir, 'detect/rows.jsonl'), 'utf8'),
    );
  });
});

describe('record --mutant', () => {
  test('M1 and M14 re-run the server on mutated upstream bodies; the unmutated replay is the control', () => {
    fiksOk(
      [
        'enumerate',
        '--domain',
        'shop',
        '--frame',
        '--catalog',
        'original',
        '--seed',
        '1',
        '--out',
        join(dir, 'v1.jsonl'),
      ],
      env,
    );
    // Monitored v1 records keep the read-back probe exchanges, which M14 needs.
    fiksOk(
      [
        'record',
        '--domain',
        'shop',
        '--frame',
        '--catalog',
        'original',
        '--monitor',
        'contracts',
        '--in',
        join(dir, 'v1.jsonl'),
        '--out',
        join(dir, 'v1'),
      ],
      env,
    );
    const input = new Map(readLines<DetCallRecord>(join(dir, 'v1/calls.jsonl')).map((r) => [r.callId, r]));
    for (const op of ['M1', 'M14']) {
      fiksOk(['record', '--mutant', op, '--in', join(dir, 'v1'), '--out', join(dir, op)], env);
      const calls = readLines<DetCallRecord>(join(dir, `${op}/calls.jsonl`));
      const controls = new Map(
        readLines<DetCallRecord>(join(dir, `${op}/controls.jsonl`)).map((c) => [c.controlOf as string, c]),
      );
      expect(calls.length).toBeGreaterThan(0);
      let differs = 0;
      for (const c of calls) {
        expect(c.mutant).toBe(op);
        expect(c.mutation?.some((m) => m.applicable)).toBe(true);
        const ctl = controls.get(c.callId) as DetCallRecord;
        const orig = input.get(ctl.callId) as DetCallRecord;
        // The control (server re-run on the unmutated bodies) reproduces the recorded output.
        expect(JSON.stringify(ctl.output)).toBe(JSON.stringify(orig.output));
        if (JSON.stringify(c.output) !== JSON.stringify(orig.output)) differs++;
      }
      expect(differs, op).toBeGreaterThan(0);
      if (op === 'M1') {
        const price = calls.find(
          (c) => c.tool === 'search_products' && c.mutation?.some((m) => m.site === 'items[*].price'),
        );
        expect(price, 'an M1 mutant of a search price').toBeTruthy();
        expect(JSON.stringify(price?.output)).not.toBe(
          JSON.stringify(input.get(price?.callId.slice(3) ?? '')?.output),
        );
      }
      if (op === 'M14') {
        const det = readJson<{ attributions: { callId: string; attributable: string[] }[] }>(
          join(dir, 'M14/detection.json'),
        );
        const writes = det.attributions.filter(
          (a) => a.callId.startsWith('M14:') && a.attributable.includes('shop.create_order/readAfterWrite'),
        );
        expect(writes.length, 'a phantom write caught by read-after-write').toBeGreaterThan(0);
      }
    }
  });
});

describe('record --domain tracker --drift TRK-DEV-1', () => {
  test('records through the DOM2 bootstrap; a stub contract makes >= 1 call violate', () => {
    const tenv = {
      ...env,
      TRACKER_EXTENDED_CATALOG: join(ROOT, 'packages/vendor-tracker/test/fixtures/extended-sample.json'),
    };
    fiksOk(['enumerate', '--drift', TRK, '--out', join(dir, 'trk.jsonl')], tenv);
    const r = fiksOk(
      [
        'record',
        '--domain',
        'tracker',
        '--drift',
        TRK,
        '--contracts',
        TRK_STUB,
        '--in',
        join(dir, 'trk.jsonl'),
        '--out',
        join(dir, 'trk'),
        '--json',
      ],
      tenv,
    );
    const out = JSON.parse(r.stdout) as {
      manifest: { domain: string; server: { ref: string } };
      detection: { detected: boolean };
    };
    expect(out.manifest).toMatchObject({ domain: 'tracker', server: { ref: 'dev-tracker-stub' } });
    const calls = readLines<DetCallRecord>(join(dir, 'trk/calls.jsonl'));
    expect(calls.every((c) => c.domain === 'tracker' && c.capturedAt === '2026-10-01T12:00:00.000Z')).toBe(
      true,
    );
    expect(calls.some((c) => receiptOf(c)?.verdict === 'violated')).toBe(true);
    expect(out.detection.detected).toBe(true);
    // Before the A0 tracker contracts exist, every verdict is unverifiable.
    if (existsSync(join(ROOT, 'packages/contracts/contracts/tracker-mcp.contracts.json'))) return;
    const none = fiks(
      [
        'record',
        '--domain',
        'tracker',
        '--drift',
        TRK,
        '--in',
        join(dir, 'trk.jsonl'),
        '--out',
        join(dir, 'trk-nc'),
        '--limit',
        '5',
      ],
      tenv,
    );
    expect(none.code).toBe(0);
    for (const c of readLines<DetCallRecord>(join(dir, 'trk-nc/calls.jsonl')))
      expect(receiptOf(c)?.verdict).toBe('unverifiable');
  });
});
