import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  complete,
  fakeQuery,
  type LlmCallLog,
  LlmCapError,
  LlmConfigError,
  LlmInfraError,
  LlmOutputError,
} from '../src/index.ts';

const noSleep = async () => {};
let saved: NodeJS.ProcessEnv;
beforeEach(() => {
  saved = { ...process.env };
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-oauth-token';
  process.env.GITHUB_TOKEN = 'must-not-leak';
  process.env.FIKS_LLM_FORBID = undefined;
  delete process.env.FIKS_LLM_FORBID;
});
afterEach(() => {
  process.env = saved;
});

describe('complete()', () => {
  test('routes through query with no tools, our system prompt, no settings, a scrubbed env, and parses JSON', async () => {
    const q = fakeQuery(() => ({ structured: { sum: 42 }, costUsd: 0.0123, tokens: { in: 321, out: 12 } }));
    const log = join(tmpdir(), `fiks-llm-test-${process.pid}-${Date.now()}.jsonl`);
    const r = await complete({
      model: 'claude-haiku-5-5',
      system: 'Answer in JSON.',
      prompt: 'sum?',
      schema: z.object({ sum: z.number() }),
      logPath: log,
      label: 't1',
      deps: { query: q, sleep: noSleep },
    });
    expect(r.data).toEqual({ sum: 42 });
    expect(r.costUsd).toBeCloseTo(0.0123);
    expect(r.tokens).toEqual({ in: 321, out: 12, cacheRead: 0, cacheCreate: 0 });
    expect(q.calls).toHaveLength(1);
    const o = q.calls[0]?.options;
    expect(o?.tools).toEqual([]);
    expect(o?.allowedTools).toEqual([]);
    expect(o?.settingSources).toEqual([]);
    expect(o?.systemPrompt).toBe('Answer in JSON.');
    expect(o?.mcpServers).toEqual({});
    expect(o?.strictMcpConfig).toBe(true);
    expect(o?.outputFormat?.type).toBe('json_schema');
    expect(o?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe('test-oauth-token');
    expect(o?.env?.GITHUB_TOKEN).toBeUndefined();
    expect(Object.keys(o?.env ?? {}).sort()).toEqual(
      [
        'CLAUDE_AGENT_SDK_CLIENT_APP',
        'CLAUDE_CODE_OAUTH_TOKEN',
        'DISABLE_AUTOUPDATER',
        'HOME',
        'PATH',
        'TMPDIR',
      ]
        .filter((k) => k !== 'PATH' || process.env.PATH)
        .concat(['LANG', 'LC_ALL', 'TZ'].filter((k) => process.env[k]))
        .sort(),
    );
    expect(o?.env?.HOME).not.toBe(process.env.HOME);
    const entry = JSON.parse(readFileSync(log, 'utf8').trim()) as LlmCallLog;
    expect(entry).toMatchObject({ fn: 'complete', outcome: 'ok', label: 't1', costUsd: 0.0123, attempts: 1 });
    // temp HOME and cwd are removed afterwards
    expect(existsSync(String(o?.env?.HOME))).toBe(false);
    expect(existsSync(String(o?.cwd))).toBe(false);
  });

  test('falls back to text JSON (fenced) when there is no structured output', async () => {
    const q = fakeQuery(() => ({ text: 'Here:\n```json\n{"capital":"Paris"}\n```' }));
    const r = await complete({
      model: 'm',
      system: 's',
      prompt: 'p',
      schema: { type: 'object', properties: { capital: { type: 'string' } }, required: ['capital'] },
      deps: { query: q },
    });
    expect(r.data).toEqual({ capital: 'Paris' });
  });

  test('schema mismatch is a model outcome (LlmOutputError), not retried', async () => {
    const q = fakeQuery(() => ({ text: '{"sum":"forty-two"}' }));
    await expect(
      complete({
        model: 'm',
        system: 's',
        prompt: 'p',
        schema: z.object({ sum: z.number() }),
        deps: { query: q },
      }),
    ).rejects.toBeInstanceOf(LlmOutputError);
    expect(q.calls).toHaveLength(1);
  });

  test('429 / overload / transport are retried 3 times, then infra_error', async () => {
    let n = 0;
    const flaky = fakeQuery(() =>
      ++n <= 2 ? { apiErrorText: 'API Error: 529 overloaded_error' } : { text: 'fine' },
    );
    const ok = await complete({
      model: 'm',
      system: 's',
      prompt: 'p',
      deps: { query: flaky, sleep: noSleep },
    });
    expect(ok.text).toBe('fine');
    expect(ok.attempts).toBe(3);

    const dead = fakeQuery(() => ({ throwError: 'fetch failed (ECONNRESET)' }));
    const err = await complete({
      model: 'm',
      system: 's',
      prompt: 'p',
      deps: { query: dead, sleep: noSleep },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmInfraError);
    expect((err as LlmInfraError).attempts).toBe(4);
    expect((err as LlmInfraError).failure.kind).toBe('transport');
    expect(dead.calls).toHaveLength(4);
  });

  test('a usage cap is never retried and surfaces as LlmCapError with resetAt', async () => {
    const q = fakeQuery(() => ({ cap: { resetsAt: 1792929600 } }));
    const err = await complete({
      model: 'm',
      system: 's',
      prompt: 'p',
      deps: { query: q, sleep: noSleep },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmCapError);
    expect((err as LlmCapError).failure.resetAt).toBe('2026-10-25T12:00:00.000Z');
    expect(q.calls).toHaveLength(1);
  });

  test('max turns is a model outcome', async () => {
    const q = fakeQuery(() => ({ errorSubtype: 'error_max_turns' }));
    await expect(
      complete({ model: 'm', system: 's', prompt: 'p', deps: { query: q } }),
    ).rejects.toBeInstanceOf(LlmOutputError);
    expect(q.calls).toHaveLength(1);
  });

  test('without an OAuth token the real route refuses before spawning anything', async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    await expect(complete({ model: 'm', system: 's', prompt: 'p' })).rejects.toBeInstanceOf(LlmConfigError);
  });
});
