// Contract-update outcome gate (PLAN P12): `{outcome: 'contract_update', delta}` is accepted only
// if the trigger verifies, stored true violations still violate, the clean v1 corpus verifies and
// mutation variants of the trigger are still rejected (P12; CU also keeps them rejected on the
// amended property, and a replace keeps the property's kind and paths). Output: a contract-change
// proposal, never code.
export * from './apply.ts';
export * from './cases.ts';
export * from './gate.ts';
export * from './outcome.ts';
export * from './render.ts';

export const name = '@fiks/contract-update';
