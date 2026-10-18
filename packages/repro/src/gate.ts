import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReproSpec } from './generate.ts';

export interface FailedTest {
  file: string;
  test: string;
  message: string;
}

/** Per-file assertion statuses, so a gate can see whether a given test file ran at all. */
export interface FileResult {
  file: string;
  statuses: string[];
}

export interface GateResult {
  gate: 'F' | 'P' | 'local' | 'ci';
  ok: boolean;
  reason: string;
  evidence: {
    command: string;
    exitCode: number;
    failed: FailedTest[];
    logPath: string;
    url?: string;
    runs?: number;
  };
}

export interface SuiteRun {
  exitCode: number;
  failed: FailedTest[];
  files: FileResult[];
  suiteErrors: string[];
  logPath: string;
  command: string;
}

interface VitestJson {
  testResults: {
    name: string;
    status: string;
    message?: string;
    assertionResults: { fullName: string; status: string; failureMessages: string[] }[];
  }[];
}

/** Runs the whole shop-mcp vitest suite in `repoDir` and reports what ran and what failed. */
export function runSuite(repoDir: string): SuiteRun {
  const out = join(mkdtempSync(join(tmpdir(), 'fiks-gate-')), 'vitest.json');
  const args = ['run', '--reporter=json', `--outputFile=${out}`];
  const command = `vitest ${args.join(' ')}`;
  const r = spawnSync(join(repoDir, 'node_modules/.bin/vitest'), args, { cwd: repoDir, encoding: 'utf8' });
  let report: VitestJson;
  try {
    report = JSON.parse(readFileSync(out, 'utf8')) as VitestJson;
  } catch {
    const tail = (r.stderr || r.stdout || '').slice(0, 2000);
    return {
      exitCode: r.status ?? 1,
      failed: [],
      files: [],
      suiteErrors: [`no vitest report: ${tail}`],
      logPath: out,
      command,
    };
  }
  const failed: FailedTest[] = [];
  const files: FileResult[] = [];
  const suiteErrors: string[] = [];
  for (const file of report.testResults) {
    const rel = file.name.replace(`${repoDir}/`, '');
    files.push({ file: rel, statuses: file.assertionResults.map((a) => a.status) });
    const fails = file.assertionResults.filter((a) => a.status === 'failed');
    for (const a of fails) {
      failed.push({ file: rel, test: a.fullName, message: a.failureMessages.join('\n').slice(0, 4000) });
    }
    if (file.status === 'failed' && fails.length === 0)
      suiteErrors.push(`${rel}: ${file.message ?? 'suite failed to run'}`);
  }
  return { exitCode: r.status ?? 1, failed, files, suiteErrors, logPath: out, command };
}

/**
 * The F gate's "stated reason" check. The repro assertion (shop-mcp test/fiks/check.ts) fails
 * with "<propertyIds> violated (<file>): ...". It fails for the stated reason only when that
 * first line names exactly the target properties: not extra violated properties, and not
 * "target properties were not evaluated", "tool now returns an error", "golden output
 * changed" or UNMATCHED_REQUEST (the recording does not match the code).
 */
export function classifyFailure(message: string, propertyIds: string[]): { ok: boolean; reason: string } {
  if (propertyIds.length === 0) return { ok: false, reason: 'no target property' };
  const first = message.split('\n')[0] ?? '';
  if (/UNMATCHED_REQUEST/.test(first)) {
    return {
      ok: false,
      reason: 'wrong failure reason: UNMATCHED_REQUEST (the recording does not match the code)',
    };
  }
  const m = /^AssertionError: (.+?) violated \(/.exec(first);
  if (!m?.[1]) return { ok: false, reason: `wrong failure reason: ${first.slice(0, 200)}` };
  const named = m[1].split(', ').sort();
  const want = [...propertyIds].sort();
  if (JSON.stringify(named) !== JSON.stringify(want)) {
    return {
      ok: false,
      reason: `wrong failure reason: violated ${named.join(', ')}; expected exactly ${want.join(', ')}`,
    };
  }
  return { ok: true, reason: 'fails for the stated reason' };
}

/**
 * F gate: on the unfixed code the full suite fails in exactly the generated repro test, for
 * the stated reason, with no setup errors, the same way on every run.
 */
export function failGate(repoDir: string, spec: ReproSpec, runs = 3): GateResult {
  let first: SuiteRun | undefined;
  for (let i = 0; i < runs; i++) {
    const r = runSuite(repoDir);
    first ??= r;
    const evidence = {
      command: r.command,
      exitCode: r.exitCode,
      failed: r.failed,
      logPath: r.logPath,
      runs: i + 1,
    };
    const fail = (reason: string): GateResult => ({ gate: 'F', ok: false, reason, evidence });
    if (r.suiteErrors.length) return fail(`setup error: ${r.suiteErrors.join('; ')}`);
    if (r.exitCode === 0 || r.failed.length === 0) return fail('passed on unfixed code');
    const others = r.failed.filter((f) => f.file !== spec.testPath);
    if (others.length)
      return fail(`other tests fail too: ${others.map((f) => `${f.file} > ${f.test}`).join('; ')}`);
    if (r.failed.length !== 1) return fail(`expected 1 failing test, got ${r.failed.length}`);
    const why = classifyFailure(r.failed[0]?.message ?? '', spec.propertyIds);
    if (!why.ok) return fail(why.reason);
    const same =
      JSON.stringify(first.failed.map((f) => f.message)) === JSON.stringify(r.failed.map((f) => f.message));
    if (!same) return fail('non-deterministic: runs disagree');
  }
  const r = first as SuiteRun;
  return {
    gate: 'F',
    ok: true,
    reason: `fails for the stated reason on ${runs}/${runs} runs`,
    evidence: { command: r.command, exitCode: r.exitCode, failed: r.failed, logPath: r.logPath, runs },
  };
}

/** P gate: the repro test ran and passed, and so did the whole suite. */
export function passGate(repoDir: string, spec: ReproSpec): GateResult {
  const r = runSuite(repoDir);
  const evidence = { command: r.command, exitCode: r.exitCode, failed: r.failed, logPath: r.logPath };
  const fail = (reason: string): GateResult => ({ gate: 'P', ok: false, reason, evidence });
  if (r.suiteErrors.length) return fail(`setup error: ${r.suiteErrors.join('; ')}`);
  const repro = r.failed.filter((f) => f.file === spec.testPath);
  if (repro.length) return fail(`repro test still fails: ${repro[0]?.message.split('\n')[0]}`);
  // Deleting, skipping or excluding the repro test is not passing it.
  const ran = r.files.find((f) => f.file === spec.testPath);
  if (!ran || ran.statuses.length === 0 || ran.statuses.some((s) => s !== 'passed')) {
    return fail(
      `repro test did not run and pass (${ran ? ran.statuses.join(',') || 'no tests' : 'missing'})`,
    );
  }
  if (r.exitCode !== 0)
    return fail(`suite fails: ${r.failed.map((f) => `${f.file} > ${f.test}`).join('; ')}`);
  return { gate: 'P', ok: true, reason: 'repro test ran and passed; full suite passes', evidence };
}
