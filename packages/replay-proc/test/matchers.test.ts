import type { HttpExchange } from '@fiks/contracts';
import { describe, expect, test } from 'vitest';
import {
  looksLikeTimestamp,
  type MatcherConfig,
  NONCE,
  normaliseRequest,
  replayServer,
  requestKey,
  strictRequestKey,
  TIMESTAMP,
  UNMATCHED_STATUS,
} from '../src/index.ts';

const req = (
  url: string,
  body: string | null = null,
  headers: Record<string, string> = {},
  method = 'GET',
) => ({
  method,
  url,
  body,
  headers,
});

describe('requestKey', () => {
  test('without config it is the shop-mcp strict key, byte for byte', () => {
    const headers = {
      accept: '*/*',
      'user-agent': 'node',
      'Idempotency-Key': 'k',
      'content-type': 'application/json',
    };
    const body = '{"items":[{"product_id":"p-1004","quantity":2}]}';
    // shop-mcp test/fiks/replay.ts requestKey(), as at seed-v1 and main.
    const shop = `POST /orders body=${body} headers=[content-type,idempotency-key]`;
    expect(strictRequestKey('POST', '/orders', body, headers)).toBe(shop);
    expect(requestKey(req('/orders', body, headers, 'POST')).key).toBe(shop);
    expect(requestKey(req('/products/p-1001')).key).toBe('GET /products/p-1001 body= headers=[]');
  });

  test('nonce: query and JSON body fields, recorded and live alike', () => {
    const cfg: MatcherConfig = {
      normalisers: [{ kind: 'nonce', query: ['nonce'], body: ['meta.request_id', 'items[*].key'] }],
    };
    const a = requestKey(
      req('/q?a=1&nonce=abc', '{"meta":{"request_id":"r1"},"items":[{"key":"x","n":1}]}'),
      cfg,
    );
    const b = requestKey(
      req('/q?a=1&nonce=zzz', '{"meta":{"request_id":"r2"},"items":[{"key":"y","n":1}]}'),
      cfg,
    );
    expect(a.key).toBe(b.key);
    expect(a.key).toContain(`nonce=${encodeURIComponent(NONCE)}`);
    // Other fields still matter.
    const c = requestKey(
      req('/q?a=2&nonce=abc', '{"meta":{"request_id":"r1"},"items":[{"key":"x","n":1}]}'),
      cfg,
    );
    expect(c.key).not.toBe(a.key);
    const d = requestKey(
      req('/q?a=1&nonce=abc', '{"meta":{"request_id":"r1"},"items":[{"key":"x","n":2}]}'),
      cfg,
    );
    expect(d.key).not.toBe(a.key);
  });

  test('nonce: form-encoded body fields', () => {
    const cfg: MatcherConfig = { normalisers: [{ kind: 'nonce', body: ['nonce'] }] };
    const a = requestKey(req('/t', 'grant_type=x&nonce=1', {}, 'POST'), cfg);
    const b = requestKey(req('/t', 'grant_type=x&nonce=2', {}, 'POST'), cfg);
    expect(a.key).toBe(b.key);
    expect(requestKey(req('/t', 'grant_type=y&nonce=2', {}, 'POST'), cfg).key).not.toBe(a.key);
  });

  test('timestamp: named fields and auto-detection', () => {
    expect(looksLikeTimestamp('2026-10-01T12:00:00.000Z')).toBe(true);
    expect(looksLikeTimestamp('2026-10-01')).toBe(true);
    expect(looksLikeTimestamp(1790856000000)).toBe(true);
    expect(looksLikeTimestamp('1790856000')).toBe(true);
    expect(looksLikeTimestamp('p-1001')).toBe(false);
    expect(looksLikeTimestamp(42)).toBe(false);
    const named: MatcherConfig = { normalisers: [{ kind: 'timestamp', query: ['ts'] }] };
    expect(requestKey(req('/a?ts=1'), named).key).toBe(requestKey(req('/a?ts=2'), named).key);
    const auto: MatcherConfig = { normalisers: [{ kind: 'timestamp', auto: true }] };
    const x = requestKey(req('/a?since=2026-10-01T00:00:00Z&q=x', '{"at":1790856000000,"n":3}'), auto);
    const y = requestKey(req('/a?since=2026-10-02T00:00:00Z&q=x', '{"at":1790856999999,"n":3}'), auto);
    expect(x.key).toBe(y.key);
    expect(x.key).toContain(encodeURIComponent(TIMESTAMP));
    expect(requestKey(req('/a?since=2026-10-01T00:00:00Z&q=y'), auto).key).not.toBe(
      requestKey(req('/a?since=2026-10-01T00:00:00Z&q=x'), auto).key,
    );
  });

  test('authRefresh: any body or query, reusable', () => {
    const cfg: MatcherConfig = {
      normalisers: [{ kind: 'authRefresh', path: '^/oauth/token$', method: 'POST' }],
    };
    const a = requestKey(req('/oauth/token', 'refresh_token=a', {}, 'POST'), cfg);
    const b = requestKey(req('/oauth/token?x=1', '{"refresh_token":"b"}', {}, 'POST'), cfg);
    expect(a).toEqual(b);
    expect(a.reusable).toBe(true);
    expect(requestKey(req('/oauth/token', null), cfg).reusable).toBe(false);
  });

  test('pattern, ignored headers and significant header values', () => {
    const cfg: MatcherConfig = {
      normalisers: [{ kind: 'pattern', in: 'url', pattern: '/v\\d+/', replace: '/vN/' }],
      ignoreHeaders: ['X-Request-Id'],
      headerValues: ['api-version'],
    };
    const a = requestKey(req('/v1/x', null, { 'x-request-id': '1', 'api-version': '2026-01-01' }), cfg);
    const b = requestKey(req('/v2/x', null, { 'X-Request-Id': '2', 'Api-Version': '2026-01-01' }), cfg);
    expect(a.key).toBe(b.key);
    const c = requestKey(req('/v2/x', null, { 'api-version': '2026-10-01' }), cfg);
    expect(c.key).not.toBe(a.key);
  });

  test('normalisation never mutates the request', () => {
    const r = req('/q?nonce=1', '{"id":"n"}');
    normaliseRequest(r, { normalisers: [{ kind: 'nonce', query: ['nonce'], body: ['id'] }] });
    expect(r).toEqual(req('/q?nonce=1', '{"id":"n"}'));
  });
});

const exchange = (seq: number, url: string, body: string): HttpExchange => ({
  seq,
  startedAt: '2026-10-01T00:00:00.000Z',
  durationMs: 1,
  request: { method: 'GET', url, headers: {}, body: null },
  response: { status: 200, headers: { 'content-type': 'application/json' }, body },
});

describe('replayServer', () => {
  test('a nonce-bearing request matches only after normalisation; each exchange answers once', async () => {
    const recorded = [exchange(0, '/q?nonce=recorded', '{"n":1}')];
    const strict = await replayServer(recorded);
    try {
      const r = await fetch(`${strict.url}/q?nonce=live`);
      expect(r.status).toBe(UNMATCHED_STATUS);
      expect(strict.unmatched).toEqual(['GET /q?nonce=live body= headers=[]']);
    } finally {
      await strict.close();
    }
    const norm = await replayServer(recorded, {
      matchers: { normalisers: [{ kind: 'nonce', query: ['nonce'] }] },
    });
    try {
      const r = await fetch(`${norm.url}/q?nonce=live`);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ n: 1 });
      expect(norm.unmatched).toEqual([]);
      expect((await fetch(`${norm.url}/q?nonce=again`)).status).toBe(UNMATCHED_STATUS);
      expect(norm.served.map((e) => e.seq)).toEqual([0]);
    } finally {
      await norm.close();
    }
  });

  test('identical requests are answered in recorded (seq) order', async () => {
    const s = await replayServer([exchange(1, '/p', '"second"'), exchange(0, '/p', '"first"')]);
    try {
      expect(await (await fetch(`${s.url}/p`)).json()).toBe('first');
      expect(await (await fetch(`${s.url}/p`)).json()).toBe('second');
    } finally {
      await s.close();
    }
  });

  test('accepts recordings: call exchanges, then probe exchanges', async () => {
    const s = await replayServer([
      {
        id: 'r',
        capturedAt: '2026-10-01T00:00:00.000Z',
        tool: 't',
        args: {},
        http: [exchange(0, '/a', '1')],
        probe: { tool: 'p', args: {}, http: [exchange(0, '/b', '2')] },
      },
    ]);
    try {
      expect(await (await fetch(`${s.url}/b`)).json()).toBe(2);
      expect(await (await fetch(`${s.url}/a`)).json()).toBe(1);
    } finally {
      await s.close();
    }
  });
});
