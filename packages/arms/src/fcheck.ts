// REPRO-AGENT's F check (PLAN 5.5): the agent's test file, run 3 times on base in the sandbox
// image, must load without error and report at least one assertion failure in every run.
// A test that fails only with a compile, import or runtime error is not F-valid.
import type { FOnBase } from '@fiks/interfaces';

export interface VitestAssertion {
  fullName?: string;
  status: string;
  failureMessages?: string[];
}

export interface VitestFileResult {
  name: string;
  status: string;
  message?: string;
  assertionResults?: VitestAssertion[];
}

export interface VitestJson {
  testResults?: VitestFileResult[];
}

export interface FRun {
  /** pass: loaded, every test passed; fail: loaded, >= 1 assertion failure; error: anything else. */
  verdict: FOnBase;
  loaded: boolean;
  assertionFailures: number;
  otherFailures: number;
  reason: string;
}

const firstLine = (s: string) => s.split('\n').find((l) => l.trim()) ?? '';

/** An assertion failure (expect/assert/expect.fail), not a thrown TypeError, import error, ... */
export function isAssertionFailure(message: string): boolean {
  return /^\s*AssertionError\b/.test(firstLine(message));
}

/** One F run from vitest's JSON report, for the test file `rel` (repo-relative). */
export function fRunFromVitest(report: VitestJson | undefined, rel: string): FRun {
  const file = report?.testResults?.find((t) => t.name === rel || t.name.endsWith(`/${rel}`));
  if (!file)
    return {
      verdict: 'error',
      loaded: false,
      assertionFailures: 0,
      otherFailures: 0,
      reason: `${rel} was not run`,
    };
  const tests = file.assertionResults ?? [];
  const fileError = (file.message ?? '').trim();
  if (fileError || tests.length === 0) {
    return {
      verdict: 'error',
      loaded: false,
      assertionFailures: 0,
      otherFailures: 0,
      reason: fileError ? `the file did not load: ${firstLine(fileError)}` : 'the file holds no test',
    };
  }
  const failed = tests.filter((t) => t.status === 'failed');
  const assertionFailures = failed.filter((t) => (t.failureMessages ?? []).some(isAssertionFailure)).length;
  const otherFailures = failed.length - assertionFailures;
  if (assertionFailures > 0)
    return {
      verdict: 'fail',
      loaded: true,
      assertionFailures,
      otherFailures,
      reason: `${assertionFailures} assertion failure(s)`,
    };
  if (otherFailures > 0)
    return {
      verdict: 'error',
      loaded: true,
      assertionFailures,
      otherFailures,
      reason: `failed without an assertion failure: ${firstLine(failed[0]?.failureMessages?.[0] ?? '')}`,
    };
  return {
    verdict: 'pass',
    loaded: true,
    assertionFailures: 0,
    otherFailures: 0,
    reason: 'every test passed',
  };
}

/** F holds iff every run is `fail`; otherwise `error` if any run errored, else `pass`. */
export function fOnBaseOf(runs: FRun[]): FOnBase {
  if (runs.length > 0 && runs.every((r) => r.verdict === 'fail')) return 'fail';
  if (runs.some((r) => r.verdict === 'error' || r.verdict === 'fail')) return 'error';
  return 'pass';
}

/**
 * Inlined recording heuristic: the test reads no recording file but carries recorded HTTP
 * exchanges in its source (a request/response pair literal).
 */
export function inlinesRecording(source: string, recordingsRead: string[]): boolean {
  if (recordingsRead.length > 0) return false;
  return /["']?request["']?\s*:\s*\{/.test(source) && /["']?response["']?\s*:\s*\{/.test(source);
}
