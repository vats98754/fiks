// @fiks/arms (stream ARMS): the comparator arms of PLAN 6.2, fiks-iv (P21), the alert renderer and
// REPRO-AGENT's F check. Run through `pnpm fiks arm` (packages/cli/src/commands/arm.ts).
export * from './agent.ts';
export * from './alert.ts';
export * from './arms.ts';
export * from './attempt.ts';
export * from './budget.ts';
export * from './checks.ts';
export * from './cli.ts';
export * from './domains.ts';
export * from './fcheck.ts';
export * from './iv.ts';
export { IV_USAGE, ivMain } from './iv-cli.ts';
export * from './prompts.ts';
export * from './records.ts';
export * from './rules.ts';
export * from './sandbox.ts';
export * from './sidecar.ts';
export * from './trace.ts';
export * from './worktree.ts';

export const name = '@fiks/arms';
