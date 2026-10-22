// pnpm exp (stream RUN; INTEG adds the root script, until then `pnpm tsx packages/exp/src/main.ts`):
//
//   main.ts <run-id> [--dry] [--dev] [--drifts a,b] [--models m,n] [--attempts n] [--workers n]
//                    [--seed s] [--out-root dir] [--manifest file] [--split file] [--k1 file]
//                    [--from run] [--tools-image img] [--cap-headroom-units n] [--rss-cap-mb n]
//                    [--attempt-timeout-min n] [--wait-on-cap] [--print-plan]
//   main.ts fit --measured <throughput.json> [--window-days 8] [--params p.json] [--peak-rss-mb n]
//               [--cap-pause-fraction f] [--sustained-units-per-hour x] [--seed s] [--out file]
//   main.ts status <run-id> [--out-root dir] [--dry]
//   main.ts list | schema
//
// stdout carries status lines only (StatusSchema; no correctness or verdict field); messages go
// to stderr; subprocess output goes to per-attempt logs. Exit codes: 0 complete, 1 error,
// 2 refused (guard/usage), 3 paused (cap stop, infra window or signal; resume by re-running).

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type ArmName, prepareArgvs } from './argv.ts';
import { gradeSteps, r2Steps, showcaseDraw, showcaseSteps, trafficSteps } from './commands.ts';
import {
  acquireRunActive,
  checkBuildSwarm,
  checkCleanTree,
  checkConfirmatoryLock,
  GuardError,
  type PreflightResult,
  runPreflight,
} from './guard.ts';
import { type DriftInput, devInputs, filterDrifts, manifestInputs } from './inputs.ts';
import { loadThroughput, measuredRate } from './measured.ts';
import { recoverIncomplete, runPool } from './pool.ts';
import { loadRegistry, Registry } from './registry.ts';
import { stratifiedSubset } from './rng.ts';
import {
  type BlockRun,
  type CommandCtx,
  type CommandRun,
  type CommandStep,
  getRun,
  type Phase,
  R10_UNITS,
  RUNS,
} from './runs.ts';
import { type Block, buildBlocks, type PlanPhase } from './schedule.ts';
import { runSteps } from './sequential.ts';
import { formatStatus, type Status, statusJsonSchema } from './status.ts';
import {
  configSteps,
  DEFAULT_FIT,
  DEFAULT_PARAMS,
  type FitInputs,
  fit,
  type K1Step,
  ollamaRule,
  type ProjectionParams,
} from './steps.ts';

export const FIKS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const STUB_DIR = 'packages/exp/fixtures/dry';
export const REPRO_STUB = `${STUB_DIR}/repro-agent.json`;
const ORCH_CLEAN_CORPUS = 'packages/cli/test/orch/fixtures/clean-v1';

/** Test seams, honoured only with --dry (a live run refuses them). */
export const OVERRIDE_ENV = [
  'FIKS_EXP_FIKS_BIN',
  'FIKS_EXP_TSX_BIN',
  'FIKS_EXP_PREFLIGHT_CMD',
  'FIKS_EXP_REPO',
];

const log = (s: string) => process.stderr.write(`[exp] ${s}\n`);
const emit = (s: Status) => process.stdout.write(`${formatStatus(s)}\n`);
const csv = (s: string | undefined) =>
  s
    ? s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : null;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function jsonArgv(name: string): string[] | null {
  const v = process.env[name];
  if (!v) return null;
  const j = JSON.parse(v) as unknown;
  if (!Array.isArray(j) || j.length === 0 || !j.every((x) => typeof x === 'string'))
    throw new GuardError(`${name} must be a JSON array of strings`);
  return j as string[];
}

interface RunFlags {
  dry: boolean;
  dev: boolean;
  drifts: string[] | null;
  models: string[] | null;
  attempts: number | null;
  workers: number;
  seed: string | null;
  outRoot: string | null;
  manifest: string | null;
  split: string | null;
  k1: string | null;
  from: string | null;
  toolsImage: string | null;
  capHeadroomUnits: number | null;
  rssCapMb: number;
  attemptTimeoutMin: number;
  waitOnCap: boolean;
  printPlan: boolean;
  approved: boolean;
}

function parseRunFlags(argv: string[]): RunFlags {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      dry: { type: 'boolean', default: false },
      dev: { type: 'boolean', default: false },
      drifts: { type: 'string' },
      models: { type: 'string' },
      attempts: { type: 'string' },
      workers: { type: 'string' },
      seed: { type: 'string' },
      'out-root': { type: 'string' },
      manifest: { type: 'string' },
      split: { type: 'string' },
      k1: { type: 'string' },
      from: { type: 'string' },
      'tools-image': { type: 'string' },
      'cap-headroom-units': { type: 'string' },
      'rss-cap-mb': { type: 'string' },
      'attempt-timeout-min': { type: 'string' },
      'wait-on-cap': { type: 'boolean', default: false },
      'print-plan': { type: 'boolean', default: false },
      approved: { type: 'boolean', default: false },
    },
  });
  const int = (v: string | undefined, name: string, min: number, max: number): number | null => {
    if (v === undefined) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max)
      throw new GuardError(`--${name} must be an integer in [${min}, ${max}]`);
    return n;
  };
  return {
    dry: values.dry as boolean,
    dev: values.dev as boolean,
    drifts: csv(values.drifts as string | undefined),
    models: csv(values.models as string | undefined),
    attempts: int(values.attempts as string | undefined, 'attempts', 1, 10),
    workers: int(values.workers as string | undefined, 'workers', 1, 6) ?? 1,
    seed: (values.seed as string | undefined) ?? null,
    outRoot: (values['out-root'] as string | undefined) ?? null,
    manifest: (values.manifest as string | undefined) ?? null,
    split: (values.split as string | undefined) ?? null,
    k1: (values.k1 as string | undefined) ?? null,
    from: (values.from as string | undefined) ?? null,
    toolsImage: (values['tools-image'] as string | undefined) ?? null,
    capHeadroomUnits:
      values['cap-headroom-units'] === undefined ? null : Number(values['cap-headroom-units'] as string),
    rssCapMb: int(values['rss-cap-mb'] as string | undefined, 'rss-cap-mb', 256, 1 << 20) ?? (16 - 6) * 1024,
    attemptTimeoutMin:
      int(values['attempt-timeout-min'] as string | undefined, 'attempt-timeout-min', 1, 600) ?? 100,
    waitOnCap: values['wait-on-cap'] as boolean,
    printPlan: values['print-plan'] as boolean,
    approved: values.approved as boolean,
  };
}

interface Ctx {
  /** The fiks checkout whose code runs (subprocess cwd, fixtures, packages). */
  repo: string;
  /** The tree the guards check (dirty tree, frozen commit, confirmatory.lock); = repo except in --dry runner tests. */
  tree: string;
  outRoot: string;
  runDir: string;
  fiks: string[];
  tsx: string[];
  seed: string;
}

/** K1 step for R3/R4: --k1 <fit.json> (F8); --dry without one uses S0. */
function k1Step(f: RunFlags, outRoot: string): { step: K1Step; seed: string; source: string } {
  const file = f.k1 ?? join(outRoot, 'K1', 'fit.json');
  if (existsSync(file)) {
    const j = JSON.parse(readFileSync(file, 'utf8')) as { chosen: K1Step; seed: string };
    return { step: j.chosen, seed: j.seed, source: file };
  }
  if (!f.dry)
    throw new GuardError(`refused: no K1 fit at ${file} (PLAN 8.2, F8); run 'main.ts fit ... --out ${file}'`);
  const s0 = configSteps(DEFAULT_PARAMS).find((s) => s.id === 'S0') as K1Step;
  return { step: s0, seed: 'k1', source: 'default S0 (--dry without --k1)' };
}

function resolveInputs(def: BlockRun, f: RunFlags, ctx: Ctx): { main: DriftInput[]; dev: DriftInput[] } {
  const stubDir = join(ctx.repo, STUB_DIR);
  const split = f.split ?? join(ctx.outRoot, 'R0', 'split.json');
  const dev = devInputs(ctx.repo, split, stubDir).map((d) => ({
    ...d,
    cleanCorpus: d.cleanCorpus ?? ORCH_CLEAN_CORPUS,
  }));
  let main: DriftInput[];
  if (def.inputs === 'dev' || f.dev) {
    if (def.id === 'R8') throw new GuardError('R8 runs on real bugs only; --dev does not apply');
    main = dev;
  } else {
    main = manifestInputs(f.manifest ?? join(ctx.outRoot, def.defaultManifest as string), stubDir);
  }
  return {
    main: filterDrifts(main, f.drifts),
    dev: filterDrifts(dev, def.inputs === 'dev' || f.dev ? f.drifts : null),
  };
}

function planPhases(def: BlockRun, f: RunFlags, ctx: Ctx, inputs: { main: DriftInput[]; dev: DriftInput[] }) {
  let phases: Phase[] = def.phases.map((p) => ({ ...p, arms: [...p.arms], models: [...p.models] }));
  let k1: { step: K1Step; seed: string; source: string } | null = null;
  let main = inputs.main;
  if (def.k1) {
    k1 = k1Step(f, ctx.outRoot);
    const s = k1.step;
    if (def.k1 === 'R4') {
      phases = phases.map((p) =>
        p.name === 'confirmatory'
          ? { ...p, models: [...s.models], attempts: s.a }
          : { ...p, arms: p.arms.filter((a) => s.config.rungs.includes(a)) },
      );
      if (s.id === 11 && !f.dev)
        main = stratifiedSubset(main, s.drifts.length, k1.seed, 'S4', (d) => d.stratum);
    } else phases = phases.map((p) => ({ ...p, models: [...s.config.r3Models] }));
  }
  const plan: PlanPhase[] = [];
  const notes: string[] = [];
  for (const p of phases) {
    if (f.dev && p.skipInDev) {
      notes.push(`phase ${p.name} skipped under --dev (needs test-split inputs)`);
      continue;
    }
    const models = f.models ? p.models.filter((m) => f.models?.includes(m)) : p.models;
    const attempts = f.attempts ? Math.min(f.attempts, p.attempts) : p.attempts;
    if (models.length === 0 || p.arms.length === 0) {
      notes.push(`phase ${p.name} has no ${models.length === 0 ? 'model' : 'arm'} left`);
      continue;
    }
    plan.push({ phase: { ...p, models, attempts }, drifts: p.inputs === 'dev' ? inputs.dev : main });
  }
  if (f.models) {
    const known = new Set(phases.flatMap((p) => p.models));
    const unknown = f.models.filter((m) => !known.has(m));
    if (unknown.length) throw new GuardError(`--models: ${unknown.join(', ')} not in ${def.id}`);
  }
  return { plan, k1, notes };
}

function childEnv(dry: boolean): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && !OVERRIDE_ENV.includes(k)) env[k] = v;
  if (dry) {
    env.FIKS_LLM_FORBID = '1';
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY;
  }
  return env;
}

function readMeta(file: string): Record<string, unknown> | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : null;
}

export async function runMain(runId: string, argv: string[]): Promise<number> {
  const def = getRun(runId);
  const f = parseRunFlags(argv);
  const overrides = OVERRIDE_ENV.filter((k) => process.env[k]);
  const repo = FIKS_ROOT;
  const tree = process.env.FIKS_EXP_REPO ? resolve(process.env.FIKS_EXP_REPO) : FIKS_ROOT;
  const outRoot = resolve(
    f.outRoot ?? (f.dry ? join(repo, '.fiks', 'exp-dry') : join(repo, 'paper', 'results', 'raw')),
  );
  const ctx: Ctx = {
    repo,
    tree,
    outRoot,
    runDir: join(outRoot, runId),
    fiks: jsonArgv('FIKS_EXP_FIKS_BIN') ?? ['pnpm', 'fiks'],
    tsx: jsonArgv('FIKS_EXP_TSX_BIN') ?? ['pnpm', 'tsx'],
    seed: f.seed ?? `fiks-${runId}`,
  };

  // Gates that hold for every mode, including --print-plan.
  if (def.gates.includes('confirmatory-lock')) checkConfirmatoryLock(tree, runId);
  if (
    def.gates.includes('cap-headroom') &&
    !(f.capHeadroomUnits !== null && f.capHeadroomUnits >= R10_UNITS)
  ) {
    throw new GuardError(
      `refused: ${runId} runs only if caps remain: pass --cap-headroom-units >= ${R10_UNITS} (measured headroom)`,
    );
  }
  if (def.gates.includes('rba') && !existsSync(join(repo, 'packages', 'realbug-adapter', 'package.json')))
    throw new GuardError(`refused: ${runId} is gated on RBA (packages/realbug-adapter is not merged)`);
  if (def.gates.includes('approval') && !f.printPlan) {
    // R11 pushes a showcase branch and opens real PRs: never under --dry, and only with --approved
    // (PLAN 8.0-3) passed by the operator of the run step.
    if (f.dry)
      throw new GuardError(
        `refused: ${runId} is product mode (real PRs); --dry is allowed only with --print-plan`,
      );
    if (!f.approved) throw new GuardError(`refused: ${runId} needs --approved (user approval, PLAN 8.0-3)`);
  }
  // Test seams are refused in live runs.
  if (overrides.length && !f.dry)
    throw new GuardError(`refused: ${overrides.join(', ')} may be set only with --dry`);

  if (!f.printPlan) checkBuildSwarm(f.dry);
  const release = f.dry || f.printPlan ? () => {} : acquireRunActive(runId);
  try {
    return await runGuarded(def, f, ctx, overrides);
  } finally {
    release();
  }
}

async function runGuarded(
  def: BlockRun | CommandRun,
  f: RunFlags,
  ctx: Ctx,
  overrides: string[],
): Promise<number> {
  const fiksCommit = f.printPlan ? 'print-plan' : checkCleanTree(ctx.tree);
  const startedAt = Date.now();
  if (!f.printPlan) mkdirSync(ctx.runDir, { recursive: true });

  // --- containment preflight (R1, R3-R8, incl. --dry), before anything else starts ----------------
  let preflight: PreflightResult | null = null;
  if (def.preflight && !f.printPlan) {
    preflight = runPreflight({
      repo: ctx.repo,
      fiksCommit,
      override: f.dry ? jsonArgv('FIKS_EXP_PREFLIGHT_CMD') : null,
      logPath: join(ctx.runDir, `preflight-${Date.now()}.txt`),
    });
    appendFileSync(join(ctx.runDir, 'preflight.jsonl'), `${JSON.stringify(preflight)}\n`);
    if (!preflight.passed) {
      throw new GuardError(
        `refused: containment preflight failed (exit ${preflight.exitCode}); no block was started. Log: ${preflight.logPath}`,
      );
    }
  }

  // --- the plan -------------------------------------------------------------------------------
  let blocks: Block[] = [];
  const prepare: CommandStep[] = [];
  let steps: CommandStep[] = [];
  let inputs: DriftInput[] = [];
  let planNotes: string[] = [];
  let k1Source: string | null = null;
  const cmdCtx: CommandCtx = {
    outRoot: ctx.outRoot,
    runDir: ctx.runDir,
    fiks: ctx.fiks,
    tsx: ctx.tsx,
    dry: f.dry,
    toolsImage: f.toolsImage,
  };
  if (def.kind === 'blocks') {
    const ins = resolveInputs(def, f, ctx);
    const { plan, k1, notes } = planPhases(def, f, ctx, ins);
    planNotes = notes;
    k1Source = k1?.source ?? null;
    const used = new Map<string, DriftInput>();
    for (const p of plan) for (const d of p.drifts) used.set(d.id, d);
    inputs = [...used.values()];
    const traceOf = (d: DriftInput) => d.trace ?? join(ctx.runDir, 'prepare', d.id, 'trace.json');
    for (const d of inputs) {
      if (!d.trace) prepare.push(...prepareArgvs(ctx.fiks, d, join(ctx.runDir, 'prepare', d.id)));
    }
    blocks = buildBlocks(plan, {
      runId: def.id,
      seed: ctx.seed,
      fiks: ctx.fiks,
      traceOf,
      dry: f.dry,
      reproStub: join(ctx.repo, REPRO_STUB),
      extraArms: f.dry ? ((def.dryExtraArms ?? []) as ArmName[]) : [],
    });
  } else {
    steps = commandSteps(def, f, ctx, cmdCtx);
  }
  const planDoc = {
    run: def.id,
    seed: ctx.seed,
    dry: f.dry,
    inputs,
    prepare,
    steps,
    blocks,
    notes: planNotes,
    k1: k1Source,
  };
  const planJson = `${JSON.stringify(planDoc, null, 2)}\n`;
  const planSha = sha(planJson);
  if (f.printPlan) {
    process.stdout.write(planJson);
    return 0;
  }

  // --- meta.json: written once; a resume must match the frozen commit, seed and plan ------------
  const metaFile = join(ctx.runDir, 'meta.json');
  const prior = readMeta(metaFile);
  if (prior) {
    const bad: string[] = [];
    if (prior.fiksCommit !== fiksCommit) bad.push(`commit ${String(prior.fiksCommit)} -> ${fiksCommit}`);
    if (prior.seed !== ctx.seed) bad.push(`seed ${String(prior.seed)} -> ${ctx.seed}`);
    if (prior.planSha !== planSha) bad.push('plan (flags or inputs changed)');
    if (prior.dry !== f.dry) bad.push('dry flag');
    if (bad.length) throw new GuardError(`refused to resume ${ctx.runDir}: ${bad.join('; ')}`);
  }

  if (!prior) writeFileSync(join(ctx.runDir, 'plan.json'), planJson);
  const session =
    loadRegistry(join(ctx.runDir, 'registry.jsonl')).events.filter((e) => e.t === 'run_start').length + 1;
  writeMeta(metaFile, prior, {
    run: def.id,
    title: def.title,
    seed: ctx.seed,
    dry: f.dry,
    fiksCommit,
    planSha,
    repo: ctx.repo,
    tree: ctx.tree,
    outRoot: ctx.outRoot,
    argv: process.argv.slice(2),
    overrides,
    workers: f.workers,
    rssCapMb: f.rssCapMb,
    node: process.version,
    k1: k1Source,
    preflight,
    session,
    startedAt: new Date(startedAt).toISOString(),
  });

  // --- registry ----------------------------------------------------------------------------------
  const registry = new Registry(join(ctx.runDir, 'registry.jsonl'));
  const state = loadRegistry(registry.file);
  if (state.skipped) log(`registry: skipped ${state.skipped} torn line(s) from a killed session`);
  registry.append({
    t: 'run_start',
    at: new Date().toISOString(),
    pid: process.pid,
    argv: process.argv.slice(2),
    workers: f.workers,
    fiksCommit,
  });
  const discarded = recoverIncomplete(ctx.runDir, registry, state, session);
  if (discarded) log(`resume: discarded ${discarded} incomplete block(s); they re-run whole`);
  const env = childEnv(f.dry);
  const timeoutMs = f.attemptTimeoutMin * 60_000;
  const base: Omit<Status, 'state' | 'at'> = {
    type: 'status',
    run: def.id,
    pauseReason: null,
    phase: null,
    blocksTotal: blocks.length,
    blocksDone: 0,
    blocksDropped: 0,
    blocksInFlight: 0,
    blocksDiscarded: discarded,
    attemptsTotal: blocks.reduce((s, b) => s + b.jobs.length, 0),
    attemptsFinished: 0,
    infraRetries: 0,
    stepsTotal: prepare.length + steps.length,
    stepsDone: 0,
    workers: def.kind === 'blocks' ? f.workers : 0,
    rssMb: null,
    elapsedMs: 0,
  };
  const at = () => new Date().toISOString();
  emit({ ...base, state: 'starting', at: at(), elapsedMs: Date.now() - startedAt });
  const end = (state: 'complete' | 'paused' | 'failed', code: number) => {
    registry.append({ t: 'run_end', at: at(), state });
    registry.close();
    return code;
  };

  const seq = await runSteps({
    steps: def.kind === 'blocks' ? prepare : steps,
    kind: def.kind === 'blocks' ? 'prepare' : 'step',
    runDir: ctx.runDir,
    cwd: ctx.repo,
    env,
    registry,
    state,
    session,
    timeoutMs,
    onProgress: (done, total) =>
      emit({
        ...base,
        state: def.kind === 'blocks' ? 'preparing' : 'running',
        at: at(),
        stepsDone: done,
        stepsTotal: total,
        elapsedMs: Date.now() - startedAt,
      }),
  });
  if (seq.state === 'paused') {
    emit({ ...base, state: 'paused', pauseReason: 'cap', at: at(), elapsedMs: Date.now() - startedAt });
    log(`cap stop${seq.resetAt ? ` (resets ${seq.resetAt})` : ''}: re-run the same command to resume`);
    return end('paused', 3);
  }
  if (seq.state === 'error') {
    emit({ ...base, state: 'error', at: at(), elapsedMs: Date.now() - startedAt });
    log(seq.message);
    return end('failed', 1);
  }
  if (def.kind === 'commands') {
    emit({
      ...base,
      state: 'complete',
      at: at(),
      stepsDone: steps.length,
      elapsedMs: Date.now() - startedAt,
    });
    return end('complete', 0);
  }

  const r = await runPool({
    runId: def.id,
    runDir: ctx.runDir,
    cwd: ctx.repo,
    registry,
    state,
    blocks,
    workers: f.workers,
    env,
    session,
    timeoutMs,
    maxRequeues: 2,
    rssCapMb: f.rssCapMb,
    waitOnCap: f.waitOnCap,
    infraWindow: 50,
    infraMaxRate: 0.1,
    emit,
    startedAt,
    stepsTotal: prepare.length,
  });
  if (r.state === 'complete') return end('complete', 0);
  if (r.state === 'paused') {
    log(
      `paused (${r.reason})${'resetAt' in r && r.resetAt ? `; resets ${r.resetAt}` : ''}: re-run the same command to resume`,
    );
    return end('paused', 3);
  }
  log(r.message);
  return end('failed', 1);
}

function writeMeta(file: string, prior: Record<string, unknown> | null, add: Record<string, unknown>): void {
  if (!prior) {
    writeFileSync(file, `${JSON.stringify(add, null, 2)}\n`);
    return;
  }
  // A resume keeps the first session's fields and appends this session's under `resumes`.
  const resumes = Array.isArray(prior.resumes) ? (prior.resumes as unknown[]) : [];
  writeFileSync(file, `${JSON.stringify({ ...prior, resumes: [...resumes, add] }, null, 2)}\n`);
}

function commandSteps(def: CommandRun, f: RunFlags, ctx: Ctx, c: CommandCtx): CommandStep[] {
  if (def.id === 'R2') return r2Steps(c, f.split ?? join(ctx.outRoot, 'R0', 'split.json'));
  if (def.id === 'R5') {
    const from = f.from ?? 'R4';
    const g = gradeSteps(c, join(ctx.outRoot, from));
    for (const s of g.skipped) log(`R5: ${s.runKey} not graded: ${s.reason}`);
    return g.steps;
  }
  if (def.id === 'R9') {
    const file = f.k1 ?? join(ctx.outRoot, 'K1', 'fit.json');
    const ollama = existsSync(file)
      ? !(JSON.parse(readFileSync(file, 'utf8')) as { ollama?: { cut?: boolean } }).ollama?.cut
      : false;
    if (!existsSync(file)) log(`R9: no K1 fit at ${file}: the ollama share is not run`);
    return trafficSteps(c, ollama);
  }
  if (def.id === 'R11') {
    const eligible = manifestInputs(
      f.manifest ?? join(ctx.outRoot, 'R2', 'eligible.json'),
      join(ctx.repo, STUB_DIR),
    );
    const drawn = showcaseDraw(eligible, ctx.seed);
    return showcaseSteps(c, drawn, (d) => join(ctx.repo, '.work', d === 'shop' ? 'shop-mcp' : `${d}-mcp`));
  }
  return def.steps(c);
}

// --- fit ------------------------------------------------------------------------------------------

export function fitMain(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      measured: { type: 'string' },
      'window-days': { type: 'string' },
      params: { type: 'string' },
      'peak-rss-mb': { type: 'string' },
      'cap-pause-fraction': { type: 'string' },
      'sustained-units-per-hour': { type: 'string' },
      'r0-hours': { type: 'string' },
      'r5-hours': { type: 'string' },
      seed: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (!values.measured)
    throw new GuardError('usage: main.ts fit --measured <throughput.json> [--window-days 8] ...');
  const t = loadThroughput(values.measured);
  const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));
  const m = measuredRate(t, {
    source: values.measured,
    ...(values['peak-rss-mb'] ? { peakRssMbPerWorker: Number(values['peak-rss-mb']) } : {}),
    ...(values['cap-pause-fraction'] ? { capPauseFraction: Number(values['cap-pause-fraction']) } : {}),
  });
  const params: ProjectionParams = {
    ...DEFAULT_PARAMS,
    ...(values.params ? (JSON.parse(readFileSync(values.params, 'utf8')) as Partial<ProjectionParams>) : {}),
  };
  const seed = values.seed ?? 'k1';
  const steps = configSteps(params, seed);
  const fi: FitInputs = {
    ...DEFAULT_FIT,
    sustainedUnitsPerHour: num(values['sustained-units-per-hour']) ?? m.sustainedUnitsPerHour,
    windowDays: num(values['window-days']) ?? DEFAULT_FIT.windowDays,
    r0Hours: num(values['r0-hours']) ?? DEFAULT_FIT.r0Hours,
    r5Hours: num(values['r5-hours']) ?? DEFAULT_FIT.r5Hours,
    memory: {
      ...DEFAULT_FIT.memory,
      workers: m.workers,
      rssPerWorkerGb: (num(values['peak-rss-mb']) ?? DEFAULT_FIT.memory.rssPerWorkerGb * 1024) / 1024,
    },
  };
  const r = fit(steps, params, fi);
  const ollama = ollamaRule(params, m.ollamaTokensPerSec);
  const out = {
    seed,
    measured: m,
    fitInputs: fi,
    params,
    steps,
    table: r.table,
    chosen: r.chosen,
    fits: r.fits,
    note: r.note,
    ollama,
  };
  const text = `${JSON.stringify(out, null, 2)}\n`;
  if (values.out) {
    if (existsSync(values.out))
      throw new GuardError(`refused: ${values.out} exists (results never overwrite)`);
    mkdirSync(dirname(resolve(values.out)), { recursive: true });
    writeFileSync(values.out, text);
  }
  process.stdout.write(text);
  log(`fit: ${r.note}; ollama: ${ollama.reason}`);
  return 0;
}

// --- status / list / schema ---------------------------------------------------------------------

function statusMain(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { 'out-root': { type: 'string' }, dry: { type: 'boolean', default: false } },
  });
  const id = positionals[0];
  if (!id) throw new GuardError('usage: main.ts status <run-id> [--out-root dir]');
  getRun(id);
  const outRoot = resolve(
    (values['out-root'] as string | undefined) ??
      (values.dry ? join(FIKS_ROOT, '.fiks', 'exp-dry') : join(FIKS_ROOT, 'paper', 'results', 'raw')),
  );
  const runDir = join(outRoot, id);
  const planFile = join(runDir, 'plan.json');
  if (!existsSync(planFile)) throw new GuardError(`no run at ${runDir}`);
  const plan = JSON.parse(readFileSync(planFile, 'utf8')) as {
    blocks: Block[];
    steps: CommandStep[];
    prepare: CommandStep[];
  };
  const st = loadRegistry(join(runDir, 'registry.jsonl'));
  const last = [...st.events].reverse().find((e) => e.t === 'run_end' || e.t === 'run_start');
  const ended = last?.t === 'run_end' ? last.state : null;
  emit({
    type: 'status',
    run: id,
    at: new Date().toISOString(),
    state:
      ended === 'complete'
        ? 'complete'
        : ended === 'paused'
          ? 'paused'
          : ended === 'failed'
            ? 'error'
            : 'running',
    pauseReason: null,
    phase: null,
    blocksTotal: plan.blocks.length,
    blocksDone: plan.blocks.filter((b) => st.completeBlocks.has(b.id)).length,
    blocksDropped: plan.blocks.filter((b) => st.droppedBlocks.has(b.id)).length,
    blocksInFlight: 0,
    blocksDiscarded: st.events.filter((e) => e.t === 'block_discarded').length,
    attemptsTotal: plan.blocks.reduce((s, b) => s + b.jobs.length, 0),
    attemptsFinished: plan.blocks
      .filter((b) => st.completeBlocks.has(b.id))
      .reduce((s, b) => s + b.jobs.length, 0),
    infraRetries: 0,
    stepsTotal: plan.steps.length + plan.prepare.length,
    stepsDone: st.steps.size + st.prepared.size,
    workers: 0,
    rssMb: null,
    elapsedMs: 0,
  });
  return 0;
}

const USAGE = `usage: main.ts <run-id> [--dry] [--dev] [--drifts a,b] [--models m,n] [--attempts n] [--workers n] ...
       main.ts fit --measured <throughput.json> [--window-days 8] [--params p.json] [--out file]
       main.ts status <run-id> [--out-root dir] | list | schema
runs: ${RUNS.map((r) => r.id).join(', ')}`;

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  try {
    if (!cmd || cmd === '--help' || cmd === 'help') {
      process.stderr.write(`${USAGE}\n`);
      return cmd ? 0 : 2;
    }
    if (cmd === 'fit') return fitMain(rest);
    if (cmd === 'status') return statusMain(rest);
    if (cmd === 'list') {
      for (const r of RUNS) process.stderr.write(`${r.id.padEnd(7)} ${r.kind.padEnd(9)} ${r.title}\n`);
      return 0;
    }
    if (cmd === 'schema') {
      process.stdout.write(`${JSON.stringify(statusJsonSchema(), null, 2)}\n`);
      return 0;
    }
    return await runMain(cmd, rest);
  } catch (e) {
    if (e instanceof GuardError) {
      log(e.message);
      return e.exitCode;
    }
    if (String((e as { code?: unknown })?.code ?? '').startsWith('ERR_PARSE_ARGS')) {
      log(`${(e as Error).message}\n${USAGE}`);
      return 2;
    }
    log(e instanceof Error ? (e.stack ?? e.message) : String(e));
    return 1;
  }
}

const self = fileURLToPath(import.meta.url);
if (
  process.argv[1] &&
  realpathSync(isAbsolute(process.argv[1]) ? process.argv[1] : resolve(process.argv[1])) === self
) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
