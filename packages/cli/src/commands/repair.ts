// `fiks repair` (PLAN P11, P17, P18, P23). Two modes:
//  - product (no --arm, no --run-key): repro -> repair agent -> gates -> green GitHub CI -> PR,
//    exactly as at ec241bc (`repair()` below; the legacy adapter's flags and output);
//  - experiment (`--arm fiks|fiks+cu`, `--run-key`): the FIKS arm (PLAN 6.2) on a local base ref
//    with no fetch, no push and no gh call. The agent's allow-listed Bash, the F/P gates, the
//    contract suite, stored traces, typecheck/lint, `rerecord-head` and local CI all run inside
//    one per-attempt container (bootstrap/20-sandbox.ts, SBX). Results are keyed by the RunKey and
//    never overwritten; `would_open_pr` is recorded only after local CI is green.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  acceptDelta,
  type GateResult as CuGateResult,
  type DeclaredOutputSchemas,
  declaredOutputSchemas,
  type GateCase,
  parseOutcome,
  renderProposal,
} from '@fiks/contract-update';
import {
  type ContractFile,
  findContract,
  type HttpExchange,
  type Recording,
  SHOP_CONTRACTS,
} from '@fiks/contracts';
import { getDomain, listDomains, registerDomain } from '@fiks/domains';
import { type LoadedRule, loadDriftPackage, readRule, ruleHash } from '@fiks/injector';
import {
  type AttemptRecord,
  type CandidateRecord,
  type CandidateStage,
  type CliCommandModule,
  type Domain,
  type FOnBase,
  formatRunKey,
  type InjectorRule,
  parseRunKey,
  type ReproTestRecord,
  type RerecordCheck,
  type RerecordLog,
  type RerecordProfile,
  type RunKey,
  type SuiteRun,
  type TokenUsage,
  type TraceFormat,
  type UpstreamMiddleware,
} from '@fiks/interfaces';
import { mutateRecordedResponse, RESPONSE_OPS } from '@fiks/mutate';
import {
  agentSdkRunner,
  buildPrompt,
  changedFiles,
  changedFilesSince,
  changedSinceSnapshot,
  checkPaths,
  ciGate,
  claudeCliRunner,
  createAgentSdkRunner,
  editGuard,
  fileHash,
  gh,
  headOf,
  loadStubScript,
  localGate,
  parseTraceFormat,
  prBody,
  prTitle,
  REPAIR_ALLOWED,
  RERECORD_ALLOWED,
  type RepairRunner,
  type RunnerJob,
  type RunnerKind,
  type RunnerResult,
  stubRunner,
  zeroTokens,
} from '@fiks/repair';
import {
  addWorktree,
  appendEvent,
  createWorktree,
  failGate,
  type GateResult,
  generateRepro,
  isWholeSuite,
  type LocalWorktree,
  loadTrace,
  passGate,
  reproHooks,
  restrictToScope,
  shopReproEmitter,
  shopSuite,
  type Trace,
} from '@fiks/repro';
import {
  ciLocal,
  type DockerExecBackend,
  type DockerExecBackendOptions,
  dockerCliEnv,
  EGRESS_DENIAL,
  execFiks,
  FIKS_SANDBOX_ENV,
  imageDigest,
  type Mount,
  SANDBOX_ENV,
  TOOLS_DIR,
  toolsMounts,
} from '@fiks/sandbox';
import { createVendor, injectorMiddleware } from '@fiks/vendor-api';
import { harnessDomain, startHarness } from '../harness.ts';
import { FIKS_DIR, ROOT, repoAt, repoDir, shopDir, WORK_DIR } from '../paths.ts';
import { contractsOf } from './record-fixtures.ts';
import { captureTrace } from './repro.ts';
import { vendorVersionOf } from './rerecord.ts';
import { rerecordStale } from './rerecord-stale.ts';

export type RepairStatus =
  | 'pr_opened'
  | 'ready'
  | 'duplicate'
  | 'gate_failed'
  | 'agent_failed'
  | 'ci_red'
  | 'ci_timeout';

export interface RepairResult {
  status: RepairStatus;
  reason: string;
  scenario?: string;
  traceId: string;
  propertyIds: string[];
  branch: string;
  base: string;
  runner?: RunnerKind;
  model: string;
  attempts: number;
  costUsd: number;
  turns: number;
  gates: GateResult[];
  fixCommitFiles: string[];
  rerecorded: string[];
  commits: string[];
  /** sha256 of every committed file, as checked by the gates. */
  owned?: Record<string, string>;
  ciRunUrl?: string;
  pr?: { number: number; url: string };
  startedAt: string;
  finishedAt: string;
}

export interface RepairOptions {
  scenario?: string;
  traceFile?: string;
  base?: string;
  noPr?: boolean;
  model?: string;
  /** Primary runner, then fallback. Tests inject their own; the CLI uses the agent runners. */
  runners?: RepairRunner[];
  attempts?: number;
  maxTurns?: number;
  maxBudgetUsd?: number;
  ciTimeoutMs?: number;
  ciPollMs?: number;
}

// Hooks off: agent code could have planted git hooks in the shared repository.
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();

export const slug = (propertyId: string) =>
  propertyId
    .replace(/^shop\./, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-|-$/g, '');

function resetTo(wt: string, commit: string) {
  git(wt, 'reset', '--hard', commit);
  git(wt, 'clean', '-fd', '-e', 'node_modules');
}

export async function repair(opts: RepairOptions): Promise<RepairResult> {
  const startedAt = new Date().toISOString();
  const runId = `run_${startedAt.replace(/[-:.]/g, '')}`;
  const events = join(FIKS_DIR, 'events.jsonl');
  const repo = process.env.SHOP_MCP_REPO ?? 'vats98754/shop-mcp';
  const base = opts.base ?? 'main';
  const model = opts.model ?? process.env.REPAIR_MODEL ?? 'claude-opus-5-5';
  const runners = opts.runners ?? [agentSdkRunner, claudeCliRunner];
  const attempts = opts.attempts ?? 3;

  let traceFile: string;
  let trace: Trace;
  if (opts.traceFile) {
    traceFile = opts.traceFile;
    trace = loadTrace(traceFile);
  } else if (opts.scenario) {
    ({ file: traceFile, trace } = await captureTrace(opts.scenario, runId));
  } else {
    throw new Error('repair needs --scenario or --trace');
  }
  const propertyIds = trace.target ?? trace.violated.map((v) => v.propertyId);
  const branch = `fiks/${slug(propertyIds[0] ?? trace.tool)}-${trace.id}`;
  const result: RepairResult = {
    status: 'gate_failed',
    reason: '',
    scenario: opts.scenario,
    traceId: trace.id,
    propertyIds,
    branch,
    base,
    model,
    attempts: 0,
    costUsd: 0,
    turns: 0,
    gates: [],
    fixCommitFiles: [],
    rerecorded: [],
    commits: [],
    startedAt,
    finishedAt: startedAt,
  };
  const ev = (
    type: Parameters<typeof appendEvent>[1]['type'],
    data: Record<string, unknown> = {},
    ok?: boolean,
  ) =>
    appendEvent(events, {
      runId,
      type,
      traceId: trace.id,
      propertyId: propertyIds.join(','),
      ok,
      data: { branch, ...data },
    });
  let removeWorktree: (() => void) | undefined;
  const finish = (status: RepairStatus, reason: string) => {
    // Local failures leave nothing to inspect beyond the saved logs; a pushed branch (CI red or
    // timeout) keeps its worktree for inspection.
    if (status === 'gate_failed' || status === 'agent_failed') removeWorktree?.();
    result.status = status;
    result.reason = reason;
    result.finishedAt = new Date().toISOString();
    mkdirSync(join(FIKS_DIR, 'repairs'), { recursive: true });
    writeFileSync(join(FIKS_DIR, 'repairs', `${trace.id}.json`), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  };

  // 0. One open fix PR per broken property: do not spend an agent run on a duplicate.
  if (!opts.noPr) {
    const title = prTitle(trace, { traceId: trace.id, propertyIds, testPath: '', tracePath: '' });
    const open = JSON.parse(
      gh(repo, ['pr', 'list', '--label', 'fiks', '--state', 'open', '--base', base, '--json', 'title,url']),
    ) as { title: string; url: string }[];
    const dup = open.find((p) => p.title === title);
    if (dup) return finish('duplicate', `an open fiks PR already fixes this: ${dup.url}`);
  }

  // 1. Worktree on a fresh branch from the current base.
  git(shopDir(), 'fetch', '--quiet', 'origin', base);
  const wt = addWorktree(
    shopDir(),
    join(WORK_DIR, 'wt', 'fiks', branch.replace(/^fiks\//, '')),
    `origin/${base}`,
    branch,
  );
  removeWorktree = () => {
    wt.remove();
    try {
      git(shopDir(), 'branch', '-D', branch);
    } catch {
      // not created
    }
  };

  // 2. Repro test + F gate, committed on its own.
  const contract = findContract(SHOP_CONTRACTS, trace.tool);
  if (!contract) return finish('gate_failed', `no contract for ${trace.tool}`);
  const spec = generateRepro(trace, traceFile, wt.dir);
  ev('repro_generated', { testPath: spec.testPath });
  const gateF = failGate(wt.dir, spec, 3);
  result.gates.push(gateF);
  ev('gate_F', { reason: gateF.reason }, gateF.ok);
  if (!gateF.ok) return finish('gate_failed', `F gate: ${gateF.reason}`);
  git(wt.dir, 'add', spec.testPath, spec.tracePath);
  git(
    wt.dir,
    'commit',
    '-q',
    '-m',
    `test: failing repro for ${propertyIds.join(', ')} (fiks)`,
    '-m',
    `Trace ${trace.id}. F gate: ${gateF.reason}.`,
  );
  const reproCommit = git(wt.dir, 'rev-parse', 'HEAD');
  result.commits.push(reproCommit);

  // 3. Repair: retries with the gate log, then the fallback runner. Never a hand fix.
  let previousFailure: string | undefined;
  let local: GateResult | undefined;
  let guardRejected = false;
  /** fiks-produced files: the exact bytes, written by fiks right before they are committed. */
  const ownedBytes: Record<string, string> = {};
  let summary = '';
  const plan: RepairRunner[] = [
    ...Array.from({ length: attempts }, () => runners[0] as RepairRunner),
    ...runners.slice(1, 2),
  ];
  for (const runner of plan) {
    result.attempts++;
    result.runner = runner.kind;
    resetTo(wt.dir, reproCommit);
    ev('repair_started', { runner: runner.kind, attempt: result.attempts, model });
    const prompt = buildPrompt({ trace, spec, contract, gateF, worktree: wt.dir, previousFailure });
    const run = await runner.run(
      {
        worktree: wt.dir,
        prompt,
        model,
        maxTurns: opts.maxTurns ?? 30,
        maxBudgetUsd: opts.maxBudgetUsd ?? 5,
      },
      new AbortController().signal,
    );
    result.costUsd += run.costUsd ?? 0;
    result.turns += run.turns ?? 0;
    summary = run.summary;
    // Audit trail of what the agent did (tool calls and text).
    mkdirSync(join(FIKS_DIR, 'repairs'), { recursive: true });
    writeFileSync(
      join(FIKS_DIR, 'repairs', `${trace.id}.attempt${result.attempts}.log`),
      `${run.log}\n\n${run.summary}\n`,
    );
    if (headOf(wt.dir) !== reproCommit) {
      guardRejected = true;
      previousFailure = 'You created git commits. Do not commit; only edit files under src/.';
      ev('gate_local', { attempt: result.attempts, reason: previousFailure }, false);
      continue;
    }
    const files = changedFilesSince(wt.dir, reproCommit);
    const guard = checkPaths(files, REPAIR_ALLOWED);
    if (!guard.ok) {
      guardRejected ||= guard.rejected.length > 0;
      previousFailure = guard.rejected.length
        ? `You changed files outside src/: ${guard.rejected.join(', ')}. Only src/ may change.`
        : `No source change was made. Agent said: ${run.summary}`;
      ev('gate_local', { attempt: result.attempts, reason: previousFailure }, false);
      continue;
    }
    result.fixCommitFiles = files;
    // The agent is done: its source bytes are now fixed. Gates run against exactly these.
    const owned: Record<string, string> = Object.fromEntries(files.map((f) => [f, fileHash(wt.dir, f)]));
    // fiks (not the agent) re-records calls the fix legitimately changed.
    // Inputs come from the repro commit, not the worktree (see rerecord).
    let rerecorded: Awaited<ReturnType<typeof rerecordStale>>;
    try {
      rerecorded = await rerecordStale(wt.dir, { fromCommit: reproCommit });
    } catch (e) {
      guardRejected = true;
      local = undefined;
      previousFailure = `re-recording refused: ${e instanceof Error ? e.message : String(e)}`;
      ev('gate_local', { attempt: result.attempts, reason: previousFailure }, false);
      continue;
    }
    local = localGate(wt.dir, spec);
    ev(
      'gate_local',
      { attempt: result.attempts, reason: local.reason, rerecorded: rerecorded.length },
      local.ok,
    );
    // Agent code runs during the gates: re-check that nothing outside src/ (other than fiks's
    // own re-recordings) changed and that no commit appeared.
    for (const r of rerecorded) {
      owned[r.file] = r.sha256;
      ownedBytes[r.file] = r.bytes;
    }
    const rel = rerecorded.map((r) => r.file);
    const after = changedFilesSince(wt.dir, reproCommit);
    const unexpected = after.filter((f) => !files.includes(f) && !rel.includes(f));
    const tampered = changedSinceSnapshot(wt.dir, owned);
    if (tampered.length) {
      guardRejected = true;
      local = undefined;
      previousFailure = `Files changed after they were checked: ${tampered.join(', ')}. Code must not modify files at runtime.`;
      ev('gate_local', { attempt: result.attempts, reason: previousFailure }, false);
      continue;
    }
    result.owned = owned;
    if (headOf(wt.dir) !== reproCommit || unexpected.length) {
      guardRejected = true;
      local = undefined;
      previousFailure = `Files changed while the checks ran: ${unexpected.join(', ') || 'a commit appeared'}. Only edit src/.`;
      ev('gate_local', { attempt: result.attempts, reason: previousFailure }, false);
      continue;
    }
    if (local.ok) {
      result.rerecorded = rel;
      break;
    }
    previousFailure = `${local.reason}\n${local.evidence.failed.map((f) => `${f.test}:\n${f.message.split('\n').slice(0, 40).join('\n')}`).join('\n')}`;
  }
  if (!local?.ok) {
    if (local) result.gates.push(local);
    return finish(
      local || guardRejected ? 'gate_failed' : 'agent_failed',
      `no attempt passed the local gate: ${previousFailure ?? 'no runner result'}`,
    );
  }
  const pGate = passGate(wt.dir, spec);
  result.gates.push(pGate, local);

  // 4. Commit the fix (src/ only), then fiks's re-recordings (*.rerecorded.json only).
  git(wt.dir, 'add', ...result.fixCommitFiles);
  const subject = /^Subject:\s*(.+)$/m.exec(summary)?.[1]?.trim();
  // The agent's subject when it gave a usable one, else a deterministic one.
  const title =
    subject && subject.length <= 60
      ? subject
      : `repair ${propertyIds.map((p) => p.split('/')[1]).join(', ')}`;
  summary = summary
    .replace(/^Subject:.*\n?/m, '')
    .replaceAll(`${wt.dir}/`, '')
    .trim();
  git(wt.dir, 'commit', '-q', '-m', `fix(${trace.tool}): ${title} (fiks)`, '-m', summary.slice(0, 2000));
  result.commits.push(git(wt.dir, 'rev-parse', 'HEAD'));
  if (result.rerecorded.length) {
    // Write fiks's own bytes from memory; whatever is on disk now is not trusted.
    for (const f of result.rerecorded) writeFileSync(join(wt.dir, f), ownedBytes[f] as string);
    const rest = changedFilesSince(wt.dir, 'HEAD');
    const g = checkPaths(rest, RERECORD_ALLOWED);
    if (!g.ok)
      return finish('gate_failed', `unexpected changes besides re-recordings: ${g.rejected.join(', ')}`);
    git(wt.dir, 'add', ...rest);
    git(wt.dir, 'commit', '-q', '-m', 'test: re-record changed upstream calls (fiks)', '-m', rest.join('\n'));
    result.commits.push(git(wt.dir, 'rev-parse', 'HEAD'));
  }
  if (changedFiles(wt.dir).length)
    return finish('gate_failed', `uncommitted changes remain: ${changedFiles(wt.dir).join(', ')}`);
  const commitFiles = changedFilesSince(wt.dir, reproCommit);
  const allowed = (f: string) => result.fixCommitFiles.includes(f) || result.rerecorded.includes(f);
  // The committed blobs must be exactly the bytes the gates checked.
  const notOwned = changedSinceSnapshot(wt.dir, result.owned ?? {}, 'HEAD');
  if (notOwned.length || Object.keys(result.owned ?? {}).length !== commitFiles.length) {
    return finish(
      'gate_failed',
      `committed files differ from the checked bytes: ${notOwned.join(', ') || 'file set changed'}`,
    );
  }
  if (!commitFiles.every(allowed)) {
    return finish(
      'gate_failed',
      `unexpected files in the branch: ${commitFiles.filter((f) => !allowed(f)).join(', ')}`,
    );
  }

  // 5. Green-CI gate: push the branch and wait for its own CI run. No PR before green.
  const ci = await ciGate(repo, wt.dir, branch, {
    timeoutMs: opts.ciTimeoutMs,
    pollMs: opts.ciPollMs,
    onPushed: (sha) => ev('branch_pushed', { sha }),
  });
  result.gates.push(ci);
  result.ciRunUrl = ci.evidence.url;
  ev('gate_ci', { reason: ci.reason, url: ci.evidence.url }, ci.ok);
  if (ci.status === 'red') return finish('ci_red', ci.reason);
  if (ci.status === 'timeout' || ci.status === 'error') return finish('ci_timeout', ci.reason);
  if (opts.noPr) return finish('ready', 'all gates green; --no-pr');

  // 6. Open the PR. Never merge, never enable auto-merge.
  const diff = git(wt.dir, 'diff', `${reproCommit}..${result.commits[1]}`, '--', 'src');
  const diffStat = git(wt.dir, 'diff', '--stat', `${reproCommit}..${result.commits[1]}`, '--', 'src');
  const body = prBody({
    trace,
    spec,
    gates: result.gates,
    diff,
    diffStat,
    agentSummary: summary,
    runner: result.runner ?? '',
    model,
    rerecorded: result.rerecorded,
    repoUrl: `https://github.com/${repo}`,
    branch,
  });
  const bodyFile = join(FIKS_DIR, 'repairs', `${trace.id}.pr.md`);
  mkdirSync(join(FIKS_DIR, 'repairs'), { recursive: true });
  writeFileSync(bodyFile, body);
  try {
    gh(repo, ['label', 'create', 'fiks', '--color', '0E8A16', '--description', 'Opened by fiks']);
  } catch {
    // already exists
  }
  const url = gh(repo, [
    'pr',
    'create',
    '--base',
    base,
    '--head',
    branch,
    '--title',
    prTitle(trace, spec),
    '--body-file',
    bodyFile,
    '--label',
    'fiks',
  ])
    .split('\n')
    .pop() as string;
  const number = Number(/\/pull\/(\d+)/.exec(url)?.[1] ?? 0);
  result.pr = { number, url };
  // The PR must show exactly the commit that passed CI; anything pushed in between is not ours.
  const head = (
    JSON.parse(gh(repo, ['pr', 'view', String(number), '--json', 'headRefOid'])) as { headRefOid: string }
  ).headRefOid;
  if (head !== result.commits.at(-1)) {
    gh(repo, [
      'pr',
      'close',
      String(number),
      '--comment',
      `Closed by fiks: the branch head ${head} is not the commit that passed CI (${result.commits.at(-1)}).`,
    ]);
    return finish('gate_failed', `PR head ${head} differs from the commit that passed CI; PR closed`);
  }
  ev('pr_opened', { url, number });
  wt.remove();
  return finish('pr_opened', `PR ${url}`);
}

export { loadTrace };

// ===========================================================================================
// Experiment mode: the FIKS arm (PLAN 6.2, P11, P17, P23) and FIKS+CU (E4, P12).
// ===========================================================================================

/** Raised for usage errors and refusals; the CLI exits 2 with its message. */
export class ArmUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArmUsageError';
  }
}

export type ArmName = 'fiks' | 'fiks+cu';
export type CiMode = 'local' | 'github' | 'none';
/** Gate names of an experiment attempt, in the order they run. */
export type ArmGateName = 'F' | 'P' | 'suite' | 'traces' | 'typecheck' | 'lint' | 'ci-local';

/**
 * Gate-name mapping for comparisons with legacy (product) logs: a recorded run's `ci` gate is
 * the experiment's `ci-local` (both are the repo's CI; product runs it on GitHub). `local` (the
 * product's combined local gate) has no single experiment counterpart and keeps its name.
 */
export function canonicalGateName(name: string): string {
  return name === 'ci' ? 'ci-local' : name;
}

/** Gate verdicts by canonical name and pass/fail only (messages differ between runs). */
export function gateVerdicts(gates: { gate: string; ok: boolean }[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const g of gates) out[canonicalGateName(g.gate)] = g.ok;
  return out;
}

export type ArmStatus =
  | 'would_open_pr'
  | 'contract_update_proposed'
  | 'gate_failed'
  | 'agent_failed'
  | 'infra_error';

export interface ArmGate {
  gate: ArmGateName;
  ok: boolean;
  reason: string;
  session: number;
  /** Candidate captured right before this gate ran. */
  candidateId?: string;
  ms: number;
}

export interface ArmResult {
  status: ArmStatus;
  reason: string;
  runKey: string;
  arm: ArmName;
  domain: string;
  base: string;
  baseCommit: string;
  traceId: string;
  propertyIds: string[];
  profile: RerecordProfile;
  gates: ArmGate[];
  sessions: number;
  turns: number;
  costUsd: number;
  tokens: TokenUsage;
  /** Final head (fix + fiks re-recordings committed), when every gate passed. */
  headSha: string | null;
  /** The commit holding fiks's repro test on top of the base (the head every gate starts from). */
  reproCommit: string | null;
  fixFiles: string[];
  rerecorded: string[];
  /** The `would_open_pr` event, when one was recorded. */
  wouldOpenPr?: { at: string; headSha: string };
  /** FIKS+CU: the accepted proposal, or the reasons of each rejection. */
  contractUpdate?: { accepted: boolean; reasons: string[]; proposal?: string }[];
  pushAttempts: number;
  dir: string;
  startedAt: string;
  finishedAt: string;
}

export interface ArmOptions {
  arm: ArmName;
  /** RunKey or its string form. Without one, an `adhoc/...` key is made (next free attempt). */
  runKey?: RunKey | string;
  domain?: string;
  /** A trace file (e.g. a frozen trace). */
  traceFile?: string;
  /** Or capture this scenario's trace first (host harness on the seed checkout). */
  scenario?: string;
  /** Local ref of the tool repo, peeled with ^{commit}; never fetched (P17). */
  base: string;
  ci?: CiMode;
  model?: string;
  traceFormat?: TraceFormat;
  /** `--agent-stub <script.json>`: SAFE's stub runner, zero LLM calls. */
  agentStub?: string;
  /** Tests: a runner object instead of the agent or the stub. */
  runner?: RepairRunner;
  /** Injector rule or drift package (the profile's rule); default: from the trace's profile. */
  rule?: string;
  /** FIKS+CU: the domain's clean v1 corpus (CallRecord JSON files). */
  cleanCorpus?: string;
  /** FIKS+CU: extra directories of stored true-violation traces. */
  storedTraces?: string[];
  fetch?: boolean;
  /** F-gate runs (P13: 3; 10 for D3). */
  fRuns?: number;
  maxSessions?: number;
  maxTurns?: number;
  maxBudgetUsd?: number;
  wallMs?: number;
  /** Per-repo sandbox image; default: built from the base's lockfile (BuildKit cache). */
  repoImage?: string;
  /** fiks-tools image; default FIKS_TOOLS_IMAGE, else fiks-tools:<commit12>. */
  toolsImage?: string;
  /** Accept a test-only fiks-tools image (built with --apply-fragments). Never in runs. */
  testTools?: boolean;
  /** Results root (default <FIKS_DIR>/runs). */
  outRoot?: string;
  keepWorktree?: boolean;
  /** Progress lines (default: stderr). */
  log?: (line: string) => void;
}

const ARM_RUNNER_ID: Record<ArmName, string> = { fiks: 'FIKS', 'fiks+cu': 'FIKS+CU' };
const sha256 = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex');
const gitq = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
const COMMITTER = ['-c', 'user.name=fiks', '-c', 'user.email=fiks@localhost'];

/** The fiks commit this process runs (recorded in every AttemptRecord). */
export function fiksCommit(): string {
  try {
    return gitq(ROOT, 'rev-parse', 'HEAD');
  } catch {
    return 'unknown';
  }
}

/** The registered Docker backend factory (bootstrap/20-sandbox.ts). */
export function sandboxBackendFactory(): (opts: DockerExecBackendOptions) => DockerExecBackend {
  const f = (globalThis as Record<symbol, unknown>)[Symbol.for('fiks.sandbox.backend.factory')];
  if (typeof f !== 'function')
    throw new Error('no sandbox backend is registered (packages/cli/src/bootstrap/20-sandbox.ts not loaded)');
  return f as (opts: DockerExecBackendOptions) => DockerExecBackend;
}

// --- Injector rules -------------------------------------------------------------------------

/** Where rules are looked up by id + hash when a trace names only its profile. */
export function ruleSearchFiles(): string[] {
  const dirs = [
    ...(process.env.FIKS_INJECTOR_RULE_DIRS ?? '').split(':').filter(Boolean),
    join(ROOT, 'packages/injector/fixtures/rules'),
  ];
  const out: string[] = [];
  for (const d of dirs) {
    try {
      for (const f of readdirSync(d).sort()) if (f.endsWith('.json')) out.push(join(d, f));
    } catch {}
  }
  // Drift packages that keep their rule next to the manifest (DOM2: <id>/rule.json).
  for (const d of [join(ROOT, 'packages/vendor-tracker/fixtures/driftpkgs')]) {
    try {
      for (const e of readdirSync(d).sort()) {
        const f = join(d, e, 'rule.json');
        if (existsSync(f)) out.push(f);
      }
    } catch {}
  }
  return out;
}

/** A rule file or a drift package manifest -> the loaded rule (hash checked). */
export function loadRuleArg(file: string): LoadedRule {
  const abs = resolve(file);
  const raw = JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
  const rule = 'injectorRule' in raw ? loadDriftPackage(abs).rule : readRule(abs);
  const want = ruleHash(rule, rule.transformPath);
  if (want !== rule.hash)
    throw new ArmUsageError(`injector rule ${rule.id}: stored hash ${rule.hash} != ${want}`);
  return rule;
}

export function findRule(ruleId: string, hash: string | null): LoadedRule | undefined {
  for (const f of ruleSearchFiles()) {
    try {
      const r = readRule(f);
      if (r.id === ruleId && (hash === null || r.hash === hash) && ruleHash(r, r.transformPath) === r.hash)
        return r;
    } catch {}
  }
  return undefined;
}

/** The rule as the container sees it: its transform under /opt/fiks, or bind-mounted at its host path. */
function containerRule(rule: LoadedRule): { json: string; mounts: Mount[] } {
  const { file: _file, transformPath, ...plain } = rule;
  const rel = relative(ROOT, transformPath);
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    return { json: JSON.stringify({ ...plain, transformPath: `${TOOLS_DIR}/${rel}` }), mounts: [] };
  }
  const dir = dirname(transformPath);
  return {
    json: JSON.stringify({ ...plain, transformPath }),
    mounts: [{ type: 'bind', source: dir, target: dir, readonly: true }],
  };
}

// --- Host-side verification of fiks's re-recordings -----------------------------------------

/**
 * A re-recording is written inside the container while candidate code runs, so its bytes are
 * not trusted as read. fiks replays every recorded request against a fresh, trusted upstream
 * chain on the host (vendor + the profile's injector rule, the recording's frozen clock; no
 * tool code) and requires the same status and body for each exchange. Returns the problems.
 */
export async function verifyAgainstUpstream(
  rec: Recording,
  profile: RerecordProfile,
  rule: InjectorRule | undefined,
): Promise<string[]> {
  const domain = profile.domain;
  const d = harnessDomain(domain);
  const version = rule ? profile.base : d && d.id !== 'shop' ? rec.upstream?.version : vendorVersionOf(rec);
  if (!version) return ['the re-recording names no vendor version'];
  const drifts = rule ? undefined : rec.upstream?.drifts?.join(',');
  const clock = new Date(rec.upstream?.clock ?? rec.capturedAt);
  const now = () => clock;
  const vendor = d
    ? d.createVendor('original', { version, drifts, now })
    : createVendor({ version: version as 'v1' | 'v2', drifts, now });
  const closers: (() => Promise<void>)[] = [];
  const problems: string[] = [];
  try {
    let url = await vendor.listen();
    if (rule) {
      const link: UpstreamMiddleware = d ? d.injectorHook(rule) : injectorMiddleware(rule);
      const started = await link.start(url);
      closers.push(() => started.close());
      url = started.url;
    }
    const exchanges = [...(rec.http ?? []), ...(rec.probe?.http ?? [])];
    for (const [i, e] of exchanges.entries()) {
      const u = new URL(e.request.url);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(e.request.headers ?? {})) {
        if (!/^(host|content-length|connection|transfer-encoding)$/i.test(k) && typeof v === 'string')
          headers[k] = v;
      }
      const res = await fetch(`${url}${u.pathname}${u.search}`, {
        method: e.request.method,
        headers,
        ...(e.request.body && !/^(GET|HEAD)$/i.test(e.request.method) ? { body: e.request.body } : {}),
      });
      const body = await res.text();
      if (res.status !== e.response.status || body !== e.response.body)
        problems.push(
          `exchange ${i} (${e.request.method} ${u.pathname}${u.search}): recorded ${e.response.status} differs from the trusted upstream's ${res.status}${body !== e.response.body ? ' (body differs)' : ''}`,
        );
    }
  } catch (err) {
    problems.push(
      `could not replay against the trusted upstream: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    for (const c of closers.reverse()) await c().catch(() => undefined);
    await vendor.close().catch(() => undefined);
  }
  return problems;
}

// --- The container suite (F and P gates run CORE's gate logic on it) -------------------------

interface SyncContainer {
  name: string;
  /** docker exec with exactly SANDBOX_ENV; synchronous (CORE's suite hook is synchronous). */
  exec(argv: string[], cwd: string, timeoutMs?: number): { code: number; stdout: string; stderr: string };
}

function syncContainer(name: string, egressLog: string): SyncContainer {
  return {
    name,
    exec(argv, cwd, timeoutMs = 20 * 60_000) {
      const env = Object.entries(SANDBOX_ENV).map(([k, v]) => `${k}=${v}`);
      const r = spawnSync('docker', ['exec', '-w', cwd, name, 'env', '-i', ...env, ...argv], {
        env: dockerCliEnv(),
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        timeout: timeoutMs,
      });
      const out = { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
      logEgress(egressLog, name, argv, `${out.stdout}\n${out.stderr}`);
      return out;
    },
  };
}

function logEgress(file: string, container: string, argv: string[], output: string): void {
  const lines = output.split('\n').filter((l) => EGRESS_DENIAL.test(l));
  if (!lines.length) return;
  mkdirSync(dirname(file), { recursive: true });
  const at = new Date().toISOString();
  for (const line of lines.slice(0, 20))
    appendFileSync(
      file,
      `${JSON.stringify({ at, container, argv: argv.slice(0, 8), denied: true, line: line.slice(0, 500) })}\n`,
    );
}

interface VitestJson {
  testResults: {
    name: string;
    status: string;
    message?: string;
    assertionResults: { fullName: string; status: string; failureMessages: string[] }[];
  }[];
}

/**
 * The repo's vitest suite run inside the container, reported exactly like CORE's `runSuite`
 * (`@fiks/repro`): the worktree is mounted at its host path, so file names and messages match.
 */
export function containerSuiteRun(sc: SyncContainer, repoDir: string, filters: string[] = []): SuiteRun {
  const id = randomBytes(6).toString('hex');
  const inside = `/tmp/fiks-gate-${id}.json`;
  const args = ['run', '--reporter=json', `--outputFile=${inside}`, '--testTimeout=60000', ...filters];
  const command = `vitest ${args.join(' ')}`;
  const r = sc.exec([join(repoDir, 'node_modules/.bin/vitest'), ...args], repoDir);
  const cat = sc.exec(['cat', inside], '/tmp');
  sc.exec(['rm', '-f', inside], '/tmp');
  const logPath = join(mkdtempIn(tmpdir(), 'fiks-gate-'), 'vitest.json');
  writeFileSync(logPath, cat.stdout);
  let report: VitestJson;
  try {
    report = JSON.parse(cat.stdout) as VitestJson;
  } catch {
    const tail = (r.stderr || r.stdout || '').slice(0, 2000);
    return {
      exitCode: r.code,
      failed: [],
      files: [],
      suiteErrors: [`no vitest report: ${tail}`],
      logPath,
      command,
    };
  }
  const realRepo = realpathSync(repoDir);
  const failed: SuiteRun['failed'] = [];
  const files: SuiteRun['files'] = [];
  const suiteErrors: string[] = [];
  for (const file of report.testResults) {
    let abs = file.name;
    try {
      abs = realpathSync(file.name);
    } catch {}
    const rel = relative(realRepo, abs);
    files.push({ file: rel, statuses: file.assertionResults.map((a) => a.status) });
    const fails = file.assertionResults.filter((a) => a.status === 'failed');
    for (const a of fails)
      failed.push({ file: rel, test: a.fullName, message: a.failureMessages.join('\n').slice(0, 4000) });
    if (file.status === 'failed' && fails.length === 0)
      suiteErrors.push(`${rel}: ${file.message ?? 'suite failed to run'}`);
  }
  return { exitCode: r.code, failed, files, suiteErrors, logPath, command };
}

function mkdtempIn(parent: string, prefix: string): string {
  const dir = join(parent, `${prefix}${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Registers a per-attempt Domain whose suite runs in the container, so CORE's failGate/passGate
 * (the same code as on the host) judge the container run. Everything else is the domain's own.
 */
export function registerSandboxDomain(domain: string, sc: SyncContainer): string {
  const base: Domain | { reproEmitter: Domain['reproEmitter']; suite: Domain['suite'] } = listDomains().some(
    (d) => d.id === domain,
  )
    ? getDomain(domain)
    : { reproEmitter: shopReproEmitter, suite: shopSuite };
  const id = `${domain}-sbx-${randomBytes(5).toString('hex')}`;
  const suite: Domain['suite'] = {
    scope: base.suite.scope,
    oneFailingInScope: base.suite.oneFailingInScope,
    run(repoDir, scope = base.suite.scope) {
      if (isWholeSuite(scope)) return containerSuiteRun(sc, repoDir);
      const filters = scope.map((g) => g.split(/[*?]/)[0] ?? '').filter(Boolean);
      return containerSuiteRun(sc, repoDir, filters);
    },
  };
  registerDomain({ ...(base as Domain), id, suite });
  return id;
}

/** Kills every process in the container except its init and `sleep infinity` (no helper survives). */
const REAP = `const fs=require('fs');for(const p of fs.readdirSync('/proc')){if(!/^\\d+$/.test(p))continue;const n=+p;if(n===1||n===process.pid||n===process.ppid)continue;let c='';try{c=fs.readFileSync('/proc/'+p+'/cmdline','utf8')}catch{continue}if(c==='sleep\\0infinity\\0'||c.startsWith('/sbin/docker-init')||c.startsWith('docker-init'))continue;try{process.kill(n,9)}catch{}}`;

// --- Stored traces, corpus and mutation variants for FIKS+CU --------------------------------

function jsonFiles(dir: string, filter: (rel: string) => boolean = () => true): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(d).sort();
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith('.json') && filter(relative(dir, p))) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Stored true-violation traces of the head (test/traces/**, test/repro/*.json) plus extra dirs. */
export function storedViolationTraces(
  worktree: string,
  extra: string[] = [],
  triggerId?: string,
): Recording[] {
  const files = [
    ...jsonFiles(join(worktree, 'test/traces')),
    ...jsonFiles(join(worktree, 'test/repro'), (r) => !r.includes('/')),
    ...extra.flatMap((d) => jsonFiles(resolve(d))),
  ].filter((f) => !f.endsWith('.rerecorded.json'));
  const out: Recording[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    try {
      const r = JSON.parse(readFileSync(f, 'utf8')) as Recording;
      if (!Array.isArray(r.http) || !r.violated?.length) continue;
      // The frozen trace is the trigger (PLAN 6.2), never one of its own stored violations.
      if (r.id === triggerId || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    } catch {}
  }
  return out;
}

export function loadCorpus(dir: string): unknown[] {
  return jsonFiles(resolve(dir)).map((f) => JSON.parse(readFileSync(f, 'utf8')));
}

type Exchange = Pick<HttpExchange, 'request' | 'response'>;

/** An upstream link that answers from recorded exchanges (matched by method + path + query, in order). */
export function replayMiddleware(exchanges: Exchange[]): UpstreamMiddleware {
  return {
    name: 'replay',
    async start() {
      const { createServer } = await import('node:http');
      const used = new Set<number>();
      const key = (method: string, url: string) => {
        const u = new URL(url, 'http://x');
        return `${method.toUpperCase()} ${u.pathname}${u.search}`;
      };
      const server = createServer((req, res) => {
        req.resume();
        req.on('end', () => {
          const k = key(req.method ?? 'GET', req.url ?? '/');
          const i = exchanges.findIndex((e, j) => !used.has(j) && key(e.request.method, e.request.url) === k);
          if (i === -1) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'unmatched', message: `no recorded exchange for ${k}` }));
            return;
          }
          used.add(i);
          const e = exchanges[i] as Exchange;
          const headers: Record<string, string> = {};
          for (const [h, v] of Object.entries(e.response.headers ?? {}))
            if (!/^(content-length|transfer-encoding|connection|date)$/i.test(h) && typeof v === 'string')
              headers[h] = v;
          res.writeHead(e.response.status, headers);
          res.end(e.response.body);
        });
      });
      const url = await new Promise<string>((ok) =>
        server.listen(0, '127.0.0.1', () => {
          const a = server.address();
          ok(`http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`);
        }),
      );
      return {
        url,
        close: () =>
          new Promise<void>((ok) => {
            server.closeAllConnections();
            server.close(() => ok());
          }),
      };
    },
  };
}

/**
 * MUT M1-M14 applied to the trigger's recorded upstream response (its first exchange), each
 * re-run through the server at the base (a trusted checkout; no candidate code) with the
 * mutated exchange replayed, through the proxy so a read-after-write probe is recorded too.
 * Also returns the server's declared outputSchemas (tools/list), which the CU gate needs.
 */
export async function mutationVariants(
  trigger: Recording,
  opts: { domain: string; serverDir: string; contracts: ContractFile },
): Promise<{ variants: GateCase[]; schemas: DeclaredOutputSchemas; skipped: string[] }> {
  const variants: GateCase[] = [];
  const skipped: string[] = [];
  let schemas: DeclaredOutputSchemas | undefined;
  const first = trigger.http[0];
  if (!first) return { variants, schemas: {}, skipped: ['the trigger has no upstream exchange'] };
  const probeHttp = trigger.probe?.http ?? [];
  const now = new Date(trigger.capturedAt);
  for (const op of RESPONSE_OPS) {
    const m = mutateRecordedResponse(op, first.response, `${trigger.id}:${op}`, first.request);
    if (!m.mutation.applicable) {
      skipped.push(`${op}: ${m.mutation.note}`);
      continue;
    }
    const exchanges: Exchange[] = [
      { request: first.request, response: m.response },
      ...trigger.http.slice(1),
      ...probeHttp,
    ];
    const h = await startHarness({
      vendor: 'v1',
      domain: opts.domain,
      shopDir: opts.serverDir,
      middleware: [replayMiddleware(exchanges)],
      via: 'proxy',
      contracts: opts.contracts,
      clock: now,
    });
    try {
      schemas ??= declaredOutputSchemas(
        (await (h.proxy as NonNullable<typeof h.proxy>).upstream.listTools()).tools as Parameters<
          typeof declaredOutputSchemas
        >[0],
      );
      const { result, record } = await h.call(trigger.tool, trigger.args);
      variants.push({
        id: `${trigger.id}~${op}`,
        tool: trigger.tool,
        args: trigger.args,
        result: (record?.result ?? result) as GateCase['result'],
        upstream: record?.http,
        probe: record?.probe
          ? {
              tool: record.probe.tool,
              args: record.probe.args,
              result: record.probe.result,
              upstream: record.probe.http,
            }
          : undefined,
        now: trigger.capturedAt,
        mutant: op,
      });
    } finally {
      await h.close();
    }
  }
  return { variants, schemas: schemas ?? {}, skipped };
}

/** The `{outcome: 'contract_update', delta}` an agent ended with, if any (last JSON object that has it). */
export function contractUpdateIn(summary: string): unknown | undefined {
  const candidates: string[] = [];
  for (const m of summary.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) candidates.push(m[1] as string);
  const brace = summary.indexOf('{');
  if (brace !== -1) candidates.push(summary.slice(brace, summary.lastIndexOf('}') + 1));
  for (const c of candidates.reverse()) {
    try {
      const x = JSON.parse(c) as { outcome?: unknown };
      if (x && typeof x === 'object' && x.outcome === 'contract_update') return x;
    } catch {}
  }
  return undefined;
}

const CU_PROMPT = `
## Option: the change may be legitimate (contract update)
If you conclude, from the evidence, that the vendor's new behaviour is legitimate and the contract is what is wrong (for example a real product now costs more than the contract's range allows), you may instead end with a contract update and change no code. Reply with exactly one JSON object of this form in a \`\`\`json fence, after the Subject line:
{"outcome": "contract_update", "delta": {"ops": [...], "rationale": "<why the behaviour is legitimate>"}}
Allowed ops: replaceInvariant {contractId, invariant} (same id, kind and paths; only parameters change), addInvariant, replacePostcondition, setOutputSchema, addKnownGoodInput, removeKnownGoodInput. There is no remove op. A gate checks the update: the trigger must then verify, stored true violations must still violate, the clean v1 corpus must still verify, and mutations of the trigger must still be rejected. If it is rejected you get the reasons and continue as a code repair.
`;

// --- Results layout ---------------------------------------------------------------------------

export function runDir(outRoot: string, key: RunKey): string {
  return join(outRoot, ...formatRunKey(key).split('/'));
}

/** Next free attempt index for an ad-hoc key. */
function adhocKey(outRoot: string, k: Omit<RunKey, 'attempt'>): RunKey {
  for (let attempt = 1; ; attempt++) {
    const key = { ...k, attempt };
    if (!existsSync(runDir(outRoot, key))) return key;
  }
}

// --- The arm ----------------------------------------------------------------------------------

/**
 * One FIKS (or FIKS+CU) attempt: frozen trace -> named-property repro -> F gate (container) ->
 * committed read-only -> agent sessions (Bash in the container) -> per session: rerecord-head
 * before each replay-based check, then P, contract suite, stored traces, typecheck, lint and
 * local CI in the container -> `would_open_pr` only when all are green. Never fetches, pushes,
 * calls gh or opens a PR.
 */
export async function runArm(opts: ArmOptions): Promise<ArmResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const say = opts.log ?? ((l: string) => console.error(l));
  const arm = opts.arm;
  if (arm !== 'fiks' && arm !== 'fiks+cu')
    throw new ArmUsageError(`--arm must be fiks or fiks+cu, not ${arm}`);
  const ci: CiMode = opts.ci ?? 'local';
  if (ci === 'github')
    throw new ArmUsageError('--ci github: experiment mode makes no push and no gh call; use --ci local');
  if (opts.fetch && opts.runKey !== undefined)
    throw new ArmUsageError('--fetch is refused with --run-key (experiments use local refs only, P17)');
  const traceFormat = opts.traceFormat ?? 'raw';
  const outRoot = resolve(opts.outRoot ?? join(FIKS_DIR, 'runs'));
  const stub = opts.agentStub ? loadStubScript(resolve(opts.agentStub)) : undefined;
  if (arm === 'fiks+cu' && !opts.cleanCorpus)
    throw new ArmUsageError('--arm fiks+cu needs --clean-corpus <dir> (the clean v1 CallRecords)');

  // Run key (P6): results are keyed by it and never overwritten.
  let key: RunKey | undefined =
    typeof opts.runKey === 'string' ? parseRunKeyOrThrow(opts.runKey) : opts.runKey;
  const domain = opts.domain ?? key?.domain ?? 'shop';
  if (key && key.domain !== domain)
    throw new ArmUsageError(`--domain ${domain} does not match the run key's domain ${key.domain}`);
  const model = opts.model ?? key?.model ?? process.env.REPAIR_MODEL ?? 'claude-opus-5-5';
  if (key && key.model !== model)
    throw new ArmUsageError(`--model ${model} does not match the run key's model ${key.model}`);
  if (!opts.traceFile && !opts.scenario) throw new ArmUsageError('repair needs --trace or --scenario');
  const repo = repoDir(domain);

  // The base must resolve locally before anything is captured or written.
  let baseCommit: string;
  try {
    baseCommit = gitq(repo, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${opts.base}^{commit}`);
  } catch {
    throw new ArmUsageError(
      `unknown --base ${JSON.stringify(opts.base)} in ${repo}: no local branch, tag or commit by that name (experiments never fetch)`,
    );
  }

  // The frozen trace.
  let traceSrc: string;
  if (opts.traceFile) {
    traceSrc = resolve(opts.traceFile);
    if (!existsSync(traceSrc)) throw new ArmUsageError(`no trace file ${traceSrc}`);
  } else {
    ({ file: traceSrc } = await captureTrace(
      opts.scenario as string,
      `run_${startedAt.replace(/[-:.]/g, '')}`,
      domain,
    ));
  }
  const traceBytes = readFileSync(traceSrc);
  const trace = JSON.parse(traceBytes.toString('utf8')) as Trace;
  const drift = opts.scenario ?? trace.profile?.ruleId ?? trace.id;
  key ??= adhocKey(outRoot, { experiment: 'adhoc', arm: ARM_RUNNER_ID[arm], model, domain, drift });
  const keyStr = formatRunKey(key);
  const dir = runDir(outRoot, key);
  mkdirSync(dirname(dir), { recursive: true });
  try {
    mkdirSync(dir);
  } catch {
    throw new ArmUsageError(
      `results for run key ${keyStr} already exist at ${dir}; results are never overwritten`,
    );
  }
  const frozenPath = join(dir, 'frozen-trace.json');
  writeFileSync(frozenPath, traceBytes);
  const frozenTraceSha = sha256(traceBytes);

  // Profile (P7) and its injector rule.
  let rule: LoadedRule | undefined = opts.rule ? loadRuleArg(opts.rule) : undefined;
  if (!rule && trace.profile?.ruleId) {
    rule = findRule(trace.profile.ruleId, trace.profile.ruleHash);
    if (!rule)
      throw new ArmUsageError(
        `trace profile names injector rule ${trace.profile.ruleId}; none found (pass --rule)`,
      );
  }
  const profile: RerecordProfile =
    trace.profile ??
    (rule
      ? { domain, base: 'v1', ruleId: rule.id, ruleHash: rule.hash }
      : { domain, base: trace.upstream?.version ?? 'v1', ruleId: null, ruleHash: null });
  if (rule && (profile.ruleId !== rule.id || profile.ruleHash !== rule.hash))
    throw new ArmUsageError(`--rule ${rule.id} does not match the trace profile ${JSON.stringify(profile)}`);

  const events = join(dir, 'events.jsonl');
  const ev = (type: string, data: Record<string, unknown> = {}, ok?: boolean) =>
    appendFileSync(
      events,
      `${JSON.stringify({ ts: new Date().toISOString(), runKey: keyStr, type, ...(ok === undefined ? {} : { ok }), data })}\n`,
    );
  const result: ArmResult = {
    status: 'gate_failed',
    reason: '',
    runKey: keyStr,
    arm,
    domain,
    base: opts.base,
    baseCommit,
    traceId: trace.id,
    propertyIds: trace.target ?? trace.violated.map((v) => v.propertyId),
    profile,
    gates: [],
    sessions: 0,
    turns: 0,
    costUsd: 0,
    tokens: zeroTokens(),
    headSha: null,
    reproCommit: null,
    fixFiles: [],
    rerecorded: [],
    pushAttempts: 0,
    dir,
    startedAt,
    finishedAt: startedAt,
  };
  const wall: Record<string, number> = {};
  const phase = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    const s = Date.now();
    try {
      return await fn();
    } finally {
      wall[name] = (wall[name] ?? 0) + (Date.now() - s);
    }
  };
  const candidates: string[] = [];
  const rerecordLog = join(dir, 'rerecord.jsonl');
  let imageDigestStr: string | null = null;
  let backend: DockerExecBackend | undefined;
  let wt: LocalWorktree | undefined;
  ev('attempt_started', {
    arm,
    domain,
    base: opts.base,
    baseCommit,
    traceId: trace.id,
    profile,
    model,
    traceFormat,
  });

  const writeAttempt = (outcome: string | null) => {
    const rec: AttemptRecord = {
      runKey: key as RunKey,
      prExposed: result.status === 'would_open_pr',
      ciFinal:
        ci === 'none'
          ? 'none'
          : result.gates.some((g) => g.gate === 'ci-local')
            ? (result.gates.filter((g) => g.gate === 'ci-local').at(-1) as ArmGate).ok
              ? 'green'
              : 'red'
            : 'none',
      issueValidation: 'n/a',
      ivPlacement: 'none',
      headSha: result.headSha,
      outcome,
      sessions: result.sessions,
      turns: result.turns,
      tokens: result.tokens,
      costUsd: result.costUsd,
      wallMs: wall,
      candidateIds: candidates,
      fiksCommit: fiksCommit(),
      imageDigest: imageDigestStr,
      traceFormat,
      frozenTraceSha,
      rerecordLog: existsSync(rerecordLog) ? rerecordLog : null,
    };
    writeFileSync(join(dir, 'attempt.json'), `${JSON.stringify(rec, null, 2)}\n`);
  };
  const finish = (status: ArmStatus, reason: string): ArmResult => {
    result.status = status;
    result.reason = reason;
    result.finishedAt = new Date().toISOString();
    wall.total = Date.now() - t0;
    writeAttempt(
      status === 'contract_update_proposed'
        ? 'contract_update_proposed'
        : status === 'infra_error'
          ? 'infra_error'
          : null,
    );
    writeFileSync(join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    ev('attempt_finished', { status, reason });
    return result;
  };

  try {
    // 1. Worktree at the local base ref (CORE createWorktree; no fetch; P17).
    wt = createWorktree(repo, opts.base, {
      parent: join(WORK_DIR, 'wt', 'runs'),
      prefix: `${domain}-${trace.id}-`,
      runKey: keyStr,
      fetch: opts.fetch,
    });
    const wtDir = realpathSync(wt.dir);
    const contracts = worktreeContracts(wtDir, domain);
    const contract = findContract(contracts, trace.tool);
    if (!contract) return finish('gate_failed', `no contract for ${trace.tool}`);
    const hooks = reproHooks(domain);
    const allowed = editGuard('allowedEditPaths' in hooks ? (hooks as Domain).allowedEditPaths : undefined);
    const allowedEditPaths = 'allowedEditPaths' in hooks ? (hooks as Domain).allowedEditPaths : undefined;

    // 2. The per-attempt container: repo image, fiks-tools read-only, the repo's git dir read-only.
    const repoImage = await phase(
      'setup',
      async () => opts.repoImage ?? (await buildRepoImageFor(repo, baseCommit)),
    );
    imageDigestStr = await imageDigest(repoImage);
    const tools = opts.toolsImage ?? process.env.FIKS_TOOLS_IMAGE ?? defaultToolsImage(opts.testTools);
    const commonDir = realpathSync(resolve(wtDir, gitq(wtDir, 'rev-parse', '--git-common-dir')));
    const cRule = rule ? containerRule(rule) : undefined;
    const mounts: Mount[] = [
      ...(await toolsMounts(tools, { purpose: opts.testTools ? 'test' : 'run' })),
      { type: 'bind', source: commonDir, target: commonDir, readonly: true },
      ...(cRule?.mounts ?? []),
    ];
    const egressLog = join(dir, 'egress.jsonl');
    backend = sandboxBackendFactory()({
      worktree: wtDir,
      image: repoImage,
      workdir: wtDir,
      mounts,
      egressLog,
      name: `fiks-orch-${randomBytes(5).toString('hex')}`,
    });
    await phase('setup', () => (backend as DockerExecBackend).start());
    const sb = backend;
    const sc = syncContainer(sb.name, egressLog);
    const reap = () => sc.exec(['/usr/local/bin/node', '-e', REAP], '/tmp', 60_000);
    const sbxDomain = registerSandboxDomain(domain, sc);
    ev('sandbox_started', { container: sb.name, image: imageDigestStr, tools, workdir: wtDir });

    const capture = (stage: CandidateStage, gate: string, session: number, diffBase: string): string => {
      const diff = gitDiffAll(wtDir, diffBase);
      const id = `c${String(candidates.length + 1).padStart(3, '0')}`;
      mkdirSync(join(dir, 'candidates'), { recursive: true });
      const diffPath = join(dir, 'candidates', `${id}.diff`);
      writeFileSync(diffPath, diff);
      const rec: CandidateRecord = { id, runKey: key as RunKey, stage, diffSha: sha256(diff), diffPath };
      writeFileSync(join(dir, 'candidates', `${id}.json`), `${JSON.stringify(rec, null, 2)}\n`);
      appendFileSync(
        join(dir, 'candidates.jsonl'),
        `${JSON.stringify({ id, stage, gate, session, at: new Date().toISOString() })}\n`,
      );
      candidates.push(id);
      return id;
    };

    // 3. Repro test + F gate in the container, committed on its own.
    const spec = await phase('repro', () => generateRepro(trace, frozenPath, wtDir, domain));
    ev('repro_generated', { testPath: spec.testPath });
    const fCand = capture('gate', 'F', 0, baseCommit);
    const fStart = Date.now();
    const gateF = await phase('repro', () => failGate(wtDir, spec, opts.fRuns ?? 3, sbxDomain));
    result.gates.push({
      gate: 'F',
      ok: gateF.ok,
      reason: gateF.reason,
      session: 0,
      candidateId: fCand,
      ms: Date.now() - fStart,
    });
    ev('gate_F', { reason: gateF.reason }, gateF.ok);
    const reproRecord: ReproTestRecord = {
      runKey: key,
      source: 'fiks',
      round: 0,
      path: spec.testPath,
      sha: sha256(readFileSync(join(wtDir, spec.testPath))),
      fOnBase: fOnBase(gateF),
      isFinal: true,
      isFirst: true,
      recordingsRead: [spec.tracePath],
      inlineRecording: false,
    };
    mkdirSync(join(dir, 'repro'), { recursive: true });
    writeFileSync(join(dir, 'repro', 'fiks.json'), `${JSON.stringify(reproRecord, null, 2)}\n`);
    if (!gateF.ok) return finish('gate_failed', `F gate: ${gateF.reason}`);
    gitq(wtDir, 'add', '--', spec.testPath, spec.tracePath);
    gitq(
      wtDir,
      ...COMMITTER,
      'commit',
      '-q',
      '-m',
      `test: failing repro for ${result.propertyIds.join(', ')} (fiks)`,
      '-m',
      `Trace ${trace.id}. F gate: ${gateF.reason}.`,
    );
    const reproCommit = gitq(wtDir, 'rev-parse', 'HEAD');
    result.reproCommit = reproCommit;

    // FIKS+CU inputs that do not depend on the agent: corpus, stored traces, mutation variants.
    let cu:
      | { corpus: unknown[]; stored: Recording[]; variants: GateCase[]; schemas: DeclaredOutputSchemas }
      | undefined;
    if (arm === 'fiks+cu') {
      cu = await phase('cu-inputs', async () => {
        const corpus = loadCorpus(opts.cleanCorpus as string);
        const stored = storedViolationTraces(wtDir, opts.storedTraces, trace.id);
        const m = await mutationVariants(trace, { domain, serverDir: repoAt(baseCommit, domain), contracts });
        writeFileSync(
          join(dir, 'cu-inputs.json'),
          `${JSON.stringify({ corpus: corpus.length, stored: stored.map((s) => s.id), variants: m.variants.map((v) => v.mutant), skipped: m.skipped }, null, 2)}\n`,
        );
        return { corpus, stored, variants: m.variants, schemas: m.schemas };
      });
    }

    // 4. Agent sessions (<= maxSessions; per session maxTurns and maxBudgetUsd; 90 min wall).
    const runner = opts.runner ?? (stub ? stubRunner(stub) : createAgentSdkRunner());
    const maxSessions = opts.maxSessions ?? 4;
    const wallCap = opts.wallMs ?? 90 * 60_000;
    let feedback: string | undefined;
    let lastSession: string | undefined;
    let summary = '';
    let passed = false;
    const owned: Record<string, string> = {};
    const ownedBytes: Record<string, string> = {};
    mkdirSync(join(dir, 'sessions'), { recursive: true });
    for (let n = 1; n <= maxSessions; n++) {
      if (Date.now() - t0 > wallCap) {
        feedback = `wall-clock cap of ${Math.round(wallCap / 60_000)} min reached`;
        break;
      }
      result.sessions = n;
      const prompt =
        n === 1 || !lastSession
          ? `${buildPrompt({ trace, spec, contract, gateF, worktree: wtDir, previousFailure: n === 1 ? undefined : feedback, traceFormat })}${arm === 'fiks+cu' ? CU_PROMPT : ''}`
          : sessionMessage(feedback ?? '');
      writeFileSync(join(dir, 'sessions', `${n}.prompt.md`), prompt);
      const job: RunnerJob = {
        worktree: wtDir,
        prompt,
        model,
        maxTurns: opts.maxTurns ?? 30,
        maxBudgetUsd: opts.maxBudgetUsd ?? 5,
        traceFormat,
        allowedEditPaths,
        backend: sb,
        onCandidate: (_diff, stage) => {
          capture(stage, 'agent-check', n, reproCommit);
        },
        ...(n > 1 && lastSession
          ? { resume: { sessionId: lastSession, message: prompt, turnsUsed: 0, costUsd: 0 } }
          : {}),
      };
      ev('session_started', { session: n, runner: runner.kind, model, resume: Boolean(job.resume) });
      const run: RunnerResult = await phase('agent', () => runner.run(job, new AbortController().signal));
      result.turns += run.turns ?? 0;
      result.costUsd += run.costUsd ?? 0;
      if (run.tokens)
        for (const k of Object.keys(result.tokens) as (keyof TokenUsage)[]) result.tokens[k] += run.tokens[k];
      lastSession = run.sessionId ?? lastSession;
      summary = run.summary;
      writeFileSync(join(dir, 'sessions', `${n}.log`), `${run.log}\n\n${run.summary}\n`);
      ev(
        'session_finished',
        {
          session: n,
          outcome: run.outcome ?? (run.ok ? 'completed' : 'agent_error'),
          turns: run.turns,
          denials: run.denials ?? [],
        },
        run.ok,
      );
      if (run.outcome === 'infra_error')
        return finish('infra_error', `runner infra error: ${run.summary.slice(0, 300)}`);
      if (run.outcome === 'refused')
        return finish('agent_failed', `runner refused: ${run.summary.slice(0, 300)}`);

      // FIKS+CU: a contract update instead of code.
      const proposal = arm === 'fiks+cu' ? contractUpdateIn(run.summary) : undefined;
      if (proposal !== undefined && cu) {
        const parsed = parseOutcome(proposal);
        const codeChanged = changedFilesSince(wtDir, reproCommit).filter((f) => !isNodeModules(f));
        let res: CuGateResult | undefined;
        let reasons: string[];
        if (!parsed.ok) reasons = parsed.errors;
        else if (codeChanged.length)
          reasons = [`a contract update changes no code, but these files changed: ${codeChanged.join(', ')}`];
        else {
          res = acceptDelta(parsed.value.delta, {
            contracts,
            trigger: trace,
            storedViolations: cu.stored,
            cleanCorpus: cu.corpus as Parameters<typeof acceptDelta>[1]['cleanCorpus'],
            mutationVariants: cu.variants,
            declaredOutputSchemas: cu.schemas,
          });
          reasons = res.reasons;
        }
        const entry: NonNullable<ArmResult['contractUpdate']>[number] = {
          accepted: Boolean(res?.accepted),
          reasons,
        };
        result.contractUpdate = [...(result.contractUpdate ?? []), entry];
        ev('contract_update', { session: n, accepted: entry.accepted, reasons }, entry.accepted);
        if (res?.accepted) {
          const vendoredPath = vendoredContractsPath(wtDir) ?? `contracts/${contracts.server}.contracts.json`;
          const p = renderProposal(contracts, res, { contractsPath: vendoredPath });
          mkdirSync(join(dir, 'proposal'), { recursive: true });
          writeFileSync(join(dir, 'proposal', 'proposal.md'), p.markdown);
          writeFileSync(join(dir, 'proposal', 'contracts.diff'), p.diff);
          writeFileSync(
            join(dir, 'proposal', 'proposed.contracts.json'),
            `${JSON.stringify(p.proposed, null, 2)}\n`,
          );
          entry.proposal = join(dir, 'proposal', 'proposal.md');
          writeFileSync(join(dir, 'result.cu.json'), `${JSON.stringify(res, null, 2)}\n`);
          return finish('contract_update_proposed', 'CU accepted the contract update; no PR');
        }
        feedback = `## Your contract update was rejected by the gate\n${reasons.map((r) => `- ${r}`).join('\n')}\nThe attempt continues as a code repair: fix the code under src/ so the repro test passes.`;
        continue;
      }

      // Code repair: guard, then the gates in the container.
      if (headOf(wtDir) !== reproCommit) {
        feedback = 'You created git commits. Do not commit; only edit files under src/.';
        gitq(wtDir, 'reset', '--soft', reproCommit);
        continue;
      }
      const files = changedFilesSince(wtDir, reproCommit).filter((f) => !isNodeModules(f));
      const guard = checkPaths(files, allowed);
      if (!guard.ok) {
        feedback = guard.rejected.length
          ? `You changed files outside the allowed paths: ${guard.rejected.join(', ')}. Only src/ may change.`
          : `No source change was made. You said: ${run.summary.slice(0, 500)}`;
        restoreNonSource(wtDir, reproCommit, allowed);
        ev('gate_guard', { session: n, reason: feedback }, false);
        continue;
      }
      result.fixFiles = files;
      for (const k of Object.keys(owned)) delete owned[k];
      for (const k of Object.keys(ownedBytes)) delete ownedBytes[k];
      for (const f of files) owned[f] = fileHash(wtDir, f);
      const g = await phase('gates', () =>
        runGates({
          n,
          wtDir,
          sc,
          sb,
          reap,
          spec,
          sbxDomain,
          profile,
          rule,
          ruleJson: cRule?.json,
          reproCommit,
          rerecordLog,
          ci,
          repoImage,
          owned,
          ownedBytes,
          capture,
          push: (gate) => result.gates.push(gate),
          ev,
        }),
      );
      if (g.ok) {
        passed = true;
        result.rerecorded = Object.keys(ownedBytes).sort();
        break;
      }
      feedback = g.feedback;
      restoreNonSource(wtDir, reproCommit, allowed);
    }
    if (!passed) {
      const anyGate = result.gates.some((x) => x.session > 0);
      return finish(
        anyGate ? 'gate_failed' : 'agent_failed',
        `no session passed every gate: ${(feedback ?? '').slice(0, 1500)}`,
      );
    }

    // 5. Every gate and local CI green: commit (src/ only, then fiks's re-recordings from memory)
    // for a gradeable head, then `would_open_pr`. Nothing is pushed.
    gitq(wtDir, 'add', '--', ...result.fixFiles);
    const subject = /^Subject:\s*(.+)$/m.exec(summary)?.[1]?.trim();
    const title =
      subject && subject.length <= 60
        ? subject
        : `repair ${result.propertyIds.map((p) => p.split('/')[1]).join(', ')}`;
    const body = summary
      .replace(/^Subject:.*\n?/m, '')
      .replaceAll(`${wtDir}/`, '')
      .trim()
      .slice(0, 2000);
    gitq(
      wtDir,
      ...COMMITTER,
      'commit',
      '-q',
      '-m',
      `fix(${trace.tool}): ${title} (fiks)`,
      '-m',
      body || title,
    );
    if (result.rerecorded.length) {
      for (const f of result.rerecorded) writeFileSync(join(wtDir, f), ownedBytes[f] as string);
      gitq(wtDir, 'add', '--', ...result.rerecorded);
      gitq(
        wtDir,
        ...COMMITTER,
        'commit',
        '-q',
        '-m',
        'test: re-record changed upstream calls (fiks)',
        '-m',
        result.rerecorded.join('\n'),
      );
    }
    const headSha = gitq(wtDir, 'rev-parse', 'HEAD');
    const committed = changedFilesSince(wtDir, reproCommit).filter((f) => !isNodeModules(f));
    const tampered = changedSinceSnapshot(wtDir, owned, 'HEAD');
    if (tampered.length || committed.some((f) => !(f in owned)))
      return finish(
        'gate_failed',
        `committed files differ from the checked bytes: ${tampered.join(', ') || committed.filter((f) => !(f in owned)).join(', ')}`,
      );
    result.headSha = headSha;
    gitq(repo, 'update-ref', `refs/fiks/runs/${keyStr}`, headSha);
    const diff = gitq(wtDir, 'diff', `${reproCommit}..${headSha}`, '--', '.');
    writeFileSync(
      join(dir, 'pr-draft.md'),
      prBody({
        trace,
        spec,
        gates: [
          gateF,
          ...result.gates
            .filter((x) => x.gate !== 'F')
            .map(
              (x): GateResult => ({
                gate: x.gate === 'ci-local' ? 'ci' : x.gate === 'P' ? 'P' : 'local',
                ok: x.ok,
                reason: `${x.gate}: ${x.reason}`,
                evidence: { command: x.gate, exitCode: x.ok ? 0 : 1, failed: [], logPath: '' },
              }),
            ),
        ],
        diff,
        diffStat: gitq(wtDir, 'diff', '--stat', `${reproCommit}..${headSha}`, '--', '.'),
        agentSummary: body,
        runner: runner.kind,
        model,
        rerecorded: result.rerecorded,
        repoUrl: `https://github.com/${harnessDomain(domain)?.repo.slug ?? 'vats98754/shop-mcp'}`,
        branch: `fiks/run/${keyStr}`,
      }),
    );
    result.wouldOpenPr = { at: new Date().toISOString(), headSha };
    ev('would_open_pr', { headSha, ciLocal: ci === 'local' ? 'green' : 'none' }, true);
    return finish(
      'would_open_pr',
      ci === 'local'
        ? 'every gate and local CI green; no PR in experiment mode'
        : 'every gate green (--ci none); no PR in experiment mode',
    );
  } catch (e) {
    if (e instanceof ArmUsageError) {
      finish('gate_failed', e.message);
      throw e;
    }
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    writeFileSync(join(dir, 'error.txt'), msg);
    return finish('infra_error', msg.split('\n')[0] ?? msg);
  } finally {
    if (backend) {
      try {
        result.pushAttempts = (await backend.pushAttempts()).length;
        writeFileSync(join(dir, 'push-attempts.json'), JSON.stringify(await backend.pushAttempts(), null, 2));
      } catch {}
      await backend.cleanup().catch(() => undefined);
    }
    if (wt && !opts.keepWorktree) {
      try {
        wt.remove();
      } catch {}
    } else if (wt) say(`worktree kept: ${wt.dir}`);
    writeFileSync(join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  }
}

function parseRunKeyOrThrow(s: string): RunKey {
  try {
    return parseRunKey(s);
  } catch (e) {
    throw new ArmUsageError(e instanceof Error ? e.message : String(e));
  }
}

const isNodeModules = (f: string) => f === 'node_modules' || f.startsWith('node_modules/');

function fOnBase(g: GateResult): FOnBase {
  if (g.ok) return 'fail';
  if (/passed on unfixed code/.test(g.reason)) return 'pass';
  return 'error';
}

function sessionMessage(feedback: string): string {
  return `${feedback}\n\nContinue the repair: change only files under src/, check with pnpm typecheck, pnpm lint and pnpm test, then reply with the Subject line and one short paragraph.`;
}

/** The candidate patch: tracked changes against `base` plus untracked files (node_modules excluded). */
function gitDiffAll(wt: string, base: string): string {
  const run = (args: string[]) =>
    spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: wt,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }).stdout ?? '';
  const tracked = run(['diff', '--binary', base, '--', '.', ':(exclude)node_modules']);
  const untracked = run(['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .filter((f) => f && !isNodeModules(f))
    .sort()
    .map((f) => run(['diff', '--binary', '--no-index', '--', '/dev/null', f]));
  return [tracked, ...untracked].join('');
}

/** Puts every path outside the edit guard back to `commit` (fiks's leftovers and anything else). */
function restoreNonSource(wt: string, commit: string, allowed: (f: string) => boolean): void {
  for (const f of changedFilesSince(wt, commit)) {
    if (isNodeModules(f) || allowed(f)) continue;
    let tracked = true;
    try {
      gitq(wt, 'cat-file', '-e', `${commit}:${f}`);
    } catch {
      tracked = false;
    }
    if (tracked) gitq(wt, 'checkout', commit, '--', f);
    else rmSync(join(wt, f), { force: true, recursive: true });
  }
}

/** The contracts file vendored in the target repo, if any (relative path). */
function vendoredContractsPath(wt: string): string | undefined {
  try {
    const f = readdirSync(join(wt, 'test/fiks/vendored')).find((x) => x.endsWith('.contracts.json'));
    return f ? `test/fiks/vendored/${f}` : undefined;
  } catch {
    return undefined;
  }
}

/** The contracts in force at the base: the repo's vendored copy, else the domain's. */
export function worktreeContracts(wt: string, domain: string): ContractFile {
  const v = vendoredContractsPath(wt);
  if (v) return JSON.parse(readFileSync(join(wt, v), 'utf8')) as ContractFile;
  return domain === 'shop' ? SHOP_CONTRACTS : contractsOf(domain);
}

async function buildRepoImageFor(repo: string, commit: string): Promise<string> {
  const { buildRepoImage } = await import('@fiks/sandbox');
  return (await buildRepoImage({ repo, ref: commit })).digest;
}

function defaultToolsImage(testOnly?: boolean): string {
  const c = fiksCommit().slice(0, 12);
  const candidates = [`fiks-tools:${c}`, ...(testOnly ? [`fiks-tools-test:${c}`] : [])];
  for (const tag of candidates) {
    const r = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', tag], {
      env: dockerCliEnv(),
      encoding: 'utf8',
    });
    if (r.status === 0) return tag;
  }
  throw new ArmUsageError(
    `no fiks-tools image for commit ${c}: build one (pnpm tsx packages/sandbox/src/build-tools.ts) or pass --tools-image / FIKS_TOOLS_IMAGE`,
  );
}

interface GateRun {
  n: number;
  wtDir: string;
  sc: SyncContainer;
  sb: DockerExecBackend;
  reap: () => unknown;
  spec: ReturnType<typeof generateRepro>;
  sbxDomain: string;
  profile: RerecordProfile;
  rule?: LoadedRule;
  ruleJson?: string;
  reproCommit: string;
  rerecordLog: string;
  ci: CiMode;
  repoImage: string;
  owned: Record<string, string>;
  ownedBytes: Record<string, string>;
  capture: (stage: CandidateStage, gate: string, session: number, diffBase: string) => string;
  push: (g: ArmGate) => void;
  ev: (type: string, data?: Record<string, unknown>, ok?: boolean) => void;
}

/** The files a check must not see changed: the agent's source and fiks's re-recordings. */
function tamperCheck(g: GateRun): string[] {
  return changedSinceSnapshot(g.wtDir, g.owned);
}

/**
 * `rerecord-head --require-sandbox` in the container (SBX execFiks; P23) before a check. New
 * stale re-recordings are verified against the trusted upstream on the host and become fiks's
 * bytes. Returns a failure reason, or undefined.
 */
async function rerecordBefore(
  g: GateRun,
  check: RerecordCheck,
): Promise<{ problem?: string; manifest?: string }> {
  g.reap();
  const manifest = `/tmp/fiks/overlay-${check}-${randomBytes(4).toString('hex')}.json`;
  const argv = [
    'rerecord-head',
    '--require-sandbox',
    '--worktree',
    g.wtDir,
    '--profile',
    JSON.stringify(g.profile),
    '--from',
    g.reproCommit,
    '--log',
    '/tmp/fiks/rerecord.jsonl',
    '--check',
    check,
    '--manifest',
    manifest,
    ...(g.ruleJson ? ['--rule', g.ruleJson] : []),
    '--json',
  ];
  await g.sb.exec('mkdir', ['-p', '/tmp/fiks'], { env: { ...FIKS_SANDBOX_ENV }, containerCwd: '/tmp' });
  const r = await execFiks(g.sb, argv, { timeoutMs: 20 * 60_000 });
  g.reap();
  let parsed: { log: RerecordLog & { at: string }; manifest?: string } | undefined;
  try {
    const line =
      r.stdout
        .trim()
        .split('\n')
        .filter((l) => l.startsWith('{'))
        .at(-1) ?? '';
    parsed = JSON.parse(line);
  } catch {}
  if (!parsed)
    return {
      problem: `rerecord-head (${check}) failed: exit ${r.code}: ${(r.stderr || r.stdout).trim().split('\n').slice(-5).join(' | ').slice(0, 600)}`,
    };
  appendFileSync(g.rerecordLog, `${JSON.stringify(parsed.log)}\n`);
  g.ev('rerecord_head', {
    session: g.n,
    check,
    files: parsed.log.files.map((f) => `${f.mode} ${f.outcome} ${f.path}`),
  });
  const failed = parsed.log.files.filter((f) => f.outcome === 'failed');
  if (failed.length)
    return {
      problem: `re-recording failed (${check}): ${failed.map((f) => f.path).join(', ')}`,
      manifest: parsed.manifest,
    };
  for (const f of parsed.log.files) {
    if (f.mode !== 'stale' || f.outcome !== 'rerecorded') continue;
    const rel = f.path.replace(/\.json$/, '.rerecorded.json');
    let bytes: string;
    try {
      bytes = readFileSync(join(g.wtDir, rel), 'utf8');
    } catch {
      return { problem: `re-recording ${rel} is missing` };
    }
    if (g.ownedBytes[rel] !== undefined) {
      if (g.ownedBytes[rel] !== bytes) return { problem: `re-recording ${rel} changed between checks` };
      continue;
    }
    const problems = await verifyAgainstUpstream(JSON.parse(bytes) as Recording, g.profile, g.rule);
    if (problems.length)
      return { problem: `re-recording ${rel} does not match the trusted upstream: ${problems.join('; ')}` };
    g.ownedBytes[rel] = bytes;
    g.owned[rel] = sha256(bytes);
  }
  return { manifest: parsed.manifest };
}

async function restoreOverlay(g: GateRun, manifest?: string): Promise<void> {
  if (!manifest) return;
  g.reap();
  await execFiks(g.sb, ['rerecord-head', '--require-sandbox', '--restore', manifest], { timeoutMs: 120_000 });
}

/** One session's gates, in order; stops at the first failure (later gates are not run). */
async function runGates(g: GateRun): Promise<{ ok: boolean; feedback?: string }> {
  const fail = (gate: ArmGateName, reason: string, cand?: string, ms = 0) => {
    g.push({ gate, ok: false, reason, session: g.n, candidateId: cand, ms });
    g.ev(`gate_${gate}`, { session: g.n, reason }, false);
    return { ok: false, feedback: `The ${gate} gate failed: ${reason}` };
  };
  const pass = (gate: ArmGateName, reason: string, cand: string, ms: number) => {
    g.push({ gate, ok: true, reason, session: g.n, candidateId: cand, ms });
    g.ev(`gate_${gate}`, { session: g.n, reason }, true);
  };
  const guarded = (gate: ArmGateName, cand: string): { ok: false; feedback: string } | undefined => {
    const t = tamperCheck(g);
    if (t.length)
      return fail(
        gate,
        `files changed after they were checked: ${t.join(', ')}. Code must not modify files at runtime.`,
        cand,
      ) as { ok: false; feedback: string };
    if (headOf(g.wtDir) !== g.reproCommit)
      return fail(gate, 'a commit appeared while the checks ran', cand) as { ok: false; feedback: string };
    return undefined;
  };
  const suiteCheck = async (gate: 'suite' | 'traces', check: RerecordCheck, file: string) => {
    const cand = g.capture('gate', gate, g.n, g.reproCommit);
    const s = Date.now();
    const rr = await rerecordBefore(g, check);
    if (rr.problem) return fail(gate, rr.problem, cand, Date.now() - s);
    const run = restrictToScope(containerSuiteRun(g.sc, g.wtDir, [file]), ['**']);
    await restoreOverlay(g, rr.manifest);
    g.reap();
    const bad = guarded(gate, cand);
    if (bad) return bad;
    const ran = run.files.find((f) => f.file === file);
    if (run.suiteErrors.length)
      return fail(gate, `setup error: ${run.suiteErrors.join('; ')}`, cand, Date.now() - s);
    if (!ran || ran.statuses.length === 0) return fail(gate, `${file} did not run`, cand, Date.now() - s);
    if (run.failed.length || run.exitCode !== 0)
      return fail(
        gate,
        `${run.failed.map((f) => `${f.test}: ${f.message.split('\n')[0]}`).join('; ') || `exit ${run.exitCode}`}`,
        cand,
        Date.now() - s,
      );
    pass(gate, `${file}: ${ran.statuses.length} test(s) passed`, cand, Date.now() - s);
    return undefined;
  };

  // P: the repro test ran and passed, and the domain's suite passes (CORE passGate on the container suite).
  {
    const cand = g.capture('gate', 'P', g.n, g.reproCommit);
    const s = Date.now();
    const bad0 = guarded('P', cand);
    if (bad0) return bad0;
    const rr = await rerecordBefore(g, 'P');
    if (rr.problem) return fail('P', rr.problem, cand, Date.now() - s);
    const p = passGate(g.wtDir, g.spec, g.sbxDomain);
    await restoreOverlay(g, rr.manifest);
    g.reap();
    const bad = guarded('P', cand);
    if (bad) return bad;
    if (!p.ok) {
      const detail = p.evidence.failed
        .map((f) => `${f.file} > ${f.test}:\n${f.message.split('\n').slice(0, 30).join('\n')}`)
        .join('\n');
      return fail('P', `${p.reason}${detail ? `\n${detail}` : ''}`, cand, Date.now() - s);
    }
    pass('P', p.reason, cand, Date.now() - s);
  }
  // Contract suite and stored traces, each after its own re-record.
  for (const [gate, check, file] of [
    ['suite', 'suite', 'test/fiks/contracts.test.ts'],
    ['traces', 'traces', 'test/fiks/traces.test.ts'],
  ] as const) {
    const r = await suiteCheck(gate, check, file);
    if (r) return r;
  }
  // typecheck and lint (no recordings).
  for (const script of ['typecheck', 'lint'] as const) {
    const cand = g.capture('gate', script, g.n, g.reproCommit);
    const s = Date.now();
    const r = g.sc.exec(['pnpm', '--reporter=default', script], g.wtDir);
    g.reap();
    const bad = guarded(script, cand);
    if (bad) return bad;
    if (r.code !== 0)
      return fail(
        script,
        `pnpm ${script} failed:\n${`${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-40).join('\n')}`,
        cand,
        Date.now() - s,
      );
    pass(script, `pnpm ${script} passed`, cand, Date.now() - s);
  }
  // Local CI (the repo's ci.yml mirrored in the sandbox image), after its own re-record.
  if (g.ci === 'local') {
    const cand = g.capture('ci', 'ci-local', g.n, g.reproCommit);
    const s = Date.now();
    const rr = await rerecordBefore(g, 'ci');
    if (rr.problem) return fail('ci-local', rr.problem, cand, Date.now() - s);
    // CI sees exactly fiks's re-recording bytes.
    for (const [f, b] of Object.entries(g.ownedBytes)) writeFileSync(join(g.wtDir, f), b);
    const c = await ciLocal(g.wtDir, g.repoImage, [], { backend: g.sb });
    await restoreOverlay(g, rr.manifest);
    g.reap();
    const bad = guarded('ci-local', cand);
    if (bad) return bad;
    writeFileSync(join(dirname(g.rerecordLog), `ci-local.${g.n}.log`), c.log);
    if (!c.green) {
      const failed = c.steps.filter((x) => x.status === 'fail');
      return fail(
        'ci-local',
        `local CI red: ${failed.map((x) => `${x.run}\n${x.output.split('\n').slice(-30).join('\n')}`).join('\n')}`,
        cand,
        Date.now() - s,
      );
    }
    pass(
      'ci-local',
      `local CI green (${c.steps.filter((x) => x.kind === 'ci' && x.status === 'pass').length} steps)`,
      cand,
      Date.now() - s,
    );
  }
  return { ok: true };
}

// --- CLI (P18 default export) -------------------------------------------------------------------

const EXPERIMENT_FLAGS = ['--arm', '--run-key'];

export const ARM_USAGE = `  repair --arm fiks|fiks+cu --base <local ref> (--trace <file> | --scenario <id>) [--run-key exp/arm/model/domain/drift/attempt]
         [--domain shop|tracker] [--ci local|none] [--no-pr] [--model m] [--agent-stub <script.json>] [--trace-format raw|strict]
         [--rule <rule|driftpkg.json>] [--clean-corpus <dir>] [--stored-traces <dir,...>] [--f-runs 3] [--max-sessions 4]
         [--repo-image <ref>] [--tools-image <ref>] [--test-tools] [--keep-worktree] [--out <dir>] [--json]
                                           experiment mode: FIKS arm in the per-attempt container; no fetch, push, gh or PR`;

function parseArmArgs(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      arm: { type: 'string' },
      'run-key': { type: 'string' },
      domain: { type: 'string' },
      trace: { type: 'string' },
      scenario: { type: 'string' },
      base: { type: 'string' },
      ci: { type: 'string', default: 'local' },
      'no-pr': { type: 'boolean', default: true },
      model: { type: 'string' },
      'agent-stub': { type: 'string' },
      'trace-format': { type: 'string' },
      rule: { type: 'string' },
      'clean-corpus': { type: 'string' },
      'stored-traces': { type: 'string' },
      fetch: { type: 'boolean', default: false },
      'f-runs': { type: 'string' },
      'max-sessions': { type: 'string' },
      'repo-image': { type: 'string' },
      'tools-image': { type: 'string' },
      'test-tools': { type: 'boolean', default: false },
      'keep-worktree': { type: 'boolean', default: false },
      out: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
}

/** Parses experiment argv into ArmOptions (throws ArmUsageError on bad values). */
export function armOptionsFromArgv(argv: string[]): ArmOptions & { json: boolean } {
  let values: ReturnType<typeof parseArmArgs>['values'];
  try {
    ({ values } = parseArmArgs(argv));
  } catch (e) {
    throw new ArmUsageError(e instanceof Error ? e.message : String(e));
  }
  const runKey = values['run-key'];
  const keyArm = runKey ? parseRunKeyOrThrow(runKey).arm : undefined;
  const armRaw =
    values.arm ??
    (keyArm === 'fiks' || keyArm === 'FIKS'
      ? 'fiks'
      : keyArm === 'fiks+cu' || keyArm === 'FIKS+CU'
        ? 'fiks+cu'
        : undefined);
  if (armRaw !== 'fiks' && armRaw !== 'fiks+cu')
    throw new ArmUsageError(`--arm must be fiks or fiks+cu (got ${armRaw ?? 'none'})`);
  if (!values.base)
    throw new ArmUsageError(
      '--base <local ref> is required in experiment mode (no default branch, no fetch)',
    );
  const ci = values.ci as CiMode;
  if (!['local', 'github', 'none'].includes(ci))
    throw new ArmUsageError(`--ci must be local, github or none (got ${ci})`);
  let traceFormat: TraceFormat;
  try {
    traceFormat = parseTraceFormat(values['trace-format']);
  } catch (e) {
    throw new ArmUsageError(e instanceof Error ? e.message : String(e));
  }
  const int = (v: string | undefined, name: string) => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new ArmUsageError(`--${name} must be a positive integer`);
    return n;
  };
  return {
    arm: armRaw,
    runKey,
    domain: values.domain,
    traceFile: values.trace,
    scenario: values.scenario,
    base: values.base,
    ci,
    model: values.model,
    traceFormat,
    agentStub: values['agent-stub'],
    rule: values.rule,
    cleanCorpus: values['clean-corpus'],
    storedTraces: values['stored-traces']?.split(',').filter(Boolean),
    fetch: values.fetch,
    fRuns: int(values['f-runs'], 'f-runs'),
    maxSessions: int(values['max-sessions'], 'max-sessions'),
    repoImage: values['repo-image'],
    toolsImage: values['tools-image'],
    testTools: values['test-tools'],
    keepWorktree: values['keep-worktree'],
    outRoot: values.out,
    json: values.json,
  };
}

const command: CliCommandModule = {
  name: 'repair',
  describe: 'repro -> repair agent -> gates -> CI; experiment mode (--arm/--run-key): FIKS arm, no PR',
  async run(argv) {
    const experiment = argv.some((a) => EXPERIMENT_FLAGS.some((f) => a === f || a.startsWith(`${f}=`)));
    if (!experiment) {
      if (argv.includes('--help')) {
        const legacy = await import('../legacy/repair.ts');
        console.log(`${legacy.help()}\n${ARM_USAGE}`);
        return 0;
      }
      // Product mode: the ec241bc flags and output, unchanged.
      const legacy = await import('../legacy/repair.ts');
      return legacy.run(argv);
    }
    let o: ReturnType<typeof armOptionsFromArgv>;
    try {
      o = armOptionsFromArgv(argv);
    } catch (e) {
      console.error(`repair: ${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }
    let r: ArmResult;
    try {
      r = await runArm(o);
    } catch (e) {
      if (e instanceof ArmUsageError) {
        console.error(`repair: ${e.message}`);
        return 2;
      }
      throw e;
    }
    if (o.json) console.log(JSON.stringify(r, null, 2));
    else
      console.log(
        [
          `${r.status}: ${r.reason.split('\n')[0]}`,
          `run ${r.runKey} (${r.arm}, ${r.domain}, base ${r.base} = ${r.baseCommit.slice(0, 12)}): ${r.sessions} session(s), ${r.turns} turns`,
          ...r.gates.map(
            (g) =>
              `  ${g.ok ? 'PASS' : 'FAIL'} ${g.gate}${g.session ? ` (session ${g.session})` : ''}: ${g.reason.split('\n')[0]}`,
          ),
          r.wouldOpenPr ? `would_open_pr at ${r.wouldOpenPr.headSha}` : '',
          `results: ${r.dir}`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    return r.status === 'would_open_pr' || r.status === 'contract_update_proposed' ? 0 : 1;
  },
};

export default command;
