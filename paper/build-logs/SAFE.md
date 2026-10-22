# SAFE build log

Branch `ws/SAFE`, based on main `c144b03` (CORE-SEED merged). Wave 1. Owns `packages/repair/**`
and this file. No external actions (no pushes, repos, installs or PRs). No LLM call was made:
every runner test uses a fake `query`, the stub runner or a mocked SDK.

## What landed (packages/repair)

| Deliverable | Where |
|---|---|
| Bash rewrite to `backend.exec` (P1). Raw mode with no backend leaves the allowed command unchanged (today's host behaviour). With a backend, or in strict mode (host backend), `canUseTool` runs the allow-listed `pnpm` command via `backend.exec` with env `{PATH, CI=1, HOME=<temp>}`, sanitizes the output, and rewrites the agent's Bash to `cat <relay file>; exit <code>`. | `src/permissions.ts` `makeCanUseTool` |
| `claudeEnv()` returns only `CLAUDE_CODE_OAUTH_TOKEN`, `PATH` and a fresh temp `HOME`. The SDK passes `env` as-is (it is not merged with `process.env`). | `src/env.ts` |
| `mayRead` resolves with `fs.realpathSync.native` (longest existing prefix plus the not-yet-existing tail; a dangling link is refused). Symlinks that resolve outside the worktree and `..` escapes are refused. `mayWrite` applies the edit guard to both the given path and the resolved path. `maySearch` (Grep roots) and `mayGlob` use the same rules. | `src/guard.ts` |
| CLI fallback runner (Read, Edit, Write and allow-listed Bash; no Glob since round 4): it cannot call `mayRead`, so it refuses to start (`outcome: 'refused'`) when `escapingSymlinks(worktree)` is non-empty, in strict mode, with a backend, on resume, with create-only paths, or with a non-default edit guard. It also passes `--disallowedTools Read(./node_modules/**)`. `defaultRunners({cliFallback: false})` removes it. | `src/runner.ts` |
| `--trace-format raw\|strict`. `parseTraceFormat` defaults to raw. In strict mode, reads of `test/fixtures/**`, `test/repro/*.json`, `test/traces/**` and `.alerts/**` are denied, checked case-insensitively, against both the lexical and the resolved path. Grep may not start at or above those directories. `strictTrace`/`renderStrictTrace` produce typed leaves and a typed diff against the v1 recording, with field paths matching `^[A-Za-z_][\w.\[\]]{0,63}$`, a 64 KB cap and no vendor free text. `sanitizeGateOutput` strips ANSI codes and hidden Unicode and scrubs local paths; in strict mode it also replaces every quoted non-token literal with `<text len=N>`, keeps only printable ASCII, and cuts long lines. `buildPrompt({traceFormat: 'strict'})` uses all of the above. | `src/strict.ts`, `src/prompt.ts` |
| Raw mode: `.alerts/**` and `test/fiks/**` (and everything else in the worktree) are readable. | `src/guard.ts` |
| `createPr` allow-list (P5). The repo must be `vats98754/<name>` or a bare `<name>`. The function resolves it with `gh repo view vats98754/<name> --json owner,isFork,parent` and refuses (`PrRefusedError`) on an owner other than vats98754, on a fork whose parent owner is not vats98754, on a missing `isFork`, or on a head owner other than vats98754. Every write call (`label create`, `pr create`) passes `--repo vats98754/<name>`. A run key always disables the PR. An arm disables it by default. When disabled, gh is not invoked at all. The PR body gains a Provenance section: the trace is untrusted input, plus optional sha256 hashes. | `src/pr.ts` |
| Runner (P10): 3 tries with 5 s × 4ⁿ backoff. Transient failures are thrown errors or `is_error` results with status 408/409/425/429/5xx/529, `rate_limit`/`overloaded`/`server_error`, or network errors. When the tries run out the outcome is `infra_error`. Auth and billing errors give `infra_error` at once. A retry after a session started resumes that session with a "continue" message instead of resending the task. `costUsd` and `tokens {in, out, cacheRead, cacheCreate}` come from the SDK result's `usage`. `onCandidate(diff, stage)` runs before every allow-listed check command and in `localGate`. `job.resume {sessionId, message, turnsUsed, costUsd}` continues a session with the remaining turn and dollar budget, and makes no call when the budget is spent. | `src/runner.ts`, `src/gates.ts`, `src/env.ts` `candidateDiff` |
| Edit guard from `allowedEditPaths` (regex sources; default `['^src/.+\\.ts$']`, so `REPAIR_ALLOWED = editGuard()`). Optional `allowedNewFilePaths` are create-only paths, e.g. an agent-written repro test: a file that existed before can never be overwritten. | `src/guard.ts`, `src/permissions.ts` |
| Stub runner: `stubRunner(script)` / `loadStubScript(file)`. Ops are write, edit, newTest, bash and read. Each op is one turn through the same `makeCanUseTool`. The turn budget is shared across resumes (`sessions[]`, ids `stub-session-<n>`). The runner never imports or calls the SDK. Both the SDK runner and the CLI runner throw `LlmForbiddenError` before any call when `FIKS_LLM_FORBID=1`. | `src/stub.ts`, `src/env.ts` |

| Round 2: guard as an SDK PreToolUse hook. Claude Code 0.3.289 auto-allows Read/Glob/Grep inside the cwd (`decisionReason {type:'mode', mode:'default'}`) and read-only Bash before it calls `canUseTool`, so `canUseTool` alone let a strict-mode agent Read or `cat`/`grep` `test/fixtures/**`, `test/repro/*.json`, `test/traces/**` and `.alerts/**`, and let read-only Bash skip `mayRun` and the backend rewrite in every mode. `sdkToolGuard(guard)` now passes the same `makeCanUseTool` decision as `hooks.PreToolUse` (no matcher, so every tool; 16 min hook timeout for a backend `pnpm test`): deny with the guard's message, or allow with the guard's `updatedInput` (the Bash relay). `canUseTool` stays as a backstop and shares a per-`tool_use_id` memo, so a call reaching both runs the guard (and a backend command and its candidate capture) once. | `src/runner.ts` `sdkToolGuard` |
| Round 3: retries share one budget. Each retry's `maxTurns` and `maxBudgetUsd` are what is left after the earlier tries of the same call (their `num_turns` and `total_cost_usd`; a try that throws without a result spends the distinct assistant replies it was seen to make, cost unknown). Before a retry the runner stops with `max_turns` or `max_budget` when either cap is spent. `turns` (and so `sessionTurns`) is the sum over all tries, no longer the last try's count. | `src/runner.ts` `createAgentSdkRunner` |
| Round 4: (1) `mayRun` checks the raw command string before splitting: `^pnpm(?: [\w./-]+)+$`, words joined by single spaces, so a newline, CR, tab, NUL, U+2028 or any other control/whitespace character (which the old `\s+` split folded away, letting `pnpm test\ncurl example.com` through as an unchanged raw-mode allow that the PreToolUse hook then passed to the shell) is denied; `commandArgv` splits on single spaces. (2) The CLI fallback no longer offers Glob: `--tools Read,Edit,Write,Bash` and no `Glob` in `--allowedTools`, because a Glob's `path` argument is not covered by `Read(./**)` and under `dontAsk` it could list directories outside the worktree. The argv is built by the exported `claudeCliArgv(job)`. | `src/guard.ts`, `src/permissions.ts`, `src/runner.ts` `claudeCliArgv` |

`RunnerResult`'s new fields (`outcome`, `tokens`, `sessionId`, `tries`, `sessionTurns`,
`denials`) are optional, so the existing CLI oracle runners still compile unchanged.

## Notes for consumers (ORCH, ARMS, RBA, RUN, SEC)

- Thread through `RunnerJob`: `traceFormat`, `allowedEditPaths` (= `Domain.allowedEditPaths`),
  `allowedNewFilePaths` (REPRO-AGENT), `backend` (SBX DockerExecBackend), `onCandidate`, `resume`.
- `packages/cli/src/commands/repair.ts` (not owned by SAFE) still calls `gh pr create` directly
  and passes `REPAIR_ALLOWED`. ORCH should switch it to `createPr(...)`, `editGuard(domain.allowedEditPaths)`,
  `defaultRunners({cliFallback: !experiment})` and `localGate(wt, spec, {onCandidate})`.
- The relay design: the SDK's own Bash prints a file that fiks wrote. The check itself already ran
  through `backend.exec` inside `canUseTool`, so the SDK never executes the agent's command.
- `@fiks/interfaces` was added to `packages/repair/package.json` directly (SAFE owns it). No dep
  fragment is needed. The local `pnpm-lock.yaml` change from `pnpm install --no-frozen-lockfile`
  is not committed: the orchestrator regenerates the lockfile at merge.

## Evidence, round 3 (2026-10-22, ws/SAFE rebased onto main `6157cb4`, MON merged)

- Rebase: `git rebase main` (clean, no conflicts; MON touches no `packages/repair` file).
  `git merge-base --is-ancestor main ws/SAFE` -> true.
- SETUP re-run: `node scripts/apply-dep-fragments.mjs` ("nothing to apply"), `pnpm install --no-frozen-lockfile`,
  `.work/shop-mcp` present. The only lockfile change is `@fiks/interfaces` under `packages/repair` (not committed).
- Finding (retries reset the per-attempt budget): repro now in `test/safe-runner.test.ts`
  `retries share one budget: failed tries come off the caps, and turns are summed`. Two 429 results of
  12 turns / $3 each, then a 5-turn / $1 success, caps 20 turns / $5: per-try `maxTurns` [20, 8] and
  `maxBudgetUsd` [5, 2], no third try, outcome `max_turns`, turns 24, sessionTurns 24, costUsd 6. Also:
  budget-only exhaustion -> `max_budget` ([5, 2], costUsd 5.5); within the caps the third try gets [20, 8, 5] /
  [5, 4, 3] and turns 20 = 12 + 3 + 5; a try that throws after two distinct replies (m1 twice, m2) leaves
  `maxTurns` 18 for the next try and turns 7.
- Mutation check: with `src/runner.ts` from round 2, that test fails
  (`expected { maxTurns: [ 20, 20, 20 ], ... } to deeply equal { maxTurns: [ 20, 8 ], ... }`; 1 failed, 12 passed).
- `pnpm vitest run packages/repair`: 6 files, 74 tests passed.
- `pnpm typecheck`: exit 0. `pnpm lint`: "Checked 157 files ... No fixes applied", exit 0.
- Regression: `pnpm vitest run packages/cli/test/repair.test.ts` (run without the suite lock: one file, and the lock queue held several full-suite runs): 1 file, 12 tests passed, exit 0.

## Evidence, round 2 (2026-10-21, ws/SAFE on main `c144b03`; superseded: main moved to `6157cb4` with MON, see round 3)

- SETUP: `node scripts/apply-dep-fragments.mjs` ("nothing to apply"), `pnpm install --no-frozen-lockfile`,
  `node scripts/ensure-shop-mcp.mjs` (`.work/shop-mcp` at `7bf2e66`). Without the ensure step a fresh
  worktree fails at vitest startup (`packages/cli/vitest.config.ts` runs `git -C .work/shop-mcp worktree add`);
  the SETUP line in WORKSTREAMS.json needs it added (orchestrator-owned file).
- `pnpm vitest run packages/repair`: 6 files, 73 tests passed. New: `query options carry a PreToolUse
  guard hook; strict Read/cat of a fixture is denied there` (Read of `test/fixtures/v1/a.json`, relative
  and absolute, `cat test/fixtures/v1/a.json`, `grep -r price test/fixtures` and Grep on `test/fixtures`
  denied by the hook; Read of `src/a.ts` allowed) and `the hook relays allow-listed Bash through the
  backend once, even if canUseTool is asked too` (one backend exec; `cat src/a.ts` denied in raw mode).
- Mutation check: with the `hooks:` option removed from the query call, both new tests fail (2 failed, 10 passed).
- `pnpm typecheck`: exit 0. `pnpm lint`: exit 0.
- Regression: `with-lock suite pnpm vitest run packages/cli/test/repair.test.ts`: 1 file, 12 tests passed.

## Evidence, round 1 (run 2026-10-21 on this branch)

- `pnpm vitest run packages/repair`: 6 files, 71 tests passed.
- `pnpm typecheck`: exit 0. `pnpm lint`: "Checked 146 files ... No fixes applied", exit 0.
- Regression: `with-lock suite pnpm vitest run packages/cli/test/repair.test.ts`: 1 file, 12 tests
  passed (offline bare remote + fake gh; exercises guard, gates, prompt and prBody through the
  existing CLI repair pipeline).
