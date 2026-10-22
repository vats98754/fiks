import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { assertDryOutAllowed, parseProbeArgs, runProbe } from '../src/probe.ts';
import { recommendConcurrency, type ThroughputLevel, ThroughputSchema } from '../src/throughput.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');
const PROBE = fileURLToPath(new URL('../src/probe.ts', import.meta.url));

describe('probe --dry', () => {
  test('writes a throughput.json that validates, incl. an ollama section, and leaves paper/results alone', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'fiks-probe-')), 'throughput.json');
    const before = spawnSync('git', ['-C', ROOT, 'status', '--porcelain', 'paper/results'], {
      encoding: 'utf8',
    }).stdout;
    const r = spawnSync(
      TSX,
      [PROBE, '--concurrency', '1,2,4', '--repair-workers', '1,2,4,6', '--dry', '--out', out],
      { encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: '' } },
    );
    expect(r.status, r.stderr).toBe(0);
    const report = ThroughputSchema.parse(JSON.parse(readFileSync(out, 'utf8')));
    expect(report.dry).toBe(true);
    expect(report.authoring.levels.map((l) => l.concurrency)).toEqual([1, 2, 4]);
    expect(report.repairWorkers?.levels.map((l) => l.concurrency)).toEqual([1, 2, 4, 6]);
    expect(report.ollama.status).toBe('measured');
    expect(report.ollama.tokensPerSec?.aggregate).toBeGreaterThan(0);
    for (const l of report.authoring.levels) {
      expect(l.ok).toBe(l.sessions);
      expect(l.attemptsPerHour).toBeGreaterThan(0);
      expect(l.spawnOverheadMs.n).toBe(l.sessions);
    }
    // the dry fake injects one 429 retry in every 5th session
    const total429 = report.authoring.levels.reduce((s, l) => s + l.rateLimitEvents, 0);
    expect(total429).toBeGreaterThan(0);
    const after = spawnSync('git', ['-C', ROOT, 'status', '--porcelain', 'paper/results'], {
      encoding: 'utf8',
    }).stdout;
    expect(after).toBe(before);
  }, 60_000);

  test('--dry refuses an --out under paper/results', () => {
    expect(() => assertDryOutAllowed(join(ROOT, 'paper/results/raw/throughput.json'))).toThrow(
      /run outputs only/,
    );
    expect(() => assertDryOutAllowed(join(tmpdir(), 'x.json'))).not.toThrow();
    const r = spawnSync(TSX, [PROBE, '--dry', '--out', join(ROOT, 'paper/results/raw/throughput.json')], {
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(existsSync(join(ROOT, 'paper/results/raw/throughput.json'))).toBe(false);
  }, 30_000);

  test('a cap event stops the probe and is recorded; recommended concurrency excludes capped levels', async () => {
    const { fakeQuery, fakeOllamaFetch } = await import('../src/fake.ts');
    const a = parseProbeArgs([
      '--concurrency',
      '1,2',
      '--dry',
      '--out',
      '/dev/null',
      '--sessions-per-level',
      '3',
    ]);
    const report = await runProbe(a, {
      query: fakeQuery((i) => (i === 4 ? { cap: { resetsAt: 1792929600 } } : { text: 'done' })),
      fetch: fakeOllamaFetch({ model: 'none', digest: 'none' }),
      sleep: async () => {},
    });
    expect(report.capStopped?.resetAt).toBe('2026-10-25T12:00:00.000Z');
    expect(report.capEventsTotal).toBe(1);
    expect(report.authoring.levels[0]?.caps).toBe(0);
    expect(report.authoring.levels[1]?.caps).toBe(1);
    expect(report.recommendedConcurrency).toBe(1);
    // ollama readiness fails on the digest mismatch, so the section says why it was skipped
    expect(report.ollama.status).toBe('skipped');
    expect(report.ollama.reason).toMatch(/not pulled|digest/);
  });
});

describe('recommendConcurrency (T0 rule)', () => {
  const lvl = (concurrency: number, rate: number, caps = 0): ThroughputLevel => ({
    concurrency,
    sessions: 10,
    ok: 10,
    modelErrors: 0,
    infraErrors: 0,
    caps,
    notRun: 0,
    wallMs: 1,
    attemptsPerHour: 1,
    rateLimitEvents: 0,
    overloadEvents: 0,
    sessionsWith429OrOverload: 0,
    rateLimitOverloadRate: rate,
    capEvents: [],
    spawnOverheadMs: { n: 0, meanMs: null, medianMs: null, p90Ms: null },
    costUsd: 0,
    tokens: { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 },
  });
  test('largest c with < 2% 429/overload and no cap', () => {
    expect(recommendConcurrency([lvl(1, 0), lvl(2, 0.01), lvl(4, 0.1)])).toBe(2);
    expect(recommendConcurrency([lvl(1, 0), lvl(2, 0), lvl(4, 0, 1)])).toBe(2);
    expect(recommendConcurrency([lvl(1, 0.02)])).toBeNull();
  });
});
