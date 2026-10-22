// Differential input generator (PLAN 3.0 criterion 2) for the HOLD dev DriftPackage D2: fast-check
// arbitraries over the tools that read the drifted endpoint. The grader draws 200 inputs with a fixed
// seed (fc.sample) and replays each one on the patched head, ref A and ref B, under vendor v1 and
// under vendor v1 + the injector rule. Self-contained: fast-check comes in as a parameter.
// A `{ $ref: { call, field } }` argument is the named field of an earlier call's output.
import type * as FC from 'fast-check';

const IDS = [
  ...['1001', '1002', '1003', '1004', '1005', '1006', '1007', '1008'].map((n) => `p-${n}`),
  ...['1101', '1102', '1103', '1104', '1105', '1106', '1107'].map((n) => `p-${n}`),
  'p-0000',
  'p-9999',
];

export function arbitrary(fc: typeof FC) {
  return fc.constantFrom(...IDS).map((id) => ({ calls: [{ tool: 'get_product', args: { id } }] }));
}
