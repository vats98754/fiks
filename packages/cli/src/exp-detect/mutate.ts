// `fiks exp-detect mutate` (paper/EXP-PLAN.md E-B, response mutations): every response operator
// (M1-M14) and benign operator (B1-B4) applied to every recorded v1 upstream response of a clean
// run, then replayed offline: the unmodified shop-mcp (seed-v1) process answers the call from the
// mutated recording (no vendor, no network), and its result is evaluated by the proxy's own
// offline replay (`replayRecord`, contracts monitor, now := the call's recorded instant).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import {
  type ContractFile,
  type HttpExchange,
  type Recording,
  SHOP_CONTRACTS,
  type ToolResultLike,
} from '@fiks/contracts';
import type { MonitorToolDef } from '@fiks/interfaces';
import {
  BENIGN_OPS,
  mutateRecordedResponse,
  RESPONSE_OPS,
  type ResponseMutation,
  type ResponseOperator,
} from '@fiks/mutate';
import {
  contractsMonitor,
  type ReplayRecord,
  readRecords,
  readTools,
  replayRecord,
  SHOP_TOOLS_PATH,
} from '@fiks/proxy';
import { createReplayHandler, type ReplayHandler, spawnServer } from '@fiks/replay-proc';
import { shopCommand } from '../harness.ts';
import { ROOT, shopAt } from '../paths.ts';
import { detectRoot, forbidLlm, gitDirty, gitHead, jsonl, latestRunWith, newRunId } from './io.ts';

/**
 * Construction coupling. An operator is construction-coupled when it maps one-to-one onto a
 * contract property kind: that kind was written to catch exactly this change (x100 vs a range,
 * truncation vs countMatchesTotal, ...), so its recall shows the checker works, not that
 * contracts generalize to unforeseen faults. The values mirror `coupledProperty` in
 * packages/mutate/catalog.json (frozen at F1); test/exp-detect pins them equal. Benign operators
 * are never coupled.
 */
export const COUPLED: Record<ResponseOperator, string | null> = {
  M1: 'range',
  M2: 'range',
  M3: null,
  M4: null,
  M5: null,
  M6: 'countMatchesTotal',
  M7: null,
  M8: 'freshness',
  M9: 'freshness',
  M10: 'enum',
  M11: null,
  M12: null,
  M13: 'freshness',
  M14: 'readAfterWrite',
  B1: null,
  B2: null,
  B3: null,
  B4: null,
};

export const ALL_OPS: readonly ResponseOperator[] = [...RESPONSE_OPS, ...BENIGN_OPS];

/** Contract kinds (invariant kinds, plus `readAfterWrite` for postconditions) in a contract file. */
export function contractKinds(file: ContractFile): Set<string> {
  const out = new Set<string>();
  for (const c of file.contracts) {
    for (const inv of c.invariants ?? []) out.add(inv.kind);
    if (c.postconditions?.length) out.add('readAfterWrite');
  }
  return out;
}

/** One recorded v1 call to mutate. */
export interface SourceCall {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  http: HttpExchange[];
  now: Date;
  toolDef?: MonitorToolDef;
  /** The verdict logged when the call was made (clean run), if any. */
  loggedVerdict?: string;
  loggedPropertyIds?: string[];
}

export interface MutatedCall {
  exchanges: HttpExchange[];
  mutations: ResponseMutation[];
  applicable: boolean;
}

/**
 * Applies `op` to every upstream response of a call (each response with its own seed when there
 * are several). Pure. Applicable when the operator changed at least one response.
 */
export function mutateCall(op: ResponseOperator, http: HttpExchange[], seed: string): MutatedCall {
  const mutations: ResponseMutation[] = [];
  const exchanges = http.map((x, i) => {
    const r = mutateRecordedResponse(op, x.response, http.length > 1 ? `${seed}:${i}` : seed, x.request);
    mutations.push(r.mutation);
    return { ...x, response: r.response };
  });
  return { exchanges, mutations, applicable: mutations.some((m) => m.applicable) };
}

export interface MutateRow {
  /** `control` rows replay the unmutated recording (must reproduce the logged verdict). */
  op: ResponseOperator | 'control';
  family: 'response' | 'benign' | 'control';
  coupled: string | null;
  /** The coupled kind occurs in the shop contracts (null when not coupled). */
  coupledInContracts: boolean | null;
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  seed: string | null;
  applicable: boolean;
  site: string | null;
  changed: number;
  note: string;
  /** Replay outcome (null when the operator was not applicable: nothing was replayed). */
  verdict: string | null;
  flagged: boolean | null;
  propertyIds: string[];
  /** The tool answered with isError (the agent sees an error, not silent wrong data). */
  toolError: boolean | null;
  /** Requests shop-mcp made that the (mutated) recording did not hold. */
  unmatched: number;
  /** Control rows only: replayed verdict and property ids equal the logged ones. */
  matchesLogged?: boolean | null;
}

/** A local upstream whose request handler is swapped per replay; shop-mcp keeps one base URL. */
async function switchableUpstream() {
  let current: ReplayHandler | undefined;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (current) return current(req, res);
    res.writeHead(599, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'NO_REPLAY_ACTIVE' }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    use(h: ReplayHandler | undefined) {
      current = h;
    },
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

export interface Replayer {
  replay(
    call: SourceCall,
    exchanges: HttpExchange[],
  ): Promise<{ verdict: string; propertyIds: string[]; toolError: boolean; unmatched: number }>;
  close(): Promise<void>;
}

/** One shop-mcp process (stdio) over a switchable replay upstream; contracts via proxy replay. */
export async function startReplayer(opts: {
  shopDir: string;
  contracts?: ContractFile;
  tools?: Map<string, MonitorToolDef>;
}): Promise<Replayer> {
  const contracts = opts.contracts ?? SHOP_CONTRACTS;
  const tools = opts.tools ?? readTools(SHOP_TOOLS_PATH);
  const upstream = await switchableUpstream();
  const server = await spawnServer(
    shopCommand(opts.shopDir),
    { VENDOR_BASE_URL: upstream.url },
    { timeoutMs: 20_000 },
  ).catch(async (e) => {
    await upstream.close();
    throw e;
  });
  const monitor = contractsMonitor();
  return {
    async replay(call, exchanges) {
      const h = createReplayHandler(exchanges);
      upstream.use(h.handle);
      let result: ToolResultLike;
      try {
        result = (await server.callTool(call.tool, call.args)) as ToolResultLike;
      } finally {
        upstream.use(undefined);
      }
      const record: ReplayRecord = {
        callId: call.callId,
        domain: 'shop',
        drift: null,
        stratum: 'E-B',
        tool: call.tool,
        args: call.args,
        result,
        http: [...h.served],
        now: call.now,
        upstreamObserved: true,
        ...(call.toolDef ? { toolDef: call.toolDef } : {}),
        entityClass: {},
        originUnit: {},
      };
      const r = await replayRecord(record, { monitor, contracts, tools });
      return {
        verdict: r.receipt.verdict,
        propertyIds: [...new Set(r.receipt.violations.map((v) => v.propertyId))].sort(),
        toolError: result.isError === true,
        unmatched: h.unmatched.length,
      };
    },
    async close() {
      await server.close();
      await upstream.close();
    },
  };
}

/** The calls of a clean run (`calls.jsonl`, proxy event format). */
export function callsFromRun(dir: string): SourceCall[] {
  const { records } = readRecords([join(dir, 'calls.jsonl')], { domain: 'shop', stratum: 'E-B' });
  return records.map((r: ReplayRecord) => ({
    callId: r.callId,
    tool: r.tool,
    args: r.args,
    http: r.http,
    now: r.now,
    ...(r.toolDef ? { toolDef: r.toolDef } : {}),
    ...(r.loggedReceipt
      ? {
          loggedVerdict: r.loggedReceipt.verdict,
          loggedPropertyIds: [...new Set(r.loggedReceipt.violations.map((v) => v.propertyId))].sort(),
        }
      : {}),
  }));
}

/**
 * The committed v1 recordings of shop-mcp (`test/fixtures/v1/*.json`). Only calls with no
 * read-after-write postcondition are used: a mutated write would need a vendor that answers the
 * probe for the mutated identity, which a recording cannot.
 */
export function callsFromFixtures(
  shopDir: string,
  contracts: ContractFile = SHOP_CONTRACTS,
): { calls: SourceCall[]; skipped: string[] } {
  const dir = join(shopDir, 'test/fixtures/v1');
  const withPost = new Set(contracts.contracts.filter((c) => c.postconditions?.length).map((c) => c.tool));
  const calls: SourceCall[] = [];
  const skipped: string[] = [];
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    const rec = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Recording;
    if (withPost.has(rec.tool) || rec.probe) {
      skipped.push(rec.id);
      continue;
    }
    calls.push({
      callId: rec.id,
      tool: rec.tool,
      args: rec.args,
      http: rec.http,
      now: new Date(rec.capturedAt),
    });
  }
  return { calls, skipped };
}

export interface MutateOptions {
  /** Clean run to mutate (default: the newest run with calls.jsonl). Ignored with `fromFixtures`. */
  runId?: string;
  /** Use shop-mcp's committed v1 recordings instead of a clean run (written to a new run id). */
  fromFixtures?: boolean;
  /** Seeds per (operator, call) (default 1). */
  seeds?: number;
  outRoot?: string;
  shopDir?: string;
  ops?: readonly ResponseOperator[];
  log?: (line: string) => void;
}

export interface MutateResult {
  runId: string;
  dir: string;
  rows: MutateRow[];
}

export async function runMutate(opts: MutateOptions = {}): Promise<MutateResult> {
  forbidLlm();
  const log = opts.log ?? (() => {});
  const root = opts.outRoot ?? detectRoot();
  const shopDir = opts.shopDir ?? shopAt('seed-v1');
  const seeds = opts.seeds ?? 1;
  if (!Number.isInteger(seeds) || seeds < 1)
    throw new Error(`--seeds must be a positive integer, got ${seeds}`);
  const ops = opts.ops ?? ALL_OPS;
  let runId: string;
  let calls: SourceCall[];
  let skipped: string[] = [];
  let source: string;
  if (opts.fromFixtures) {
    runId = opts.runId ?? `${newRunId()}-fixtures`;
    ({ calls, skipped } = callsFromFixtures(shopDir));
    source = `shop-mcp ${join(shopDir, 'test/fixtures/v1')}`;
  } else {
    const found = opts.runId ?? latestRunWith(root, 'calls.jsonl');
    if (!found) throw new Error(`no clean run under ${root}: run \`fiks exp-detect clean\` first`);
    runId = found;
    calls = callsFromRun(join(root, runId));
    source = `clean run ${runId}`;
  }
  const dir = join(root, runId);
  const kinds = contractKinds(SHOP_CONTRACTS);
  const startedAt = new Date().toISOString();
  const rows: MutateRow[] = [];
  const replayer = await startReplayer({ shopDir });
  try {
    for (const call of calls) {
      const base = { callId: call.callId, tool: call.tool, args: call.args };
      // Control: the unmutated recording must reproduce the logged verdict.
      const c = await replayer.replay(call, call.http);
      rows.push({
        ...base,
        op: 'control',
        family: 'control',
        coupled: null,
        coupledInContracts: null,
        seed: null,
        applicable: true,
        site: null,
        changed: 0,
        note: 'unmutated recording',
        verdict: c.verdict,
        flagged: c.verdict === 'violated',
        propertyIds: c.propertyIds,
        toolError: c.toolError,
        unmatched: c.unmatched,
        matchesLogged:
          call.loggedVerdict === undefined
            ? null
            : call.loggedVerdict === c.verdict &&
              JSON.stringify(call.loggedPropertyIds ?? []) === JSON.stringify(c.propertyIds),
      });
      for (const op of ops) {
        for (let s = 0; s < seeds; s++) {
          const seed = `${call.callId}#${s}`;
          const m = mutateCall(op, call.http, seed);
          const first = m.mutations.find((x) => x.applicable) ?? m.mutations[0];
          const row: MutateRow = {
            ...base,
            op,
            family: op.startsWith('B') ? 'benign' : 'response',
            coupled: COUPLED[op],
            coupledInContracts: COUPLED[op] ? kinds.has(COUPLED[op] as string) : null,
            seed,
            applicable: m.applicable,
            site: m.applicable ? (first?.site ?? null) : null,
            changed: m.mutations.reduce((n, x) => n + x.changed, 0),
            note: m.mutations.map((x) => x.note).join('; '),
            verdict: null,
            flagged: null,
            propertyIds: [],
            toolError: null,
            unmatched: 0,
          };
          if (m.applicable) {
            const r = await replayer.replay(call, m.exchanges);
            Object.assign(row, {
              verdict: r.verdict,
              flagged: r.verdict === 'violated',
              propertyIds: r.propertyIds,
              toolError: r.toolError,
              unmatched: r.unmatched,
            });
          }
          rows.push(row);
        }
      }
    }
  } finally {
    await replayer.close();
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mutate.jsonl'), jsonl(rows));
  const controls = rows.filter((r) => r.family === 'control');
  const perOp = Object.fromEntries(
    ops.map((op) => {
      const mine = rows.filter((r) => r.op === op);
      const app = mine.filter((r) => r.applicable);
      return [
        op,
        {
          rows: mine.length,
          applicable: app.length,
          flagged: app.filter((r) => r.flagged).length,
          toolError: app.filter((r) => r.toolError).length,
          coupled: COUPLED[op],
          coupledKindInContracts: COUPLED[op] ? kinds.has(COUPLED[op] as string) : null,
        },
      ];
    }),
  );
  const meta = {
    experiment: 'E-B response mutations (paper/EXP-PLAN.md)',
    runId,
    source,
    startedAt,
    finishedAt: new Date().toISOString(),
    replay: 'offline: shop-mcp seed-v1 process over a recorded-response upstream; contracts via proxy replay',
    shopRef: 'seed-v1',
    shopMcpSha: gitHead(shopDir),
    fiksSha: gitHead(ROOT),
    fiksDirty: gitDirty(ROOT),
    llm: 'none (FIKS_LLM_FORBID=1)',
    seeds,
    calls: calls.length,
    skippedRecordings: skipped,
    controls: {
      rows: controls.length,
      matchesLogged: controls.filter((r) => r.matchesLogged === true).length,
      mismatches: controls.filter((r) => r.matchesLogged === false).map((r) => r.callId),
      unlogged: controls.filter((r) => r.matchesLogged === null).length,
    },
    unmatchedRequests: rows.reduce((n, r) => n + r.unmatched, 0),
    perOp,
  };
  writeFileSync(join(dir, 'meta.mutate.json'), `${JSON.stringify(meta, null, 2)}\n`);
  log(
    `exp-detect mutate ${runId}: ${calls.length} calls x ${ops.length} operators x ${seeds} seed(s) -> ${dir}`,
  );
  for (const [op, s] of Object.entries(perOp)) {
    log(
      `  ${op.padEnd(4)} applicable ${String(s.applicable).padStart(3)}  flagged ${String(s.flagged).padStart(3)}  toolError ${String(s.toolError).padStart(3)}${s.coupled ? `  coupled:${s.coupled}` : ''}`,
    );
  }
  log(
    `  controls: ${meta.controls.matchesLogged}/${controls.length - meta.controls.unlogged} reproduce the logged verdict (${meta.controls.unlogged} had none logged)${meta.controls.mismatches.length ? ` MISMATCH: ${meta.controls.mismatches.join(', ')}` : ''}; unmatched upstream requests: ${meta.unmatchedRequests}`,
  );
  return { runId, dir, rows };
}
