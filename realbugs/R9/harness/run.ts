// R9 F/P harness (cloudflare/mcp-server-cloudflare #468, PLAN 5.10 step 5): replays the trigger
// fixture through the unmodified server process for a commit (server.ts says which process), N
// times, and evaluates the blind contract (standard outputSchema + textJson + carriesUpstream).
//
// usage: pnpm tsx realbugs/R9/harness/run.ts (--sha <prefix|fix|commit> | --worktree <dir>)
//          [--runs 10] [--fixture realbugs/R9/fixtures/trigger.json] [--expect fail|pass] [--json]
//   --expect defaults to `fail` for --sha prefix (none otherwise: PR #469 is not a merged fix).
//   fail = every run violates the named property cloudflare.zones_list/textJson;
//   pass = every run verifies (no contract fire).
// env: FIKS_REALBUG_DIR (clone, default .work/realbugs/R9), FIKS_REALBUG_BUILDS_DIR.
// exit: 0 expectation met (or none given), 1 not met, 2 usage/setup error.
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type VerdictSummary, verdictSummary } from '../../../packages/replay-proc/src/index.ts';
import { evaluateCase, loadContract } from './check.ts';
import { BUG_DIR, loadCase, prepareBuild, runCase, SetupError } from './server.ts';

export const NAMED_PROPERTY = 'cloudflare.zones_list/textJson';

export interface RunReport {
  bugId: 'R9';
  sha: string | null;
  ref: string;
  serverKind: 'repo-package' | 'npx-artifact';
  fixture: string;
  runs: number;
  expect: 'fail' | 'pass' | null;
  /** Runs whose evaluation violated the named property. */
  failures: number;
  /** Runs that verified. */
  passes: number;
  distinct: number;
  summaries: VerdictSummary[];
  /** Distinct one-line descriptions of what the agent received, per run. */
  observed: string[];
  messages: string[];
  ok: boolean;
}

/** What reached the agent, in one line (content blocks, isError, non-standard keys). */
export function describeResult(result: Record<string, unknown>): string {
  const content = Array.isArray(result.content) ? result.content : [];
  const extra = Object.keys(result).filter(
    (k) => !['content', 'structuredContent', 'isError', '_meta'].includes(k),
  );
  const first = content[0] as { type?: string; text?: string } | undefined;
  const text =
    typeof first?.text === 'string' ? ` first text ${JSON.stringify(first.text.slice(0, 40))}` : '';
  return `content ${content.length} block(s)${text}, isError ${String(result.isError ?? false)}, structuredContent ${result.structuredContent ? 'yes' : 'no'}${extra.length ? `, non-standard keys [${extra.join(', ')}]` : ''}`;
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
  const summaries: VerdictSummary[] = [];
  const messages: string[] = [];
  const observed: string[] = [];
  for (let i = 0; i < opts.runs; i++) {
    const r = await runCase(build, c, contract);
    const io = { tool: c.tool, args: c.args, result: r.replayed.result, upstream: r.upstream };
    const evaluation = evaluateCase(contract, io, r.replayed.evaluation);
    summaries.push(verdictSummary({ evaluation, unmatched: r.replayed.unmatched }));
    messages.push(
      evaluation.violations[0]?.message ??
        `${evaluation.verdict} (checked ${evaluation.checked.join(', ') || 'nothing'})`,
    );
    observed.push(describeResult(r.replayed.result as unknown as Record<string, unknown>));
  }
  const failures = summaries.filter((s) => s.violated.includes(NAMED_PROPERTY)).length;
  const passes = summaries.filter((s) => s.verdict === 'verified').length;
  const expect = opts.expect !== undefined ? opts.expect : opts.sha === 'prefix' ? 'fail' : null;
  const ok = expect === 'fail' ? failures === opts.runs : expect === 'pass' ? passes === opts.runs : true;
  return {
    bugId: 'R9',
    sha: build.sha,
    ref: opts.worktree ? `worktree:${resolve(opts.worktree)}` : (opts.sha ?? 'prefix'),
    serverKind: build.kind,
    fixture,
    runs: opts.runs,
    expect,
    failures,
    passes,
    distinct: new Set(summaries.map((s) => JSON.stringify(s))).size,
    summaries,
    observed: [...new Set(observed)],
    messages: [...new Set(messages)],
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
    console.error(`[r9] ${(e as Error).message}`);
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
    console.error('[r9] --expect must be fail or pass');
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
          `run ${i + 1}/${runs}: ${s.verdict}${s.violated.length ? ` ${s.violated.join(',')}` : ''} (checked ${s.checked.join(',') || '-'})`,
        );
      }
      for (const o of report.observed) console.log(`  agent received: ${o}`);
      for (const m of report.messages) console.log(`  ${m}`);
      console.log(
        `R9 ${report.ref} (${report.sha?.slice(0, 12) ?? '?'}, ${report.serverKind}): ${report.failures}/${runs} failures for ${NAMED_PROPERTY}, ${report.passes}/${runs} pass, ${report.distinct} distinct verdict(s); expect ${report.expect ?? 'none'} -> ${report.ok ? 'OK' : 'NOT MET'}`,
      );
    }
    return report.ok ? 0 : 1;
  } catch (e) {
    console.error(`[r9] ${e instanceof Error ? e.message : String(e)}`);
    return e instanceof SetupError ? 2 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2)).then((c) => {
    process.exitCode = c;
  });
}
