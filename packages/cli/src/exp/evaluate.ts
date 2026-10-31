// Deterministic outcomes of a head (paper/EXP-PLAN.md E-A outcomes 2-4), computed by `exp-eval` in a
// fresh checkout, never by the run itself:
//   - held-out repro: the fiks repro test for the drift, generated exactly as in repair from the
//     committed pilot trace, run on the head (after fiks re-records any recording the head's
//     requests no longer match). For ALERT the agent never saw it.
//   - live check: the drift's scenario against vendor v2 (only that drift active) has every call
//     verified, and v1-all against vendor v1 has nothing violated and every call verified except
//     the by-design unverifiable one (a missing product).
//   - changed lines: git diff --numstat seed-v1..head -- src.
// Controls: the D1-D5 oracle patches on seed-v1 (all outcomes true) and seed-v1 unpatched (held-out
// repro and live check false).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateRepro, resolveLocalRef } from '@fiks/repro';
import { ROOT, shopDir, WORK_DIR } from '../paths.ts';
import { changedSince, commitPaths, createCheckout, diffStats, git } from './checkout.ts';
import { oraclePatch, pilotTrace } from './drifts.ts';
import { profileOf } from './repair-run.ts';
import { createSandbox, type ExpSandbox, SandboxInfraError } from './sandbox.ts';
import { hasStale, reproVerdict, runSuiteIn, suiteVerdict } from './suite.ts';
import {
  type CallVerdict,
  EVAL_SCHEMA,
  type ExpArm,
  type ExpDrift,
  type ExpEvalRecord,
  type ExpRunRecord,
  type HeadStage,
  type SandboxKind,
  validateEvalRecord,
  validateRunRecord,
} from './types.ts';

/** v1-all calls that are unverifiable by contract design on every shop-mcp version (seed-v1 too). */
export const V1_UNVERIFIABLE_BY_DESIGN = new Set(['get_product {"id":"p-0000"}']);
const callKey = (c: CallVerdict) => `${c.tool} ${JSON.stringify(c.args)}`;

export function driftLiveOk(calls: CallVerdict[]): boolean {
  return calls.length > 0 && calls.every((c) => c.verdict === 'verified');
}

export function v1LiveOk(calls: CallVerdict[]): boolean {
  return (
    calls.length > 0 &&
    calls.every(
      (c) =>
        c.verdict === 'verified' ||
        (c.verdict === 'unverifiable' && V1_UNVERIFIABLE_BY_DESIGN.has(callKey(c))),
    )
  );
}

export interface EvalOptions {
  sandbox?: SandboxKind;
  shopRepo?: string;
  workDir?: string;
  /** Infra-error retries per eval (EXP-PLAN stop rules: 3). */
  maxInfraRetries?: number;
  /** Test hook: makes the sandbox for a checkout (default createSandbox). */
  sandboxFactory?: (kind: SandboxKind, worktree: string, shopRepo: string) => Promise<ExpSandbox>;
}

interface HeadTarget {
  drift: ExpDrift;
  runId: string | null;
  control: 'oracle' | 'seed' | null;
  arm: ExpArm | null;
  /** A commit or ref in the shop-mcp clone. */
  commitish: string;
}

let evalN = 0;

/** A stage could not be evaluated for a reason outside the head. */
class EvalInfraError extends Error {}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 1500);

/** Host resource failures (ports, file descriptors, disk) that no head can cause by crashing. */
const HOST_INFRA_CODES = new Set(['EADDRINUSE', 'EADDRNOTAVAIL', 'EMFILE', 'ENFILE', 'ENOSPC']);

/**
 * Whether an error raised while running the head is the sandbox's fault. Host: only a host resource
 * failure (a port in use, out of file descriptors or disk) or a failed spawn of a program is; an MCP
 * error (the head's server closed the connection, exited, timed out) or a broken pipe to a server
 * that died (EPIPE, ECONNRESET) is the head's. Docker: a SandboxInfraError (docker exit 125-127)
 * is; any other error is the head's unless the container is gone (checked by the caller).
 */
export function isInfraError(e: unknown): boolean {
  if (e instanceof SandboxInfraError || e instanceof EvalInfraError) return true;
  const err = e as { code?: unknown; syscall?: unknown } | null;
  if (typeof err?.code !== 'string') return false;
  if (HOST_INFRA_CODES.has(err.code)) return true;
  return err.code === 'ENOENT' && typeof err.syscall === 'string' && err.syscall.startsWith('spawn');
}

async function evaluateHead(t: HeadTarget, o: EvalOptions): Promise<ExpEvalRecord> {
  const shopRepo = o.shopRepo ?? shopDir();
  const kind = o.sandbox ?? 'host';
  const base = resolveLocalRef(shopRepo, 'seed-v1');
  const name = `${t.runId ?? `${t.control}-${t.drift}`}-eval-${process.pid}-${Date.now()}-${++evalN}`;
  const dir = join(o.workDir ?? join(WORK_DIR, 'exp'), name);
  const checkout = createCheckout(shopRepo, t.commitish, dir, { linkNodeModules: kind === 'host' });
  const record: ExpEvalRecord = {
    schema: EVAL_SCHEMA,
    runId: t.runId,
    control: t.control,
    arm: t.arm,
    drift: t.drift,
    head: checkout.baseCommit,
    base,
    heldOutRepro: { ok: false, reason: 'not run', rerecorded: [], suiteGreen: false },
    live: { drift: { ok: false, calls: [] }, v1: { ok: false, calls: [] } },
    liveCheck: false,
    changedLines: { files: 0, insertions: 0, deletions: 0, lines: 0 },
    sandbox: kind,
    evaluatedAt: new Date().toISOString(),
    headErrors: [],
    infraError: null,
    infraRetries: 0,
  };
  let sb: ExpSandbox | undefined;
  const newSandbox = async () => {
    try {
      return await (o.sandboxFactory
        ? o.sandboxFactory(kind, dir, shopRepo)
        : createSandbox(kind, dir, { shopRepo }));
    } catch (e) {
      throw new EvalInfraError(`sandbox did not start: ${msgOf(e)}`);
    }
  };
  /**
   * Runs one stage of the head. A failure is the head's (recorded in headErrors; the stage's outcome
   * stays false) unless it is an infra error. In docker a container that stopped during the stage is
   * the head's doing when a fresh container starts and runs on the same checkout (it replaces the
   * old one); when none starts, Docker failed and the eval is infra.
   */
  const stage = async (name: HeadStage, fn: (sb: ExpSandbox) => Promise<void>) => {
    let err: unknown;
    try {
      await fn(sb as ExpSandbox);
    } catch (e) {
      if (isInfraError(e)) throw e;
      err = e;
    }
    if (!(await (sb as ExpSandbox).healthy())) {
      await (sb as ExpSandbox).cleanup().catch(() => undefined);
      sb = undefined;
      sb = await newSandbox();
      if (!(await sb.healthy())) throw new EvalInfraError('a fresh sandbox container does not run commands');
      err ??= new Error('the sandbox container stopped while the head ran');
    }
    if (err !== undefined) record.headErrors.push({ stage: name, message: msgOf(err) });
  };
  try {
    // Setup: nothing of the head runs yet, so every failure here is infra.
    try {
      if (t.control === 'oracle') {
        // Positive control: the test-only oracle fix on seed-v1 (git apply on the host: a patch file
        // fiks owns, applied to a fresh checkout).
        execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'apply', oraclePatch(t.drift)], {
          cwd: dir,
          stdio: 'pipe',
        });
        record.head = commitPaths(
          dir,
          changedSince(dir, checkout.baseCommit),
          `oracle fix ${t.drift} (control)`,
        );
      }
      const d = diffStats(dir, base, record.head, ['src']);
      record.changedLines = {
        files: d.files.length,
        insertions: d.insertions,
        deletions: d.deletions,
        lines: d.insertions + d.deletions,
      };
    } catch (e) {
      throw new EvalInfraError(`eval setup failed: ${msgOf(e)}`);
    }
    sb = await newSandbox();

    // Live check first: it runs the head's server as committed (no repro files involved). A head
    // whose server crashes, exits or hangs fails the scenario: that outcome is false, not excluded.
    await stage('live.drift', async (s) => {
      const calls = (await s.scenario(t.drift)).calls;
      record.live.drift = { ok: driftLiveOk(calls), calls };
    });
    await stage('live.v1', async (s) => {
      const calls = (await s.scenario('v1-all')).calls;
      record.live.v1 = { ok: v1LiveOk(calls), calls };
    });
    record.liveCheck = record.live.drift.ok && record.live.v1.ok;

    // Held-out repro: generated from the committed (never injected) pilot trace, as in repair.
    // Writing the test files is fiks's step (infra if it fails); running them is the head's.
    let spec: ReturnType<typeof generateRepro>;
    let reproCommit: string;
    try {
      const pilot = pilotTrace(t.drift);
      spec = generateRepro(pilot.trace, pilot.file, dir);
      reproCommit = commitPaths(dir, [spec.testPath, spec.tracePath], `held-out repro ${t.drift} (exp-eval)`);
    } catch (e) {
      throw new EvalInfraError(`writing the held-out repro failed: ${msgOf(e)}`);
    }
    await stage('heldOutRepro', async (s) => {
      let run = await runSuiteIn(s);
      if (hasStale(run)) {
        const rr = await s.rerecord(reproCommit, profileOf(pilotTrace(t.drift).trace));
        record.heldOutRepro.rerecorded = rr.files;
        if (!rr.ok) {
          record.heldOutRepro.reason = `re-recording failed on the head: ${rr.output.slice(-500)}`;
          throw new Error(`re-recording for the held-out repro failed: ${rr.output.slice(-800)}`);
        }
        run = await runSuiteIn(s);
      }
      const v = reproVerdict(run, spec.testPath);
      record.heldOutRepro = {
        ...record.heldOutRepro,
        ok: v.ok,
        reason: v.reason,
        suiteGreen: suiteVerdict(run).ok,
      };
      // Test files that cannot even load (the head throws at import, say) are the head's failure.
      if (run.suiteErrors.length)
        throw new Error(`the held-out suite could not run on the head: ${run.suiteErrors.join('; ')}`);
    });
    const repErr = record.headErrors.find((e) => e.stage === 'heldOutRepro');
    if (repErr) {
      record.heldOutRepro.ok = false;
      record.heldOutRepro.suiteGreen = false;
      if (record.heldOutRepro.reason === 'not run' || record.heldOutRepro.reason.startsWith('repro test ran'))
        record.heldOutRepro.reason = `head failed the held-out suite: ${repErr.message.slice(0, 500)}`;
    }
    for (const e of record.headErrors) {
      if (e.stage === 'live.drift') record.live.drift.ok = false;
      if (e.stage === 'live.v1') record.live.v1.ok = false;
    }
    record.liveCheck = record.live.drift.ok && record.live.v1.ok;
  } catch (e) {
    // Only infra reaches here (stage() records the head's own failures). No outcome is claimed.
    record.infraError = msgOf(e);
    record.liveCheck = false;
    record.live.drift.ok = false;
    record.live.v1.ok = false;
    record.heldOutRepro.ok = false;
    record.heldOutRepro.suiteGreen = false;
  } finally {
    await sb?.cleanup().catch(() => undefined);
    checkout.remove();
  }
  record.evaluatedAt = new Date().toISOString();
  const problems = validateEvalRecord(record);
  if (problems.length) throw new Error(`exp eval record invalid: ${problems.join(', ')}`);
  return record;
}

/** Re-evaluates while the eval ends in an infra error, up to `maxInfraRetries` more times. */
async function evaluateWithRetries(t: HeadTarget, o: EvalOptions): Promise<ExpEvalRecord> {
  const max = o.maxInfraRetries ?? 3;
  let ev = await evaluateHead(t, o);
  let retries = 0;
  while (ev.infraError !== null && retries < max) {
    retries++;
    ev = await evaluateHead(t, o);
  }
  return { ...ev, infraRetries: retries };
}

export function readRunRecord(runDir: string): ExpRunRecord {
  const rec = JSON.parse(readFileSync(join(runDir, 'record.json'), 'utf8')) as ExpRunRecord;
  const problems = validateRunRecord(rec);
  if (problems.length)
    throw new Error(`${runDir}/record.json is not a valid run record: ${problems.join(', ')}`);
  return rec;
}

/** Evaluates one run directory and writes eval.json next to its record.json. */
export async function evaluateRun(runDir: string, o: EvalOptions = {}): Promise<ExpEvalRecord | null> {
  const rec = readRunRecord(runDir);
  if (!rec.head) return null; // an infra error or setup failure left no head: nothing to evaluate
  const shopRepo = o.shopRepo ?? shopDir();
  // The head is kept as a local ref; fall back to the sha when the ref was pruned.
  let commitish = rec.head.ref;
  try {
    git(shopRepo, ['rev-parse', '--verify', '--quiet', `${rec.head.ref}^{commit}`]);
  } catch {
    commitish = rec.head.sha;
  }
  const ev = await evaluateWithRetries(
    { drift: rec.drift, runId: rec.runId, control: null, arm: rec.arm, commitish },
    { ...o, sandbox: o.sandbox ?? rec.sandbox, shopRepo },
  );
  if (ev.head !== rec.head.sha)
    throw new Error(`${runDir}: ${rec.head.ref} is ${ev.head}, the record says ${rec.head.sha}`);
  writeFileSync(join(runDir, 'eval.json'), `${JSON.stringify(ev, null, 2)}\n`);
  return ev;
}

/** Positive (oracle) or negative (seed) control for one drift; writes eval.json under `out`. */
export async function evaluateControl(
  control: 'oracle' | 'seed',
  drift: ExpDrift,
  out: string,
  o: EvalOptions = {},
): Promise<ExpEvalRecord> {
  const ev = await evaluateWithRetries({ drift, runId: null, control, arm: null, commitish: 'seed-v1' }, o);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'eval.json'), `${JSON.stringify(ev, null, 2)}\n`);
  return ev;
}

/** Whether a control came out as it must: oracle = all three outcomes true, seed = both false. */
export function controlPasses(ev: ExpEvalRecord): boolean {
  if (ev.infraError || ev.headErrors.length) return false;
  if (ev.control === 'oracle') return ev.heldOutRepro.ok && ev.live.drift.ok && ev.live.v1.ok;
  if (ev.control === 'seed') return !ev.heldOutRepro.ok && !ev.liveCheck;
  return false;
}

/** Run directories (holding record.json) under `root`, sorted. */
export function findRunDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 4 || !existsSync(d)) return;
    if (existsSync(join(d, 'record.json'))) {
      out.push(d);
      return;
    }
    for (const e of readdirSync(d, { withFileTypes: true }))
      if (e.isDirectory()) walk(join(d, e.name), depth + 1);
  };
  walk(root, 0);
  return out.sort();
}

export const DEFAULT_CONTROLS_DIR = join(ROOT, 'bench/results/exp/controls');
