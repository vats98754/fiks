# LLMR build log

Branch `ws/LLMR`, based on main `c144b03` (CORE-SEED merged). Wave 1; depends only on CORE-SEED
(`@fiks/interfaces` for `TokenUsage`). Owns `packages/llm/**` and this file. No dependency
fragment: no other package imports `@fiks/llm` yet (ORCH adds `deps-fragments/ORCH.json`).

## What landed (`packages/llm`, `@fiks/llm`)

- `complete({model, system, prompt, schema})` (`src/complete.ts`): one Agent SDK `query` with
  `tools: []`, `allowedTools: []`, `systemPrompt` = our system text (override), `settingSources: []`,
  `strictMcpConfig: true`, `mcpServers: {}`, `persistSession: false`, an empty temp cwd and a
  scrubbed env with a temp HOME (both removed afterwards). A schema (zod, or a JSON Schema object
  validated through `z.fromJSONSchema`) is sent as `outputFormat: json_schema`; the result is
  `structured_output`, else JSON parsed from the text (a ```json fence is tolerated), then
  validated. Default `maxTurns: 3` (structured output takes 2 turns on Haiku, see smoke).
  Throws `LlmCapError` (cap, never retried), `LlmInfraError` (429/overload/5xx/transport/unknown
  after 3 retries with exponential backoff and jitter), `LlmOutputError` (bad JSON, schema
  mismatch, max turns or budget: model outcomes, not retried), `LlmConfigError` (no token, auth).
- `agentSession({cwd, allowedTools, model, budget, ...})` (`src/session.ts`): built-in tools =
  the non-`mcp__` entries of `allowedTools`; `disallowedTools: ['WebFetch','WebSearch']` unless
  `allowWebTools: true` (asking for a web tool without it throws `LlmConfigError` before any
  call); `settingSources: []`; `permissionMode: 'dontAsk'`, or `'default'` with no auto-allow when
  a `canUseTool` hook is given (so SAFE/SBX hooks see every call); optional `systemPrompt`,
  `mcpServers`, `outputSchema`, `extraEnv` (names logged, never values). Full JSONL transcript:
  `fiks_session_header` (cwd, settingSources, tools, allowedTools, disallowedTools, webTools,
  permissionMode, envKeys, budget, prompt), every SDK message, `fiks_attempt`/`fiks_retry` markers,
  `fiks_session_footer`. It returns (does not throw) `{outcome: ok | model_error | infra_error |
  cap, ...}` with cost, tokens, turns, wallMs, spawnMs, retry/429/overload counts and cap events,
  because callers need the transcript and cost of failed sessions. Retries (3) only when the
  failed attempt produced no model output (a worktree may already have changed otherwise).
  Default per-attempt wall cap 90 min; a timeout after model output is a model outcome, before
  any output it is infra (PLAN 9.3).
- Env scrub (`src/env.ts`): built from an allow-list (`PATH`, `LANG`, `LC_ALL`, `TZ`, temp `HOME`,
  `TMPDIR`, `DISABLE_AUTOUPDATER=1`, `CLAUDE_AGENT_SDK_CLIENT_APP`, `CLAUDE_CODE_OAUTH_TOKEN`), never
  by copying `process.env`, so no API key, GitHub token or git identity reaches Claude Code. No
  token → `LlmConfigError` before spawning. `packages/llm/src` contains neither the API-key
  variable name nor `@anthropic-ai/sdk`.
- Cap classifier (`src/classify.ts`, `classifyLlmFailure`): input is an Error, a string or an SDK
  message (`rate_limit_event`, `api_retry`, assistant message with `error`, error result).
  Kinds: `cap` (with `resetAt` ISO and `limitType` when known), `rate_limit` (429), `overload`
  (529), `server` (5xx), `transport`, `auth`, `invalid_request`, `forbidden`, `unknown`. Usage-limit
  text wins over a 429 status (the subscription limit can arrive as a 429). `resetAt` comes from
  `resetsAt` on a rejected `rate_limit_event`, `|<epoch>` text, an ISO instant, or "resets 3pm
  (Area/City)" (next such wall time in that zone).
- Cost/token logging (`src/usage.ts`): one JSONL line per call to `logPath` or `$FIKS_LLM_LOG`
  (fn, model, label, runKey, outcome, failure, attempts, retryEvents, costUsd, tokens from
  `modelUsage`, turns, wallMs, spawnMs, transcriptPath).
- ollama client (`src/ollama.ts`): `ollamaChat` (OpenAI-compatible `/v1/chat/completions`, tools,
  `json_object`, tokens/s, 3 retries on retryable kinds), `connectStdioMcp` + `ollamaToolLoop`
  (lists MCP tools, maps them to OpenAI function tools, runs calls until a plain answer or
  `maxTurns`; non-object arguments are recorded, not executed), `ollamaReadiness` (approved,
  reachable, pulled, digest equal to the pin). The approved model is pinned in
  `packages/llm/ollama.json`.
- `FIKS_LLM_FORBID=1`: `complete`, `agentSession`, `ollamaChat`, `ollamaToolLoop`,
  `connectStdioMcp`, `ollamaReadiness` and the live probe throw `LlmForbiddenError` as their first
  statement, before any env, temp dir, fetch or query (also for injected fake queries).
- `src/probe.ts` (T0): `--concurrency 1,2,4 [--repair-workers 1,2,4,6] [--ollama] [--dry]
  [--sessions-per-level n] [--authoring-model m] [--repair-model m] --out <path>`; `--validate
  <file>`; `--print-schema`. Authoring sessions (Read/Glob over a small API doc, JSON-schema
  output; default `claude-opus-5-5`, max(4, 2c) sessions per level) and repair-like workers
  (Read/Grep/Glob/Edit on a one-file cents bug; default `claude-haiku-5-5`, c sessions per level),
  pooled at each concurrency. Per level: ok/model/infra/cap counts, attempts/h (finished attempts
  per wall hour), 429 and overload events, share of sessions with any 429/overload, cap events,
  spawn overhead (query call → init message: mean/median/p90), cost and tokens. A cap event stops
  all further Claude sessions (`capStopped` with `resetAt`); ollama is still measured. Output is
  validated against `ThroughputSchema` (`src/throughput.ts`, `schema: 'fiks-throughput/1'`) before
  writing; `recommendedConcurrency` applies the T0 rule (largest c with < 2% 429/overload and no
  cap). `--dry` plays `dryDeps()` (fake query: every 5th session sees one 429 retry; fake ollama),
  needs no token, makes no network call, and refuses an `--out` under `paper/results`. A live
  probe refuses while `$HOME/.fiks/build-swarm.active` exists.
- `src/live-lock.ts`: `--run [--label s] [--timeout-min n] -- <cmd>`, `--status`, `--break`.
  `mkdir $HOME/.fiks/live.lock` + `holder.json` {pid, host, label, cmd, cwd, startedAt, timeoutMs}.
  A second `--run` prints who holds it and polls. Stale = older than its recorded timeout
  (command timeout + 30 s release margin) or holder pid gone on this host: reported (exit 3), never
  broken; `--break` removes only a stale lock and logs it. Refuses (exit 2) while
  `$HOME/.fiks/run.active` exists, also while waiting. The command is killed at its timeout
  (exit 124). Log: `$HOME/.fiks/live-lock.log` (acquired/released with waitedMs, durationMs, exit;
  stale_reported; broken).
- `src/smoke.ts`: Claude smoke (5 `complete` calls with zod schemas + one `agentSession`
  transcript check) and `--ollama` (JSON chat + MCP tool loop on `src/fixtures/calc-mcp.mjs`, or
  an explicit `SKIP: <reason>`).
- `src/fake.ts`: `fakeQuery` / `fakeOllamaFetch` for tests, `probe --dry` and downstream stub
  tests (BLIND, RUN can inject them via `deps`).

## External action (approved, PLAN 8.0)

- ollama model: `qwen2.5:7b-instruct` (7.6B, Q4_K_M, tools capability), pulled with
  `ollama pull` on 2026-10-21; digest
  `845dbda0ea48ed749caafd9e6037047aa19acfcfd82e704d7ca97d631a0b697e` pinned in `ollama.json`.
  Chosen over the already-present `llama3-groq-tool-use` (a tool-use fine-tune, weak for the
  ideation half of A1). The ollama server was started (`ollama serve`) for the smoke and stopped
  afterwards; T0/A1/R9 must start it.

## Acceptance evidence (round 1)

| Item | Command | Result |
|---|---|---|
| SETUP | `node scripts/apply-dep-fragments.mjs && pnpm install --no-frozen-lockfile` | "nothing to apply"; install ok (lockfile regenerated locally, not committed) |
| Cap classifier unit | `pnpm vitest run packages/llm` | 7 files, 44 tests pass (after `node scripts/ensure-shop-mcp.mjs`, which the cli project config needs) |
| No API key / SDK | `grep -R "ANTHROPIC_API_KEY\|@anthropic-ai/sdk" packages/llm/src` | no output, exit 1 |
| [LIVE] smoke | `pnpm tsx packages/llm/src/live-lock.ts --run --label "LLMR smoke" --timeout-min 20 -- pnpm tsx packages/llm/src/smoke.ts --model claude-haiku-5-5` | JSON parsed 5/5 (content correct 5/5), each line with costUsd (≈ $0.0045–0.0051) and tokens; lock acquired after 2 ms, released after 53.9 s, exit 0 |
| Probe dry | `pnpm tsx packages/llm/src/probe.ts --concurrency 1,2,4 --dry --out $TMPDIR/throughput.json` | exit 0; `--validate` → valid; ollama section `measured` (mock); `git status --porcelain paper/results` empty |
| Session transcript | same smoke | header `settingSources: []`, `cwd` = the temp cwd, `disallowedTools: [WebFetch, WebSearch]`; init tools `["Glob","Read"]`; all 7 checks true |
| ollama smoke | `pnpm tsx packages/llm/src/smoke.ts --ollama` | exit 0: JSON chat parsed; tool loop called `add {a:1234,b:4321}` → answer "5555"; with the server unreachable: `ollama SKIP: ollama server not reachable at ...`, exit 0 |
| live-lock unit | `test/live-lock.test.ts` | one holder; second `--run` logs "waiting: held by pid N (A)" and starts after A ends (A-start, A-end, B-start, B-end); stale lock → exit 3, lock kept, `stale_reported` logged; `--break` refuses a fresh lock; `run.active` → exit 2 |
| FIKS_LLM_FORBID unit | `test/forbid.test.ts` | all entry points throw `LlmForbiddenError`; mocked SDK `query` and `fetch` never called |
| typecheck, lint | `pnpm typecheck && pnpm lint` | both exit 0 |
| Full suite | `with-lock suite pnpm test` | 35 files, 202 tests pass |

## Not done here / for downstream

- The live probe (T0) is a run step: not run during the build (it refuses while
  `build-swarm.active` exists). Its live path shares all code with the tested dry path except the
  real `query`/`fetch`.
- RSS per repair worker is not in the probe; R1 measures it (PLAN 8.1 R1).
- `pnpm-lock.yaml` gains the `packages/llm` importer at merge (orchestrator regenerates it).
- The repair runner (`packages/repair/src/runner.ts`) and bench agent keep their own `query`
  calls; P14 covers non-repair calls. ORCH/ARMS/BLIND/TRAFFIC import `@fiks/llm` in wave 2.
