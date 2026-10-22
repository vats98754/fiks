# BENCHX build log

Branch `ws/BENCHX`, based on main `c144b03` (CORE-SEED merged). Wave 1; no external actions,
no live (LLM) calls. Every test uses a stub agent or a fake SDK `query()`.

## What landed

- `packages/bench/src/agent.ts`: `runAgent(input, {query?})`.
  - Records `costUsd` (SDK `total_cost_usd`, an estimate) and `usage {input, output, cacheRead,
    cacheCreate}`, summed over `modelUsage` when present and taken from `usage` otherwise.
  - Sets `infraError` only when no answer was submitted and the cause is the infrastructure: a
    thrown SDK/transport error, an `is_error` API result (429, 5xx, overload, auth), an
    `error_during_execution` result, an infra-class assistant `error`, or a stream with no result.
    `error_max_turns` and `error_max_budget_usd` are model outcomes (PLAN 9.3).
  - The system prompt and the MCP server name are parameters. The shop keeps the old prompt
    byte for byte (`SHOP_SYSTEM`).
- `packages/bench/src/runner.ts`: `runTrials` and `vendorHarnessFactory`, both domain-agnostic.
  - Tasks are `BenchTask`, the same shape as `DomainTask`. A `HarnessFactory(worker)` gives each
    worker its own vendor, the trial's server command and the trial's checked calls.
  - Each infra error gets up to 3 retries, with exponential backoff and a vendor reset before
    every try. Cost and tokens are summed over tries. A trial that fails every try is
    `outcome: 'infraError'`.
  - Results come back in task, then trial order, whatever the worker count.
- `packages/bench/src/pool.ts`: `runPool`, a worker pool that returns results in item order.
- `packages/bench/src/stats.ts`: `passHatKCurve`, `maxK`, `wilson` and `passHatKWithCi`.
  - `passHatKCurve` gives the unbiased pass^1..K, with K = the smallest graded per-task count.
  - `passHatKWithCi` uses a task-level Wilson interval. It is descriptive only.
  - The legacy `passHatK` is unchanged.
- `packages/bench/src/summary.ts`: `summarizeRun` and `buildRunsSummary`.
  - Runs are keyed `${phase}@${model}@${monitor}@${arm}`, and every run is kept. Each run gets a
    `complete` flag; each group gets `latestComplete`.
  - Older runs map to `contracts`, or to `none` when `proxy: false`. Arm defaults to `none`.
  - Per run: pass^k with intervals, Wilson rates, `infraErrors`, `droppedTasks`, cost and tokens.
- `packages/bench/src/git.ts`: `dirtyPaths` and `assertCleanTree`. The dirty check ignores
  `bench/results`, `bench/evidence` and `paper/results/raw`.
- `packages/cli/src/commands/bench.ts`:
  - The `bench()` named export keeps its old signature, so the current `main.ts` and CORE's
    future `legacy/bench.ts` still work. It adds `domain`, `monitor`, `arm`, `workers`, `retries`,
    `backoffMs`, `maxTurns`, `allowDirty`, `root` and `agent`.
  - It refuses a dirty tree before the credential check.
  - It never overwrites an existing run directory.
  - A/B fetch only when the seed tag is missing; C fetches as before.
  - The worktree name is unique per process.
  - It writes `trials.jsonl` again in canonical order once the run ends.
  - The domain comes from the registered `Domain` when there is one, else the built-in shop.
  - The default export is `{name: 'bench', describe, run(argv)}`. It accepts every pre-P18 global
    flag (it notes the ones it does not use) and adds the new flags and `--help`. Exit 2 means a
    usage error or a dirty tree.
- `packages/cli/src/commands/summarize.ts`:
  - `summary.json` stays the legacy view, byte-compatible for every run before BENCHX. A newer
    run enters it only in the default configuration (shop, `claude-sonnet-5-5`, monitor
    `contracts` or `none`, arm `none`), so no other model, monitor or arm can replace a phase.
    infraError trials leave n.
  - `summary.runs.json` is the keyed view.
  - `--check` compares `summary.json` and, when present, `summary.runs.json`. It also
    cross-checks that the keyed view reproduces every number in `summary.json`. Its output is
    unchanged.
  - The default export is `{name: 'summarize', describe, run(argv)}`.

## Dependency fragment

No new `@fiks/*` import enters `packages/cli`: `@fiks/bench`, `@fiks/domains` and
`@fiks/interfaces` are already in `packages/cli/package.json`. So `deps-fragments/BENCHX.json` is
not committed. The deliverable says "empty add{} if none", but `scripts/apply-dep-fragments.mjs`
rejects an empty `add`. Checked on a temporary copy of the file: `deps-fragments/BENCHX.json:
"add" must be a non-empty object`, exit 2. Committing it would break every stream's SETUP.
No `package.json` changed, `packages/bench`'s included.

## Acceptance evidence (HEAD 3513114, rebased on main c144b03)

| Item | Command | Result |
|---|---|---|
| SETUP | `node scripts/apply-dep-fragments.mjs && pnpm install --no-frozen-lockfile` | "nothing to apply"; install exit 0 (lockfile edit for CORE-SEED's packages left uncommitted) |
| Tests | `pnpm vitest run packages/bench packages/cli/test/summarize.test.ts` | 8 files, 36 tests passed |
| Re-summarize 2026-10-20 runs | `pnpm fiks summarize --check` | `summary.json matches the logs`, exit 0; test `re-summarizing the committed 2026-10-20 runs …` also asserts `crossCheck` = [] |
| Forced SDK error -> infraError | `agent.test.ts` "a forced SDK error yields outcome infraError", `cli-bench.test.ts` "a forced SDK error is logged as outcome infraError …" | pass (4 tries, then `infraError`; excluded from graded n) |
| 4 workers = sequential | `runner.test.ts` and `cli-bench.test.ts` "a 4-worker … 6 tasks x k=2 equals the sequential …" | pass (max in-flight > 1; 4 vendors; identical rows except timing/worker) |
| Dirty-tree refusal | `cli-bench.test.ts` "pnpm fiks bench refuses to start on a dirty tree"; also live: `pnpm fiks bench --phase A --k 1` in this (dirty) worktree | test pass; live: "refusing to start: … uncommitted changes", no agent call (exit 1 through the current main.ts switch, exit 2 through the default export) |
| No package.json / lockfile | `git diff --name-only c144b03 HEAD` | only `packages/bench/**` and the three owned cli files |
| Typecheck, lint | `pnpm typecheck && pnpm lint` | exit 0; "Checked 148 files … No fixes applied." |
| Full suite | `with-lock suite pnpm test` | 33 files, 185 tests passed |

## Notes for other streams

- CORE (P18): `commands/bench.ts` and `commands/summarize.ts` now have default exports, so the
  loader dispatches to them rather than `legacy/{bench,summarize}.ts`. `summarize --check` prints
  the same line as at ec241bc. The named exports `bench()` and `summarize()` remain for
  the legacy adapters.
- `--monitor <name>` is passed to the proxy bin only when it is not `contracts`. The current bin
  has no `--monitor` flag until MON lands.
- A non-shop domain's phase labels get a `<domain>.` prefix (e.g. `tracker.A_v1`). Its system
  prompt is `promptHints.benchSystem` if that is a string, else a generic one.
