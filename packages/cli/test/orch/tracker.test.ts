// TRK-DEV-1 on the tracker domain (base dev-tracker-stub, DOM2's dev stub contract), through the
// CLI: a stub agent applying ref A gives F PASS and would_open_pr after green ci-local. The
// fixture's regeneration is in fixtures.test.ts. Opt-in: FIKS_ORCH_E2E=1.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { ArmResult } from '../../src/commands/repair.ts';
import { ROOT, repoDir } from '../../src/paths.ts';
import { ARM_TIMEOUT, E2E, fiks, readJsonl, toolsImage } from './support/arm.ts';
import { ORCH_FIXTURES } from './support/gen.ts';
import { script, sessionFromPatch } from './support/stubs.ts';

const out = mkdtempSync(join(tmpdir(), 'fiks-orch-trk-'));

describe.runIf(E2E)('tracker domain', () => {
  test(
    'TRK-DEV-1, ref A stub: F PASS and would_open_pr after green ci-local',
    async () => {
      const refA = join(ROOT, 'packages/vendor-tracker/fixtures/driftpkgs/TRK-DEV-1/refA.patch');
      const stub = join(out, 'TRK-DEV-1-refA.json');
      writeFileSync(
        stub,
        JSON.stringify(script(sessionFromPatch(repoDir('tracker'), 'dev-tracker-stub', refA))),
      );
      const r = fiks([
        'repair',
        '--arm',
        'fiks',
        '--domain',
        'tracker',
        '--trace',
        join(ORCH_FIXTURES, 'TRK-DEV-1.trace.json'),
        '--base',
        'dev-tracker-stub',
        '--agent-stub',
        stub,
        '--ci',
        'local',
        '--no-pr',
        '--run-key',
        'orch-test/fiks/stub/tracker/TRK-DEV-1/1',
        '--tools-image',
        await toolsImage(),
        '--test-tools',
        '--out',
        out,
        '--json',
      ]);
      expect(r.status, `${r.stderr}\n${r.stdout.slice(-3000)}`).toBe(0);
      const res = JSON.parse(r.stdout) as ArmResult;
      expect(res.status).toBe('would_open_pr');
      expect(res.domain).toBe('tracker');
      expect(res.profile).toMatchObject({ domain: 'tracker', ruleId: 'TRK-DEV-1' });
      expect(res.gates[0]).toMatchObject({ gate: 'F', ok: true });
      expect(res.gates.map((g) => `${g.gate}:${g.ok}`)).toEqual(
        ['F', 'P', 'suite', 'traces', 'typecheck', 'lint', 'ci-local'].map((g) => `${g}:true`),
      );
      const ev = readJsonl<{ type: string; ok?: boolean }>(join(res.dir, 'events.jsonl'));
      const ci = ev.findIndex((e) => e.type === 'gate_ci-local' && e.ok === true);
      expect(ev.findIndex((e) => e.type === 'would_open_pr')).toBeGreaterThan(ci);
      expect(readFileSync(join(res.dir, 'frozen-trace.json'), 'utf8')).toBe(
        readFileSync(join(ORCH_FIXTURES, 'TRK-DEV-1.trace.json'), 'utf8'),
      );
    },
    ARM_TIMEOUT,
  );
});
