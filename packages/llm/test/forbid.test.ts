import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The real SDK query is mocked: under FIKS_LLM_FORBID=1 it must never be called.
const sdkQuery = vi.fn(() => {
  throw new Error('query must not be called');
});
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: sdkQuery }));

const { agentSession, complete, LlmForbiddenError, ollamaChat, ollamaReadiness, ollamaToolLoop } =
  await import('../src/index.ts');
const { runProbe } = await import('../src/probe.ts');

let saved: NodeJS.ProcessEnv;
const fetchSpy = vi.fn(async () => new Response('{}'));
beforeEach(() => {
  saved = { ...process.env };
  process.env.FIKS_LLM_FORBID = '1';
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-oauth-token';
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  process.env = saved;
  vi.unstubAllGlobals();
});

describe('FIKS_LLM_FORBID=1', () => {
  test('complete(), agentSession() and the ollama client throw LlmForbiddenError; nothing is called', async () => {
    await expect(complete({ model: 'claude-haiku-5-5', system: 's', prompt: 'p' })).rejects.toBeInstanceOf(
      LlmForbiddenError,
    );
    await expect(
      agentSession({
        cwd: tmpdir(),
        prompt: 'p',
        model: 'claude-haiku-5-5',
        allowedTools: ['Read'],
        budget: { maxTurns: 1, maxBudgetUsd: 1 },
      }),
    ).rejects.toBeInstanceOf(LlmForbiddenError);
    await expect(ollamaChat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toBeInstanceOf(
      LlmForbiddenError,
    );
    await expect(
      ollamaToolLoop({
        prompt: 'hi',
        mcp: {
          listTools: async () => {
            throw new Error('listTools must not be called');
          },
          callTool: async () => ({}),
        },
      }),
    ).rejects.toBeInstanceOf(LlmForbiddenError);
    await expect(ollamaReadiness()).rejects.toBeInstanceOf(LlmForbiddenError);
    await expect(
      runProbe({
        concurrency: [1],
        repairWorkers: null,
        ollama: true,
        dry: false,
        out: '/dev/null',
        sessionsPerLevel: 1,
        authoringModel: 'm',
        repairModel: 'm',
        ollamaCalls: 1,
      }),
    ).rejects.toBeInstanceOf(LlmForbiddenError);
    expect(sdkQuery).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('injected (mocked) queries are refused too', async () => {
    const q = vi.fn();
    await expect(
      complete({ model: 'm', system: 's', prompt: 'p', deps: { query: q } }),
    ).rejects.toBeInstanceOf(LlmForbiddenError);
    expect(q).not.toHaveBeenCalled();
  });

  test('without the flag the mocked SDK query is the route complete() uses', async () => {
    delete process.env.FIKS_LLM_FORBID;
    sdkQuery.mockImplementationOnce((() => {
      throw new Error('mock reached');
    }) as never);
    await expect(complete({ model: 'm', system: 's', prompt: 'p', retries: 0 })).rejects.toThrow(
      /mock reached/,
    );
    expect(sdkQuery).toHaveBeenCalledTimes(1);
  });
});
