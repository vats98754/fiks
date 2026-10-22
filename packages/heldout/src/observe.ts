// The in-sandbox half of grading (PLAN 3.0 criteria 1, 2, 3 and 5): everything that runs the
// candidate head's code. It runs only inside the grading container, as `fiks grade --observe
// --require-sandbox` through SBX execFiks (the CLI wires the harness and the Domain in), and
// returns observations; the host compares them (grade.ts). Drifted behaviour is vendor v1 behind the
// drift's injector rule (5.8), never a versioned vendor; both chains run under the frozen clock.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Domain, DomainVendor, InjectorRule, UpstreamMiddleware } from '@fiks/interfaces';
import { type DiffInput, resolveArgs } from './inputs.ts';
import type { RenameSpec } from './pkg.ts';
import { renameMiddleware } from './rename.ts';

/** A tool result reduced to what the comparison reads. */
export interface ObservedOutput {
  isError?: boolean;
  structuredContent?: unknown;
}

export interface CallObservation {
  tool: string;
  args: Record<string, unknown>;
  output: ObservedOutput;
  /** truth() on the vendor state after the call. */
  inputValid: boolean;
  /** truth()'s expected output (traffic replay only). */
  expected?: unknown;
}

export interface HiddenRun {
  /** Repo-relative path of the test file. */
  path: string;
  renamed: boolean;
  pass: boolean;
  passed: number;
  failed: number;
  /** Harness-level failure (file did not load, runner crashed, no report). */
  error?: string;
}

export interface TrafficTask {
  id: string;
  calls: { tool: string; args: Record<string, unknown> }[];
}

export type Setting = 'v1' | 'drifted';
export const SETTINGS: readonly Setting[] = ['v1', 'drifted'];

export interface ObserveRequest {
  domain: string;
  /** The candidate head (container path). */
  worktree: string;
  /** The drift's injector rule as a LoadedRule (transformPath = container path). */
  rule: InjectorRule & { transformPath?: string; file?: string };
  /** The Domain's frozen clock. */
  clock: string;
  /** Hidden tests already copied into the worktree (repo-relative). */
  hidden: { path: string; renamed: boolean }[];
  rename: RenameSpec | null;
  inputs: DiffInput[];
  traffic: TrafficTask[];
  callTimeoutMs?: number;
  vitestTimeoutMs?: number;
}

export interface ObserveResult {
  hidden: HiddenRun[];
  differential: Record<Setting, CallObservation[][]>;
  traffic: Record<Setting, CallObservation[][]>;
}

export interface HarnessLike {
  vendor: DomainVendor;
  call(tool: string, args: Record<string, unknown>): Promise<{ result: unknown }>;
  close(): Promise<void>;
}

export interface ObserveDeps {
  domain: Domain;
  /** The CLI harness (vendor -> [injector] -> tap -> server), started on the candidate head. */
  startHarness(opts: { injector?: InjectorRule; clock: Date; shopDir: string }): Promise<HarnessLike>;
  runVitest?: (
    file: string,
    env: Record<string, string>,
    cwd: string,
    timeoutMs: number,
  ) => Promise<HiddenRun>;
}

export function trim(result: unknown): ObservedOutput {
  const r = result as { isError?: unknown; structuredContent?: unknown } | null;
  const out: ObservedOutput = {};
  if (r?.isError === true) out.isError = true;
  if (r?.structuredContent !== undefined && r.structuredContent !== null)
    out.structuredContent = r.structuredContent;
  return out;
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });

/** A fresh upstream chain: vendor v1 [-> injector] [-> rename]. */
async function startChain(
  domain: Domain,
  clock: Date,
  links: UpstreamMiddleware[],
): Promise<{ url: string; close(): Promise<void> }> {
  const vendor = domain.createVendor('original', { version: 'v1', now: () => clock });
  let url = await vendor.listen();
  const closers: (() => Promise<void>)[] = [() => vendor.close()];
  try {
    for (const l of links) {
      const s = await l.start(url);
      closers.unshift(() => s.close());
      url = s.url;
    }
  } catch (e) {
    for (const c of closers) await c();
    throw e;
  }
  return {
    url,
    close: async () => {
      for (const c of closers) await c();
    },
  };
}

interface VitestJson {
  numPassedTests?: number;
  numFailedTests?: number;
  numTotalTests?: number;
  testResults?: { status?: string; message?: string; name?: string }[];
}

/** `vitest run <file>` in the worktree with the given env; the JSON report decides. */
export function vitestRunner(
  file: string,
  env: Record<string, string>,
  cwd: string,
  timeoutMs: number,
): Promise<HiddenRun> {
  const dir = mkdtempSync(join(tmpdir(), 'fiks-hidden-'));
  const report = join(dir, 'report.json');
  return new Promise((resolve) => {
    const child = spawn(
      join(cwd, 'node_modules/.bin/vitest'),
      ['run', file, '--reporter=json', `--outputFile=${report}`],
      { cwd, env, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (b: Buffer) => {
      stderr = (stderr + b.toString('utf8')).slice(-4000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      const run: HiddenRun = { path: file, renamed: false, pass: false, passed: 0, failed: 0 };
      try {
        const j = JSON.parse(readFileSync(report, 'utf8')) as VitestJson;
        run.passed = j.numPassedTests ?? 0;
        run.failed = j.numFailedTests ?? 0;
        const suiteFailed = (j.testResults ?? []).some(
          (t) => t.status === 'failed' && (j.numTotalTests ?? 0) === 0,
        );
        run.pass = code === 0 && run.failed === 0 && run.passed > 0 && !suiteFailed;
        if (!run.pass && run.passed + run.failed === 0) {
          run.error =
            (j.testResults ?? [])
              .map((t) => t.message ?? '')
              .join('\n')
              .slice(0, 1000) || 'no tests ran';
        }
      } catch {
        run.error = `no report (exit ${code}): ${stderr.slice(-600)}`;
      }
      rmSync(dir, { recursive: true, force: true });
      resolve(run);
    });
  });
}

async function hiddenRuns(req: ObserveRequest, deps: ObserveDeps, clock: Date): Promise<HiddenRun[]> {
  const run = deps.runVitest ?? vitestRunner;
  const out: HiddenRun[] = [];
  for (const h of req.hidden) {
    const rename = h.renamed && req.rename ? [renameMiddleware(req.rename)] : [];
    const drifted = await startChain(deps.domain, clock, [deps.domain.injectorHook(req.rule), ...rename]);
    const v1 = await startChain(deps.domain, clock, rename);
    try {
      const env = {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: process.env.HOME ?? '/tmp',
        CI: '1',
        FIKS_HELDOUT_UPSTREAM: drifted.url,
        FIKS_HELDOUT_UPSTREAM_V1: v1.url,
      };
      const r = await run(h.path, env, req.worktree, req.vitestTimeoutMs ?? 180_000);
      out.push({ ...r, path: h.path, renamed: h.renamed });
    } finally {
      await drifted.close();
      await v1.close();
    }
  }
  return out;
}

/** Replays call sequences on fresh vendor state, one harness per setting. */
async function replay(
  req: ObserveRequest,
  deps: ObserveDeps,
  clock: Date,
  sequences: readonly { calls: { tool: string; args: Record<string, unknown> }[] }[],
  withExpected: boolean,
): Promise<Record<Setting, CallObservation[][]>> {
  const out = { v1: [], drifted: [] } as Record<Setting, CallObservation[][]>;
  if (sequences.length === 0) return out;
  const timeout = req.callTimeoutMs ?? 30_000;
  for (const setting of SETTINGS) {
    const h = await deps.startHarness({
      injector: setting === 'drifted' ? req.rule : undefined,
      clock,
      shopDir: req.worktree,
    });
    try {
      for (const seq of sequences) {
        h.vendor.reset();
        const results: unknown[] = [];
        const obs: CallObservation[] = [];
        for (const c of seq.calls) {
          const args = resolveArgs(c.args, results);
          let result: unknown;
          try {
            result = (await withTimeout(h.call(c.tool, args), timeout, `${c.tool}`)).result;
          } catch (e) {
            result = { isError: true, content: [{ type: 'text', text: String(e).slice(0, 300) }] };
          }
          results.push(result);
          const output = trim(result);
          let inputValid = true;
          let expected: unknown;
          try {
            const t = deps.domain.truth({ tool: c.tool, args, output }, h.vendor.state);
            inputValid = t.inputValid;
            expected = t.expected;
          } catch {
            // A tool truth() does not know: compared as valid input.
          }
          obs.push({
            tool: c.tool,
            args,
            output,
            inputValid,
            ...(withExpected ? { expected: expected ?? null } : {}),
          });
        }
        out[setting].push(obs);
      }
    } finally {
      await h.close();
    }
  }
  return out;
}

export async function observe(req: ObserveRequest, deps: ObserveDeps): Promise<ObserveResult> {
  const clock = new Date(req.clock);
  const hidden = await hiddenRuns(req, deps, clock);
  const differential = await replay(req, deps, clock, req.inputs, false);
  const traffic = await replay(req, deps, clock, req.traffic, true);
  return { hidden, differential, traffic };
}

/** Marks the result line on stdout (server and runner output may share the stream). */
export const OBSERVE_SENTINEL = '@@fiks-heldout-observation@@';

export function parseObserveOutput(stdout: string): ObserveResult {
  const line = stdout
    .split('\n')
    .reverse()
    .find((l) => l.startsWith(OBSERVE_SENTINEL));
  if (!line) throw new Error(`observation output has no result line: ${stdout.slice(-500)}`);
  return JSON.parse(line.slice(OBSERVE_SENTINEL.length)) as ObserveResult;
}
