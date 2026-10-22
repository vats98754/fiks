// @fiks/traffic: the held-out multi-model traffic collector (PLAN 5.9, oracle criterion 5,
// stratum S-agent). `pnpm fiks traffic` (packages/cli/src/commands/traffic.ts) is the entry point.

export { ollamaReadiness } from '@fiks/llm';
export {
  AGENT_NAMES,
  type AgentName,
  type AgentRoute,
  CLAUDE_MODELS,
  callsFromTranscript,
  claudeAgent,
  ollamaAgent,
  ollamaModel,
  type SessionCall,
  type SessionInput,
  type SessionOutcome,
  type SessionOutput,
  type SessionTokens,
  type TrafficAgent,
  zeroTokens,
} from './agents.ts';
export { canonical, dedupeKey, sha256 } from './canonical.ts';
export {
  type AgentSpec,
  type CollectOptions,
  type CollectResult,
  collect,
  rowsOf,
  type SessionRecord,
  type SessionStatus,
  type SkippedAgent,
  STRATUM,
  type TrafficRow,
  trafficSystem,
  type VendorLike,
} from './collect.ts';
export { connectMcp, listServerTools, type McpServerSpec, sdkStdio, type ToolDef } from './mcp.ts';
export { type JsonSchema, schemaError } from './schema.ts';
export { stubAgent, synthArgs } from './stub.ts';
export {
  defaultTaskFile,
  loadTaskFile,
  resolveTasks,
  selectTasks,
  type TaskSet,
  type TrafficTask,
  tasksFromDomain,
} from './tasks.ts';
