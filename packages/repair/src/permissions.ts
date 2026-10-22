// The repair agent's tool policy (P1, P2, P3, round-5 edit guard), shared by the Agent SDK runner
// and the stub runner so both go through exactly the same checks.
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { AllowedEditPaths, ExecBackend, TraceFormat } from '@fiks/interfaces';
import { candidateDiff, execEnv, hostBackend, type OnCandidate } from './env.ts';
import { mayGlob, mayRead, mayRun, maySearch, mayWrite } from './guard.ts';
import { sanitizeGateOutput } from './strict.ts';

export interface ToolPolicy {
  worktree: string;
  /** `raw` (default) or `strict` (E6): strict quarantines raw-byte files and sanitizes gate output. */
  traceFormat?: TraceFormat;
  /** Regex sources for editable repo-relative paths (Domain.allowedEditPaths; default `^src/.+\.ts$`). */
  allowedEditPaths?: AllowedEditPaths;
  /**
   * Regex sources for files the agent may create but never overwrite if they existed before
   * (e.g. an agent-written repro test). Default none.
   */
  allowedNewFilePaths?: AllowedEditPaths;
  /**
   * Where allow-listed Bash commands run. Unset in raw mode: the SDK's own Bash runs the command
   * unchanged on the host (today's behaviour). Set (or strict mode, which uses the host backend):
   * the command runs through `backend.exec` and the agent's Bash only prints its relayed output.
   */
  backend?: ExecBackend;
  /** Env for backend commands (default {PATH, CI=1, HOME=<temp>}). */
  execEnv?: Record<string, string>;
  /** Further read roots (realpath'd), e.g. a shared node_modules. Default none. */
  extraReadRoots?: readonly string[];
  /** Candidate capture: called with the worktree diff before every allow-listed check command. */
  onCandidate?: OnCandidate;
  /** Diff base for candidates (default HEAD, i.e. the repro commit). */
  candidateBase?: string;
  /** Per-command timeout for backend commands (default 15 min). */
  execTimeoutMs?: number;
}

export type ToolDecision =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

export type CanUseTool = (tool: string, input: Record<string, unknown>) => Promise<ToolDecision>;

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_SAFE = /^[\w./-]+$/;

/** Allowed Bash commands are `pnpm <args>` with plain tokens (see mayRun); split for exec. */
export const commandArgv = (cmd: string) => cmd.trim().split(/\s+/);

/**
 * Builds the `canUseTool` callback. Writes: edit guard (+ create-only paths), realpath-contained.
 * Reads: realpath-contained, strict quarantine. Bash: `mayRun` allow-list, then either unchanged
 * (raw, no backend) or executed through the backend and replaced by a relay of its output.
 */
export function makeCanUseTool(policy: ToolPolicy): CanUseTool {
  const { worktree } = policy;
  const traceFormat = policy.traceFormat ?? 'raw';
  const readPolicy = { traceFormat, extraReadRoots: policy.extraReadRoots };
  /** Files this session created under allowedNewFilePaths: it may keep editing its own files. */
  const created = new Set<string>();
  const backend = policy.backend ?? (traceFormat === 'strict' ? hostBackend() : undefined);
  let relayDir: string | undefined;
  let relayN = 0;
  const env = policy.execEnv ?? execEnv();

  const writeDecision = (path: string): ToolDecision | undefined => {
    if (mayWrite(worktree, path, { allowedEditPaths: policy.allowedEditPaths })) return undefined;
    if (
      (policy.allowedNewFilePaths?.length ?? 0) > 0 &&
      mayWrite(worktree, path, { allowedEditPaths: policy.allowedNewFilePaths })
    ) {
      const abs = isAbsolute(path) ? resolve(path) : resolve(worktree, path);
      if (created.has(abs)) return undefined;
      if (!existsSync(abs)) {
        created.add(abs);
        return undefined;
      }
      return { behavior: 'deny', message: `Existing files may not be changed here (refused: ${path}).` };
    }
    return { behavior: 'deny', message: `Only allow-listed source files may be changed (refused: ${path}).` };
  };

  return async (tool, input) => {
    if (WRITE_TOOLS.has(tool)) {
      const path = String(input.file_path ?? input.notebook_path ?? '');
      return writeDecision(path) ?? { behavior: 'allow', updatedInput: input };
    }
    if (tool === 'Bash') {
      const cmd = String(input.command ?? '');
      if (!mayRun(cmd)) {
        return { behavior: 'deny', message: 'Only pnpm typecheck, pnpm lint and pnpm test are allowed.' };
      }
      await policy.onCandidate?.(candidateDiff(worktree, policy.candidateBase), 'gate');
      if (!backend) return { behavior: 'allow', updatedInput: input };
      const [bin = 'pnpm', ...args] = commandArgv(cmd);
      let r: Awaited<ReturnType<ExecBackend['exec']>>;
      try {
        r = await backend.exec(bin, args, {
          cwd: worktree,
          env,
          timeoutMs: policy.execTimeoutMs ?? 15 * 60_000,
        });
      } catch (e) {
        const why = e instanceof Error ? e.message.split('\n')[0] : String(e);
        return {
          behavior: 'deny',
          message: `The check could not be run (sandbox error: ${why}). Try again later.`,
        };
      }
      const text = sanitizeGateOutput(`${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`, { traceFormat });
      relayDir ??= mkdtempSync(join(tmpdir(), 'fiks-relay-'));
      const file = join(relayDir, `out-${++relayN}.txt`);
      if (!SHELL_SAFE.test(file)) throw new Error(`unsafe relay path ${file}`);
      writeFileSync(file, text);
      const code = Number.isInteger(r.code) && r.code >= 0 && r.code < 256 ? r.code : 1;
      return {
        behavior: 'allow',
        updatedInput: { ...input, command: `cat ${file}; exit ${code}`, description: cmd },
      };
    }
    if (tool === 'Read') {
      const path = input.file_path as string | undefined;
      return mayRead(worktree, path, readPolicy)
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: readRefusal(traceFormat) };
    }
    if (tool === 'Grep') {
      const path = input.path as string | undefined;
      return maySearch(worktree, path, readPolicy)
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: searchRefusal(traceFormat) };
    }
    if (tool === 'Glob') {
      const path = input.path as string | undefined;
      const pattern = typeof input.pattern === 'string' ? input.pattern : undefined;
      return mayRead(worktree, path, { ...readPolicy, traceFormat: 'raw' }) &&
        mayGlob(worktree, pattern, readPolicy)
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: readRefusal('raw') };
    }
    return { behavior: 'deny', message: `${tool} is not available for this task.` };
  };
}

const readRefusal = (f: TraceFormat) =>
  f === 'strict'
    ? 'Only files inside this repository may be read; recorded fixtures, traces and alerts are not readable in this run (the typed trace is in your prompt).'
    : 'Only files inside this repository may be read.';
const searchRefusal = (f: TraceFormat) =>
  f === 'strict'
    ? 'Search inside src/ or test/fiks/: recorded fixtures, traces and alerts are not readable in this run.'
    : 'Only files inside this repository may be searched.';
