import { join } from 'node:path';
import type { Receipt } from '@fiks/proxy';
import { appendEvent, saveTrace, traceFromCall } from '@fiks/repro';
import type { VendorVersion } from '@fiks/vendor-api';
import { type HarnessOptions, startHarness } from '../harness.ts';
import { FIKS_DIR, shopAt } from '../paths.ts';
import { FIXTURE_CALLS } from './record-fixtures.ts';

export interface ScenarioCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface Scenario {
  id: string;
  vendor: VendorVersion;
  /** The drift this scenario isolates (v2 only). */
  drift?: string;
  calls: ScenarioCall[];
  /** The contract properties this drift breaks: a trace's `target`. */
  target: string[];
}

/**
 * Fixed call scripts. By default each D* scenario runs vendor v2 with only its drift active
 * (`profile: 'isolated'`, for detection checks). `profile: 'full'` runs the real v2 with every
 * drift; traces that go into shop-mcp are captured that way (see PLAN.md, trace profile rule).
 */
export const SCENARIOS: Record<string, Scenario> = {
  'v1-all': {
    id: 'v1-all',
    vendor: 'v1',
    calls: FIXTURE_CALLS.map(({ tool, args }) => ({ tool, args })),
    target: [],
  },
  D1: {
    id: 'D1',
    vendor: 'v2',
    drift: 'D1',
    calls: [{ tool: 'search_products', args: { query: 'laptop' } }],
    target: ['shop.search_products/items.price.range'],
  },
  D2: {
    id: 'D2',
    vendor: 'v2',
    drift: 'D2',
    calls: [{ tool: 'get_product', args: { id: 'p-1001' } }],
    target: ['shop.get_product/price.notNull'],
  },
  D3: {
    id: 'D3',
    vendor: 'v2',
    drift: 'D3',
    calls: [{ tool: 'create_order', args: { items: [{ product_id: 'p-1004', quantity: 2 }] } }],
    target: ['shop.create_order/readAfterWrite'],
  },
  D4: {
    id: 'D4',
    vendor: 'v2',
    drift: 'D4',
    calls: [{ tool: 'search_products', args: { query: 'cable' } }],
    target: ['shop.search_products/countMatchesTotal'],
  },
  D5: {
    id: 'D5',
    vendor: 'v2',
    drift: 'D5',
    calls: [{ tool: 'get_order', args: { order_id: 'o-5001' } }],
    target: ['shop.get_order/created_at.freshness', 'shop.get_order/created_at.equalsUpstream'],
  },
};

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
  const s = SCENARIOS[id];
  if (!s) throw new Error(`unknown scenario ${id}; known: ${Object.keys(SCENARIOS).join(', ')}`);
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
    shopDir: opts.shopDir ?? shopAt(opts.shopRef),
    onCall: async (rec) => {
      const extra = await opts.onCall?.(rec);
      if (!traceDir || rec.receipt.verdict !== 'violated') return extra;
      const violated = rec.receipt.violations.map((v) => v.propertyId);
      const target = s.target.filter((p) => violated.includes(p));
      const trace = traceFromCall(rec, {
        runId,
        upstream: { version: s.vendor, drifts: h.vendorDrifts, clock: clock.toISOString() },
        server: { name: 'shop-mcp', transport },
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
