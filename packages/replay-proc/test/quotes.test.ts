// Process-level replay of a server whose requests carry nonces, timestamps and an OAuth token
// fetch, over plain HTTP, an HTTPS base URL and the HTTPS shim for a hard-coded host.
import type { ContractFile, HttpExchange, Recording } from '@fiks/contracts';
import { describe, expect, test } from 'vitest';
import {
  CLOCK_SKEW_MS,
  type MatcherConfig,
  type ProcessReplayOptions,
  replayRecordingProcess,
  verdictSummary,
} from '../src/index.ts';

const SERVER = ['node', new URL('./fixtures/quotes-server.mjs', import.meta.url).pathname];
const T = 60_000;

const CONTRACTS: ContractFile = {
  server: 'quotes',
  version: 1,
  contracts: [
    {
      id: 'quotes.get_quote',
      tool: 'get_quote',
      invariants: [
        { id: 'price.range', kind: 'range', path: 'price', min: 0, max: 100_000 },
        { id: 'as_of.freshness', kind: 'freshness', path: 'as_of', maxAgeDays: 1 },
      ],
    },
  ],
};

const MATCHERS: MatcherConfig = {
  normalisers: [
    { kind: 'authRefresh', path: '^/oauth/token$', method: 'POST' },
    { kind: 'nonce', query: ['nonce'] },
    { kind: 'timestamp', query: ['ts'] },
  ],
};

const ex = (seq: number, request: HttpExchange['request'], body: unknown): HttpExchange => ({
  seq,
  startedAt: '2026-10-01T12:00:00.000Z',
  durationMs: 3,
  request,
  response: { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
});

/** As recorded: the nonces, request id and timestamp are the capture's, never repeated live. */
function quoteRecording(price: number): Recording {
  return {
    id: 'q1',
    capturedAt: '2026-10-01T12:00:00.000Z',
    tool: 'get_quote',
    args: { symbol: 'ACME' },
    http: [
      ex(
        0,
        {
          method: 'POST',
          url: '/oauth/token',
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'node' },
          body: 'grant_type=client_credentials&client_id=fiks-test&nonce=6c1f0e1e-0000-4000-8000-000000000001',
        },
        { access_token: 'tok-recorded', expires_in: 3600 },
      ),
      ex(
        1,
        {
          method: 'GET',
          url: '/quotes/ACME?nonce=0b7a7f2e-0000-4000-8000-000000000002&ts=1790856000000',
          headers: { authorization: 'Bearer tok-recorded', 'x-request-id': 'req-recorded', accept: '*/*' },
          body: null,
        },
        { symbol: 'ACME', price, as_of: '2026-10-01T11:59:00.000Z' },
      ),
    ],
  };
}

const base = (extra: Partial<ProcessReplayOptions> = {}): ProcessReplayOptions => ({
  server: SERVER,
  contracts: CONTRACTS,
  baseUrlEnv: 'QUOTES_BASE_URL',
  matchers: MATCHERS,
  ...extra,
});

describe('nonce-bearing requests', () => {
  test('strict matching (no normalisers) leaves them unmatched', { timeout: T }, async () => {
    const r = await replayRecordingProcess(quoteRecording(42), base({ matchers: {} }));
    expect(r.unmatched.length).toBeGreaterThan(0);
    expect(r.unmatched[0]).toMatch(/^POST \/oauth\/token body=grant_type=client_credentials/);
    expect(r.result.isError).toBe(true);
    expect(r.evaluation.verdict).toBe('unverifiable');
  });

  test('match after normalisation and evaluate the contract', { timeout: T }, async () => {
    const ok = await replayRecordingProcess(quoteRecording(42), base());
    expect(ok.unmatched).toEqual([]);
    expect(ok.served.map((e) => e.seq)).toEqual([0, 1]);
    expect(verdictSummary(ok)).toEqual({
      verdict: 'verified',
      violated: [],
      checked: [
        'quotes.get_quote/as_of.freshness',
        'quotes.get_quote/outputSchema',
        'quotes.get_quote/price.range',
      ],
      unmatched: 0,
    });
    const bad = await replayRecordingProcess(quoteRecording(-5), base());
    expect(verdictSummary(bad).violated).toEqual(['quotes.get_quote/price.range']);
  });

  test('10 reruns give identical verdicts', { timeout: 10 * T }, async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const r = await replayRecordingProcess(quoteRecording(-5), base());
      seen.add(JSON.stringify([verdictSummary(r), r.evaluation.violations, r.result]));
    }
    expect(seen.size).toBe(1);
  });
});

describe('HTTPS', () => {
  test('base-URL mode: the replay serves TLS on 127.0.0.1 with a throwaway CA', { timeout: T }, async () => {
    const r = await replayRecordingProcess(quoteRecording(42), base({ upstream: { mode: 'https' } }));
    expect(r.unmatched).toEqual([]);
    expect(r.evaluation.verdict).toBe('verified');
  });

  test('proxy mode: a hard-coded https host is intercepted, any other host is refused', {
    timeout: T,
  }, async () => {
    const opts = base({ baseUrlEnv: undefined, upstream: { mode: 'proxy', hosts: ['api.quotes.example'] } });
    const r = await replayRecordingProcess(quoteRecording(-5), opts);
    expect(r.unmatched).toEqual([]);
    expect(r.served).toHaveLength(2);
    expect(verdictSummary(r).violated).toEqual(['quotes.get_quote/price.range']);

    const other: Recording = {
      id: 'o1',
      capturedAt: '2026-10-01T12:00:00.000Z',
      tool: 'reach_other',
      args: {},
      http: [],
    };
    const denied = await replayRecordingProcess(other, opts);
    expect(denied.denied).toEqual(['other.example:443']);
    expect(denied.served).toEqual([]);
    expect(denied.result.isError).toBe(true);
  });
});

describe('server clock', () => {
  const clock: Recording = {
    id: 'c1',
    capturedAt: '2026-10-01T12:00:00.000Z',
    tool: 'clock',
    args: {},
    http: [],
  };
  const now = async (mode: ProcessReplayOptions['clock']) =>
    (await replayRecordingProcess(clock, base({ clock: mode }))).result.structuredContent?.now;

  test('skew (default) freezes Date at capturedAt + 10 years, like the in-process harness', {
    timeout: T,
  }, async () => {
    expect(await now(undefined)).toBe(new Date(Date.parse(clock.capturedAt) + CLOCK_SKEW_MS).toISOString());
    expect(await now('capture')).toBe(clock.capturedAt);
    const real = Date.parse(String(await now('real')));
    expect(Math.abs(real - Date.now())).toBeLessThan(60_000);
  });
});
