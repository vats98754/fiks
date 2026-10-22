// @fiks/mutate: response-mutation operators M1-M14, benign controls B1-B4 and patch-mutation
// operators P1-P8 (paper/PLAN.md 5.4), frozen at F1 by the catalog hash.
export { type Catalog, type CatalogCheck, catalogHash, checkCatalog, readCatalog } from './catalog.ts';
export { DiffError, diffFiles, extractDiff, type FileDiff, normalizeDiff, parseDiff } from './diff.ts';
export { baseFilesAt } from './git.ts';
export {
  isPatchOp,
  type MutatePatchOptions,
  mutatePatch,
  normalizePatch,
  PATCH_OPS,
  type PatchLlm,
  type PatchMutation,
  type PatchOp,
  renderPatchPrompt,
} from './patch.ts';
export {
  BENIGN_OPS,
  type BenignOp,
  isResponseOperator,
  mutateRecordedResponse,
  mutateResponse,
  mutationHash,
  RESPONSE_OPS,
  type RecordedMutation,
  type RecordedResponse,
  type ResponseContext,
  type ResponseMutation,
  type ResponseOp,
  type ResponseOperator,
} from './response.ts';

export const name = '@fiks/mutate';
