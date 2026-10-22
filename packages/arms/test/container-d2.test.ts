// Arms in real per-attempt containers on the dev drift D2 (base seed-v1, the CORE D2 trace, its
// hand-written sidecar), with SAFE's stub agent:
//  - a planted candidate that passes the repo suite but leaves the frozen trace violated: L1 does
//    not expose it and feeds the IV property id back; L1-noIV exposes it with green CI; COMP's CI is
//    red with the property id in the log; COMP-norep (and COMP-plain) are green;
//  - REPRO-AGENT: a first test that passes on base gets the fixed F feedback, the revised test that
//    loads .alerts/<id>.json through test/fiks/run.ts and fails with an assertion is final (F-valid);
//    a test that fails only with a compile/import error is not F-valid and F rounds stop at 3;
//  - .alerts/<id>.json = the frozen trace's bytes and the alert JSON is byte-identical across arms;
//  - every rerecord-head call goes through execFiks with --require-sandbox, and the host never
//    spawns rerecord-head, the CLI or the candidate server (ExecBackend spy + child_process spy).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StubScript } from '@fiks/repair';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { REPLAY_HELPER_SENTENCE } from '../src/alert.ts';
import type { ArmsArmName } from '../src/arms.ts';
import type { SandboxCall } from '../src/sandbox.ts';
import { loadFrozenTrace, sha256 } from '../src/trace.ts';
import { dockerReady, readJsonl, runInContainer, scratch } from './support/container.ts';
import { D2_TRACE, FIXTURES } from './support/fixtures.ts';
import { testToolsImage } from './support/tools-image.ts';

const hostSpawns = vi.hoisted(() => [] as { fn: string; cmd: string; args: string[] }[]);
vi.mock('node:child_process', async (importOriginal) => {
  const m = await importOriginal<typeof import('node:child_process')>();
  const wrap =
    <F extends (...a: never[]) => unknown>(fn: string, f: F) =>
    (...a: Parameters<F>) => {
      const [cmd, args] = a as unknown as [string, unknown];
      hostSpawns.push({ fn, cmd: String(cmd), args: Array.isArray(args) ? args.map(String) : [] });
      return f(...a);
    };
  return {
    ...m,
    spawn: wrap('spawn', m.spawn),
    spawnSync: wrap('spawnSync', m.spawnSync),
    execFile: wrap('execFile', m.execFile),
    execFileSync: wrap('execFileSync', m.execFileSync),
    exec: wrap('exec', m.exec),
    execSync: wrap('execSync', m.execSync),
    fork: wrap('fork', m.fork),
  };
});

const ready = dockerReady();
const tmp = scratch();
const trace = loadFrozenTrace(D2_TRACE);
const SIDECAR = join(FIXTURES, 'D2-trace.iv.json');
const PROP = 'shop.get_product/price.notNull';
const calls: Record<string, SandboxCall[]> = {};
const outs: Record<string, string> = {};

/** A real source change that does not touch the price: the repo suite stays green, the trace violated. */
const touch = (n: number) => ({
  op: 'edit' as const,
  path: 'src/tools/get_product.ts',
  oldString: "import { z } from 'zod';",
  newString: `import { z } from 'zod';\n// planted ${n}`,
});
const planted: StubScript = { sessions: [{ steps: [touch(1)] }, { steps: [touch(2)] }] };

async function arm(name: ArmsArmName, script: StubScript, tag: string = name) {
  calls[tag] = [];
  outs[tag] = join(tmp, tag);
  return runInContainer({
    name,
    trace: D2_TRACE,
    sidecar: SIDECAR,
    base: 'seed-v1',
    script,
    outDir: outs[tag] as string,
    calls: calls[tag],
    keepCheckout: true,
  });
}

beforeAll(async () => {
  if (ready) await testToolsImage();
}, 60 * 60_000);
afterAll(() => {
  // The tmp tree holds the attempt folders for inspection; it lives under $TMPDIR.
});

describe.runIf(ready)('planted candidate on D2 (repo suite green, frozen trace still violated)', () => {
  test(
    'L1: not exposed; the next session sees the IV property id. L1-noIV: exposed with green CI',
    async () => {
      const l1 = await arm('L1', planted);
      expect(l1.attempt).toMatchObject({ prExposed: false, issueValidation: 'fail', ivPlacement: 'pre' });
      const p2 = readFileSync(join(l1.outDir, 'prompts/session-2.txt'), 'utf8');
      expect(p2).toContain(`IV FAIL ${PROP}`);
      const suite = readFileSync(join(l1.outDir, 'gates/session-1-suite.log'), 'utf8');
      expect(suite).toMatch(
        /suite \(repo tests, contract suite, stored traces\)\n\$ pnpm test[\s\S]*== exit 0 .* PASS/,
      );
      expect(readJsonl(join(l1.outDir, 'events.jsonl')).some((e) => e.type === 'would_open_pr')).toBe(false);

      const noiv = await arm('L1-noIV', planted);
      expect(noiv.attempt).toMatchObject({
        prExposed: true,
        ciFinal: 'green',
        issueValidation: 'n/a',
        ivPlacement: 'none',
      });
      expect(noiv.attempt?.headSha).toMatch(/^[0-9a-f]{40}$/);
    },
    30 * 60_000,
  );

  test(
    'COMP: ciFinal red with the property id in the CI log; COMP-norep and COMP-plain: green',
    async () => {
      const comp = await arm('COMP', planted);
      expect(comp.attempt).toMatchObject({
        prExposed: true,
        ciFinal: 'red',
        issueValidation: 'fail',
        ivPlacement: 'post',
      });
      const ci = readFileSync(join(comp.outDir, 'gates/revision-0-ci.log'), 'utf8');
      expect(ci).toContain('== extra: issue validation (fiks-iv)');
      expect(ci).toContain(`IV FAIL ${PROP}`);
      // The repo's own CI steps passed: only IV made it red.
      expect(ci).toMatch(/== ci: pnpm test[\s\S]*?== exit 0 .* PASS/);
      const norep = await arm('COMP-norep', planted);
      expect(norep.attempt).toMatchObject({
        prExposed: true,
        ciFinal: 'green',
        issueValidation: 'n/a',
        ivPlacement: 'none',
      });
      const plain = await arm('COMP-plain', planted);
      expect(plain.attempt).toMatchObject({ prExposed: true, ciFinal: 'green', ivPlacement: 'none' });
      expect(readFileSync(join(plain.outDir, 'gates/revision-0-ci.log'), 'utf8')).toContain(
        '$ pnpm exec vitest run --exclude "test/fiks/**"',
      );
    },
    30 * 60_000,
  );
});

const alertPath = `.alerts/${trace.trace.id}.json`;
const passingTest = `import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('the alert names get_product', () => {
  const rec = JSON.parse(readFileSync(new URL('../${alertPath}', import.meta.url), 'utf8'));
  expect(rec.tool).toBe('get_product');
});
`;
const failingTest = `import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { replayRecording } from './fiks/run.ts';

test('get_product p-1001 keeps its price (${trace.trace.id})', async () => {
  const rec = JSON.parse(readFileSync(new URL('../${alertPath}', import.meta.url), 'utf8'));
  const r = await replayRecording(rec);
  expect(r.evaluation.violations.map((v) => v.propertyId)).toEqual([]);
});
`;
const brokenTest = (n: number) => `import { expect, test } from 'vitest';
import { nothing } from './does-not-exist-${n}.ts';
const x: = 1;
test('never runs', () => expect(nothing).toBe(x));
`;

describe.runIf(ready)('REPRO-AGENT on D2 (F check with feedback, PLAN 5.5)', () => {
  test(
    'a passing first test gets the fixed feedback; the revised assertion-failing test is final',
    async () => {
      const r = await arm(
        'REPRO-AGENT',
        {
          sessions: [
            { steps: [{ op: 'newTest', path: 'test/repro-d2.test.ts', content: passingTest }] },
            { steps: [{ op: 'write', path: 'test/repro-d2.test.ts', content: failingTest }] },
          ],
        },
        'REPRO-AGENT',
      );
      const recs = r.reproTests ?? [];
      expect(recs.map((x) => [x.round, x.fOnBase, x.isFirst, x.isFinal])).toEqual([
        [1, 'pass', true, false],
        [2, 'fail', false, true],
      ]);
      expect(recs[1]?.path).toBe('test/repro-d2.test.ts');
      expect(recs[1]?.recordingsRead).toContain(alertPath);
      expect(recs[1]?.inlineRecording).toBe(false);
      const fb = readJsonl(join(r.outDir, 'events.jsonl')).find((e) => e.type === 'f_feedback') as
        | { data: { message: string } }
        | undefined;
      expect(fb?.data.message).toMatch(
        /^Your test does not fail on the current code because of the reported issue: /,
      );
      expect(fb?.data.message).toMatch(/Revise it so it fails on the current code\.$/);
      const prompt = readFileSync(join(r.outDir, 'prompts/session-1.txt'), 'utf8');
      expect(prompt).toContain(
        `Load the recorded exchange from \`${alertPath}\` with the repository's replay helper`,
      );
      expect(readJsonl(join(r.outDir, 'repro-tests.jsonl'))).toHaveLength(2);
    },
    30 * 60_000,
  );

  test(
    'compile/import errors are not F-valid; F rounds stop at 3',
    async () => {
      const r = await arm(
        'REPRO-AGENT',
        {
          sessions: [1, 2, 3, 4].map((n) => ({
            steps: [{ op: 'write' as const, path: 'test/repro-broken.test.ts', content: brokenTest(n) }],
          })),
        },
        'REPRO-broken',
      );
      const recs = r.reproTests ?? [];
      expect(recs.map((x) => [x.round, x.fOnBase])).toEqual([
        [1, 'error'],
        [2, 'error'],
        [3, 'error'],
      ]);
      expect(recs.at(-1)?.isFinal).toBe(true);
      expect(r.stop).toBe('f_rounds_exhausted');
      const fchecks = readJsonl(join(r.outDir, 'events.jsonl')).filter((e) => e.type === 'f_check');
      expect(String((fchecks[0]?.data as { reasons: string[] } | undefined)?.reasons[0])).toMatch(
        /did not load/,
      );
    },
    30 * 60_000,
  );
});

describe.runIf(ready)('evidence and containment across the D2 runs', () => {
  test('.alerts/<id>.json = the frozen trace; the alert JSON is byte-identical across the arms', () => {
    const arms = ['L1', 'L1-noIV', 'COMP', 'COMP-norep', 'COMP-plain', 'REPRO-AGENT'];
    const alerts = arms.map((a) => readFileSync(join(outs[a] as string, 'alert.json')));
    for (const a of alerts) expect(a.equals(alerts[0] as Buffer)).toBe(true);
    for (const a of arms) {
      const copy = readFileSync(join(outs[a] as string, 'checkout', alertPath));
      expect(sha256(copy), a).toBe(trace.sha256);
    }
    expect(JSON.parse(String(alerts[0])).replayHelper).toBe(REPLAY_HELPER_SENTENCE);
  });

  test('rerecord-head only through execFiks with --require-sandbox; no host spawn of it, the CLI or the server', () => {
    for (const a of ['L1', 'COMP', 'REPRO-AGENT']) {
      const c = calls[a] ?? [];
      const rr = c.filter((x) => x.args.includes('rerecord-head') || x.cmd.includes('rerecord-head'));
      expect(rr.length, a).toBeGreaterThan(0);
      for (const x of rr) {
        expect(x.via, a).toBe('execFiks');
        expect(x.args[0], a).toBe('rerecord-head');
        expect(x.args, a).toContain('--require-sandbox');
        expect(x.env?.FIKS_IN_SANDBOX, a).toBe('1');
      }
      // IV ran behind rerecord-head (L1, COMP), never as a bare container command.
      for (const x of c.filter((y) => y.via === 'exec'))
        expect(x.args.join(' ')).not.toMatch(/iv-cli|rerecord-head/);
    }
    const forbidden = /rerecord-head|packages\/cli\/src\/main\.ts|iv-cli\.ts|src\/main\.ts|\btsx\b/;
    const offenders = hostSpawns.filter(
      (s) => s.cmd !== 'docker' && (forbidden.test(s.cmd) || s.args.some((a) => forbidden.test(a))),
    );
    expect(offenders).toEqual([]);
    expect(hostSpawns.some((s) => s.cmd === 'docker' && s.args.includes('exec'))).toBe(true);
  });
});
