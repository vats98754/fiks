// One attempt of one comparator arm (PLAN 6.2): checkout at the base, evidence, agent sessions
// through SAFE's runner (or its stub), the arm's checks in the per-attempt container, and the
// records (AttemptRecord, CandidateRecord, ReproTestRecord, RerecordLog, events).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AttemptRecord,
  CiFinal,
  Domain,
  InjectorRule,
  IssueValidation,
  ReproTestRecord,
  RerecordProfile,
  RunKey,
  TokenUsage,
  TraceFormat,
} from '@fiks/interfaces';
import { formatRunKey } from '@fiks/interfaces';
import { candidateDiff, type RunnerJob, type RunnerResult, zeroTokens } from '@fiks/repair';
import { type AgentProvider, armJob, NEW_TEST_PATHS } from './agent.ts';
import {
  type AlertPayload,
  alertJson,
  alertRelPath,
  buildAlert,
  renderAlert,
  writeAlertTrace,
} from './alert.ts';
import { type ArmSpec, type ArmsArmName, armSpec } from './arms.ts';
import { BUDGET, REPRO_BUDGET } from './budget.ts';
import { ArmChecks, plainWorkflowText } from './checks.ts';
import { type FRun, fOnBaseOf, fRunFromVitest, inlinesRecording } from './fcheck.ts';
import { fFeedback, type IssueText, repairPrompt, reproPrompt, tail } from './prompts.ts';
import { AttemptOutput } from './records.ts';
import type { ArmSandbox } from './sandbox.ts';
import { type LoadedTrace, sha256 } from './trace.ts';
import { type AttemptCheckout, commitCandidate, createAttemptCheckout } from './worktree.ts';

export interface RunArmOptions {
  name: ArmsArmName;
  runKey: RunKey;
  domain: Domain;
  /** The target repo clone the attempt checkout is made from. */
  repoDir: string;
  /** Local ref of the server base (resolved `^{commit}`, never fetched). */
  base: string;
  /** The frozen trace (every arm but ISSUE-TEXT; ISSUE-TEXT may pass it for its profile only). */
  trace?: LoadedTrace;
  issue?: IssueText;
  profile: RerecordProfile;
  rule?: InjectorRule;
  /** Frozen contract file content (fiks-iv). */
  contracts?: string;
  /** IV sidecar content (`<trace>.iv.json`). */
  sidecar?: string;
  traceFormat: TraceFormat;
  model: string;
  agent: AgentProvider;
  outDir: string;
  /** Starts the per-attempt container for the checkout (DockerArmSandbox in runs). */
  sandbox: (worktree: string) => Promise<ArmSandbox>;
  fiksCommit: string;
  /** Clock (tests use a fake one for the 90-minute cap). */
  now?: () => Date;
  /** Progress lines (default: none). */
  log?: (line: string) => void;
  /** Keep the attempt checkout after the run (default: removed). */
  keepCheckout?: boolean;
  /** Called with every RunnerJob before it runs (tests spy on it). */
  onJob?: (job: RunnerJob, session: number) => void;
}

export interface ArmRunResult {
  outDir: string;
  attempt?: AttemptRecord;
  reproTests?: ReproTestRecord[];
  alert?: AlertPayload;
  /** Why the attempt stopped. */
  stop: string;
}

interface Acc {
  sessions: number;
  turns: number;
  tokens: TokenUsage;
  costUsd: number;
  wallMs: Record<string, number>;
  infra: boolean;
}

const addTokens = (a: TokenUsage, b: TokenUsage | undefined): TokenUsage =>
  b
    ? {
        in: a.in + b.in,
        out: a.out + b.out,
        cacheRead: a.cacheRead + b.cacheRead,
        cacheCreate: a.cacheCreate + b.cacheCreate,
      }
    : a;

/** Runs one attempt of `opts.name`. Results go to `opts.outDir` (refused if it already holds results). */
export async function runArm(opts: RunArmOptions): Promise<ArmRunResult> {
  const spec = armSpec(opts.name);
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => {});
  if (opts.runKey.arm !== spec.name) throw new Error(`run key arm ${opts.runKey.arm} != --name ${spec.name}`);
  if (opts.runKey.domain !== opts.domain.id)
    throw new Error(`run key domain ${opts.runKey.domain} != --domain ${opts.domain.id}`);
  if (spec.evidence !== 'issue' && !opts.trace) throw new Error(`${spec.name} needs --trace`);
  if (spec.evidence === 'issue' && !opts.issue) throw new Error(`${spec.name} needs --issue`);
  if (spec.ivPlacement !== 'none' && !opts.contracts)
    throw new Error(`${spec.name} needs the frozen contracts for IV`);

  const out = AttemptOutput.create(opts.outDir, opts.runKey, now);
  const t0 = now().getTime();
  const elapsed = () => now().getTime() - t0;
  const acc: Acc = { sessions: 0, turns: 0, tokens: zeroTokens(), costUsd: 0, wallMs: {}, infra: false };
  const phase = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const s = now().getTime();
    try {
      return await fn();
    } finally {
      acc.wallMs[name] = (acc.wallMs[name] ?? 0) + (now().getTime() - s);
    }
  };
  out.event('attempt_started', { arm: spec.name, runKey: formatRunKey(opts.runKey), base: opts.base });

  const checkout = createAttemptCheckout(opts.repoDir, opts.base, out.path('checkout'));
  const alert =
    spec.evidence === 'issue' || !opts.trace
      ? undefined
      : buildAlert(opts.trace, { proseOnly: spec.evidence === 'prose' });
  if (alert) {
    out.write('alert.json', alertJson(alert));
    out.write('alert.txt', `${renderAlert(alert)}\n`);
  }
  if (spec.evidence === 'trace' && opts.trace) writeAlertTrace(checkout.dir, opts.trace);

  let sandbox: ArmSandbox | undefined;
  try {
    sandbox = await phase('setup', () => opts.sandbox(checkout.dir));
    const alertRel = opts.trace ? alertRelPath(opts.trace.trace.id) : undefined;
    let plainWorkflowFile: string | undefined;
    if (spec.ciPolicy.scope === 'server-tests') {
      const yml = readFileSync(join(checkout.dir, '.github/workflows/ci.yml'), 'utf8');
      plainWorkflowFile = out.write('ci-plain.yml', plainWorkflowText(yml));
    }
    const checks = new ArmChecks({
      sandbox,
      domain: opts.domain.id,
      profile: opts.profile,
      rule: opts.rule,
      fromCommit: checkout.baseCommit,
      alertRel,
      traceBytes: opts.trace?.bytes,
      alertVisible: spec.evidence === 'trace',
      contracts: spec.ivPlacement === 'none' ? undefined : opts.contracts,
      sidecar: spec.ivPlacement === 'none' ? undefined : opts.sidecar,
      runKey: formatRunKey(opts.runKey),
      rerecordLog: out.path('rerecord.jsonl'),
      plainWorkflowFile,
    });
    out.write(
      'meta.json',
      `${JSON.stringify(
        {
          arm: spec.name,
          runKey: formatRunKey(opts.runKey),
          domain: opts.domain.id,
          base: opts.base,
          baseCommit: checkout.baseCommit,
          profile: opts.profile,
          rule: opts.rule ? { id: opts.rule.id, hash: opts.rule.hash } : null,
          frozenTrace: opts.trace ? { path: opts.trace.path, sha256: opts.trace.sha256 } : null,
          alertSha256: alert ? sha256(alertJson(alert)) : null,
          ivSidecarSha256: opts.sidecar ? sha256(opts.sidecar) : null,
          agent: opts.agent.kind,
          model: opts.model,
          traceFormat: opts.traceFormat,
          budget: spec.family === 'repro' ? REPRO_BUDGET : BUDGET,
          fiksCommit: opts.fiksCommit,
          imageDigest: sandbox.imageDigest,
        },
        null,
        2,
      )}\n`,
    );
    const ctx: Ctx = { opts, spec, out, checkout, sandbox, checks, alert, acc, now, elapsed, phase, log };
    if (spec.family === 'repro') {
      const r = await runRepro(ctx);
      out.event('attempt_ended', { stop: r.stop });
      return { outDir: out.dir, reproTests: r.records, alert, stop: r.stop };
    }
    const r = spec.family === 'gated' ? await runGated(ctx) : await runPostPr(ctx);
    const attempt: AttemptRecord = {
      runKey: opts.runKey,
      prExposed: r.prExposed,
      ciFinal: r.ciFinal,
      issueValidation: r.issueValidation,
      ivPlacement: spec.ivPlacement,
      headSha: r.headSha,
      outcome: null,
      sessions: acc.sessions,
      turns: acc.turns,
      tokens: acc.tokens,
      costUsd: acc.costUsd,
      wallMs: acc.wallMs,
      candidateIds: [...out.candidateIds],
      fiksCommit: opts.fiksCommit,
      imageDigest: sandbox.imageDigest,
      traceFormat: opts.traceFormat,
      frozenTraceSha: opts.trace?.sha256 ?? '',
      rerecordLog: out.path('rerecord.jsonl'),
    };
    out.attempt(attempt);
    out.event('attempt_ended', { stop: r.stop, infraError: acc.infra });
    return { outDir: out.dir, attempt, alert, stop: r.stop };
  } finally {
    await sandbox?.cleanup();
    if (!opts.keepCheckout) checkout.remove();
  }
}

interface Ctx {
  opts: RunArmOptions;
  spec: ArmSpec;
  out: AttemptOutput;
  checkout: AttemptCheckout;
  sandbox: ArmSandbox;
  checks: ArmChecks;
  alert?: AlertPayload;
  acc: Acc;
  now: () => Date;
  elapsed: () => number;
  phase: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  log: (line: string) => void;
}

interface RepairOutcome {
  prExposed: boolean;
  ciFinal: CiFinal;
  issueValidation: IssueValidation;
  headSha: string | null;
  stop: string;
}

function job(c: Ctx, prompt: string, repro: boolean): RunnerJob {
  return armJob({
    worktree: c.checkout.dir,
    prompt,
    model: c.opts.model,
    traceFormat: c.opts.traceFormat,
    allowedEditPaths: repro ? [] : c.opts.domain.allowedEditPaths,
    allowedNewFilePaths: NEW_TEST_PATHS,
    backend: c.sandbox.agentBackend(),
    // The agent's own pnpm runs are gate invocations too (P11 candidate capture).
    onCandidate: (diff, stage) => {
      c.out.candidate(diff, stage);
    },
  });
}

/** Runs one runner call with the wall-clock deadline as its abort signal. */
async function play(
  c: Ctx,
  runner: { run(j: RunnerJob, s: AbortSignal): Promise<RunnerResult> },
  j: RunnerJob,
  n: number,
) {
  c.opts.onJob?.(j, n);
  const left = Math.max(1, BUDGET.wallClockMs - c.elapsed());
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), left);
  try {
    const r = await c.phase('agent', () => runner.run(j, ctrl.signal));
    c.acc.turns += r.turns ?? 0;
    c.acc.costUsd += r.costUsd ?? 0;
    c.acc.tokens = addTokens(c.acc.tokens, r.tokens);
    if (r.outcome === 'infra_error' || r.outcome === 'refused') c.acc.infra = true;
    c.out.write(
      `transcripts/session-${n}${j.resume ? `-resume-${j.resume.turnsUsed ?? 0}` : ''}.log`,
      `${r.log}\n\n${r.summary}\n`,
    );
    c.out.event(
      'session_ended',
      {
        outcome: r.outcome ?? (r.ok ? 'completed' : 'agent_error'),
        turns: r.turns ?? 0,
        costUsd: r.costUsd ?? 0,
        denials: r.denials ?? [],
      },
      n,
    );
    return r;
  } finally {
    clearTimeout(timer);
  }
}

async function repairSession(c: Ctx, n: number, extra: { previousFailure?: string; redCiLog?: string }) {
  const prompt = repairPrompt({
    spec: c.spec,
    domain: c.opts.domain,
    alert: c.alert,
    trace: c.opts.trace?.trace,
    issue: c.opts.issue,
    traceFormat: c.opts.traceFormat,
    ...extra,
  });
  c.out.write(`prompts/session-${n}.txt`, prompt);
  c.acc.sessions = n;
  c.out.event('session_started', {}, n);
  c.log(`[${c.spec.name}] session ${n}`);
  return play(c, c.opts.agent.session(n - 1), job(c, prompt, false), n);
}

const diffOf = (c: Ctx) => candidateDiff(c.checkout.dir, c.checkout.baseCommit);
const NO_CHANGE = 'Your session ended without changing any file in the repository.';

/** L1, L1-noIV, L1p: pre-PR gates (suite, traces, typecheck/lint, IV) then local CI, <= 4 sessions. */
async function runGated(c: Ctx): Promise<RepairOutcome> {
  let previousFailure: string | undefined;
  let headSha: string | null = null;
  let ciFinal: CiFinal = 'none';
  let issueValidation: IssueValidation = 'n/a';
  for (let n = 1; n <= BUDGET.maxSessions; n++) {
    if (c.elapsed() >= BUDGET.wallClockMs)
      return { prExposed: false, ciFinal, issueValidation, headSha, stop: 'wall_clock' };
    const r = await repairSession(c, n, { previousFailure });
    if (c.acc.infra)
      return { prExposed: false, ciFinal, issueValidation, headSha, stop: `infra_error: ${r.summary}` };
    const diff = diffOf(c);
    if (!diff.trim()) {
      previousFailure = NO_CHANGE;
      continue;
    }
    headSha = commitCandidate(c.checkout.dir, 'candidate');
    c.out.event('candidate', { headSha }, n);
    c.out.candidate(diff, 'gate');
    const suite = await c.phase('gates', () => c.checks.suiteGate());
    c.out.write(`gates/session-${n}-suite.log`, suite.log);
    c.out.event('gate', { gate: 'suite+typecheck+lint', green: suite.green }, n);
    let ivGreen = true;
    let ivLog = '';
    if (c.spec.ivPlacement === 'pre') {
      c.out.candidate(diff, 'iv');
      const iv = await c.phase('gates', () => c.checks.ivGate());
      ivGreen = iv.green;
      ivLog = iv.log;
      issueValidation = iv.green ? 'pass' : 'fail';
      c.out.write(`gates/session-${n}-iv.log`, iv.log);
      c.out.event('gate', { gate: 'iv', green: iv.green, placement: 'pre' }, n);
    }
    if (suite.green && ivGreen) {
      c.out.candidate(diff, 'ci');
      const ci = await c.phase('ci', () => c.checks.ci({ iv: false }));
      c.out.write(`gates/session-${n}-ci.log`, ci.log);
      ciFinal = ci.green ? 'green' : 'red';
      c.out.event('ci', { green: ci.green, placement: 'pre-pr' }, n);
      if (ci.green) {
        c.out.event('would_open_pr', { headSha, session: n }, n);
        return { prExposed: true, ciFinal, issueValidation, headSha, stop: 'would_open_pr' };
      }
      previousFailure = tail(ci.log, 6000);
    } else {
      previousFailure = [suite.green ? '' : tail(suite.log, 6000), ivGreen ? '' : ivLog]
        .filter(Boolean)
        .join('\n');
    }
  }
  return { prExposed: false, ciFinal, issueValidation, headSha, stop: 'sessions_exhausted' };
}

/** COMP, COMP-norep, COMP-plain, ISSUE-TEXT: PR on the first non-empty diff, CI revisions. */
async function runPostPr(c: Ctx): Promise<RepairOutcome> {
  let n = 0;
  let headSha: string | null = null;
  let previousFailure: string | undefined;
  while (headSha === null) {
    if (n >= BUDGET.maxSessions)
      return {
        prExposed: false,
        ciFinal: 'none',
        issueValidation: 'n/a',
        headSha,
        stop: 'sessions_exhausted',
      };
    if (c.elapsed() >= BUDGET.wallClockMs)
      return { prExposed: false, ciFinal: 'none', issueValidation: 'n/a', headSha, stop: 'wall_clock' };
    n++;
    const r = await repairSession(c, n, { previousFailure });
    if (c.acc.infra)
      return {
        prExposed: false,
        ciFinal: 'none',
        issueValidation: 'n/a',
        headSha,
        stop: `infra_error: ${r.summary}`,
      };
    const diff = diffOf(c);
    if (!diff.trim()) {
      previousFailure = NO_CHANGE;
      continue;
    }
    headSha = commitCandidate(c.checkout.dir, 'candidate');
    c.out.candidate(diff, 'gate');
    c.out.event('would_open_pr', { headSha, session: n }, n);
  }
  let revisions = 0;
  let ciFinal: CiFinal = 'none';
  let issueValidation: IssueValidation = 'n/a';
  for (;;) {
    c.out.candidate(diffOf(c), 'ci');
    const ci = await c.phase('ci', () =>
      c.checks.ci({ iv: c.spec.ciPolicy.iv, plain: c.spec.ciPolicy.scope === 'server-tests' }),
    );
    c.out.write(`gates/revision-${revisions}-ci.log`, ci.log);
    ciFinal = ci.green ? 'green' : 'red';
    if (c.spec.ciPolicy.iv) issueValidation = ci.iv?.pass ? 'pass' : 'fail';
    c.out.event('ci', { green: ci.green, placement: 'post-pr', revision: revisions, headSha }, n);
    if (ci.green) return { prExposed: true, ciFinal, issueValidation, headSha, stop: 'ci_green' };
    if (revisions >= BUDGET.maxRevisions)
      return { prExposed: true, ciFinal, issueValidation, headSha, stop: 'revisions_exhausted' };
    if (n >= BUDGET.maxSessions)
      return { prExposed: true, ciFinal, issueValidation, headSha, stop: 'sessions_exhausted' };
    if (c.elapsed() >= BUDGET.wallClockMs)
      return { prExposed: true, ciFinal, issueValidation, headSha, stop: 'wall_clock' };
    revisions++;
    n++;
    c.out.event('revision', { revision: revisions }, n);
    const r = await repairSession(c, n, { redCiLog: ci.log });
    if (c.acc.infra)
      return { prExposed: true, ciFinal, issueValidation, headSha, stop: `infra_error: ${r.summary}` };
    const diff = diffOf(c);
    const next = commitCandidate(c.checkout.dir, 'candidate');
    if (next !== headSha) {
      headSha = next;
      c.out.candidate(diff, 'revision');
    }
  }
}

/** New test files the agent wrote under test/ (relative to the repo), sorted. */
function newTestFiles(c: Ctx): string[] {
  const diff = diffOf(c);
  const files = new Set<string>();
  for (const m of diff.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)) {
    const f = m[2] as string;
    if (/^test\/.+\.test\.ts$/.test(f)) files.add(f);
  }
  return [...files].sort();
}

/** REPRO-AGENT (PLAN 5.5): 1 session, 30 turns, F check with fixed feedback, <= 3 F rounds. */
async function runRepro(c: Ctx): Promise<{ records: ReproTestRecord[]; stop: string }> {
  if (!c.alert) throw new Error('REPRO-AGENT needs the alert');
  const prompt = reproPrompt({
    spec: c.spec,
    domain: c.opts.domain,
    alert: c.alert,
    trace: c.opts.trace?.trace,
    traceFormat: c.opts.traceFormat,
  });
  c.out.write('prompts/session-1.txt', prompt);
  c.acc.sessions = 1;
  c.out.event('session_started', {}, 1);
  const runner = c.opts.agent.resumable();
  const base = job(c, prompt, true);
  let r = await play(c, runner, base, 1);
  const records: ReproTestRecord[] = [];
  let stop = 'f_rounds_exhausted';
  for (let round = 1; round <= REPRO_BUDGET.fRounds; round++) {
    if (c.acc.infra) {
      stop = `infra_error: ${r.summary}`;
      break;
    }
    const tests = newTestFiles(c);
    const path = tests.length === 1 ? (tests[0] as string) : '';
    let runs: FRun[] = [];
    let output: string;
    let recordingsRead: string[] = [];
    if (tests.length !== 1) {
      output = `expected exactly one new test file under test/, found ${tests.length}${tests.length ? `: ${tests.join(', ')}` : ''}`;
    } else {
      const f = await c.phase('f', () => c.checks.fCheck(path, REPRO_BUDGET.fRuns));
      runs = f.runs.map((x) => fRunFromVitest(x.json, path));
      output = f.runs[0]?.output ?? '';
      if (!f.rerecordOk)
        output = `${output}\n(re-record before the F check failed: ${tail(f.rerecordOutput, 800)})`;
      recordingsRead = f.recordingsRead;
      c.out.write(`f/round-${round}.log`, f.runs.map((x, i) => `== run ${i + 1}\n${x.output}`).join('\n'));
    }
    const fOnBase = tests.length === 1 ? fOnBaseOf(runs) : 'error';
    const source = path ? readFileSync(join(c.checkout.dir, path), 'utf8') : '';
    if (path) c.out.write(`repro/round-${round}/${path}`, source);
    const rec: ReproTestRecord = {
      runKey: c.opts.runKey,
      source: 'agent',
      round,
      path,
      sha: path ? sha256(source) : '',
      fOnBase,
      isFinal: false,
      isFirst: round === 1,
      recordingsRead,
      inlineRecording: path ? inlinesRecording(source, recordingsRead) : false,
    };
    records.push(rec);
    c.out.event(
      'f_check',
      { round, path, fOnBase, runs: runs.map((x) => x.verdict), reasons: runs.map((x) => x.reason) },
      1,
    );
    if (fOnBase === 'fail') {
      stop = 'f_valid';
      break;
    }
    if (round === REPRO_BUDGET.fRounds) break;
    const turnsUsed = r.sessionTurns ?? c.acc.turns;
    if (turnsUsed >= REPRO_BUDGET.turnsPerSession) {
      stop = 'turns_exhausted';
      break;
    }
    if (c.elapsed() >= REPRO_BUDGET.wallClockMs) {
      stop = 'wall_clock';
      break;
    }
    const message = fFeedback(output);
    c.out.event('f_feedback', { round, message }, 1);
    if (!r.sessionId) {
      stop = 'no_session_to_resume';
      break;
    }
    r = await play(
      c,
      runner,
      { ...base, resume: { sessionId: r.sessionId, message, turnsUsed, costUsd: c.acc.costUsd } },
      1,
    );
  }
  const last = records.at(-1);
  if (last) last.isFinal = true;
  for (const rec of records) c.out.reproTest(rec);
  return { records, stop };
}
