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
/** A script `{ msgs, thenThrow }` yields `msgs`, then throws mid-stream. */
function fakeQuery(scripts: (Msg[] | Error | { msgs: Msg[]; thenThrow: Error })[]) {
  const calls: { prompt: unknown; options: Record<string, unknown> }[] = [];
  const q = (args: { prompt: unknown; options: Record<string, unknown> }) => {
    calls.push(args);
    const s = scripts[calls.length - 1] ?? new Error('no script');
    return (async function* () {
      if (s instanceof Error) throw s;
      for (const m of Array.isArray(s) ? s : s.msgs) yield m;
      if (!Array.isArray(s)) throw s.thenThrow;
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

  test('retries share one budget: failed tries come off the caps, and turns are summed', async () => {
    const limited = (turns: number, cost: number): Msg[] => [
      { type: 'assistant', session_id: 's1', error: 'rate_limit', message: { content: [] } },
      {
        ...sdkResult,
        session_id: 's1',
        is_error: true,
        api_error_status: 429,
        result: 'API Error: 429',
        num_turns: turns,
        total_cost_usd: cost,
      },
    ];
    const ok = { ...sdkResult, session_id: 's1', num_turns: 5, total_cost_usd: 1 };
    const caps = (calls: { options: Record<string, unknown> }[]) => ({
      maxTurns: calls.map((c) => c.options.maxTurns),
      maxBudgetUsd: calls.map((c) => c.options.maxBudgetUsd),
    });
    const run = (q: typeof query) =>
      createAgentSdkRunner({ query: q, sleep: async () => {}, env: {} }).run(
        job(repo(), { maxTurns: 20, maxBudgetUsd: 5 }),
        signal,
      );

    // The finding's repro: two 429 tries of 12 turns / $3 each, then a 5-turn / $1 success; caps 20 / $5.
    const a = fakeQuery([limited(12, 3), limited(12, 3), [ok]]);
    const ra = await run(a.q);
    expect(caps(a.calls)).toEqual({ maxTurns: [20, 8], maxBudgetUsd: [5, 2] });
    expect(a.calls).toHaveLength(2); // both caps ran out after try 2: no third try
    expect(ra).toMatchObject({
      ok: false,
      outcome: 'max_turns',
      turns: 24,
      sessionTurns: 24,
      costUsd: 6,
      tries: 2,
    });

    // Cost alone running out stops with max_budget.
    const b = fakeQuery([limited(1, 3), limited(1, 2.5), [ok]]);
    const rb = await run(b.q);
    expect(caps(b.calls)).toEqual({ maxTurns: [20, 19], maxBudgetUsd: [5, 2] });
    expect(b.calls).toHaveLength(2);
    expect(rb).toMatchObject({ ok: false, outcome: 'max_budget', turns: 2, costUsd: 5.5, tries: 2 });

    // Within the caps the third try gets what is left; turns and sessionTurns sum over tries.
    const c = fakeQuery([limited(12, 1), limited(3, 1), [ok]]);
    const rc = await run(c.q);
    expect(caps(c.calls)).toEqual({ maxTurns: [20, 8, 5], maxBudgetUsd: [5, 4, 3] });
    expect(rc).toMatchObject({
      ok: true,
      outcome: 'completed',
      turns: 20,
      sessionTurns: 20,
      costUsd: 3,
      tries: 3,
    });

    // A try that throws mid-stream (no result) still spends the replies it was seen to make.
    const d = fakeQuery([
      {
        msgs: [
          { type: 'assistant', session_id: 's1', message: { id: 'm1', content: [] } },
          { type: 'assistant', session_id: 's1', message: { id: 'm1', content: [] } },
          { type: 'assistant', session_id: 's1', message: { id: 'm2', content: [] } },
        ],
        thenThrow: http429(),
      },
      [ok],
    ]);
    const rd = await run(d.q);
    expect(caps(d.calls)).toEqual({ maxTurns: [20, 18], maxBudgetUsd: [5, 5] });
    expect(rd).toMatchObject({ ok: true, outcome: 'completed', turns: 7, sessionTurns: 7, tries: 2 });
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

  test('query options carry a PreToolUse guard hook; strict Read/cat of a fixture is denied there', async () => {
    // Claude Code auto-allows in-cwd Read/Glob/Grep and read-only Bash before canUseTool, so the
    // guard must also run as a PreToolUse hook (which runs before those auto-allows).
    const wt = repo();
    mkdirSync(join(wt, 'test/fixtures/v1'), { recursive: true });
    writeFileSync(join(wt, 'test/fixtures/v1/a.json'), '{"price":1999,"note":"vendor bytes"}');
    const { q, calls } = fakeQuery([[sdkResult]]);
    const r = await createAgentSdkRunner({ query: q, env: {} }).run(
      job(wt, { traceFormat: 'strict' }),
      signal,
    );
    expect(r.outcome).toBe('completed');
    const opts = calls[0]?.options as Parameters<typeof query>[0]['options'] & object;
    expect(opts.permissionMode).toBe('default');
    expect(typeof opts.canUseTool).toBe('function');
    const matchers = opts.hooks?.PreToolUse ?? [];
    expect(matchers).toHaveLength(1);
    expect(matchers[0]?.matcher).toBeUndefined(); // every tool, not a subset
    const [hook] = matchers[0]?.hooks ?? [];
    if (!hook) throw new Error('no PreToolUse hook');
    let n = 0;
    const pre = (tool_name: string, tool_input: Record<string, unknown>) => {
      const id = `toolu_${++n}`;
      return hook(
        {
          hook_event_name: 'PreToolUse',
          tool_name,
          tool_input,
          tool_use_id: id,
          session_id: 's',
          transcript_path: '',
          cwd: wt,
        },
        id,
        { signal },
      );
    };
    const decision = (o: unknown) =>
      (o as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision;
    for (const file_path of ['test/fixtures/v1/a.json', join(wt, 'test/fixtures/v1/a.json')]) {
      expect(decision(await pre('Read', { file_path }))).toBe('deny');
    }
    expect(decision(await pre('Bash', { command: 'cat test/fixtures/v1/a.json' }))).toBe('deny');
    expect(decision(await pre('Bash', { command: 'grep -r price test/fixtures' }))).toBe('deny');
    expect(decision(await pre('Grep', { pattern: 'price', path: 'test/fixtures' }))).toBe('deny');
    expect(decision(await pre('Read', { file_path: 'src/a.ts' }))).toBe('allow');
    expect(r.denials).toHaveLength(5);
  });

  test('the hook relays allow-listed Bash through the backend once, even if canUseTool is asked too', async () => {
    const wt = repo();
    const ran: string[][] = [];
    const backend: ExecBackend = {
      async exec(cmd, args) {
        ran.push([cmd, ...args]);
        return { code: 1, stdout: '1 failed', stderr: '' };
      },
      async cleanup() {},
    };
    const { q, calls } = fakeQuery([[sdkResult]]);
    await createAgentSdkRunner({ query: q, env: {} }).run(job(wt, { backend }), signal);
    const opts = calls[0]?.options as Parameters<typeof query>[0]['options'] & object;
    const hook = opts.hooks?.PreToolUse?.[0]?.hooks[0];
    if (!hook || !opts.canUseTool) throw new Error('guard not wired');
    const out = (await hook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'pnpm test' },
        tool_use_id: 'toolu_x',
        session_id: 's',
        transcript_path: '',
        cwd: wt,
      },
      'toolu_x',
      { signal },
    )) as { hookSpecificOutput?: { permissionDecision?: string; updatedInput?: { command?: string } } };
    expect(out.hookSpecificOutput?.permissionDecision).toBe('allow');
    expect(out.hookSpecificOutput?.updatedInput?.command).toMatch(/^cat \S+; exit 1$/);
    // the backstop for the same tool_use_id reuses the hook's decision instead of re-running
    const again = await opts.canUseTool(
      'Bash',
      { command: 'pnpm test' },
      { signal, toolUseID: 'toolu_x', requestId: 'r1' },
    );
    expect(again).toEqual({ behavior: 'allow', updatedInput: out.hookSpecificOutput?.updatedInput });
    expect(ran).toEqual([['pnpm', 'test']]);
    // read-only Bash that Claude Code would auto-allow is denied in raw mode too
    const cat = await opts.canUseTool(
      'Bash',
      { command: 'cat src/a.ts' },
      { signal, toolUseID: 'toolu_y', requestId: 'r2' },
    );
    expect(cat?.behavior).toBe('deny');
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
