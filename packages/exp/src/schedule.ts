// Pacing (PLAN 8.2): blocks = (drift, model, attempt-index), each holding every arm of its phase in
// a seeded random order; confirmatory phases first; breadth-first over the attempt index, so a cap
// stop leaves a balanced design with fewer attempts, not fewer drifts.

import { join } from 'node:path';
import { formatRunKey, type RunKey, type TraceFormat } from '@fiks/interfaces';
import { type ArmName, armArgv } from './argv.ts';
import type { DriftInput } from './inputs.ts';
import { seededShuffle } from './rng.ts';
import type { Phase } from './runs.ts';

export interface ArmJob {
  arm: ArmName;
  traceFormat: TraceFormat | null;
  model: string;
  runKey: string;
  argv: string[];
  /** Attempt dir relative to the run dir; each try gets <dir>/try-<n>/fiks as FIKS_DIR. */
  dir: string;
}

export interface Block {
  id: string;
  phase: string;
  drift: string;
  model: string;
  attempt: number;
  jobs: ArmJob[];
}

export interface PlanPhase {
  phase: Phase;
  drifts: DriftInput[];
}

export interface ScheduleOptions {
  runId: string;
  seed: string;
  fiks: string[];
  /** Frozen trace per drift id (manifest traces or the prepare phase's outputs). */
  traceOf: (d: DriftInput) => string;
  dry: boolean;
  /** --dry: REPRO-AGENT stub script. */
  reproStub: string;
  extraArms: ArmName[];
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9._+-]+/g, '_');

export function blockId(phase: string, drift: string, model: string, attempt: number): string {
  return `${phase}/${drift}/${model}/${attempt}`;
}

export function buildBlocks(plan: PlanPhase[], o: ScheduleOptions): Block[] {
  const out: Block[] = [];
  for (const { phase, drifts } of plan) {
    const arms = [...phase.arms, ...o.extraArms.filter((a) => !phase.arms.includes(a))];
    const formats: (TraceFormat | null)[] = phase.traceFormats ?? [null];
    for (let attempt = 1; attempt <= phase.attempts; attempt++) {
      for (const d of drifts) {
        for (const model of phase.models) {
          const id = blockId(phase.name, d.id, model, attempt);
          const entries = arms.flatMap((arm) => formats.map((f) => ({ arm, f })));
          const ordered = seededShuffle(entries, o.seed, id);
          const jobs = ordered.map(({ arm, f }): ArmJob => {
            const key: RunKey = {
              experiment: f ? `${o.runId}-${f}` : o.runId,
              arm,
              model,
              domain: d.domain,
              drift: d.id,
              attempt,
            };
            const runKey = formatRunKey(key);
            const trace = o.traceOf(d);
            const argv = armArgv({
              arm,
              runKey: key,
              drift: d,
              trace,
              ...(f ? { traceFormat: f } : {}),
              ...(o.dry ? { agentStub: arm === 'REPRO-AGENT' ? o.reproStub : (d.stubFix as string) } : {}),
              fiks: o.fiks,
            });
            return {
              arm,
              traceFormat: f,
              model,
              runKey,
              argv,
              dir: join('attempts', ...runKey.split('/').map(slug)),
            };
          });
          out.push({ id, phase: phase.name, drift: d.id, model, attempt, jobs });
        }
      }
    }
  }
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const b of out) {
    if (ids.has(b.id)) throw new Error(`duplicate block ${b.id}`);
    ids.add(b.id);
    for (const j of b.jobs) {
      if (keys.has(j.runKey)) throw new Error(`duplicate run key ${j.runKey}`);
      keys.add(j.runKey);
    }
  }
  return out;
}
