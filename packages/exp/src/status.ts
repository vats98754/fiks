// Status-only output (PLAN 8.1 K2): progress, infra and pause state. No correctness, verdict, CI,
// gate, PR or grade field may appear, so watching a run cannot steer it. The schema is strict
// (unknown keys are rejected) and every line the runner prints is validated before it is printed.

import { z } from 'zod';

const count = z.number().int().nonnegative();

export const StatusSchema = z.strictObject({
  type: z.literal('status'),
  run: z.string(),
  at: z.iso.datetime(),
  state: z.enum(['starting', 'preparing', 'running', 'paused', 'complete', 'error']),
  pauseReason: z.enum(['cap', 'infra', 'rss', 'signal']).nullable(),
  phase: z.string().nullable(),
  blocksTotal: count,
  blocksDone: count,
  blocksDropped: count,
  blocksInFlight: count,
  blocksDiscarded: count,
  attemptsTotal: count,
  attemptsFinished: count,
  infraRetries: count,
  stepsTotal: count,
  stepsDone: count,
  workers: count,
  rssMb: z.number().nonnegative().nullable(),
  elapsedMs: z.number().nonnegative(),
});

export type Status = z.infer<typeof StatusSchema>;

/** Names that must never be a status field (or part of one). */
export const FORBIDDEN_STATUS_WORDS = [
  'correct',
  'verdict',
  'outcome',
  'pass',
  'fail',
  'green',
  'red',
  'ci',
  'gate',
  'pr',
  'grade',
  'violat',
  'success',
  'exit',
];

export function statusJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(StatusSchema) as Record<string, unknown>;
}

export function formatStatus(s: Status): string {
  return JSON.stringify(StatusSchema.parse(s));
}
