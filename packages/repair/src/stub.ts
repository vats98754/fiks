// Stub runner (round 5): a scripted "agent" with zero LLM calls. It sends each scripted step through
// the same canUseTool guard as the SDK runner, applies what the guard allows, then ends the turn.
// Used by `--agent-stub <script.json>` (ORCH, ARMS) and `pnpm exp --dry` (RUN).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { hostBackend } from './env.ts';
import { makeCanUseTool } from './permissions.ts';
import type { RepairRunner, RunnerResult } from './runner.ts';
import { zeroTokens } from './runner.ts';

export type StubStep =
  /** Write a whole file (Write tool). */
  | { op: 'write'; path: string; content: string }
  /** Replace the first occurrence of `oldString` (Edit tool). */
  | { op: 'edit'; path: string; oldString: string; newString: string }
  /** Create a new test file (Write tool; allowed only under allowedNewFilePaths or the edit guard). */
  | { op: 'newTest'; path: string; content: string }
  /** Run an allow-listed check command (Bash tool: candidate capture + exec backend). */
  | { op: 'bash'; command: string }
  /** Read a file (Read tool); only its permission is exercised. */
  | { op: 'read'; path: string };

export interface StubSession {
  steps: StubStep[];
  /** The final reply (e.g. "Subject: ...\n<paragraph>"). */
  summary?: string;
}

/** One session, or several: `run` plays session 0, each resume plays the next one. */
export type StubScript = StubSession | { sessions: StubSession[] };

const sessionsOf = (s: StubScript): StubSession[] => ('sessions' in s ? s.sessions : [s]);

const OPS = new Set(['write', 'edit', 'newTest', 'bash', 'read']);

/** Parses and validates a stub script (the `--agent-stub <script.json>` file). */
export function parseStubScript(json: unknown): StubScript {
  const fail = (m: string): never => {
    throw new Error(`stub script: ${m}`);
  };
  if (json === null || typeof json !== 'object') fail('must be an object');
  const sessions = 'sessions' in (json as object) ? (json as { sessions: unknown }).sessions : [json];
  if (!Array.isArray(sessions) || sessions.length === 0) fail('"sessions" must be a non-empty array');
  for (const [i, s] of (sessions as unknown[]).entries()) {
    const steps = (s as { steps?: unknown })?.steps;
    if (!Array.isArray(steps)) fail(`session ${i}: "steps" must be an array`);
    for (const [j, st] of (steps as unknown[]).entries()) {
      const op = (st as { op?: unknown })?.op;
      if (typeof op !== 'string' || !OPS.has(op))
        fail(`session ${i} step ${j}: unknown op ${JSON.stringify(op)}`);
      const x = st as Record<string, unknown>;
      const str = (k: string) =>
        typeof x[k] === 'string' || fail(`session ${i} step ${j}: "${k}" must be a string`);
      if (op === 'bash') str('command');
      else str('path');
      if (op === 'write' || op === 'newTest') str('content');
      if (op === 'edit') {
        str('oldString');
        str('newString');
      }
    }
  }
  return json as StubScript;
}

export const loadStubScript = (file: string) => parseStubScript(JSON.parse(readFileSync(file, 'utf8')));

const STUB_SESSION = /^stub-session-(\d+)$/;

/**
 * A runner that plays `script` through the canUseTool guard: one turn per step, the shared turn
 * budget enforced across resumes, no SDK import, no network. Bash steps run through the job's
 * backend (or the host backend), like a rewritten agent Bash call.
 */
export function stubRunner(script: StubScript): RepairRunner {
  const sessions = sessionsOf(parseStubScript(script));
  return {
    kind: 'stub',
    async run(job): Promise<RunnerResult> {
      const idx = job.resume ? Number(STUB_SESSION.exec(job.resume.sessionId)?.[1] ?? -1) + 1 : 0;
      const turnsUsed = job.resume?.turnsUsed ?? 0;
      const log: string[] = [];
      const denials: string[] = [];
      const session = sessions[idx];
      const sessionId = `stub-session-${idx}`;
      const base = { kind: 'stub' as const, costUsd: 0, tokens: zeroTokens(), tries: 0, sessionId };
      if (job.resume && !STUB_SESSION.test(job.resume.sessionId)) {
        return { ...base, ok: false, outcome: 'refused', summary: 'not a stub session', log: '', turns: 0 };
      }
      if (!session) {
        return {
          ...base,
          ok: false,
          outcome: 'agent_error',
          summary: `no scripted session ${idx}`,
          log: '',
          turns: 0,
        };
      }
      const guard = makeCanUseTool({
        worktree: job.worktree,
        traceFormat: job.traceFormat,
        allowedEditPaths: job.allowedEditPaths,
        allowedNewFilePaths: job.allowedNewFilePaths,
        backend: job.backend ?? hostBackend(),
        onCandidate: job.onCandidate,
      });
      const abs = (p: string) => (isAbsolute(p) ? p : resolve(job.worktree, p));
      let turns = 0;
      for (const step of session.steps) {
        if (turnsUsed + turns >= job.maxTurns) {
          log.push('turn budget spent');
          return {
            ...base,
            ok: false,
            outcome: 'max_turns',
            turns,
            sessionTurns: turnsUsed + turns,
            summary: 'error_max_turns',
            log: log.join('\n'),
            denials,
          };
        }
        turns++;
        const [tool, input]: [string, Record<string, unknown>] =
          step.op === 'bash'
            ? ['Bash', { command: step.command }]
            : step.op === 'read'
              ? ['Read', { file_path: step.path }]
              : step.op === 'edit'
                ? ['Edit', { file_path: step.path, old_string: step.oldString, new_string: step.newString }]
                : ['Write', { file_path: step.path, content: step.content }];
        const d = await guard(tool, input);
        if (d.behavior === 'deny') {
          denials.push(`${tool}: ${d.message}`);
          log.push(`denied ${tool} ${step.op === 'bash' ? step.command : step.path}: ${d.message}`);
          continue;
        }
        const u = d.updatedInput;
        if (tool === 'Write') {
          const f = abs(String(u.file_path));
          mkdirSync(dirname(f), { recursive: true });
          writeFileSync(f, String(u.content));
          log.push(`wrote ${String(u.file_path)}`);
        } else if (tool === 'Edit') {
          const f = abs(String(u.file_path));
          const before = readFileSync(f, 'utf8');
          const old = String(u.old_string);
          if (!before.includes(old)) {
            log.push(`edit ${String(u.file_path)}: old_string not found`);
            continue;
          }
          writeFileSync(
            f,
            before.replace(old, () => String(u.new_string)),
          );
          log.push(`edited ${String(u.file_path)}`);
        } else if (tool === 'Bash') {
          // The guard already ran the command through the backend; the rewritten command only
          // prints the relayed output, so the stub reads it from there.
          const m = /^cat (\S+); exit (\d+)$/.exec(String(u.command));
          log.push(`ran ${step.op === 'bash' ? step.command : ''}: exit ${m?.[2] ?? '?'}`);
        } else {
          log.push(`read ${String(u.file_path)}`);
        }
      }
      return {
        ...base,
        ok: true,
        outcome: 'completed',
        turns,
        sessionTurns: turnsUsed + turns,
        summary: session.summary ?? 'Subject: scripted stub edit\nApplied the scripted steps.',
        log: log.join('\n'),
        denials,
      };
    },
  };
}
