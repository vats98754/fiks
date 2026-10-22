// Behavioural snapshot of the deterministic legacy commands (P18): the loader + adapters give
// the same stdout and exit code as ec241bc's main.ts, run from an ec241bc tree in this test.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { type CliRun, ec241bcTree, runCli } from './support/cli.ts';

/** The fixed normalisation set: wall-clock instants, run ids and trace ids (a hash of the instant). */
export const NORMALISE: [RegExp, string][] = [
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<ISO>'],
  [/run_\d{8}T\d{9}Z/g, '<RUN>'],
  [/tr_[0-9a-f]{10}/g, '<TRACE>'],
];
const norm = (s: string) => NORMALISE.reduce((acc, [re, to]) => acc.replace(re, to), s);

const COMMANDS: string[][] = [
  ['scenario', 'v1-all', '--json'],
  ['scenario', 'D2', '--json'],
  ['vendor-diff', '--json'],
  ['summarize', '--check'],
  ['call', 'get_product', '{"id":"p-1001"}'],
];

const LEGACY = [
  'vendor-diff',
  'record-fixtures',
  'rerecord',
  'scenario',
  'call',
  'repro',
  'repair',
  'confirm',
  'bench',
  'demo',
  'summarize',
];

let tree: ReturnType<typeof ec241bcTree>;
beforeAll(() => {
  tree = ec241bcTree();
}, 120_000);
afterAll(() => tree?.cleanup());

for (const args of COMMANDS) {
  test(`fiks ${args.join(' ')}: same stdout and exit code as ec241bc`, () => {
    const before: CliRun = runCli(args, { root: tree.dir });
    const now: CliRun = runCli(args);
    expect(before.status, before.stderr).not.toBeNull();
    expect(now.status, now.stderr).toBe(before.status);
    expect(before.stdout.length).toBeGreaterThan(0);
    expect(norm(now.stdout)).toBe(norm(before.stdout));
  }, 180_000);
}

test('scenario v1-all --domain shop --json: no violation, identical to the run without --domain', () => {
  const plain = runCli(['scenario', 'v1-all', '--json']);
  const shop = runCli(['scenario', 'v1-all', '--domain', 'shop', '--json']);
  expect(plain.status).toBe(0);
  expect(shop.status).toBe(0);
  const calls = JSON.parse(shop.stdout).calls as { args: { id?: string }; receipt: { verdict: string } }[];
  expect(calls).toHaveLength(10);
  // Every checked call verifies. The unknown-id fixture (p-0000) returns a tool error, which the
  // proxy reports as 'unverifiable' ("the tool returned an error"), as at ec241bc.
  for (const c of calls)
    expect(c.receipt.verdict, JSON.stringify(c.args)).toBe(
      c.args.id === 'p-0000' ? 'unverifiable' : 'verified',
    );
  expect(norm(shop.stdout)).toBe(norm(plain.stdout));
}, 180_000);

test('an unknown flag still exits non-zero for every legacy command', () => {
  for (const cmd of LEGACY) {
    const r = runCli([cmd, '--definitely-not-a-flag']);
    expect(r.status, cmd).not.toBe(0);
    expect(r.stderr, cmd).toMatch(/ERR_PARSE_ARGS_UNKNOWN_OPTION|Unknown option/);
  }
}, 300_000);
