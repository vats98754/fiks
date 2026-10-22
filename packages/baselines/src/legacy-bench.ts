// Reads the logged 2026-10-18/20 bench runs (bench/results/<run>/proxy/*.jsonl, the proxy's call
// log) as CallRecords, so the baselines can be checked on real D1-D5 traffic before DET exists.
//
// Labels: in a v2 run every drift is on at once, and each bench task targets one drift
// (trials.jsonl `drift`). A call is labelled with its task's drift when its tool is that drift's
// surface (the tool whose output the drift corrupts; DRIFT_SURFACE); every other call of a v2 run
// is stratum `dev-incidental`, drift null (e.g. the agent's follow-up get_order on an order D3
// lost, which the tool correctly reports as not found). v1 runs are stratum `dev`, drift null.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolResultLike } from '@fiks/contracts';
import type { CallRecord } from '@fiks/interfaces';

export const DRIFT_SURFACE: Record<string, string[]> = {
  D1: ['search_products'],
  D2: ['get_product'],
  D3: ['create_order'],
  D4: ['search_products'],
  D5: ['get_order'],
};

export interface BenchRunMeta {
  runId: string;
  phase: string;
  vendor: string;
  vendorDrifts: string[];
  proxy?: boolean;
}

interface ProxyLine {
  type: string;
  tool: string;
  args: Record<string, unknown>;
  result: ToolResultLike;
  receipt?: Record<string, unknown> & { at?: string };
  http?: CallRecord['upstream'];
  probe?: Record<string, unknown>;
  at?: string;
}

export function readBenchMeta(runDir: string): BenchRunMeta {
  return JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8')) as BenchRunMeta;
}

/** taskId -> the drift that task targets (null = no drift), from trials.jsonl. */
function taskDrifts(runDir: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const line of readFileSync(join(runDir, 'trials.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const t = JSON.parse(line) as { taskId: string; drift: string | null };
    out.set(t.taskId, t.drift ?? null);
  }
  return out;
}

const byTaskTrial = (a: string, b: string) => {
  const [ta, na] = a.replace(/\.jsonl$/, '').split('-');
  const [tb, nb] = b.replace(/\.jsonl$/, '').split('-');
  return ta === tb ? Number(na) - Number(nb) : (ta ?? '').localeCompare(tb ?? '');
};

/** CallRecords of one bench run with a proxy log, in task/trial/call order. */
export function loadBenchRun(runDir: string): CallRecord[] {
  const meta = readBenchMeta(runDir);
  const drifts = taskDrifts(runDir);
  const proxyDir = join(runDir, 'proxy');
  const files = readdirSync(proxyDir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort(byTaskTrial);
  const out: CallRecord[] = [];
  for (const file of files) {
    const stem = file.replace(/\.jsonl$/, '');
    const task = stem.split('-')[0] as string;
    const lines = readFileSync(join(proxyDir, file), 'utf8')
      .split('\n')
      .filter((l) => l.trim());
    for (const [i, line] of lines.entries()) {
      const p = JSON.parse(line) as ProxyLine;
      if (p.type !== 'call') continue;
      const capturedAt = p.at ?? p.receipt?.at;
      if (!capturedAt) throw new Error(`${runDir}/proxy/${file}:${i + 1} has no evaluation instant`);
      const taskDrift = meta.vendor === 'v2' ? (drifts.get(task) ?? null) : null;
      const onSurface = taskDrift !== null && (DRIFT_SURFACE[taskDrift] ?? []).includes(p.tool);
      const events: Record<string, unknown>[] = [
        {
          type: 'legacy-bench',
          runId: meta.runId,
          phase: meta.phase,
          task,
          trial: Number(stem.split('-')[1]),
          receipt: p.receipt ?? null,
        },
      ];
      if (p.probe) events.push({ type: 'probe', ...p.probe });
      out.push({
        callId: `${meta.runId}/${stem}/${i}`,
        domain: 'shop',
        stratum: meta.vendor === 'v2' && !onSurface ? 'dev-incidental' : 'dev',
        catalog: 'original',
        drift: onSurface ? taskDrift : null,
        mutant: null,
        tool: p.tool,
        args: p.args,
        upstream: (p.http ?? []).map((x) => ({ request: x.request, response: x.response })),
        output: p.result,
        events,
        entityClass: {},
        originUnit: {},
        capturedAt,
        controlOf: null,
      });
    }
  }
  return out;
}

/** Every run under `resultsDir` that has a proxy log, with its meta. */
export function listBenchRuns(resultsDir: string): { dir: string; meta: BenchRunMeta }[] {
  const out: { dir: string; meta: BenchRunMeta }[] = [];
  for (const name of readdirSync(resultsDir).sort()) {
    const dir = join(resultsDir, name);
    try {
      if (!readdirSync(dir).includes('proxy')) continue;
      out.push({ dir, meta: readBenchMeta(dir) });
    } catch {
      // not a run directory
    }
  }
  return out;
}
