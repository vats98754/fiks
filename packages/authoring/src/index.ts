// @fiks/authoring (stream BLIND): the sealed blind-authoring pipeline of PLAN 5.1-5.3. It runs in
// A0/A1/A2 (never by a builder): leak-free exports, logged isolated sessions, catalog/contract/drift/
// benign/fixer/rater authoring, validity, the keep rule, the split and the A1 runner.

// Re-exported for the CLI, which depends on @fiks/authoring only (deps-fragments/BLIND.json).
export type { LlmDeps } from '@fiks/llm';
export { BASE_IMAGE, buildRepoImage } from '@fiks/sandbox';
export * from './a1.ts';
export * from './briefs.ts';
export * from './catalog.ts';
export * from './contract.ts';
export * from './contract-schema.ts';
export * from './deny.ts';
export * from './drift.ts';
export * from './export.ts';
export * from './keep.ts';
export * from './nobounds.ts';
export * from './record.ts';
export * from './rng.ts';
export * from './runner.ts';
export * from './session.ts';
export * from './sources.ts';
export * from './split.ts';
export * from './stub.ts';
export * from './validate.ts';

export const name = '@fiks/authoring';
