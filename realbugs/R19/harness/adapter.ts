// realbugs/R19/adapter.json as a RealbugAdapter (packages/interfaces), consumed by RBA.
// The typed import is checked by `tsc -p realbugs/R19/harness/tsconfig.json`: every field but the
// fixture labels is checked at compile time (a JSON import widens string literals to `string`, so the
// `recorded | synthesized` union is checked at load time, with the key set).
import type { RealbugAdapter, RealbugFixture } from '../../../packages/interfaces/src/index.ts';
import adapterJson from '../adapter.json' with { type: 'json' };

export const ADAPTER_KEYS = [
  'bugId',
  'repoDir',
  'prefixSha',
  'fixSha',
  'serverCommand',
  'baseUrlEnv',
  'testCommand',
  'testRunner',
  'suiteScope',
  'allowedEditPaths',
  'humanFixTests',
  'heldoutCommand',
  'issuePath',
  'contractPath',
  'fixtures',
] as const satisfies readonly (keyof RealbugAdapter)[];

const LABELS: readonly RealbugFixture['label'][] = ['recorded', 'synthesized'];

function fixtureOf(f: { path: string; label: string }): RealbugFixture {
  if (!LABELS.includes(f.label as RealbugFixture['label'])) {
    throw new Error(`adapter.json: fixture ${f.path} has label '${f.label}', not recorded|synthesized`);
  }
  return { path: f.path, label: f.label as RealbugFixture['label'] };
}

/** Checks the key set (no missing or unknown field) and the fixture labels. */
export function checkAdapter(json: Record<string, unknown>): void {
  const keys = Object.keys(json).sort();
  const want = [...ADAPTER_KEYS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(want)) {
    throw new Error(`adapter.json keys ${keys.join(',')} != RealbugAdapter keys ${want.join(',')}`);
  }
}

checkAdapter(adapterJson);

export const ADAPTER: RealbugAdapter = {
  ...adapterJson,
  fixtures: adapterJson.fixtures.map(fixtureOf),
};

/** The server command as argv (split on whitespace; no argument contains a space). */
export function serverArgv(adapter: RealbugAdapter = ADAPTER): string[] {
  return adapter.serverCommand.split(/\s+/).filter(Boolean);
}
