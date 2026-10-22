import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  connectStdioMcp,
  fakeOllamaFetch,
  LlmInfraError,
  ollamaBaseUrl,
  ollamaChat,
  ollamaConfig,
  ollamaReadiness,
  ollamaToolLoop,
} from '../src/index.ts';

const SERVER = fileURLToPath(new URL('../src/fixtures/calc-mcp.mjs', import.meta.url));

describe('ollama client', () => {
  test('the approved model is pinned by name and digest', () => {
    const c = ollamaConfig();
    expect(c.model).toMatch(/^[a-z0-9.]+:[a-z0-9.-]+$/);
    expect(c.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  test('OLLAMA_HOST handling', () => {
    expect(ollamaBaseUrl({})).toBe('http://127.0.0.1:11434');
    expect(ollamaBaseUrl({ OLLAMA_HOST: '0.0.0.0:9999' })).toBe('http://0.0.0.0:9999');
  });

  test('OpenAI-compatible chat: body, usage and tokens/s', async () => {
    let seen: { model?: string; response_format?: unknown } = {};
    const f = fakeOllamaFetch({
      model: 'm:1',
      digest: 'd',
      completionTokens: 40,
      latencyMs: 20,
      reply: (b) => {
        seen = b as typeof seen;
        return { content: '{"sum":42}' };
      },
    });
    const r = await ollamaChat({
      model: 'm:1',
      messages: [{ role: 'user', content: 'x' }],
      responseFormat: 'json_object',
      deps: { fetch: f },
    });
    expect(f.calls[0]).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(seen.model).toBe('m:1');
    expect(seen.response_format).toEqual({ type: 'json_object' });
    expect(JSON.parse(r.message.content ?? '')).toEqual({ sum: 42 });
    expect(r.completionTokens).toBe(40);
    expect(r.tokensPerSec).toBeGreaterThan(0);
  });

  test('HTTP 503 is retried, then infra_error', async () => {
    let n = 0;
    const f = (async () => {
      n++;
      return new Response('busy', { status: 503 });
    }) as unknown as typeof fetch;
    const err = await ollamaChat({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      deps: { fetch: f, sleep: async () => {} },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmInfraError);
    expect(n).toBe(4);
  });

  test('readiness explains why it would skip', async () => {
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect((await ollamaReadiness({ fetch: down })).reason).toMatch(/not reachable/);
    const other = fakeOllamaFetch({ model: 'other:1', digest: 'x' });
    expect((await ollamaReadiness({ fetch: other })).reason).toMatch(/not pulled/);
    const c = ollamaConfig();
    const wrongDigest = fakeOllamaFetch({ model: c.model ?? '', digest: 'f'.repeat(64) });
    expect((await ollamaReadiness({ fetch: wrongDigest })).reason).toMatch(/!= pinned/);
    const ok = fakeOllamaFetch({ model: c.model ?? '', digest: c.digest ?? '' });
    expect(await ollamaReadiness({ fetch: ok })).toMatchObject({ ready: true });
  });

  test('minimal MCP tool loop against a real stdio MCP server', async () => {
    const f = fakeOllamaFetch({
      model: 'm',
      digest: 'd',
      reply: (b) => {
        const last = b.messages.at(-1);
        if (last?.role === 'tool') return { content: `The sum is ${last.content}.` };
        expect(b.tools).toHaveLength(1);
        return {
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 'add', arguments: '{"a":1234,"b":4321}' } },
          ],
        };
      },
    });
    const mcp = await connectStdioMcp({ command: process.execPath, args: [SERVER] });
    try {
      const r = await ollamaToolLoop({ mcp, prompt: '1234+4321?', model: 'm', deps: { fetch: f } });
      expect(r.stoppedBy).toBe('answer');
      expect(r.turns).toBe(2);
      expect(r.calls).toEqual([
        { name: 'add', args: { a: 1234, b: 4321 }, ok: true, result: [{ type: 'text', text: '5555' }] },
      ]);
      expect(r.answer).toBe('The sum is 5555.');
    } finally {
      await mcp.close?.();
    }
  }, 20_000);
});
