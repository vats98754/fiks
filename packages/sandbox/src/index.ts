// @fiks/sandbox (stream SBX): Linux sandbox images, the Docker ExecBackend, hermetic local CI,
// canary probes, the git push shim and execFiks for the fiks-tools mount (paper/PLAN.md P1, P4).
export {
  assertSafeEnv,
  CONTAINER_PUSH_LOG,
  DEFAULT_LIMITS,
  DockerExecBackend,
  type DockerExecBackendOptions,
  EGRESS_DENIAL,
  egressDenials,
  type Limits,
  type Mount,
  mountSpec,
  type PushRecord,
  parsePushLog,
  SANDBOX_ENV,
  SANDBOX_PATH,
  type SandboxExecOptions,
} from './backend.ts';
export {
  BASE_IMAGE,
  buildRepoImage,
  lockImporters,
  manifestFiles,
  manifestHash,
  type RepoImage,
} from './build.ts';
export { buildToolsImage, FIKS_ROOT, forbiddenEntries, type ToolsImage } from './build-tools.ts';
export {
  type Check,
  type CheckInput,
  type CiLocalOptions,
  type CiResult,
  ciLocal,
  hermetic,
  parseWorkflow,
  RUN_SHELL,
  runPreGate,
  type StepResult,
  UnmirroredWorkflowError,
  type WorkflowStep,
} from './ci-local.ts';
export { assertDocker, docker, dockerCliEnv, imageDigest } from './docker.ts';
export { withLock } from './lock.ts';
export { logEgressDenial, makeCanaries, type ProbeResult, runCanaryProbes } from './probes.ts';
export { type GitShim, installGitShim, readPushLog, realGit, shimScript } from './shim.ts';
export {
  ensureToolsVolume,
  execFiks,
  FIKS_MAIN,
  FIKS_SANDBOX_ENV,
  FIKS_TSX,
  TOOLS_DIR,
  toolsMounts,
} from './tools.ts';
