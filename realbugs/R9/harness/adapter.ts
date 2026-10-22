// Typed view of ../adapter.json (RealbugAdapter, packages/interfaces). `tsc -p
// realbugs/R9/harness/tsconfig.json` checks every field's type here. TypeScript widens JSON
// string literals, so the fixture label union ('recorded' | 'synthesized') is checked by
// `fixtureLabel` at load time (and by the unit test) instead of by the compiler.
import type { RealbugAdapter, RealbugFixture } from '../../../packages/interfaces/src/index.ts';
import raw from '../adapter.json' with { type: 'json' };

export function fixtureLabel(label: string): RealbugFixture['label'] {
  if (label !== 'recorded' && label !== 'synthesized') throw new Error(`bad fixture label ${label}`);
  return label;
}

export const R9_ADAPTER: RealbugAdapter = {
  ...raw,
  fixtures: raw.fixtures.map((f) => ({ path: f.path, label: fixtureLabel(f.label) })),
};

/** The extra fields this bug's adapter carries beyond RealbugAdapter (see adapter.json notes). */
export const R9_EXTRA: {
  status: string;
  attrition: string;
  namedProperty: string;
  triggerFixture: string;
  harnessCommand: string;
  upstreamHosts: string[];
  serverResolution: string;
  installCommand: string;
} = raw;
