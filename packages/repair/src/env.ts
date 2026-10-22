import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CandidateStage, ExecBackend, ExecOptions, ExecResult } from '@fiks/interfaces';

/**
 * The repair agent's environment (P1): the OAuth token, PATH and a fresh temp HOME, nothing else.
 * Host secrets (GH_TOKEN, cloud keys, canaries, ANTHROPIC_API_KEY) never reach the agent or the
 * commands it runs. The SDK passes `env` as-is (not merged with process.env).
 */
export function claudeEnv(
  src: NodeJS.ProcessEnv = process.env,
  home: string = mkdtempSync(join(tmpdir(), 'fiks-agent-home-')),
): Record<string, string> {
  const env: Record<string, string> = { PATH: src.PATH ?? '/usr/bin:/bin', HOME: home };
  if (src.CLAUDE_CODE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = src.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
}

/** Environment for commands the agent runs through an ExecBackend (P1): {PATH, CI=1, HOME}. */
export function execEnv(
  src: NodeJS.ProcessEnv = process.env,
  home: string = mkdtempSync(join(tmpdir(), 'fiks-exec-home-')),
): Record<string, string> {
  return { PATH: src.PATH ?? '/usr/bin:/bin', CI: '1', HOME: home };
}

/** Thrown before any model call when FIKS_LLM_FORBID=1 (`pnpm exp --dry`, INTEG's dry run). */
export class LlmForbiddenError extends Error {
  constructor(what: string) {
    super(`FIKS_LLM_FORBID=1: refusing to start ${what}`);
    this.name = 'LlmForbiddenError';
  }
}

export function assertLlmAllowed(what: string, env: NodeJS.ProcessEnv = process.env) {
  if (env.FIKS_LLM_FORBID === '1') throw new LlmForbiddenError(what);
}

/**
 * The host ExecBackend: a plain child process in `opts.cwd` with exactly `opts.env` (never the
 * host env). SBX's DockerExecBackend replaces it in experiments.
 */
export function hostBackend(): ExecBackend {
  return {
    exec(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
      return new Promise((done) => {
        const child = spawn(cmd, args, {
          cwd: opts.cwd,
          env: opts.env ?? execEnv(),
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: opts.timeoutMs,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => {
          stdout += d;
        });
        child.stderr.on('data', (d) => {
          stderr += d;
        });
        child.on('error', (e) => done({ code: 127, stdout, stderr: `${stderr}${e.message}\n` }));
        child.on('close', (code, signal) =>
          done({
            code: code ?? (signal ? 128 : 1),
            stdout,
            stderr: signal ? `${stderr}killed by ${signal}\n` : stderr,
          }),
        );
        child.stdin.end(opts.input ?? '');
      });
    },
    async cleanup() {},
  };
}

/** Called with the worktree's current diff at every gate invocation (P11 candidate capture). */
export type OnCandidate = (diff: string, stage: CandidateStage) => void | Promise<void>;

/**
 * The candidate patch in `worktree`: tracked changes against `base` plus untracked files, as one
 * git diff (binary-safe). Read-only: the index is not touched.
 */
export function candidateDiff(worktree: string, base = 'HEAD'): string {
  const git = (args: string[]) =>
    spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: worktree,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  const tracked = git(['diff', '--binary', base, '--', '.', ':(exclude)node_modules']).stdout;
  const untracked = git(['ls-files', '--others', '--exclude-standard'])
    .stdout.split('\n')
    .filter((f) => f && f !== 'node_modules' && !f.startsWith('node_modules/'))
    .sort()
    .map((f) => git(['diff', '--binary', '--no-index', '--', '/dev/null', f]).stdout);
  return [tracked, ...untracked].join('');
}
