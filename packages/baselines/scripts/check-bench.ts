// BASE acceptance on the logged bench runs: every deterministic baseline over the D1-D5
// CallRecords in bench/results, plus the pinned oasdiff on the vendor's served v1 vs v2 spec.
//
// usage: pnpm tsx packages/baselines/scripts/check-bench.ts [--results bench/results] [--replays 20] [--out <file>]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { SHOP_CONTRACTS } from '@fiks/contracts';
import type { MonitorToolDef } from '@fiks/interfaces';
import { createVendor } from '@fiks/vendor-api';
import { checkBench, createLlmcMonitor, oasdiffDocs } from '../src/index.ts';

const root = resolve(new URL('../../..', import.meta.url).pathname);
const { values } = parseArgs({
  options: {
    results: { type: 'string', default: join(root, 'bench/results') },
    replays: { type: 'string', default: '20' },
    out: { type: 'string' },
  },
});

async function servedSpec(version: 'v1' | 'v2'): Promise<unknown> {
  const vendor = createVendor({ version });
  const url = await vendor.listen(0);
  try {
    const res = await fetch(`${url}/openapi.json`);
    return await res.json();
  } finally {
    await vendor.close();
  }
}

const fixture = JSON.parse(
  readFileSync(join(root, 'packages/baselines/fixtures/shop-tools.seed-v1.json'), 'utf8'),
) as { source: { commit: string }; tools: MonitorToolDef[] };
const toolDefs = Object.fromEntries(fixture.tools.map((t) => [t.name, t]));
const [specV1, specV2] = [await servedSpec('v1'), await servedSpec('v2')];
const specDiff = oasdiffDocs(specV1, specV2);
const report = await checkBench({
  resultsDir: resolve(values.results as string),
  toolDefs,
  openapi: specV1,
  trigFacts: { specDiff },
  replays: Number(values.replays),
  // No LLM-authored contract exists before A0 (BLIND); the B-LLMC runner is exercised on the hand
  // contracts, labelled as a stand-in.
  extraMonitors: [createLlmcMonitor({ label: 'standin-shop-hand', contracts: SHOP_CONTRACTS })],
});

const t = report.tallies;
const fires = (id: string, groups: string[]) => groups.reduce((s, g) => s + (t[id]?.[g]?.fires ?? 0), 0);
const acceptance = {
  'B-SNAP flags D1': fires('B-SNAP', ['D1']) > 0,
  'B-SCHEMA does not flag D2': fires('B-SCHEMA', ['D2']) === 0,
  'B-AJV flags the M7 string-price fixture': fires('B-AJV', ['M7']) > 0,
  'B-TRIG fires 0 times on D1-D5': fires('B-TRIG', ['D1', 'D2', 'D3', 'D4', 'D5']) === 0,
  'oasdiff 0 findings on shop v1 vs v2 spec': specDiff.findings === 0,
  'every deterministic baseline identical over all replays': Object.values(report.determinism).every(
    (d) => d.distinctHashes === 1,
  ),
};
const out = { toolDefsCommit: fixture.source.commit, specDiff, ...report, acceptance };
const text = `${JSON.stringify(out, null, 2)}\n`;
if (values.out) writeFileSync(values.out, text);
process.stdout.write(text);
process.exit(Object.values(acceptance).every(Boolean) ? 0 : 1);
