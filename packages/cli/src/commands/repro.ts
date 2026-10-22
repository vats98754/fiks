import { join, resolve } from 'node:path';
import {
  appendEvent,
  createWorktree,
  failGate,
  type GateResult,
  generateRepro,
  loadTrace,
  type ReproSpec,
  type Trace,
} from '@fiks/repro';
import { FIKS_DIR, repoDir, WORK_DIR } from '../paths.ts';
import { runScenario, scenariosOf } from './scenario.ts';

export interface ReproResult {
  /** The scenario captured (absent with `--trace`). */
  scenario?: string;
  traceFile: string;
  trace: Pick<Trace, 'id' | 'tool' | 'args' | 'target' | 'upstream'> & { violated: string[] };
  spec: ReproSpec;
  gateF: GateResult;
  worktree?: string;
}

/** Captures the scenario under the real (full) v2 upstream and returns the trace for its target. */
export async function captureTrace(
  scenario: string,
  runId: string,
  domain = 'shop',
): Promise<{ file: string; trace: Trace }> {
  const s = scenariosOf(domain)[scenario];
  if (!s?.target.length) throw new Error(`scenario ${scenario} has no target property`);
  const r = await runScenario(scenario, {
    profile: 'full',
    runId,
    traceDir: join(FIKS_DIR, 'traces'),
    ...(domain === 'shop' ? {} : { domain }),
  });
  for (const file of r.traces) {
    const trace = loadTrace(file);
    if (trace.target?.length) return { file, trace };
  }
  throw new Error(`scenario ${scenario}: no call violated ${s.target.join(', ')} under full v2`);
}

export interface ReproOptions {
  /** Capture this scenario's trace first (or give `trace`). */
  scenario?: string;
  /** An existing trace file (e.g. a frozen trace). */
  trace?: string;
  /** Local ref of the tool repo, resolved as `<ref>^{commit}` with no fetch (default seed-v1). */
  ref?: string;
  runs?: number;
  keep?: boolean;
  /** Domain (default shop): its repo, reproEmitter and suite. */
  domain?: string;
  /** Fetch the repo first (refused with `runKey`). */
  fetch?: boolean;
  runKey?: string;
}

/**
 * Capture (or load) a trace -> generate the repro test into a throwaway worktree of the tool
 * repo at the local ref `ref` -> F gate (must fail, for the stated reason, `runs` times in a row).
 */
export async function repro(opts: ReproOptions): Promise<ReproResult> {
  const domain = opts.domain ?? 'shop';
  const runId = `run_${new Date().toISOString().replace(/[-:.]/g, '')}`;
  const events = join(FIKS_DIR, 'events.jsonl');
  let file: string;
  let trace: Trace;
  if (opts.trace) {
    file = resolve(opts.trace);
    trace = loadTrace(file);
  } else if (opts.scenario) {
    ({ file, trace } = await captureTrace(opts.scenario, runId, domain));
  } else {
    throw new Error('repro: give --scenario or --trace');
  }
  const ref = opts.ref ?? 'seed-v1';
  const wt = createWorktree(repoDir(domain), ref, {
    dir: join(WORK_DIR, 'wt', `repro-${trace.id}`),
    fetch: opts.fetch,
    runKey: opts.runKey,
  });
  try {
    const spec = generateRepro(trace, file, wt.dir, domain);
    appendEvent(events, {
      runId,
      type: 'repro_generated',
      traceId: trace.id,
      data: { testPath: spec.testPath, ref },
    });
    const gateF = failGate(wt.dir, spec, opts.runs ?? 3, domain);
    appendEvent(events, {
      runId,
      type: 'gate_F',
      traceId: trace.id,
      ok: gateF.ok,
      data: { propertyIds: spec.propertyIds, reason: gateF.reason, ref },
    });
    return {
      ...(opts.scenario && !opts.trace ? { scenario: opts.scenario } : {}),
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
