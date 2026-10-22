// FIKS arm units with no container: flag parsing and refusals, gate-name mapping, rule lookup, the
// injector bootstrap, the replay link, contract-update parsing, stored traces and the host-side
// verification of fiks's re-recordings.
import './support/arm.ts';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Recording } from '@fiks/contracts';
import type { InjectorRule } from '@fiks/interfaces';
import { getInjectorFactory } from '@fiks/vendor-api';
import { describe, expect, test } from 'vitest';
import {
  ArmUsageError,
  armOptionsFromArgv,
  canonicalGateName,
  contractUpdateIn,
  findRule,
  gateVerdicts,
  loadRuleArg,
  replayMiddleware,
  runArm,
  storedViolationTraces,
  verifyAgainstUpstream,
} from '../../src/commands/repair.ts';
import { ROOT } from '../../src/paths.ts';
import { fiks } from './support/arm.ts';

const D2_TRACE = join(ROOT, 'packages/cli/test/core/fixtures/D2-trace.json');

describe('gate-name mapping (legacy logs)', () => {
  test("a recorded run's 'ci' gate is 'ci-local'; verdicts compare by name and pass/fail only", () => {
    expect(canonicalGateName('ci')).toBe('ci-local');
    expect(canonicalGateName('P')).toBe('P');
    const legacy = gateVerdicts([
      { gate: 'F', ok: true },
      { gate: 'P', ok: true },
      { gate: 'ci', ok: true },
    ]);
    const now = gateVerdicts([
      { gate: 'F', ok: true },
      { gate: 'P', ok: true },
      { gate: 'ci-local', ok: true },
    ]);
    expect(now).toEqual(legacy);
  });
});

describe('experiment flags', () => {
  test('--trace-format strict reaches the arm options; raw is the default', () => {
    const base = ['--arm', 'fiks', '--base', 'seed-v1', '--trace', D2_TRACE];
    expect(armOptionsFromArgv([...base, '--trace-format', 'strict']).traceFormat).toBe('strict');
    expect(armOptionsFromArgv(base).traceFormat).toBe('raw');
    expect(() => armOptionsFromArgv([...base, '--trace-format', 'bold'])).toThrow(ArmUsageError);
  });

  test('the arm comes from --arm or the run key; --base is required', () => {
    const o = armOptionsFromArgv([
      '--run-key',
      'test/fiks/m/shop/D2/1',
      '--base',
      'seed-v1',
      '--trace',
      D2_TRACE,
    ]);
    expect(o.arm).toBe('fiks');
    expect(() => armOptionsFromArgv(['--arm', 'fiks', '--trace', D2_TRACE])).toThrow(/--base/);
    expect(() => armOptionsFromArgv(['--arm', 'l1', '--base', 'x', '--trace', D2_TRACE])).toThrow(
      /fiks or fiks\+cu/,
    );
  });

  test('--fetch with --run-key, --ci github and a bad run key are refused before anything runs', async () => {
    const out = mkdtempSync(join(tmpdir(), 'fiks-orch-unit-'));
    const common = { arm: 'fiks' as const, base: 'seed-v1', traceFile: D2_TRACE, outRoot: out };
    await expect(runArm({ ...common, runKey: 't/fiks/m/shop/D2/1', fetch: true })).rejects.toThrow(
      /--fetch is refused with --run-key/,
    );
    await expect(runArm({ ...common, ci: 'github' })).rejects.toThrow(/no push and no gh call/);
    await expect(runArm({ ...common, runKey: 'not/a/key' })).rejects.toThrow(ArmUsageError);
  });

  test('pnpm fiks repair --base no-such-ref exits 2 with a clear message and writes nothing', () => {
    const out = mkdtempSync(join(tmpdir(), 'fiks-orch-unit-'));
    const r = fiks([
      'repair',
      '--arm',
      'fiks',
      '--trace',
      D2_TRACE,
      '--base',
      'no-such-ref',
      '--run-key',
      'test/fiks/claude-opus-5-5/shop/D2/1',
      '--ci',
      'local',
      '--no-pr',
      '--out',
      out,
    ]);
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toMatch(/unknown --base "no-such-ref".*no local branch, tag or commit/);
    expect(fiks(['repair', '--definitely-not-a-flag', '--arm', 'fiks']).status).toBe(2);
  }, 120_000);

  test('a run key whose results exist is refused (exit 2); results are never overwritten', () => {
    const out = mkdtempSync(join(tmpdir(), 'fiks-orch-unit-'));
    mkdirSync(join(out, 'test/fiks/m/shop/D2/1'), { recursive: true });
    const r = fiks([
      'repair',
      '--arm',
      'fiks',
      '--trace',
      D2_TRACE,
      '--base',
      'seed-v1',
      '--run-key',
      'test/fiks/m/shop/D2/1',
      '--out',
      out,
    ]);
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toMatch(/already exist .* never overwritten/);
  }, 120_000);
});

describe('injector rules', () => {
  test('a profile names a rule by id and hash; it is found in the INJ and DOM2 fixtures', () => {
    const x1 = JSON.parse(
      readFileSync(join(ROOT, 'packages/cli/test/orch/fixtures/DEV-X1.trace.json'), 'utf8'),
    ) as { profile: { ruleId: string; ruleHash: string } };
    expect(findRule(x1.profile.ruleId, x1.profile.ruleHash)?.id).toBe('DEV-X1');
    expect(findRule('TRK-DEV-1', null)?.domain).toBe('tracker');
    expect(findRule('DEV-X1', '0'.repeat(64))).toBeUndefined();
    const fromPkg = loadRuleArg(join(ROOT, 'packages/injector/fixtures/driftpkgs/D3.json'));
    expect(fromPkg.id).toBe('D3');
  });

  test('bootstrap/30-injector.ts: a plain rule object (relative transform) is applied in front of the target', async () => {
    const upstream = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ items: [{ id: 'p-1', price: 12.5 }], total: 1, next_cursor: null }));
    });
    await new Promise<void>((ok) => upstream.listen(0, '127.0.0.1', () => ok()));
    const target = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    const rule = JSON.parse(
      readFileSync(join(ROOT, 'packages/injector/fixtures/rules/D1.json'), 'utf8'),
    ) as InjectorRule;
    const factory = getInjectorFactory();
    expect(factory).toBeDefined();
    const inj = await (factory as NonNullable<typeof factory>)({ target, rule });
    try {
      const res = await fetch(`${inj.url}/products?q=x`);
      expect(res.headers.get('vendor-api-version')).toBe('2026-10-01');
      expect(((await res.json()) as { items: { price: number }[] }).items[0]?.price).toBe(1250);
    } finally {
      await inj.close();
      upstream.close();
    }
  });
});

describe('replay link and contract-update parsing', () => {
  test('replayMiddleware answers recorded exchanges in order by method + path + query; others get 404', async () => {
    const link = replayMiddleware([
      {
        request: { method: 'GET', url: '/a?x=1', headers: {}, body: null },
        response: { status: 200, headers: { 'content-type': 'application/json' }, body: '{"n":1}' },
      },
      {
        request: { method: 'GET', url: '/a?x=1', headers: {}, body: null },
        response: { status: 200, headers: { 'content-type': 'application/json' }, body: '{"n":2}' },
      },
    ]);
    const s = await link.start('http://127.0.0.1:9');
    try {
      expect(await (await fetch(`${s.url}/a?x=1`)).text()).toBe('{"n":1}');
      expect(await (await fetch(`${s.url}/a?x=1`)).text()).toBe('{"n":2}');
      expect((await fetch(`${s.url}/a?x=1`)).status).toBe(404);
      expect((await fetch(`${s.url}/b`)).status).toBe(404);
    } finally {
      await s.close();
    }
  });

  test('contractUpdateIn finds the outcome JSON in a fenced block or bare, and ignores other JSON', () => {
    const delta = { ops: [], rationale: 'r' };
    const fenced = `Subject: widen\n\`\`\`json\n${JSON.stringify({ outcome: 'contract_update', delta })}\n\`\`\``;
    expect(contractUpdateIn(fenced)).toEqual({ outcome: 'contract_update', delta });
    expect(contractUpdateIn(`done ${JSON.stringify({ outcome: 'contract_update', delta })}`)).toEqual({
      outcome: 'contract_update',
      delta,
    });
    expect(contractUpdateIn('Subject: fix\n```json\n{"a":1}\n```')).toBeUndefined();
    expect(contractUpdateIn('Subject: fix price\nRead unit_amount.')).toBeUndefined();
  });

  test('stored traces: test/traces/** and test/repro/*.json of the head plus extra dirs, never the trigger', () => {
    const cu = join(ROOT, 'packages/contract-update/test/fixtures/traces');
    const all = storedViolationTraces(mkdtempSync(join(tmpdir(), 'fiks-orch-empty-')), [cu]);
    expect(all.length).toBe(5);
    const first = all[0] as Recording;
    const without = storedViolationTraces(mkdtempSync(join(tmpdir(), 'fiks-orch-empty-')), [cu], first.id);
    expect(without.map((r) => r.id)).not.toContain(first.id);
    expect(without.length).toBe(4);
  });
});

describe("host-side verification of fiks's re-recordings", () => {
  test('an honest recording matches the trusted upstream; a doctored body or status does not', async () => {
    const rec = JSON.parse(readFileSync(D2_TRACE, 'utf8')) as Recording;
    const profile = { domain: 'shop', base: 'v2', ruleId: null, ruleHash: null };
    expect(await verifyAgainstUpstream(rec, profile, undefined)).toEqual([]);
    const doctored = structuredClone(rec);
    const ex = doctored.http[0] as (typeof doctored.http)[number];
    ex.response.body = ex.response.body.replace('unit_amount', 'price');
    expect((await verifyAgainstUpstream(doctored, profile, undefined)).join('\n')).toMatch(/body differs/);
    const status = structuredClone(rec);
    (status.http[0] as (typeof status.http)[number]).response.status = 404;
    expect((await verifyAgainstUpstream(status, profile, undefined)).join('\n')).toMatch(/recorded 404/);
  }, 60_000);
});
