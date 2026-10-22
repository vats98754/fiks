// @fiks/frame: the detection pipeline's pure parts (PLAN 3.0, 3.1, 5.7, 7 P20): enumerations,
// record formats, drift attribution, frozen traces and IV sidecars, and the H1 FrameSpec. The
// CLI commands enumerate, record, freeze-trace, frame-k and detect-eval drive them.
export * from './attribution.ts';
export * from './binom.ts';
export * from './endpoints.ts';
export * from './enumerate.ts';
export * from './frame-k.ts';
export * from './hash.ts';
export * from './label.ts';
export * from './paths.ts';
export * from './records.ts';
export * from './verdicts.ts';

export const name = '@fiks/frame';
