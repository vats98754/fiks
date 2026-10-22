// End-to-end in real grading containers (slow; FIKS_HELDOUT_E2E=1 FIKS_TOOLS_IMAGE=<fiks-tools image>,
// a test-only image built from this checkout with `--ref HEAD --apply-fragments` during the build):
//  - D1-D5 / DEV-X1 / TRK-DEV-1: ref A and ref B grade correct, base incorrect, drifted behaviour
//    from vendor v1 + the injector rule; the P1-P8 dev patches reproduce their expected GradeRecords
//    (FIKS_HELDOUT_E2E_FULL=1 for all of them; otherwise P3 and, on D1, P1);
//  - grading is identical across 3 reruns (GradeRecord hashes);
//  - accept() on the D3 and D4 oracle patches and base: one rerecord-head per patch, identical
//    profile for every test set, no UNMATCHED_REQUEST, the fiks set and a stub agent test that
//    reads .alerts/<id>.json accept the oracle patch and reject base; TRK-DEV-1 likewise;
//  - requestChanging: true for D3 and D4, false for D1, D2 and D5.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDomain, listDomains, registerDomain } from '@fiks/domains';
import type { GradeRecord } from '@fiks/interfaces';
import { describe, expect, test } from 'vitest';
import { AcceptMatrix, type TestSet } from '../src/accept.ts';
import { Grader } from '../src/grade.ts';
import { gradeRecordHash } from '../src/hash.ts';
import { type LoadedPackage, loadPackage } from '../src/pkg.ts';
import { requestChanging } from '../src/request-changing.ts';
import { dockerSandboxFactory, repoImageFor, type SandboxFactory } from '../src/sandbox.ts';
import { DEV, FIKS_ROOT, manifestOf } from './support/shop.ts';

const E2E = process.env.FIKS_HELDOUT_E2E === '1';
const FULL = process.env.FIKS_HELDOUT_E2E_FULL === '1';
const TOOLS = process.env.FIKS_TOOLS_IMAGE ?? '';
const HOUR = 3_600_000;

async function domain(id: string) {
  if (!listDomains().some((d) => d.id === id)) {
    if (id === 'shop') {
      const { createShopDomain } = await import('@fiks/vendor-api');
      const { shopReproEmitter, shopSuite } = await import('@fiks/repro');
      registerDomain(createShopDomain({ reproEmitter: shopReproEmitter, suite: shopSuite, tasks: [] }));
    } else {
      const { trackerDomain } = await import('@fiks/vendor-tracker');
      registerDomain(trackerDomain);
    }
  }
  return getDomain(id);
}

const factories = new Map<string, Promise<SandboxFactory>>();
function sandboxFor(p: LoadedPackage, repoDir: string): Promise<SandboxFactory> {
  const key = `${repoDir}@${p.pkg.base}`;
  let f = factories.get(key);
  if (!f) {
    f = repoImageFor(repoDir, p.pkg.base).then((repoImage) =>
      dockerSandboxFactory({ repoImage, toolsImage: TOOLS, purpose: 'test' }),
    );
    factories.set(key, f);
  }
  return f;
}

async function graderFor(id: string): Promise<{ p: LoadedPackage; grader: Grader; repoDir: string }> {
  const p = await loadPackage(manifestOf(id));
  const d = await domain(p.pkg.domain);
  const repoDir = d.repo.dir();
  const grader = new Grader(p, {
    sandbox: await sandboxFor(p, repoDir),
    repoDir,
    clock: d.frozenClock,
    traffic: JSON.parse(readFileSync(join(DEV, 'traffic', `${p.pkg.domain}.json`), 'utf8')),
    log: (l) => console.log(l),
  });
  return { p, grader, repoDir };
}

const expected = (id: string, op: string) =>
  JSON.parse(readFileSync(join(DEV, 'pmut', id, `${op}.expected.json`), 'utf8')) as GradeRecord;

describe.runIf(E2E && TOOLS)('held-out grading in containers', () => {
  for (const id of ['D1', 'D2', 'D3', 'D4', 'D5', 'DEV-X1']) {
    test(
      `${id}: ref A and ref B correct, base incorrect, P1-P8 reproduce their expected GradeRecords`,
      async () => {
        const { p, grader } = await graderFor(id);
        const a = await grader.grade({ id: `${id}/refA`, diff: readFileSync(p.refA, 'utf8') });
        const b = await grader.grade({ id: `${id}/refB`, diff: readFileSync(p.refB, 'utf8') });
        const base = await grader.grade({ id: `${id}/base`, diff: '' });
        expect(a.record, JSON.stringify(a.detail.hidden)).toMatchObject({ correct: true, reasons: [] });
        expect(b.record).toMatchObject({ correct: true, reasons: [] });
        expect(base.record.correct).toBe(false);
        const ops = FULL
          ? ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']
          : id === 'D1'
            ? ['P1', 'P3']
            : ['P3'];
        for (const op of ops) {
          const g = await grader.grade({
            id: `${id}/${op}`,
            diff: readFileSync(join(DEV, 'pmut', id, `${op}.patch`), 'utf8'),
          });
          expect(g.record, op).toEqual(expected(id, op));
        }
        expect(expected(id, 'P3')).toMatchObject({ correct: false });
        expect(expected(id, 'P3').reasons).toContain('renamed-id');
        if (id === 'D1') expect(expected(id, 'P1').correct).toBe(false);
      },
      3 * HOUR,
    );
  }

  test(
    'TRK-DEV-1 (DOM2 package, dev-tracker-stub): ref A and ref B correct, base incorrect',
    async () => {
      const { p, grader } = await graderFor('TRK-DEV-1');
      expect(
        (await grader.grade({ id: 'TRK-DEV-1/refA', diff: readFileSync(p.refA, 'utf8') })).record.correct,
      ).toBe(true);
      expect(
        (await grader.grade({ id: 'TRK-DEV-1/refB', diff: readFileSync(p.refB, 'utf8') })).record.correct,
      ).toBe(true);
      expect((await grader.grade({ id: 'TRK-DEV-1/base', diff: '' })).record.correct).toBe(false);
    },
    2 * HOUR,
  );

  test(
    'grading is identical across 3 reruns (GradeRecord hashes), fresh graders each time',
    async () => {
      const heads = ['refA', 'base', 'P3'];
      const runs: string[][] = [];
      for (let i = 0; i < 3; i++) {
        const { p, grader } = await graderFor('D3');
        const diffs: Record<string, string> = {
          refA: readFileSync(p.refA, 'utf8'),
          base: '',
          P3: readFileSync(join(DEV, 'pmut/D3/P3.patch'), 'utf8'),
        };
        const hashes: string[] = [];
        for (const h of heads)
          hashes.push(
            gradeRecordHash((await grader.grade({ id: `D3/${h}`, diff: diffs[h] as string })).record),
          );
        runs.push(hashes);
        console.log(`rerun ${i + 1}: ${hashes.join(' ')}`);
      }
      expect(runs[1]).toEqual(runs[0]);
      expect(runs[2]).toEqual(runs[0]);
    },
    3 * HOUR,
  );
});

function devSets(id: string): { sets: TestSet[]; alert: { id: string; bytes: string } } {
  const dir = join(DEV, id);
  const alertBytes = readFileSync(join(dir, 'trace.json'), 'utf8');
  const traceId = (JSON.parse(alertBytes) as { id: string }).id;
  const fiksFiles = readdirSync(join(dir, 'fiks/test/repro')).map((f) => ({
    path: `test/repro/${f}`,
    bytes: readFileSync(join(dir, 'fiks/test/repro', f), 'utf8'),
  }));
  const agent = readdirSync(join(dir, 'agent/test')).map((f) => ({
    path: `test/${f}`,
    bytes: readFileSync(join(dir, 'agent/test', f), 'utf8'),
  }));
  return {
    alert: { id: traceId, bytes: alertBytes },
    sets: [
      { id: 'fiks', kind: 'fiks', files: fiksFiles },
      { id: 'agent-stub', kind: 'agent-final', files: agent },
      { id: 'none', kind: 'empty', files: [] },
    ],
  };
}

describe.runIf(E2E && TOOLS)('accept() in containers', () => {
  for (const id of ['D3', 'D4', 'TRK-DEV-1']) {
    test(
      `${id}: one re-record per patch (same profile for every set); fiks and stub agent accept ref A, reject base`,
      async () => {
        const p = await loadPackage(manifestOf(id));
        const d = await domain(p.pkg.domain);
        const { sets, alert } = devSets(id);
        const m = new AcceptMatrix(
          p,
          { sandbox: await sandboxFor(p, d.repo.dir()), repoDir: d.repo.dir(), alert, log: console.log },
          sets,
        );
        const profiles = await m.profiles();
        expect(profiles.find((x) => x.setId === 'agent-stub')?.overlaid).toContain(
          `.alerts/${alert.id}.json`,
        );
        expect(profiles.find((x) => x.setId === 'fiks')?.overlaid).toContain(`test/repro/${alert.id}.json`);
        expect(profiles.every((x) => !x.inlineRecording)).toBe(true);
        const refA = await m.accept({ id: `${id}/refA`, diff: readFileSync(p.refA, 'utf8') });
        const base = await m.accept({ id: `${id}/base`, diff: '' });
        console.log(
          JSON.stringify({ refA: refA.rerecord, base: base.rerecord, refABase: refA.base }, null, 1).slice(
            0,
            4000,
          ),
        );
        for (const r of [refA, base]) {
          expect(r.rerecord?.log?.profile).toEqual({
            domain: p.pkg.domain,
            base: 'v1',
            ruleId: p.rule.id,
            ruleHash: p.rule.hash,
          });
          const overlay = r.rerecord?.log?.files.filter((f) => f.mode === 'overlay').map((f) => f.path) ?? [];
          expect(overlay).toContain(`.alerts/${alert.id}.json`);
          for (const c of r.cells) {
            for (const f of c.t?.files ?? []) expect(f.error ?? '').not.toMatch(/UNMATCHED_REQUEST/);
          }
        }
        const cell = (r: typeof refA, s: string) => r.cells.find((c) => c.setId === s)?.accepted;
        expect(cell(refA, 'fiks'), JSON.stringify(refA.cells)).toBe(true);
        expect(cell(refA, 'agent-stub')).toBe(true);
        expect(cell(base, 'fiks')).toBe(false);
        expect(cell(base, 'agent-stub')).toBe(false);
      },
      2 * HOUR,
    );
  }

  test(
    'requestChanging: true for D3 and D4, false for D1, D2 and D5 (rerecord-head on ref A, in containers)',
    async () => {
      const got: Record<string, boolean> = {};
      for (const id of ['D1', 'D2', 'D3', 'D4', 'D5']) {
        const p = await loadPackage(manifestOf(id));
        const d = await domain(p.pkg.domain);
        const dir = join(DEV, id);
        const bytes = readFileSync(join(dir, 'trace.json'), 'utf8');
        const r = await requestChanging(p, {
          repoDir: d.repo.dir(),
          sandbox: await sandboxFor(p, d.repo.dir()),
          trace: { id: (JSON.parse(bytes) as { id: string }).id, bytes },
          enumeration: readdirSync(join(dir, 'enum'))
            .sort()
            .map((f) => join(dir, 'enum', f)),
        });
        got[id] = r.requestChanging;
        console.log(`${id}: requestChanging=${r.requestChanging} rerecorded=${r.rerecorded.join(',')}`);
      }
      expect(got).toEqual({ D1: false, D2: false, D3: true, D4: true, D5: false });
    },
    2 * HOUR,
  );
});

test.runIf(!E2E)('container suite skipped (set FIKS_HELDOUT_E2E=1 and FIKS_TOOLS_IMAGE)', () => {
  expect(FIKS_ROOT.length).toBeGreaterThan(0);
});
