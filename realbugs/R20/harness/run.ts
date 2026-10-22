// R20 F/P harness (Figma-Context-MCP #364, PLAN 5.10 step 5): replays the trigger fixture through
// the unmodified server process at a commit, N times, in the SBX sandbox, and evaluates the blind
// contract's filesystem postcondition (file exists, size > 0).
//
// usage: pnpm tsx realbugs/R20/harness/run.ts (--sha <prefix|fix|commit> | --worktree <dir>)
//          [--runs 10] [--fixture realbugs/R20/fixtures/trigger.json] [--expect fail|pass] [--json]
//   --expect defaults to `fail` for --sha prefix and `pass` for --sha fix (none otherwise).
//   fail = every run violates figma.download_figma_images/fileWritten;
//   pass = no run fires the contract (verified, or an explicit isError = unverifiable).
//   Either way every run must replay cleanly (no unmatched or denied upstream request).
// env: FIKS_REALBUG_DIR (clone, default .work/realbugs/R20), FIKS_REALBUG_BUILDS_DIR. Needs Docker.
// exit: 0 expectation met (or none given), 1 not met, 2 usage/setup error.
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type VerdictSummary, verdictSummary } from '../../../packages/replay-proc/src/index.ts';
import { caseIO, evaluateCase, loadContract, NAMED_PROPERTY } from './check.ts';
import { BUG_DIR } from './paths.ts';
import { caseHosts, loadCase, prepareBuild, R20Sandbox, SetupError } from './server.ts';

export { NAMED_PROPERTY };

export interface RunReport {
  bugId: 'R20';
  sha: string | null;
  ref: string;
  fixture: string;
  runs: number;
  expect: 'fail' | 'pass' | null;
  /** Runs whose evaluation violated the named property. */
  failures: number;
  /** Runs with no contract fire (verified or unverifiable) and a clean replay. */
  passes: number;
  verified: number;
  distinct: number;
  summaries: VerdictSummary[];
  messages: string[];
  /** Unmatched or denied upstream requests (any makes the run unfaithful). */
  replayProblems: string[];
  ok: boolean;
}

export async function runHarness(opts: {
  sha?: string;
  worktree?: string;
  runs: number;
  fixture?: string;
  expect?: 'fail' | 'pass' | null;
}): Promise<RunReport> {
  const fixture = resolve(opts.fixture ?? join(BUG_DIR, 'fixtures', 'trigger.json'));
  const contract = loadContract();
  const c = loadCase(fixture);
  const build = await prepareBuild({ sha: opts.sha, worktree: opts.worktree });
  const box = new R20Sandbox(build, caseHosts([c]));
  const summaries: VerdictSummary[] = [];
  const messages: string[] = [];
  const replayProblems: string[] = [];
  let failures = 0;
  let passes = 0;
  let verified = 0;
  try {
    for (let i = 0; i < opts.runs; i++) {
      const run = await box.runCase(c);
      const evaluation = evaluateCase(contract, caseIO(c.args, run, c.server.cwd));
      const problems = [
        ...run.unmatched.map((k) => `unmatched ${k}`),
        ...run.denied.map((k) => `denied ${k}`),
        ...(run.rpcError ? [`rpc error: ${run.rpcError.message}`] : []),
      ];
      replayProblems.push(...problems);
      summaries.push(verdictSummary({ evaluation, unmatched: [...run.unmatched, ...run.denied] }));
      const resultText = (run.result?.content ?? [])
        .map((b) => (b as { text?: string }).text ?? '')
        .join(' | ')
        .replace(/\s+/g, ' ');
      messages.push(
        evaluation.violations.map((v) => v.message).join(' ;; ') ||
          `${evaluation.verdict}${run.result?.isError ? ' (isError)' : ''}: ${resultText}`,
      );
      const fired = evaluation.violations.some((v) => v.propertyId === NAMED_PROPERTY);
      if (fired) failures++;
      if (!fired && evaluation.verdict !== 'violated' && run.result && !problems.length) passes++;
      if (evaluation.verdict === 'verified') verified++;
    }
  } finally {
    await box.cleanup();
  }
  const expect =
    opts.expect !== undefined
      ? opts.expect
      : opts.sha === 'prefix'
        ? 'fail'
        : opts.sha === 'fix'
          ? 'pass'
          : null;
  const clean = replayProblems.length === 0;
  const ok =
    expect === 'fail'
      ? clean && failures === opts.runs
      : expect === 'pass'
        ? clean && passes === opts.runs
        : true;
  return {
    bugId: 'R20',
    sha: build.sha,
    ref: opts.worktree ? `worktree:${resolve(opts.worktree)}` : (opts.sha ?? 'prefix'),
    fixture,
    runs: opts.runs,
    expect,
    failures,
    passes,
    verified,
    distinct: new Set(summaries.map((s) => JSON.stringify(s))).size,
    summaries,
    messages: [...new Set(messages)],
    replayProblems: [...new Set(replayProblems)],
    ok,
  };
}

async function main(argv: string[]): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        sha: { type: 'string' },
        worktree: { type: 'string' },
        runs: { type: 'string', default: '10' },
        fixture: { type: 'string' },
        expect: { type: 'string' },
        json: { type: 'boolean' },
      },
      strict: true,
    }));
  } catch (e) {
    console.error(`[r20] ${(e as Error).message}`);
    return 2;
  }
  const runs = Number(values.runs);
  if (Boolean(values.sha) === Boolean(values.worktree) || !Number.isInteger(runs) || runs < 1) {
    console.error(
      'usage: run.ts (--sha <ref> | --worktree <dir>) [--runs N] [--fixture f] [--expect fail|pass]',
    );
    return 2;
  }
  if (values.expect !== undefined && values.expect !== 'fail' && values.expect !== 'pass') {
    console.error('[r20] --expect must be fail or pass');
    return 2;
  }
  try {
    const report = await runHarness({
      sha: values.sha as string | undefined,
      worktree: values.worktree as string | undefined,
      runs,
      fixture: values.fixture as string | undefined,
      expect: values.expect as 'fail' | 'pass' | undefined,
    });
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else {
      for (const [i, s] of report.summaries.entries()) {
        console.log(
          `run ${i + 1}/${runs}: ${s.verdict}${s.violated.length ? ` ${[...new Set(s.violated)].join(',')}` : ''}`,
        );
      }
      for (const m of report.messages) console.log(`  ${m}`);
      for (const p of report.replayProblems) console.log(`  replay problem: ${p}`);
      console.log(
        `R20 ${report.ref} (${report.sha?.slice(0, 12) ?? '?'}): ${report.failures}/${runs} failures for ${NAMED_PROPERTY}, ${report.passes}/${runs} pass (${report.verified} verified), ${report.distinct} distinct verdict(s); expect ${report.expect ?? 'none'} -> ${report.ok ? 'OK' : 'NOT MET'}`,
      );
    }
    return report.ok ? 0 : 1;
  } catch (e) {
    console.error(`[r20] ${e instanceof Error ? e.message : String(e)}`);
    return e instanceof SetupError ? 2 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2)).then((c) => {
    process.exitCode = c;
  });
}
