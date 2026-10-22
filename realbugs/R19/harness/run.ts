// R19 F/P harness (PLAN 5.10 step 5): replays a fixture through the unmodified mongodb-mcp-server
// at a head, `--runs` times, each in a fresh server process, and reports how often the named count
// property (mongodb.atlas-list-clusters/count.matchesRows) fails.
//
// usage: pnpm tsx realbugs/R19/harness/run.ts (--sha <prefix|fix|ref> | --head-dir <built dir>)
//          [--runs N] [--fixture <file> | --heldout] [--expect fail|pass|none] [--json]
//   --sha       a ref of the clone (FIKS_REALBUG_DIR, default .work/realbugs/R19); the head is
//               built once under <clone>-heads/<sha> (npm ci + build:esm)
//   --head-dir  an already-built checkout (e.g. a candidate head) containing dist/esm/index.js
//   --fixture   default fixtures/trigger-two-clusters.json
//   --heldout   every heldout/*.json instead (the held-out manifestations, RBA grading)
//   --expect    fail = every run violates the count property; pass = every run is verified with no
//               violation and no unmatched request. Default: fail for prefix, pass for fix, else none.
// exit: 0 expectation met (or none), 1 not met, 2 usage or setup error.
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { BUG_DIR, ensureHead, resolveSha } from './heads.ts';
import { COUNT_PROPERTY, loadContracts, loadFixture, type RunOutcome, replayOnce } from './replay.ts';

export const TRIGGER = join(BUG_DIR, 'fixtures/trigger-two-clusters.json');
export const HELDOUT_DIR = join(BUG_DIR, 'heldout');

export type Expect = 'fail' | 'pass' | 'none';

export function heldoutFixtures(dir = HELDOUT_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => join(dir, f));
}

/** Did a run meet the expectation? fail: count property violated. pass: verified, clean replay. */
export function meets(o: RunOutcome, expect: Expect): boolean {
  if (expect === 'fail') return o.countFailure;
  if (expect === 'pass')
    return o.verdict === 'verified' && o.violated.length === 0 && o.unmatched.length === 0;
  return true;
}

export interface FixtureReport {
  fixture: string;
  runs: number;
  countFailures: number;
  verified: number;
  met: number;
  outcomes: RunOutcome[];
}

async function main(argv: string[]): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        sha: { type: 'string' },
        'head-dir': { type: 'string' },
        runs: { type: 'string', default: '1' },
        fixture: { type: 'string' },
        heldout: { type: 'boolean' },
        expect: { type: 'string' },
        json: { type: 'boolean' },
      },
      strict: true,
    }));
  } catch (e) {
    console.error(`[r19] ${(e as Error).message}`);
    return 2;
  }
  const sha = values.sha as string | undefined;
  const headArg = values['head-dir'] as string | undefined;
  const runs = Number(values.runs);
  if (Boolean(sha) === Boolean(headArg) || !Number.isInteger(runs) || runs < 1) {
    console.error('usage: run.ts (--sha <ref> | --head-dir <dir>) [--runs N] [--fixture f | --heldout]');
    return 2;
  }
  if (values.heldout && values.fixture) {
    console.error('[r19] --fixture and --heldout are exclusive');
    return 2;
  }
  const expect = (values.expect ?? (sha === 'prefix' ? 'fail' : sha === 'fix' ? 'pass' : 'none')) as Expect;
  if (!['fail', 'pass', 'none'].includes(expect)) {
    console.error(`[r19] --expect must be fail, pass or none`);
    return 2;
  }

  let head: string;
  let commit: string | null = null;
  try {
    if (sha) {
      commit = resolveSha(sha);
      head = ensureHead(commit);
    } else head = resolve(headArg as string);
  } catch (e) {
    console.error(`[r19] ${(e as Error).message}`);
    return 2;
  }

  const fixtures = values.heldout ? heldoutFixtures() : [resolve((values.fixture as string) ?? TRIGGER)];
  const contracts = loadContracts();
  const reports: FixtureReport[] = [];
  for (const file of fixtures) {
    const rec = loadFixture(file);
    const outcomes: RunOutcome[] = [];
    for (let i = 0; i < runs; i++) {
      const { outcome } = await replayOnce(rec, head, contracts);
      outcomes.push(outcome);
      if (!values.json) {
        console.log(
          `${rec.id} run ${i + 1}/${runs}: ${outcome.verdict}` +
            ` reportedCount=${String(outcome.reportedCount)} rowCount=${String(outcome.rowCount)}` +
            ` violated=[${outcome.violated.join(',')}] unmatched=${outcome.unmatched.length}`,
        );
      }
    }
    reports.push({
      fixture: file,
      runs,
      countFailures: outcomes.filter((o) => o.countFailure).length,
      verified: outcomes.filter((o) => o.verdict === 'verified').length,
      met: outcomes.filter((o) => meets(o, expect)).length,
      outcomes,
    });
  }
  const ok = reports.every((r) => r.met === r.runs);
  const summary = {
    bug: 'R19',
    property: COUNT_PROPERTY,
    ref: sha ?? null,
    commit,
    head,
    expect,
    fixtures: reports.map(({ outcomes, ...r }) => ({
      ...r,
      summaries: [...new Set(outcomes.map((o) => o.summary))],
    })),
    ok,
  };
  if (values.json) console.log(JSON.stringify({ ...summary, reports }, null, 2));
  else {
    for (const r of reports) {
      console.log(
        `${r.fixture.slice(BUG_DIR.length + 1)}: ${r.countFailures}/${r.runs} failures for ${COUNT_PROPERTY}; ${r.verified}/${r.runs} verified`,
      );
    }
    console.log(`expect=${expect}: ${ok ? 'MET' : 'NOT MET'}`);
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(e);
      process.exitCode = 2;
    },
  );
}
