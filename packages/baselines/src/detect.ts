// Runs a baseline over CallRecords and writes DetectorVerdictRows (PLAN Appendix), so DET can put
// every detector on identical inputs. Also: calls-to-first-detection for windowed detectors (E3).
import type { ContractFile } from '@fiks/contracts';
import { findContract } from '@fiks/contracts';
import type { CallRecord, DetectorVerdictRow, MonitorResult, MonitorToolDef } from '@fiks/interfaces';
import type { BaselineMonitor, BaselineResult } from './types.ts';
import { toMonitorInput } from './util.ts';

export interface DetectContext {
  /** Tool definitions by tool name (tools/list of the server under test). */
  toolDefs?: Record<string, MonitorToolDef>;
  /** The fiks contracts, passed through as MonitorInput.contract (baselines do not read them). */
  contracts?: ContractFile | null;
}

/** `entityClass` / `originUnit` of a call for one row: the violated path's label, else the call's only label. */
export function labelFor(map: Record<string, string>, path: string | null): string {
  if (path) {
    if (map[path] !== undefined) return map[path] as string;
    const norm = path.replace(/\[\d+\]/g, '[*]');
    if (map[norm] !== undefined) return map[norm] as string;
  }
  const values = [...new Set(Object.values(map))];
  return values.length === 1 ? (values[0] as string) : '';
}

export interface DetectedRow {
  row: DetectorVerdictRow;
  result: MonitorResult;
}

/**
 * Evaluates `records` in order (windowed monitors see them as traffic). A stateful monitor is reset
 * first, so every replay starts from the same state.
 */
export async function runDetector(
  monitor: BaselineMonitor,
  records: CallRecord[],
  ctx: DetectContext = {},
): Promise<DetectedRow[]> {
  monitor.reset?.();
  const out: DetectedRow[] = [];
  for (const rec of records) {
    const input = {
      ...toMonitorInput(rec, {
        toolDef: ctx.toolDefs?.[rec.tool] ?? null,
        contract: ctx.contracts ? (findContract(ctx.contracts, rec.tool) ?? null) : null,
      }),
      events: rec.events,
    };
    const result = (await monitor(input)) as BaselineResult;
    const first = result.violations[0] ?? null;
    out.push({
      result,
      row: {
        callId: rec.callId,
        domain: rec.domain,
        drift: rec.drift,
        stratum: rec.stratum,
        entityClass: labelFor(rec.entityClass, first?.path ?? null),
        originUnit: labelFor(rec.originUnit, first?.path ?? null),
        detector: monitor.id,
        verdict: result.verdict,
        property: first?.propertyId ?? null,
        at: null,
        elementIndex: null,
        confidence: result.confidence ?? null,
        tokens: result.tokens ?? null,
        costUsd: result.costUsd ?? null,
      },
    });
  }
  return out;
}

/** 1-based index of the first `violated` row, or null if the detector never fires. */
export function callsToFirstDetection(rows: Pick<DetectorVerdictRow, 'verdict'>[]): number | null {
  const i = rows.findIndex((r) => r.verdict === 'violated');
  return i === -1 ? null : i + 1;
}

/** One JSON line per row, keys in Appendix order. */
export function rowsToJsonl(rows: DetectorVerdictRow[]): string {
  return rows.map((r) => `${JSON.stringify(r)}\n`).join('');
}
