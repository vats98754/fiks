// grade() unit tests: the five-criterion judgement (pure), the round-6 route (rerecord-head and the
// observation only through execFiks with --require-sandbox), and the D1-D5 ref A heads (= `git
// apply` of packages/cli/test/oracles/D<n>.patch on seed-v1^{commit}, tree hashes recorded).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GradeRecord } from '@fiks/interfaces';
import { FIKS_MAIN, FIKS_SANDBOX_ENV, FIKS_TSX } from '@fiks/sandbox';
import { afterAll, describe, expect, test } from 'vitest';
import { Grader, type HeadObservation, judge } from '../src/grade.ts';
import { gradeRecordHash } from '../src/hash.ts';
import { prepareHead } from '../src/head.ts';
import type { CallObservation, ObserveRequest, ObserveResult } from '../src/observe.ts';
import { loadPackage } from '../src/pkg.ts';
import type { SastTool } from '../src/sast/types.ts';
import { type ExecCall, scriptedSandbox } from './support/fake-sandbox.ts';
import { DEV, manifestOf, ORACLES, requireShop, SHOP_DRIFTS } from './support/shop.ts';

const call = (price: number | null, opts: Partial<CallObservation> = {}): CallObservation => ({
  tool: 'get_product',
  args: { id: 'p-1001' },
  output: price === null ? { isError: true } : { structuredContent: { id: 'p-1001', price } },
  inputValid: true,
  ...opts,
});

function obs(o: {
  hidden?: boolean[];
  renamed?: boolean[];
  v1?: (number | null)[];
  drifted?: (number | null)[];
  truth?: boolean;
}): ObserveResult {
  const seq = (xs: (number | null)[]) => xs.map((p) => [call(p)]);
  return {
    hidden: [
      ...(o.hidden ?? [true, true, true]).map((pass, i) => ({
        path: `test/hidden/h${i}.test.ts`,
        renamed: false,
        pass,
        passed: 1,
        failed: 0,
      })),
      ...(o.renamed ?? [true, true, true]).map((pass, i) => ({
        path: `test/hidden-renamed/h${i}.test.ts`,
        renamed: true,
        pass,
        passed: 1,
        failed: 0,
      })),
    ],
    differential: { v1: seq(o.v1 ?? [11.99, 74.95]), drifted: seq(o.drifted ?? [11.99, 74.95]) },
    traffic: {
      v1: [[{ ...call(11.99), expected: { id: 'p-1001', price: 11.99 } }]],
      drifted: [[{ ...call(o.truth === false ? 1199 : 11.99), expected: { id: 'p-1001', price: 11.99 } }]],
    },
  };
}

const head = (observation?: ObserveResult, applied = true): HeadObservation => ({
  headCommit: 'c',
  tree: 't',
  applied,
  ...(observation ? { observation } : {}),
});
const sastPass = { newFindings: [], confirmed: [], pass: true, files: [] };
const traffic = [{ id: 'task-1', calls: [{ tool: 'get_product', args: { id: 'p-1001' } }] }];
const refA = obs({});
const refB = obs({});

describe('judge (PLAN 3.0 five criteria)', () => {
  test('all five hold -> correct, no reasons', () => {
    const r = judge('p', 'D', head(obs({})), refA, refB, traffic, sastPass).record;
    expect(r).toEqual({
      patchId: 'p',
      drift: 'D',
      criteria: {
        hidden: true,
        differential: true,
        ambiguousInputs: 0,
        renamedId: true,
        sast: true,
        truthReplay: true,
      },
      correct: true,
      reasons: [],
    });
  });

  test('each criterion fails on its own, in criterion order', () => {
    expect(
      judge('p', 'D', head(obs({ hidden: [true, false, true] })), refA, refB, traffic, sastPass).record
        .reasons,
    ).toEqual(['hidden']);
    expect(
      judge('p', 'D', head(obs({ drifted: [1199, 74.95] })), refA, refB, traffic, sastPass).record.reasons,
    ).toEqual(['differential']);
    expect(
      judge('p', 'D', head(obs({ renamed: [false, true, true] })), refA, refB, traffic, sastPass).record
        .reasons,
    ).toEqual(['renamed-id']);
    const sastFail = { ...sastPass, pass: false };
    expect(judge('p', 'D', head(obs({})), refA, refB, traffic, sastFail).record.reasons).toEqual(['sast']);
    expect(
      judge('p', 'D', head(obs({ truth: false })), refA, refB, traffic, sastPass).record.reasons,
    ).toEqual(['truth-replay']);
    // A special-cased id (P3): hidden tests on other ids and the renamed variant both fail.
    const p3 = judge(
      'p',
      'D',
      head(obs({ hidden: [true, false, false], renamed: [false, false, false] })),
      refA,
      refB,
      traffic,
      sastPass,
    );
    expect(p3.record).toMatchObject({ correct: false, reasons: ['hidden', 'renamed-id'] });
  });

  test('the differential accepts agreement with ref A or with ref B; A != B inputs are counted as ambiguous', () => {
    const B = obs({ v1: [11.99, 75] });
    const asB = judge('p', 'D', head(obs({ v1: [11.99, 75] })), refA, B, traffic, sastPass);
    expect(asB.record.criteria).toMatchObject({ differential: true, ambiguousInputs: 1 });
    expect(asB.detail.ambiguous).toEqual([1]);
    const neither = judge('p', 'D', head(obs({ v1: [11.99, 76] })), refA, B, traffic, sastPass);
    expect(neither.record.criteria.differential).toBe(false);
    expect(neither.detail.differentialMismatches).toEqual([{ input: 1, setting: 'v1' }]);
  });

  test('error == empty only when truth() marks the input invalid', () => {
    const invalid = (output: CallObservation['output']) => [[{ ...call(null), output, inputValid: false }]];
    const A: ObserveResult = {
      ...obs({}),
      differential: { v1: invalid({ isError: true }), drifted: invalid({ isError: true }) },
    };
    const P: ObserveResult = {
      ...obs({}),
      differential: {
        v1: invalid({ structuredContent: null }),
        drifted: invalid({ structuredContent: null }),
      },
    };
    expect(judge('p', 'D', head(P), A, A, traffic, sastPass).record.criteria.differential).toBe(true);
    const validA: ObserveResult = {
      ...A,
      differential: { v1: [[{ ...call(null) }]], drifted: [[{ ...call(null) }]] },
    };
    const validP: ObserveResult = {
      ...P,
      differential: {
        v1: [[{ ...call(null), output: { structuredContent: null } }]],
        drifted: [[{ ...call(null), output: { structuredContent: null } }]],
      },
    };
    expect(
      judge('p', 'D', head(validP), validA, validA, traffic, sastPass).record.criteria.differential,
    ).toBe(false);
  });

  test('a patch that does not apply, or an observation that failed, is incorrect with a reason code', () => {
    expect(judge('p', 'D', head(undefined, false), refA, refB, traffic, sastPass).record).toMatchObject({
      correct: false,
      reasons: ['patch-apply'],
    });
    expect(judge('p', 'D', head(undefined, true), refA, refB, traffic, sastPass).record.reasons).toEqual([
      'observation-error',
    ]);
  });

  test('GradeRecord hash is canonical (key order does not matter)', () => {
    const r = judge('p', 'D', head(obs({})), refA, refB, traffic, sastPass).record;
    const shuffled = JSON.parse(
      JSON.stringify({
        reasons: r.reasons,
        correct: r.correct,
        criteria: r.criteria,
        drift: r.drift,
        patchId: r.patchId,
      }),
    ) as GradeRecord;
    expect(gradeRecordHash(shuffled)).toBe(gradeRecordHash(r));
  });
});

describe('Grader on a scripted sandbox (round 6 route)', () => {
  test('rerecord-head and the observation run only through execFiks with --require-sandbox', async () => {
    const calls: ExecCall[] = [];
    const p = await loadPackage(manifestOf('D2'));
    const noSast: SastTool[] = [{ name: 'ast', scan: async () => [] }];
    const grader = new Grader(p, {
      sandbox: scriptedSandbox(
        {
          observe: (input) => {
            const req = JSON.parse(input) as ObserveRequest;
            expect(req.worktree).toBe('/work');
            expect(req.rule.transformPath).toMatch(/^\/opt\/heldout-rule\//);
            expect(req.hidden.map((h) => h.path)).toContain('test/hidden/product-others.test.ts');
            expect(req.hidden.filter((h) => h.renamed).length).toBe(p.renamed.length);
            return obs({});
          },
        },
        calls,
      ),
      repoDir: requireShop(),
      clock: '2026-10-01T12:00:00.000Z',
      traffic,
      runs: 5,
      sast: noSast,
    });
    const g = await grader.grade({ id: 'refA', diff: readFileSync(p.refA, 'utf8') });
    expect(g.record.correct).toBe(true);
    const fiks = calls.filter((c) => c.cmd === FIKS_TSX);
    // ref A, ref B and the patch: one re-record and one observation each.
    expect(fiks.filter((c) => c.args[1] === 'rerecord-head' && !c.args.includes('--restore'))).toHaveLength(
      3,
    );
    expect(fiks.filter((c) => c.args[1] === 'grade')).toHaveLength(3);
    for (const c of fiks) {
      expect(c.args[0]).toBe(FIKS_MAIN);
      expect(c.args).toContain('--require-sandbox');
      expect(c.env).toEqual({ ...FIKS_SANDBOX_ENV });
    }
    expect(
      calls.filter(
        (c) => c.cmd !== FIKS_TSX && /tsx|main\.ts|rerecord|--observe/.test(`${c.cmd} ${c.args.join(' ')}`),
      ),
    ).toEqual([]);
    const profiles = new Set(
      fiks.filter((c) => c.args[1] === 'rerecord-head').map((c) => c.args[c.args.indexOf('--profile') + 1]),
    );
    expect([...profiles]).toEqual([
      JSON.stringify({ domain: 'shop', base: 'v1', ruleId: 'D2', ruleHash: p.rule.hash }),
    ]);
  }, 180_000);
});

describe('D1-D5 ref A = git apply of packages/cli/test/oracles/D<n>.patch on seed-v1^{commit}', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'fiks-heldout-refa-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const recorded = JSON.parse(readFileSync(join(DEV, 'refA-trees.json'), 'utf8')) as Record<string, string>;

  for (const d of SHOP_DRIFTS) {
    test(`${d}: manifest refA is the oracle patch; tree hash recorded`, async () => {
      const shop = requireShop();
      const p = await loadPackage(manifestOf(d));
      expect(p.refA).toBe(join(ORACLES, `${d}.patch`));
      // Independent of prepareHead: a plain worktree, `git apply`, `git write-tree`.
      const wt = join(tmp, d);
      execFileSync('git', ['worktree', 'add', '--detach', wt, 'seed-v1^{commit}'], {
        cwd: shop,
        stdio: 'ignore',
      });
      try {
        execFileSync('git', ['apply', join(ORACLES, `${d}.patch`)], { cwd: wt });
        execFileSync('git', ['add', '-A'], { cwd: wt });
        const tree = execFileSync('git', ['write-tree'], { cwd: wt, encoding: 'utf8' }).trim();
        expect(tree).toBe(recorded[d]);
        const h = prepareHead(shop, p.pkg.base, readFileSync(p.refA, 'utf8'), tmp);
        try {
          expect(h.applied).toBe(true);
          expect(h.tree).toBe(tree);
          expect(h.baseCommit).toBe(
            execFileSync('git', ['rev-parse', 'seed-v1^{commit}'], { cwd: shop, encoding: 'utf8' }).trim(),
          );
        } finally {
          h.remove();
        }
      } finally {
        execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: shop, stdio: 'ignore' });
      }
    }, 120_000);
  }
});
