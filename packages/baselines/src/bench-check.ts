// Runs every deterministic baseline over the logged bench CallRecords (legacy-bench.ts) and
// summarises fires per drift: the BASE acceptance check, and a template for DET's E3 tables.
import type { CallRecord, DetectorVerdictRow, MonitorToolDef } from '@fiks/interfaces';
import { createAjvMonitor } from './ajv.ts';
import { callsToFirstDetection, rowsToJsonl, runDetector } from './detect.ts';
import { listBenchRuns, loadBenchRun } from './legacy-bench.ts';
import { createSchemaMonitor } from './schema.ts';
import { buildSnapshot, createSnapMonitor } from './snap.ts';
import { createStatMonitor, type StatMode } from './stat.ts';
import { createTrigMonitor, type TrigFacts } from './trig.ts';
import type { BaselineMonitor } from './types.ts';
import { sha256Hex } from './util.ts';

export const DRIFTS = ['D1', 'D2', 'D3', 'D4', 'D5'] as const;
export const WINDOWS = [20, 50] as const;
export const STAT_MODES: StatMode[] = ['aegis', 'evidently'];

/**
 * An M7-style fixture (PLAN 5.4 M7: number -> string) from a v1 get_product record: the upstream
 * `price` becomes a string and, since the seed-v1 server passes `price` through unchanged
 * (`price: p.price ?? null`), so does the tool's output. MUT owns the real operator.
 */
export function m7StringPrice(v1: CallRecord): CallRecord {
  if (v1.tool !== 'get_product') throw new Error('m7StringPrice expects a get_product record');
  const out = structuredClone(v1);
  const sc = out.output.structuredContent as Record<string, unknown>;
  if (typeof sc.price !== 'number') throw new Error('record has no numeric price');
  sc.price = String(sc.price);
  out.output.content = [{ type: 'text', text: JSON.stringify(sc) }];
  for (const x of out.upstream) {
    const body = JSON.parse(x.response.body) as Record<string, unknown>;
    if (typeof body.price === 'number') body.price = String(body.price);
    x.response.body = JSON.stringify(body);
  }
  out.callId = `${v1.callId}#M7`;
  out.mutant = 'M7';
  out.stratum = 'mutant';
  return out;
}

export interface Tally {
  calls: number;
  fires: number;
}

export interface BenchCheckInput {
  resultsDir: string;
  toolDefs: Record<string, MonitorToolDef>;
  /** Vendor OpenAPI document for B-AJV rule 3. */
  openapi?: unknown;
  /** Per-drift facts for B-TRIG (spec diff and typecheck), the same for every call of a drift. */
  trigFacts?: TrigFacts;
  /** Replays per deterministic detector for the determinism check (PLAN D1: 20). */
  replays?: number;
  /**
   * More stateless deterministic monitors to tally and replay, e.g. B-LLMC runners (until BLIND
   * writes the LLM-authored contracts, a stand-in over the hand contracts exercises the runner).
   */
  extraMonitors?: BaselineMonitor[];
}

export interface BenchCheckReport {
  runs: { runId: string; phase: string; vendor: string; calls: number }[];
  m7FixtureFrom: string;
  /** detector -> group (D1..D5, incidental, v1, fixed, M7) -> tally. */
  tallies: Record<string, Record<string, Tally>>;
  /** windowed detector -> drift -> calls to first detection (null = never). */
  firstDetection: Record<string, Record<string, number | null>>;
  /** detector -> number of distinct verdict-JSONL hashes over the replays (1 = deterministic). */
  determinism: Record<string, { replays: number; distinctHashes: number; sha256: string }>;
}

function groupOf(rec: CallRecord, phase: string): string {
  if (rec.mutant) return rec.mutant;
  if (phase.startsWith('A_v1')) return 'v1';
  if (phase.startsWith('C_')) return 'fixed';
  return rec.drift ?? 'incidental';
}

function tally(rows: DetectorVerdictRow[], groups: Map<string, string>): Record<string, Tally> {
  const out: Record<string, Tally> = {};
  for (const r of rows) {
    const g = groups.get(r.callId) ?? 'unknown';
    const t = out[g] ?? { calls: 0, fires: 0 };
    out[g] = t;
    t.calls++;
    if (r.verdict === 'violated') t.fires++;
  }
  return out;
}

export async function checkBench(input: BenchCheckInput): Promise<BenchCheckReport> {
  const runs = listBenchRuns(input.resultsDir).filter((r) => r.meta.proxy !== false);
  const loaded = runs.map((r) => ({ meta: r.meta, records: loadBenchRun(r.dir) }));
  const groups = new Map<string, string>();
  const all: CallRecord[] = [];
  for (const { meta, records } of loaded) {
    for (const rec of records) {
      groups.set(rec.callId, groupOf(rec, meta.phase));
      all.push(rec);
    }
  }
  const v1 = loaded.filter((l) => l.meta.vendor === 'v1').flatMap((l) => l.records);
  const v2 = loaded.filter((l) => l.meta.phase.startsWith('B_v2')).flatMap((l) => l.records);
  const m7Source = v1.find((r) => r.tool === 'get_product');
  if (!m7Source) throw new Error('no v1 get_product record for the M7 fixture');
  const m7 = m7StringPrice(m7Source);
  groups.set(m7.callId, 'M7');
  const records = [...all, m7];
  const ctx = { toolDefs: input.toolDefs };

  const schema = createSchemaMonitor();
  const stateless: BaselineMonitor[] = [
    schema,
    createAjvMonitor({ openapi: input.openapi }),
    createSnapMonitor(buildSnapshot(v1)),
    createTrigMonitor(input.trigFacts ?? {}),
    ...(input.extraMonitors ?? []),
  ];
  const report: BenchCheckReport = {
    runs: loaded.map((l) => ({
      runId: l.meta.runId,
      phase: l.meta.phase,
      vendor: l.meta.vendor,
      calls: l.records.length,
    })),
    m7FixtureFrom: m7Source.callId,
    tallies: {},
    firstDetection: {},
    determinism: {},
  };
  const replays = input.replays ?? 1;
  const replayHashes = async (m: BaselineMonitor, recs: CallRecord[]) => {
    const hashes = new Set<string>();
    let last = '';
    for (let i = 0; i < replays; i++) {
      last = sha256Hex(rowsToJsonl((await runDetector(m, recs, ctx)).map((d) => d.row)));
      hashes.add(last);
    }
    report.determinism[m.id] = { replays, distinctHashes: hashes.size, sha256: last };
  };
  try {
    for (const m of stateless) {
      const rows = (await runDetector(m, records, ctx)).map((d) => d.row);
      report.tallies[m.id] = tally(rows, groups);
      await replayHashes(m, records);
    }
  } finally {
    await schema.close();
  }
  // Windowed detectors: reference = v1 traffic, window pre-filled with its tail, then one drift's
  // calls in logged order (a monitor in steady state when the drift begins).
  for (const mode of STAT_MODES) {
    for (const w of WINDOWS) {
      const m = createStatMonitor({ mode, window: w, reference: v1, prefill: v1 });
      const fd: Record<string, number | null> = {};
      const rows: DetectorVerdictRow[] = [];
      for (const d of DRIFTS) {
        const stream = v2.filter((r) => r.drift === d);
        const dr = (await runDetector(m, stream, ctx)).map((x) => x.row);
        fd[d] = callsToFirstDetection(dr);
        rows.push(...dr);
      }
      report.firstDetection[m.id] = fd;
      report.tallies[m.id] = tally(rows, groups);
      await replayHashes(
        m,
        v2.filter((r) => r.drift !== null),
      );
    }
  }
  return report;
}
