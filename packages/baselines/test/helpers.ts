import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CallRecord, MonitorInput, MonitorToolDef } from '@fiks/interfaces';
import { loadBenchRun, toMonitorInput } from '../src/index.ts';

export const ROOT = new URL('../../..', import.meta.url).pathname;
export const RESULTS = join(ROOT, 'bench/results');
export const V1_RUN = join(RESULTS, 'A_v1_20261020T223642');
export const V2_RUN = join(RESULTS, 'B_v2_20261020T224015');

const fixture = JSON.parse(
  readFileSync(join(ROOT, 'packages/baselines/fixtures/shop-tools.seed-v1.json'), 'utf8'),
) as { tools: MonitorToolDef[] };
export const TOOL_DEFS: Record<string, MonitorToolDef> = Object.fromEntries(
  fixture.tools.map((t) => [t.name, t]),
);

let cache: { v1: CallRecord[]; v2: CallRecord[] } | null = null;
export function bench() {
  cache ??= { v1: loadBenchRun(V1_RUN), v2: loadBenchRun(V2_RUN) };
  return cache;
}

export function find(records: CallRecord[], pred: (r: CallRecord) => boolean): CallRecord {
  const r = records.find(pred);
  if (!r) throw new Error('fixture record not found');
  return structuredClone(r);
}

export const input = (rec: CallRecord): MonitorInput & { events: Record<string, unknown>[] } => ({
  ...toMonitorInput(rec, { toolDef: TOOL_DEFS[rec.tool] ?? null }),
  events: rec.events,
});
