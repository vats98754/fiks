// `fiks traffic` (TRAFFIC; PLAN 5.9): held-out multi-model traffic. Opus, Sonnet and Haiku (Agent
// SDK) and the approved ollama model each work the domain's task prompts `--trials` times against
// the domain's MCP server at `--ref` on a fresh v1 vendor (original catalog, frozen clock). Only
// the tool-call arguments are kept: args.jsonl + args.jsonl.sha256 (see @fiks/traffic collect).
import { execFileSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { DirtyTreeError, dirtyPaths } from '@fiks/bench';
import { getDomain } from '@fiks/domains';
import type { CliCommandModule, Domain } from '@fiks/interfaces';
import { createWorktree } from '@fiks/repro';
import {
  AGENT_NAMES,
  type AgentName,
  type AgentSpec,
  CLAUDE_MODELS,
  type CollectResult,
  claudeAgent,
  collect,
  ollamaAgent,
  ollamaModel,
  ollamaReadiness,
  resolveTasks,
  type SkippedAgent,
  selectTasks,
  stubAgent,
  type TrafficAgent,
  trafficSystem,
} from '@fiks/traffic';
import { FIKS_DIR, ROOT } from '../paths.ts';

const DESCRIBE = 'held-out multi-model traffic: tool-call args JSONL + sha256 (PLAN 5.9)';

const HELP = `usage: fiks traffic --domain <id> [options]

  ${DESCRIBE}

  --domain <id>            registered domain (shop, tracker, ...)
  --agents <list>          comma list of ${AGENT_NAMES.join(', ')} (default: all four)
  --trials <n>             sessions per agent and task (default 3)
  --tasks <ids>            subset of the task ids (default: all)
  --prompts <file>         task prompts JSON {tasks:[{id,prompt}]} (default: packages/traffic/tasks/<domain>.json,
                           else the domain's registered tasks)
  --ref <git ref>          server code to run, resolved locally (default: the domain's seed tag)
  --out <dir>              output folder (never overwritten; default .fiks/traffic/<runId>)
  --workers <n>            parallel Claude sessions, each with its own vendor (default 1; ollama always 1)
  --max-turns <n>          agent turn cap per session (default 12)
  --agent-stub <builtin|module>
                           replace every agent by a deterministic stub (no LLM call; FIKS_LLM_FORBID=1)
  --allow-dirty            run on an uncommitted fiks tree (scratch output only)
  --json                   print the result as JSON

The ollama agent is skipped, with the reason, when no model is approved in packages/llm/ollama.json
or the approved model cannot run here. Exit 3 when a usage cap stopped the Claude sessions.`;

const OPTIONS = {
  domain: { type: 'string' },
  agents: { type: 'string', default: AGENT_NAMES.join(',') },
  trials: { type: 'string', default: '3' },
  tasks: { type: 'string' },
  prompts: { type: 'string' },
  ref: { type: 'string' },
  out: { type: 'string' },
  workers: { type: 'string', default: '1' },
  'max-turns': { type: 'string', default: '12' },
  'agent-stub': { type: 'string' },
  'allow-dirty': { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

const intFlag = (name: string, v: string, min: number) => {
  if (!/^\d+$/.test(v) || Number(v) < min)
    throw new UsageError(`--${name} must be an integer >= ${min}, got ${JSON.stringify(v)}`);
  return Number(v);
};

class UsageError extends Error {}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

/** The stub that replaces every agent: the built-in one, or a module's default export. */
async function loadStub(spec: string): Promise<TrafficAgent> {
  if (spec === 'builtin') return stubAgent();
  const mod = (await import(pathToFileURL(resolve(spec)).href)) as { default?: unknown };
  if (typeof mod.default !== 'function')
    throw new UsageError(`--agent-stub ${spec}: the module has no default-export agent function`);
  return mod.default as TrafficAgent;
}

export interface TrafficDeps {
  /** The fiks checkout checked for cleanliness and recorded (default: this one). */
  root?: string;
  /** Replaces every agent (tests). */
  agent?: TrafficAgent;
  /** Test seams for the real routes: the Claude and ollama agents, the approved model, readiness. */
  claude?: TrafficAgent;
  ollama?: {
    agent?: TrafficAgent;
    model?: () => string | null;
    readiness?: () => Promise<{ ready: boolean; reason?: string }>;
  };
}

export async function traffic(
  argv: string[],
  deps: TrafficDeps = {},
): Promise<CollectResult & { runId: string }> {
  const values = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false }).values;
  if (!values.domain) throw new UsageError('--domain is required');
  const names = values.agents.split(',').map((s) => s.trim());
  const bad = names.filter((n) => !(AGENT_NAMES as readonly string[]).includes(n));
  if (bad.length || names.length === 0)
    throw new UsageError(`--agents takes ${AGENT_NAMES.join(', ')}; got ${JSON.stringify(values.agents)}`);
  if (new Set(names).size !== names.length) throw new UsageError(`--agents lists an agent twice`);
  const trials = intFlag('trials', values.trials, 1);
  const workers = intFlag('workers', values.workers, 1);
  const maxTurns = intFlag('max-turns', values['max-turns'], 1);

  const root = deps.root ?? ROOT;
  // Runners refuse a dirty tree (PLAN 7): meta.json must name exactly the code that ran.
  const dirty = dirtyPaths(root);
  if (dirty.length && !values['allow-dirty']) throw new DirtyTreeError(root, dirty);

  const d: Domain = getDomain(values.domain);
  const taskSet = selectTasks(resolveTasks(d, values.prompts), values.tasks?.split(','));

  const stub = deps.agent ?? (values['agent-stub'] ? await loadStub(values['agent-stub']) : undefined);
  // A stub run can make no Claude or ollama call (LLMR throws LlmForbiddenError).
  if (stub) process.env.FIKS_LLM_FORBID = '1';
  const agents: AgentSpec[] = [];
  const skipped: SkippedAgent[] = [];
  for (const name of names as AgentName[]) {
    if (name === 'ollama') {
      const model = (deps.ollama?.model ?? ollamaModel)();
      if (stub) {
        agents.push({ name, model: `stub:${model ?? 'ollama'}`, route: 'stub', run: stub, workers: 1 });
        continue;
      }
      if (!model) {
        skipped.push({
          agent: name,
          model: null,
          reason: 'no ollama model is approved (packages/llm/ollama.json)',
        });
        continue;
      }
      const ready = await (deps.ollama?.readiness ?? ollamaReadiness)();
      if (!ready.ready) {
        skipped.push({ agent: name, model, reason: ready.reason ?? 'not ready' });
        continue;
      }
      agents.push({ name, model, route: 'ollama', run: deps.ollama?.agent ?? ollamaAgent(), workers: 1 });
    } else {
      const model = CLAUDE_MODELS[name];
      if (stub) agents.push({ name, model: `stub:${model}`, route: 'stub', run: stub });
      else agents.push({ name, model, route: 'claude', run: deps.claude ?? claudeAgent() });
    }
  }
  for (const s of skipped) console.error(`${s.agent} SKIP: ${s.reason}`);
  if (!deps.claude && agents.some((a) => a.route === 'claude') && !process.env.CLAUDE_CODE_OAUTH_TOKEN)
    throw new Error(
      'traffic needs a Claude credential: CLAUDE_CODE_OAUTH_TOKEN in .env (from `claude setup-token`)',
    );
  if (agents.length === 0)
    throw new Error(`no agent can run (${skipped.map((s) => s.agent).join(', ')} skipped)`);

  const startedAt = new Date().toISOString();
  const runId = `${d.id}_traffic_${startedAt.replace(/[-:.]/g, '').slice(0, 15)}`;
  const out = values.out ? resolve(values.out) : join(FIKS_DIR, 'traffic', runId);
  if (dirty.length) {
    const rel = relative(root, out);
    const evidence = ['bench/results', 'bench/evidence', 'paper/results'].some(
      (p) => !rel.startsWith('..') && !isAbsolute(rel) && (rel === p || rel.startsWith(`${p}/`)),
    );
    if (evidence) throw new UsageError(`--allow-dirty runs never write to committed evidence (${rel})`);
  }

  const ref = values.ref ?? d.seedTag;
  const wt = createWorktree(d.repo.dir(), ref, { prefix: 'fiks-traffic-wt-' });
  // An interrupted run still removes its worktree (transcripts written so far stay in out/).
  const onSignal = (sig: NodeJS.Signals) => {
    wt.remove();
    process.exit(sig === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const cmd = d.serverCommand(wt.dir);
    return {
      runId,
      ...(await collect({
        domain: d.id,
        agents,
        tasks: taskSet,
        trials,
        createVendor: () => d.createVendor('original', { version: 'v1', now: () => new Date(d.frozenClock) }),
        server: (vendorUrl) => ({
          command: cmd.command,
          args: cmd.args,
          cwd: cmd.cwd,
          env: { [d.baseUrlEnv]: vendorUrl, PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
        }),
        serverName: d.id,
        system: trafficSystem(d.id),
        maxTurns,
        out,
        workers,
        skipped,
        meta: {
          runId,
          server: { repo: d.repo.slug, ref, commit: wt.commit },
          vendor: { version: 'v1', catalog: 'original', clock: d.frozenClock },
          fiksSha: git(root, 'rev-parse', 'HEAD'),
          fiksDirty: dirty.length > 0,
          agentStub: stub ? (values['agent-stub'] ?? 'injected') : null,
        },
        onSession: (s) => {
          if (!values.json)
            console.error(
              `${s.agent} ${s.taskId} #${s.trial}: ${s.outcome}, ${s.validCalls}/${s.calls} valid call(s)`,
            );
        },
      })),
    };
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    wt.remove();
  }
}

/** `fiks traffic`, parsing its own argv (P18). Returns the exit code. */
export async function runTrafficCommand(argv: string[], deps: TrafficDeps = {}): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return 0;
  }
  let r: Awaited<ReturnType<typeof traffic>>;
  try {
    r = await traffic(argv, deps);
  } catch (e) {
    const usage = e instanceof UsageError || (e as { code?: string }).code?.startsWith('ERR_PARSE_ARGS');
    console.error(`${e instanceof Error ? e.message : String(e)}${usage ? `\n\n${HELP}` : ''}`);
    return usage || e instanceof DirtyTreeError ? 2 : 1;
  }
  const capped = r.sessions.some((s) => s.outcome === 'cap' || s.outcome === 'skipped_cap');
  if (argv.includes('--json'))
    console.log(JSON.stringify({ runId: r.runId, out: r.out, meta: r.meta }, null, 2));
  else {
    const perAgent = r.meta.perAgent as Record<
      string,
      { validCalls: number; calls: number; tasksWithValidCall: number }
    >;
    for (const [name, a] of Object.entries(perAgent))
      console.log(
        `  ${name}: ${a.validCalls}/${a.calls} valid calls; ${a.tasksWithValidCall} task(s) with a valid call`,
      );
    console.log(`${r.runId}: ${r.rows.length} rows, sha256 ${r.argsSha256} -> ${r.out}`);
  }
  if (capped) console.error('a usage cap stopped the Claude sessions (see sessions.jsonl)');
  return capped ? 3 : 0;
}

const command: CliCommandModule = {
  name: 'traffic',
  describe: DESCRIBE,
  run: (argv) => runTrafficCommand(argv),
};
export default command;
