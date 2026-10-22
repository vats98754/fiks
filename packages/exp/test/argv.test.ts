// argv templates: every experiment arm gets --trace and --base and never --fetch; R11 is product mode.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ARMS, type ArmName, armArgv, assertArmArgv, showcaseArgv } from '../src/argv.ts';
import { showcaseDraw, showcaseSteps } from '../src/commands.ts';
import type { DriftInput } from '../src/inputs.ts';
import { RUNS } from '../src/runs.ts';
import { configSteps, DEFAULT_PARAMS, PROJECTED_RUNS } from '../src/steps.ts';
import { makeEnv, runCli, tmp } from './support/harness.ts';

const drift = (id: string, domain = 'shop'): DriftInput => ({
  id,
  domain,
  base: domain === 'shop' ? 'base-shop' : 'seed-tracker-v1',
  recordPkg: null,
  gradePkg: null,
  trace: `/frozen/${id}.json`,
  stratum: 'realistic',
  issue: `/issues/${id}.md`,
  cleanCorpus: '/corpus',
});

/** A manifest for every manifest-driven run, so --print-plan covers R3, R4, R6, R7 and R8. */
function manifests(out: string) {
  const rows = [drift('T001'), drift('T002', 'tracker')];
  for (const p of ['R2/eligible.json', 'R2/benign-eligible.json', 'R7/carriers.json', 'R8/inputs.json']) {
    mkdirSync(join(out, p, '..'), { recursive: true });
    writeFileSync(join(out, p), JSON.stringify({ drifts: rows }));
  }
  mkdirSync(join(out, 'K1'), { recursive: true });
  writeFileSync(
    join(out, 'K1', 'fit.json'),
    JSON.stringify({ seed: 'k1', chosen: configSteps(DEFAULT_PARAMS)[1] }),
  );
}

describe('arm argv', () => {
  test('every arm: --trace, --base, --run-key, --ci local, --no-pr; never --fetch', () => {
    for (const arm of ARMS) {
      const argv = armArgv({
        arm: arm as ArmName,
        runKey: {
          experiment: 'R4',
          arm,
          model: 'claude-opus-5-5',
          domain: 'shop',
          drift: 'T001',
          attempt: 1,
        },
        drift: drift('T001'),
        trace: '/frozen/T001.json',
        fiks: ['pnpm', 'fiks'],
      });
      expect(argv).toContain('--trace');
      expect(argv).toContain('--base');
      expect(argv[argv.indexOf('--base') + 1]).toBe('base-shop');
      expect(argv).not.toContain('--fetch');
      expect(argv.slice(0, 3)).toEqual(
        arm.startsWith('FIKS') ? ['pnpm', 'fiks', 'repair'] : ['pnpm', 'fiks', 'arm'],
      );
    }
    expect(() =>
      assertArmArgv(['pnpm', 'fiks', 'arm', '--base', 'b', '--run-key', 'k', '--ci', 'local', '--no-pr']),
    ).toThrow(/--trace/);
    expect(() =>
      assertArmArgv([
        'x',
        '--trace',
        't',
        '--base',
        'b',
        '--run-key',
        'k',
        '--ci',
        'local',
        '--no-pr',
        '--fetch',
      ]),
    ).toThrow(/--fetch/);
  });

  test('every generated argv of every block run (--print-plan) carries --trace and --base and never --fetch', async () => {
    const e = makeEnv();
    manifests(e.out);
    let checked = 0;
    for (const r of RUNS.filter((x) => x.kind === 'blocks')) {
      const args = [r.id, '--dry', '--print-plan', '--out-root', e.out];
      if (r.id === 'R8') {
        // gated on RBA; its argv are covered by the unit test above and the R7/R4 plans.
        continue;
      }
      const res = await runCli(args, e.env);
      expect(res.code, `${r.id}: ${res.stderr}`).toBe(0);
      const plan = JSON.parse(res.stdout) as { blocks: { jobs: { argv: string[] }[] }[] };
      expect(plan.blocks.length, r.id).toBeGreaterThan(0);
      for (const b of plan.blocks)
        for (const j of b.jobs) {
          expect(j.argv).toContain('--trace');
          expect(j.argv).toContain('--base');
          expect(j.argv.some((a) => a.startsWith('--fetch'))).toBe(false);
          checked++;
        }
    }
    expect(checked).toBeGreaterThan(100);
  }, 120_000);
});

describe('R11 (D10 showcase)', () => {
  const eligible = [drift('T001'), drift('T002'), drift('T050', 'tracker'), drift('T051', 'tracker')];
  const ctx = {
    outRoot: '/o',
    runDir: '/o/R11',
    fiks: ['pnpm', 'fiks'],
    tsx: ['pnpm', 'tsx'],
    dry: false,
    toolsImage: null,
  };

  test('two product-mode argv: no --no-pr, --arm or --run-key; --ci github; --base showcase/<driftId>', () => {
    const drawn = showcaseDraw(eligible, 'fiks-R11');
    expect(drawn.map((d) => d.domain)).toEqual(['shop', 'tracker']);
    expect(showcaseDraw(eligible, 'fiks-R11')).toEqual(drawn);
    const steps = showcaseSteps(ctx, drawn, (d) => `/work/${d}-mcp`);
    const repairs = steps.filter((s) => s.key.endsWith('/repair')).map((s) => s.argv);
    expect(repairs).toHaveLength(2);
    for (const [i, argv] of repairs.entries()) {
      for (const f of ['--no-pr', '--arm', '--run-key', '--fetch']) expect(argv).not.toContain(f);
      expect(argv[argv.indexOf('--ci') + 1]).toBe('github');
      expect(argv[argv.indexOf('--base') + 1]).toBe(`showcase/${drawn[i]?.id}`);
      expect(argv).toContain('--trace');
    }
    // The showcase branch is created at DriftPackage.base.
    const branch = steps.find((s) => s.key.endsWith('/branch'))?.argv ?? [];
    expect(branch.at(-1)).toBe(`base-shop^{commit}:refs/heads/showcase/${drawn[0]?.id}`);
    expect(() => showcaseArgv(['pnpm', 'fiks'], { ...drift('X'), trace: null })).toThrow();
  });

  test('R11 is in no ConfigStep projection', () => {
    expect(PROJECTED_RUNS).not.toContain('R11');
    expect(PROJECTED_RUNS).not.toContain('R10');
    for (const s of configSteps(DEFAULT_PARAMS)) {
      expect(Object.keys(s.breakdown)).not.toContain('R11');
      expect(String(s.id)).not.toMatch(/R1[01]/);
    }
  });

  test('R11 is refused without paper/results/confirmatory.lock, and plans with it', async () => {
    const e = makeEnv();
    const res = await runCli(['R11', '--dry', '--out-root', e.out], e.env);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toMatch(/confirmatory\.lock/);
    mkdirSync(join(e.tree, 'paper', 'results'), { recursive: true });
    writeFileSync(join(e.tree, 'paper', 'results', 'confirmatory.lock'), 'cp2\n');
    mkdirSync(join(e.out, 'R2'), { recursive: true });
    writeFileSync(join(e.out, 'R2', 'eligible.json'), JSON.stringify(eligible));
    // Product mode: never executed under --dry, and only with --approved (PLAN 8.0-3).
    const dry = await runCli(['R11', '--dry', '--out-root', e.out], e.env);
    expect(dry.code).toBe(2);
    expect(dry.stderr).toMatch(/product mode/);
    const unapproved = await runCli(['R11', '--out-root', e.out], e.env);
    expect(unapproved.code).toBe(2);
    expect(unapproved.stderr).toMatch(/--approved/);
    const ok = await runCli(['R11', '--dry', '--print-plan', '--out-root', e.out], e.env);
    expect(ok.code, ok.stderr).toBe(0);
    const plan = JSON.parse(ok.stdout) as { steps: { key: string; argv: string[] }[] };
    const repairs = plan.steps.filter((s) => s.key.endsWith('/repair'));
    expect(repairs).toHaveLength(2);
    for (const s of repairs) {
      expect(s.argv).not.toContain('--no-pr');
      expect(s.argv).not.toContain('--arm');
      expect(s.argv).not.toContain('--run-key');
      expect(s.argv[s.argv.indexOf('--ci') + 1]).toBe('github');
      expect(s.argv[s.argv.indexOf('--base') + 1]).toMatch(/^showcase\//);
    }
  }, 60_000);

  test('R10 is refused without the lock and without cap headroom', async () => {
    const e = makeEnv();
    const noLock = await runCli(['R10', '--dry', '--out-root', e.out], e.env);
    expect(noLock.code).toBe(2);
    expect(noLock.stderr).toMatch(/confirmatory\.lock/);
    mkdirSync(join(e.tree, 'paper', 'results'), { recursive: true });
    writeFileSync(join(e.tree, 'paper', 'results', 'confirmatory.lock'), 'cp2\n');
    const noHead = await runCli(['R10', '--dry', '--out-root', e.out], e.env);
    expect(noHead.code).toBe(2);
    expect(noHead.stderr).toMatch(/cap-headroom-units/);
    const dir = tmp('r10');
    const ok = await runCli(
      ['R10', '--dry', '--print-plan', '--cap-headroom-units', '5000', '--out-root', dir],
      e.env,
    );
    expect(ok.code, ok.stderr).toBe(0);
  }, 60_000);
});
