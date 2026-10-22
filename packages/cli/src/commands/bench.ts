import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type BenchAgent,
  type BenchTask,
  type CallSummary,
  DirtyTreeError,
  dirtyPaths,
  genericSystem,
  groupKey,
  type McpServerSpec,
  runAgent,
  runTrials,
  SHOP_SYSTEM,
  TASKS,
  type TrialOutcome,
  type TrialResult,
  type VendorLike,
  vendorHarnessFactory,
} from '@fiks/bench';
import { SHOP_CONTRACTS_PATH } from '@fiks/contracts';
import { getDomain } from '@fiks/domains';
import type { CliCommandModule } from '@fiks/interfaces';
import { gh } from '@fiks/repair';
import { addWorktree } from '@fiks/repro';
import { createVendor, type VendorVersion } from '@fiks/vendor-api';
import { ROOT, shopDir, WORK_DIR } from '../paths.ts';

/** Phase labels: A_v1 | B_v2 | C_v2_fixed | C_v2_prheads, `_direct` without the proxy, `<domain>.` prefix off-shop. */
export type PhaseLabel = string;

/** One line of trials.jsonl. */
export interface TrialRecord extends TrialResult {
  runId: string;
  phase: PhaseLabel;
  model: string;
  /** The target server's commit (field name kept from the shop-only bench). */
  shopMcpSha: string;
  domain: string;
  monitor: string;
  arm: string;
}

const PHASES: Record<'A' | 'B' | 'C', { label: string; vendor: VendorVersion; ref: 'seed' | 'origin/main' }> =
  {
    A: { label: 'A_v1', vendor: 'v1', ref: 'seed' },
    B: { label: 'B_v2', vendor: 'v2', ref: 'seed' },
    C: { label: 'C_v2_fixed', vendor: 'v2', ref: 'origin/main' },
  };

/** What the bench needs from a domain. Built from the registered `Domain` (P8), or the built-in shop. */
export interface BenchTarget {
  id: string;
  tasks: readonly BenchTask[];
  createVendor(version: string): VendorLike;
  contractsPath: string;
  baseUrlEnv: string;
  serverCommand(repoDir: string): { command: string; args: string[] };
  repoDir(): string;
  repoSlug: string;
  seedTag: string;
  systemPrompt: string;
  serverName: string;
}

/** The shop as it was before the domain registry (used when no `shop` Domain is registered). */
function builtinShop(): BenchTarget {
  return {
    id: 'shop',
    tasks: TASKS,
    createVendor: (version) => createVendor({ version: version as VendorVersion }),
    contractsPath: SHOP_CONTRACTS_PATH,
    baseUrlEnv: 'VENDOR_BASE_URL',
    serverCommand: (dir) => ({
      command: join(dir, 'node_modules/.bin/tsx'),
      args: [join(dir, 'src/main.ts')],
    }),
    repoDir: shopDir,
    repoSlug: process.env.SHOP_MCP_REPO ?? 'vats98754/shop-mcp',
    seedTag: 'seed-v1',
    systemPrompt: SHOP_SYSTEM,
    serverName: 'shop',
  };
}

/** The bench target for `--domain`: the registered Domain when there is one. */
export function resolveTarget(domain: string): BenchTarget {
  let d: ReturnType<typeof getDomain> | undefined;
  try {
    d = getDomain(domain);
  } catch (e) {
    if (domain === 'shop') return builtinShop();
    throw e;
  }
  if (d.tasks.length === 0) throw new Error(`domain ${domain} has no bench tasks (Domain.tasks is empty)`);
  const hint = d.promptHints.benchSystem;
  return {
    id: d.id,
    tasks: d.tasks,
    createVendor: (version) => d.createVendor('original', { version }),
    contractsPath: d.contractsPath,
    baseUrlEnv: d.baseUrlEnv,
    serverCommand: (dir) => d.serverCommand(dir),
    repoDir: () => d.repo.dir(),
    repoSlug: d.repo.slug,
    seedTag: d.seedTag,
    systemPrompt: d.id === 'shop' ? SHOP_SYSTEM : typeof hint === 'string' ? hint : genericSystem(d.id),
    serverName: d.id === 'shop' ? 'shop' : d.id,
  };
}

interface FixPr {
  number: number;
  branch: string;
  state: string;
}

/** The fix PRs fiks opened (from the committed loop evidence) and their current state. */
function fixPrs(repo: string): FixPr[] {
  const dir = join(ROOT, 'bench/results/loop/repairs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as { branch: string; pr?: { number: number } })
    .filter((r) => r.pr)
    .map((r) => {
      const v = JSON.parse(gh(repo, ['pr', 'view', String(r.pr?.number), '--json', 'state'])) as {
        state: string;
      };
      return { number: r.pr?.number as number, branch: r.branch, state: v.state };
    });
}

/** A local branch: origin/main plus every open fix PR branch merged in. Throws on conflict. */
function mergePrHeads(repoDir: string, branches: string[]): string {
  const name = `bench/pr-heads-${Date.now()}`;
  const dir = join(WORK_DIR, 'wt', name.replace('/', '-'));
  const wt = addWorktree(repoDir, dir, 'origin/main', name);
  try {
    for (const b of branches) {
      git(wt.dir, 'fetch', '--quiet', 'origin', b);
      try {
        git(
          wt.dir,
          '-c',
          'user.email=fiks@local',
          '-c',
          'user.name=fiks',
          'merge',
          '--no-edit',
          '--quiet',
          'FETCH_HEAD',
        );
      } catch {
        throw new Error(`phase C pr-heads: ${b} does not merge cleanly with the others`);
      }
    }
    return git(wt.dir, 'rev-parse', 'HEAD');
  } finally {
    wt.remove();
  }
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

const resolves = (cwd: string, ref: string) => {
  try {
    git(cwd, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
};

/** Reads one trial's checked calls from the proxy's events file. */
function readProxyCalls(file: string): CallSummary[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(
      (l) =>
        JSON.parse(l) as {
          tool: string;
          receipt: { verdict: string; violations: { propertyId: string }[] };
        },
    )
    .map((c) => ({
      tool: c.tool,
      verdict: c.receipt.verdict,
      propertyIds: c.receipt.violations.map((v) => v.propertyId),
    }));
}

const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9+._-]*$/;
const TASK_ORDER = (r: { taskId: string; trial: number }, ids: string[]) =>
  ids.indexOf(r.taskId) * 1e6 + r.trial;

export interface BenchOptions {
  phase: 'A' | 'B' | 'C';
  k: number;
  tasks?: string[];
  model?: string;
  /** Phase C only: 'pr-heads' runs a temporary merge of the open fix PR branches. */
  shopRef?: 'pr-heads';
  out?: string;
  /** No fiks-proxy: the agent talks to the server directly (the "without fiks" baseline). */
  direct?: boolean;
  /** Pass `--receipt-field none` to the proxy (receipt only in _meta and a text block). */
  noReceiptField?: boolean;
  onTrial?: (t: TrialRecord) => void;
  /** Domain id (default `shop`). */
  domain?: string;
  /** Proxy monitor (default `contracts`; other values are passed as `--monitor <name>`). */
  monitor?: string;
  /** Label of the repair arm whose code runs (default `none`); part of the summary key. */
  arm?: string;
  /** Parallel workers, each with its own vendor (default 1). */
  workers?: number;
  /** Retries after an infrastructure error (default 3). */
  retries?: number;
  backoffMs?: number;
  maxTurns?: number;
  /** Run on a dirty fiks tree (scratch output only; meta records fiksDirty). */
  allowDirty?: boolean;
  /** The fiks checkout that is checked for cleanliness and recorded (default: this one). */
  root?: string;
  /** Replaces the Claude agent (tests, dry runs). No credential is needed then. */
  agent?: BenchAgent;
}

export async function bench(opts: BenchOptions) {
  const p = PHASES[opts.phase];
  if (!p) throw new Error(`phase must be A, B or C, got ${JSON.stringify(opts.phase)}`);
  if (!Number.isInteger(opts.k) || opts.k < 1) throw new Error(`--k must be an integer >= 1, got ${opts.k}`);
  const workers = opts.workers ?? 1;
  if (!Number.isInteger(workers) || workers < 1)
    throw new Error(`--workers must be an integer >= 1, got ${workers}`);
  const root = opts.root ?? ROOT;
  // Runners refuse a dirty tree (PLAN 7): meta.json must name exactly the code that ran.
  const dirty = dirtyPaths(root);
  if (dirty.length && !opts.allowDirty) throw new DirtyTreeError(root, dirty);
  if (!opts.agent && !process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'bench needs a Claude credential: CLAUDE_CODE_OAUTH_TOKEN in .env (from `claude setup-token`)',
    );
  }
  const monitor = opts.direct ? 'none' : (opts.monitor ?? 'contracts');
  if (opts.direct && opts.monitor && opts.monitor !== 'none')
    throw new Error(`--direct runs without the proxy, so --monitor ${opts.monitor} cannot apply`);
  const arm = opts.arm ?? 'none';
  const model = opts.model ?? process.env.BENCH_MODEL ?? 'claude-sonnet-5-5';
  for (const [flag, v] of [
    ['--monitor', monitor],
    ['--arm', arm],
    ['--model', model],
  ] as const) {
    if (!LABEL_RE.test(v))
      throw new Error(`${flag} must match ${LABEL_RE} (no '@' or '/'), got ${JSON.stringify(v)}`);
  }
  const target = resolveTarget(opts.domain ?? 'shop');
  const repoDir = target.repoDir();
  // Phase C needs origin's main and PR branches; A and B use the local seed tag (fetched only if missing).
  if (opts.phase === 'C' || !resolves(repoDir, target.seedTag))
    git(repoDir, 'fetch', '--quiet', 'origin', '--tags');
  // Phase C must say exactly what code ran: merged main only when every fix PR is merged,
  // otherwise an explicit, differently labelled merge of the PR branches.
  let phaseLabel: string = p.label;
  let ref = p.ref === 'seed' ? target.seedTag : p.ref;
  if (opts.phase === 'C') {
    const prs = fixPrs(target.repoSlug);
    if (prs.length === 0) throw new Error('phase C: no fix PRs recorded in bench/results/loop/repairs');
    const open = prs.filter((x) => x.state !== 'MERGED');
    if (open.length === 0) {
      ref = 'origin/main';
    } else if (opts.shopRef === 'pr-heads') {
      phaseLabel = 'C_v2_prheads';
      ref = mergePrHeads(
        repoDir,
        open.map((x) => x.branch),
      );
    } else {
      throw new Error(
        `phase C: PRs not merged yet (${open.map((x) => `#${x.number}`).join(', ')}). Merge them, or pass --shop-ref pr-heads.`,
      );
    }
  }
  const domainPrefix = target.id === 'shop' ? '' : `${target.id}.`;
  const label = `${domainPrefix}${phaseLabel}${opts.direct ? '_direct' : ''}`;
  const startedAt = new Date().toISOString();
  const runId = `${label}_${startedAt.replace(/[-:.]/g, '').slice(0, 15)}`;
  const unknown = opts.tasks?.filter((id) => !target.tasks.some((t) => t.id === id)) ?? [];
  if (unknown.length) throw new Error(`unknown task id(s) for ${target.id}: ${unknown.join(', ')}`);
  const tasks = target.tasks.filter((t) => !opts.tasks?.length || opts.tasks.includes(t.id));
  // Only full runs on a clean tree (every task, k >= 5) go to the committed evidence; the rest to scratch.
  const full = tasks.length === target.tasks.length && opts.k >= 5 && dirty.length === 0;
  const out = opts.out ? resolve(opts.out) : join(root, full ? 'bench/results' : '.fiks/bench', runId);
  if (dirty.length) {
    const rel = relative(root, out);
    const evidence = ['bench/results', 'bench/evidence', 'paper/results'].some(
      (d) => !rel.startsWith('..') && !isAbsolute(rel) && (rel === d || rel.startsWith(`${d}/`)),
    );
    if (evidence) throw new Error(`--allow-dirty runs never write to committed evidence (${rel})`);
  }
  // Results are never overwritten (P6).
  if (existsSync(join(out, 'meta.json')) || existsSync(join(out, 'trials.jsonl')))
    throw new Error(`refusing to overwrite an existing run in ${out}`);
  mkdirSync(join(out, 'transcripts'), { recursive: true });

  // Per-process worktree name: concurrent bench processes never remove each other's checkout.
  const wt = addWorktree(repoDir, join(WORK_DIR, 'wt', `bench-${runId}-${process.pid}`), ref);
  const shopMcpSha = git(wt.dir, 'rev-parse', 'HEAD');
  const probe = target.createVendor(p.vendor);
  const meta = {
    runId,
    phase: label,
    domain: target.id,
    fiksSha: git(root, 'rev-parse', 'HEAD'),
    fiksDirty: dirty.length > 0,
    proxy: !opts.direct,
    receiptField: !opts.direct && !opts.noReceiptField,
    monitor,
    arm,
    groupKey: '',
    model,
    k: opts.k,
    tasks: tasks.map((t) => t.id),
    workers,
    retries: opts.retries ?? 3,
    shopRef: ref,
    shopMcpSha,
    vendor: p.vendor,
    vendorDrifts: (probe.state as { drifts?: unknown }).drifts ?? null,
    startedAt,
    finishedAt: '',
  };
  meta.groupKey = groupKey(meta);
  writeFileSync(join(out, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  const server = target.serverCommand(wt.dir);
  const proxyEvents = (taskId: string, trial: number) => join(out, 'proxy', `${taskId}-${trial}.jsonl`);
  const env = (vendorUrl: string) => ({
    [target.baseUrlEnv]: vendorUrl,
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
  });
  const harness = vendorHarnessFactory({
    createVendor: () => target.createVendor(p.vendor),
    server: (vendorUrl, slot): McpServerSpec => {
      if (opts.direct) return { command: server.command, args: server.args, env: env(vendorUrl) };
      const events = proxyEvents(slot.taskId, slot.trial);
      mkdirSync(join(out, 'proxy'), { recursive: true });
      rmSync(events, { force: true });
      return {
        command: join(ROOT, 'node_modules/.bin/tsx'),
        args: [
          join(ROOT, 'packages/proxy/src/bin.ts'),
          '--contracts',
          target.contractsPath,
          '--tap',
          target.baseUrlEnv,
          '--events',
          events,
          ...(opts.noReceiptField ? ['--receipt-field', 'none'] : []),
          // The default monitor is the proxy's own; others need MON's --monitor flag.
          ...(monitor !== 'contracts' ? ['--monitor', monitor] : []),
          '--',
          server.command,
          ...server.args,
        ],
        env: env(vendorUrl),
      };
    },
    calls: (slot) => (opts.direct ? [] : readProxyCalls(proxyEvents(slot.taskId, slot.trial))),
  });
  const record = (t: TrialResult): TrialRecord => ({
    runId,
    phase: label,
    ...t,
    model,
    shopMcpSha,
    domain: target.id,
    monitor,
    arm,
  });
  let trials: TrialRecord[] = [];
  try {
    const results = await runTrials({
      tasks,
      k: opts.k,
      model,
      agent: opts.agent ?? ((input) => runAgent(input)),
      harness,
      workers,
      maxTurns: opts.maxTurns,
      systemPrompt: target.systemPrompt,
      serverName: target.serverName,
      retries: opts.retries,
      backoffMs: opts.backoffMs,
      onTrial: (t, transcript) => {
        const rec = record(t);
        appendFileSync(join(out, 'trials.jsonl'), `${JSON.stringify(rec)}\n`);
        writeFileSync(join(out, 'transcripts', `${t.taskId}-${t.trial}.txt`), `${transcript.join('\n')}\n`);
        opts.onTrial?.(rec);
      },
    });
    trials = results.map(record);
    // Workers finish out of order; the final log is in task, then trial order.
    const ids = tasks.map((t) => t.id);
    const ordered = [...trials].sort((a, b) => TASK_ORDER(a, ids) - TASK_ORDER(b, ids));
    writeFileSync(join(out, 'trials.jsonl'), ordered.map((r) => `${JSON.stringify(r)}\n`).join(''));
  } finally {
    await probe.close().catch(() => {});
    wt.remove();
    meta.finishedAt = new Date().toISOString();
    writeFileSync(join(out, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  }
  return { runId, out, meta, trials };
}

/**
 * Every option the pre-P18 CLI accepted for any command (`git show ec241bc:packages/cli/src/main.ts`).
 * The default-export commands accept them all, so no old invocation starts failing; options a
 * command does not use are ignored with a note on stderr.
 */
export const LEGACY_GLOBAL_OPTIONS = {
  json: { type: 'boolean', default: false },
  vendor: { type: 'string' },
  out: { type: 'string' },
  drifts: { type: 'string' },
  transport: { type: 'string' },
  'compare-direct': { type: 'boolean' },
  scenario: { type: 'string' },
  target: { type: 'string' },
  runs: { type: 'string' },
  keep: { type: 'boolean' },
  base: { type: 'string' },
  'no-pr': { type: 'boolean' },
  model: { type: 'string' },
  trace: { type: 'string' },
  phase: { type: 'string' },
  k: { type: 'string', default: '5' },
  tasks: { type: 'string' },
  'shop-ref': { type: 'string' },
  check: { type: 'boolean', default: false },
  'until-f-gate': { type: 'boolean' },
  direct: { type: 'boolean', default: false },
  'no-receipt-field': { type: 'boolean', default: false },
} as const;

/** Notes legacy options given in `argv` that `command` accepts but does not use. */
export function noteIgnored(command: string, argv: readonly string[], used: readonly string[]) {
  const ignored = Object.keys(LEGACY_GLOBAL_OPTIONS).filter(
    (k) => !used.includes(k) && argv.some((a) => a === `--${k}` || a.startsWith(`--${k}=`)),
  );
  if (ignored.length)
    console.error(`${command}: ignoring ${ignored.map((k) => `--${k}`).join(', ')} (not used by ${command})`);
}

const DESCRIBE = 'agent trials through fiks-proxy; logs to bench/results/<runId>';

const HELP = `usage: fiks bench --phase A|B|C [options]

  ${DESCRIBE}

  --phase A|B|C            A = vendor v1 on the seed, B = vendor v2 on the seed, C = v2 on fixed main
  --k <n>                  trials per task (default 5)
  --tasks T1,T6            subset of the domain's tasks (default: all)
  --model <id>             agent model (default $BENCH_MODEL or claude-sonnet-5-5)
  --domain <id>            registered domain (default shop)
  --monitor <name>         proxy monitor (default contracts; others need the proxy's --monitor)
  --arm <label>            repair arm whose code runs, for the summary key (default none)
  --workers <n>            parallel workers, each with its own vendor (default 1)
  --retries <n>            retries after an infrastructure error, with backoff (default 3)
  --backoff-ms <ms>        first backoff, doubled per retry (default 2000)
  --max-turns <n>          agent turn cap per trial (default 12)
  --shop-ref pr-heads      phase C only: run a merge of the open fix PR branches
  --direct                 no fiks-proxy (the "without fiks" baseline)
  --no-receipt-field       proxy --receipt-field none
  --out <dir>              output folder (never overwritten)
  --allow-dirty            run on an uncommitted fiks tree (scratch output only)
  --json                   print the result as JSON

Refuses to start on a dirty fiks tree (bench/results, bench/evidence and paper/results/raw do not count).
Summary key: \${phase}@\${model}@\${monitor}@\${arm}.`;

const OWN_OPTIONS = {
  domain: { type: 'string' },
  monitor: { type: 'string' },
  arm: { type: 'string' },
  workers: { type: 'string', default: '1' },
  retries: { type: 'string', default: '3' },
  'backoff-ms': { type: 'string', default: '2000' },
  'max-turns': { type: 'string', default: '12' },
  'allow-dirty': { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

const intFlag = (name: string, v: string, min: number) => {
  const n = Number(v);
  if (!/^\d+$/.test(v) || n < min)
    throw new Error(`--${name} must be an integer >= ${min}, got ${JSON.stringify(v)}`);
  return n;
};

/** `fiks bench`, parsing its own argv (P18). Returns the exit code. */
export async function runBenchCommand(argv: string[], deps: { root?: string; agent?: BenchAgent } = {}) {
  let values: ReturnType<typeof parse>;
  function parse() {
    return parseArgs({
      args: argv,
      options: { ...LEGACY_GLOBAL_OPTIONS, ...OWN_OPTIONS },
      allowPositionals: false,
    }).values;
  }
  try {
    values = parse();
  } catch (e) {
    console.error(`${e instanceof Error ? e.message : String(e)}\n\n${HELP}`);
    return 2;
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const phase = values.phase as 'A' | 'B' | 'C';
  if (values['shop-ref'] !== undefined && values['shop-ref'] !== 'pr-heads') {
    console.error(`--shop-ref only accepts pr-heads (phase C), got ${JSON.stringify(values['shop-ref'])}`);
    return 2;
  }
  if (!['A', 'B', 'C'].includes(phase)) {
    console.error(HELP);
    return 2;
  }
  noteIgnored('bench', argv, [
    'json',
    'out',
    'model',
    'phase',
    'k',
    'tasks',
    'shop-ref',
    'direct',
    'no-receipt-field',
  ]);
  let r: Awaited<ReturnType<typeof bench>>;
  try {
    r = await bench({
      phase,
      k: intFlag('k', values.k, 1),
      tasks: values.tasks?.split(','),
      model: values.model,
      shopRef: values['shop-ref'] === 'pr-heads' ? 'pr-heads' : undefined,
      out: values.out,
      direct: values.direct,
      noReceiptField: values['no-receipt-field'],
      domain: values.domain,
      monitor: values.monitor,
      arm: values.arm,
      workers: intFlag('workers', values.workers, 1),
      retries: intFlag('retries', values.retries, 0),
      backoffMs: intFlag('backoff-ms', values['backoff-ms'], 0),
      maxTurns: intFlag('max-turns', values['max-turns'], 1),
      allowDirty: values['allow-dirty'],
      root: deps.root,
      agent: deps.agent,
      onTrial: (t) => {
        if (!values.json) console.error(`${t.phase} ${t.taskId} #${t.trial}: ${t.outcome} (${t.reason})`);
      },
    });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return e instanceof DirtyTreeError ? 2 : 1;
  }
  const passed = r.trials.filter((t) => t.pass).length;
  const infra = r.trials.filter((t) => t.outcome === ('infraError' satisfies TrialOutcome)).length;
  console.log(
    values.json
      ? JSON.stringify(r, null, 2)
      : `${r.runId}: ${passed}/${r.trials.length} passed${infra ? ` (${infra} infraError)` : ''} -> ${r.out}`,
  );
  return 0;
}

const command: CliCommandModule = {
  name: 'bench',
  describe: DESCRIBE,
  run: (argv) => runBenchCommand(argv),
};
export default command;
