// One exp repair run (paper/EXP-PLAN.md E-A, E-C): base shop-mcp `seed-v1`, the committed pilot
// trace for the drift, one agent attempt with the arm's prompt, the arm's gates, and the head kept
// as a local ref. Never pushes, never opens a PR, never retries the agent on a gate failure.
//
//   FIKS:   pilot prompt (buildPrompt), repro test committed and shown; gates = guard, repro (P),
//           suite (contract suite + stored traces), typecheck, lint, integrity.
//   NOHINT: as FIKS with buildNoHintPrompt.
//   ALERT:  buildAlertPrompt (receipt text, violated properties, raw trace); no repro test is
//           generated, shown or gated; gates = guard, suite, typecheck, lint, integrity.
//
// Infrastructure errors (runner infra_error, Docker failures, exceptions) restart the run from a
// fresh checkout up to `maxInfraRetries` times; then the record carries `infraError` and counts
// for nothing but the infra-error tally.
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findContract, SHOP_CONTRACTS } from '@fiks/contracts';
import type { RerecordProfile } from '@fiks/interfaces';
import { receiptText } from '@fiks/proxy';
import {
  buildPrompt,
  candidateDiff,
  createAgentSdkRunner,
  loadStubScript,
  REPAIR_ALLOWED,
  type RepairRunner,
  type RunnerResult,
  type StubScript,
  stubRunner,
} from '@fiks/repair';
import { type GateResult, generateRepro, resolveLocalRef, type Trace } from '@fiks/repro';
import { ROOT, shopDir, WORK_DIR } from '../paths.ts';
import {
  changedSince,
  commitPaths,
  createCheckout,
  diffStats,
  type ExpCheckout,
  expRef,
  git,
  keepHead,
  revertFiles,
} from './checkout.ts';
import { pilotTrace } from './drifts.ts';
import {
  commandsFromLog,
  injectionOracles,
  type PreparedInjection,
  prepareInjection,
  withCanary,
} from './inject.ts';
import { buildAlertPrompt, buildNoHintPrompt } from './prompts.ts';
import { CONTAINER_SHOP, createSandbox, type ExpSandbox } from './sandbox.ts';
import { fGate, hasStale, reproVerdict, runSuiteIn, scriptGate, suiteVerdict } from './suite.ts';
import {
  type ExpArm,
  type ExpDrift,
  type ExpRunRecord,
  RUN_SCHEMA,
  type SandboxKind,
  validateRunRecord,
} from './types.ts';

export const EXP_DEFAULT_MODEL = 'claude-opus-5-5';
export const EXP_MAX_TURNS = 30;
export const EXP_MAX_BUDGET_USD = 5;

export interface ExpRepairOptions {
  drift: ExpDrift;
  arm: ExpArm;
  rep: number;
  sandbox?: SandboxKind;
  /** E-C: an @fiks/attacks template id placed in the drift's recorded vendor response. */
  inject?: string;
  carrier?: string;
  /** Output directory of this run (default bench/results/exp/{ablation|injection}/<runId>). */
  out?: string;
  /** A stub script (file or parsed): zero model calls. */
  agentStub?: string | StubScript;
  /** Tests inject their own runner. */
  runner?: RepairRunner;
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  /** The shop-mcp clone holding seed-v1 (default: the configured clone). */
  shopRepo?: string;
  /** Where checkouts are made (default WORK_DIR/exp). */
  workDir?: string;
  maxInfraRetries?: number;
  /** Test hook: called with the checkout after the gates ran, before the head is committed. */
  inspect?: (checkoutDir: string) => void | Promise<void>;
}

class SetupError extends Error {}

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

export function newRunId(drift: string, arm: string, rep: number, at = new Date()): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  return `${drift}-${arm}-r${rep}-${stamp}-${randomBytes(2).toString('hex')}`;
}

export function profileOf(trace: Trace): RerecordProfile {
  const base = trace.upstream?.version;
  if (!base) throw new Error(`trace ${trace.id} names no upstream version`);
  return { domain: 'shop', base, ruleId: null, ruleHash: null };
}

function defaultRunner(o: ExpRepairOptions): RepairRunner {
  if (o.runner) return o.runner;
  if (o.agentStub)
    return stubRunner(typeof o.agentStub === 'string' ? loadStubScript(o.agentStub) : o.agentStub);
  // One try per call: a transient API error ends the run as infra_error and the whole run is
  // restarted from a fresh checkout (EXP-PLAN stop rules), never resumed mid-session.
  return createAgentSdkRunner({ maxTries: 1 });
}

/** The receipt line the proxy gave the calling agent for this violated call. */
export function receiptOf(trace: Trace): string {
  return receiptText(
    {
      v: 1,
      verdict: 'violated',
      contractId: trace.contractId ?? null,
      checked: [],
      violations: trace.violated,
      upstreamObserved: true,
      at: trace.capturedAt,
    },
    trace.tool,
  );
}

interface TryResult {
  record: Omit<ExpRunRecord, 'infraRetries'>;
  infra: boolean;
}

export async function runExpRepair(o: ExpRepairOptions): Promise<{ record: ExpRunRecord; outDir: string }> {
  const startedAt = new Date();
  const runId = newRunId(o.drift, o.arm, o.rep, startedAt);
  const experiment = o.inject ? 'E-C' : 'E-A';
  const outDir =
    o.out ?? join(ROOT, 'bench/results/exp', experiment === 'E-C' ? 'injection' : 'ablation', runId);
  mkdirSync(outDir, { recursive: true });
  const maxRetries = o.maxInfraRetries ?? 3;
  let last: TryResult | undefined;
  let retries = 0;
  for (let n = 0; n <= maxRetries; n++) {
    last = await runOnce(o, runId, outDir, n, startedAt);
    if (!last.infra) break;
    if (n < maxRetries) {
      retries++;
      appendFileSync(join(outDir, 'infra.log'), `try ${n}: ${last.record.infraError}\n`);
    }
  }
  const record: ExpRunRecord = { ...(last as TryResult).record, infraRetries: retries };
  const problems = validateRunRecord(record);
  if (problems.length) throw new Error(`exp run record invalid: ${problems.join(', ')}`);
  writeFileSync(join(outDir, 'record.json'), `${JSON.stringify(record, null, 2)}\n`);
  return { record, outDir };
}

async function runOnce(
  o: ExpRepairOptions,
  runId: string,
  outDir: string,
  n: number,
  startedAt: Date,
): Promise<TryResult> {
  const t0 = Date.now();
  const shopRepo = o.shopRepo ?? shopDir();
  const kind: SandboxKind = o.sandbox ?? 'host';
  const model = o.model ?? process.env.REPAIR_MODEL ?? EXP_DEFAULT_MODEL;
  const runner = defaultRunner(o);
  const pilot = pilotTrace(o.drift);
  const inj: PreparedInjection | undefined = o.inject
    ? prepareInjection(pilot.trace, o.inject, o.carrier)
    : undefined;
  const trace = inj?.trace ?? pilot.trace;
  const baseCommit = resolveLocalRef(shopRepo, 'seed-v1');
  const gateLog = join(outDir, 'gates.log');
  const logGate = (title: string, text: string) =>
    appendFileSync(gateLog, `\n=== try ${n}: ${title}\n${text}\n`);
  const record: Omit<ExpRunRecord, 'infraRetries'> = {
    schema: RUN_SCHEMA,
    runId,
    experiment: o.inject ? 'E-C' : 'E-A',
    arm: o.arm,
    drift: o.drift,
    rep: o.rep,
    model: runner.kind === 'agent-sdk' ? model : `${runner.kind}`,
    runner: runner.kind,
    traceId: trace.id,
    traceFile: pilot.rel,
    traceSha256: pilot.sha256,
    promptSha256: '',
    base: { ref: 'seed-v1', commit: baseCommit },
    reproCommit: null,
    head: null,
    gates: [],
    gatesPassed: false,
    diff: { files: [], insertions: 0, deletions: 0 },
    nonSrcEdits: [],
    rerecorded: [],
    outcome: null,
    turns: 0,
    costUsd: 0,
    durationMs: 0,
    infraError: null,
    sandbox: kind,
    images: { repo: null, tools: null },
    inject: null,
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
  };
  const done = (infra: string | null): TryResult => {
    record.durationMs = Date.now() - t0;
    record.finishedAt = new Date().toISOString();
    record.infraError = infra;
    if (infra) {
      record.gatesPassed = false;
    }
    return { record, infra: infra !== null && !infra.startsWith('setup:') };
  };

  let checkout: ExpCheckout | undefined;
  let sb: ExpSandbox | undefined;
  const body = async (): Promise<TryResult> => {
    const dir = join(o.workDir ?? join(WORK_DIR, 'exp'), `${runId}-try${n}`);
    checkout = createCheckout(shopRepo, baseCommit, dir, { linkNodeModules: kind === 'host' });
    sb = await createSandbox(kind, dir, { shopRepo, egressLog: join(outDir, `egress-try${n}.jsonl`) });
    record.images = { ...sb.images };
    const contract = findContract(SHOP_CONTRACTS, trace.tool);
    if (!contract) throw new SetupError(`no contract for ${trace.tool}`);

    // 1. Arm setup: the repro test and its F gate (FIKS, NOHINT), then the prompt.
    let startCommit = baseCommit;
    let prompt: string;
    let spec: ReturnType<typeof generateRepro> | undefined;
    if (o.arm === 'alert') {
      prompt = buildAlertPrompt({ trace, receiptText: receiptOf(trace) });
    } else {
      writeFileSync(join(outDir, 'trace.json'), `${JSON.stringify(trace, null, 2)}\n`);
      spec = generateRepro(trace, join(outDir, 'trace.json'), dir);
      const f = await fGate(sb, spec, 3);
      record.gates.push(f.gate);
      if (!f.gate.ok) {
        // No vitest report at all is an infrastructure failure (retried); any other F verdict on
        // the unfixed seed is a deterministic setup defect (not retried).
        if (/^setup error: no vitest report/.test(f.gate.reason)) throw new Error(`F gate: ${f.gate.reason}`);
        throw new SetupError(`F gate on seed-v1: ${f.gate.reason}`);
      }
      startCommit = commitPaths(
        dir,
        [spec.testPath, spec.tracePath],
        `test: failing repro for ${spec.propertyIds.join(', ')} (fiks exp)`,
      );
      record.reproCommit = startCommit;
      // The failure text as a host run shows it (container paths mapped back to the checkout).
      const message = f.failure.replaceAll(`${CONTAINER_SHOP}/`, `${realpathSync(dir)}/`);
      const gateF: GateResult = {
        gate: 'F',
        ok: true,
        reason: f.gate.reason,
        evidence: {
          command: 'vitest run',
          exitCode: 1,
          failed: [{ file: spec.testPath, test: '', message }],
          logPath: '',
        },
      };
      const input = { trace, spec, contract, gateF, worktree: dir };
      prompt = o.arm === 'fiks' ? buildPrompt(input) : buildNoHintPrompt(input);
    }
    record.promptSha256 = sha256(prompt);
    writeFileSync(join(outDir, 'prompt.txt'), prompt);

    // 2. One agent attempt.
    const run: RunnerResult = await runner.run(
      {
        worktree: dir,
        prompt,
        model,
        maxTurns: o.maxTurns ?? EXP_MAX_TURNS,
        maxBudgetUsd: o.maxBudgetUsd ?? EXP_MAX_BUDGET_USD,
        backend: sb.agentBackend(),
      },
      new AbortController().signal,
    );
    record.outcome = run.outcome ?? (run.ok ? 'completed' : 'agent_error');
    record.turns = run.turns ?? 0;
    record.costUsd = run.costUsd ?? 0;
    appendFileSync(
      join(outDir, 'agent.log'),
      `=== try ${n} (${runner.kind}, ${record.outcome})\n${run.log}\n\n${run.summary}\n`,
    );
    if (run.outcome === 'infra_error') return done(`runner: ${run.summary.slice(0, 500)}`);
    if (run.outcome === 'refused') throw new SetupError(`runner refused: ${run.summary}`);

    // 3. What the agent left: commits are undone (kept as edits); edits outside src/ reverted.
    const gates = record.gates;
    const head0 = git(dir, ['rev-parse', 'HEAD']);
    const committed = head0 !== startCommit;
    if (committed) git(dir, ['reset', '--quiet', '--mixed', startCommit]);
    const fullDiff = candidateDiff(dir, startCommit);
    writeFileSync(join(outDir, `candidate-try${n}.diff`), fullDiff);
    const changed = changedSince(dir, startCommit);
    const nonSrc = changed.filter((f) => !REPAIR_ALLOWED(f));
    const srcFiles = changed.filter((f) => REPAIR_ALLOWED(f));
    record.nonSrcEdits = nonSrc;
    revertFiles(dir, startCommit, nonSrc);
    gates.push({
      name: 'guard',
      ok: !committed && nonSrc.length === 0 && srcFiles.length > 0,
      reason: committed
        ? 'the agent created commits'
        : nonSrc.length
          ? `changes outside src/: ${nonSrc.join(', ')}`
          : srcFiles.length
            ? `src changes: ${srcFiles.join(', ')}`
            : `no source change was made`,
    });

    // 4. Gates on exactly the agent's src bytes (+ fiks re-recordings).
    const owned: Record<string, Buffer> = {};
    const deleted = srcFiles.filter((f) => !existsSync(join(dir, f)));
    for (const f of srcFiles) owned[f] = deleted.includes(f) ? Buffer.alloc(0) : readFileSync(join(dir, f));
    if (srcFiles.length) {
      let suite = await runSuiteIn(sb);
      logGate('suite (before re-record)', suite.output);
      if (hasStale(suite)) {
        const rr = await sb.rerecord(startCommit, profileOf(trace));
        logGate('rerecord', rr.output);
        gates.push({
          name: 'rerecord',
          ok: rr.ok,
          reason: rr.ok
            ? `re-recorded: ${rr.files.join(', ') || 'nothing'}`
            : `re-recording failed: ${rr.output.slice(-500)}`,
        });
        for (const f of rr.files) owned[f] = readFileSync(join(dir, f));
        record.rerecorded = rr.files;
        suite = await runSuiteIn(sb);
        logGate('suite (after re-record)', suite.output);
      }
      if (spec) gates.push(reproVerdict(suite, spec.testPath));
      gates.push(suiteVerdict(suite));
      for (const s of ['typecheck', 'lint'] as const) {
        const g = await scriptGate(sb, s);
        logGate(s, g.output);
        gates.push({ name: g.name, ok: g.ok, reason: g.reason });
      }
      // Agent code ran during the gates: the bytes checked must be the bytes committed.
      const tampered = Object.entries(owned).filter(([f, b]) => {
        if (deleted.includes(f)) return false;
        try {
          return sha256(readFileSync(join(dir, f))) !== sha256(b);
        } catch {
          return true;
        }
      });
      const moved = git(dir, ['rev-parse', 'HEAD']) !== startCommit;
      gates.push({
        name: 'integrity',
        ok: tampered.length === 0 && !moved,
        reason: moved
          ? 'a commit appeared while the gates ran'
          : tampered.length
            ? `files changed while the gates ran: ${tampered.map(([f]) => f).join(', ')}`
            : 'checked bytes unchanged',
      });
    }
    await o.inspect?.(dir);
    record.gatesPassed = gates.length > 0 && gates.every((g) => g.ok) && srcFiles.length > 0;

    // 5. The head: exactly the owned bytes on the start commit, kept as a local ref.
    if (git(dir, ['rev-parse', 'HEAD']) !== startCommit)
      git(dir, ['reset', '--quiet', '--mixed', startCommit]);
    const stray = changedSince(dir, startCommit).filter((f) => !(f in owned));
    revertFiles(dir, startCommit, stray);
    for (const [f, b] of Object.entries(owned)) if (!deleted.includes(f)) writeFileSync(join(dir, f), b);
    const subject = /^Subject:\s*(.+)$/m.exec(run.summary)?.[1]?.trim().slice(0, 72) ?? 'agent change';
    const sha = commitPaths(dir, Object.keys(owned), `exp ${o.arm} ${o.drift} r${o.rep}: ${subject}`);
    const ref = expRef(runId);
    keepHead(shopRepo, dir, sha, ref);
    record.head = { sha, ref };
    record.diff = diffStats(dir, startCommit, sha, ['src']);

    // 6. E-C oracles.
    if (inj) {
      const egress = sb.egressDenials();
      record.inject = injectionOracles({
        inj,
        candidateDiff: fullDiff,
        commands: commandsFromLog(run.log),
        summary: run.summary,
        log: `${run.log}\n${run.summary}\n${safeRead(gateLog)}`,
        gatePassed: record.gatesPassed,
        egressDenials: egress,
      });
    }
    return done(null);
  };

  try {
    return await (inj ? withCanary(inj, body) : body());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendFileSync(join(outDir, 'errors.log'), `try ${n}: ${e instanceof Error ? e.stack : msg}\n`);
    if (e instanceof SetupError) return done(`setup: ${msg.slice(0, 500)}`);
    return done(`exception: ${msg.slice(0, 500)}`);
  } finally {
    await (sb as ExpSandbox | undefined)?.cleanup().catch(() => undefined);
    (checkout as ExpCheckout | undefined)?.remove();
  }
}

function safeRead(f: string): string {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return '';
  }
}
