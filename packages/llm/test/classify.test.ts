import { describe, expect, test } from 'vitest';
import { classifyLlmFailure, parseResetAt, RETRYABLE } from '../src/index.ts';

const NOW = new Date('2026-10-21T12:00:00Z');

describe('cap classifier', () => {
  test('a usage-limit message is a cap event, a plain 429 is a rate limit', () => {
    const cap = classifyLlmFailure(new Error('Claude AI usage limit reached|1792929600'), NOW);
    expect(cap).toMatchObject({ kind: 'cap', resetAt: '2026-10-25T12:00:00.000Z' });

    const r429 = classifyLlmFailure(
      Object.assign(
        new Error('429 {"type":"error","error":{"type":"rate_limit_error","message":"rate limited"}}'),
        {
          status: 429,
        },
      ),
      NOW,
    );
    expect(r429.kind).toBe('rate_limit');
    expect(RETRYABLE.has(r429.kind)).toBe(true);
    expect(RETRYABLE.has(cap.kind)).toBe(false);
  });

  test('cap text wins even when the HTTP status is 429', () => {
    const f = classifyLlmFailure(
      Object.assign(new Error("You've hit your limit · resets 3pm (America/Los_Angeles)"), { status: 429 }),
      NOW,
    );
    expect(f.kind).toBe('cap');
    // 2026-10-21 12:00Z = 05:00 PDT; next 3pm PDT = 22:00Z the same day
    expect(f).toMatchObject({ resetAt: '2026-10-21T22:00:00.000Z' });
  });

  test.each([
    ['5-hour limit reached ∙ resets 9:30pm', 'cap'],
    ['Weekly limit reached, resets Oct 23, 4pm (UTC)', 'cap'],
    ['Opus limit reached', 'cap'],
    ['529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', 'overload'],
    ['Too Many Requests', 'rate_limit'],
    ['API Error: 500 {"type":"api_error"}', 'server'],
    ['fetch failed (ECONNRESET)', 'transport'],
    ['OAuth token has expired. Please run /login', 'auth'],
    ['400 invalid_request_error: prompt is too long', 'invalid_request'],
  ])('%s -> %s', (text, kind) => {
    expect(classifyLlmFailure(new Error(text), NOW).kind).toBe(kind);
  });

  test('a rejected rate_limit_event is a cap with its reset instant; an allowed one is not', () => {
    const rejected = classifyLlmFailure(
      {
        type: 'rate_limit_event',
        rate_limit_info: { status: 'rejected', resetsAt: 1792929600, rateLimitType: 'seven_day' },
      },
      NOW,
    );
    expect(rejected).toMatchObject({
      kind: 'cap',
      resetAt: '2026-10-25T12:00:00.000Z',
      limitType: 'seven_day',
    });
    const allowed = classifyLlmFailure(
      { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', utilization: 0.9 } },
      NOW,
    );
    expect(allowed.kind).not.toBe('cap');
  });

  test('api_retry events: 429 is rate_limit, 529 is overload, null status is transport', () => {
    const m = (error_status: number | null, error: string) => ({
      type: 'system',
      subtype: 'api_retry',
      error_status,
      error,
    });
    expect(classifyLlmFailure(m(429, 'rate_limit')).kind).toBe('rate_limit');
    expect(classifyLlmFailure(m(529, 'overloaded')).kind).toBe('overload');
    expect(classifyLlmFailure(m(503, 'server_error')).kind).toBe('server');
    expect(classifyLlmFailure(m(null, 'unknown')).kind).toBe('transport');
  });

  test('assistant error message carrying the usage-limit text is a cap; with rate_limit code only, a 429', () => {
    const cap = classifyLlmFailure(
      {
        type: 'assistant',
        error: 'rate_limit',
        message: {
          content: [{ type: 'text', text: 'Claude usage limit reached. Your limit will reset at 5pm.' }],
        },
      },
      NOW,
    );
    expect(cap.kind).toBe('cap');
    const plain = classifyLlmFailure(
      {
        type: 'assistant',
        error: 'rate_limit',
        message: { content: [{ type: 'text', text: 'API Error: 429' }] },
      },
      NOW,
    );
    expect(plain.kind).toBe('rate_limit');
  });

  test('error results: usage limit -> cap; api_error_status 529 -> overload', () => {
    expect(
      classifyLlmFailure({
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: 'Claude AI usage limit reached|1792929600',
      }).kind,
    ).toBe('cap');
    expect(
      classifyLlmFailure({
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: 'API Error',
        api_error_status: 529,
      }).kind,
    ).toBe('overload');
  });
});

describe('parseResetAt', () => {
  test('epoch seconds and milliseconds, ISO, wall clock with zone, and none', () => {
    expect(parseResetAt('limit|1792929600')).toBe('2026-10-25T12:00:00.000Z');
    expect(parseResetAt('limit|1792929600000')).toBe('2026-10-25T12:00:00.000Z');
    expect(parseResetAt('resets at 2026-10-22T08:00:00Z')).toBe('2026-10-22T08:00:00.000Z');
    expect(parseResetAt('resets 11am (Europe/Berlin)', NOW)).toBe('2026-10-22T09:00:00.000Z');
    expect(parseResetAt('resets 15:30', NOW)).toBe('2026-10-21T15:30:00.000Z');
    expect(parseResetAt('usage limit reached', NOW)).toBeUndefined();
  });
});
