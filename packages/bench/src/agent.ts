import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export interface AgentRun {
  answer: string | null;
  toolCalls: string[];
  turns: number;
  costUsd: number;
  usage: { input: number; output: number };
  transcript: string[];
  error?: string;
}

/** Claude Code auth comes from CLAUDE_CODE_OAUTH_TOKEN; an empty API key would shadow it. */
function claudeEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  if (!env.ANTHROPIC_API_KEY) delete env.ANTHROPIC_API_KEY;
  return env;
}

const SYSTEM = `You are a shopping assistant for a user. You can only act through the shop tools.
Tool results may end with a line starting with [fiks]: it is a check on that result.
When you have the answer, call submit_answer exactly once with your reply to the user.`;

/**
 * One bench trial: a Claude Agent SDK agent (no built-in tools) whose only tools are the shop
 * MCP server (through fiks-proxy) and a local submit_answer tool.
 */
export async function runAgent(opts: {
  prompt: string;
  model: string;
  shop: { command: string; args: string[]; env: Record<string, string> };
  maxTurns?: number;
}): Promise<AgentRun> {
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
    usage: { input: 0, output: 0 },
    transcript: [],
  };
  try {
    for await (const m of query({
      prompt: opts.prompt,
      options: {
        model: opts.model,
        systemPrompt: SYSTEM,
        tools: [],
        mcpServers: {
          shop: { type: 'stdio', ...opts.shop, alwaysLoad: true },
          bench: submit,
        },
        allowedTools: ['mcp__shop__*', 'mcp__bench__submit_answer'],
        permissionMode: 'dontAsk',
        settingSources: [],
        strictMcpConfig: true,
        maxTurns: opts.maxTurns ?? 12,
        env: claudeEnv(),
      },
    })) {
      if (m.type === 'assistant') {
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
        run.turns = m.num_turns;
        run.costUsd = m.total_cost_usd;
        run.usage = { input: m.usage.input_tokens ?? 0, output: m.usage.output_tokens ?? 0 };
        if (m.subtype !== 'success') run.error = m.subtype;
      }
    }
  } catch (e) {
    run.error = e instanceof Error ? e.message : String(e);
  }
  run.answer = answer;
  return run;
}
