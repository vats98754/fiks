// accept(patch, testSet) for H2 (PLAN 3.2): test set T accepts a patch iff typecheck + lint +
// existing suite + stored traces at base + T all pass, in the grading container.
//
// Re-record rule (identical for every T): per patch, once, CORE `rerecord-head` runs on the patched
// head through the drift's injector chain (profile = domain, base, rule id, rule hash) over the
// union of recordings any test set or stored trace replays: the suite's stale fixtures and traces
// (step 1 of rerecord-head) plus an overlay re-recording of every recording file a T file reads
// (found by an fs-read log of each T run on base; this includes .alerts/<id>.json and the fiks
// repro JSON). Base checks then run once; then only each T's files run, every T over the same
// overlay. A recording inlined in a test file is not re-recorded: the test counts as it behaves and
// is flagged inlineRecording. A test that errors at harness level (does not load, no test ran)
// makes T fail for every patch. T = empty reduces the rule to the base checks.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { RerecordLog } from '@fiks/interfaces';
import { diffSha } from './diff.ts';
import { type Head, prepareHead, removeFrom, writeInto } from './head.ts';
import { type LoadedPackage, profileOf } from './pkg.ts';
import { rerecordIn, restoreOverlay } from './rerecord.ts';
import {
  FS_READ_LOG_PRELOAD_IN_TOOLS,
  type GradingSandbox,
  readIn,
  ruleMount,
  run,
  type SandboxFactory,
  SCRATCH,
  WORKDIR,
} from './sandbox.ts';

export type TestSetKind = 'fiks' | 'agent-final' | 'agent-first' | 'empty';

export interface TestSetFile {
  /** Repo-relative. */
  path: string;
  bytes: string;
}

export interface TestSet {
  id: string;
  kind: TestSetKind;
  files: TestSetFile[];
}

export interface CheckResult {
  pass: boolean;
  exit: number;
  /** Tail of the output, for the record. */
  log: string;
}

export interface FileRun {
  path: string;
  pass: boolean;
  passed: number;
  failed: number;
  error?: string;
}

export interface TRun {
  pass: boolean;
  files: FileRun[];
}

/** How a test set behaves on base (computed once per drift, before any patch). */
export interface SetProfile {
  setId: string;
  /** Recording files the set's tests read on base (repo-relative; fs-read log). */
  recordingsRead: string[];
  /** The ones accept() overlays (T-owned files and .alerts/; never files tracked at base). */
  overlaid: string[];
  inlineRecording: boolean;
  /** Another set wrote different bytes at one of this set's recording paths. */
  recordingConflict: boolean;
  onBase: TRun;
}

export interface BaseChecks {
  typecheck: CheckResult;
  lint: CheckResult;
  suite: CheckResult;
  traces: CheckResult;
}

export interface AcceptCell {
  patchId: string;
  setId: string;
  kind: TestSetKind;
  accepted: boolean;
  t: TRun | null;
  inlineRecording: boolean;
  recordingsRead: string[];
}

export interface AcceptPatchResult {
  patchId: string;
  diffSha: string;
  headCommit: string;
  applied: boolean;
  rerecord: { exit: number; ok: boolean; log: RerecordLog | null } | null;
  base: BaseChecks | null;
  baseOk: boolean;
  cells: AcceptCell[];
}

export interface AcceptEnv {
  sandbox: SandboxFactory;
  repoDir: string;
  /** The drift's frozen trace, written read-only at `.alerts/<id>.json` for every run. */
  alert: { id: string; bytes: string };
  /** Test file of the stored traces in the target repo's suite (reported as `traces`). */
  tracesTest?: string;
  log?: (line: string) => void;
}

export const DEFAULT_TRACES_TEST = 'test/fiks/traces.test.ts';
const alertPath = (id: string) => `.alerts/${id}.json`;

const isTestFile = (p: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);
const isRecordingJson = (text: string) => {
  try {
    const r = JSON.parse(text) as { tool?: unknown; http?: unknown };
    return typeof r.tool === 'string' && Array.isArray(r.http);
  } catch {
    return false;
  }
};

/**
 * A recording written into the test source itself (request/response exchanges as literals), which
 * no re-record can reach.
 */
export function hasInlineRecording(source: string): boolean {
  return (
    /["']?request["']?\s*:\s*\{/.test(source) &&
    /["']?response["']?\s*:\s*\{/.test(source) &&
    /["']?(?:status|method)["']?\s*:/.test(source)
  );
}

interface VitestReport {
  numPassedTests?: number;
  numFailedTests?: number;
  testResults?: {
    name: string;
    status?: string;
    message?: string;
    assertionResults?: { status?: string }[];
  }[];
}

/** Per-file results of a vitest JSON report (file paths made repo-relative). */
export function fileRuns(report: VitestReport, expected: readonly string[]): FileRun[] {
  const byPath = new Map<string, FileRun>();
  for (const t of report.testResults ?? []) {
    const rel = t.name.startsWith(`${WORKDIR}/`) ? t.name.slice(WORKDIR.length + 1) : t.name;
    const passed = (t.assertionResults ?? []).filter((a) => a.status === 'passed').length;
    const failed = (t.assertionResults ?? []).filter((a) => a.status === 'failed').length;
    const loaded = (t.assertionResults ?? []).length > 0;
    byPath.set(rel, {
      path: rel,
      pass: t.status === 'passed' && failed === 0 && passed > 0,
      passed,
      failed,
      ...(loaded ? {} : { error: (t.message ?? 'no test ran').slice(0, 600) }),
    });
  }
  // A file that produced no result at all failed at harness level.
  for (const p of expected) {
    if (!byPath.has(p)) byPath.set(p, { path: p, pass: false, passed: 0, failed: 0, error: 'no result' });
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function vitestIn(
  sb: GradingSandbox,
  files: readonly string[],
  tag: string,
  env: Record<string, string> = {},
): Promise<{ exit: number; report: VitestReport | null; out: string }> {
  const out = `${SCRATCH}/vitest-${tag}.json`;
  const r = await run(
    sb,
    'node_modules/.bin/vitest',
    ['run', ...files, '--reporter=json', `--outputFile=${out}`],
    { env, timeoutMs: 20 * 60_000 },
  );
  const text = await readIn(sb, out);
  let report: VitestReport | null = null;
  try {
    report = text ? (JSON.parse(text) as VitestReport) : null;
  } catch {
    report = null;
  }
  return { exit: r.code, report, out: `${r.stdout}\n${r.stderr}`.slice(-2000) };
}

async function check(sb: GradingSandbox, script: string): Promise<CheckResult> {
  const r = await run(sb, 'pnpm', ['run', '--silent', script], { timeoutMs: 15 * 60_000 });
  return { pass: r.code === 0, exit: r.code, log: `${r.stdout}\n${r.stderr}`.slice(-1500) };
}

/** The accept matrix of one drift over fixed test sets; base profiles and patches are cached. */
export class AcceptMatrix {
  private profilesP?: Promise<SetProfile[]>;
  private readonly done = new Map<string, Promise<AcceptPatchResult>>();
  readonly sets: TestSet[];

  constructor(
    readonly pkg: LoadedPackage,
    readonly env: AcceptEnv,
    sets: readonly TestSet[],
  ) {
    const ids = new Set<string>();
    for (const s of sets) {
      if (ids.has(s.id)) throw new Error(`duplicate test set id ${s.id}`);
      ids.add(s.id);
      if (s.kind === 'empty' && s.files.length) throw new Error(`test set ${s.id} is 'empty' but has files`);
    }
    this.sets = [...sets];
  }

  private say(line: string) {
    this.env.log?.(`[accept ${this.pkg.pkg.id}] ${line}`);
  }

  private testFiles(s: TestSet): string[] {
    return s.files.filter((f) => isTestFile(f.path)).map((f) => f.path);
  }

  private open(head: Head) {
    const rule = ruleMount(this.pkg.rule);
    return { rule, sb: this.env.sandbox(head.dir, [rule.mount]) };
  }

  /** Each set run on base under the fs-read log: what it reads, how it behaves (cached). */
  profiles(): Promise<SetProfile[]> {
    this.profilesP ??= this.computeProfiles();
    return this.profilesP;
  }

  private async computeProfiles(): Promise<SetProfile[]> {
    const head = prepareHead(this.env.repoDir, this.pkg.pkg.base, '');
    const { rule, sb: sbP } = this.open(head);
    const sb = await sbP;
    const alert = alertPath(this.env.alert.id);
    const out: SetProfile[] = [];
    try {
      await run(sb, 'mkdir', ['-p', SCRATCH]);
      writeInto(head.dir, [{ path: alert, bytes: this.env.alert.bytes }]);
      for (const [i, s] of this.sets.entries()) {
        const tests = this.testFiles(s);
        const inline = s.files.filter((f) => isTestFile(f.path)).some((f) => hasInlineRecording(f.bytes));
        if (tests.length === 0) {
          out.push({
            setId: s.id,
            recordingsRead: [],
            overlaid: [],
            inlineRecording: false,
            recordingConflict: false,
            onBase: { pass: true, files: [] },
          });
          continue;
        }
        writeInto(head.dir, s.files);
        const log = `${SCRATCH}/reads-${i}.log`;
        const v = await vitestIn(sb, tests, `base-${i}`, {
          NODE_OPTIONS: `--require ${FS_READ_LOG_PRELOAD_IN_TOOLS}`,
          FIKS_FS_READ_LOG: log,
        });
        const reads = ((await readIn(sb, log)) ?? '')
          .split('\n')
          .filter((l) => l.startsWith(`${WORKDIR}/`))
          .map((l) => l.slice(WORKDIR.length + 1))
          .filter(
            (p) => p.endsWith('.json') && !p.startsWith('node_modules/') && !p.endsWith('.rerecorded.json'),
          );
        const recordingsRead = [...new Set(reads)]
          .filter(
            (p) => existsSync(join(head.dir, p)) && isRecordingJson(readFileSync(join(head.dir, p), 'utf8')),
          )
          .sort();
        const owned = new Set([alert, ...s.files.map((f) => f.path)]);
        out.push({
          setId: s.id,
          recordingsRead,
          overlaid: recordingsRead.filter((p) => owned.has(p)),
          inlineRecording: inline,
          recordingConflict: false,
          onBase: {
            pass: v.report ? fileRuns(v.report, tests).every((f) => f.pass) : false,
            files: v.report ? fileRuns(v.report, tests) : [],
          },
        });
        removeFrom(
          head.dir,
          s.files.map((f) => f.path),
        );
      }
    } finally {
      await sb.cleanup();
      head.remove();
      rmRule(rule.mount.source);
    }
    // Two sets with different bytes at one overlaid path cannot share one overlay.
    const owner = new Map<string, string>();
    for (const p of out) {
      const set = this.sets.find((s) => s.id === p.setId) as TestSet;
      for (const path of p.overlaid) {
        const bytes = path === alert ? this.env.alert.bytes : set.files.find((f) => f.path === path)?.bytes;
        const prev = owner.get(path);
        if (prev !== undefined && prev !== bytes) p.recordingConflict = true;
        else if (bytes !== undefined) owner.set(path, bytes);
      }
    }
    this.say(`profiled ${out.length} test set(s) on base`);
    return out;
  }

  accept(patch: { id: string; diff: string }): Promise<AcceptPatchResult> {
    const key = `${patch.id}\u0000${diffSha(patch.diff)}`;
    let p = this.done.get(key);
    if (!p) {
      p = this.compute(patch);
      this.done.set(key, p);
    }
    return p;
  }

  private async compute(patch: { id: string; diff: string }): Promise<AcceptPatchResult> {
    const profiles = await this.profiles();
    const head = prepareHead(this.env.repoDir, this.pkg.pkg.base, patch.diff);
    const result: AcceptPatchResult = {
      patchId: patch.id,
      diffSha: diffSha(patch.diff),
      headCommit: head.headCommit,
      applied: head.applied,
      rerecord: null,
      base: null,
      baseOk: false,
      cells: [],
    };
    const reject = (t: TRun | null) =>
      this.sets.map((s) => {
        const prof = profiles.find((p) => p.setId === s.id) as SetProfile;
        return {
          patchId: patch.id,
          setId: s.id,
          kind: s.kind,
          accepted: false,
          t,
          inlineRecording: prof.inlineRecording,
          recordingsRead: prof.recordingsRead,
        };
      });
    if (!head.applied) {
      head.remove();
      result.cells = reject(null);
      return result;
    }
    const { rule, sb: sbP } = this.open(head);
    const sb = await sbP;
    try {
      await run(sb, 'mkdir', ['-p', SCRATCH]);
      // Base checks that read no recording run on the clean head (nothing fiks placed is linted).
      const typecheck = await check(sb, 'typecheck');
      const lint = await check(sb, 'lint');
      // The union of overlaid recordings, materialized once, then one re-record for every T.
      const alert = alertPath(this.env.alert.id);
      const materialized = new Map<string, string>([[alert, this.env.alert.bytes]]);
      for (const prof of profiles) {
        const set = this.sets.find((s) => s.id === prof.setId) as TestSet;
        for (const path of prof.overlaid) {
          const f = set.files.find((x) => x.path === path);
          if (f && !materialized.has(path)) materialized.set(path, f.bytes);
        }
      }
      writeInto(
        head.dir,
        [...materialized].map(([path, bytes]) => ({ path, bytes })),
      );
      const overlay = [...new Set(profiles.flatMap((p) => p.overlaid))].sort();
      const rr = await rerecordIn(sb, {
        profile: profileOf(this.pkg),
        rulePath: rule.rulePath,
        fromCommit: head.baseCommit,
        check: 'accept',
        recordings: overlay,
      });
      result.rerecord = { exit: rr.exit, ok: rr.ok, log: rr.log };
      // Existing suite and stored traces: one vitest run, split by file.
      const tracesTest = this.env.tracesTest ?? DEFAULT_TRACES_TEST;
      const suiteRun = await vitestIn(sb, [], 'suite');
      const runs = suiteRun.report ? fileRuns(suiteRun.report, []) : [];
      const tr = runs.filter((f) => f.path === tracesTest);
      const rest = runs.filter((f) => f.path !== tracesTest);
      const failedNames = (xs: FileRun[]) => xs.filter((f) => !f.pass).map((f) => f.path);
      result.base = {
        typecheck,
        lint,
        suite: {
          pass: !!suiteRun.report && rest.length > 0 && rest.every((f) => f.pass),
          exit: suiteRun.exit,
          log: suiteRun.report ? `failed: ${failedNames(rest).join(', ') || 'none'}` : suiteRun.out,
        },
        traces: {
          pass: !!suiteRun.report && tr.every((f) => f.pass),
          exit: suiteRun.exit,
          log: `failed: ${failedNames(tr).join(', ') || 'none'}`,
        },
      };
      result.baseOk =
        typecheck.pass && lint.pass && rr.ok && result.base.suite.pass && result.base.traces.pass;
      // Each test set's files, run once each, over the same overlay.
      for (const [i, s] of this.sets.entries()) {
        const prof = profiles.find((p) => p.setId === s.id) as SetProfile;
        const tests = this.testFiles(s);
        let t: TRun;
        if (tests.length === 0) t = { pass: true, files: [] };
        else {
          const own = s.files.filter((f) => !materialized.has(f.path));
          writeInto(head.dir, own);
          const v = await vitestIn(sb, tests, `t-${i}`);
          const files = v.report
            ? fileRuns(v.report, tests)
            : tests.map((p) => ({ path: p, pass: false, passed: 0, failed: 0, error: v.out }));
          t = { pass: files.length > 0 && files.every((f) => f.pass), files };
          removeFrom(
            head.dir,
            own.map((f) => f.path),
          );
        }
        result.cells.push({
          patchId: patch.id,
          setId: s.id,
          kind: s.kind,
          accepted: result.baseOk && t.pass,
          t,
          inlineRecording: prof.inlineRecording,
          recordingsRead: prof.recordingsRead,
        });
      }
      await restoreOverlay(sb, rr.manifest);
    } finally {
      await sb.cleanup();
      head.remove();
      rmRule(rule.mount.source);
    }
    this.say(
      `${patch.id}: base ${result.baseOk ? 'ok' : 'FAIL'}; accepted by ${result.cells.filter((c) => c.accepted).length}/${result.cells.length}`,
    );
    return result;
  }
}

const rmRule = (dir: string) => rmSync(dir, { recursive: true, force: true });

/** One-shot form: accept(patch, test sets) for one drift. */
export async function accept(
  patch: { id: string; diff: string },
  sets: readonly TestSet[],
  pkg: LoadedPackage,
  env: AcceptEnv,
): Promise<AcceptPatchResult> {
  return new AcceptMatrix(pkg, env, sets).accept(patch);
}
