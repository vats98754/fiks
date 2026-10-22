// Failure classifier for the LLM route. A subscription usage cap ("usage limit reached", a rejected
// rate_limit_event) is a `cap` event: never retried, it pauses a run until the reset (PLAN 8.1 A1
// cap-stop). It is kept distinct from a plain 429 (`rate_limit`) and 529 (`overload`), which are
// retried with backoff and count toward T0's 429/overload rate.

export type LlmFailure =
  | { kind: 'cap'; message: string; resetAt?: string; limitType?: string }
  | { kind: 'rate_limit'; message: string; status?: number }
  | { kind: 'overload'; message: string; status?: number }
  | { kind: 'server'; message: string; status?: number }
  | { kind: 'transport'; message: string }
  | { kind: 'auth'; message: string }
  | { kind: 'invalid_request'; message: string }
  | { kind: 'forbidden'; message: string }
  | { kind: 'unknown'; message: string };

export type LlmFailureKind = LlmFailure['kind'];

/** Kinds retried with backoff (PLAN 9.3: 3 retries); everything else is returned at once. */
export const RETRYABLE: ReadonlySet<LlmFailureKind> = new Set([
  'rate_limit',
  'overload',
  'server',
  'transport',
]);

const CAP_PATTERNS: RegExp[] = [
  /usage limit (reached|exceeded|hit)/i,
  /(you'?ve|you have) (hit|reached|used up) your(?: \w+){0,2} limit/i,
  /\b(5-hour|five[- ]hour|weekly|session|daily|opus|sonnet|monthly) (usage )?limit (reached|exceeded|hit)/i,
  /\blimit reached\b.*\breset/i,
  /\bout of (extra )?usage\b/i,
  /\bcredits_required\b/i,
  /\busage cap\b/i,
];

const RATE_LIMIT = [/\b429\b/, /rate_limit_error/i, /rate[ _-]?limit/i, /too many requests/i];
const OVERLOAD = [/\b529\b/, /overloaded/i];
const SERVER = [/\b50[0234]\b/, /\bapi_error\b/i, /internal server error/i, /server_error/i, /bad gateway/i];
const TRANSPORT = [
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR_/,
  /socket hang up/i,
  /fetch failed/i,
  /connection error/i,
  /network error/i,
  /timed? ?out/i,
  /aborted/i,
];
const AUTH = [
  /\b401\b/,
  /authentication_error/i,
  /authentication_failed/i,
  /invalid (x-api-key|api key|bearer)/i,
  /oauth token (has )?expired/i,
  /please run \/login/i,
  /oauth_org_not_allowed|account_on_hold|billing_error/i,
];
const INVALID = [
  /\b400\b/,
  /invalid_request/i,
  /model_not_found/i,
  /not_found_error/i,
  /prompt is too long/i,
];

const any = (res: RegExp[], s: string) => res.some((r) => r.test(s));

function textOf(x: unknown): string {
  if (typeof x === 'string') return x;
  if (x instanceof Error) {
    const cause = (x as { cause?: unknown }).cause;
    return cause ? `${x.message} (${textOf(cause)})` : x.message;
  }
  if (x && typeof x === 'object') {
    try {
      return JSON.stringify(x).slice(0, 4000);
    } catch {
      return String(x);
    }
  }
  return String(x);
}

/** Epoch seconds or milliseconds to ISO. */
function epochToIso(n: number): string {
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
}

/** Offset of `tz` from UTC at instant `t`, in ms (local = utc + offset). */
function tzOffsetMs(tz: string, t: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const local = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return local - Math.floor(t / 1000) * 1000;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Best-effort reset instant from cap text: `|<epoch>` (older CLIs), an ISO instant, or
 * "resets [Mon D,] 3pm|3:30pm|15:00 [(Area/City)]" (next such wall-clock time in that zone, UTC if none).
 */
export function parseResetAt(text: string, now: Date = new Date()): string | undefined {
  const epoch = /\|\s*(\d{10,13})\b/.exec(text) ?? /\breset(?:s|_at|sAt)?["':\s]+(\d{10,13})\b/i.exec(text);
  if (epoch?.[1]) return epochToIso(Number(epoch[1]));
  const iso = /\bresets?(?: at)?:?\s+(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2}))/i.exec(text);
  if (iso?.[1] && !Number.isNaN(Date.parse(iso[1]))) return new Date(iso[1]).toISOString();
  const wall =
    /\bresets?(?: at)?\s+(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([A-Za-z_]+(?:\/[A-Za-z_+-]+)+|UTC)\))?/i.exec(
      text,
    );
  if (!wall) return undefined;
  const [, mon, day, hh, mm, ampm, tzRaw] = wall;
  let hour = Number(hh);
  if (ampm) {
    if (hour < 1 || hour > 12) return undefined;
    hour = (hour % 12) + (ampm.toLowerCase() === 'pm' ? 12 : 0);
  } else if (mm === undefined) {
    return undefined; // a bare number is not a time
  }
  if (hour > 23) return undefined;
  const minute = Number(mm ?? 0);
  const tz = tzRaw ?? 'UTC';
  try {
    tzOffsetMs(tz, now.getTime());
  } catch {
    return undefined;
  }
  const localNow = new Date(now.getTime() + tzOffsetMs(tz, now.getTime()));
  let y = localNow.getUTCFullYear();
  let mo = localNow.getUTCMonth();
  let d = localNow.getUTCDate();
  if (mon && day) {
    mo = MONTHS.indexOf(mon.toLowerCase());
    d = Number(day);
  }
  const toInstant = (yy: number, mmo: number, dd: number) => {
    const guess = Date.UTC(yy, mmo, dd, hour, minute);
    return guess - tzOffsetMs(tz, guess - tzOffsetMs(tz, guess));
  };
  let t = toInstant(y, mo, d);
  if (t <= now.getTime()) {
    if (mon && day) {
      y += 1;
      t = toInstant(y, mo, d);
    } else {
      t = toInstant(y, mo, d + 1);
    }
  }
  return new Date(t).toISOString();
}

function capFrom(
  message: string,
  now: Date,
  extra: { resetAt?: string; limitType?: string } = {},
): LlmFailure {
  const resetAt = extra.resetAt ?? parseResetAt(message, now);
  return {
    kind: 'cap',
    message: message.slice(0, 500),
    ...(resetAt ? { resetAt } : {}),
    ...(extra.limitType ? { limitType: extra.limitType } : {}),
  };
}

function byStatus(status: number | null | undefined, message: string): LlmFailure | undefined {
  if (status === 429) return { kind: 'rate_limit', message, status };
  if (status === 529) return { kind: 'overload', message, status };
  if (status === 401 || status === 403) return { kind: 'auth', message };
  if (status !== null && status !== undefined && status >= 500) return { kind: 'server', message, status };
  if (status === 400 || status === 404 || status === 413) return { kind: 'invalid_request', message };
  return undefined;
}

/** SDKAssistantMessageError and similar error codes. */
function byCode(code: string, message: string): LlmFailure | undefined {
  switch (code) {
    case 'rate_limit':
      return { kind: 'rate_limit', message };
    case 'overloaded':
      return { kind: 'overload', message };
    case 'server_error':
      return { kind: 'server', message };
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
    case 'account_on_hold':
    case 'verification_required':
    case 'billing_error':
    case 'cloud_credential_error':
      return { kind: 'auth', message };
    case 'invalid_request':
    case 'model_not_found':
      return { kind: 'invalid_request', message };
    default:
      return undefined;
  }
}

/**
 * Classifies a thrown error, an error string, or an SDK message (rate_limit_event, api_retry,
 * assistant message with `error`, error result). Cap text wins over any 429 status, because the
 * subscription limit can arrive as a 429 whose text says "usage limit".
 */
export function classifyLlmFailure(x: unknown, now: Date = new Date()): LlmFailure {
  if (x && typeof x === 'object' && !(x instanceof Error)) {
    const m = x as Record<string, unknown>;
    if (m.type === 'rate_limit_event') {
      const info = (m.rate_limit_info ?? {}) as {
        status?: string;
        resetsAt?: number;
        rateLimitType?: string;
      };
      const msg = `rate_limit_event status=${info.status} type=${info.rateLimitType ?? '?'}`;
      if (info.status === 'rejected') {
        return capFrom(msg, now, {
          ...(info.resetsAt ? { resetAt: epochToIso(info.resetsAt) } : {}),
          ...(info.rateLimitType ? { limitType: info.rateLimitType } : {}),
        });
      }
      return { kind: 'unknown', message: msg };
    }
    if (m.type === 'system' && m.subtype === 'api_retry') {
      const msg = `api_retry status=${String(m.error_status)} error=${String(m.error)}`;
      return (
        byStatus(m.error_status as number | null, msg) ??
        byCode(String(m.error ?? ''), msg) ?? { kind: 'transport', message: msg }
      );
    }
    if (m.type === 'assistant' && typeof m.error === 'string') {
      const text = textOf((m.message as { content?: unknown } | undefined)?.content ?? '');
      if (any(CAP_PATTERNS, text)) return capFrom(text, now);
      return byCode(m.error, `${m.error}: ${text}`.slice(0, 500)) ?? classifyText(text, now);
    }
    if (m.type === 'result') {
      const text = [
        typeof m.result === 'string' ? m.result : '',
        ...(Array.isArray(m.errors) ? (m.errors as unknown[]).map(String) : []),
      ].join(' | ');
      if (any(CAP_PATTERNS, text)) return capFrom(text, now);
      return (
        byStatus(m.api_error_status as number | null, text) ?? classifyText(text || String(m.subtype), now)
      );
    }
  }
  if (x instanceof Error && x.name === 'LlmForbiddenError') return { kind: 'forbidden', message: x.message };
  const status = (x as { status?: unknown } | null)?.status;
  const text = textOf(x);
  if (any(CAP_PATTERNS, text)) return capFrom(text, now);
  return byStatus(typeof status === 'number' ? status : undefined, text) ?? classifyText(text, now);
}

function classifyText(text: string, now: Date): LlmFailure {
  const message = text.slice(0, 500);
  if (any(CAP_PATTERNS, text)) return capFrom(text, now);
  if (any(OVERLOAD, text)) return { kind: 'overload', message };
  if (any(RATE_LIMIT, text)) return { kind: 'rate_limit', message };
  if (any(AUTH, text)) return { kind: 'auth', message };
  if (any(SERVER, text)) return { kind: 'server', message };
  if (any(INVALID, text)) return { kind: 'invalid_request', message };
  if (any(TRANSPORT, text)) return { kind: 'transport', message };
  return { kind: 'unknown', message };
}

export function isCap(f: LlmFailure): f is Extract<LlmFailure, { kind: 'cap' }> {
  return f.kind === 'cap';
}
