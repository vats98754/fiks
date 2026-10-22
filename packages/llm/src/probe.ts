// T0 throughput probe (PLAN 8.1): representative authoring sessions at 1/2/4 concurrent, optional
// repair-like workers at 1/2/4/6, and ollama tokens/s. Measures attempts/h, 429/overload rate, cap
// events and spawn overhead, and writes throughput.json (schema: throughput.ts).
//
//   pnpm tsx packages/llm/src/probe.ts --concurrency 1,2,4 [--repair-workers 1,2,4,6] [--ollama]
//     [--dry] [--sessions-per-level n] [--authoring-model m] [--repair-model m] --out <path>
//   pnpm tsx packages/llm/src/probe.ts --validate <file>     (exit 0 iff it matches the schema)
//   pnpm tsx packages/llm/src/probe.ts --print-schema
//
// The run step T0 passes --out paper/results/raw/throughput.json. --dry plays a deterministic fake
// query and fake ollama (no network, no token) and refuses any --out under paper/results. A live
// probe refuses while $HOME/.fiks/build-swarm.active exists (PLAN 7.1: no live run overlaps a build).

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { arch, cpus, homedir, platform, tmpdir, totalmem } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LlmFailure } from './classify.ts';
import { loadRootEnv } from './env.ts';
import { assertLlmAllowed } from './errors.ts';
import { fakeOllamaFetch, fakeQuery } from './fake.ts';
import { ollamaChat, ollamaConfig, ollamaReadiness } from './ollama.ts';
import type { LlmDeps } from './query.ts';
import { type AgentSessionResult, agentSession } from './session.ts';
import {
  recommendConcurrency,
  type ThroughputLevel,
  type ThroughputReport,
  ThroughputSchema,
  throughputJsonSchema,
} from './throughput.ts';
import { addTokens, zeroTokens } from './usage.ts';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

export interface ProbeArgs {
  concurrency: number[];
  repairWorkers: number[] | null;
  ollama: boolean;
  dry: boolean;
  out: string;
  sessionsPerLevel: number | null;
  authoringModel: string;
  repairModel: string;
  ollamaCalls: number;
}

function parseList(s: string | undefined, flag: string): number[] {
  const xs = (s ?? '').split(',').map((x) => Number(x.trim()));
  if (xs.length === 0 || xs.some((x) => !Number.isInteger(x) || x < 1)) {
    throw new Error(`${flag} wants a comma list of positive integers, got ${JSON.stringify(s)}`);
  }
  return xs;
}

export function parseProbeArgs(argv: string[]): ProbeArgs {
  const a: ProbeArgs = {
    concurrency: [1, 2, 4],
    repairWorkers: null,
    ollama: false,
    dry: false,
    out: '',
    sessionsPerLevel: null,
    authoringModel: 'claude-opus-5-5',
    repairModel: 'claude-haiku-5-5',
    ollamaCalls: 5,
  };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${f} needs a value`);
      return x;
    };
    if (f === '--concurrency') a.concurrency = parseList(v(), f);
    else if (f === '--repair-workers') a.repairWorkers = parseList(v(), f);
    else if (f === '--ollama') a.ollama = true;
    else if (f === '--dry') a.dry = true;
    else if (f === '--out') a.out = v();
    else if (f === '--sessions-per-level') a.sessionsPerLevel = parseList(v(), f)[0] ?? null;
    else if (f === '--authoring-model') a.authoringModel = v();
    else if (f === '--repair-model') a.repairModel = v();
    else if (f === '--ollama-calls') a.ollamaCalls = parseList(v(), f)[0] ?? 5;
    else throw new Error(`unknown flag ${f}`);
  }
  if (!a.out) throw new Error('--out <path> is required');
  return a;
}

/** Dry output must never land in the run-output tree (PLAN 7.1: paper/results is written only by run steps). */
export function assertDryOutAllowed(out: string): void {
  const abs = resolve(out);
  const results = join(REPO_ROOT, 'paper', 'results');
  const rel = relative(results, abs);
  if (!rel.startsWith('..') && !rel.startsWith('/')) {
    throw new Error(`--dry refuses to write under ${results} (run outputs only); use $TMPDIR`);
  }
}

const AUTHORING_DOC = `# Inventory API (excerpt)
GET /items/{id} -> { id, name, price (USD, decimal), updated_at (ISO-8601) }
GET /items?page=n -> { items: [...], total, next_page }
POST /orders { item_id, qty } -> { id, status }
`;

const AUTHORING_PROMPT = `Read docs/api.md in the current directory. Propose two realistic, silent behavioral changes a
vendor could ship to this API without changing its documented schema (e.g. units, pagination, timestamps).
Answer with the JSON object only.`;

const AUTHORING_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, change: { type: 'string' } },
        required: ['title', 'change'],
      },
    },
  },
  required: ['ideas'],
};

const REPAIR_FILES: Record<string, string> = {
  'src/price.ts': `// Returns the price in dollars. The vendor now sends integer cents.\nexport function toDollars(raw: number): number {\n  return raw;\n}\n`,
  'NOTES.md': 'The vendor API switched `price` to integer cents (e.g. 1999 = $19.99). Fix src/price.ts.\n',
};

const REPAIR_PROMPT =
  'Read NOTES.md, then fix src/price.ts so toDollars converts integer cents to dollars. Make the smallest edit and reply "done".';

function workdir(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'fiks-probe-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(d, p)), { recursive: true });
    writeFileSync(join(d, p), body);
  }
  return d;
}

type Kind = 'authoring' | 'repair';

async function oneSession(kind: Kind, a: ProbeArgs, deps: LlmDeps | undefined): Promise<AgentSessionResult> {
  const cwd = workdir(kind === 'authoring' ? { 'docs/api.md': AUTHORING_DOC } : REPAIR_FILES);
  try {
    return await agentSession({
      cwd,
      label: `probe-${kind}`,
      model: kind === 'authoring' ? a.authoringModel : a.repairModel,
      prompt: kind === 'authoring' ? AUTHORING_PROMPT : REPAIR_PROMPT,
      allowedTools: kind === 'authoring' ? ['Read', 'Glob'] : ['Read', 'Grep', 'Glob', 'Edit'],
      budget:
        kind === 'authoring'
          ? { maxTurns: 6, maxBudgetUsd: 0.75, timeoutMs: 10 * 60_000 }
          : { maxTurns: 10, maxBudgetUsd: 0.75, timeoutMs: 15 * 60_000 },
      ...(kind === 'authoring' ? { outputSchema: AUTHORING_SCHEMA } : {}),
      ...(deps ? { deps } : {}),
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

const quantile = (xs: number[], q: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? null;
};
const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? null) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null);

interface CapState {
  stopped: { at: string; resetAt: string | null } | null;
}

async function runLevel(
  kind: Kind,
  concurrency: number,
  sessions: number,
  a: ProbeArgs,
  deps: LlmDeps | undefined,
  cap: CapState,
): Promise<ThroughputLevel> {
  const results: AgentSessionResult[] = [];
  let next = 0;
  const t0 = Date.now();
  const worker = async () => {
    for (;;) {
      if (cap.stopped || next >= sessions) return;
      next++;
      const r = await oneSession(kind, a, deps);
      results.push(r);
      const capF = r.capEvents[0] ?? (r.failure?.kind === 'cap' ? r.failure : undefined);
      if (capF && !cap.stopped) {
        const resetAt = capF.kind === 'cap' ? (capF.resetAt ?? null) : null;
        cap.stopped = { at: new Date().toISOString(), resetAt };
        process.stderr.write(`[probe] cap event: stopping (resets ${resetAt ?? 'unknown'})\n`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const wallMs = Date.now() - t0;
  const finished = results.filter((r) => r.outcome === 'ok' || r.outcome === 'model_error').length;
  const hit = (r: AgentSessionResult) =>
    r.rateLimitEvents + r.overloadEvents > 0 ||
    r.failure?.kind === 'rate_limit' ||
    r.failure?.kind === 'overload';
  const capEvents = results.flatMap((r) =>
    r.capEvents
      .filter((f): f is Extract<LlmFailure, { kind: 'cap' }> => f.kind === 'cap')
      .map((f) => ({
        at: new Date().toISOString(),
        message: f.message,
        ...(f.resetAt ? { resetAt: f.resetAt } : {}),
        ...(f.limitType ? { limitType: f.limitType } : {}),
      })),
  );
  const spawns = results.map((r) => r.spawnMs).filter((x): x is number => x !== undefined);
  return {
    concurrency,
    sessions,
    ok: results.filter((r) => r.outcome === 'ok').length,
    modelErrors: results.filter((r) => r.outcome === 'model_error').length,
    infraErrors: results.filter((r) => r.outcome === 'infra_error').length,
    caps: results.filter((r) => r.outcome === 'cap').length,
    notRun: sessions - results.length,
    wallMs,
    attemptsPerHour: wallMs > 0 ? finished / (wallMs / 3_600_000) : 0,
    rateLimitEvents: results.reduce((s, r) => s + r.rateLimitEvents, 0),
    overloadEvents: results.reduce((s, r) => s + r.overloadEvents, 0),
    sessionsWith429OrOverload: results.filter(hit).length,
    rateLimitOverloadRate: results.length ? results.filter(hit).length / results.length : 0,
    capEvents,
    spawnOverheadMs: {
      n: spawns.length,
      meanMs: mean(spawns),
      medianMs: median(spawns),
      p90Ms: quantile(spawns, 0.9),
    },
    costUsd: results.reduce((s, r) => s + r.costUsd, 0),
    tokens: results.reduce((t, r) => addTokens(t, r.tokens), zeroTokens()),
  };
}

async function measureOllama(a: ProbeArgs, deps: LlmDeps | undefined): Promise<ThroughputReport['ollama']> {
  const cfg = ollamaConfig();
  const skipped = (reason: string, digest: string | null = null): ThroughputReport['ollama'] => ({
    status: 'skipped',
    reason,
    model: cfg.model,
    digest,
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    wallMs: 0,
    tokensPerSec: null,
  });
  if (!a.ollama && !a.dry) return skipped('--ollama not given');
  const ready = await ollamaReadiness(deps ?? {});
  if (!ready.ready) return skipped(ready.reason ?? 'not ready', ready.digest ?? null);
  const rates: number[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let wallMs = 0;
  for (let i = 0; i < a.ollamaCalls; i++) {
    const r = await ollamaChat({
      label: 'probe-ollama',
      messages: [
        { role: 'system', content: 'You are a concise API designer.' },
        {
          role: 'user',
          content: `Idea ${i + 1}: describe in about 120 words one silent behavioral change an inventory API vendor could ship without changing its schema.`,
        },
      ],
      maxTokens: 256,
      temperature: 0.7,
      ...(deps ? { deps } : {}),
    });
    rates.push(r.tokensPerSec);
    promptTokens += r.promptTokens;
    completionTokens += r.completionTokens;
    wallMs += r.wallMs;
  }
  return {
    status: 'measured',
    reason: null,
    model: ready.model ?? cfg.model,
    digest: ready.digest ?? null,
    calls: a.ollamaCalls,
    promptTokens,
    completionTokens,
    wallMs,
    tokensPerSec: {
      mean: mean(rates) ?? 0,
      median: median(rates) ?? 0,
      aggregate: wallMs > 0 ? completionTokens / (wallMs / 1000) : 0,
    },
  };
}

/** Deterministic dry dependencies: every 5th session sees one 429 retry; nothing hits a cap. */
export function dryDeps(): LlmDeps {
  const cfg = ollamaConfig();
  return {
    query: fakeQuery((i, call) => ({
      spawnMs: 5 + (i % 3) * 2,
      latencyMs: 10 + (i % 4) * 3,
      retries: i % 5 === 4 ? [{ status: 429, error: 'rate_limit' }] : [],
      text: call.options.outputFormat ? undefined : 'done',
      structured: call.options.outputFormat
        ? {
            ideas: [
              { title: 'cents', change: 'price in cents' },
              { title: 'epoch', change: 'epoch ms dates' },
            ],
          }
        : undefined,
      costUsd: 0.002,
      tokens: { in: 1200, out: 150 },
    })),
    fetch: fakeOllamaFetch({ model: cfg.model ?? 'none', digest: cfg.digest ?? 'none', latencyMs: 8 }),
    sleep: async () => {},
  };
}

function fiksCommit(): string | null {
  const r = spawnSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

export async function runProbe(a: ProbeArgs, deps?: LlmDeps): Promise<ThroughputReport> {
  if (!a.dry) assertLlmAllowed('probe');
  const d = a.dry ? (deps ?? dryDeps()) : deps;
  const cap: CapState = { stopped: null };
  const per = (c: number) => a.sessionsPerLevel ?? Math.max(4, 2 * c);
  const authoring: ThroughputLevel[] = [];
  for (const c of a.concurrency) authoring.push(await runLevel('authoring', c, per(c), a, d, cap));
  let repair: ThroughputLevel[] | null = null;
  if (a.repairWorkers) {
    repair = [];
    for (const c of a.repairWorkers)
      repair.push(await runLevel('repair', c, a.sessionsPerLevel ?? c, a, d, cap));
  }
  // ollama does not draw on the Claude cap, so it is measured even after a cap stop.
  const ollama = await measureOllama(a, d);
  const all = [...authoring, ...(repair ?? [])];
  const report: ThroughputReport = {
    schema: 'fiks-throughput/1',
    dry: a.dry,
    createdAt: new Date().toISOString(),
    fiksCommit: fiksCommit(),
    host: {
      platform: platform(),
      arch: arch(),
      cpus: cpus().length,
      memGb: Math.round((totalmem() / 2 ** 30) * 10) / 10,
      node: process.version,
    },
    models: { authoring: a.authoringModel, repair: a.repairModel },
    authoring: { levels: authoring },
    repairWorkers: repair ? { levels: repair } : null,
    ollama,
    capEventsTotal: all.reduce((s, l) => s + l.capEvents.length, 0),
    capStopped: cap.stopped,
    recommendedConcurrency: recommendConcurrency(authoring),
  };
  return ThroughputSchema.parse(report);
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] === '--print-schema') {
    console.log(JSON.stringify(throughputJsonSchema(), null, 2));
    return 0;
  }
  if (argv[0] === '--validate') {
    const file = argv[1];
    if (!file) throw new Error('--validate <file>');
    const r = ThroughputSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    console.log(r.success ? `valid: ${file}` : `INVALID: ${r.error.message}`);
    return r.success ? 0 : 1;
  }
  const a = parseProbeArgs(argv);
  if (a.dry) assertDryOutAllowed(a.out);
  else {
    loadRootEnv();
    const swarm = join(homedir(), '.fiks', 'build-swarm.active');
    if (existsSync(swarm)) {
      console.error(
        `[probe] refused: ${swarm} exists; a live probe never overlaps a builder swarm (PLAN 7.1)`,
      );
      return 2;
    }
  }
  const report = await runProbe(a);
  mkdirSync(dirname(resolve(a.out)), { recursive: true });
  writeFileSync(a.out, `${JSON.stringify(report, null, 2)}\n`);
  const lv = (l: ThroughputLevel) =>
    `c=${l.concurrency} n=${l.sessions} ok=${l.ok} att/h=${l.attemptsPerHour.toFixed(1)} 429/ovl=${(l.rateLimitOverloadRate * 100).toFixed(1)}% caps=${l.capEvents.length} spawn~${l.spawnOverheadMs.medianMs ?? '-'}ms $${l.costUsd.toFixed(3)}`;
  for (const l of report.authoring.levels) console.log(`[probe] authoring ${lv(l)}`);
  for (const l of report.repairWorkers?.levels ?? []) console.log(`[probe] repair ${lv(l)}`);
  console.log(
    `[probe] ollama ${report.ollama.status}${report.ollama.reason ? ` (${report.ollama.reason})` : ''}${report.ollama.tokensPerSec ? ` ${report.ollama.tokensPerSec.aggregate.toFixed(1)} tok/s` : ''}`,
  );
  console.log(`[probe] recommended concurrency: ${report.recommendedConcurrency ?? 'none'}; wrote ${a.out}`);
  return 0;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && realpathSync(process.argv[1]) === self) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`[probe] ${(e as Error).message}`);
      process.exit(2);
    },
  );
}
