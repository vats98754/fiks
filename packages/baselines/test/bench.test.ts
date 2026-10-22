// BASE acceptance on the logged bench traffic (bench/results), the pinned oasdiff, and the
// no-proxy-import rule. oasdiff must be installed (node packages/baselines/scripts/ensure-oasdiff.mjs);
// FIKS_SKIP_OASDIFF=1 skips only the oasdiff tests, loudly.
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SHOP_CONTRACTS } from '@fiks/contracts';
import { createVendor } from '@fiks/vendor-api';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  type BenchCheckReport,
  checkBench,
  createLlmcMonitor,
  OASDIFF_VERSION,
  oasdiffDocs,
  oasdiffPath,
  oasdiffVersion,
} from '../src/index.ts';
import { RESULTS, ROOT, TOOL_DEFS } from './helpers.ts';

const OPENAPI = JSON.parse(readFileSync(join(ROOT, 'packages/vendor-api/openapi.json'), 'utf8'));
const fires = (r: BenchCheckReport, id: string, groups: string[]) =>
  groups.reduce((s, g) => s + (r.tallies[id]?.[g]?.fires ?? 0), 0);

describe('baselines on the logged D1-D5 bench CallRecords', () => {
  afterEach(() => vi.useRealTimers());

  test('acceptance verdicts, and 20 replays (one under a +400-day clock) give identical verdicts', async () => {
    const llmc = createLlmcMonitor({ label: 'standin-shop-hand', contracts: SHOP_CONTRACTS });
    const report = await checkBench({
      resultsDir: RESULTS,
      toolDefs: TOOL_DEFS,
      openapi: OPENAPI,
      trigFacts: { specDiff: { findings: 0 } },
      replays: 19,
      extraMonitors: [llmc],
    });
    // Inputs: two v1 runs, two v2 runs, one fixed run, all with proxy logs.
    expect(report.runs.map((r) => r.phase)).toEqual(['A_v1', 'A_v1', 'B_v2', 'B_v2', 'C_v2_fixed']);
    for (const d of ['D1', 'D2', 'D3', 'D4', 'D5'])
      expect(report.tallies['B-SNAP']?.[d]?.calls, d).toBeGreaterThan(0);

    expect(fires(report, 'B-SNAP', ['D1'])).toBe(report.tallies['B-SNAP']?.D1?.calls);
    expect(fires(report, 'B-SCHEMA', ['D2'])).toBe(0);
    expect(fires(report, 'B-AJV', ['M7'])).toBe(1);
    expect(fires(report, 'B-SCHEMA', ['M7'])).toBe(1);
    expect(fires(report, 'B-TRIG', ['D1', 'D2', 'D3', 'D4', 'D5'])).toBe(0);
    // No baseline fires on v1 traffic or on the fixed server; B-SNAP is quiet on fixed v2 output.
    for (const id of ['B-SCHEMA', 'B-AJV', 'B-SNAP', 'B-TRIG'])
      expect(fires(report, id, ['v1', 'fixed']), id).toBe(0);

    expect(Object.keys(report.determinism)).toContain('B-LLMC:standin-shop-hand');
    for (const [id, d] of Object.entries(report.determinism)) expect(d.distinctHashes, id).toBe(1);

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 400 * 86_400_000 });
    const shifted = await checkBench({
      resultsDir: RESULTS,
      toolDefs: TOOL_DEFS,
      openapi: OPENAPI,
      trigFacts: { specDiff: { findings: 0 } },
      replays: 1,
      extraMonitors: [llmc],
    });
    vi.useRealTimers();
    for (const [id, d] of Object.entries(report.determinism))
      expect(shifted.determinism[id]?.sha256, id).toBe(d.sha256);
  }, 120_000);

  test('calls-to-first-detection is reported per windowed detector and drift', async () => {
    const report = await checkBench({ resultsDir: RESULTS, toolDefs: TOOL_DEFS, replays: 1 });
    expect(Object.keys(report.firstDetection).sort()).toEqual([
      'B-STAT:aegis:w20',
      'B-STAT:aegis:w50',
      'B-STAT:evidently:w20',
      'B-STAT:evidently:w50',
    ]);
    for (const fd of Object.values(report.firstDetection))
      expect(Object.keys(fd)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5']);
  }, 60_000);
});

async function servedSpec(version: 'v1' | 'v2'): Promise<unknown> {
  const vendor = createVendor({ version });
  const url = await vendor.listen(0);
  try {
    return await (await fetch(`${url}/openapi.json`)).json();
  } finally {
    await vendor.close();
  }
}

const skipOasdiff = process.env.FIKS_SKIP_OASDIFF === '1';
if (skipOasdiff) console.warn('[baselines] FIKS_SKIP_OASDIFF=1: oasdiff tests skipped');

describe.skipIf(skipOasdiff)(`pinned oasdiff ${OASDIFF_VERSION}`, () => {
  test('is installed at the pinned version', () => {
    expect(existsSync(oasdiffPath()), `run node packages/baselines/scripts/ensure-oasdiff.mjs`).toBe(true);
    expect(oasdiffVersion()).toBe(OASDIFF_VERSION);
  });
  test('reports 0 findings on the shop vendor spec served at v1 vs v2', async () => {
    const r = oasdiffDocs(await servedSpec('v1'), await servedSpec('v2'));
    expect(r).toEqual({ version: OASDIFF_VERSION, breaking: 0, changelog: 0, findings: 0 });
  });
  test('counts findings when the spec does change', () => {
    const changed = structuredClone(OPENAPI);
    changed.components.schemas.Product.properties.price = { type: 'string' };
    const r = oasdiffDocs(OPENAPI, changed);
    expect(r.breaking).toBeGreaterThan(0);
    expect(r.findings).toBeGreaterThan(0);
  });
  test('refuses a binary that is not the pinned version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fiks-fake-oasdiff-'));
    const fake = join(dir, 'oasdiff');
    writeFileSync(fake, '#!/bin/sh\necho "oasdiff version 1.10.0"\n');
    chmodSync(fake, 0o755);
    expect(() => oasdiffVersion(fake)).toThrow(/expected 1\.33\.0/);
  });
});

test('no file under packages/baselines/src imports @fiks/proxy', () => {
  const dir = join(ROOT, 'packages/baselines/src');
  const offenders = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => /\.(ts|js|mjs)$/.test(f))
    .filter((f) =>
      /from\s+['"]@fiks\/proxy|import\(\s*['"]@fiks\/proxy|require\(\s*['"]@fiks\/proxy/.test(
        readFileSync(join(dir, f), 'utf8'),
      ),
    );
  expect(offenders).toEqual([]);
});
