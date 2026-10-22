// The held-out traffic collector (PLAN 5.9; oracle criterion 5, stratum S-agent): every agent x
// task x trial works the task against the domain's MCP server on a fresh v1 vendor, and only the
// tool-call arguments are kept. Output, in `out/`:
//   args.jsonl         one canonical-JSON row per tool call, in (agent, task, trial, seq) order,
//                      with no timing or cost, so the same calls give the same bytes
//   args.jsonl.sha256  `<sha256>  args.jsonl`
//   sessions.jsonl     one line per session: outcome, turns, tokens, cost, wall time, transcript
//   meta.json          what ran (domain, server commit, agents and models, tasks source and hash,
//                      tools hash, skipped agents, counts, argsSha256)
//   transcripts/       one JSONL transcript per session (Claude: LLMR agentSession; ollama: calls)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRoute, SessionOutcome, SessionOutput, SessionTokens, TrafficAgent } from './agents.ts';
import { canonical, dedupeKey, sha256 } from './canonical.ts';
import { listServerTools, type McpServerSpec, type ToolDef } from './mcp.ts';
import { schemaError } from './schema.ts';
import type { TaskSet } from './tasks.ts';

export const STRATUM = 'S-agent';

/** One held-out tool call. `domain, stratum, tool, args, dedupeKey` are the EnumRow fields. */
export interface TrafficRow {
  domain: string;
  stratum: typeof STRATUM;
  agent: string;
  model: string;
  taskId: string;
  trial: number;
  /** 1-based position of the call in its session (replay a session's calls in this order). */
  seq: number;
  tool: string;
  /** `{}` when the agent's arguments were not a JSON object (see rawArgs). */
  args: Record<string, unknown>;
  rawArgs?: string;
  /** Known tool, JSON-object args that satisfy the tool's inputSchema. */
  valid: boolean;
  invalidReason?: string;
  /** The server answered with an error (null: never executed). */
  toolError: boolean | null;
  dedupeKey: string;
}

export type SessionStatus = SessionOutcome | 'skipped_cap';

export interface SessionRecord {
  agent: string;
  model: string;
  route: AgentRoute;
  taskId: string;
  trial: number;
  outcome: SessionStatus;
  error?: string;
  calls: number;
  validCalls: number;
  turns: number;
  costUsd: number;
  tokens: SessionTokens;
  wallMs: number;
  worker: number;
  /** Relative to `out`, when the agent wrote one. */
  transcript?: string;
}

export interface AgentSpec {
  name: string;
  model: string;
  route: AgentRoute;
  run: TrafficAgent;
  /** Parallel sessions for this agent (default: the collector's `workers`; ollama runs 1). */
  workers?: number;
}

export interface SkippedAgent {
  agent: string;
  model: string | null;
  reason: string;
}

/** A vendor as `Domain.createVendor` returns it. */
export interface VendorLike {
  reset(): void;
  listen(port?: number): Promise<string>;
  close(): Promise<void>;
}

export interface CollectOptions {
  domain: string;
  agents: AgentSpec[];
  tasks: TaskSet;
  trials: number;
  /** A fresh vendor (one per worker; reset before every session). */
  createVendor: () => VendorLike;
  /** The MCP server for a vendor URL. */
  server: (vendorUrl: string) => McpServerSpec;
  serverName: string;
  system: string;
  maxTurns: number;
  out: string;
  workers?: number;
  /** Agents that were asked for but cannot run (e.g. no approved ollama model); listed in meta. */
  skipped?: SkippedAgent[];
  /** Extra meta.json fields (server ref and commit, fiks commit, ...). */
  meta?: Record<string, unknown>;
  onSession?: (s: SessionRecord) => void;
}

export interface CollectResult {
  out: string;
  argsSha256: string;
  rows: TrafficRow[];
  sessions: SessionRecord[];
  meta: Record<string, unknown>;
}

const OUTPUTS = ['args.jsonl', 'args.jsonl.sha256', 'sessions.jsonl', 'meta.json'];

/** The rows of one session, validated against the server's tools. */
export function rowsOf(
  domain: string,
  agent: { name: string; model: string },
  job: { taskId: string; trial: number },
  calls: SessionOutput['calls'],
  tools: readonly ToolDef[],
): TrafficRow[] {
  return calls.map((c, i) => {
    const def = tools.find((t) => t.name === c.tool);
    const args = c.args ?? {};
    const invalidReason =
      c.args === null
        ? 'arguments are not a JSON object'
        : !def
          ? `unknown tool ${c.tool}`
          : (schemaError(def.inputSchema, c.args) ?? undefined);
    return {
      domain,
      stratum: STRATUM,
      agent: agent.name,
      model: agent.model,
      taskId: job.taskId,
      trial: job.trial,
      seq: i + 1,
      tool: c.tool,
      args,
      ...(c.rawArgs !== undefined ? { rawArgs: c.rawArgs } : {}),
      valid: invalidReason === undefined,
      ...(invalidReason !== undefined ? { invalidReason } : {}),
      toolError: c.toolError,
      dedupeKey: dedupeKey(domain, STRATUM, c.tool, args),
    };
  });
}

async function pool<T>(items: readonly T[], n: number, work: (item: T, worker: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async (_, w) => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        await work(items[i] as T, w);
      }
    }),
  );
}

export async function collect(opts: CollectOptions): Promise<CollectResult> {
  if (!Number.isInteger(opts.trials) || opts.trials < 1)
    throw new Error(`trials must be an integer >= 1, got ${opts.trials}`);
  const workers = opts.workers ?? 1;
  if (!Number.isInteger(workers) || workers < 1)
    throw new Error(`workers must be an integer >= 1, got ${workers}`);
  const names = opts.agents.map((a) => a.name);
  if (new Set(names).size !== names.length) throw new Error(`duplicate agent in ${names.join(',')}`);
  // Results are never overwritten (P6).
  const taken = OUTPUTS.filter((f) => existsSync(join(opts.out, f)));
  if (taken.length) throw new Error(`refusing to overwrite an existing traffic run in ${opts.out}`);
  mkdirSync(join(opts.out, 'transcripts'), { recursive: true });
  const startedAt = new Date().toISOString();

  // One vendor per worker, created on first use and kept for every later agent.
  const vendors: Promise<{ vendor: VendorLike; url: string }>[] = [];
  const vendorFor = (w: number) => {
    vendors[w] ??= (async () => {
      const vendor = opts.createVendor();
      return { vendor, url: await vendor.listen() };
    })();
    return vendors[w];
  };

  const rows = new Map<string, TrafficRow[]>();
  const sessions: SessionRecord[] = [];
  const key = (agent: string, taskId: string, trial: number) => `${agent}\n${taskId}\n${trial}`;
  let tools: ToolDef[] = [];
  try {
    tools = await listServerTools(opts.server((await vendorFor(0)).url));
    if (tools.length === 0) throw new Error(`the ${opts.domain} server lists no tools`);
    const capped = new Set<AgentRoute>();
    for (const agent of opts.agents) {
      const jobs = opts.tasks.tasks.flatMap((t) =>
        Array.from({ length: opts.trials }, (_, k) => ({ task: t, trial: k + 1 })),
      );
      const n = agent.route === 'ollama' ? 1 : (agent.workers ?? workers);
      await pool(jobs, n, async ({ task, trial }, worker) => {
        const base = { agent: agent.name, model: agent.model, route: agent.route, taskId: task.id, trial };
        if (capped.has(agent.route)) {
          const s: SessionRecord = {
            ...base,
            outcome: 'skipped_cap',
            calls: 0,
            validCalls: 0,
            turns: 0,
            costUsd: 0,
            tokens: { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 },
            wallMs: 0,
            worker,
          };
          sessions.push(s);
          opts.onSession?.(s);
          return;
        }
        const { vendor, url } = await vendorFor(worker);
        vendor.reset();
        const transcript = join('transcripts', `${agent.name}-${task.id}-${trial}.jsonl`);
        const r = await agent.run({
          agent: agent.name,
          model: agent.model,
          taskId: task.id,
          trial,
          prompt: task.prompt,
          system: opts.system,
          serverName: opts.serverName,
          server: opts.server(url),
          maxTurns: opts.maxTurns,
          transcriptPath: join(opts.out, transcript),
          logPath: join(opts.out, 'llm-calls.jsonl'),
        });
        if (r.outcome === 'cap') capped.add(agent.route);
        const got = rowsOf(opts.domain, agent, { taskId: task.id, trial }, r.calls, tools);
        rows.set(key(agent.name, task.id, trial), got);
        const s: SessionRecord = {
          ...base,
          outcome: r.outcome,
          ...(r.error ? { error: r.error } : {}),
          calls: got.length,
          validCalls: got.filter((x) => x.valid).length,
          turns: r.turns,
          costUsd: r.costUsd,
          tokens: r.tokens,
          wallMs: r.wallMs,
          worker,
          ...(existsSync(join(opts.out, transcript)) ? { transcript } : {}),
        };
        sessions.push(s);
        opts.onSession?.(s);
      });
    }
  } finally {
    await Promise.all(vendors.map((p) => p.then((v) => v.vendor.close()).catch(() => {})));
  }

  // Deterministic order: agents as given, tasks as in the task set, trials ascending.
  const ordered: TrafficRow[] = [];
  const orderedSessions: SessionRecord[] = [];
  for (const a of opts.agents)
    for (const t of opts.tasks.tasks)
      for (let trial = 1; trial <= opts.trials; trial++) {
        ordered.push(...(rows.get(key(a.name, t.id, trial)) ?? []));
        const s = sessions.find((x) => x.agent === a.name && x.taskId === t.id && x.trial === trial);
        if (s) orderedSessions.push(s);
      }
  const argsText = ordered.map((r) => `${canonical(r)}\n`).join('');
  const argsSha256 = sha256(argsText);
  writeFileSync(join(opts.out, 'args.jsonl'), argsText);
  writeFileSync(join(opts.out, 'args.jsonl.sha256'), `${argsSha256}  args.jsonl\n`);
  writeFileSync(
    join(opts.out, 'sessions.jsonl'),
    orderedSessions.map((s) => `${JSON.stringify(s)}\n`).join(''),
  );

  const perAgent = Object.fromEntries(
    opts.agents.map((a) => {
      const ss = orderedSessions.filter((s) => s.agent === a.name);
      const rs = ordered.filter((r) => r.agent === a.name);
      const tasksWithValidCall = opts.tasks.tasks.filter((t) =>
        rs.some((r) => r.taskId === t.id && r.valid),
      ).length;
      const outcomes: Record<string, number> = {};
      for (const s of ss) outcomes[s.outcome] = (outcomes[s.outcome] ?? 0) + 1;
      return [
        a.name,
        {
          model: a.model,
          route: a.route,
          sessions: ss.length,
          outcomes,
          calls: rs.length,
          validCalls: rs.filter((r) => r.valid).length,
          tasksWithValidCall,
          costUsd: ss.reduce((x, s) => x + s.costUsd, 0),
        },
      ];
    }),
  );
  const meta = {
    domain: opts.domain,
    stratum: STRATUM,
    ...opts.meta,
    agents: opts.agents.map((a) => ({ name: a.name, model: a.model, route: a.route })),
    skipped: opts.skipped ?? [],
    trials: opts.trials,
    tasks: { source: opts.tasks.source, sha256: opts.tasks.sha256, ids: opts.tasks.tasks.map((t) => t.id) },
    tools: { names: tools.map((t) => t.name), sha256: sha256(canonical(tools)) },
    serverName: opts.serverName,
    systemSha256: sha256(opts.system),
    maxTurns: opts.maxTurns,
    workers,
    perAgent,
    rows: ordered.length,
    argsSha256,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(opts.out, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  return { out: opts.out, argsSha256, rows: ordered, sessions: orderedSessions, meta };
}

/** The system prompt every traffic agent gets (no fiks vocabulary: the server runs without the proxy). */
export function trafficSystem(serverName: string): string {
  return `You are an assistant for a user of the ${serverName} service. You can act only through the ${serverName} tools. Use them to do what the user asks, then reply to the user with the answer.`;
}
