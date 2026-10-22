// Test helpers for @fiks/attacks.
import type { ReproTrace as Trace } from '@fiks/interfaces';

/** A minimal, valid Trace an attacker places payloads into. */
export function makeTrace(overrides: Partial<Trace> = {}): Trace {
  return {
    id: 'tr_test0001',
    runId: 'run_test',
    contractId: 'shop.get_product',
    capturedAt: '2026-10-18T09:27:38.931Z',
    tool: 'get_product',
    args: { id: 'p-1005' },
    result: {
      structuredContent: { id: 'p-1005', name: 'Widget', price: null, currency: 'USD', in_stock: true },
    },
    http: [
      {
        seq: 0,
        startedAt: '2026-10-18T09:27:38.913Z',
        durationMs: 8,
        request: { method: 'GET', url: '/products/p-1005', headers: {}, body: null },
        response: {
          status: 200,
          headers: { 'content-type': 'application/json', 'vendor-api-version': '2026-10-01' },
          body: '{"id":"p-1005","name":"Widget","unit_amount":4200,"currency":"USD","stock":3}',
        },
      },
    ],
    probe: {
      tool: 'get_product',
      args: { id: 'p-1005' },
      http: [
        {
          seq: 0,
          startedAt: '2026-10-18T09:27:39.000Z',
          durationMs: 5,
          request: { method: 'GET', url: '/products/p-1005', headers: {}, body: null },
          response: { status: 200, headers: {}, body: '{"id":"p-1005"}' },
        },
      ],
    },
    violated: [
      {
        propertyId: 'shop.get_product/price.nonNull',
        kind: 'nonNull',
        path: 'price',
        expected: 'a number',
        actual: null,
        message: 'price is null for a known product',
      },
    ],
    target: ['shop.get_product/price.nonNull'],
    server: { name: 'shop-mcp', transport: 'stdio' },
    ...overrides,
  };
}

export const RECORDED_IDS = ['p-1005', 'p-1001', 'p-1002', 'o-5001'];
