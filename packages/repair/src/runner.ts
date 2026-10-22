import { spawnSync } from 'node:child_process';
import {
  type HookCallbackMatcher,
  type HookEvent,
  type CanUseTool as SdkCanUseTool,
  query as sdkQuery,
} from '@anthropic-ai/claude-agent-sdk';
import type { AllowedEditPaths, ExecBackend, TokenUsage, TraceFormat } from '@fiks/interfaces';
import { assertLlmAllowed, claudeEnv, type OnCandidate } from './env.ts';
import { DEFAULT_ALLOWED_EDIT_PATHS, escapingSymlinks } from './guard.ts';
import { type CanUseTool, makeCanUseTool, type ToolDecision } from './permissions.ts';

export type RunnerKind = 'agent-sdk' | 'claude-cli' | 'oracle' | 'oracle-broken' | 'stub';

/**
 * How a runner call ended. `infra_error` (rate limits, overload, 5xx, network, auth) is never a
 * model failure (P10, PLAN 9.3); `refused` = the runner would not start under these options.
 */
export type RunnerOutcome =
  | 'completed'
  | 'agent_error'
  | 'max_turns'
  | 'max_budget'
  | 'infra_error'
  | 'refused';

export interface RunnerResume {
  /** Session to continue (the previous result's `sessionId`). */
  sessionId: string;
  /** The user message that continues it (e.g. REPRO-AGENT's fixed F feedback). */
  message: string;
  /** Turns and cost already spent in this session: the budget is shared, not reset. */
  turnsUsed?: number;
  costUsd?: number;
}

export interface RunnerJob {
  worktree: string;
  prompt: string;
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
  /** Default `raw`. */
  traceFormat?: TraceFormat;
  /** Edit guard (Domain.allowedEditPaths); default `^src/.+\.ts$`. */
  allowedEditPaths?: AllowedEditPaths;
  /** Create-only paths (e.g. an agent-written test); default none. */
  allowedNewFilePaths?: AllowedEditPaths;
  /** Run allow-listed Bash through this backend (P1). Unset = host Bash, unchanged. */
  backend?: ExecBackend;
  /** Candidate capture at every gate invocation (P11). */
  onCandidate?: OnCandidate;
  /** Continue an earlier session with a message instead of starting from `prompt`. */
  resume?: RunnerResume;
}

export interface RunnerResult {
  ok: boolean;
  kind: RunnerKind;
  /** Turns in this call. */
  turns?: number;
  /** Cost of this call (all tries). */
  costUsd?: number;
  summary: string;
  log: string;
  outcome?: RunnerOutcome;
  sessionId?: string;
  tokens?: TokenUsage;
  /** API tries made (1 when the first one got through). */
  tries?: number;
  /** Turns used by the session so far, incl. `resume.turnsUsed`. */
  sessionTurns?: number;
  /** Tool calls the guard refused, as `tool: message`. */
  denials?: string[];
}

export interface RepairRunner {
  kind: RunnerKind;
  run(job: RunnerJob, signal: AbortSignal): Promise<RunnerResult>;
}

export const zeroTokens = (): TokenUsage => ({ in: 0, out: 0, cacheRead: 0, cacheCreate: 0 });
const addTokens = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  in: a.in + b.in,
  out: a.out + b.out,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheCreate: a.cacheCreate + b.cacheCreate,
});

/** Token usage from an SDK result's `usage` (Messages API field names). */
export function tokensOf(usage: unknown): TokenUsage {
  const u = (usage ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof u[k] === 'number' ? (u[k] as number) : 0);
  return {
    in: n('input_tokens'),
    out: n('output_tokens'),
    cacheRead: n('cache_read_input_tokens'),
    cacheCreate: n('cache_creation_input_tokens'),
  };
}

const INFRA_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const RETRYABLE_KINDS = new Set(['rate_limit', 'overloaded', 'server_error']);
const FATAL_INFRA_KINDS = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'verification_required',
  'billing_error',
  'cloud_credential_error',
]);
const INFRA_TEXT =
  /\b(429|5\d\d|rate[ _-]?limit(ed)?|overloaded|too many requests|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network error|fetch failed)\b/i;

export interface FailureInfo {
  status?: number | null;
  kind?: string;
  message?: string;
}

/** Classifies a failure: `retry` (transient infra), `fatal` (infra, not retryable) or `model`. */
export function classifyFailure(f: FailureInfo): 'retry' | 'fatal' | 'model' {
  if (f.kind && FATAL_INFRA_KINDS.has(f.kind)) return 'fatal';
  if (f.kind && RETRYABLE_KINDS.has(f.kind)) return 'retry';
  if (typeof f.status === 'number' && INFRA_STATUS.has(f.status)) return 'retry';
  if (f.status === 401 || f.status === 403) return 'fatal';
  if (f.message && INFRA_TEXT.test(f.message)) return 'retry';
  return 'model';
}

/** Sent when a try failed after its session started: the work so far stays in the worktree. */
export const RETRY_MESSAGE =
  'The previous request failed with a transient API error. Continue the task where you left off.';

export interface SdkToolGuard {
  hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  canUseTool: SdkCanUseTool;
}

/**
 * Wires the tool policy into the SDK twice. `canUseTool` alone is not enough: Claude Code
 * auto-allows Read/Glob/Grep inside the working directory and read-only Bash (`cat`, `grep`, ...)
 * in `default` mode before it ever asks `canUseTool`, which would bypass the strict quarantine
 * (P3), the Bash allow-list and the backend rewrite (P1). A PreToolUse hook runs before those
 * auto-allows, so the guard decides there for every tool: deny, or allow with the guard's
 * (possibly rewritten) input. `canUseTool` stays as a backstop for a call the hook did not settle
 * (e.g. a hook timeout). Decisions are memoised per tool_use_id, so a call reaching both runs the
 * guard, and hence a backend command and its candidate capture, once.
 */
export function sdkToolGuard(
  guard: CanUseTool,
  opts: { onDeny?: (tool: string, message: string) => void; hookTimeoutSec?: number } = {},
): SdkToolGuard {
  const decided = new Map<string, Promise<ToolDecision>>();
  const decide = (tool: string, input: Record<string, unknown>, id: string | undefined) => {
    const hit = id ? decided.get(id) : undefined;
    if (hit) return hit;
    const p = guard(tool, input).then((d) => {
      if (d.behavior === 'deny') opts.onDeny?.(tool, d.message);
      return d;
    });
    if (id) decided.set(id, p);
    return p;
  };
  return {
    hooks: {
      PreToolUse: [
        {
          // No matcher: every tool goes through the guard (unknown tools are denied there).
          timeout: opts.hookTimeoutSec ?? 16 * 60, // a backend `pnpm test` may run for minutes
          hooks: [
            async (input, toolUseID) => {
              if (input.hook_event_name !== 'PreToolUse') return {};
              const toolInput =
                input.tool_input && typeof input.tool_input === 'object'
                  ? (input.tool_input as Record<string, unknown>)
                  : {};
              const d = await decide(input.tool_name, toolInput, input.tool_use_id ?? toolUseID);
              return {
                hookSpecificOutput:
                  d.behavior === 'deny'
                    ? {
                        hookEventName: 'PreToolUse',
                        permissionDecision: 'deny',
                        permissionDecisionReason: d.message,
                      }
                    : {
                        hookEventName: 'PreToolUse',
                        permissionDecision: 'allow',
                        permissionDecisionReason: 'fiks repair guard',
                        updatedInput: d.updatedInput,
                      },
              };
            },
          ],
        },
      ],
    },
    canUseTool: (tool, input, options) => decide(tool, input, options?.toolUseID),
  };
}

export interface AgentSdkRunnerOptions {
  /** The SDK `query` (tests inject a fake). */
  query?: typeof sdkQuery;
  /** Tries per call, incl. the first (default 3). */
  maxTries?: number;
  /** Backoff before try n+1 is `backoffMs * 4^(n-1)` (default 5 s, so 5 s then 20 s). */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Env source for `claudeEnv` and FIKS_LLM_FORBID (default process.env). */
  env?: NodeJS.ProcessEnv;
}

/**
 * Claude Agent SDK runner: Claude Code in the worktree, every tool call through `makeCanUseTool`
 * via a PreToolUse hook plus `canUseTool` (`sdkToolGuard`; edit guard, realpath read guard, Bash allow-list, optional exec backend), env = OAuth token +
 * PATH + temp HOME. Transient API failures are retried with backoff; when the tries run out the
 * outcome is `infra_error`. Refuses to start under FIKS_LLM_FORBID=1.
 */
export function createAgentSdkRunner(o: AgentSdkRunnerOptions = {}): RepairRunner {
  const maxTries = o.maxTries ?? 3;
  const backoff = o.backoffMs ?? 5000;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    kind: 'agent-sdk',
    async run(job, signal) {
      const env = o.env ?? process.env;
      assertLlmAllowed('the Agent SDK repair runner', env);
      const q = o.query ?? sdkQuery;
      const turnsUsed = job.resume?.turnsUsed ?? 0;
      const turnsLeft = job.maxTurns - turnsUsed;
      const budgetLeft = job.maxBudgetUsd - (job.resume?.costUsd ?? 0);
      const log: string[] = [];
      const denials: string[] = [];
      let tokens = zeroTokens();
      let costUsd = 0;
      let sessionId = job.resume?.sessionId;
      let tries = 0;
      /** Turns spent by this call, summed over every try (failed tries count too). */
      let turns = 0;
      const done = (r: Pick<RunnerResult, 'ok' | 'outcome' | 'summary'>) => ({
        kind: 'agent-sdk' as const,
        ...r,
        turns,
        sessionTurns: turnsUsed + turns,
        costUsd,
        tokens,
        tries,
        sessionId,
        log: log.join('\n'),
        denials,
      });
      if (turnsLeft <= 0)
        return done({ ok: false, outcome: 'max_turns', summary: 'session turn budget spent' });
      if (budgetLeft <= 0) return done({ ok: false, outcome: 'max_budget', summary: 'session budget spent' });
      const guard = makeCanUseTool({
        worktree: job.worktree,
        traceFormat: job.traceFormat,
        allowedEditPaths: job.allowedEditPaths,
        allowedNewFilePaths: job.allowedNewFilePaths,
        backend: job.backend,
        onCandidate: job.onCandidate,
      });
      const sdkGuard = sdkToolGuard(guard, {
        onDeny: (tool, message) => denials.push(`${tool}: ${message}`),
      });
      let lastFailure = '';
      while (tries < maxTries) {
        // A failed try's turns and cost come out of the next try's caps: retries share one budget.
        if (tries > 0) {
          if (turnsLeft - turns <= 0)
            return done({
              ok: false,
              outcome: 'max_turns',
              summary: `turn budget spent after ${tries} tries`,
            });
          if (budgetLeft - costUsd <= 0)
            return done({ ok: false, outcome: 'max_budget', summary: `budget spent after ${tries} tries` });
          await sleep(backoff * 4 ** (tries - 1));
        }
        tries++;
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        signal.addEventListener('abort', onAbort);
        let assistantError: string | undefined;
        let failure: FailureInfo | undefined;
        let sawResult = false;
        /** Assistant replies seen this try: the turn count when the try dies without a result. */
        const replies = new Set<string>();
        try {
          const stream = q({
            prompt:
              sessionId && sessionId !== job.resume?.sessionId
                ? RETRY_MESSAGE // a session from a failed try: continue it, do not resend the task
                : job.resume
                  ? job.resume.message
                  : job.prompt,
            options: {
              cwd: job.worktree,
              model: job.model,
              maxTurns: turnsLeft - turns,
              maxBudgetUsd: budgetLeft - costUsd,
              settingSources: [],
              strictMcpConfig: true,
              mcpServers: {},
              tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
              permissionMode: 'default',
              abortController: controller,
              env: claudeEnv(env),
              ...(sessionId ? { resume: sessionId } : {}),
              hooks: sdkGuard.hooks,
              canUseTool: sdkGuard.canUseTool,
            },
          });
          for await (const m of stream) {
            if ('session_id' in m && typeof m.session_id === 'string' && m.session_id)
              sessionId = m.session_id;
            if (m.type === 'assistant') {
              if (m.error) assistantError = m.error;
              else replies.add(typeof m.message.id === 'string' ? m.message.id : `#${replies.size}`);
              for (const block of m.message.content) {
                if (block.type === 'text') log.push(`assistant: ${block.text}`);
                if (block.type === 'tool_use')
                  log.push(`tool_use ${block.name}: ${JSON.stringify(block.input).slice(0, 300)}`);
              }
            }
            if (m.type !== 'result') continue;
            sawResult = true;
            tokens = addTokens(tokens, tokensOf(m.usage));
            costUsd += m.total_cost_usd ?? 0;
            turns += m.num_turns ?? 0;
            const status = m.subtype === 'success' ? m.api_error_status : undefined;
            const text = m.subtype === 'success' ? m.result : (m.errors ?? []).join('; ');
            if (m.is_error && classifyFailure({ status, kind: assistantError, message: text }) !== 'model') {
              failure = { status, kind: assistantError, message: text || m.subtype };
              break;
            }
            const outcome: RunnerOutcome =
              m.subtype === 'success' && !m.is_error
                ? 'completed'
                : m.subtype === 'error_max_turns'
                  ? 'max_turns'
                  : m.subtype === 'error_max_budget_usd'
                    ? 'max_budget'
                    : 'agent_error';
            return done({
              ok: outcome === 'completed',
              outcome,
              summary: m.subtype === 'success' ? m.result : m.subtype,
            });
          }
          failure ??= { kind: assistantError, message: assistantError ?? 'stream ended without a result' };
        } catch (e) {
          const err = e as { status?: number; message?: string };
          failure = { status: err.status, kind: assistantError, message: err.message ?? String(e) };
        } finally {
          signal.removeEventListener('abort', onAbort);
        }
        // No result message (a throw): its cost is unknown, its turns are the replies we saw.
        if (!sawResult) turns += replies.size;
        lastFailure = failure.message ?? failure.kind ?? 'unknown error';
        log.push(`try ${tries} failed: ${lastFailure}`);
        const cls = classifyFailure(failure);
        if (cls === 'model') return done({ ok: false, outcome: 'agent_error', summary: lastFailure });
        if (cls === 'fatal' || signal.aborted) break;
      }
      return done({
        ok: false,
        outcome: 'infra_error',
        summary: `infra_error after ${tries} tries: ${lastFailure}`,
      });
    },
  };
}

/** Claude Agent SDK runner with the default options. */
export const agentSdkRunner: RepairRunner = createAgentSdkRunner();

/**
 * Fallback: headless `claude -p` in the worktree, same tool limits via --allowedTools. It cannot
 * consult the realpath read guard, rewrite Bash or sanitize output, so it refuses to start when
 * a symlink in the worktree leaves it, in strict mode, with an exec backend, with create-only
 * paths, on resume, or with an edit guard other than the default. Experiments disable it.
 */
export const claudeCliRunner: RepairRunner = {
  kind: 'claude-cli',
  async run(job) {
    assertLlmAllowed('the claude -p repair runner');
    const refuse = (why: string): RunnerResult => ({
      ok: false,
      kind: 'claude-cli',
      outcome: 'refused',
      summary: `claude -p fallback refused: ${why}`,
      log: '',
    });
    if (job.traceFormat === 'strict') return refuse('strict trace format needs the SDK guard');
    if (job.backend) return refuse('an exec backend needs the SDK Bash rewrite');
    if (job.resume) return refuse('resume needs the SDK runner');
    if (job.allowedNewFilePaths?.length) return refuse('create-only paths need the SDK guard');
    if (
      job.allowedEditPaths &&
      JSON.stringify(job.allowedEditPaths) !== JSON.stringify(DEFAULT_ALLOWED_EDIT_PATHS)
    ) {
      return refuse('a non-default edit guard needs the SDK guard');
    }
    const links = escapingSymlinks(job.worktree);
    if (links.length) return refuse(`symlinks leave the worktree: ${links.join(', ')}`);
    const r = spawnSync(
      'claude',
      [
        '-p',
        job.prompt,
        '--output-format',
        'json',
        '--model',
        job.model,
        '--max-turns',
        String(job.maxTurns),
        // 'local' = .claude/settings.local.json, which a fresh worktree never has: no repo- or
        // user-controlled settings, like settingSources: [] in the SDK runner.
        '--setting-sources',
        'local',
        '--max-budget-usd',
        String(job.maxBudgetUsd),
        '--strict-mcp-config',
        '--tools',
        'Read,Glob,Edit,Write,Bash',
        '--permission-mode',
        'dontAsk',
        '--allowedTools',
        'Read(./**)',
        'Glob',
        'Edit(src/**)',
        'Write(src/**)',
        'Bash(pnpm typecheck)',
        'Bash(pnpm lint)',
        'Bash(pnpm test)',
        // fiks's node_modules link resolves outside the worktree (the SDK guard refuses it too).
        '--disallowedTools',
        'Read(./node_modules/**)',
      ],
      {
        cwd: job.worktree,
        env: claudeEnv() as NodeJS.ProcessEnv,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    try {
      const j = JSON.parse(r.stdout) as {
        is_error: boolean;
        result: string;
        num_turns: number;
        total_cost_usd: number;
        subtype: string;
        session_id?: string;
        usage?: unknown;
      };
      return {
        ok: !j.is_error,
        kind: 'claude-cli',
        outcome: j.is_error ? 'agent_error' : 'completed',
        turns: j.num_turns,
        costUsd: j.total_cost_usd,
        tokens: tokensOf(j.usage),
        sessionId: j.session_id,
        summary: j.result ?? j.subtype,
        log: r.stderr,
      };
    } catch {
      const text = `${r.stdout}\n${r.stderr}`;
      return {
        ok: false,
        kind: 'claude-cli',
        outcome: classifyFailure({ message: text }) === 'model' ? 'agent_error' : 'infra_error',
        summary: `claude -p failed (exit ${r.status})`,
        log: text,
      };
    }
  },
};

/** The product's runners: the SDK runner, then the CLI fallback unless disabled (experiments). */
export function defaultRunners(opts: { cliFallback?: boolean } = {}): RepairRunner[] {
  return opts.cliFallback === false ? [agentSdkRunner] : [agentSdkRunner, claudeCliRunner];
}
