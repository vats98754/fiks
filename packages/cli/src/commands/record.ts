// `fiks record` (DET; PLAN 3.0, 3.1, 5.4, 5.7, 7 P20): turns an enumeration into CallRecords.
//
//   fiks record --domain <d> --frame --in <enum.jsonl> --out <dir> [--monitor none|contracts]
//   fiks record [--domain <d>] --drift <DriftPackage.json> --in <enum.jsonl> --out <dir>
//   fiks record [--domain <d>] --benign <package.json> --in <enum.jsonl> --out <dir>
//   fiks record [--domain <d>] --mutant <M1..M14|B1..B4> --in <records dir|calls.jsonl> --out <dir>
//   common: [--monitor contracts|none|<module>] [--contracts <file>] [--catalog original|extended-only|all]
//           [--server-ref <ref>] [--server-dir <dir>] [--direct] [--limit n] [--json]
//
// Chain per pass: in-process vendor (v1, the Domain's frozenClock) -> [injector rule] -> HTTP tap
// -> tool server (stdio, at --server-ref) -> fiks-proxy in log-only mode (the agent-facing result
// is the upstream result, untouched) -> MCP client. Every CallRecord's capturedAt is the frozen
// clock, which is also the proxy's evaluation `now`. Under `--monitor none` the contracts file is
// never opened and no read-back probe runs. `--direct` drops the proxy (outputs only).
//
// --drift/--benign: a second pass replays every row on a fresh v1 vendor with the same base and
// clock and no rule (controls.jsonl, controlOf = the drift call). --mutant: every distinct
// recorded upstream response of the input records is mutated by the operator (@fiks/mutate,
// seeded) and the server is re-run against a replay of the mutated exchanges; the control is the
// same server run on the unmutated exchanges. Drift-attributable violations decide detection;
// the others go to nonattributable.jsonl.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ContractFile, HttpExchange, ToolResultLike } from '@fiks/contracts';
import { getDomain } from '@fiks/domains';
import {
  attributeCall,
  CALLS_FILE,
  type CallAttribution,
  CONTROLS_FILE,
  callEvent,
  canonicalJson,
  DETECTION_FILE,
  type DetCallRecord,
  type ExtendedEntity,
  MANIFEST_FILE,
  type MutationNote,
  NONATTRIBUTABLE_FILE,
  type RecordManifest,
  type RunKind,
  readJsonl,
  sha256File,
  sha256Hex,
  summarize,
  type TruthComparison,
  writeJson,
  writeJsonl,
} from '@fiks/frame';
import { type LoadedRule, loadDriftPackage, startInjector } from '@fiks/injector';
import type { Catalog, CliCommandModule, Domain, DomainVendor, EnumRow, Monitor } from '@fiks/interfaces';
import { isResponseOperator, mutateRecordedResponse, type ResponseOperator } from '@fiks/mutate';
import { loadMonitor, NO_MONITOR, type RecordedCall, startProxy, startTap, type Tap } from '@fiks/proxy';
import { semanticDiff } from '@fiks/vendor-api';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { type CallToolResult, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { repoAt } from '../paths.ts';

/** Server ref of the frame (PLAN 3.1 "Server refs"). */
export const FRAME_SERVER_REF: Record<string, string> = { shop: 'base-shop', tracker: 'seed-tracker-v1' };

/** Env var that points each domain's vendor at its extended catalog (vendor-api, vendor-tracker). */
const EXTENDED_ENV: Record<string, string> = {
  shop: 'VENDOR_EXTENDED_CATALOG',
  tracker: 'TRACKER_EXTENDED_CATALOG',
};

const EMPTY_CONTRACTS = (server: string): ContractFile => ({ server, version: 1, contracts: [] });

type Pair = Pick<HttpExchange, 'request' | 'response'>;
const pairs = (xs: readonly HttpExchange[]): Pair[] =>
  xs.map((x) => ({ request: x.request, response: x.response }));

// --- the upstream chain -------------------------------------------------------------------

interface ChainOptions {
  domain: Domain;
  serverDir: string;
  clock: Date;
  /** null = no proxy (`--direct`). */
  monitor: Monitor | typeof NO_MONITOR | null;
  contracts: ContractFile | null;
  /** In-process vendor (frame, drift, controls), or a replay base URL (mutants). */
  upstream: { vendor: DomainVendor } | { url: string };
  rule?: LoadedRule;
}

interface Chain {
  vendor?: DomainVendor;
  call(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ result: CallToolResult; rec?: RecordedCall; http: HttpExchange[] }>;
  close(): Promise<void>;
}

async function startChain(o: ChainOptions): Promise<Chain> {
  const closers: (() => Promise<unknown>)[] = [];
  const close = async () => {
    for (const c of closers.reverse()) await c().catch(() => undefined);
  };
  try {
    let url: string;
    if ('vendor' in o.upstream) {
      const v = o.upstream.vendor;
      url = await v.listen();
      closers.push(() => v.close());
    } else url = o.upstream.url;
    if (o.rule) {
      const inj = await startInjector({ target: url, rule: o.rule, clock: o.clock });
      closers.push(() => inj.close());
      url = inj.url;
    }
    const tap: Tap = await startTap(url);
    closers.push(() => tap.close());
    const cmd = o.domain.serverCommand(o.serverDir);
    const env = { ...getDefaultEnvironment(), [o.domain.baseUrlEnv]: tap.url };
    const client = new Client({ name: 'fiks-record', version: '0.1.0' });
    let last: RecordedCall | undefined;
    if (o.monitor === null) {
      await client.connect(new StdioClientTransport({ ...cmd, env, stderr: 'pipe' }));
      closers.push(() => client.close());
    } else {
      const proxy = await startProxy({
        upstream: { transport: 'stdio', ...cmd, env },
        ...(o.monitor === NO_MONITOR ? {} : { contracts: o.contracts ?? EMPTY_CONTRACTS(o.domain.id) }),
        monitor: o.monitor,
        logOnly: true,
        tap,
        now: () => o.clock,
        onRecord: (rec) => {
          last = rec;
        },
      });
      closers.push(() => proxy.close());
      const [a, b] = InMemoryTransport.createLinkedPair();
      await proxy.connect(a);
      await client.connect(b);
      closers.push(() => client.close());
    }
    return {
      ...('vendor' in o.upstream ? { vendor: o.upstream.vendor } : {}),
      async call(tool, args) {
        last = undefined;
        tap.take();
        // Raw request: the SDK client would validate the result against the outputSchema.
        const result = (await client.request(
          { method: 'tools/call', params: { name: tool, arguments: args } },
          CallToolResultSchema,
        )) as CallToolResult;
        const rec = last as RecordedCall | undefined;
        return { result, ...(rec ? { rec } : {}), http: rec ? rec.http : tap.take() };
      },
      close,
    };
  } catch (e) {
    await close();
    throw e;
  }
}

// --- one CallRecord -------------------------------------------------------------------------

/** `$prev.<path>` in an argument: that path of the previous call's structured output. */
export function resolveArgs(
  args: Record<string, unknown>,
  prev: ToolResultLike | undefined,
): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string' && v.startsWith('$prev.')) {
      let cur: unknown = prev?.structuredContent;
      for (const k of v.slice('$prev.'.length).split('.'))
        cur = cur !== null && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined;
      return cur ?? null;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(args) as Record<string, unknown>;
}

/** The proxy's record as deterministic events: no wall-clock timing, exchanges as pairs. */
function eventsOf(rec: RecordedCall | undefined, at: string, direct: boolean): Record<string, unknown>[] {
  if (!rec) return [{ type: 'call', monitor: direct ? 'direct' : 'none', at, upstreamObserved: true }];
  const probe = rec.probe
    ? { tool: rec.probe.tool, args: rec.probe.args, result: rec.probe.result, http: pairs(rec.probe.http) }
    : undefined;
  const call: Record<string, unknown> = {
    type: 'call',
    monitor: rec.monitor,
    at: rec.at,
    upstreamObserved: rec.upstreamObserved,
    ...(rec.logOnly ? { logOnly: true } : {}),
    ...(rec.toolDef ? { toolDef: rec.toolDef } : {}),
    ...(rec.receipt ? { receipt: rec.receipt } : {}),
    ...(probe ? { probe } : {}),
    ...(rec.monitorError ? { monitorError: rec.monitorError } : {}),
  };
  return probe ? [call, { type: 'probe', ...probe }] : [call];
}

function truthOf(
  domain: Domain,
  call: { tool: string; args: Record<string, unknown>; output: unknown },
  state: unknown,
): TruthComparison {
  const t = domain.truth(call, state);
  const mismatches = t.mismatches ?? [];
  return { inputValid: t.inputValid, agrees: mismatches.length === 0, mismatches };
}

function labels(domain: Domain, call: { tool: string; args: Record<string, unknown>; output: unknown }) {
  const safe = (f: () => Record<string, string>) => {
    try {
      return f();
    } catch {
      return {};
    }
  };
  return {
    entityClass: safe(() => domain.entityClass(call)),
    originUnit: safe(() => domain.originEntity(call)),
  };
}

const errorResult = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: message }],
});

interface RecordPassOptions {
  domain: Domain;
  rows: EnumRow[];
  chain: Chain;
  clock: Date;
  callId: (row: EnumRow, i: number) => string;
  stratum: (row: EnumRow) => string;
  catalog: Catalog;
  drift: string | null;
  mutant: string | null;
  controlOf: (row: EnumRow, i: number) => string | null;
  direct: boolean;
}

async function recordPass(o: RecordPassOptions): Promise<DetCallRecord[]> {
  const out: DetCallRecord[] = [];
  let prev: ToolResultLike | undefined;
  for (const [i, row] of o.rows.entries()) {
    const args = resolveArgs(row.args, prev);
    let result: CallToolResult;
    let rec: RecordedCall | undefined;
    let http: HttpExchange[] = [];
    try {
      ({ result, rec, http } = await o.chain.call(row.tool, args));
    } catch (e) {
      result = errorResult(`record: the call failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    prev = result as ToolResultLike;
    const call = { tool: row.tool, args, output: result };
    const at = o.clock.toISOString();
    out.push({
      callId: o.callId(row, i),
      inputId: row.dedupeKey,
      seq: i,
      domain: o.domain.id,
      stratum: o.stratum(row),
      catalog: o.catalog,
      drift: o.drift,
      mutant: o.mutant,
      tool: row.tool,
      args,
      upstream: pairs(http),
      output: result as ToolResultLike,
      events: eventsOf(rec, at, o.direct),
      ...labels(o.domain, call),
      capturedAt: rec?.at ?? at,
      controlOf: o.controlOf(row, i),
      // Replay upstreams (mutants) have no vendor state: the caller sets truth from the control.
      truth: o.chain.vendor
        ? truthOf(o.domain, call, o.chain.vendor.state)
        : { inputValid: true, agrees: true, mismatches: [] },
    });
  }
  return out;
}

// --- mutant replay upstream -------------------------------------------------------------------

/** Answers each request from the current call's exchanges, in order, once each; else 599. */
async function startReplayUpstream(): Promise<{
  url: string;
  load(xs: Pair[]): void;
  unmatched(): string[];
  close(): Promise<void>;
}> {
  let pending: Pair[] = [];
  let misses: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const key = `${req.method} ${req.url}`;
      const i = pending.findIndex((p) => `${p.request.method} ${p.request.url}` === key);
      if (i === -1) {
        misses.push(key);
        res.writeHead(599, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'UNMATCHED_REQUEST', request: key }));
        return;
      }
      const [p] = pending.splice(i, 1) as [Pair];
      const headers = { ...p.response.headers };
      delete headers['content-length'];
      res.writeHead(p.response.status, headers);
      res.end(p.response.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    load(xs) {
      pending = [...xs];
      misses = [];
    },
    unmatched: () => [...misses],
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

/** The input record's exchanges in request order: the call's, then its read-back probe's. */
function exchangesOf(rec: DetCallRecord): Pair[] {
  const probe = callEvent(rec)?.probe as { http?: Pair[] } | undefined;
  return [...rec.upstream, ...(probe?.http ?? [])];
}

function diffOutputs(control: ToolResultLike, mutant: ToolResultLike): string[] {
  if (Boolean(control.isError) !== Boolean(mutant.isError)) return [''];
  if (control.isError) return canonicalJson(control.content) === canonicalJson(mutant.content) ? [] : [''];
  return semanticDiff(control.structuredContent ?? null, mutant.structuredContent ?? null);
}

// --- the command --------------------------------------------------------------------------

export interface RecordOptions {
  kind: RunKind;
  domain?: string;
  /** --drift/--benign package, or the --mutant operator. */
  source?: string;
  in: string;
  out: string;
  monitor?: string;
  contracts?: string;
  catalog?: Catalog;
  serverRef?: string;
  serverDir?: string;
  direct?: boolean;
  limit?: number;
}

export interface RecordOutput {
  out: string;
  manifest: RecordManifest;
  detection?: ReturnType<typeof summarize>;
}

function gitHead(dir: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function extendedOf(domain: Domain, catalog: Catalog): RecordManifest['extended'] {
  if (catalog === 'original') return null;
  const env = EXTENDED_ENV[domain.id];
  const file = (env && process.env[env]) || (domain.promptHints.extendedCatalog as string | undefined);
  if (!file || !existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const list = (Array.isArray(raw) ? raw : ((raw as { entities?: unknown[] }).entities ?? [])) as Record<
    string,
    unknown
  >[];
  const entities: ExtendedEntity[] = list.map((e) => ({
    id: String(e.id ?? e.key),
    authorBatch: String(e.authorBatch ?? ''),
  }));
  return { path: resolve(file), sha256: sha256File(file), entities };
}

function readInputRecords(path: string): DetCallRecord[] {
  const file = existsSync(join(path, CALLS_FILE)) ? join(path, CALLS_FILE) : path;
  return readJsonl<DetCallRecord>(file).sort((a, b) => a.seq - b.seq);
}

export async function runRecord(o: RecordOptions): Promise<RecordOutput> {
  const outDir = resolve(o.out);
  const kind = o.kind;
  let pkgInfo: { loaded: ReturnType<typeof loadDriftPackage>; file: string } | undefined;
  if (kind === 'drift' || kind === 'benign') {
    if (!o.source) throw new Error(`--${kind} needs a package file`);
    const file = resolve(o.source);
    pkgInfo = { loaded: loadDriftPackage(file), file };
    if (o.domain && o.domain !== pkgInfo.loaded.pkg.domain) {
      throw new Error(`--domain ${o.domain} but the package is for ${pkgInfo.loaded.pkg.domain}`);
    }
  }
  let inputRecords: DetCallRecord[] | undefined;
  let inputManifest: RecordManifest | undefined;
  if (kind === 'mutant') {
    if (!o.source || !isResponseOperator(o.source))
      throw new Error(`--mutant needs an operator (M1..M14, B1..B4)`);
    inputRecords = readInputRecords(resolve(o.in));
    const mf = join(resolve(o.in), MANIFEST_FILE);
    if (existsSync(mf)) inputManifest = JSON.parse(readFileSync(mf, 'utf8')) as RecordManifest;
  }
  const domainId =
    pkgInfo?.loaded.pkg.domain ?? o.domain ?? inputRecords?.[0]?.domain ?? inputManifest?.domain;
  if (!domainId) throw new Error('--domain is required');
  const domain = getDomain(domainId);
  const clock = new Date(domain.frozenClock);
  const catalog: Catalog =
    o.catalog ??
    (kind === 'frame' ? 'extended-only' : kind === 'mutant' ? (inputManifest?.catalog ?? 'original') : 'all');
  const serverRef =
    o.serverRef ??
    (pkgInfo
      ? pkgInfo.loaded.pkg.base
      : kind === 'mutant'
        ? (inputManifest?.server.ref ?? FRAME_SERVER_REF[domainId] ?? domain.seedTag)
        : (FRAME_SERVER_REF[domainId] ?? domain.seedTag));
  const serverDir = o.serverDir ? resolve(o.serverDir) : repoAt(serverRef, domainId);

  // Under --monitor none the contracts are never opened (PLAN 3.1 "Outputs before F4b").
  const monitorSpec = o.direct ? 'direct' : (o.monitor ?? 'contracts');
  const monitor = o.direct ? null : await loadMonitor(monitorSpec);
  let contracts: ContractFile | null = null;
  let contractsInfo: RecordManifest['contracts'] = null;
  if (monitor !== null && monitor !== NO_MONITOR) {
    const file = resolve(o.contracts ?? domain.contractsPath);
    if (existsSync(file)) {
      const text = readFileSync(file, 'utf8');
      contracts = JSON.parse(text) as ContractFile;
      contractsInfo = { path: file, sha256: sha256Hex(text) };
    } else {
      console.error(`record: no contracts at ${file}; every verdict is unverifiable`);
      contracts = EMPTY_CONTRACTS(domainId);
    }
  }

  let rows: EnumRow[] = [];
  let enumInfo: RecordManifest['enumeration'] = null;
  if (kind !== 'mutant') {
    const file = resolve(o.in);
    rows = readJsonl<EnumRow>(file);
    enumInfo = { path: file, sha256: sha256File(file), rows: rows.length };
    for (const r of rows) {
      if (r.domain !== domainId)
        throw new Error(`${file}: row ${r.dedupeKey} is for domain ${r.domain}, not ${domainId}`);
    }
  }
  if (o.limit !== undefined) {
    rows = rows.slice(0, o.limit);
    inputRecords = inputRecords?.slice(0, o.limit);
  }

  const files: Record<string, string> = {};
  const counts: Record<string, number> = {};
  const driftId = pkgInfo?.loaded.pkg.id ?? null;
  let calls: DetCallRecord[];
  let controls: DetCallRecord[] = [];

  if (kind === 'mutant') {
    const op = o.source as ResponseOperator;
    const input = inputRecords ?? [];
    const replay = await startReplayUpstream();
    const chain = await startChain({
      domain,
      serverDir,
      clock,
      monitor,
      contracts,
      upstream: { url: replay.url },
    });
    calls = [];
    let skipped = 0;
    try {
      for (const r of input) {
        const original = exchangesOf(r);
        const notes: MutationNote[] = [];
        const mutated = original.map((x, i) => {
          const m = mutateRecordedResponse(op, x.response, `${op}:${r.callId}:${i}`, {
            method: x.request.method,
          });
          notes.push({
            exchange: i,
            applicable: m.mutation.applicable,
            site: m.mutation.site,
            note: m.mutation.note,
          });
          return { request: x.request, response: m.response };
        });
        if (!notes.some((n) => n.applicable)) {
          skipped++;
          continue;
        }
        const mutantId = `${op}:${r.callId}`;
        const at = new Date(r.capturedAt);
        const run = async (xs: Pair[]) => {
          replay.load(xs);
          const one: EnumRow = {
            domain: r.domain,
            stratum: r.stratum,
            tool: r.tool,
            args: r.args,
            dedupeKey: r.inputId,
          };
          const [rec] = await recordPass({
            domain,
            rows: [one],
            chain,
            clock: at,
            callId: () => '',
            stratum: () => 'mutant',
            catalog,
            drift: null,
            mutant: null,
            controlOf: () => null,
            direct: monitor === null,
          });
          return rec as DetCallRecord;
        };
        const control = await run(original);
        const mutant = await run(mutated);
        const diff = diffOutputs(control.output, mutant.output);
        const truth: TruthComparison = r.truth.agrees
          ? { inputValid: r.truth.inputValid, agrees: diff.length === 0, mismatches: diff }
          : { ...r.truth, agrees: false, mismatches: [...new Set([...r.truth.mismatches, ...diff])] };
        controls.push({
          ...control,
          callId: r.callId,
          seq: r.seq,
          stratum: r.stratum,
          controlOf: mutantId,
          truth: r.truth,
        });
        calls.push({
          ...mutant,
          callId: mutantId,
          seq: r.seq,
          mutant: op,
          controlOf: null,
          truth,
          mutation: notes,
        });
      }
    } finally {
      await chain.close();
      await replay.close();
    }
    counts.skippedNotApplicable = skipped;
  } else {
    const vendorFor = () => domain.createVendor(catalog, { version: 'v1', now: () => clock });
    const runPass = async (rule: LoadedRule | undefined, pass: 'calls' | 'controls') => {
      const chain = await startChain({
        domain,
        serverDir,
        clock,
        monitor,
        contracts,
        upstream: { vendor: vendorFor() },
        ...(rule ? { rule } : {}),
      });
      try {
        return await recordPass({
          domain,
          rows,
          chain,
          clock,
          callId: (row) => (pass === 'calls' ? row.dedupeKey : `${row.dedupeKey}~v1`),
          stratum: (row) =>
            kind === 'frame'
              ? row.stratum
              : kind === 'benign'
                ? 'benign'
                : (pkgInfo?.loaded.pkg.stratum ?? row.stratum),
          catalog,
          drift: pass === 'calls' ? driftId : null,
          mutant: null,
          controlOf: (row) => (pass === 'controls' ? row.dedupeKey : null),
          direct: monitor === null,
        });
      } finally {
        await chain.close();
      }
    };
    calls = await runPass(pkgInfo?.loaded.rule, 'calls');
    if (kind !== 'frame') controls = await runPass(undefined, 'controls');
  }

  files.calls = writeJsonl(join(outDir, CALLS_FILE), calls);
  counts.calls = calls.length;
  let detection: RecordOutput['detection'];
  if (kind !== 'frame') {
    files.controls = writeJsonl(join(outDir, CONTROLS_FILE), controls);
    counts.controls = controls.length;
    const controlFor = new Map(controls.map((c) => [c.controlOf as string, c]));
    const attributions: CallAttribution[] = calls.map((c) =>
      attributeCall(
        c,
        controlFor.get(c.callId),
        contracts?.contracts.find((x) => x.tool === c.tool),
      ),
    );
    const rowsNa = attributions.flatMap((a) => a.nonattributable);
    files.nonattributable = writeJsonl(join(outDir, NONATTRIBUTABLE_FILE), rowsNa);
    counts.nonattributable = rowsNa.length;
    detection = summarize(
      driftId ?? (kind === 'mutant' ? (o.source as string) : null),
      kind,
      calls,
      controls.length,
      attributions,
    );
    files.detection = writeJson(join(outDir, DETECTION_FILE), { ...detection, attributions });
  }
  const manifest: RecordManifest = {
    kind,
    domain: domainId,
    catalog,
    monitor: monitorSpec,
    contracts: contractsInfo,
    server: {
      ref: o.serverDir ? (o.serverRef ?? null) : serverRef,
      dir: serverDir,
      commit: gitHead(serverDir),
    },
    frozenClock: domain.frozenClock,
    enumeration: enumInfo,
    drift: pkgInfo
      ? {
          id: pkgInfo.loaded.pkg.id,
          package: pkgInfo.file,
          ruleId: pkgInfo.loaded.rule.id,
          ruleHash: pkgInfo.loaded.rule.hash,
          base: pkgInfo.loaded.pkg.base,
        }
      : null,
    mutant: kind === 'mutant' ? { op: o.source as string, input: resolve(o.in) } : null,
    extended: extendedOf(domain, catalog),
    files,
    counts,
  };
  writeJson(join(outDir, MANIFEST_FILE), manifest);
  return { out: outDir, manifest, ...(detection ? { detection } : {}) };
}

const USAGE =
  'record [--domain <d>] (--frame | --drift <pkg> | --benign <pkg> | --mutant <op>) --in <enum.jsonl|records> --out <dir> [--monitor contracts|none|<module>] [--contracts <file>] [--catalog original|extended-only|all] [--server-ref <ref>] [--server-dir <dir>] [--direct] [--limit n] [--json]';

const command: CliCommandModule = {
  name: 'record',
  describe: 'Record CallRecords for frame, drift, benign or mutant traffic (DET, PLAN 7 P20)',
  async run(argv) {
    let values: Record<string, string | boolean | undefined>;
    try {
      ({ values } = parseArgs({
        args: argv,
        options: {
          domain: { type: 'string' },
          frame: { type: 'boolean', default: false },
          drift: { type: 'string' },
          benign: { type: 'string' },
          mutant: { type: 'string' },
          in: { type: 'string' },
          out: { type: 'string' },
          monitor: { type: 'string' },
          contracts: { type: 'string' },
          catalog: { type: 'string' },
          'server-ref': { type: 'string' },
          'server-dir': { type: 'string' },
          direct: { type: 'boolean', default: false },
          limit: { type: 'string' },
          json: { type: 'boolean', default: false },
        },
      }));
    } catch (e) {
      console.error(`${(e as Error).message}\nusage: fiks ${USAGE}`);
      return 2;
    }
    const kinds = (['frame', 'drift', 'benign', 'mutant'] as const).filter((k) =>
      k === 'frame' ? values.frame === true : values[k] !== undefined,
    );
    if (kinds.length !== 1 || !values.in || !values.out) {
      console.error(`usage: fiks ${USAGE}`);
      return 2;
    }
    const kind = kinds[0] as RunKind;
    try {
      const r = await runRecord({
        kind,
        domain: values.domain as string | undefined,
        source: kind === 'frame' ? undefined : (values[kind] as string),
        in: values.in as string,
        out: values.out as string,
        monitor: values.monitor as string | undefined,
        contracts: values.contracts as string | undefined,
        catalog: values.catalog as Catalog | undefined,
        serverRef: values['server-ref'] as string | undefined,
        serverDir: values['server-dir'] as string | undefined,
        direct: values.direct === true,
        limit: values.limit ? Number(values.limit) : undefined,
      });
      if (values.json)
        console.log(JSON.stringify({ out: r.out, manifest: r.manifest, detection: r.detection }));
      else {
        const d = r.detection;
        console.log(
          [
            `recorded ${r.manifest.counts.calls} calls${r.manifest.counts.controls !== undefined ? ` + ${r.manifest.counts.controls} v1 controls` : ''} to ${r.out}`,
            `calls.jsonl sha256 ${r.manifest.files.calls}`,
            ...(d
              ? [
                  `detected: ${d.detected}${d.first ? ` (first attributable: ${d.first.callId} ${d.first.attributable.join(', ')})` : ''}; ${d.nonattributableViolations} non-attributable violations`,
                ]
              : []),
          ].join('\n'),
        );
      }
      return 0;
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      return 2;
    }
  },
};

export default command;
