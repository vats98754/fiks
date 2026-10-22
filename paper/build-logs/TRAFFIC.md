# TRAFFIC build log

Branch `ws/TRAFFIC`, based on main `bd19858` (wave 1 complete: CORE, DOM2, BENCHX, LLMR merged).
Wave 2. Owns `packages/traffic/**`, `packages/cli/src/commands/traffic.ts`,
`deps-fragments/TRAFFIC.json`, this log. Imports `@fiks/llm` (LLMR), `@fiks/interfaces`,
`@fiks/domains`; the CLI command also uses `@fiks/bench` (`dirtyPaths`) and `@fiks/repro`
(`createWorktree`, P17), which `packages/cli` already depends on.

## What landed

- `packages/traffic` (`@fiks/traffic`):
  - `src/collect.ts`: `collect()` runs every agent x task x trial against the domain's MCP server
    on a fresh v1 vendor (one vendor per worker, `reset()` before every session) and keeps only
    the tool-call arguments. Output in `--out`:
    - `args.jsonl`: one canonical-JSON row (keys sorted) per call, in (agent, task, trial, seq)
      order, with `domain, stratum: "S-agent", agent, model, taskId, trial, seq, tool, args,
      [rawArgs], valid, [invalidReason], toolError, dedupeKey`. The first five plus `dedupeKey`
      are the `EnumRow` fields. No timing, cost or ids that vary between runs, so identical calls
      give identical bytes. `seq` keeps a session's order (a `get_order` after `create_order`
      must be replayed after it).
    - `args.jsonl.sha256` (`<hex>  args.jsonl`), `sessions.jsonl` (outcome, turns, tokens,
      costUsd, wallMs, transcript path per session), `meta.json` (server repo/ref/commit, vendor
      version/catalog/clock, fiks sha and dirty flag, agents and models, skipped agents with the
      reason, task source + sha256, tool names + sha256, per-agent counts, argsSha256),
      `transcripts/`, `llm-calls.jsonl` (LLMR usage log).
    - `valid` = known tool, JSON-object args, args satisfy the tool's `inputSchema`
      (`src/schema.ts`, the JSON Schema subset zod emits). Invalid calls are kept and flagged.
    - Never overwrites a run. A usage cap (`outcome: cap`) stops every later session on the
      Claude route (`skipped_cap`); the ollama route goes on. ollama sessions never run
      concurrently (`workers` applies to Claude only).
  - `src/agents.ts`: `claudeAgent()` = LLMR `agentSession` (OAuth token, `settingSources: []`,
    scrubbed env, temp HOME/cwd, no built-in tools, `allowedTools: [mcp__<domain>__*]`, system
    prompt override, JSONL transcript); the calls are read back from the transcript's last
    attempt (`callsFromTranscript`, with each `tool_result` error flag). `ollamaAgent()` = LLMR
    `connectStdioMcp` + `ollamaToolLoop` (temperature 0); non-object arguments are kept raw and
    not executed. Agent names: `opus`, `sonnet`, `haiku` -> `claude-opus-5-5`,
    `claude-sonnet-5-5`, `claude-haiku-5-5`; `ollama` -> the model approved in
    `packages/llm/ollama.json` (`qwen2.5:7b-instruct`, digest pinned).
  - `src/mcp.ts`: `sdkStdio()` starts a server whose `Domain.serverCommand` needs a `cwd` (shop
    and tracker use the relative `src/main.ts`) through `/bin/sh -c 'cd "$0" && exec "$@"'`,
    because the Agent SDK's stdio config has no `cwd`; `listServerTools()` (plain MCP client, no
    LLM, works under `FIKS_LLM_FORBID=1`).
  - `src/stub.ts`: the built-in deterministic stub (`--agent-stub builtin`): connects to the real
    server, picks one or two tools and synthesises arguments from (agent, task, trial) and the
    input schemas. No LLM call.
  - `src/tasks.ts` + `tasks/shop.json`: task prompts come from `--prompts <file>`, else
    `packages/traffic/tasks/<domain>.json`, else the registered `Domain.tasks`. The tracker's 20
    prompts are DOM2's `packages/vendor-tracker/tasks/prompts.json` (via `Domain.tasks`). The
    shop's registered tasks are the six graded bench tasks, so the 20 shop prompts are
    `packages/traffic/tasks/shop.json` (ids `s01`-`s20`), written by this builder without
    reading any contract file; they cover all four shop tools on the original catalog. PLAN 5.9
    says "the catalog author writes 20 task prompts"; for both domains they were in fact written
    by a builder (DOM2 for tracker, TRAFFIC for shop). Stated here so the paper can say so.
- `packages/cli/src/commands/traffic.ts` (P18 default export `{name: 'traffic', describe, run}`):
  `pnpm fiks traffic --domain <id> [--agents opus,sonnet,haiku,ollama] [--trials 3] [--tasks]
  [--prompts] [--ref] [--out] [--workers] [--max-turns] [--agent-stub builtin|<module>]
  [--allow-dirty] [--json]`.
  - Refuses a dirty fiks tree (exit 2) unless `--allow-dirty`, which never writes under
    `bench/results`, `bench/evidence` or `paper/results`.
  - Server code: a fresh local worktree of `Domain.repo.dir()` at `--ref` (default
    `Domain.seedTag`; P17, no fetch), removed afterwards, also on SIGINT/SIGTERM. The server runs
    directly (no fiks-proxy, so no receipt text reaches the agent and the oracle stays free of
    contract code), with `<baseUrlEnv>`, PATH and HOME only.
  - Vendor: `Domain.createVendor('original', {version: 'v1', now: frozenClock})`.
  - ollama: explicit `ollama SKIP: <reason>` (also in `meta.skipped`) when no model is approved
    or `ollamaReadiness()` is not ready (server down, model not pulled, digest mismatch).
  - `--agent-stub` replaces every agent, sets `FIKS_LLM_FORBID=1` and labels models `stub:<model>`.
  - Exit 3 when a usage cap stopped the Claude sessions.
- `deps-fragments/TRAFFIC.json`: `@fiks/traffic` into `packages/cli`.

For R9: `pnpm fiks traffic --domain shop --ref base-shop` and `--domain tracker --ref
seed-tracker-v1` (the tracker seed tag is cut at A0; until then only `dev-tracker-stub` exists,
which the live check below used) with the default `--agents opus,sonnet,haiku,ollama --trials 3`
on all 20 prompts, `--out paper/results/raw/...` from a clean tree. The ollama server must be
started (`ollama serve`) for R9 and stopped afterwards; the §8.2 wall-clock rule decides whether
`ollama` stays in `--agents`.

## Acceptance evidence (round 1)

Run in `/Users/anvayvats/fiks-wt/TRAFFIC` on `ws/TRAFFIC` (base `bd19858`). The machine load
average was 90-130 during these runs (other streams), which explains the test durations.

| Item | Command | Result |
|---|---|---|
| SETUP | `node scripts/apply-dep-fragments.mjs && pnpm install --no-frozen-lockfile` (+ `node scripts/ensure-shop-mcp.mjs`, `node scripts/ensure-tracker-mcp.mjs` for the clones) | "applied (TRAFFIC.json): packages/cli: @fiks/traffic"; install ok; `packages/cli/package.json` and `pnpm-lock.yaml` modified locally, not committed |
| Unit | `pnpm vitest run packages/traffic` | 4 files, 38 tests pass (86 s) |
| [LIVE] | `pnpm tsx packages/llm/src/live-lock.ts --run --label TRAFFIC-live --timeout-min 60 -- sh -c "pnpm fiks traffic --domain shop --ref base-shop --tasks s01,s05,s07 --trials 1 --allow-dirty --out $S/live-shop; pnpm fiks traffic --domain tracker --ref dev-tracker-stub --tasks t01,t04,t05 --trials 1 --allow-dirty --out $S/live-tracker"` (ollama server started for the item, stopped after; readiness `{ready: true, model: qwen2.5:7b-instruct, digest 845dbda0...}`) | lock acquired after 2 ms, released after 559 s, exit 0. **shop** (base-shop = 0fde2b4): every session `ok`; opus 4/4, sonnet 4/4, haiku 4/4 valid calls, each on 3/3 tasks; ollama 4/4 valid calls, >= 1 valid call on each of s01, s05, s07; 16 rows, sha256 `b08cbe3e...e104`. Calls e.g. `search_products {"query":"Clarity 32"}`, `create_order {"items":[{"product_id":"p-1007","quantity":1}]}`, `get_order {"order_id":"o-5001"}`. API-price estimate: opus $0.036, sonnet $0.020, haiku $0.020. **tracker** (dev-tracker-stub = 1b8547a, tracker registered by DOM2's `10-tracker.ts`, prompts from `Domain.tasks`): every session `ok`; opus 5/5, sonnet 4/4, haiku 5/5 valid calls on 3/3 tasks; ollama 4/4 valid calls, >= 1 on each of t01, t04, t05; 18 rows, sha256 `213dfd50...05e9`. Calls e.g. `search_issues {"assignee":"alice","state":"open","type":"bug"}`, `transition_issue {"key":"TRK-103","to":"in_progress"}`, `add_comment {...,"issue_key":"TRK-119"}`. No output file contains the OAuth token (scripted scan: 0 files). ollama wall time 21-90 s per session |
| Rows carry agent, model, task id, trial; stub hashes identical | unit `collect.test.ts` + `cli-traffic.test.ts` (fixture domain), and on the real servers: `pnpm fiks traffic --domain shop --ref base-shop --tasks s01,s09,s20 --agent-stub builtin --allow-dirty` twice, `--domain tracker --ref dev-tracker-stub --tasks t01,t04,t05` twice | shop: 51 rows, both runs `58b310c8...0106`; tracker: 60 rows, both runs `bfb0a8f8...3a0f`. Unit: identical sha256 for 1 vs 3 workers and repeated runs; every row has agent/model/taskId/trial/seq |
| No package.json / lockfile in the diff | `git diff --name-only bd19858 HEAD` | lists only `deps-fragments/TRAFFIC.json`, `packages/cli/src/commands/traffic.ts`, `packages/traffic/**`, `paper/build-logs/TRAFFIC.md` |
| typecheck, lint | `pnpm typecheck && pnpm lint` | both exit 0 (lint: 492 files) |
| Full suite | `with-lock suite pnpm test` | 110 files: 108 passed, 1 skipped, 1 failed; 988 tests passed, 7 skipped, 1 failed (1114 s; load avg 60-130). The `@fiks/traffic` files all pass. The one failure is not TRAFFIC code: `packages/contracts/test/ensure-shop-mcp.test.ts` "a clone on main ends detached at the pinned ref" asserts that the source clone's `main` differs from the pin, but this worktree's `.work/shop-mcp` is a fresh clone made after the orchestrator fast-forwarded shop-mcp `main` to `base-shop` (both `0fde2b4`), so the precondition no longer holds. Owner: VOCAB / orchestrator (packages/contracts is not TRAFFIC's). Transient retries seen in the log (bench cli-bench 4-worker, sandbox push-alias, sandbox container write) passed on retry |

## Not done here / for downstream

- R9 itself (20 prompts x 4 agents x 3 trials per domain) is a run step; nothing under
  `paper/results/raw` was written by this build.
- HOLD replays the rows (criterion 5). Rows of one session should be replayed in `seq` order on
  one fresh vendor, because write calls change later reads; `toolError` is what the base server
  answered during collection and is informational only.
- At merge the orchestrator applies `deps-fragments/TRAFFIC.json` and regenerates the lockfile
  (new importer `packages/traffic`).
