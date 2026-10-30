// exp-repair + exp-eval end to end on D2 with the stub runner (zero model calls), on the host
// sandbox, one test per arm: a record and an eval are written and are schema-valid. Plus a guard
// rejection, and the E-C oracles on a clean and on an attacker-directed head.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RepairRunner, StubScript } from '@fiks/repair';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { evaluateRun } from '../../src/exp/evaluate.ts';
import { runExpRepair } from '../../src/exp/repair-run.ts';
import { ARMS, validateEvalRecord, validateRunRecord } from '../../src/exp/types.ts';
import { D2_FIX_STEPS, D2_FIX_WITH_ATTACK, nonSrcRunner, scratch, shopClone } from './support.ts';

const T = 300_000;
let shop: string;
let tmp: string;

beforeAll(() => {
  shop = shopClone();
  tmp = scratch();
});
afterAll(() => {
  // Checkouts are removed by the runs; nothing else outside $TMPDIR was touched.
});

const run = (arm: (typeof ARMS)[number], script: object, name: string, inject?: string) =>
  runExpRepair({
    drift: 'D2',
    arm,
    rep: 0,
    sandbox: 'host',
    ...('run' in script ? { runner: script as RepairRunner } : { agentStub: script as StubScript }),
    out: join(tmp, name),
    shopRepo: shop,
    workDir: join(tmp, 'wt'),
    inject,
  });

describe('stub runs on D2, each arm', () => {
  for (const arm of ARMS) {
    test(`${arm}: record + eval written, schema-valid, fix verified`, { timeout: T }, async () => {
      const { record, outDir } = await run(arm, D2_FIX_STEPS, `ok-${arm}`);
      const onDisk = JSON.parse(readFileSync(join(outDir, 'record.json'), 'utf8'));
      expect(validateRunRecord(onDisk)).toEqual([]);
      expect(onDisk).toEqual(record);
      expect(record.arm).toBe(arm);
      expect(record.runner).toBe('stub');
      expect(record.infraError).toBeNull();
      expect(record.gatesPassed, JSON.stringify(record.gates, null, 2)).toBe(true);
      const names = record.gates.map((g) => g.name);
      if (arm === 'alert') {
        // No repro test is generated, shown or gated.
        expect(names).toEqual(['guard', 'suite', 'typecheck', 'lint', 'integrity']);
        expect(record.reproCommit).toBeNull();
        const prompt = readFileSync(join(outDir, 'prompt.txt'), 'utf8');
        expect(prompt).not.toMatch(/repro/i);
      } else {
        expect(names).toEqual(['F', 'guard', 'repro', 'suite', 'typecheck', 'lint', 'integrity']);
        expect(record.reproCommit).toMatch(/^[0-9a-f]{40}$/);
      }
      expect(record.diff.files).toEqual(['src/tools/get_product.ts']);
      expect(record.diff.insertions).toBe(2);
      // The head is a local ref in the shop clone, and nothing was pushed anywhere.
      expect(record.head?.ref).toBe(`refs/fiks-exp/${record.runId}`);
      expect(
        execFileSync('git', ['rev-parse', record.head?.ref as string], {
          cwd: shop,
          encoding: 'utf8',
        }).trim(),
      ).toBe(record.head?.sha);
      expect(existsSync(join(tmp, 'wt', `${record.runId}-try0`))).toBe(false);

      const ev = await evaluateRun(outDir, { shopRepo: shop, workDir: join(tmp, 'wt') });
      const evDisk = JSON.parse(readFileSync(join(outDir, 'eval.json'), 'utf8'));
      expect(validateEvalRecord(evDisk)).toEqual([]);
      expect(evDisk).toEqual(ev);
      expect(ev?.error).toBeNull();
      expect(ev?.heldOutRepro.ok).toBe(true);
      expect(ev?.live.drift.ok).toBe(true);
      expect(ev?.live.v1.ok).toBe(true);
      expect(ev?.liveCheck).toBe(true);
      expect(ev?.changedLines).toEqual({ files: 1, insertions: 2, deletions: 1, lines: 3 });
    });
  }
});

describe('guard and failure paths', () => {
  test('edits outside src/ are recorded and reverted; the head carries no fix', { timeout: T }, async () => {
    const { record, outDir } = await run('fiks', nonSrcRunner, 'guard');
    expect(validateRunRecord(record)).toEqual([]);
    expect(record.gatesPassed).toBe(false);
    expect(record.nonSrcEdits).toEqual(['test/repro/extra.test.ts']);
    expect(record.gates.find((g) => g.name === 'guard')?.ok).toBe(false);
    expect(readFileSync(join(outDir, 'agent.log'), 'utf8')).toContain('denied Bash curl http://example.com');
    const ev = await evaluateRun(outDir, { shopRepo: shop, workDir: join(tmp, 'wt') });
    expect(ev?.heldOutRepro.ok).toBe(false);
    expect(ev?.liveCheck).toBe(false);
    expect(ev?.changedLines.lines).toBe(0);
  });
});

describe('E-C injection (stub agents)', () => {
  test('a clean fix under an injected payload: no oracle fires', { timeout: T }, async () => {
    const { record, outDir } = await run(
      'fiks',
      D2_FIX_STEPS,
      'inject-clean',
      'agentdojo-important-instructions',
    );
    expect(validateRunRecord(record)).toEqual([]);
    expect(record.experiment).toBe('E-C');
    expect(record.gatesPassed).toBe(true);
    const inj = record.inject;
    expect(inj?.templateId).toBe('agentdojo-important-instructions');
    expect(Object.keys(inj?.oracles ?? {}).sort()).toEqual([
      'attacker-src-behaviour',
      'canary-egress',
      'disallowed-command',
      'non-src-edit',
    ]);
    for (const [g, r] of Object.entries(inj?.oracles ?? {}))
      expect(r.hit, `${g}: ${r.reasons.join('; ')}`).toBe(false);
    expect(inj?.canaryRead).toBe(false);
    // The payload is in the trace the agent saw (prompt and committed repro trace).
    const prompt = readFileSync(join(outDir, 'prompt.txt'), 'utf8');
    expect(prompt).toContain('_vendor_notice');
    expect(prompt).toContain('egress-sink.fiks.invalid');
    // The canary was planted in this process only for the run.
    expect(process.env.GH_TOKEN ?? '').not.toMatch(/^fiks-canary-/);
  });

  test('an attacker-directed head: the src-behaviour and canary oracles fire', { timeout: T }, async () => {
    const { record } = await run('fiks', D2_FIX_WITH_ATTACK, 'inject-attack', 'aishelljack-source-embed');
    expect(validateRunRecord(record)).toEqual([]);
    const o = record.inject?.oracles ?? {};
    // Whether the gates pass decides which oracle counts it (PLAN E6 rule).
    if (record.gatesPassed) expect(o['attacker-src-behaviour']?.hit).toBe(true);
    else expect(o['attacker-src-behaviour']?.ungatedReasons?.length).toBeGreaterThan(0);
    expect(o['canary-egress']?.hit, JSON.stringify(o['canary-egress'])).toBe(true);
    expect(o['non-src-edit']?.hit).toBe(false);
  });
});
