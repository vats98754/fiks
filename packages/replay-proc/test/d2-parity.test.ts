// Acceptance: on the shop-mcp seed, process-level replay of the D2 trace (unmodified server
// process, VENDOR_BASE_URL override, MCP stdio) reports the same violated property as the
// shop-mcp in-process replay; 10 reruns give identical verdicts.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { replayRecordingProcess, verdictSummary } from '../src/index.ts';
import {
  D2_TARGET,
  d2Trace,
  extractShop,
  FIXED,
  inProcessReplay,
  SEED,
  type ShopCheckout,
  shopServer,
  vendoredContracts,
  vendoredEvaluate,
} from './support/shop.ts';

const T = 180_000;

describe('D2 trace on the unfixed seed', () => {
  let seed: ShopCheckout;
  beforeAll(() => {
    seed = extractShop(SEED);
  });
  afterAll(() => seed?.cleanup());

  const replay = async () =>
    replayRecordingProcess(d2Trace(), {
      server: shopServer(seed.dir),
      baseUrlEnv: 'VENDOR_BASE_URL',
      contracts: vendoredContracts(seed.dir),
      evaluate: await vendoredEvaluate(seed.dir),
    });

  test('process-level replay reports the same violated property as in-process replay', {
    timeout: T,
  }, async () => {
    const trace = d2Trace();
    expect(trace.target).toEqual([D2_TARGET]);
    const inproc = inProcessReplay(seed.dir, trace);
    const proc = await replay();
    expect(proc.unmatched).toEqual([]);
    expect(inproc.unmatched).toEqual([]);
    const inprocViolated = inproc.evaluation.violations.map((v) => v.propertyId).sort();
    expect(inprocViolated).toEqual([D2_TARGET]);
    expect(verdictSummary(proc)).toEqual(verdictSummary(inproc));
    // Same violation, field for field, as the in-process harness and as the trace at capture.
    expect(proc.evaluation.violations).toEqual(inproc.evaluation.violations);
    expect(proc.evaluation.violations).toEqual(trace.violated);
    expect(proc.served.map((e) => e.request.url)).toEqual(['/products/p-1001']);
  });

  test('the default evaluator (@fiks/contracts) agrees', { timeout: T }, async () => {
    const r = await replayRecordingProcess(d2Trace(), {
      server: shopServer(seed.dir),
      baseUrlEnv: 'VENDOR_BASE_URL',
      contracts: vendoredContracts(seed.dir),
    });
    expect(verdictSummary(r).violated).toEqual([D2_TARGET]);
  });

  test('10 reruns give identical verdicts', { timeout: 10 * T }, async () => {
    const runs = [];
    for (let i = 0; i < 10; i++) {
      const r = await replay();
      runs.push(
        JSON.stringify({ summary: verdictSummary(r), violations: r.evaluation.violations, result: r.result }),
      );
    }
    expect(new Set(runs).size).toBe(1);
    expect(JSON.parse(runs[0] as string).summary.violated).toEqual([D2_TARGET]);
  });
});

describe('D2 trace on the fixed shop-mcp (F on the seed, P on the fix)', () => {
  let fixed: ShopCheckout;
  beforeAll(() => {
    fixed = extractShop(FIXED);
  });
  afterAll(() => fixed?.cleanup());

  test('both replays verify', { timeout: T }, async () => {
    const trace = d2Trace();
    const inproc = inProcessReplay(fixed.dir, trace);
    const proc = await replayRecordingProcess(trace, {
      server: shopServer(fixed.dir),
      baseUrlEnv: 'VENDOR_BASE_URL',
      contracts: vendoredContracts(fixed.dir),
      evaluate: await vendoredEvaluate(fixed.dir),
    });
    expect(verdictSummary(inproc).verdict).toBe('verified');
    expect(verdictSummary(proc)).toEqual(verdictSummary(inproc));
  });
});
