import type { Receipt } from '@fiks/proxy';
import type { VendorVersion } from '@fiks/vendor-api';
import { type HarnessOptions, startHarness } from '../harness.ts';
import { FIXTURE_CALLS } from './record-fixtures.ts';

export interface ScenarioCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface Scenario {
  id: string;
  vendor: VendorVersion;
  drifts?: string;
  calls: ScenarioCall[];
}

/** Fixed call scripts. Each D* scenario runs vendor v2 with only that drift active. */
export const SCENARIOS: Record<string, Scenario> = {
  'v1-all': { id: 'v1-all', vendor: 'v1', calls: FIXTURE_CALLS.map(({ tool, args }) => ({ tool, args })) },
  D1: {
    id: 'D1',
    vendor: 'v2',
    drifts: 'D1',
    calls: [{ tool: 'search_products', args: { query: 'laptop' } }],
  },
  D2: { id: 'D2', vendor: 'v2', drifts: 'D2', calls: [{ tool: 'get_product', args: { id: 'p-1001' } }] },
  D3: {
    id: 'D3',
    vendor: 'v2',
    drifts: 'D3',
    calls: [{ tool: 'create_order', args: { items: [{ product_id: 'p-1004', quantity: 2 }] } }],
  },
  D4: {
    id: 'D4',
    vendor: 'v2',
    drifts: 'D4',
    calls: [{ tool: 'search_products', args: { query: 'cable' } }],
  },
  D5: { id: 'D5', vendor: 'v2', drifts: 'D5', calls: [{ tool: 'get_order', args: { order_id: 'o-5001' } }] },
};

export async function runScenario(id: string, opts: Partial<HarnessOptions> = {}) {
  const s = SCENARIOS[id];
  if (!s) throw new Error(`unknown scenario ${id}; known: ${Object.keys(SCENARIOS).join(', ')}`);
  const h = await startHarness({ vendor: s.vendor, drifts: s.drifts, via: 'proxy', ...opts });
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
  return {
    scenario: s.id,
    vendor: s.vendor,
    drifts: h.vendorDrifts,
    transport: opts.transport ?? 'stdio',
    calls,
  };
}
