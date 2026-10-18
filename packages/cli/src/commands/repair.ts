import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findContract, SHOP_CONTRACTS } from '@fiks/contracts';
import {
  agentSdkRunner,
  buildPrompt,
  changedFiles,
  changedFilesSince,
  changedSinceSnapshot,
  checkPaths,
  ciGate,
  claudeCliRunner,
  fileHash,
  gh,
  headOf,
  localGate,
  prBody,
  prTitle,
  REPAIR_ALLOWED,
  RERECORD_ALLOWED,
  type RepairRunner,
  type RunnerKind,
} from '@fiks/repair';
import {
  addWorktree,
  appendEvent,
  failGate,
  type GateResult,
  generateRepro,
  loadTrace,
  passGate,
  type Trace,
} from '@fiks/repro';
import { FIKS_DIR, shopDir, WORK_DIR } from '../paths.ts';
import { captureTrace } from './repro.ts';
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
