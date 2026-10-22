// @fiks/llm: the one route for every non-repair LLM call (PLAN P14, P10). Claude calls go through
// the Agent SDK `query` on the OAuth token; the local model goes through ollama's OpenAI-compatible
// API. FIKS_LLM_FORBID=1 makes every entry point throw LlmForbiddenError before any I/O.

export {
  classifyLlmFailure,
  isCap,
  type LlmFailure,
  type LlmFailureKind,
  parseResetAt,
  RETRYABLE,
} from './classify.ts';
export {
  type CompleteOptions,
  type CompleteResult,
  complete,
  extractJson,
  type JsonSchema,
} from './complete.ts';
export { OAUTH_ENV, scrubbedEnv } from './env.ts';
export {
  assertLlmAllowed,
  FORBID_ENV,
  LlmCapError,
  LlmConfigError,
  LlmForbiddenError,
  LlmInfraError,
  LlmOutputError,
} from './errors.ts';
export { type FakeScript, fakeOllamaFetch, fakeQuery } from './fake.ts';
export {
  type ChatMessage,
  connectStdioMcp,
  type McpToolSource,
  ollamaBaseUrl,
  ollamaChat,
  ollamaConfig,
  ollamaReadiness,
  ollamaToolLoop,
  type ToolLoopResult,
} from './ollama.ts';
export type { LlmDeps, QueryFn } from './query.ts';
export {
  type AgentSessionOptions,
  type AgentSessionResult,
  agentSession,
  type SessionBudget,
  sessionQueryOptions,
  WEB_TOOLS,
} from './session.ts';
export { recommendConcurrency, type ThroughputReport, ThroughputSchema } from './throughput.ts';
export { type LlmCallLog, type LlmOutcome, logCall } from './usage.ts';
