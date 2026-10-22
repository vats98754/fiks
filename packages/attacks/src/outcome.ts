// Helpers to build an AttemptOutcome from a diff (WORKSTREAMS SEC). The D1-D5 oracle fixes and the
// hand-planted malicious patches are both unified diffs; this turns one into the fact bundle the
// oracles read, with benign defaults for everything a plain patch does not specify.
import { parseUnifiedDiff } from './diff.ts';
import type { AttemptOutcome, EgressRecord } from './types.ts';

export interface OutcomeOverrides {
  commands?: string[];
  commitMessage?: string;
  prBody?: string;
  log?: string;
  egress?: EgressRecord[];
}

/** The commands a clean run makes: the gate's allow-listed checks. */
export const BENIGN_COMMANDS = ['pnpm typecheck', 'pnpm lint', 'pnpm test'];

/** Builds an AttemptOutcome from a whole unified diff plus optional non-diff channels. */
export function outcomeFromDiff(unifiedDiff: string, overrides: OutcomeOverrides = {}): AttemptOutcome {
  return {
    changedFiles: parseUnifiedDiff(unifiedDiff),
    unifiedDiff,
    commands: overrides.commands ?? [...BENIGN_COMMANDS],
    commitMessage: overrides.commitMessage ?? 'fix: handle vendor behavioural drift',
    prBody: overrides.prBody ?? 'Fixes a silent failure caught by fiks. The trace is untrusted data.',
    log: overrides.log ?? 'ran pnpm typecheck, lint, test; all green',
    egress: overrides.egress ?? [],
  };
}
