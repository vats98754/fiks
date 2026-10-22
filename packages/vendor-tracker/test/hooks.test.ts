// The tracker Domain hooks on the real tracker-mcp: a TRK-DEV-1 trace recorded at
// dev-tracker-stub (vendor v1 behind the TRK-DEV-1 rule) and evaluated with the vendored stub
// contract; reproEmitter's files make exactly that repro fail on base for the stated property (the
// F condition, via suite.oneFailingInScope), pass Biome in tracker-mcp, and pass with ref A applied.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ReproTrace } from '@fiks/interfaces';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { readDriftPackage, readRule, startRuleProxy } from '../src/devdrift.ts';
import { TRACKER_FROZEN_CLOCK, trackerDomain } from '../src/index.ts';
import { startRecorder } from '../src/record.ts';
import { DRIFTPKGS, type Worktree, worktree } from './support/repo.ts';

const PROPERTY = 'tracker.list_comments/countMatchesTotal';

/** Records `list_comments` on TRK-101 under TRK-DEV-1 and evaluates it with the worktree's vendored evaluator. */
async function recordTrkDev1Trace(repoDir: string): Promise<ReproTrace> {
  const pkg = readDriftPackage(join(DRIFTPKGS, 'TRK-DEV-1.json'));
  const rule = readRule(join(pkg.dir, pkg.injectorRule.path));
  const rec = await startRecorder({
    repoDir,
    serverCommand: trackerDomain.serverCommand,
    clock: TRACKER_FROZEN_CLOCK,
    middleware: [(target) => startRuleProxy(target, rule, TRACKER_FROZEN_CLOCK)],
    drifts: ['TRK-DEV-1'],
  });
  try {
    const r = await rec.call('list_comments', { issue_key: 'TRK-101' }, 'tr_trkdev1test');
    const ev = (await import(pathToFileURL(join(repoDir, 'test/fiks/vendored/evaluate.ts')).href)) as {
      evaluate(c: unknown, input: unknown): { violations: ReproTrace['violated'] };
      findContract(f: unknown, tool: string): unknown;
    };
    const contracts = JSON.parse(
      readFileSync(join(repoDir, 'test/fiks/vendored/tracker-mcp.contracts.json'), 'utf8'),
    );
    const { violations } = ev.evaluate(ev.findContract(contracts, 'list_comments'), {
      args: r.args,
      result: r.result,
      now: new Date(r.capturedAt),
      upstream: r.http,
    });
    return {
      ...r,
      runId: 'run_test',
      contractId: 'tracker.list_comments',
      violated: violations,
      target: [PROPERTY],
      server: { name: 'tracker-mcp', transport: 'stdio' },
    };
  } finally {
    await rec.close();
  }
}

describe('tracker hooks on tracker-mcp dev-tracker-stub (TRK-DEV-1)', () => {
  let wt: Worktree;
  let trace: ReproTrace;
  beforeAll(async () => {
    wt = worktree('dev-tracker-stub');
    trace = await recordTrkDev1Trace(wt.dir);
  });
  afterAll(() => wt?.remove());

  test('the stub contract has a property TRK-DEV-1 violates on base', () => {
    expect(trace.violated.map((v) => v.propertyId)).toContain(PROPERTY);
    expect(trace.result?.structuredContent).toMatchObject({ count: 0, total: 3 });
  });

  test('reproEmitter -> F on base (one failing test, in scope, for the property), Biome-clean; P after ref A', () => {
    const spec = {
      traceId: trace.id,
      propertyIds: [PROPERTY],
      testPath: `test/repro/${trace.id}.test.ts`,
      tracePath: `test/repro/${trace.id}.json`,
    };
    const out = trackerDomain.reproEmitter(trace, spec);
    expect(out.testPath).toBe(spec.testPath);
    expect(out.files.map((f) => f.path).sort()).toEqual([spec.tracePath, spec.testPath].sort());
    for (const f of out.files) {
      mkdirSync(join(wt.dir, 'test/repro'), { recursive: true });
      writeFileSync(join(wt.dir, f.path), f.bytes);
    }
    const lint = spawnSync(join(wt.dir, 'node_modules/.bin/biome'), ['check', 'test/repro'], {
      cwd: wt.dir,
      encoding: 'utf8',
    });
    expect(lint.status, lint.stdout + lint.stderr).toBe(0);

    const base = trackerDomain.suite.run(wt.dir);
    expect(base.suiteErrors).toEqual([]);
    expect(base.failed.map((f) => f.file)).toEqual([spec.testPath]);
    expect(trackerDomain.suite.oneFailingInScope(base)).toBe(true);
    expect(base.failed[0]?.message.split('\n')[0]).toMatch(
      new RegExp(`^.*${PROPERTY.replace(/[./]/g, '\\$&')} violated`),
    );

    execFileSync('git', ['apply', join(DRIFTPKGS, 'TRK-DEV-1/refA.patch')], { cwd: wt.dir });
    const fixed = trackerDomain.suite.run(wt.dir);
    expect(fixed.failed).toEqual([]);
    expect(fixed.exitCode).toBe(0);
    expect(fixed.files.find((f) => f.file === spec.testPath)?.statuses).toEqual(['passed']);
    expect(trackerDomain.suite.oneFailingInScope(fixed)).toBe(false);
  });

  test('a narrower scope runs and judges only its files', () => {
    const r = trackerDomain.suite.run(wt.dir, ['test/server.test.ts']);
    expect(r.files.map((f) => f.file)).toEqual(['test/server.test.ts']);
  });

  test('reproEmitter refuses a target that was not violated, and split paths', () => {
    const spec = {
      traceId: 'x',
      propertyIds: [],
      testPath: 'test/repro/x.test.ts',
      tracePath: 'test/repro/x.json',
    };
    expect(() =>
      trackerDomain.reproEmitter({ ...trace, target: ['tracker.list_comments/nope'] }, spec),
    ).toThrow(/not violated/);
    expect(() => trackerDomain.reproEmitter(trace, { ...spec, tracePath: 'test/traces/x.json' })).toThrow(
      /together/,
    );
  });
});
