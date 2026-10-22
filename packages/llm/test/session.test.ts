import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { agentSession, fakeQuery, LlmConfigError, WEB_TOOLS } from '../src/index.ts';

let saved: NodeJS.ProcessEnv;
beforeEach(() => {
  saved = { ...process.env };
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-oauth-token';
  process.env.GH_TOKEN = 'must-not-leak';
  delete process.env.FIKS_LLM_FORBID;
});
afterEach(() => {
  process.env = saved;
});

const readLines = (p: string) =>
  readFileSync(p, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe('agentSession()', () => {
  test('transcript shows settingSources: [], the given cwd and no web tools; env is scrubbed', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fiks-sess-'));
    const transcriptPath = join(cwd, '..', `${cwd.split('/').pop()}.jsonl`);
    const q = fakeQuery(() => ({ text: 'done', costUsd: 0.05, tokens: { in: 1000, out: 50 } }));
    const r = await agentSession({
      cwd,
      prompt: 'do it',
      model: 'claude-haiku-5-5',
      allowedTools: ['Read', 'Grep', 'mcp__shop__*'],
      budget: { maxTurns: 5, maxBudgetUsd: 1 },
      transcriptPath,
      deps: { query: q },
    });
    expect(r.ok).toBe(true);
    expect(r.costUsd).toBeCloseTo(0.05);
    const lines = readLines(transcriptPath);
    const header = lines[0] ?? {};
    expect(header.type).toBe('fiks_session_header');
    expect(header.settingSources).toEqual([]);
    expect(header.cwd).toBe(cwd);
    expect(header.webTools).toBe('excluded');
    expect(header.disallowedTools).toEqual([...WEB_TOOLS]);
    expect(header.allowedTools).toEqual(['Read', 'Grep', 'mcp__shop__*']);
    expect(header.envKeys).not.toContain('GH_TOKEN');
    expect(JSON.stringify(lines)).not.toContain('test-oauth-token');
    const init = lines.find((l) => l.type === 'system' && l.subtype === 'init');
    expect(init?.cwd).toBe(cwd);
    expect(init?.tools).toEqual(['Read', 'Grep']);
    expect(lines.at(-1)?.type).toBe('fiks_session_footer');

    const o = q.calls[0]?.options;
    expect(o?.settingSources).toEqual([]);
    expect(o?.tools).toEqual(['Read', 'Grep']);
    expect(o?.disallowedTools).toEqual(['WebFetch', 'WebSearch']);
    expect(o?.env?.GH_TOKEN).toBeUndefined();
    expect(o?.env?.HOME).not.toBe(process.env.HOME);
  });

  test('web tools are refused unless allowWebTools is set', async () => {
    const q = fakeQuery(() => ({}));
    const base = {
      cwd: tmpdir(),
      prompt: 'p',
      model: 'm',
      budget: { maxTurns: 1, maxBudgetUsd: 1 },
      deps: { query: q },
    };
    await expect(agentSession({ ...base, allowedTools: ['Read', 'WebFetch'] })).rejects.toBeInstanceOf(
      LlmConfigError,
    );
    expect(q.calls).toHaveLength(0);
    const r = await agentSession({ ...base, allowedTools: ['Read', 'WebFetch'], allowWebTools: true });
    expect(r.ok).toBe(true);
    expect(q.calls[0]?.options.disallowedTools).toEqual([]);
    expect(q.calls[0]?.options.tools).toEqual(['Read', 'WebFetch']);
  });

  test('a cap ends the session as outcome cap (no retry); infra before output is retried', async () => {
    const capQ = fakeQuery(() => ({ cap: { resetsAt: 1792929600 } }));
    const base = {
      cwd: tmpdir(),
      prompt: 'p',
      model: 'm',
      allowedTools: ['Read'],
      budget: { maxTurns: 1, maxBudgetUsd: 1 },
    };
    const c = await agentSession({ ...base, deps: { query: capQ, sleep: async () => {} } });
    expect(c.outcome).toBe('cap');
    expect(c.capEvents[0]).toMatchObject({ kind: 'cap', resetAt: '2026-10-25T12:00:00.000Z' });
    expect(capQ.calls).toHaveLength(1);

    let n = 0;
    const flaky = fakeQuery(() => (++n === 1 ? { throwError: 'socket hang up' } : { text: 'ok' }));
    const f = await agentSession({ ...base, deps: { query: flaky, sleep: async () => {} } });
    expect(f.outcome).toBe('ok');
    expect(f.attempts).toBe(2);

    // infra after model output is not retried: the worktree may have changed
    const late = fakeQuery(() => ({ apiErrorText: 'API Error: 500 api_error' }));
    const l = await agentSession({ ...base, deps: { query: late, sleep: async () => {} } });
    expect(l.outcome).toBe('infra_error');
    expect(late.calls).toHaveLength(1);

    const budget = fakeQuery(() => ({ errorSubtype: 'error_max_budget_usd' }));
    const b = await agentSession({ ...base, deps: { query: budget } });
    expect(b.outcome).toBe('model_error');
    expect(b.modelError).toBe('error_max_budget_usd');
  });

  test('a canUseTool hook disables auto-allow so every tool call goes through it', async () => {
    const q = fakeQuery(() => ({}));
    await agentSession({
      cwd: tmpdir(),
      prompt: 'p',
      model: 'm',
      allowedTools: ['Bash'],
      budget: { maxTurns: 1, maxBudgetUsd: 1 },
      canUseTool: async () => ({ behavior: 'deny', message: 'no' }),
      deps: { query: q },
    });
    expect(q.calls[0]?.options.allowedTools).toEqual([]);
    expect(q.calls[0]?.options.permissionMode).toBe('default');
    expect(q.calls[0]?.options.tools).toEqual(['Bash']);
  });
});
