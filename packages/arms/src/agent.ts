// Which agent plays the sessions: the Claude Agent SDK runner (SAFE; no CLI fallback in
// experiments) or SAFE's stub runner (`--agent-stub <script.json>`, zero LLM calls). Every arm
// builds its RunnerJob the same way (`armJob`), so budget, guard and backend are identical.
import type { AllowedEditPaths, ExecBackend, TraceFormat } from '@fiks/interfaces';
import {
  createAgentSdkRunner,
  type OnCandidate,
  type RepairRunner,
  type RunnerJob,
  type StubScript,
  type StubSession,
  stubRunner,
} from '@fiks/repair';
import { BUDGET } from './budget.ts';

export interface AgentProvider {
  kind: 'agent-sdk' | 'stub';
  /** A fresh session (repair arms: session n, 0-based). */
  session(n: number): RepairRunner;
  /** One runner that is resumed with a message (REPRO-AGENT's F feedback). */
  resumable(): RepairRunner;
}

export function sdkAgent(): AgentProvider {
  const runner = createAgentSdkRunner();
  return { kind: 'agent-sdk', session: () => runner, resumable: () => runner };
}

const sessionsOf = (s: StubScript): StubSession[] => ('sessions' in s ? s.sessions : [s]);

/**
 * Stub agent. Repair arms start a new session per gate failure or CI revision: session n plays
 * the script's session n. REPRO-AGENT resumes one session: each resume plays the next session
 * (SAFE stubRunner semantics).
 */
export function stubAgent(script: StubScript): AgentProvider {
  const sessions = sessionsOf(script);
  return {
    kind: 'stub',
    session(n) {
      const s = sessions[n];
      if (!s) {
        return {
          kind: 'stub',
          run: async () => ({
            ok: false,
            kind: 'stub',
            outcome: 'agent_error',
            summary: `no scripted session ${n}`,
            log: '',
            turns: 0,
            costUsd: 0,
          }),
        };
      }
      return stubRunner({ sessions: [s] });
    },
    resumable: () => stubRunner(script),
  };
}

/** Regex sources for test files an agent may create (never overwrite): new tests under test/. */
export const NEW_TEST_PATHS: AllowedEditPaths = [
  '^test/(?!fiks/|fixtures/|repro/|traces/)[\\w./-]+\\.test\\.ts$',
];

export interface ArmJobInput {
  worktree: string;
  prompt: string;
  model: string;
  traceFormat: TraceFormat;
  /** The Domain's allow-list (repair arms) or none (REPRO-AGENT writes only its new test). */
  allowedEditPaths: AllowedEditPaths;
  allowedNewFilePaths: AllowedEditPaths;
  backend: ExecBackend;
  onCandidate?: OnCandidate;
}

/** The RunnerJob of one session: the same budget fields for every arm (PLAN 6.2 "Budget"). */
export function armJob(i: ArmJobInput): RunnerJob {
  return {
    worktree: i.worktree,
    prompt: i.prompt,
    model: i.model,
    maxTurns: BUDGET.turnsPerSession,
    maxBudgetUsd: BUDGET.usdPerSession,
    traceFormat: i.traceFormat,
    allowedEditPaths: i.allowedEditPaths,
    allowedNewFilePaths: i.allowedNewFilePaths,
    backend: i.backend,
    ...(i.onCandidate ? { onCandidate: i.onCandidate } : {}),
  };
}
