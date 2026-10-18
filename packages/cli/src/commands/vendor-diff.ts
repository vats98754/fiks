import { isDeepStrictEqual } from 'node:util';
import { ALL_DRIFTS, createVendor, DRIFTS, type DriftId } from '@fiks/vendor-api';

interface Probe {
  describe: string;
  run(base: string): Promise<unknown>;
}

const json = async (url: string, init?: RequestInit) => (await fetch(url, init)).json();

/** One request per drift whose observable result differs between v1 and v2. */
const PROBES: Record<DriftId, Probe> = {
  D1: {
    describe: 'GET /products?q=laptop -> items[0].price',
    run: async (b) => (await json(`${b}/products?q=laptop`)).items[0].price,
  },
  D2: {
    describe: 'GET /products/p-1001 -> field names',
    run: async (b) => Object.keys(await json(`${b}/products/p-1001`)).sort(),
  },
  D3: {
    describe: 'POST /orders then GET /orders/{id} -> status',
    run: async (b) => {
      const o = await json(`${b}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ product_id: 'p-1004', quantity: 1 }] }),
      });
      return (await fetch(`${b}/orders/${o.id}`)).status;
    },
  },
  D4: {
    describe: 'GET /products?q=cable -> items.length of total',
    run: async (b) => {
      const r = await json(`${b}/products?q=cable`);
      return `${r.items.length} of ${r.total}`;
    },
  },
  D5: {
    describe: 'GET /orders/o-5001 -> typeof created_at',
    run: async (b) => typeof (await json(`${b}/orders/o-5001`)).created_at,
  },
};

async function withVendor<T>(
  version: 'v1' | 'v2',
  drifts: string | undefined,
  fn: (base: string) => Promise<T>,
) {
  const v = createVendor({ version, drifts });
  try {
    return await fn(await v.listen());
  } finally {
    await v.close();
  }
}

export async function vendorDiff() {
  const specV1 = await withVendor('v1', undefined, (b) => json(`${b}/openapi.json`));
  const specV2 = await withVendor('v2', undefined, (b) => json(`${b}/openapi.json`));
  const behaviorDiffs = [];
  for (const drift of ALL_DRIFTS) {
    const probe = PROBES[drift];
    const v1 = await withVendor('v1', undefined, probe.run);
    const v2 = await withVendor('v2', drift, probe.run);
    if (!isDeepStrictEqual(v1, v2)) {
      behaviorDiffs.push({ drift, title: DRIFTS[drift].title, probe: probe.describe, v1, v2 });
    }
  }
  return { openapiIdentical: isDeepStrictEqual(specV1, specV2), behaviorDiffs };
}
