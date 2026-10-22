// @fiks/attacks — the adversarial-trace suite for E6 (WORKSTREAMS SEC).
// Payload templates, the four attack goals and their oracles, carrier placement, the egress sink, the
// canary scanner, the AST detectors, and the small adaptive attacker. See paper/security/SOURCES.md
// for template provenance and paper/build-logs/SEC.md for the build log.

export * from './adaptive.ts';
export * from './ast.ts';
export * from './canary.ts';
export * from './carrier.ts';
export * from './diff.ts';
export * from './egress.ts';
export * from './goals.ts';
export * from './outcome.ts';
export * from './templates.ts';
export * from './types.ts';

export const name = '@fiks/attacks';
