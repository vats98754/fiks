import { join } from 'node:path';
import type { DomainScenario } from '@fiks/interfaces';
import type { Receipt } from '@fiks/proxy';
import { appendEvent, saveTrace, traceFromCall } from '@fiks/repro';
import { SCENARIOS } from '@fiks/vendor-api';
import { type HarnessOptions, harnessDomain, startHarness } from '../harness.ts';
import { FIKS_DIR, repoAt } from '../paths.ts';

export type { Scenario, ScenarioCall } from '@fiks/vendor-api';
export { SCENARIOS };

/** The scenarios of `domain` (shop: SCENARIOS). */
export function scenariosOf(domain = 'shop'): Record<string, DomainScenario> {
  const d = harnessDomain(domain);
  return d ? d.scenarios : SCENARIOS;
}

export interface ScenarioOptions extends Partial<HarnessOptions> {
  profile?: 'isolated' | 'full';
  /** Where violations are written as traces (default .fiks/traces); `false` disables capture. */
  traceDir?: string | false;
  eventsPath?: string;
  runId?: string;
  /** shop-mcp version to run (default seed-v1, the unfixed tool; `main` for the fixed one). */
  shopRef?: string;
}

export async function runScenario(id: string, opts: ScenarioOptions = {}) {
  const domain = opts.domain ?? 'shop';
  const all = scenariosOf(domain);
  const s = all[id];
  if (!s) throw new Error(`unknown scenario ${id}; known: ${Object.keys(all).join(', ')}`);
  const serverName =
    domain === 'shop' ? 'shop-mcp' : (harnessDomain(domain)?.repo.slug.split('/').pop() ?? domain);
  const runId = opts.runId ?? `run_${new Date().toISOString().replace(/[-:.]/g, '')}`;
  const traceDir = opts.traceDir === false ? undefined : (opts.traceDir ?? join(FIKS_DIR, 'traces'));
  const eventsPath = opts.eventsPath ?? join(FIKS_DIR, 'events.jsonl');
  const drifts = s.vendor === 'v2' && opts.profile !== 'full' ? s.drift : undefined;
  const clock = opts.clock ?? new Date();
  const transport = opts.transport ?? 'stdio';
  const traces: string[] = [];

  const h = await startHarness({
    vendor: s.vendor,
    drifts,
    via: 'proxy',
    clock,
    ...opts,
    shopDir: opts.shopDir ?? repoAt(opts.shopRef, domain),
    onCall: async (rec) => {
      const extra = await opts.onCall?.(rec);
      if (!traceDir || rec.receipt.verdict !== 'violated') return extra;
      const violated = rec.receipt.violations.map((v) => v.propertyId);
      const target = s.target.filter((p) => violated.includes(p));
      const trace = traceFromCall(rec, {
        runId,
        upstream: { version: s.vendor, drifts: h.vendorDrifts, clock: clock.toISOString() },
        server: { name: serverName, transport },
        ...(target.length ? { target } : {}),
      });
      const file = saveTrace(traceDir, trace);
      traces.push(file);
      for (const v of trace.violated) {
        appendEvent(eventsPath, {
          runId,
          type: 'violation',
          traceId: trace.id,
          propertyId: v.propertyId,
          data: { scenario: s.id, tool: rec.tool, message: v.message },
        });
      }
      appendEvent(eventsPath, { runId, type: 'trace_saved', traceId: trace.id, data: { file } });
      return { traceId: trace.id };
    },
  });
  const calls: { tool: string; args: Record<string, unknown>; receipt: Receipt | undefined; text: string }[] =
    [];
  try {
    for (const c of s.calls) {
      const { result } = await h.call(c.tool, c.args);
      const receipt = result._meta?.['fiks/receipt'] as Receipt | undefined;
      const last = result.content?.at(-1) as { text?: string } | undefined;
      calls.push({ tool: c.tool, args: c.args, receipt, text: last?.text ?? '' });
    }
  } finally {
    await h.close();
  }
  return { scenario: s.id, runId, vendor: s.vendor, drifts: h.vendorDrifts, transport, calls, traces };
}
