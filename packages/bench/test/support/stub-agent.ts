// A deterministic stand-in for the Claude agent: it answers the shop tasks by calling its
// worker's vendor over HTTP (the URL comes from the trial's server env), with a small
// deterministic delay so parallel workers finish out of order. No model, no MCP server.
import type { AgentInput, AgentRun, BenchAgent } from '../../src/index.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(base: string, path: string) {
  const res = await fetch(new URL(path, base));
  return (await res.json()) as Record<string, unknown>;
}

async function answer(prompt: string, base: string): Promise<string> {
  if (prompt.includes('price in US dollars of product p-1001')) {
    const p = await get(base, '/products/p-1001');
    return `The price is $${p.price}.`;
  }
  if (prompt.includes('laptop costs less than $800')) {
    const r = (await get(base, '/products?q=laptop')) as { items: { id: string; price: number }[] };
    const cheap = r.items.find((p) => p.price < 800);
    return cheap ? `${cheap.id} at $${cheap.price}` : 'none';
  }
  if (prompt.includes('Buy 2 units of product p-1004')) {
    const res = await fetch(new URL('/orders', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'stub' },
      body: JSON.stringify({ items: [{ product_id: 'p-1004', quantity: 2 }] }),
    });
    const o = (await res.json()) as { id: string };
    return `Order ${o.id} placed.`;
  }
  if (prompt.includes('"cable" category')) {
    const r = (await get(base, '/products?q=cable')) as { total: number };
    return `There are ${r.total} cable products.`;
  }
  if (prompt.includes('was order o-5001 placed')) {
    const o = (await get(base, '/orders/o-5001')) as { created_at: string };
    return String(o.created_at).slice(0, 10);
  }
  if (prompt.includes('name of product p-1101')) {
    const p = await get(base, '/products/p-1101');
    return String(p.name);
  }
  return 'unknown task';
}

let seq = 0;
/** Concurrency seen by `stubShopAgent` (reset with `resetStubStats`). */
export const stubStats = { inFlight: 0, maxInFlight: 0, calls: 0 };
export function resetStubStats() {
  stubStats.inFlight = 0;
  stubStats.maxInFlight = 0;
  stubStats.calls = 0;
  seq = 0;
}

/**
 * Answers every task correctly, except that the second answer for the p-1101 task declines.
 * "Second" is counted per prompt from the trial's events file name, so the outcome depends on the
 * trial, never on scheduling.
 */
export function stubShopAgent(baseUrlEnv = 'VENDOR_BASE_URL'): BenchAgent {
  return async (input: AgentInput): Promise<AgentRun> => {
    stubStats.calls++;
    stubStats.inFlight++;
    stubStats.maxInFlight = Math.max(stubStats.maxInFlight, stubStats.inFlight);
    try {
      const base = input.server.env[baseUrlEnv];
      if (!base) throw new Error(`no ${baseUrlEnv} in the server env`);
      // Deterministic jitter from the prompt and the call order: reorders completions across workers.
      const n = seq++;
      await sleep(((input.prompt.length + n * 7) % 5) * 4);
      const trial = Number(
        /-(\d+)\.jsonl(?:\s|$)/.exec(input.server.args.join(' '))?.[1] ?? input.server.env.STUB_TRIAL,
      );
      let text = await answer(input.prompt, base);
      if (input.prompt.includes('p-1101') && trial === 2) text = 'I could not confirm the name.';
      return {
        answer: text,
        toolCalls: ['stub'],
        turns: 2,
        costUsd: 0.001,
        usage: { input: 10, output: 5, cacheRead: 100, cacheCreate: 20 },
        transcript: [`assistant: ${text}`],
      };
    } finally {
      stubStats.inFlight--;
    }
  };
}
