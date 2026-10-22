// Differential input generator (PLAN 3.0 criterion 2) for the HOLD dev DriftPackage D3: fast-check
// arbitraries over the tools that read the drifted endpoint. The grader draws 200 inputs with a fixed
// seed (fc.sample) and replays each one on the patched head, ref A and ref B, under vendor v1 and
// under vendor v1 + the injector rule. Self-contained: fast-check comes in as a parameter.
// A `{ $ref: { call, field } }` argument is the named field of an earlier call's output.
import type * as FC from 'fast-check';

const IDS = ['p-1001', 'p-1002', 'p-1004', 'p-1005', 'p-1007', 'p-1008', 'p-1101', 'p-1103', 'p-1106'];

export function arbitrary(fc: typeof FC) {
  const line = fc.record({ product_id: fc.constantFrom(...IDS), quantity: fc.integer({ min: 1, max: 3 }) });
  const lines = fc.uniqueArray(line, { minLength: 1, maxLength: 3, selector: (l) => l.product_id });
  return fc.oneof(
    {
      weight: 4,
      arbitrary: lines.map((items) => ({ calls: [{ tool: 'create_order', args: { items } }, readBack] })),
    },
    {
      weight: 1,
      arbitrary: fc.constantFrom('o-5001', 'o-4999').map((order_id) => ({
        calls: [{ tool: 'get_order', args: { order_id } }],
      })),
    },
  );
}

const readBack = { tool: 'get_order', args: { order_id: { $ref: { call: 0, field: 'order_id' } } } };
