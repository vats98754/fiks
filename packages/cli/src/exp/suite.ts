// The shop-mcp suite and the gates, run through an ExpSandbox (host or container). The verdict rules
// are the product's (packages/repro gate.ts failGate/passGate, packages/repair gates.ts localGate);
// only where the commands run differs.
import { relative } from 'node:path';
import type { FailedTest, FileResult, ReproSpec, SuiteRun } from '@fiks/interfaces';
import { classifyFailure } from '@fiks/repro';
import { STALE } from '../commands/rerecord-stale.ts';
import type { ExpSandbox } from './sandbox.ts';
import type { GateRecord } from './types.ts';

interface VitestJson {
  testResults: {
    name: string;
    status: string;
    message?: string;
    assertionResults: { fullName: string; status: string; failureMessages: string[] }[];
  }[];
}

let runN = 0;

/** shop-mcp's whole vitest suite in the sandbox (JSON reporter), parsed like repro's runSuite. */
export async function runSuiteIn(
  sb: ExpSandbox,
  realWorkdir = sb.workdir,
): Promise<SuiteRun & { output: string }> {
  const file = sb.scratch(`vitest-${process.pid}-${++runN}.json`);
  const args = ['run', '--reporter=json', `--outputFile=${file}`, '--testTimeout=60000'];
  const command = `vitest ${args.join(' ')}`;
  const r = await sb.exec('node_modules/.bin/vitest', args, { timeoutMs: 15 * 60_000 });
  const output = `${r.stdout}\n${r.stderr}`;
  const text = await sb.readScratch(file);
  let report: VitestJson;
  try {
    report = JSON.parse(text ?? '') as VitestJson;
  } catch {
    return {
      exitCode: r.code,
      failed: [],
      files: [],
      suiteErrors: [`no vitest report: ${(r.stderr || r.stdout || '').slice(0, 2000)}`],
      logPath: file,
      command,
      output,
    };
  }
  const failed: FailedTest[] = [];
  const files: FileResult[] = [];
  const suiteErrors: string[] = [];
  for (const t of report.testResults) {
    const rel = relative(realWorkdir, t.name);
    files.push({ file: rel, statuses: t.assertionResults.map((a) => a.status) });
    const fails = t.assertionResults.filter((a) => a.status === 'failed');
    for (const a of fails)
      failed.push({ file: rel, test: a.fullName, message: a.failureMessages.join('\n').slice(0, 4000) });
    if (t.status === 'failed' && fails.length === 0)
      suiteErrors.push(`${rel}: ${t.message ?? 'suite failed to run'}`);
  }
  return { exitCode: r.code, failed, files, suiteErrors, logPath: file, command, output };
}

/** True when the run reports recordings the code no longer matches (fiks re-records those). */
export const hasStale = (run: SuiteRun) => run.failed.some((f) => STALE.test(f.message));

/**
 * F gate (product rule): on the unfixed code the whole suite fails in exactly the repro test, for
 * the stated reason, with no setup errors, the same way on every run.
 */
export async function fGate(
  sb: ExpSandbox,
  spec: ReproSpec,
  runs = 3,
  realWorkdir?: string,
): Promise<{ gate: GateRecord; failure: string }> {
  let first: string | undefined;
  let failure = '';
  for (let i = 0; i < runs; i++) {
    const r = await runSuiteIn(sb, realWorkdir);
    const fail = (reason: string) => ({ gate: { name: 'F', ok: false, reason }, failure });
    if (r.suiteErrors.length) return fail(`setup error: ${r.suiteErrors.join('; ').slice(0, 500)}`);
    if (r.exitCode === 0 || r.failed.length === 0) return fail('passed on unfixed code');
    const others = r.failed.filter((f) => f.file !== spec.testPath);
    if (others.length)
      return fail(`other tests fail too: ${others.map((f) => `${f.file} > ${f.test}`).join('; ')}`);
    if (r.failed.length !== 1) return fail(`expected 1 failing test, got ${r.failed.length}`);
    failure = r.failed[0]?.message ?? '';
    const why = classifyFailure(failure, spec.propertyIds);
    if (!why.ok) return fail(why.reason);
    const msg = JSON.stringify(r.failed.map((f) => f.message));
    first ??= msg;
    if (msg !== first) return fail('non-deterministic: runs disagree');
  }
  return {
    gate: { name: 'F', ok: true, reason: `fails for the stated reason on ${runs}/${runs} runs` },
    failure,
  };
}

/** The repro test ran and passed (product P-gate rule for the test itself). */
export function reproVerdict(run: SuiteRun, testPath: string): GateRecord {
  if (run.suiteErrors.length)
    return { name: 'repro', ok: false, reason: `setup error: ${run.suiteErrors.join('; ').slice(0, 500)}` };
  const failing = run.failed.filter((f) => f.file === testPath);
  if (failing.length)
    return {
      name: 'repro',
      ok: false,
      reason: `repro test still fails: ${failing[0]?.message.split('\n')[0]?.slice(0, 300)}`,
    };
  const ran = run.files.find((f) => f.file === testPath);
  if (!ran || ran.statuses.length === 0 || ran.statuses.some((s) => s !== 'passed'))
    return {
      name: 'repro',
      ok: false,
      reason: `repro test did not run and pass (${ran ? ran.statuses.join(',') || 'no tests' : 'missing'})`,
    };
  return { name: 'repro', ok: true, reason: 'repro test ran and passed' };
}

/** The whole suite (contract suite + stored traces + any repro tests) passes. */
export function suiteVerdict(run: SuiteRun): GateRecord {
  if (run.suiteErrors.length)
    return { name: 'suite', ok: false, reason: `setup error: ${run.suiteErrors.join('; ').slice(0, 500)}` };
  if (run.exitCode !== 0 || run.failed.length)
    return {
      name: 'suite',
      ok: false,
      reason: `suite fails: ${
        run.failed
          .map((f) => `${f.file} > ${f.test}`)
          .join('; ')
          .slice(0, 800) || `exit ${run.exitCode}`
      }`,
    };
  return { name: 'suite', ok: true, reason: 'contract suite and stored traces pass' };
}

/** `pnpm typecheck` / `pnpm lint` in the sandbox (the product's local gate commands). */
export async function scriptGate(
  sb: ExpSandbox,
  script: 'typecheck' | 'lint',
): Promise<GateRecord & { output: string }> {
  const r = await sb.exec('pnpm', ['--reporter=default', script], { timeoutMs: 10 * 60_000 });
  const output = `${r.stdout}\n${r.stderr}`;
  return {
    name: script,
    ok: r.code === 0,
    reason:
      r.code === 0
        ? `pnpm ${script} passes`
        : `pnpm ${script} failed: ${output.trim().split('\n').slice(-15).join('\n').slice(0, 1500)}`,
    output,
  };
}
