// Docker-free unit tests: arm definitions, alert and prompts, sidecar validation, F-check parsing,
// budget accounting, the trace-format pass-through, COMP's revision/wall-clock cap and the edit
// guard, with a scripted sandbox (test/support/fake-sandbox.ts) and SAFE's stub agent.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunKey, TraceFormat } from '@fiks/interfaces';
import type { RunnerJob, StubScript } from '@fiks/repair';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { stubAgent } from '../src/agent.ts';
import {
  alertJson,
  alertRelPath,
  buildAlert,
  REPLAY_HELPER_SENTENCE,
  renderAlert,
  reproLoadingSentence,
} from '../src/alert.ts';
import { ARM_NAMES, ARM_SPECS, type ArmsArmName, armSpec, REPAIR_ARMS } from '../src/arms.ts';
import { runArm } from '../src/attempt.ts';
import { BUDGET, REPRO_BUDGET } from '../src/budget.ts';
import { checkFidelity } from '../src/check-fidelity.ts';
import { plainWorkflowText } from '../src/checks.ts';
import { resolveDomain } from '../src/domains.ts';
import { fOnBaseOf, fRunFromVitest, inlinesRecording, type VitestAssertion } from '../src/fcheck.ts';
import { repairPrompt, reproPrompt } from '../src/prompts.ts';
import { sidecarErrors, validateSidecar } from '../src/sidecar.ts';
import { type LoadedTrace, loadFrozenTrace, traceDomain, traceProfile } from '../src/trace.ts';
import { fakeSandbox } from './support/fake-sandbox.ts';
import { D2_TRACE, FIXTURES, ROOT, SHOP_DIR } from './support/fixtures.ts';

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'arms-unit-')));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let d2: LoadedTrace;
beforeAll(() => {
  d2 = loadFrozenTrace(D2_TRACE);
});

const key = (arm: string, n = 1, domain = 'shop'): RunKey => ({
  experiment: 'unit',
  arm,
  model: 'claude-opus-5-5',
  domain,
  drift: 'D2',
  attempt: n,
});

describe('arm definitions', () => {
  test('every comparator arm of PLAN 6.2 is defined with its IV placement and evidence', () => {
    expect(ARM_NAMES.sort()).toEqual(
      ['COMP', 'COMP-norep', 'COMP-plain', 'ISSUE-TEXT', 'L1', 'L1-noIV', 'L1p', 'REPRO-AGENT'].sort(),
    );
    const placement = Object.fromEntries(ARM_NAMES.map((n) => [n, ARM_SPECS[n].ivPlacement]));
    expect(placement).toEqual({
      L1: 'pre',
      'L1-noIV': 'none',
      L1p: 'pre',
      COMP: 'post',
      'COMP-norep': 'none',
      'COMP-plain': 'none',
      'ISSUE-TEXT': 'none',
      'REPRO-AGENT': 'none',
    });
    expect(armSpec('L1').preGates).toContain('iv');
    expect(armSpec('L1-noIV').preGates).not.toContain('iv');
    expect(armSpec('COMP').ciPolicy).toMatchObject({ when: 'post-pr', iv: true, maxRevisions: 3 });
    expect(armSpec('COMP-plain').ciPolicy.scope).toBe('server-tests');
    expect(armSpec('L1p').evidence).toBe('prose');
    expect(() => armSpec('FIKS')).toThrow(/fiks repair --arm fiks/);
  });
});

describe('alert renderer', () => {
  test('alert JSON is byte-identical for the trace-evidence arms; L1p lacks only the path and the sentence', () => {
    const full = alertJson(buildAlert(d2));
    const prose = buildAlert(d2, { proseOnly: true });
    const a = JSON.parse(full) as Record<string, unknown>;
    expect(a.trace).toEqual({ path: `.alerts/${d2.trace.id}.json`, sha256: d2.sha256 });
    expect(a.replayHelper).toBe(REPLAY_HELPER_SENTENCE);
    const { trace: _t, replayHelper: _r, ...rest } = a;
    expect(JSON.parse(alertJson(prose))).toEqual(rest);
    const text = renderAlert(prose);
    expect(text).not.toContain('.alerts/');
    expect(text).not.toContain(REPLAY_HELPER_SENTENCE);
    expect(renderAlert(buildAlert(d2))).toContain(REPLAY_HELPER_SENTENCE);
    expect(text).toContain('shop.get_product/price.notNull');
  });

  test('prompts: ISSUE-TEXT has the issue and none of trace path, alert JSON, helper sentence; REPRO-AGENT has the loading sentence', async () => {
    const domain = await resolveDomain('shop');
    const issue = {
      title: 'get_product returns price: null',
      body: 'Since this morning every product has no price.',
    };
    const p = repairPrompt({ spec: armSpec('ISSUE-TEXT'), domain, issue });
    expect(p).toContain(issue.title);
    expect(p).toContain(issue.body);
    expect(p).not.toContain(alertRelPath(d2.trace.id));
    expect(p).not.toContain('.alerts');
    expect(p).not.toContain(alertJson(buildAlert(d2)).slice(0, 40));
    expect(p).not.toContain(REPLAY_HELPER_SENTENCE);
    const r = reproPrompt({ spec: armSpec('REPRO-AGENT'), domain, alert: buildAlert(d2) });
    expect(r).toContain(reproLoadingSentence(d2.trace.id));
    expect(r).toContain(`.alerts/${d2.trace.id}.json`);
    // L1 and COMP see the same alert prose; only the task and "how it is checked" differ.
    const l1 = repairPrompt({ spec: armSpec('L1'), domain, alert: buildAlert(d2) });
    const l1n = repairPrompt({ spec: armSpec('L1-noIV'), domain, alert: buildAlert(d2) });
    const comp = repairPrompt({ spec: armSpec('COMP'), domain, alert: buildAlert(d2) });
    expect(l1).toBe(l1n);
    expect(comp).toContain('Reproduce the issue first, then fix it.');
    expect(l1).toContain(renderAlert(buildAlert(d2)));
    expect(comp).toContain(renderAlert(buildAlert(d2)));
  });
});

describe('trace helpers', () => {
  test("the D2 trace's domain is shop and its profile is the versioned vendor v2 (no rule)", () => {
    expect(traceDomain(d2.trace)).toBe('shop');
    expect(traceProfile(d2.trace)).toEqual({ domain: 'shop', base: 'v2', ruleId: null, ruleHash: null });
    const trk = loadFrozenTrace(join(FIXTURES, 'TRK-DEV-1.trace.json'));
    expect(traceDomain(trk.trace)).toBe('tracker');
    expect(traceProfile(trk.trace).ruleId).toBe('TRK-DEV-1');
  });
});

describe('IV sidecars', () => {
  const sidecars = ['D2-trace', 'D3.trace', 'D4.trace', 'D4-plantedfp.trace', 'TRK-DEV-1.trace'];
  test.each(sidecars)('%s.iv.json validates against the FrozenTrace sidecar fields', (name) => {
    const raw = JSON.parse(readFileSync(join(FIXTURES, `${name}.iv.json`), 'utf8'));
    expect(sidecarErrors(raw)).toEqual([]);
    expect(Object.keys(validateSidecar(raw)).sort()).toEqual(
      ['attributableProperties', 'controlCallId', 'ivExcluded', 'ivProperties'].sort(),
    );
  });
  test('invalid sidecars are refused', () => {
    expect(sidecarErrors({ ivProperties: [] })).toContain('missing field "controlCallId"');
    expect(
      sidecarErrors({
        controlCallId: 'c',
        attributableProperties: ['a/x'],
        ivProperties: ['a/y'],
        ivExcluded: [{ property: 'a/y', controlVerdict: 'verified' }],
        extra: 1,
      }),
    ).toEqual(
      expect.arrayContaining([
        'unknown field "extra"',
        'attributable property a/x is not in ivProperties',
        'a/y is both in ivProperties and ivExcluded',
      ]),
    );
  });
});

describe('F check parsing (PLAN 5.5)', () => {
  const file = (assertionResults: VitestAssertion[], message = '') => ({
    testResults: [{ name: '/work/test/repro.test.ts', status: 'failed', message, assertionResults }],
  });
  test('an assertion failure is F; a pass is not; a compile/import error is not F-valid', () => {
    const fail = fRunFromVitest(
      file([{ status: 'failed', failureMessages: ['AssertionError: expected null not to be null'] }]),
      'test/repro.test.ts',
    );
    expect(fail.verdict).toBe('fail');
    const pass = fRunFromVitest(file([{ status: 'passed', failureMessages: [] }]), 'test/repro.test.ts');
    expect(pass.verdict).toBe('pass');
    const compile = fRunFromVitest(
      file([], 'Error: Transform failed with 1 error: Expected ";" but found "x"'),
      'test/repro.test.ts',
    );
    expect(compile).toMatchObject({ verdict: 'error', loaded: false });
    const thrown = fRunFromVitest(
      file([
        {
          status: 'failed',
          failureMessages: ["TypeError: Cannot read properties of undefined (reading 'x')"],
        },
      ]),
      'test/repro.test.ts',
    );
    expect(thrown.verdict).toBe('error');
    expect(fOnBaseOf([fail, fail, fail])).toBe('fail');
    expect(fOnBaseOf([fail, pass, fail])).toBe('error');
    expect(fOnBaseOf([pass, pass, pass])).toBe('pass');
    expect(fOnBaseOf([compile, compile, compile])).toBe('error');
    expect(inlinesRecording('const r = { request: { method: "GET" }, response: { status: 200 } }', [])).toBe(
      true,
    );
    expect(inlinesRecording("loadRecording('.alerts/x.json')", ['.alerts/x.json'])).toBe(false);
  });
});

test('COMP-plain CI limits the test step to the server tests', () => {
  const yml = readFileSync(join(SHOP_DIR, '.github/workflows/ci.yml'), 'utf8');
  const plain = plainWorkflowText(yml);
  expect(plain).toContain('- run: pnpm exec vitest run --exclude "test/fiks/**"');
  expect(plain).not.toMatch(/run: pnpm test\s*$/m);
  expect(() => plainWorkflowText('jobs:\n  a:\n    steps:\n      - run: make\n')).toThrow(/pnpm test/);
});

test('FIDELITY.md passes check-fidelity (URLs, verified passages, Engine strings from the re-fetch)', () => {
  expect(checkFidelity(ROOT)).toEqual([]);
});

// --- runs with a scripted sandbox and the stub agent -----------------------------------------

const noop: StubScript = {
  steps: [{ op: 'edit', path: 'src/tools/get_product.ts', oldString: 'import', newString: 'import' }],
};
/** A real (harmless) source change: a comment line in src/. */
const touch = (n: number): StubScript['steps' & keyof StubScript] =>
  ({
    op: 'edit',
    path: 'src/tools/get_product.ts',
    oldString: "import { z } from 'zod';",
    newString: `import { z } from 'zod';\n// touched ${n}`,
  }) as never;

async function run(
  name: ArmsArmName,
  opts: {
    script: StubScript;
    traceFormat?: TraceFormat;
    green?: (n: number) => boolean;
    now?: () => Date;
    onJob?: (j: RunnerJob, n: number) => void;
    tag?: string;
  },
) {
  const domain = await resolveDomain('shop');
  const out = join(tmp, `${name}-${opts.tag ?? 'x'}-${Math.random().toString(36).slice(2, 8)}`);
  return runArm({
    name,
    runKey: key(name),
    domain,
    repoDir: SHOP_DIR,
    base: 'seed-v1',
    trace: name === 'ISSUE-TEXT' ? d2 : d2,
    issue: { title: 'price is null', body: 'get_product returns price: null' },
    profile: traceProfile(d2.trace),
    contracts: '{"contracts":[]}',
    sidecar: readFileSync(join(FIXTURES, 'D2-trace.iv.json'), 'utf8'),
    traceFormat: opts.traceFormat ?? 'raw',
    model: 'claude-opus-5-5',
    agent: stubAgent(opts.script),
    outDir: out,
    fiksCommit: 'test',
    now: opts.now,
    onJob: opts.onJob,
    keepCheckout: true,
    sandbox: async (worktree) => fakeSandbox({ worktree, green: (_c, n) => opts.green?.(n) ?? true }),
  });
}

describe('identical budget, trace format and guard across repair arms', () => {
  test('--trace-format strict reaches the runner job of every repair arm, with identical budget fields', async () => {
    const seen: Record<string, Pick<RunnerJob, 'maxTurns' | 'maxBudgetUsd' | 'traceFormat'>[]> = {};
    for (const name of [...REPAIR_ARMS, 'REPRO-AGENT'] as ArmsArmName[]) {
      seen[name] = [];
      const script: StubScript =
        name === 'REPRO-AGENT'
          ? {
              steps: [
                {
                  op: 'newTest',
                  path: 'test/repro.test.ts',
                  content: "import { test } from 'vitest';\ntest('x', () => {});\n",
                },
              ],
            }
          : { sessions: [{ steps: [touch(1)] }] };
      await run(name, {
        script,
        traceFormat: 'strict',
        tag: 'strict',
        onJob: (j) =>
          seen[name]?.push({
            maxTurns: j.maxTurns,
            maxBudgetUsd: j.maxBudgetUsd,
            traceFormat: j.traceFormat,
          }),
      });
    }
    for (const [name, jobs] of Object.entries(seen)) {
      expect(jobs.length, name).toBeGreaterThan(0);
      for (const j of jobs) {
        expect(j, name).toEqual({
          maxTurns: BUDGET.turnsPerSession,
          maxBudgetUsd: BUDGET.usdPerSession,
          traceFormat: 'strict',
        });
      }
    }
    expect(REPRO_BUDGET).toMatchObject({
      turnsPerSession: BUDGET.turnsPerSession,
      usdPerSession: BUDGET.usdPerSession,
    });
  }, 300_000);

  test('session cap: an L1 whose gates always fail and a COMP whose CI is always red both stop at 4 sessions', async () => {
    const sessions = { sessions: [1, 2, 3, 4, 5].map((n) => ({ steps: [touch(n)] })) };
    const l1 = await run('L1', { script: sessions, green: () => false, tag: 'cap' });
    expect(l1.attempt?.sessions).toBe(BUDGET.maxSessions);
    expect(l1.attempt?.prExposed).toBe(false);
    const comp = await run('COMP', { script: sessions, green: () => false, tag: 'cap' });
    expect(comp.attempt?.sessions).toBe(BUDGET.maxSessions);
    expect(comp.attempt?.prExposed).toBe(true);
    expect(comp.attempt?.ciFinal).toBe('red');
    const events = readFileSync(join(comp.outDir, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(events.filter((e) => e.type === 'revision')).toHaveLength(BUDGET.maxRevisions);
  }, 300_000);

  test('fake clock: COMP stops at the 90-minute cap before its 3 revisions', async () => {
    let t = Date.parse('2026-10-01T12:00:00Z');
    const now = () => new Date(t);
    const sessions = { sessions: [1, 2, 3, 4].map((n) => ({ steps: [touch(n)] })) };
    const r = await run('COMP', {
      script: sessions,
      green: () => false,
      now,
      tag: 'clock',
      // Each agent session takes 50 minutes on the fake clock.
      onJob: () => {
        t += 50 * 60_000;
      },
    });
    const events = readFileSync(join(r.outDir, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(r.stop).toBe('wall_clock');
    expect(events.filter((e) => e.type === 'revision')).toHaveLength(1);
    expect(r.attempt?.sessions).toBe(2);
    expect(r.attempt?.ciFinal).toBe('red');
  }, 300_000);

  test('the guard blocks edits to existing tests, fixtures and traces in every arm', async () => {
    const id = d2.trace.id;
    const attacks = [
      { op: 'edit', path: 'test/server.test.ts', oldString: 'import', newString: 'import' },
      { op: 'write', path: 'test/fixtures/v1/product-p-1001.json', content: '{}' },
      { op: 'write', path: `.alerts/${id}.json`, content: '{}' },
      { op: 'write', path: 'test/traces/x.json', content: '{}' },
      { op: 'edit', path: 'test/fiks/check.ts', oldString: 'import', newString: '// x\nimport' },
      { op: 'newTest', path: 'test/fiks/new.test.ts', content: '' },
      { op: 'write', path: 'package.json', content: '{}' },
    ] as const;
    for (const name of ARM_NAMES) {
      const script: StubScript = { sessions: [{ steps: [...attacks] }] };
      const r = await run(name, { script, tag: 'guard' });
      const ck = join(r.outDir, 'checkout');
      const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
        cwd: ck,
        encoding: 'utf8',
      });
      expect(status, name).toBe('');
      if (existsSync(join(ck, `.alerts/${id}.json`)))
        expect(readFileSync(join(ck, `.alerts/${id}.json`)).equals(d2.bytes), name).toBe(true);
      const ended = readFileSync(join(r.outDir, 'events.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .find((e) => e.type === 'session_ended');
      expect(ended?.data?.denials, name).toHaveLength(attacks.length);
    }
  }, 300_000);

  test('a no-op session is no candidate (L1 feeds back "no change")', async () => {
    const r = await run('L1', { script: { sessions: [{ steps: noop.steps }] }, tag: 'noop' });
    expect(r.attempt?.headSha).toBeNull();
    const p2 = join(r.outDir, 'prompts/session-2.txt');
    expect(existsSync(p2) ? readFileSync(p2, 'utf8') : '').toContain('without changing any file');
  }, 120_000);
});

describe('fiks arm argument checks (exit 2 before any container starts)', () => {
  const base = ['--trace', D2_TRACE, '--base', 'seed-v1', '--ci', 'local', '--no-pr'];
  const argMain = async (argv: string[]) => {
    const { armMain } = await import('../src/cli.ts');
    let err = '';
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((s: string) => {
      err += s;
      return true;
    }) as typeof process.stderr.write;
    try {
      return { code: await armMain(argv, { out: () => {} }), err };
    } finally {
      process.stderr.write = write;
    }
  };
  test('IV arms need the sidecar; --pr and --ci github are refused; the run key must match --name', async () => {
    const noSide = await argMain([
      '--name',
      'L1',
      ...base,
      '--run-key',
      'u/L1/m/shop/D2/1',
      '--sidecar',
      join(tmp, 'none.iv.json'),
    ]);
    expect(noSide).toMatchObject({ code: 2 });
    expect(noSide.err).toContain('IV sidecar required');
    expect(
      (await argMain(['--name', 'COMP', ...base, '--run-key', 'u/COMP/m/shop/D2/1', '--pr'])).err,
    ).toContain('never opens a PR');
    expect(
      (await argMain(['--name', 'COMP', ...base, '--ci', 'github', '--run-key', 'u/COMP/m/shop/D2/1'])).code,
    ).toBe(2);
    expect((await argMain(['--name', 'L1', ...base, '--run-key', 'u/COMP/m/shop/D2/1'])).err).toContain(
      "run key's arm",
    );
    expect((await argMain(['--name', 'FIKS', ...base, '--run-key', 'u/FIKS/m/shop/D2/1'])).code).toBe(2);
    const noTools = await argMain(['--name', 'L1-noIV', ...base, '--run-key', 'u/L1-noIV/m/shop/D2/1']);
    if (!process.env.FIKS_TOOLS_IMAGE) expect(noTools.err).toContain('--tools-image');
  }, 60_000);
});
