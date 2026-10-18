export type VendorVersion = 'v1' | 'v2';
export type DriftId = 'D1' | 'D2' | 'D3' | 'D4' | 'D5';

export const ALL_DRIFTS: readonly DriftId[] = ['D1', 'D2', 'D3', 'D4', 'D5'];

/** Value of the `Vendor-Api-Version` response header (Stripe-style dated versions). */
export const VERSION_HEADER = 'vendor-api-version';
export const VERSION_DATES: Record<VendorVersion, string> = { v1: '2026-01-01', v2: '2026-10-01' };

/** v2 search page size (D4). v1 returns every match on one page. */
export const V2_PAGE_SIZE = 5;

export interface DriftInfo {
  id: DriftId;
  title: string;
  endpoint: string;
  v2Behavior: string;
}

/** Behavioral changes in v2. The OpenAPI document is identical in both versions. */
export const DRIFTS: Record<DriftId, DriftInfo> = {
  D1: {
    id: 'D1',
    title: 'unit drift',
    endpoint: 'GET /products',
    v2Behavior: 'price is integer cents, same field name',
  },
  D2: {
    id: 'D2',
    title: 'silent rename',
    endpoint: 'GET /products/{id}',
    v2Behavior: 'price is renamed to unit_amount',
  },
  D3: {
    id: 'D3',
    title: 'lost write',
    endpoint: 'POST /orders',
    v2Behavior: 'returns 200 and an id, but persists only when Idempotency-Key is sent',
  },
  D4: {
    id: 'D4',
    title: 'pagination',
    endpoint: 'GET /products',
    v2Behavior: `results are paginated (${V2_PAGE_SIZE} per page) with next_cursor`,
  },
  D5: {
    id: 'D5',
    title: 'timestamp format',
    endpoint: 'GET /orders/{id}',
    v2Behavior: 'created_at is epoch milliseconds instead of ISO-8601',
  },
};

/** Parses `VENDOR_DRIFTS=D1,D3`. v1 never has drifts; v2 defaults to all of them. */
export function resolveDrifts(version: VendorVersion, spec?: string): Set<DriftId> {
  if (version === 'v1') return new Set();
  if (!spec?.trim()) return new Set(ALL_DRIFTS);
  const out = new Set<DriftId>();
  for (const raw of spec.split(',')) {
    const id = raw.trim().toUpperCase();
    if (!(ALL_DRIFTS as readonly string[]).includes(id)) throw new Error(`unknown drift "${raw}"`);
    out.add(id as DriftId);
  }
  return out;
}
