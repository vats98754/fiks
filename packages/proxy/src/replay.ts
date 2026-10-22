// Offline replay of recorded tool calls through a monitor (paper/PLAN.md P9, 3.1 "Clock" and
// "Per-element verdicts"). Pure apart from reading the files it is given: every evaluation uses
// now := the record's own evaluation instant (`at`, else `capturedAt`), never the system clock.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  type ContractFile,
  type EvalResult,
  findContract,
  type HttpExchange,
  type ToolResultLike,
} from '@fiks/contracts';
import type {
  DetectorVerdictRow,
  Monitor,
  MonitorOptions,
  MonitorResult,
  MonitorToolDef,
} from '@fiks/interfaces';
import { receiptHints } from './hints.ts';
import { asEvalResult, monitorId } from './monitor.ts';
import { makeReceipt, type Receipt } from './receipt.ts';

/** tools/list snapshot of shop-mcp, for records written before the proxy logged `toolDef`. */
export const SHOP_TOOLS_PATH = new URL('../fixtures/shop-mcp.tools.json', import.meta.url).pathname;

/** Tool definitions from a tools/list result (`{tools: [...]}`) or a plain array. */
export function readTools(file: string): Map<string, MonitorToolDef> {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const list = Array.isArray(parsed) ? parsed : (parsed as { tools?: unknown }).tools;
  if (!Array.isArray(list)) throw new ReplayInputError(`--tools ${file}: no tools array`);
  return new Map((list as MonitorToolDef[]).map((t) => [t.name, t]));
}

/** A record that cannot be replayed faithfully (e.g. no evaluation instant): exit code 2. */
export class ReplayInputError extends Error {}

type Probe = { tool: string; args: Record<string, unknown>; result: ToolResultLike; http: HttpExchange[] };

/** One recorded call, normalized from either record format. */
export interface ReplayRecord {
  callId: string;
  domain: string;
  drift: string | null;
  stratum: string;
  tool: string;
  args: Record<string, unknown>;
  result: ToolResultLike;
  http: HttpExchange[];
  probe?: Probe;
  /** The evaluation instant (`at` ?? `capturedAt`). */
  now: Date;
  upstreamObserved: boolean;
  toolDef?: MonitorToolDef;
  entityClass: Record<string, string>;
  originUnit: Record<string, string>;
  /** The receipt logged when the call was made, if a monitor ran then. */
  loggedReceipt?: Receipt;
}

export interface ReplayContext {
  monitor: Monitor;
  contracts: ContractFile;
  /** Tool definitions for records that carry none (records made before the proxy kept toolDef). */
  tools?: Map<string, MonitorToolDef>;
  /** Passed to the monitor (and so to the evaluator) unchanged; omitted when empty. */
  opts?: MonitorOptions;
}

export interface Replayed {
  record: ReplayRecord;
  result: MonitorResult;
  evaluation: EvalResult & { disabled: string[] };
  /** The receipt the live proxy would have attached, rebuilt from this replay. */
  receipt: Receipt;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** The proxy's event for this call inside a paper CallRecord's `events[]`, if any. */
function proxyEvent(events: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(events)) return undefined;
  return events.find((e): e is Record<string, unknown> => isObject(e) && e.type === 'call');
}

function evaluationInstant(raw: Record<string, unknown>, where: string): Date {
  const instant = raw.at ?? raw.capturedAt;
  if (typeof instant !== 'string') {
    throw new ReplayInputError(
      `${where}: the record has neither "at" nor "capturedAt" (no evaluation instant)`,
    );
  }
  const now = new Date(instant);
  if (Number.isNaN(now.getTime())) {
    throw new ReplayInputError(`${where}: evaluation instant ${JSON.stringify(instant)} is not a date`);
  }
  return now;
}

/** Paper-format upstream pairs carry no seq/timing; replay needs only request and response. */
function asExchanges(pairs: unknown, startedAt: string): HttpExchange[] {
  if (!Array.isArray(pairs)) return [];
  return pairs.map((p, seq) => {
    const x = p as Partial<HttpExchange>;
    return {
      seq: x.seq ?? seq,
      startedAt: x.startedAt ?? startedAt,
      durationMs: x.durationMs ?? 0,
      request: x.request as HttpExchange['request'],
      response: x.response as HttpExchange['response'],
    };
  });
}

/**
 * Normalizes one parsed line. Two formats are accepted:
 * - the proxy's event (`{type: 'call', tool, args, result, http, probe?, receipt?, at, ...}`,
 *   written by `fiks-proxy --events`);
 * - the paper's CallRecord (`{callId, domain, stratum, tool, args, output, upstream, events,
 *   entityClass, originUnit, capturedAt, ...}`), whose proxy event, if any, sits in `events[]`.
 * Anything else (e.g. bench trial rows) returns null. A call record with no evaluation instant
 * throws ReplayInputError.
 */
export function normalizeRecord(
  raw: unknown,
  where: string,
  defaults: { domain: string; stratum: string },
): ReplayRecord | null {
  if (!isObject(raw)) return null;
  if (typeof raw.callId === 'string' && isObject(raw.output) && typeof raw.tool === 'string') {
    const ev = proxyEvent(raw.events);
    const now = evaluationInstant(raw, where);
    const probe = (raw.probe ?? ev?.probe) as Probe | undefined;
    return {
      callId: raw.callId,
      domain: typeof raw.domain === 'string' ? raw.domain : defaults.domain,
      drift: typeof raw.drift === 'string' ? raw.drift : null,
      stratum: typeof raw.stratum === 'string' ? raw.stratum : defaults.stratum,
      tool: raw.tool,
      args: (raw.args ?? {}) as Record<string, unknown>,
      result: raw.output as ToolResultLike,
      http: asExchanges(raw.upstream, now.toISOString()),
      ...(probe ? { probe } : {}),
      now,
      // Record runs always tap the upstream; an explicit flag wins.
      upstreamObserved:
        typeof raw.upstreamObserved === 'boolean'
          ? raw.upstreamObserved
          : typeof ev?.upstreamObserved === 'boolean'
            ? ev.upstreamObserved
            : true,
      ...(isObject(raw.toolDef) || isObject(ev?.toolDef)
        ? { toolDef: (raw.toolDef ?? ev?.toolDef) as MonitorToolDef }
        : {}),
      entityClass: isObject(raw.entityClass) ? (raw.entityClass as Record<string, string>) : {},
      originUnit: isObject(raw.originUnit) ? (raw.originUnit as Record<string, string>) : {},
      ...(isObject(ev?.receipt) ? { loggedReceipt: ev.receipt as unknown as Receipt } : {}),
    };
  }
  if (raw.type === 'call' && typeof raw.tool === 'string' && isObject(raw.result)) {
    const now = evaluationInstant(raw, where);
    const receipt = isObject(raw.receipt) ? (raw.receipt as unknown as Receipt) : undefined;
    return {
      callId: typeof raw.callId === 'string' ? raw.callId : where,
      domain: defaults.domain,
      drift: null,
      stratum: defaults.stratum,
      tool: raw.tool,
      args: (raw.args ?? {}) as Record<string, unknown>,
      result: raw.result as ToolResultLike,
      http: (Array.isArray(raw.http) ? raw.http : []) as HttpExchange[],
      ...(isObject(raw.probe) ? { probe: raw.probe as unknown as Probe } : {}),
      now,
      // Events written before the proxy logged `upstreamObserved` carry it in the receipt only.
      upstreamObserved:
        typeof raw.upstreamObserved === 'boolean'
          ? raw.upstreamObserved
          : typeof receipt?.upstreamObserved === 'boolean'
            ? receipt.upstreamObserved
            : Array.isArray(raw.http) && raw.http.length > 0,
      ...(isObject(raw.toolDef) ? { toolDef: raw.toolDef as unknown as MonitorToolDef } : {}),
      entityClass: {},
      originUnit: {},
      ...(receipt ? { loggedReceipt: receipt } : {}),
    };
  }
  return null;
}

/** Every `.jsonl` file under `path` (or `path` itself when it is a file), sorted. */
export function recordFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  const out: string[] = [];
  for (const name of readdirSync(path).sort()) {
    const full = join(path, name);
    if (statSync(full).isDirectory()) out.push(...recordFiles(full));
    else if (name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

/** Reads call records from files or directories, in order; non-record lines are skipped. */
export function readRecords(
  paths: string[],
  defaults: { domain: string; stratum: string },
): { records: ReplayRecord[]; skipped: number; files: string[] } {
  const records: ReplayRecord[] = [];
  const files = paths.flatMap(recordFiles);
  let skipped = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const lines = file.endsWith('.json') ? [text] : text.split('\n');
    for (const [i, line] of lines.entries()) {
      if (!line.trim()) continue;
      const where = `${file}:${i + 1}`;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new ReplayInputError(`${where}: not JSON`);
      }
      for (const raw of Array.isArray(parsed) ? parsed : [parsed]) {
        const r = normalizeRecord(raw, where, defaults);
        if (r) records.push(r);
        else skipped++;
      }
    }
  }
  return { records, skipped, files };
}

/** Evaluates one record exactly as the live proxy did, with now := the record's instant. */
export async function replayRecord(record: ReplayRecord, ctx: ReplayContext): Promise<Replayed> {
  const contract = findContract(ctx.contracts, record.tool);
  const toolDef = record.toolDef ?? ctx.tools?.get(record.tool);
  const observed = record.upstreamObserved;
  const hasOpts = ctx.opts && Object.values(ctx.opts).some((v) => v !== undefined);
  const result = await ctx.monitor({
    args: record.args,
    result: record.result,
    now: record.now,
    declaredOutputSchema: toolDef?.outputSchema,
    probe: record.probe && { ...record.probe, upstream: observed ? record.probe.http : undefined },
    upstream: observed ? record.http : undefined,
    tool: record.tool,
    contract: contract ?? null,
    toolDef: toolDef ?? null,
    ...(hasOpts ? { opts: ctx.opts } : {}),
  });
  const evaluation = asEvalResult(result, contract);
  const hints = receiptHints({
    contract,
    evaluation,
    structured: record.result.structuredContent,
    upstream: observed ? record.http : undefined,
    probeUpstream: observed ? record.probe?.http : undefined,
  });
  const receipt = makeReceipt(evaluation, record.now, observed, record.loggedReceipt?.traceId, hints);
  return { record, result, evaluation, receipt };
}

/** `items[*].price` for `items[2].price`. */
export const wildcardPath = (at: string) => at.replace(/\[\d+\]/g, '[*]');

/** The index of the innermost array element in a concrete path, or null. */
export function elementIndexOf(at: string): number | null {
  const all = [...at.matchAll(/\[(\d+)\]/g)];
  const last = all.at(-1);
  return last ? Number(last[1]) : null;
}

function lookupLabel(table: Record<string, string>, at: string | null): string {
  if (at !== null) {
    const hit = table[at] ?? table[wildcardPath(at)];
    if (hit !== undefined) return hit;
  }
  return table.$ ?? 'unknown';
}

/**
 * DetectorVerdictRows for one replayed record: one row per violation (with `perElement`, `at`
 * and `elementIndex` name the violating element), else one row with the record's verdict and
 * property null. Cost and tokens are per call and sit on the record's first row only.
 */
export function verdictRows(r: Replayed, detector: string, perElement: boolean): DetectorVerdictRow[] {
  const { record, result } = r;
  const base = {
    callId: record.callId,
    domain: record.domain,
    drift: record.drift,
    stratum: record.stratum,
  };
  const rows: DetectorVerdictRow[] = result.violations.length
    ? result.violations.map((v) => ({
        ...base,
        entityClass: lookupLabel(record.entityClass, v.path),
        originUnit: lookupLabel(record.originUnit, v.path),
        detector,
        verdict: 'violated' as const,
        property: v.propertyId,
        at: perElement ? v.path : null,
        elementIndex: perElement ? elementIndexOf(v.path) : null,
        confidence: null,
        tokens: null,
        costUsd: null,
      }))
    : [
        {
          ...base,
          entityClass: lookupLabel(record.entityClass, null),
          originUnit: lookupLabel(record.originUnit, null),
          detector,
          verdict: result.verdict,
          property: null,
          at: null,
          elementIndex: null,
          confidence: null,
          tokens: null,
          costUsd: null,
        },
      ];
  const first = rows[0];
  if (first) {
    first.tokens = result.tokens ?? null;
    first.costUsd = result.costUsd ?? null;
  }
  return rows;
}

export interface ReplayRun {
  rows: DetectorVerdictRow[];
  replayed: Replayed[];
}

/** Replays every record and returns its DetectorVerdictRows, in record order. */
export async function replayAll(records: ReplayRecord[], ctx: ReplayContext): Promise<ReplayRun> {
  const detector = monitorId(ctx.monitor, 'custom');
  const perElement = ctx.opts?.perElement === true;
  const replayed: Replayed[] = [];
  const rows: DetectorVerdictRow[] = [];
  for (const record of records) {
    const r = await replayRecord(record, ctx);
    replayed.push(r);
    rows.push(...verdictRows(r, detector, perElement));
  }
  return { rows, replayed };
}

/** The verdict part of a receipt: what a monitor decides (not hints, trace id or timing). */
export function verdictOf(
  r: Receipt,
): Pick<Receipt, 'verdict' | 'contractId' | 'checked' | 'violations' | 'disabled'> {
  return {
    verdict: r.verdict,
    contractId: r.contractId,
    checked: r.checked,
    violations: r.violations,
    ...(r.disabled?.length ? { disabled: r.disabled } : {}),
  };
}

export interface CheckResult {
  compared: number;
  /** Records whose replayed verdict (verdict, contractId, checked, violations, disabled) is byte-identical. */
  identical: number;
  /** Records whose whole receipt (also hints, upstreamObserved, traceId, at) is byte-identical. */
  receiptIdentical: number;
  /** Records with no logged receipt (e.g. `--monitor none`): nothing to compare. */
  unlogged: number;
  mismatches: { callId: string; logged: string; replayed: string }[];
  /** Verdict identical, other receipt fields not: the receipt keys that differ, with counts. */
  otherFieldDiffs: Record<string, number>;
}

/**
 * Compares each replayed verdict with the logged receipt's, byte for byte (JSON serialization),
 * and reports separately which non-verdict receipt fields differ (e.g. `hints`, which receipts
 * written before 705e989 do not carry).
 */
export function checkReceipts(replayed: Replayed[]): CheckResult {
  const out: CheckResult = {
    compared: 0,
    identical: 0,
    receiptIdentical: 0,
    unlogged: 0,
    mismatches: [],
    otherFieldDiffs: {},
  };
  for (const r of replayed) {
    const loggedReceipt = r.record.loggedReceipt;
    if (!loggedReceipt) {
      out.unlogged++;
      continue;
    }
    out.compared++;
    const logged = JSON.stringify(verdictOf(loggedReceipt));
    const again = JSON.stringify(verdictOf(r.receipt));
    if (logged !== again) {
      out.mismatches.push({ callId: r.record.callId, logged, replayed: again });
      continue;
    }
    out.identical++;
    if (JSON.stringify(loggedReceipt) === JSON.stringify(r.receipt)) {
      out.receiptIdentical++;
      continue;
    }
    const a = loggedReceipt as unknown as Record<string, unknown>;
    const b = r.receipt as unknown as Record<string, unknown>;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k]))
        out.otherFieldDiffs[k] = (out.otherFieldDiffs[k] ?? 0) + 1;
    }
  }
  return out;
}
