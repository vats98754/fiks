// Reads T0's throughput.json (LLMR's ThroughputSchema) into what the K1 fit needs: the worker count
// (PLAN 8.2 "Workers") and the sustained Claude usage rate at that count.

import { readFileSync } from 'node:fs';
import { type ThroughputReport, ThroughputSchema } from '@fiks/llm';
import { unitOf } from './steps.ts';

export const WORKER_SET = [1, 2, 4, 6] as const;

export interface MeasuredRate {
  source: string;
  workers: number;
  attemptsPerHour: number;
  /** Usage weight of the probed repair model. */
  unitPerAttempt: number;
  /** Fraction of wall-clock lost to cap pauses (A1/R1 registries); 0 if none observed. */
  capPauseFraction: number;
  sustainedUnitsPerHour: number;
  ollamaTokensPerSec: number | null;
  notes: string[];
}

export function loadThroughput(path: string): ThroughputReport {
  return ThroughputSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * Workers = the largest count in {1, 2, 4, 6} with < 2% 429/overload, no cap message and, when the
 * per-worker RSS is known, workers x RSS <= 16 GB - 6 GB Docker. Repair-worker levels (R1) are used
 * when present, else the T0 authoring levels.
 */
export function measuredRate(
  t: ThroughputReport,
  opts: { source: string; peakRssMbPerWorker?: number; rssBudgetMb?: number; capPauseFraction?: number },
): MeasuredRate {
  const notes: string[] = [];
  const repair = t.repairWorkers?.levels ?? null;
  const levels = repair ?? t.authoring.levels;
  if (!repair) notes.push('no repair-worker levels in throughput.json: using the T0 authoring levels');
  const budget = opts.rssBudgetMb ?? (16 - 6) * 1024;
  const ok = levels.filter(
    (l) =>
      (WORKER_SET as readonly number[]).includes(l.concurrency) &&
      l.sessions - l.notRun > 0 &&
      l.rateLimitOverloadRate < 0.02 &&
      l.caps === 0 &&
      l.capEvents.length === 0 &&
      (opts.peakRssMbPerWorker === undefined || l.concurrency * opts.peakRssMbPerWorker <= budget),
  );
  if (ok.length === 0) throw new Error('no measured worker level satisfies the PLAN 8.2 workers rule');
  const best = ok.reduce((a, b) => (b.concurrency > a.concurrency ? b : a));
  const model = repair ? t.models.repair : t.models.authoring;
  const unitPerAttempt = unitOf(model);
  const capPauseFraction = opts.capPauseFraction ?? 0;
  if (capPauseFraction < 0 || capPauseFraction >= 1) throw new Error('capPauseFraction must be in [0, 1)');
  if (t.dry) notes.push('throughput.json is a --dry (mocked) probe: not a measurement');
  const tps = t.ollama.status === 'measured' ? (t.ollama.tokensPerSec?.aggregate ?? null) : null;
  return {
    source: opts.source,
    workers: best.concurrency,
    attemptsPerHour: best.attemptsPerHour,
    unitPerAttempt,
    capPauseFraction,
    sustainedUnitsPerHour: best.attemptsPerHour * unitPerAttempt * (1 - capPauseFraction),
    ollamaTokensPerSec: tps,
    notes,
  };
}
