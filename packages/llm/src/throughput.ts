// Schema of throughput.json, written by probe.ts (run T0 -> paper/results/raw/throughput.json) and
// read by RUN's `pnpm exp fit --measured` and BLIND's A1 runner (--concurrency).

import { z } from 'zod';

const count = z.number().int().nonnegative();

export const TokensSchema = z.object({ in: count, out: count, cacheRead: count, cacheCreate: count });

export const CapEventSchema = z.object({
  at: z.iso.datetime(),
  message: z.string(),
  resetAt: z.iso.datetime().optional(),
  limitType: z.string().optional(),
});

export const SpawnSchema = z.object({
  n: count,
  meanMs: z.number().nonnegative().nullable(),
  medianMs: z.number().nonnegative().nullable(),
  p90Ms: z.number().nonnegative().nullable(),
});

export const LevelSchema = z.object({
  concurrency: z.number().int().positive(),
  sessions: count,
  ok: count,
  modelErrors: count,
  infraErrors: count,
  caps: count,
  /** Not started because a cap event stopped the probe. */
  notRun: count,
  wallMs: z.number().nonnegative(),
  /** Finished attempts (ok + model_error) per wall-clock hour at this concurrency. */
  attemptsPerHour: z.number().nonnegative(),
  rateLimitEvents: count,
  overloadEvents: count,
  /** Sessions that saw >= 1 429 or overload (api_retry event or final failure). */
  sessionsWith429OrOverload: count,
  /** sessionsWith429OrOverload / sessions run. T0 picks c with < 0.02 and no cap event. */
  rateLimitOverloadRate: z.number().min(0).max(1),
  capEvents: z.array(CapEventSchema),
  spawnOverheadMs: SpawnSchema,
  costUsd: z.number().nonnegative(),
  tokens: TokensSchema,
});

export const OllamaSectionSchema = z.object({
  status: z.enum(['measured', 'skipped']),
  reason: z.string().nullable(),
  model: z.string().nullable(),
  digest: z.string().nullable(),
  calls: count,
  promptTokens: count,
  completionTokens: count,
  wallMs: z.number().nonnegative(),
  /** completion tokens per wall-clock second, per call. */
  tokensPerSec: z
    .object({
      mean: z.number().nonnegative(),
      median: z.number().nonnegative(),
      aggregate: z.number().nonnegative(),
    })
    .nullable(),
});

export const ThroughputSchema = z.object({
  schema: z.literal('fiks-throughput/1'),
  dry: z.boolean(),
  createdAt: z.iso.datetime(),
  fiksCommit: z.string().nullable(),
  host: z.object({
    platform: z.string(),
    arch: z.string(),
    cpus: z.number().int().positive(),
    memGb: z.number().positive(),
    node: z.string(),
  }),
  models: z.object({ authoring: z.string(), repair: z.string() }),
  authoring: z.object({ levels: z.array(LevelSchema).min(1) }),
  repairWorkers: z.object({ levels: z.array(LevelSchema).min(1) }).nullable(),
  ollama: OllamaSectionSchema,
  capEventsTotal: count,
  capStopped: z.object({ at: z.iso.datetime(), resetAt: z.iso.datetime().nullable() }).nullable(),
  /** Largest authoring concurrency with rateLimitOverloadRate < 0.02 and no cap event (A1's c). */
  recommendedConcurrency: z.number().int().positive().nullable(),
});

export type ThroughputReport = z.infer<typeof ThroughputSchema>;
export type ThroughputLevel = z.infer<typeof LevelSchema>;

export function throughputJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ThroughputSchema) as Record<string, unknown>;
}

/** The T0 rule (PLAN 8.1): the largest c in the measured set with < 2% 429/overload and no cap message. */
export function recommendConcurrency(levels: ThroughputLevel[]): number | null {
  const okLevels = levels.filter(
    (l) =>
      l.sessions - l.notRun > 0 && l.rateLimitOverloadRate < 0.02 && l.capEvents.length === 0 && l.caps === 0,
  );
  if (okLevels.length === 0) return null;
  return Math.max(...okLevels.map((l) => l.concurrency));
}
