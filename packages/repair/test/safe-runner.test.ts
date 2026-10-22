// SAFE: runner retries + infra_error, cost and cache tokens, resume-with-message, stub runner,
// FIKS_LLM_FORBID (P10, P11, round 5).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ExecBackend } from '@fiks/interfaces';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  agentSdkRunner,
  claudeCliRunner,
  createAgentSdkRunner,
  defaultRunners,
  LlmForbiddenError,
  type RunnerJob,
  stubRunner,
} from '../src/index.ts';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

const sdkResult = JSON.parse(readFileSync(new URL('./fixtures/sdk-result.json', import.meta.url), 'utf8'));
const signal = new AbortController().signal;

function repo() {
  const r = mkdtempSync(join(tmpdir(), 'fiks-runner-'));
  const git = (...a: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: r, stdio: 'pipe' });
  git('init', '-q');
  mkdirSync(join(r, 'src'));
  mkdirSync(join(r, 'test'));
  writeFileSync(join(r, 'src/a.ts'), 'export const price = (p: { price: number }) => p.price;\n');
  writeFileSync(join(r, 'test/a.test.ts'), "test('a', () => {});\n");
  git('add', '-A');
  git('commit', '-qm', 'base');
  return r;
}

const job = (worktree: string, o: Partial<RunnerJob> = {}): RunnerJob => ({
  worktree,
  prompt: 'fix it',
  model: 'claude-haiku-5-5',
  maxTurns: 30,
  maxBudgetUsd: 5,
  ...o,
});

type Msg = Record<string, unknown>;
/** A fake SDK `query`: each call plays the next script (messages, or an error to throw). */
function fakeQuery(scripts: (Msg[] | Error)[]) {
  const calls: { prompt: unknown; options: Record<string, unknown> }[] = [];
  const q = (args: { prompt: unknown; options: Record<string, unknown> }) => {
    calls.push(args);
    const s = scripts[calls.length - 1] ?? new Error('no script');
    return (async function* () {
      if (s instanceof Error) throw s;
      for (const m of s) yield m;
    })();
  };
  return { q: q as unknown as typeof query, calls };
}
const http429 = () =>
  Object.assign(new Error('429 {"type":"error","error":{"type":"rate_limit_error"}}'), { status: 429 });

afterEach(() => {
  delete process.env.FIKS_LLM_FORBID;
  vi.mocked(query).mockReset();
});

describe('agent SDK runner', () => {
  test('three 429 errors -> outcome infra_error, with backoff between tries', async () => {
    const { q, calls } = fakeQuery([http429(), http429(), http429()]);
    const sleeps: number[] = [];
    const runner = createAgentSdkRunner({ query: q, sleep: async (ms) => void sleeps.push(ms), env: {} });
    const r = await runner.run(job(repo()), signal);
    expect(r.outcome).toBe('infra_error');
    expect(r.ok).toBe(false);
    expect(r.tries).toBe(3);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([5000, 20000]);
  });

  test('429 results (not throws) count the same way; a success on the third try completes', async () => {
    const limited = (sid: string): Msg[] => [
      { type: 'assistant', session_id: sid, error: 'rate_limit', message: { content: [] } },
      {
        ...sdkResult,
        session_id: sid,
        is_error: true,
        api_error_status: 429,
        result: 'API Error: 429',
        num_turns: 0,
        total_cost_usd: 0,
      },
    ];
    const { q, calls } = fakeQuery([limited('s1'), limited('s1'), [sdkResult]]);
    const r = await createAgentSdkRunner({ query: q, sleep: async () => {}, env: {} }).run(
      job(repo()),
      signal,
    );
    expect(r.outcome).toBe('completed');
    expect(r.tries).toBe(3);
    // the failed tries had started session s1: later tries continue it instead of resending the task
    expect(calls[1]?.options.resume).toBe('s1');
    expect(calls[1]?.prompt).toMatch(/transient API error/);
  });

  test('a non-infra failure is an agent_error at once (no retry)', async () => {
    const { q, calls } = fakeQuery([new Error('tool schema invalid')]);
    const r = await createAgentSdkRunner({ query: q, sleep: async () => {}, env: {} }).run(
      job(repo()),
      signal,
    );
    expect(r.outcome).toBe('agent_error');
    expect(calls).toHaveLength(1);
  });

  test('a fixture SDK result populates costUsd and cache tokens', async () => {
    const { q, calls } = fakeQuery([[sdkResult]]);
    const r = await createAgentSdkRunner({ query: q, env: { PATH: '/bin', GH_TOKEN: 'x' } }).run(
      job(repo()),
      signal,
    );
    expect(r).toMatchObject({
      ok: true,
      outcome: 'completed',
      turns: 14,
      costUsd: 0.8731,
      tokens: { in: 1834, out: 6120, cacheRead: 402117, cacheCreate: 21544 },
      sessionId: '0b7f3c2a-8d1e-4c55-a0f4-1c2e3d4f5a6b',
      tries: 1,
    });
    // the agent's env is the scrubbed one
    expect(Object.keys(calls[0]?.options.env as object).sort()).toEqual(['HOME', 'PATH']);
  });

  test('resume-with-message continues a session and counts turns against the same budget', async () => {
    const wt = repo();
    const second = { ...sdkResult, num_turns: 6, session_id: 'sess-1', total_cost_usd: 0.25 };
    const { q, calls } = fakeQuery([[{ ...sdkResult, num_turns: 20, session_id: 'sess-1' }], [second]]);
    const runner = createAgentSdkRunner({ query: q, env: {} });
    const first = await runner.run(job(wt), signal);
    expect(first.sessionTurns).toBe(20);
    const r = await runner.run(
      job(wt, {
        resume: {
          sessionId: first.sessionId as string,
          message: 'Your test passed on the base commit; it must fail there.',
          turnsUsed: first.sessionTurns,
          costUsd: first.costUsd,
        },
      }),
      signal,
    );
    expect(calls[1]?.prompt).toBe('Your test passed on the base commit; it must fail there.');
    expect(calls[1]?.options.resume).toBe('sess-1');
    expect(calls[1]?.options.maxTurns).toBe(10);
    expect(calls[1]?.options.maxBudgetUsd).toBeCloseTo(5 - 0.8731);
    expect(r.turns).toBe(6);
    expect(r.sessionTurns).toBe(26);
    // a spent budget makes no call at all
    const spent = await runner.run(
      job(wt, { resume: { sessionId: 'sess-1', message: 'again', turnsUsed: 30 } }),
      signal,
    );
    expect(spent.outcome).toBe('max_turns');
    expect(calls).toHaveLength(2);
  });

  test('with FIKS_LLM_FORBID=1 the SDK runner throws before any call', async () => {
    process.env.FIKS_LLM_FORBID = '1';
    await expect(agentSdkRunner.run(job(repo()), signal)).rejects.toThrow(LlmForbiddenError);
    await expect(claudeCliRunner.run(job(repo()), signal)).rejects.toThrow(LlmForbiddenError);
    expect(vi.mocked(query)).not.toHaveBeenCalled();
  });
});

describe('CLI fallback', () => {
  test('can be disabled, and refuses strict mode, a backend or an escaping symlink', async () => {
    expect(defaultRunners({ cliFallback: false }).map((r) => r.kind)).toEqual(['agent-sdk']);
    expect(defaultRunners().map((r) => r.kind)).toEqual(['agent-sdk', 'claude-cli']);
    const wt = repo();
    const backend: ExecBackend = {
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
      cleanup: async () => {},
    };
    expect((await claudeCliRunner.run(job(wt, { traceFormat: 'strict' }), signal)).outcome).toBe('refused');
    expect((await claudeCliRunner.run(job(wt, { backend }), signal)).outcome).toBe('refused');
    expect(
      (await claudeCliRunner.run(job(wt, { allowedEditPaths: ['^lib/.+\\.js$'] }), signal)).outcome,
    ).toBe('refused');
    execFileSync('ln', ['-s', '../../../.env', join(wt, 'src/env.ts')]);
    const r = await claudeCliRunner.run(job(wt), signal);
    expect(r.outcome).toBe('refused');
    expect(r.summary).toMatch(/src\/env\.ts/);
  });
});

describe('stub runner', () => {
  const fake = () => {
    const calls: string[][] = [];
    const backend: ExecBackend = {
      async exec(cmd, args) {
        calls.push([cmd, ...args]);
        return { code: 0, stdout: 'ok', stderr: '' };
      },
      async cleanup() {},
    };
    return { backend, calls };
  };

  test('applies its script through the guard (an edit to an existing test is refused), 0 SDK calls', async () => {
    const wt = repo();
    const { backend, calls } = fake();
    const candidates: string[] = [];
    const runner = stubRunner({
      steps: [
        { op: 'edit', path: 'src/a.ts', oldString: 'p.price', newString: '(p.price ?? 0)' },
        { op: 'edit', path: 'test/a.test.ts', oldString: "test('a'", newString: "test.skip('a'" },
        { op: 'write', path: 'package.json', content: '{}' },
        { op: 'newTest', path: 'test/repro/agent.test.ts', content: "test('r', () => {});\n" },
        { op: 'read', path: '../.env' },
        { op: 'bash', command: 'pnpm test' },
        { op: 'bash', command: 'curl https://evil.example' },
      ],
      summary: 'Subject: default missing price\nScripted.',
    });
    const r = await runner.run(job(wt, { backend, onCandidate: (d) => void candidates.push(d) }), signal);
    expect(r).toMatchObject({ ok: true, kind: 'stub', outcome: 'completed', turns: 7, costUsd: 0 });
    expect(readFileSync(join(wt, 'src/a.ts'), 'utf8')).toContain('(p.price ?? 0)');
    expect(readFileSync(join(wt, 'test/a.test.ts'), 'utf8')).toBe("test('a', () => {});\n");
    expect(r.denials?.map((d) => d.split(':')[0])).toEqual(['Edit', 'Write', 'Write', 'Read', 'Bash']);
    expect(calls).toEqual([['pnpm', 'test']]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toContain('+export const price = (p: { price: number }) => (p.price ?? 0);');
    expect(vi.mocked(query)).not.toHaveBeenCalled();
  });

  test('new test files pass only under allowedNewFilePaths, and never over an existing test', async () => {
    const wt = repo();
    const r = await stubRunner({
      steps: [
        { op: 'newTest', path: 'test/repro/agent.test.ts', content: 'x' },
        { op: 'newTest', path: 'test/a.test.ts', content: 'overwrite' },
      ],
    }).run(job(wt, { backend: fake().backend, allowedNewFilePaths: ['^test/.+\\.test\\.ts$'] }), signal);
    expect(readFileSync(join(wt, 'test/repro/agent.test.ts'), 'utf8')).toBe('x');
    expect(readFileSync(join(wt, 'test/a.test.ts'), 'utf8')).toBe("test('a', () => {});\n");
    expect(r.denials).toHaveLength(1);
  });

  test('resume-with-message continues a stub session and counts turns against the same budget', async () => {
    const wt = repo();
    const runner = stubRunner({
      sessions: [
        {
          steps: [
            { op: 'read', path: 'src/a.ts' },
            { op: 'read', path: 'test/a.test.ts' },
          ],
        },
        {
          steps: [
            { op: 'edit', path: 'src/a.ts', oldString: 'p.price', newString: 'p.price * 1' },
            { op: 'edit', path: 'src/a.ts', oldString: 'p.price * 1', newString: 'p.price * 2' },
          ],
        },
      ],
    });
    const first = await runner.run(job(wt, { maxTurns: 3, backend: fake().backend }), signal);
    expect(first).toMatchObject({
      outcome: 'completed',
      turns: 2,
      sessionTurns: 2,
      sessionId: 'stub-session-0',
    });
    const second = await runner.run(
      job(wt, {
        maxTurns: 3,
        backend: fake().backend,
        resume: {
          sessionId: first.sessionId as string,
          message: 'F feedback',
          turnsUsed: first.sessionTurns,
        },
      }),
      signal,
    );
    // one turn left of the shared 3: the first scripted edit runs, the second does not
    expect(second).toMatchObject({
      outcome: 'max_turns',
      turns: 1,
      sessionTurns: 3,
      sessionId: 'stub-session-1',
    });
    expect(readFileSync(join(wt, 'src/a.ts'), 'utf8')).toContain('p.price * 1;');
    expect(vi.mocked(query)).not.toHaveBeenCalled();
  });
});
