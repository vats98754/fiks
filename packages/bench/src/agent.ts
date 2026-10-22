import { createSdkMcpServer, query as sdkQuery, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

/** Token counts of one trial, summed over every model call the SDK made (cache included). */
export interface TrialUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

export interface AgentRun {
  answer: string | null;
  toolCalls: string[];
  turns: number;
  /** SDK `total_cost_usd`: an API-price estimate, not a bill. */
  costUsd: number;
  usage: TrialUsage;
  transcript: string[];
  /** Why the run stopped early (SDK result subtype, API or transport error). */
  error?: string;
  /**
   * Set when no answer was submitted and the cause is the infrastructure, not the model: an SDK
   * or transport exception, an API error result (429, 5xx, overload, auth), an SDK execution
   * error, or a stream that ended without a result. `maxTurns` and budget stops are model
   * outcomes and never set it (PLAN 9.3).
   */
  infraError?: string;
}

/** The MCP server the agent talks to for one trial (stdio). */
export interface McpServerSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface AgentInput {
  prompt: string;
  model: string;
  server: McpServerSpec;
  maxTurns?: number;
  /** Defaults to the shop system prompt (`SHOP_SYSTEM`). */
  systemPrompt?: string;
  /** MCP server name the agent sees (tools are `mcp__<name>__*`); defaults to `shop`. */
  serverName?: string;
}

/** One bench trial's agent. `runAgent` is the Claude one; tests pass deterministic stubs. */
export type BenchAgent = (input: AgentInput) => Promise<AgentRun>;

/** Claude Code auth comes from CLAUDE_CODE_OAUTH_TOKEN; an empty API key would shadow it. */
function claudeEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  if (!env.ANTHROPIC_API_KEY) delete env.ANTHROPIC_API_KEY;
  return env;
}

export const SHOP_SYSTEM = `You are a shopping assistant for a user. You can only act through the shop tools.
Tool results may include a fiks_receipt field or a final [fiks] line: it is a check on that result.
Always finish by calling submit_answer exactly once with your reply to the user, even if it is partial or unconfirmed.`;

/** The system prompt for a domain without its own (same wording, no shop vocabulary). */
export function genericSystem(serverName: string): string {
  return `You are an assistant for a user. You can only act through the ${serverName} tools.
Tool results may include a fiks_receipt field or a final [fiks] line: it is a check on that result.
Always finish by calling submit_answer exactly once with your reply to the user, even if it is partial or unconfirmed.`;
}

/** Assistant-message API errors that are infrastructure (the turn never reached the model's output). */
const INFRA_ASSISTANT_ERRORS = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'verification_required',
  'billing_error',
  'rate_limit',
  'overloaded',
  'model_not_found',
  'server_error',
  'unknown',
  'cloud_credential_error',
]);

/** Result subtypes that are the model's own outcome (it ran out of turns or budget). */
const MODEL_STOPS = new Set([
  'error_max_turns',
  'error_max_budget_usd',
  'error_max_structured_output_retries',
]);

type QueryFn = typeof sdkQuery;

interface ModelUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Token totals: `modelUsage` (every model call) when present, else the main-loop `usage`. */
export function usageFromResult(r: { usage?: UsageLike; modelUsage?: Record<string, ModelUsageLike> }) {
  const models = Object.values(r.modelUsage ?? {});
  if (models.length > 0) {
    const sum = (f: keyof ModelUsageLike) => models.reduce((s, m) => s + (m[f] ?? 0), 0);
    return {
      input: sum('inputTokens'),
      output: sum('outputTokens'),
      cacheRead: sum('cacheReadInputTokens'),
      cacheCreate: sum('cacheCreationInputTokens'),
    };
  }
  const u = r.usage ?? {};
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheCreate: u.cache_creation_input_tokens ?? 0,
  };
}

/**
 * One bench trial: a Claude Agent SDK agent (no built-in tools) whose only tools are the
 * domain's MCP server (through fiks-proxy, or direct) and a local submit_answer tool.
 * `deps.query` replaces the SDK in tests.
 */
export async function runAgent(input: AgentInput, deps: { query?: QueryFn } = {}): Promise<AgentRun> {
  const query = deps.query ?? sdkQuery;
  const serverName = input.serverName ?? 'shop';
  let answer: string | null = null;
  const submit = createSdkMcpServer({
    name: 'bench',
    version: '1.0.0',
    tools: [
      tool('submit_answer', 'Submit your final reply to the user.', { answer: z.string() }, async (args) => {
        answer = args.answer;
        return { content: [{ type: 'text', text: 'Submitted.' }] };
      }),
    ],
  });
  const run: AgentRun = {
    answer: null,
    toolCalls: [],
    turns: 0,
    costUsd: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    transcript: [],
  };
  let infra: string | undefined;
  let sawResult = false;
  try {
    for await (const m of query({
      prompt: input.prompt,
      options: {
        model: input.model,
        systemPrompt: input.systemPrompt ?? SHOP_SYSTEM,
        tools: [],
        mcpServers: {
          [serverName]: { type: 'stdio', ...input.server, alwaysLoad: true },
          bench: submit,
        },
        allowedTools: [`mcp__${serverName}__*`, 'mcp__bench__submit_answer'],
        permissionMode: 'dontAsk',
        settingSources: [],
        strictMcpConfig: true,
        maxTurns: input.maxTurns ?? 12,
        env: claudeEnv(),
      },
    })) {
      if (m.type === 'assistant') {
        if (m.error && INFRA_ASSISTANT_ERRORS.has(m.error)) infra = `api error: ${m.error}`;
        for (const b of m.message.content) {
          if (b.type === 'text') run.transcript.push(`assistant: ${b.text}`);
          if (b.type === 'tool_use') {
            run.toolCalls.push(b.name);
            run.transcript.push(`tool_use ${b.name} ${JSON.stringify(b.input)}`);
          }
        }
      } else if (m.type === 'user') {
        const content = (m.message as { content?: unknown }).content;
        if (Array.isArray(content)) {
          for (const b of content as { type: string; content?: unknown }[]) {
            if (b.type === 'tool_result')
              run.transcript.push(`tool_result ${JSON.stringify(b.content).slice(0, 1500)}`);
          }
        }
      } else if (m.type === 'result') {
        sawResult = true;
        run.turns = m.num_turns;
        run.costUsd = m.total_cost_usd ?? 0;
        run.usage = usageFromResult(m as Parameters<typeof usageFromResult>[0]);
        if (m.subtype === 'success') {
          if (m.is_error) {
            run.error = `api error${m.api_error_status ? ` ${m.api_error_status}` : ''}: ${String(m.result).slice(0, 200)}`;
            infra = run.error;
          }
        } else {
          run.error = m.subtype;
          if (!MODEL_STOPS.has(m.subtype)) {
            const errs = (m as { errors?: string[] }).errors ?? [];
            infra = `${m.subtype}${errs.length ? `: ${errs.join('; ').slice(0, 200)}` : ''}`;
          }
        }
      }
    }
    if (!sawResult) infra ??= 'the SDK stream ended without a result message';
  } catch (e) {
    run.error = e instanceof Error ? e.message : String(e);
    infra = `sdk: ${run.error}`;
  }
  run.answer = answer;
  // A submitted answer is the model's output and is always graded, whatever happened afterwards.
  if (answer === null && infra) run.infraError = infra;
  return run;
}
