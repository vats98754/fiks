// accept(patch, testSet) unit tests (PLAN 3.2) on a scripted sandbox: the accept rule, the empty
// set, harness-level failures, inline recordings, call counts with 13 test sets, and the round-6
// route (rerecord-head only through execFiks with --require-sandbox, once per patch, one profile).

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIKS_MAIN, FIKS_SANDBOX_ENV, FIKS_TSX } from '@fiks/sandbox';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { AcceptMatrix, fileRuns, hasInlineRecording, type TestSet } from '../src/accept.ts';
import { type LoadedPackage, loadPackage } from '../src/pkg.ts';
import {
  broken,
  type ExecCall,
  failed,
  passed,
  type Script,
  scriptedSandbox,
} from './support/fake-sandbox.ts';
import { DEV, FIKS_ROOT, manifestOf, ORACLES, requireShop } from './support/shop.ts';

let pkg: LoadedPackage;
let alert: { id: string; bytes: string };
const refA = () => readFileSync(join(ORACLES, 'D4.patch'), 'utf8');

beforeAll(async () => {
  requireShop();
  pkg = await loadPackage(manifestOf('D4'));
  const bytes = readFileSync(join(DEV, 'D4/trace.json'), 'utf8');
  alert = { id: (JSON.parse(bytes) as { id: string }).id, bytes };
});

const agentTest = (k: number) => ({
  path: `test/agent-${k}.test.ts`,
  bytes: `import { test } from 'vitest';\ntest('t${k}', () => {});\n`,
});

/** 1 fiks + 6 agent-final + 6 agent-first = 13 sets (PLAN 8.1 R5), plus the empty set. */
function thirteen(): TestSet[] {
  const fiksDir = join(DEV, 'D4/fiks/test/repro');
  const fiks: TestSet = {
    id: 'fiks',
    kind: 'fiks',
    files: [`${alert.id}.json`, `${alert.id}.test.ts`].map((f) => ({
      path: `test/repro/${f}`,
      bytes: readFileSync(join(fiksDir, f), 'utf8'),
    })),
  };
  const agents = Array.from({ length: 12 }, (_, k) => ({
    id: `agent-${k < 6 ? 'final' : 'first'}-${k % 6}`,
    kind: (k < 6 ? 'agent-final' : 'agent-first') as TestSet['kind'],
    files: [agentTest(k)],
  }));
  return [fiks, ...agents];
}

function matrix(script: Script, calls: ExecCall[], sets: TestSet[]) {
  return new AcceptMatrix(
    pkg,
    { sandbox: scriptedSandbox(script, calls), repoDir: requireShop(), alert },
    sets,
  );
}

const fiksCalls = (calls: ExecCall[]) => calls.filter((c) => c.args.includes('rerecord-head'));
const isRerecord = (c: ExecCall) => c.args.includes('rerecord-head') && !c.args.includes('--restore');
const flag = (args: string[], f: string) => args[args.indexOf(f) + 1];

describe('accept matrix (scripted sandbox)', () => {
  test('13 test sets on one patch: typecheck/lint/suite/stored traces once, each T file once, one re-record', async () => {
    const calls: ExecCall[] = [];
    const sets = thirteen();
    const m = matrix(
      {
        reads: (files) =>
          files.some((f) => f.startsWith('test/repro/'))
            ? [`/work/test/repro/${alert.id}.json`, `/work/.alerts/${alert.id}.json`]
            : [`/work/.alerts/${alert.id}.json`],
      },
      calls,
      sets,
    );
    await m.profiles();
    const before = calls.length;
    const r = await m.accept({ id: 'refA', diff: refA() });
    const patchCalls = calls.slice(before);
    const count = (pred: (c: ExecCall) => boolean) => patchCalls.filter(pred).length;
    expect(count((c) => c.cmd === 'pnpm' && c.args.includes('typecheck'))).toBe(1);
    expect(count((c) => c.cmd === 'pnpm' && c.args.includes('lint'))).toBe(1);
    const vitests = patchCalls.filter((c) => c.cmd === 'node_modules/.bin/vitest');
    const suiteRuns = vitests.filter(
      (c) => c.args.filter((a) => a !== 'run' && !a.startsWith('--')).length === 0,
    );
    expect(suiteRuns).toHaveLength(1); // suite + stored traces: one run, split by file
    const tRuns = vitests.flatMap((c) => c.args.filter((a) => a !== 'run' && !a.startsWith('--')));
    const allTFiles = sets.flatMap((s) =>
      s.files.filter((f) => f.path.endsWith('.test.ts')).map((f) => f.path),
    );
    expect(tRuns.sort()).toEqual(allTFiles.sort()); // each T file exactly once
    expect(patchCalls.filter(isRerecord)).toHaveLength(1);
    expect(r.cells).toHaveLength(13);
    expect(r.cells.every((c) => c.accepted)).toBe(true);
    // A second request for the same patch is served from the cache.
    const n = calls.length;
    await m.accept({ id: 'refA', diff: refA() });
    expect(calls.length).toBe(n);
  }, 120_000);

  test("testSet 'empty' = typecheck + lint + suite + stored traces (+ the re-record) only", async () => {
    const empty: TestSet = { id: 'none', kind: 'empty', files: [] };
    const agent: TestSet = { id: 'agent', kind: 'agent-final', files: [agentTest(0)] };
    for (const [failing, expectEmpty] of [
      [undefined, true],
      ['typecheck', false],
      ['lint', false],
      ['suite', false],
      ['traces', false],
    ] as const) {
      const calls: ExecCall[] = [];
      const m = matrix(
        {
          typecheck: () => (failing === 'typecheck' ? 2 : 0),
          lint: () => (failing === 'lint' ? 1 : 0),
          vitest: (files) =>
            files.length > 0
              ? files.map(passed)
              : [
                  failing === 'suite' ? failed('test/server.test.ts') : passed('test/server.test.ts'),
                  failing === 'traces'
                    ? failed('test/fiks/traces.test.ts')
                    : passed('test/fiks/traces.test.ts'),
                ],
        },
        calls,
        [empty, agent],
      );
      const r = await m.accept({ id: 'p', diff: refA() });
      const cell = r.cells.find((c) => c.setId === 'none');
      expect(cell?.accepted, `failing=${failing}`).toBe(expectEmpty);
      expect(cell?.t).toEqual({ pass: true, files: [] });
      expect(r.baseOk).toBe(expectEmpty);
      // Every T inherits the base checks: the agent set is accepted iff the empty set is.
      expect(r.cells.find((c) => c.setId === 'agent')?.accepted).toBe(expectEmpty);
      // The empty set adds no vitest run of its own.
      const tRuns = calls.filter(
        (c) => c.cmd === 'node_modules/.bin/vitest' && c.args.some((a) => a.endsWith('.test.ts')),
      );
      expect(tRuns.every((c) => c.args.includes('test/agent-0.test.ts'))).toBe(true);
    }
  }, 300_000);

  test('a test file with a compile error rejects every patch', async () => {
    const calls: ExecCall[] = [];
    const bad: TestSet = {
      id: 'bad',
      kind: 'agent-final',
      files: [
        { path: 'test/agent-bad.test.ts', bytes: 'import { test } from "vitest"\ntest("x", () => { {\n' },
      ],
    };
    const good: TestSet = { id: 'good', kind: 'agent-final', files: [agentTest(1)] };
    const m = matrix(
      {
        vitest: (files) =>
          files.length === 0
            ? [passed('test/server.test.ts'), passed('test/fiks/traces.test.ts')]
            : files.map((f) => (f === 'test/agent-bad.test.ts' ? broken(f) : passed(f))),
      },
      calls,
      [bad, good],
    );
    for (const [id, diff] of [
      ['base', ''],
      ['refA', refA()],
      ['refB', readFileSync(join(DEV, 'D4/refB.patch'), 'utf8')],
    ] as const) {
      const r = await m.accept({ id, diff });
      expect(r.baseOk).toBe(true);
      expect(r.cells.find((c) => c.setId === 'bad')?.accepted, id).toBe(false);
      expect(r.cells.find((c) => c.setId === 'bad')?.t?.files[0]?.error).toMatch(/Transform failed/);
      expect(r.cells.find((c) => c.setId === 'good')?.accepted, id).toBe(true);
    }
  }, 180_000);

  test('an inline recording is flagged and never named for re-recording', async () => {
    const calls: ExecCall[] = [];
    const inline: TestSet = {
      id: 'inline',
      kind: 'agent-final',
      files: [
        {
          path: 'test/agent-inline.test.ts',
          bytes: `import { test } from 'vitest';
const rec = { tool: 'search_products', http: [{ request: { method: 'GET', url: '/products?q=cable' }, response: { status: 200, body: '{}' } }] };
test('inline', () => { void rec; });
`,
        },
      ],
    };
    const loads: TestSet = { id: 'loads', kind: 'agent-final', files: [agentTest(2)] };
    const m = matrix(
      {
        reads: (files) => (files.includes('test/agent-2.test.ts') ? [`/work/.alerts/${alert.id}.json`] : []),
      },
      calls,
      [inline, loads],
    );
    const profiles = await m.profiles();
    expect(profiles.find((p) => p.setId === 'inline')).toMatchObject({
      inlineRecording: true,
      recordingsRead: [],
      overlaid: [],
    });
    expect(profiles.find((p) => p.setId === 'loads')).toMatchObject({
      inlineRecording: false,
      overlaid: [`.alerts/${alert.id}.json`],
    });
    const r = await m.accept({ id: 'refA', diff: refA() });
    expect(r.cells.find((c) => c.setId === 'inline')?.inlineRecording).toBe(true);
    const rr = calls.filter(isRerecord);
    expect(rr).toHaveLength(1);
    expect(flag(rr[0]?.args ?? [], '--recordings')).toBe(`.alerts/${alert.id}.json`);
    expect(hasInlineRecording(inline.files[0]?.bytes ?? '')).toBe(true);
    expect(hasInlineRecording(agentTest(0).bytes)).toBe(false);
  }, 120_000);

  test('round 6: rerecord-head only through execFiks with --require-sandbox; once per patch, one profile for every set', async () => {
    const calls: ExecCall[] = [];
    const m = matrix({}, calls, [...thirteen(), { id: 'none', kind: 'empty', files: [] }]);
    for (const [id, diff] of [
      ['base', ''],
      ['refA', refA()],
    ] as const)
      await m.accept({ id, diff });
    const rr = fiksCalls(calls);
    expect(rr.length).toBeGreaterThan(0);
    for (const c of rr) {
      expect(c.cmd).toBe(FIKS_TSX);
      expect(c.args[0]).toBe(FIKS_MAIN);
      expect(c.args[1]).toBe('rerecord-head');
      expect(c.args).toContain('--require-sandbox');
      expect(c.env).toEqual({ ...FIKS_SANDBOX_ENV });
    }
    // Nothing else spawns the CLI or a tsx entry point.
    expect(
      calls.filter((c) => c.cmd !== FIKS_TSX && /tsx|main\.ts|rerecord/.test(`${c.cmd} ${c.args.join(' ')}`)),
    ).toEqual([]);
    const perPatch = new Map<string, ExecCall[]>();
    for (const c of calls.filter(isRerecord))
      perPatch.set(c.worktree, [...(perPatch.get(c.worktree) ?? []), c]);
    expect([...perPatch.values()].map((l) => l.length)).toEqual([1, 1]);
    const profiles = new Set(calls.filter(isRerecord).map((c) => flag(c.args, '--profile')));
    expect(profiles.size).toBe(1);
    expect(JSON.parse([...profiles][0] as string)).toEqual({
      domain: 'shop',
      base: 'v1',
      ruleId: 'D4',
      ruleHash: pkg.rule.hash,
    });
  }, 180_000);
});

describe('vitest reports (real vitest)', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'fiks-heldout-vitest-')));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('a file that does not compile has no passing test and an error; a good file passes', () => {
    symlinkSync(join(FIKS_ROOT, 'node_modules'), join(dir, 'node_modules'));
    mkdirSync(join(dir, 'test'));
    writeFileSync(join(dir, 'test/bad.test.ts'), "import { test } from 'vitest';\ntest('x', () => { {\n");
    writeFileSync(
      join(dir, 'test/good.test.ts'),
      "import { expect, test } from 'vitest';\ntest('y', () => expect(1).toBe(1));\n",
    );
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
    const out = join(dir, 'report.json');
    spawnSync(
      join(dir, 'node_modules/.bin/vitest'),
      ['run', '--root', dir, '--reporter=json', `--outputFile=${out}`],
      {
        cwd: dir,
        encoding: 'utf8',
      },
    );
    const report = JSON.parse(readFileSync(out, 'utf8'));
    const runs = fileRuns(
      {
        testResults: report.testResults.map((t: { name: string }) => ({
          ...t,
          name: t.name.replace(dir, '/work'),
        })),
      },
      ['test/bad.test.ts', 'test/good.test.ts'],
    );
    expect(runs.find((r) => r.path === 'test/bad.test.ts')).toMatchObject({ pass: false, passed: 0 });
    expect(runs.find((r) => r.path === 'test/bad.test.ts')?.error).toBeTruthy();
    expect(runs.find((r) => r.path === 'test/good.test.ts')).toMatchObject({ pass: true, passed: 1 });
    // A file with no result at all is a harness-level failure too.
    expect(fileRuns({ testResults: [] }, ['test/x.test.ts'])[0]).toMatchObject({
      pass: false,
      error: 'no result',
    });
  }, 120_000);
});
