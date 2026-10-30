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
import { createSandbox } from './sandbox.ts';
import { hasStale, reproVerdict, runSuiteIn, suiteVerdict } from './suite.ts';
import {
  type CallVerdict,
  EVAL_SCHEMA,
  type ExpArm,
  type ExpDrift,
  type ExpEvalRecord,
  type ExpRunRecord,
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
    error: null,
  };
  let sb: Awaited<ReturnType<typeof createSandbox>> | undefined;
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
    const head = record.head;
    const d = diffStats(dir, base, head, ['src']);
    record.changedLines = {
      files: d.files.length,
      insertions: d.insertions,
      deletions: d.deletions,
      lines: d.insertions + d.deletions,
    };
    sb = await createSandbox(kind, dir, { shopRepo });

    // Live check first: it runs the head's server as committed (no repro files involved).
    const drift = await sb.scenario(t.drift);
    const v1 = await sb.scenario('v1-all');
    record.live = {
      drift: { ok: driftLiveOk(drift.calls), calls: drift.calls },
      v1: { ok: v1LiveOk(v1.calls), calls: v1.calls },
    };
    record.liveCheck = record.live.drift.ok && record.live.v1.ok;

    // Held-out repro: generated from the committed (never injected) pilot trace, as in repair.
    const pilot = pilotTrace(t.drift);
    const spec = generateRepro(pilot.trace, pilot.file, dir);
    const reproCommit = commitPaths(
      dir,
      [spec.testPath, spec.tracePath],
      `held-out repro ${t.drift} (exp-eval)`,
    );
    let run = await runSuiteIn(sb);
    if (hasStale(run)) {
      const rr = await sb.rerecord(reproCommit, profileOf(pilot.trace));
      record.heldOutRepro.rerecorded = rr.files;
      if (!rr.ok) throw new Error(`re-recording for the held-out repro failed: ${rr.output.slice(-800)}`);
      run = await runSuiteIn(sb);
    }
    const v = reproVerdict(run, spec.testPath);
    record.heldOutRepro = {
      ...record.heldOutRepro,
      ok: v.ok,
      reason: v.reason,
      suiteGreen: suiteVerdict(run).ok,
    };
  } catch (e) {
    record.error = e instanceof Error ? e.message.slice(0, 1500) : String(e);
  } finally {
    await sb?.cleanup().catch(() => undefined);
    checkout.remove();
  }
  record.evaluatedAt = new Date().toISOString();
  const problems = validateEvalRecord(record);
  if (problems.length) throw new Error(`exp eval record invalid: ${problems.join(', ')}`);
  return record;
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
  const ev = await evaluateHead(
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
  const ev = await evaluateHead({ drift, runId: null, control, arm: null, commitish: 'seed-v1' }, o);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'eval.json'), `${JSON.stringify(ev, null, 2)}\n`);
  return ev;
}

/** Whether a control came out as it must: oracle = all three outcomes true, seed = both false. */
export function controlPasses(ev: ExpEvalRecord): boolean {
  if (ev.error) return false;
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
