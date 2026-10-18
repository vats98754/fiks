import { join } from 'node:path';
import {
  addWorktree,
  appendEvent,
  failGate,
  type GateResult,
  generateRepro,
  loadTrace,
  type ReproSpec,
  type Trace,
} from '@fiks/repro';
import { FIKS_DIR, shopDir, WORK_DIR } from '../paths.ts';
import { runScenario, SCENARIOS } from './scenario.ts';

export interface ReproResult {
  scenario: string;
  traceFile: string;
  trace: Pick<Trace, 'id' | 'tool' | 'args' | 'target' | 'upstream'> & { violated: string[] };
  spec: ReproSpec;
  gateF: GateResult;
  worktree?: string;
}

/** Captures the scenario under the real (full) v2 upstream and returns the trace for its target. */
export async function captureTrace(scenario: string, runId: string): Promise<{ file: string; trace: Trace }> {
  const s = SCENARIOS[scenario];
  if (!s?.target.length) throw new Error(`scenario ${scenario} has no target property`);
  const r = await runScenario(scenario, { profile: 'full', runId, traceDir: join(FIKS_DIR, 'traces') });
  for (const file of r.traces) {
    const trace = loadTrace(file);
    if (trace.target?.length) return { file, trace };
  }
  throw new Error(`scenario ${scenario}: no call violated ${s.target.join(', ')} under full v2`);
}

/**
 * Capture -> generate the repro test into a throwaway worktree of shop-mcp at `ref` ->
 * F gate (must fail, for the stated reason, `runs` times in a row).
 */
export async function repro(opts: {
  scenario: string;
  ref?: string;
  runs?: number;
  keep?: boolean;
}): Promise<ReproResult> {
  const runId = `run_${new Date().toISOString().replace(/[-:.]/g, '')}`;
  const events = join(FIKS_DIR, 'events.jsonl');
  const { file, trace } = await captureTrace(opts.scenario, runId);
  const ref = opts.ref ?? 'seed-v1';
  const wt = addWorktree(shopDir(), join(WORK_DIR, 'wt', `repro-${trace.id}`), ref);
  try {
    const spec = generateRepro(trace, file, wt.dir);
    appendEvent(events, {
      runId,
      type: 'repro_generated',
      traceId: trace.id,
      data: { testPath: spec.testPath, ref },
    });
    const gateF = failGate(wt.dir, spec, opts.runs ?? 3);
    appendEvent(events, {
      runId,
      type: 'gate_F',
      traceId: trace.id,
      ok: gateF.ok,
      data: { propertyIds: spec.propertyIds, reason: gateF.reason, ref },
    });
    return {
      scenario: opts.scenario,
      traceFile: file,
      trace: {
        id: trace.id,
        tool: trace.tool,
        args: trace.args,
        target: trace.target,
        upstream: trace.upstream,
        violated: trace.violated.map((v) => v.propertyId),
      },
      spec,
      gateF,
      ...(opts.keep ? { worktree: wt.dir } : {}),
    };
  } finally {
    if (!opts.keep) wt.remove();
  }
}
