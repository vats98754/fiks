// `fiks exp-detect clean` (paper/EXP-PLAN.md E-B, clean traffic): every planned call through
// fiks-proxy against vendor v1 with shop-mcp at seed-v1, one harness for the whole run (the
// vendor's state is the seeded one throughout: the plan makes no write).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CallRecord } from '@fiks/proxy';
import { CATALOG } from '@fiks/vendor-api';
import { startHarness } from '../harness.ts';
import { ROOT, shopAt } from '../paths.ts';
import { detectRoot, forbidLlm, gitDirty, gitHead, jsonl, newRunId } from './io.ts';
import { cleanPlan, entitiesOf, FIXED_QUERIES, type PlannedCall, SEED_ORDER_IDS } from './plan.ts';

export interface CleanRow {
  callId: string;
  kind: PlannedCall['kind'];
  tool: string;
  args: Record<string, string>;
  verdict: 'verified' | 'violated' | 'unverifiable' | 'none';
  /** Violated property ids (sorted, distinct). */
  propertyIds: string[];
  checked: string[];
  entities: string[];
  isError: boolean;
  at: string;
}

export interface CleanOptions {
  runId?: string;
  /** Results root (default bench/results/exp/detect). */
  outRoot?: string;
  /** shop-mcp checkout (default the cached seed-v1 worktree). */
  shopDir?: string;
  plan?: PlannedCall[];
  log?: (line: string) => void;
}

export interface CleanResult {
  runId: string;
  dir: string;
  rows: CleanRow[];
}

/** One clean row from the proxy's record of a call. */
export function cleanRow(call: PlannedCall, rec: CallRecord | undefined): CleanRow {
  const receipt = rec?.receipt;
  return {
    callId: call.callId,
    kind: call.kind,
    tool: call.tool,
    args: call.args,
    verdict: receipt?.verdict ?? 'none',
    propertyIds: [...new Set((receipt?.violations ?? []).map((v) => v.propertyId))].sort(),
    checked: receipt?.checked ?? [],
    entities: entitiesOf(call.args, rec?.result.structuredContent),
    isError: rec?.result.isError === true,
    at: rec?.at ?? '',
  };
}

export async function runClean(opts: CleanOptions = {}): Promise<CleanResult> {
  forbidLlm();
  const log = opts.log ?? (() => {});
  const runId = opts.runId ?? newRunId();
  const dir = join(opts.outRoot ?? detectRoot(), runId);
  const shopDir = opts.shopDir ?? shopAt('seed-v1');
  const plan = opts.plan ?? cleanPlan();
  const startedAt = new Date().toISOString();
  const rows: CleanRow[] = [];
  const calls: unknown[] = [];
  const h = await startHarness({ vendor: 'v1', via: 'proxy', shopDir });
  try {
    for (const call of plan) {
      const { record } = await h.call(call.tool, call.args);
      if (!record) throw new Error(`${call.callId}: the proxy recorded no call`);
      rows.push(cleanRow(call, record));
      // The proxy event format (`fiks-proxy --events`), which replay.ts reads back.
      calls.push({ type: 'call', callId: call.callId, ...record });
    }
  } finally {
    await h.close();
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'clean.jsonl'), jsonl(rows));
  writeFileSync(join(dir, 'calls.jsonl'), jsonl(calls));
  const violated = rows.filter((r) => r.verdict === 'violated').length;
  const meta = {
    experiment: 'E-B clean traffic (paper/EXP-PLAN.md)',
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    vendor: 'v1',
    via: 'fiks-proxy (stdio, in-process harness)',
    shopRef: 'seed-v1',
    shopMcpSha: gitHead(shopDir),
    fiksSha: gitHead(ROOT),
    fiksDirty: gitDirty(ROOT),
    llm: 'none (FIKS_LLM_FORBID=1)',
    catalogSize: CATALOG.length,
    fixedQueries: FIXED_QUERIES,
    seedOrders: SEED_ORDER_IDS,
    calls: rows.length,
    byKind: Object.fromEntries(
      ['product', 'category', 'query', 'order'].map((k) => [k, rows.filter((r) => r.kind === k).length]),
    ),
    verdicts: Object.fromEntries(
      ['verified', 'violated', 'unverifiable', 'none'].map((v) => [
        v,
        rows.filter((r) => r.verdict === v).length,
      ]),
    ),
    violated,
    entities: new Set(rows.flatMap((r) => r.entities)).size,
  };
  writeFileSync(join(dir, 'meta.clean.json'), `${JSON.stringify(meta, null, 2)}\n`);
  log(
    `exp-detect clean ${runId}: ${rows.length} calls, ${violated} violated, ${meta.entities} entities -> ${dir}`,
  );
  return { runId, dir, rows };
}
