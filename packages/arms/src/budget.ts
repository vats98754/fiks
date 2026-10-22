// The one budget every repair arm and the repro baseline share (PLAN 6.2 "Budget", 5.5).
// Every arm reads these numbers from here, so turns, sessions, the $ cap and the wall clock are
// accounted identically (a unit test compares the RunnerJob fields each arm actually sends).

export interface ArmBudget {
  /** Agent turns per session. */
  turnsPerSession: number;
  /** Cost cap per session (USD, SDK `maxBudgetUsd`). */
  usdPerSession: number;
  /** Sessions per attempt (L1 family: fix sessions; COMP family: 1 + revisions). */
  maxSessions: number;
  /** Wall-clock cap per attempt. */
  wallClockMs: number;
  /** COMP family: red-CI revisions after `would_open_pr` (within `wallClockMs`). */
  maxRevisions: number;
}

export const BUDGET: Readonly<ArmBudget> = Object.freeze({
  turnsPerSession: 30,
  usdPerSession: 5,
  maxSessions: 4,
  wallClockMs: 90 * 60_000,
  maxRevisions: 3,
});

/** REPRO-AGENT (PLAN 5.5): one session of 30 turns, at most 3 F rounds within it, F = 3 runs. */
export const REPRO_BUDGET = Object.freeze({
  sessions: 1,
  turnsPerSession: BUDGET.turnsPerSession,
  usdPerSession: BUDGET.usdPerSession,
  fRounds: 3,
  fRuns: 3,
  wallClockMs: BUDGET.wallClockMs,
});
