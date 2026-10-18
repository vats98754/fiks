import { spawnSync } from 'node:child_process';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { mayRead, mayRun, mayWrite } from './guard.ts';

export type RunnerKind = 'agent-sdk' | 'claude-cli' | 'oracle' | 'oracle-broken';

export interface RunnerJob {
  worktree: string;
  prompt: string;
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
}

export interface RunnerResult {
  ok: boolean;
  kind: RunnerKind;
  turns?: number;
  costUsd?: number;
  summary: string;
  log: string;
}

export interface RepairRunner {
  kind: RunnerKind;
  run(job: RunnerJob, signal: AbortSignal): Promise<RunnerResult>;
}

/** Claude Code auth comes from CLAUDE_CODE_OAUTH_TOKEN; an empty API key would shadow it. */
function claudeEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  if (!env.ANTHROPIC_API_KEY) delete env.ANTHROPIC_API_KEY;
  return env;
}

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** Claude Agent SDK: Claude Code in the worktree, with edits held to src/** and Bash to pnpm checks. */
export const agentSdkRunner: RepairRunner = {
  kind: 'agent-sdk',
  async run(job, signal) {
    const controller = new AbortController();
    signal.addEventListener('abort', () => controller.abort());
    const log: string[] = [];
    let result: RunnerResult = { ok: false, kind: 'agent-sdk', summary: 'no result', log: '' };
    const q = query({
      prompt: job.prompt,
      options: {
        cwd: job.worktree,
        model: job.model,
        maxTurns: job.maxTurns,
        maxBudgetUsd: job.maxBudgetUsd,
        settingSources: [],
        strictMcpConfig: true,
        mcpServers: {},
        tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
        permissionMode: 'default',
        abortController: controller,
        env: claudeEnv(),
        canUseTool: async (tool, input) => {
          if (WRITE_TOOLS.has(tool)) {
            const path = String(input.file_path ?? input.notebook_path ?? '');
            return mayWrite(job.worktree, path)
              ? { behavior: 'allow', updatedInput: input }
              : { behavior: 'deny', message: `Only files under src/ may be changed (refused: ${path}).` };
          }
          if (tool === 'Bash') {
            const cmd = String(input.command ?? '');
            return mayRun(cmd)
              ? { behavior: 'allow', updatedInput: input }
              : { behavior: 'deny', message: 'Only pnpm typecheck, pnpm lint and pnpm test are allowed.' };
          }
          if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') {
            const path = (input.file_path ?? input.path) as string | undefined;
            const pattern =
              typeof input.pattern === 'string' && input.pattern.startsWith('/') ? input.pattern : undefined;
            return mayRead(job.worktree, path) && mayRead(job.worktree, pattern)
              ? { behavior: 'allow', updatedInput: input }
              : { behavior: 'deny', message: 'Only files inside this repository may be read.' };
          }
          return { behavior: 'deny', message: `${tool} is not available for this task.` };
        },
      },
    });
    for await (const m of q) {
      if (m.type === 'assistant') {
        for (const block of m.message.content) {
          if (block.type === 'text') log.push(`assistant: ${block.text}`);
          if (block.type === 'tool_use')
            log.push(`tool_use ${block.name}: ${JSON.stringify(block.input).slice(0, 300)}`);
        }
      }
      if (m.type === 'result') {
        result = {
          ok: m.subtype === 'success' && !m.is_error,
          kind: 'agent-sdk',
          turns: m.num_turns,
          costUsd: m.total_cost_usd,
          summary: m.subtype === 'success' ? m.result : m.subtype,
          log: '',
        };
      }
    }
    result.log = log.join('\n');
    return result;
  },
};

/** Fallback: headless `claude -p` in the worktree, same tool limits via --allowedTools. */
export const claudeCliRunner: RepairRunner = {
  kind: 'claude-cli',
  async run(job) {
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
      };
      return {
        ok: !j.is_error,
        kind: 'claude-cli',
        turns: j.num_turns,
        costUsd: j.total_cost_usd,
        summary: j.result ?? j.subtype,
        log: r.stderr,
      };
    } catch {
      return {
        ok: false,
        kind: 'claude-cli',
        summary: `claude -p failed (exit ${r.status})`,
        log: `${r.stdout}\n${r.stderr}`,
      };
    }
  },
};
