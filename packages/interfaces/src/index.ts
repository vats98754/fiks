// Shared interfaces, frozen at the CORE-SEED commit (paper/PLAN.md Appendix). A change is a seed
// amendment by the orchestrator, after which every merged dependant is re-verified.

export type * from './arm.ts';
export type * from './build.ts';
export type * from './domain.ts';
export type * from './drift.ts';
export type * from './exec.ts';
export type * from './monitor.ts';
export type * from './realbug.ts';
export type * from './records.ts';
export type * from './rerecord.ts';
export * from './run.ts';

export const name = '@fiks/interfaces';
