// Differential input generator (PLAN 3.0 criterion 2) for the HOLD dev DriftPackage D4: fast-check
// arbitraries over the tools that read the drifted endpoint. The grader draws 200 inputs with a fixed
// seed (fc.sample) and replays each one on the patched head, ref A and ref B, under vendor v1 and
// under vendor v1 + the injector rule. Self-contained: fast-check comes in as a parameter.
// A `{ $ref: { call, field } }` argument is the named field of an earlier call's output.
import type * as FC from 'fast-check';

const QUERIES = ['', 'cable', 'laptop', 'monitor', 'dock', 'usb4', 'thunderbolt', 'clarity', 'teapot', 'c'];

export function arbitrary(fc: typeof FC) {
  return fc
    .constantFrom(...QUERIES)
    .map((query) => ({ calls: [{ tool: 'search_products', args: { query } }] }));
}
