// Differential input generator (PLAN 3.0 criterion 2) for the HOLD dev DriftPackage D5: fast-check
// arbitraries over the tools that read the drifted endpoint. The grader draws 200 inputs with a fixed
// seed (fc.sample) and replays each one on the patched head, ref A and ref B, under vendor v1 and
// under vendor v1 + the injector rule. Self-contained: fast-check comes in as a parameter.
// A `{ $ref: { call, field } }` argument is the named field of an earlier call's output.
import type * as FC from 'fast-check';

const IDS = ['p-1001', 'p-1003', 'p-1005', 'p-1102', 'p-1107'];

export function arbitrary(fc: typeof FC) {
  const create = fc
    .record({ product_id: fc.constantFrom(...IDS), quantity: fc.integer({ min: 1, max: 4 }) })
    .map((line) => ({
      calls: [
        { tool: 'create_order', args: { items: [line] } },
        { tool: 'get_order', args: { order_id: { $ref: { call: 0, field: 'order_id' } } } },
      ],
    }));
  const read = fc
    .constantFrom('o-5001', 'o-5002', 'o-4999')
    .map((order_id) => ({ calls: [{ tool: 'get_order', args: { order_id } }] }));
  return fc.oneof(create, read);
}
