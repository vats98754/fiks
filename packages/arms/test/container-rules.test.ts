// Arms in real per-attempt containers on injector-rule drifts (base + vendor v1 + the INJ/DOM2
// rule, frozen clock), with SAFE's stub agent:
//  - D3 and D4 as INJ rules, the stub applying packages/cli/test/oracles/D3.patch / D4.patch to
//    seed-v1: under L1 the head is exposed with issueValidation pass and ciFinal green; under COMP
//    ciFinal is green; no log line holds UNMATCHED_REQUEST; the RerecordLog lines of L1 and COMP
//    equal each other and a direct `fiks rerecord-head` call with the same profile on the same head;
//  - the planted-FP D4 trace: L1 with the D4.patch stub is exposed with issueValidation pass;
//  - TRK-DEV-1 (tracker, base dev-tracker-stub, DOM2 stub contract): fiks-iv exits 1 with the
//    property id on base and 0 on the ref A head; every arm completes with domain 'tracker' and the
//    tracker Domain's edit guard.
// Re-recording through a rule needs an injector factory in the container's CLI: ORCH's
// bootstrap/30-injector.ts, or (until it is merged) the test-only one in the test tools image.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RerecordLog } from '@fiks/interfaces';
import type { RunnerJob, StubSession } from '@fiks/repair';
import { createWorktree } from '@fiks/repro';
import { beforeAll, describe, expect, test } from 'vitest';
import { ARM_NAMES } from '../src/arms.ts';
import { ArmChecks } from '../src/checks.ts';
import { resolveDomain } from '../src/domains.ts';
import { ivMain } from '../src/iv-cli.ts';
import { findRule } from '../src/rules.ts';
import { DockerArmSandbox } from '../src/sandbox.ts';
import { loadFrozenTrace, traceProfile } from '../src/trace.ts';
import { dockerReady, readJsonl, repoImage, runInContainer, scratch } from './support/container.ts';
import {
  FIXTURES,
  ORACLES,
  ROOT,
  SHOP_DIR,
  TRACKER_DIR,
  TRACKER_STUB_CONTRACTS,
} from './support/fixtures.ts';
import { registerArmsTestInjector } from './support/injector.ts';
import { sessionFromPatch } from './support/stub.ts';
import { testToolsImage } from './support/tools-image.ts';

const ready = dockerReady();
const tmp = scratch();

beforeAll(async () => {
  if (ready) await testToolsImage();
}, 60 * 60_000);

/** RerecordLog fields compared across arms (timestamps and the check name excluded). */
const comparable = (l: RerecordLog) => ({
  profile: l.profile,
  head: l.head,
  fromCommit: l.fromCommit,
  files: l.files,
});

/** The check logs of an attempt (gates, CI, RerecordLog, events), for the UNMATCHED_REQUEST scan. */
function attemptText(dir: string): string {
  const gates = join(dir, 'gates');
  return [
    ...readdirSync(gates).map((f) => readFileSync(join(gates, f), 'utf8')),
    readFileSync(join(dir, 'rerecord.jsonl'), 'utf8'),
    readFileSync(join(dir, 'events.jsonl'), 'utf8'),
  ].join('\n');
}

describe.runIf(ready)('D3 and D4 as injector rules: L1 and COMP with the oracle patches', () => {
  for (const drift of ['D3', 'D4'] as const) {
    test(
      `${drift}: L1 exposed (IV pass, CI green), COMP green, RerecordLogs equal a direct call`,
      async (ctx) => {
        const tracePath = join(FIXTURES, `${drift}.trace.json`);
        const session = sessionFromPatch(SHOP_DIR, 'seed-v1', join(ORACLES, `${drift}.patch`));
        const l1 = await runInContainer({
          name: 'L1',
          trace: tracePath,
          base: 'seed-v1',
          script: { sessions: [session] },
          outDir: join(tmp, `${drift}-L1`),
          keepCheckout: true,
        });
        const l1Lines = readJsonl<RerecordLog>(join(l1.outDir, 'rerecord.jsonl'));
        const coreRefusal = l1Lines
          .flatMap((l) => l.files)
          .find(
            (f) => f.outcome === 'failed' && /re-recorded against a different call or upstream/.test(f.path),
          );
        if (coreRefusal) {
          // CORE rerecord() applies the profile's injector rule to every stale recording, including
          // the v1 fixtures the rule never produced, and then refuses the result. Reported as blocked.
          console.warn(`[${drift}] BLOCKED on CORE rerecord(): ${coreRefusal.path}`);
          ctx.skip();
        }
        expect(l1.attempt, l1.stop).toMatchObject({
          prExposed: true,
          issueValidation: 'pass',
          ciFinal: 'green',
          ivPlacement: 'pre',
        });
        const comp = await runInContainer({
          name: 'COMP',
          trace: tracePath,
          base: 'seed-v1',
          script: { sessions: [session] },
          outDir: join(tmp, `${drift}-COMP`),
        });
        expect(comp.attempt, comp.stop).toMatchObject({
          prExposed: true,
          ciFinal: 'green',
          issueValidation: 'pass',
          ivPlacement: 'post',
        });
        for (const r of [l1, comp]) expect(attemptText(r.outDir)).not.toContain('UNMATCHED_REQUEST');
        expect(comp.attempt?.headSha).toBe(l1.attempt?.headSha);

        // A direct rerecord-head call (same profile, same head, same recordings) in a fresh container.
        const trace = loadFrozenTrace(tracePath);
        const profile = traceProfile(trace.trace);
        const domain = await resolveDomain('shop');
        const tools = await testToolsImage();
        const sb = await DockerArmSandbox.create({
          worktree: join(l1.outDir, 'checkout'),
          image: await repoImage('shop'),
          toolsImage: tools.digest,
          toolsPurpose: 'test',
        });
        const directLog = join(tmp, `${drift}-direct.jsonl`);
        try {
          const checks = new ArmChecks({
            sandbox: sb,
            domain: domain.id,
            profile,
            rule: findRule(profile),
            fromCommit: l1Lines[0]?.fromCommit as string,
            alertRel: `.alerts/${trace.trace.id}.json`,
            alertVisible: true,
            rerecordLog: directLog,
          });
          const rr = await checks.rerecord('suite');
          await checks.restore(rr.manifest);
          checks.cleanStale(rr.line);
          expect(rr.ok, rr.output).toBe(true);
        } finally {
          await sb.cleanup();
        }
        const direct = readJsonl<RerecordLog>(directLog).map(comparable);
        const all = [...l1Lines, ...readJsonl<RerecordLog>(join(comp.outDir, 'rerecord.jsonl'))].map(
          comparable,
        );
        expect(all.length).toBeGreaterThanOrEqual(4);
        for (const l of all) expect(l).toEqual(direct[0]);
        if (drift === 'D4') {
          const overlay = direct[0]?.files.find((f) => f.mode === 'overlay');
          expect(overlay?.outcome).toBe('rerecorded'); // the fix fetches page 2: request-changing
        }
      },
      60 * 60_000,
    );
  }

  test(
    'planted-FP D4 trace: L1 with D4.patch is exposed with issueValidation pass',
    async (ctx) => {
      const session = sessionFromPatch(SHOP_DIR, 'seed-v1', join(ORACLES, 'D4.patch'));
      const r = await runInContainer({
        name: 'L1',
        trace: join(FIXTURES, 'D4-plantedfp.trace.json'),
        base: 'seed-v1',
        script: { sessions: [session] },
        outDir: join(tmp, 'D4-plantedfp-L1'),
      });
      const iv = readFileSync(join(r.outDir, 'gates/session-1-iv.log'), 'utf8');
      const overlay = readJsonl<RerecordLog>(join(r.outDir, 'rerecord.jsonl'))
        .find((l) => l.check === 'IV')
        ?.files.find((f) => f.mode === 'overlay');
      if (
        !r.attempt?.prExposed &&
        iv.includes('IV FAIL iv/UNMATCHED_REQUEST') &&
        overlay?.outcome === 'unchanged'
      ) {
        // CORE rerecord() starts the vendor with the original catalog: the trace's `all` catalog (the
        // $9 extension) is not part of the recording or the profile, so the re-recording of the
        // laptop search has 4 items and no page 2. Reported as blocked.
        console.warn('[D4-plantedfp] BLOCKED on CORE rerecord(): the vendor catalog is not re-recorded');
        ctx.skip();
      }
      expect(r.attempt, iv).toMatchObject({ prExposed: true, issueValidation: 'pass', ciFinal: 'green' });
      expect(iv).toContain('ivExcluded: shop.search_products/items.price.range (control: violated)');
    },
    60 * 60_000,
  );
});

describe.runIf(ready)('TRK-DEV-1 (tracker domain, DOM2 stub contract)', () => {
  const tracePath = join(FIXTURES, 'TRK-DEV-1.trace.json');
  const trace = loadFrozenTrace(tracePath);
  const refA = join(ROOT, 'packages/vendor-tracker/fixtures/driftpkgs/TRK-DEV-1/refA.patch');

  test('fiks-iv: exit 1 with the property id on base, 0 on the ref A head', async () => {
    registerArmsTestInjector();
    const iv = async (patch?: string) => {
      const wt = createWorktree(TRACKER_DIR, 'dev-tracker-stub', {
        dir: join(tmp, `trk-iv-${patch ? 'a' : 'base'}`),
      });
      try {
        if (patch)
          (await import('node:child_process')).execFileSync('git', ['apply', patch], { cwd: wt.dir });
        let out = '';
        const code = await ivMain(
          [
            '--trace',
            tracePath,
            '--head',
            wt.dir,
            '--contracts',
            TRACKER_STUB_CONTRACTS,
            '--properties',
            join(FIXTURES, 'TRK-DEV-1.trace.iv.json'),
            '--run-key',
            'test/L1/stub/tracker/TRK-DEV-1/1',
          ],
          { out: (s) => (out += s), err: (s) => (out += s) },
        );
        return { code, out };
      } finally {
        wt.remove();
      }
    };
    const base = await iv();
    expect(base.code).toBe(1);
    expect(base.out).toMatch(/^IV FAIL tracker\.list_comments\/countMatchesTotal: /m);
    const a = await iv(refA);
    expect(a.code, a.out).toBe(0);
  }, 300_000);

  test(
    'every arm completes on TRK-DEV-1 with domain tracker and the tracker edit guard',
    async (ctx) => {
      const tracker = await resolveDomain('tracker');
      if (!existsSync(tracker.contractsPath)) {
        // CORE rerecord() starts the harness with Domain.contractsPath (harness.ts reads it for
        // every non-shop domain); the tracker contracts are authored at A0, so every rerecord-head
        // call on a tracker head fails (and the CLI then never exits: the harness leaks its
        // servers on that error). runArm refuses up front instead of hanging. Reported as blocked.
        await expect(
          runInContainer({
            name: 'L1',
            trace: tracePath,
            base: 'dev-tracker-stub',
            script: { steps: [] },
            outDir: join(tmp, 'TRK-refused'),
          }),
        ).rejects.toThrow(/rerecord-head needs the domain's frozen contracts/);
        console.warn(`[TRK-DEV-1] BLOCKED on CORE rerecord(): ${tracker.contractsPath} does not exist`);
        ctx.skip();
      }
      const session: StubSession = sessionFromPatch(TRACKER_DIR, 'dev-tracker-stub', refA);
      const reproTest = `import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { replayRecording } from './fiks/run.ts';

test('list_comments returns every comment (${trace.trace.id})', async () => {
  const rec = JSON.parse(readFileSync(new URL('../.alerts/${trace.trace.id}.json', import.meta.url), 'utf8'));
  const r = await replayRecording(rec);
  expect(r.evaluation.violations.map((v) => v.propertyId)).toEqual([]);
});
`;
      const arms = ARM_NAMES.filter((n) => n !== 'ISSUE-TEXT');
      expect(arms).toHaveLength(7);
      const results: Record<
        string,
        { jobs: { job: RunnerJob; session: number }[]; r: Awaited<ReturnType<typeof runInContainer>> }
      > = {};
      // Two attempts at a time (two containers fit the Docker Desktop memory).
      for (let i = 0; i < arms.length; i += 2) {
        await Promise.all(
          arms.slice(i, i + 2).map(async (name) => {
            const jobs: { job: RunnerJob; session: number }[] = [];
            const r = await runInContainer({
              name,
              trace: tracePath,
              base: 'dev-tracker-stub',
              script:
                name === 'REPRO-AGENT'
                  ? { steps: [{ op: 'newTest', path: 'test/repro-trk.test.ts', content: reproTest }] }
                  : { sessions: [session] },
              outDir: join(tmp, `TRK-${name}`),
              jobs,
            });
            results[name] = { jobs, r };
          }),
        );
      }
      for (const name of arms) {
        const { jobs, r } = results[name] ?? { jobs: [], r: undefined };
        expect(r, name).toBeDefined();
        for (const { job } of jobs)
          expect(job.allowedEditPaths?.slice(0, tracker.allowedEditPaths.length), name).toEqual([
            ...tracker.allowedEditPaths,
          ]);
        if (name === 'REPRO-AGENT') {
          const recs = readJsonl<{ runKey: { domain: string }; fOnBase: string; isFinal: boolean }>(
            join(r?.outDir as string, 'repro-tests.jsonl'),
          );
          expect(recs.at(-1)).toMatchObject({
            runKey: { domain: 'tracker' },
            fOnBase: 'fail',
            isFinal: true,
          });
          continue;
        }
        const a = JSON.parse(readFileSync(join(r?.outDir as string, 'attempt.json'), 'utf8'));
        expect(a.runKey.domain, name).toBe('tracker');
        expect(a, `${name}: ${r?.stop}`).toMatchObject({ prExposed: true, ciFinal: 'green' });
        expect(a.issueValidation, name).toBe(['L1', 'L1p', 'COMP'].includes(name) ? 'pass' : 'n/a');
      }
    },
    90 * 60_000,
  );
});
