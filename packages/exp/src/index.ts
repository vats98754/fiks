// @fiks/exp: the experiment runner (stream RUN, PLAN 8). Entry point: src/main.ts.

export { ARMS, type ArmName, armArgv, assertArmArgv, gradeArgv, prepareArgvs, showcaseArgv } from './argv.ts';
export { classifyAttempt, EXIT_CAP, EXIT_INFRA } from './classify.ts';
export { DEV_BUILTIN, type DriftInput, devInputs, filterDrifts, manifestInputs } from './inputs.ts';
export { loadRegistry, outcomeRows, Registry, type RegistryEvent } from './registry.ts';
export { rngFor, seededShuffle, stratifiedSubset } from './rng.ts';
export { getRun, RUN_IDS, RUNS, type RunDef } from './runs.ts';
export { type Block, buildBlocks } from './schedule.ts';
export { FORBIDDEN_STATUS_WORDS, StatusSchema, statusJsonSchema } from './status.ts';
export {
  assertStrictlyDecreasing,
  configSteps,
  DEFAULT_FIT,
  DEFAULT_PARAMS,
  fit,
  type K1Step,
  ollamaRule,
  PROJECTED_RUNS,
  projectRuns,
} from './steps.ts';
