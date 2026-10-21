# fiks codebase map: extension points for the paper's experiments

Written 2026-10-21 from a read-only pass over `packages/`, `apps/`, `scripts/`, `bench/results/`, `.fiks/` and the shop-mcp clone at `.work/shop-mcp` (main `7bf2e66`, tag `seed-v1`). fiks HEAD `318dd75`. Effort numbers are focused engineering hours for one builder, including unit tests and a verifier round. They do not include benchmark wall-clock time. Anything I did not run myself is marked [verify].

## 0. How the pieces connect (what each experiment touches)

| Layer | File / symbol | Role |
|---|---|---|
| Contract language | `packages/contracts/src/types.ts` (`Invariant` union: `range`, `notNull`, `nonEmpty`, `countMatchesTotal`, `freshness`, `equalsUpstream`, `unique`; `ReadAfterWrite`; `Recording`, `HttpExchange`) | Pure data types. Vendored byte-for-byte into the target repo. |
| Evaluator | `packages/contracts/src/evaluate.ts` `evaluate(contract, EvalInput)`, `checkInvariant`, `checkReadAfterWrite`, `schemaMismatch` (minimal JSON Schema: type, required, properties, items, enum, anyOf) | Pure. Also vendored into the target repo. |
| Contracts | `packages/contracts/contracts/shop-mcp.contracts.json`; `SHOP_CONTRACTS`, `SHOP_CONTRACTS_PATH` in `contracts/src/index.ts` | Hand-written, 4 tools. |
| Proxy | `packages/proxy/src/proxy.ts` `startProxy` → `handleCall` (mutex, `tap.take()`, probe, `evaluate`, `receiptHints`, `makeReceipt`, `onCall`) | The single hook where a monitor runs. |
| Receipts | `proxy/src/receipt.ts` (`facts`, `nextAction`, `receiptText`), `proxy/src/hints.ts` (`receiptHints`, v2 only) | What the agent reads. |
| Tap | `proxy/src/tap.ts` `startTap(target)` | Reverse proxy that records upstream HTTP. It needs the server to read its base URL from an env var. |
| Bin | `proxy/src/bin.ts` (`--contracts --tap ENV --listen --events --receipt-field`) | What the bench spawns. |
| Mock vendor | `packages/vendor-api/src/{drifts,catalog,server,openapi}.ts` | v1/v2 plus a `VENDOR_DRIFTS` subset. The OpenAPI spec is identical across versions. |
| Harness | `packages/cli/src/harness.ts` `startHarness` | vendor → tap → shop-mcp → [proxy] → MCP client. Hard-wired to `createVendor`, `VENDOR_BASE_URL`, `tsx src/main.ts`. |
| Scenarios | `cli/src/commands/scenario.ts` `SCENARIOS` (v1-all, D1..D5: scripted call plus `target` property) | Trace capture. |
| Repro | `packages/repro/src/generate.ts` `reproSource`/`generateRepro`, `gate.ts` `runSuite`/`classifyFailure`/`failGate`/`passGate`, `trace-store.ts`, `worktree.ts` | F and P gates. |
| Repair | `packages/repair/src/{runner,prompt,guard,gates,pr}.ts`; orchestration in `cli/src/commands/repair.ts` `repair()` | Agent, guard, local gate, CI gate, PR. |
| Re-record | `cli/src/commands/rerecord.ts`, `rerecord-stale.ts` | fiks re-records calls that a fix legitimately changed. |
| Bench | `packages/bench/src/{agent,tasks,stats}.ts`; `cli/src/commands/bench.ts`; `summarize.ts` | Agent trials, grader, pass^k, summary.json. |
| Target-repo harness | shop-mcp `test/fiks/{check,replay,run}.ts`, `test/fiks/vendored/*`, `test/fixtures/v1/*.json`, `test/repro/*`, `test/traces/`; sync via `scripts/sync-contracts.mjs` | Replay-based tests that the gates and CI run. |

---

## 1. Adding a new MCP server and vendor-API domain with drift injection

**What is shop-specific today.** Grepping `packages/*/src` finds shop-specific references in 25 files. These are the hard couplings:

- **Vendor.** All of `packages/vendor-api`: `DriftId` is a closed union `'D1'..'D5'`; `ALL_DRIFTS`, `DRIFTS`, `VERSION_DATES`, the `vendor-api-version` header, `CATALOG`, the route handler in `server.ts`, and the `/__admin/state|reset` endpoints that the graders read.
- **Contracts.** The `SHOP_CONTRACTS` constant is imported directly by `cli/src/harness.ts`, `cli/src/commands/repair.ts` (`findContract(SHOP_CONTRACTS, …)`), `rerecord.ts` and `record-fixtures.ts`. The bench passes `SHOP_CONTRACTS_PATH` to the proxy bin.
- **Harness.** `harness.ts` `startHarness` calls `createVendor` and sets `VENDOR_BASE_URL`; `shopCommand()` = `tsx src/main.ts`; `paths.ts` `shopDir()`/`shopAt('seed-v1')` point to `.work/shop-mcp`.
- **Scripts and fixtures.** `SCENARIOS` (scenario.ts) and `FIXTURE_CALLS` (record-fixtures.ts) are hard-coded call lists. `vendor-diff.ts` `PROBES: Record<DriftId, Probe>`.
- **Repro.** `generate.ts` `assertStorableProfile` requires a trace to come from a full v2 profile (`drifts.length === ALL_DRIFTS.length`). `reproSource` imports `../fiks/check.ts`, which assumes the shop-mcp test layout.
- **Repair.** `prompt.ts` `buildPrompt` has shop wording ("shop-mcp", `src/tools/*.ts`, `src/vendor.ts`, the version dates 2026-01-01/2026-10-01, `test/fixtures/v1`). `repair.ts` `slug()` strips `shop.`, `SHOP_MCP_REPO` defaults to `vats98754/shop-mcp`, and `rerecord.ts` `vendorVersionOf` uses `VERSION_DATES`.
- **Bench.** `tasks.ts` (T1–T6 graders read `CATALOG` and `VendorState`). `bench.ts` `PHASES` and `fixPrs()` (reads `bench/results/loop/repairs`). `summarize.ts` iterates `DRIFTS`/`SCENARIOS`.
- **Target repo.** shop-mcp `test/fiks/run.ts` replays in-process by importing `src/tools/handlers.ts`. It expects each module to export `{name, config.outputSchema (zod raw shape), handler(args, vendorClient)}`, plus `createVendorClient(baseUrl)` from `src/vendor.ts`. It also fakes `Date` to capture + 10 years.

**Minimal route.** Introduce a `Domain` registry object with these fields: `id`, `createVendor(opts)`, `driftIds`, `versionHeader`/`versionDates`, `contracts` + path, `baseUrlEnv`, `serverCommand(dir)`, `repo`, `seedTag`, `scenarios`, `fixtureCalls`, `tasks`, `promptHints`, `vendorDiffProbes`. Then thread it through `harness.ts`, `scenario.ts`, `record-fixtures.ts`, `rerecord.ts`, `repair.ts`, `prompt.ts`, `generate.ts`, `bench.ts`, `summarize.ts` and `paths.ts`, selected with a `--domain` flag (default `shop`).

| Work item | Hours |
|---|---|
| `Domain` abstraction + threading + keep all 147 tests green | 8–12 |
| New mock vendor package (same pattern as vendor-api: versioned, drift set, frozen clock, admin state, identical OpenAPI) | 4–6 |
| New MCP server repo (copy shop-mcp layout incl. `test/fiks/*`, CI, Biome, seed tag) | 4–6 |
| Contracts, fixture calls, scenarios, bench tasks + deterministic graders | 4–6 |
| **First new domain** | **20–30** |
| Each further domain once the abstraction exists | 10–14 |

Cheapest candidates are domains whose drifts map onto the existing invariant kinds: payments (cents/units, idempotency-lost-write), calendar/booking (timezone/epoch, read-after-write), weather/geo (unit °F/°C, range), issue tracker (pagination, rename).

## 2. Adding a new drift and its contract (inside the shop domain)

The steps, in order:
1. `vendor-api/src/drifts.ts`: add to `DriftId`, `ALL_DRIFTS`, `DRIFTS`.
2. `server.ts`: add a `has('D6')` branch.
3. `cli/src/commands/vendor-diff.ts`: add a `PROBES.D6` entry. Typecheck forces this.
4. `scenario.ts`: add `SCENARIOS.D6` (call + `target`).
5. `bench/src/tasks.ts`: add a `T7` with a grader.
6. Contract: add to `shop-mcp.contracts.json`.

**If the drift needs a new invariant kind** (for example `enum`, `monotonic`, `currencyConsistent`, `crossField`), you also have to:
- extend the `Invariant` union and `checkInvariant` in `evaluate.ts`;
- add a matching `nextAction` and maybe `receiptHints` in the proxy;
- run `node scripts/sync-contracts.mjs`, which writes into shop-mcp `test/fiks/vendored/`.

**Traps:**
- `seed-v1` is frozen (PROGRESS.md). A changed evaluator or contract file is not on the seed, so you need a new seed tag (for example `seed-v1.1`) carrying the new vendored files and fixtures. `packages/contracts/test/sync.test.ts` checks the clone's vendored copy.
- Adding D6 to `ALL_DRIFTS` changes what "full v2" means. `assertStorableProfile` would then reject new traces that lack D6, and bench phase B (v2 = all drifts) would no longer be comparable with the 2026-10-20 runs. Keep D1–D5 runs labelled by drift set; `meta.vendorDrifts` is already recorded.
- `shop-mcp` main already holds the D1–D5 fixes, so a D6 loop runs against main, or against `demo/<ts>` from the seed.
- A new fixture for the drifted endpoint may be needed in `FIXTURE_CALLS` plus `fiks record-fixtures --vendor v1` (a new commit in shop-mcp).

| Case | Hours |
|---|---|
| Drift expressible with existing invariant kinds | 3–5 |
| Plus a new invariant kind (evaluator, receipt text, unit tests) | +3–4 |
| New seed tag + re-vendoring + seed-integrity cases (real fix / fake fix) | +2–3 |
| Bench task + grader | +1–2 |

## 3. Plugging in alternative monitors (schema-only, spec-diff, LLM-judge)

**Where.** There is no monitor interface yet. `proxy.ts` `handleCall` calls `evaluate(contract, {...})` directly, then `receiptHints` and `makeReceipt`.
- Add `ProxyOptions.monitor?: (input: EvalInput & {tool, contract, toolDef}) => Promise<EvalResult> | EvalResult`, defaulting to `evaluate`. The `EvalResult` shape (`verdict`, `checked`, `violations[]`) already carries everything receipts and traces need.
- Expose it as `bin.ts --monitor contracts|schema|llm-judge|none` and `bench --monitor`.
- Record `monitor` in `meta.json`. Cost: 3–4 h.

**Cheapest path: offline detection.** You can measure detection without any new agent trials. Every proxied bench trial already logged full `CallRecord`s to `bench/results/<run>/proxy/*.jsonl`. They hold args, the raw upstream `result`, the receipt and all upstream `http`: 200 calls, 76 of them violated, 200 with HTTP. Fixtures and traces in shop-mcp `test/` add more.
- A script `paper/scripts/monitor-eval.ts` would replay each record through each monitor.
- Ground-truth labels come from the vendor: the catalog value or seed order versus the tool's output. Do not use fiks's own verdict as the label; that would be circular.
- Output: precision and recall per drift, plus false positives on A_v1/C_v2.
- Cost: 4–6 h. For agent-level effect (pass^k with a baseline monitor's receipts), run bench phase B with `--monitor X`.

| Baseline | How | Hours |
|---|---|---|
| **Schema-only** | A contract file with `invariants: []`, no `postconditions` (or `monitor=schema`) → only the declared `outputSchema` check. The seed's `get_product.price` is `z.number().nullable()`, so D2 null and D1 integer cents both validate. Expect ≈0 recall; this is the point. Optionally swap `schemaMismatch` for Ajv (full draft 2020-12: min/max/format) so the baseline is the strongest version. | 1 (+2 for Ajv) |
| **Spec-diff** | Already partly there: `fiks vendor-diff` reports `openapiIdentical: true` (v1 and v2 serve the same `OPENAPI`). For a fair baseline, run a real tool (oasdiff [verify name/licence]) on the v1/v2 `openapi.json`, behind a script. It flags 0 drifts by construction, so also state the strongest version: a spec-diff over a *changed* spec on the real-bug set. | 2–3 |
| **Response-diff / record-replay** (strong competitor) | Compare v2 responses with v1 recordings per endpoint (field set, types, magnitude). `vendor-diff`'s `PROBES` is a hand-written version of this. | 3–4 |
| **LLM-judge** | A monitor calling `@anthropic-ai/sdk` (pinned `0.131.0` via override) with tool description + `outputSchema` + args + result (± raw upstream body) → JSON `{verdict, property, reason}`. Runs inside the per-call mutex, so it adds latency to every call. Better evaluated offline on the 200 logged calls first; then one live bench phase. Record tokens and cost per call. Two variants: with and without upstream body. | 5–7 |
| **Detection-only / observability** | Already available: `--receipt-field none` (receipt only in `_meta` + text) and `--direct` (no fiks). A "log-only" mode (no receipt at all, events written) is a 0.5 h flag in `handleCall`. | 0.5 |

## 4. Inferring contracts automatically from recorded v1 traffic

**Inputs available today:**
- 10 v1 fixtures: shop-mcp `test/fixtures/v1/*.json`, each a `Recording` with result, http and probe.
- About 37 v1 calls in `bench/results/A_v1_*/proxy/*.jsonl` (the agent-ux report counts 37 A calls).
- `fiks scenario v1-all` and `record-fixtures --vendor v1` can generate more on demand. The mock is deterministic, and you can write more `FIXTURE_CALLS` or randomised arg generators.

**Design (Daikon-style templates over the existing `Invariant` vocabulary)** for `packages/contracts/src/infer.ts` `inferContracts(recordings): ContractFile` plus `fiks infer-contracts --from <dirs> --out file`:
- `range`: per numeric leaf path (`items[*].price`). Widen the observed `[min,max]` by a factor or order-of-magnitude rule; the observed v1 prices are 60–1499.
- `notNull`: fields never null across observations, with `knownGoodInputs` = the observed args.
- `nonEmpty`: arrays never empty for those args.
- `countMatchesTotal`: when `len(array) == numeric field` in all observations.
- `equalsUpstream`: when the output path value equals some upstream JSON path value in every observation (match by value, then by name). Use `compare:'instant'` when both parse as timestamps.
- `unique`: id-like array paths.
- `freshness`: string fields that parse as ISO dates; window from the observed age relative to the clock in `upstream.clock`.
- `readAfterWrite`: tools whose upstream request is POST/PUT/PATCH. Pick a probe tool whose argument value equals a result field; `upstream.idPath` from the probe's 2xx body.

**Evaluation (cheap).**
- Detection on D1–D5 with the scenario traces.
- False positives on held-out v1 calls (split fixtures vs bench A logs).
- Compare with the hand contracts property by property.
- Drop inferred contracts into the proxy with `--contracts inferred.json`; no other change is needed.

**Risks to state:**
- Tiny sample: 15 products and 1 order, so ranges and freshness overfit.
- `equalsUpstream` by value match can pick spurious paths.
- Inferred contracts cannot go into the seed's vendored copy without a new seed tag (see §2). The F/P gate and repair experiments with inferred contracts therefore need `seed-v1-inferred`.

Effort: inference module + CLI + tests **8–12 h**. Offline evaluation script **3–4 h**. New seed tag to run the full loop with inferred contracts **2–3 h**.

## 5. Running the bench across several models and at larger k

**Current runtime (from `bench/results/*/trials.jsonl` + `meta.json`; claude-sonnet-5-5; 6 tasks × k=5 = 30 trials each, run sequentially):**

| Run | Wall time | Mean / median / max per trial | Mean turns | Errors |
|---|---|---|---|---|
| A_v1_20261020T223642 | 212 s | 7.0 / 6.7 / 12.9 s | 3.2 | 0 |
| B_v2_20261020T224015 | 268 s | 8.9 / 8.7 / 12.9 s | 3.6 | 0 |
| B_v2_direct_20261020T224445 | 254 s | 8.5 / 8.7 / 13.5 s | 4.5 | 0 |
| C_v2_fixed_20261020T224903 | 201 s | 6.7 / 6.4 / 8.8 s | 3.3 | 0 |
| 2026-10-18 runs (A, B, B_direct) | 235 / 350 / 292 s | 7.8 / 11.6 / 9.7 s mean | 3.2–4.5 | 0 |

- Output tokens per 30-trial run: 5.9k–13.2k.
- **Cost per trial is not recoverable from the logs.** `runAgent` captures `costUsd` (SDK `total_cost_usd`), but `TrialRecord` in `bench.ts` drops it. `usage.input` excludes cache-read and cache-creation tokens: about 194–242 input tokens per *30-trial run*, which is clearly not the prompt size.
- Fix: add `costUsd`, `cache_read_input_tokens` and `cache_creation_input_tokens` to `TrialRecord` (0.5 h).
- Under the OAuth token `total_cost_usd` is an API-price estimate, not a bill [verify].
- Repair runs for comparison (`bench/results/loop/repairs/*.json`, claude-opus-5-5, Agent SDK):
  - cost $0.11–0.21 per drift, 10–14 turns, 1 attempt each;
  - 83–97 s from trace to PR: ≈3–5 s repro + F gate (3 suite runs), ≈40–50 s agent + re-record + local gate, ≈35 s CI wait.

**Rate limits.** 0 errors in 210 trials over 7 runs; no 429 or overload appears in `.fiks/bench-*.log`. But nothing was stress-tested: trials are strictly sequential, and `runAgent` has no retry or backoff. Any SDK error becomes `answer=null` and is graded as "no answer" = fail. That would make infrastructure errors look like model failures. Before scaling:
- add a retry with backoff;
- add an `infraError` outcome that the analysis can exclude or report separately;
- 1–2 h.

**What to change for multi-model and large k:**
- `--model` already works (bench `opts.model` / `BENCH_MODEL`; repair `--model` / `REPAIR_MODEL`). Haiku was used once (`bench/evidence/receipt-field`).
- `summarize.ts` keys `phases[meta.phase]`, and "the latest complete run per phase label wins". A second model silently replaces the first. Key by `${phase}@${model}` (+ monitor/receipt variant) and keep every run (1–2 h).
- `passHatK` is reported only for `[1,2,3,4,5]` (hard-coded); `FULL_K` gates completeness. Generalise to 1..k and add Wilson/bootstrap CIs (1–2 h).
- Parallelism: one vendor instance per run, `vendor.reset()` per trial, and the graders read `vendor.state`. Parallel workers each need their own vendor + worktree. A worker pool of N is 3–4 h; the main limit is then the token rate.
- Non-Claude models: `runAgent` is bound to the Claude Agent SDK (`query`). Other vendors need a second agent loop (MCP client + chat-completions tool loop), 6–8 h. Agent-loop differences then confound model differences; state this.
- Projection (sequential, ≈8 s/trial): 4 phases × 6 tasks × k=20 × 4 models = 1,920 trials ≈ 4.3 h. With 4 workers ≈ 1.1 h, if rate limits allow [verify].

## 6. Running the repair loop on an arbitrary external repo (fork of a real MCP server)

Assumptions baked in today, and how each breaks:

1. **Toolchain.**
   - Node/TS, pnpm, vitest, Biome. `formatFiles` runs the target's `node_modules/.bin/biome`, and `formatInMemory` uses fiks's Biome config.
   - `runSuite` runs `node_modules/.bin/vitest --reporter=json`.
   - `guard.ts` `mayRun` allows only `pnpm typecheck|lint|test`, and `localGate` runs those three scripts.
   - Python and Go servers, npm/yarn, or jest/mocha break all of these.
2. **Edit allow-list.** `REPAIR_ALLOWED = /^src\/.+\.ts$/`. Repos with `lib/`, `packages/*/src`, or `.js`/`.mts` files cannot be repaired. Make it per-domain config.
3. **In-process replay harness.** The repro test imports `../fiks/check.ts`. `run.ts` needs `src/tools/handlers.ts` with the shop module shape and an injectable `createVendorClient(baseUrl)`. Real servers usually register tools inline (`server.tool(...)`), build HTTP clients internally (octokit, axios with retries, official SDKs), or talk to non-HTTP upstreams (DB, filesystem, gRPC). Fix: a per-repo adapter, or replay at the process level (spawn the server with the base-URL env var pointing at the replay server, call over MCP stdio). The process-level route is more general but slower per test.
4. **Configurable upstream.**
   - The tap and the replay both need the base URL in an env var (`VENDOR_BASE_URL`). Many servers hard-code `https://api.github.com` or rely on SDK defaults; that needs a fork patch or an HTTPS MITM proxy.
   - TLS upstreams: `startTap` speaks plain HTTP downstream.
   - Multiple upstream hosts are not supported.
5. **Strict replay matching.** The request key is method + path+query + body + header *names* (`replay.ts`). Nonces, timestamps in queries or bodies, retries, auth-token refresh calls and parallel requests give `UNMATCHED_REQUEST`. The F gate classifies that as the wrong reason, so no repro is produced. Fix: configurable matchers and body normalisers.
6. **Re-recording needs a controllable upstream.** `rerecord()` starts `startHarness` with `createVendor` at the recorded version, drift set and *frozen clock*, and `sameCallAndUpstream` checks them. A real third-party API cannot be frozen or reset. Fixes that change requests (D3/D4-style) then cannot be re-recorded deterministically. Options: record against a sandbox account, or hand-edit-free "augment recording" mode [design needed].
7. **Ground truth for contracts.** `knownGoodInputs`, ranges and read-after-write probes must be written per server. On a real API there is no `/__admin/state`, so bench graders cannot be deterministic.
8. **Baseline must be green.** The F gate fails with "other tests fail too" if any existing test fails at base. Flaky network tests in a real repo block the loop. Run only `test/fiks/**` in gates, or quarantine.
9. **CI.**
   - `ciGate` waits for a *push*-event run on the branch (`gh run list --branch`). Forks have Actions disabled until enabled.
   - The workflow must trigger on `push` to all branches.
   - Needs the `gh` CLI with push rights. Duplicate detection uses a `fiks` label, which `gh label create` needs rights for.
10. **Trace profile rule.** `assertStorableProfile` and `vendorVersionOf` assume the v1/v2 vocabulary and the `vendor-api-version` header.
11. **Prompt.** `buildPrompt` mentions shop-mcp paths and vendor dates. It needs per-repo hints.
12. **Security.** Agent code runs on the host during gates (README Limitations). This matters more for third-party code.

Effort for one Node/TS MCP server with an HTTP upstream and an env-configurable base URL:
- generalisation (shared with §1): 8–12 h;
- per-repo adapter (contracts, harness install, fixtures, CI): 6–10 h;
- process-level replay to drop the handler-shape assumption: +6–8 h.

Python servers: 30–40 h (pytest replay harness, calling the TS evaluator via node or a port).

## 7. Cheap ablations

| Ablation | Where to wire | Hours | Note |
|---|---|---|---|
| **Repair without the F gate** | `repair.ts` step 2: `if (!gateF.ok) return finish(...)` → `opts.skipFGate`. Still generates the repro. | 0.5–1 | Weak ablation, because on these drifts F already passes. The stronger form is **repair without a repro test**: skip `generateRepro`; prompt with the violation text only; `localGate` without `passGate` (needs a `localGate` variant, since `passGate` requires `spec.testPath`); measure with the held-out repro + seed-integrity fake-fix cases afterwards. | 
| Repair without a repro test (above) | `repair.ts`, `gates.ts`, `prompt.ts` | 3–4 | Measure patch correctness post hoc by running the withheld repro + `seed-integrity.test.ts`-style cases. |
| **Without traces** (no upstream HTTP in the prompt) | `buildPrompt`: drop the `exchanges`/`probe` block and the baseline-fixture pointer behind `opts.promptVariant`. The repro JSON stays in the repo, so also add a variant that hides `test/repro/*.json` from Read via `mayRead`. | 1–2 | |
| **Without the re-record rule** | (a) `rerecordStale` off → D3/D4 fixes fail with `UNMATCHED_REQUEST` (expected `gate_failed`); (b) let the agent edit recordings: widen `REPAIR_ALLOWED` to `test/**/*.json` and drop the `changedSinceSnapshot` checks. The seed-integrity and repair tests document the cheats this enables. | 1 (a) / 2 (b) | (b) must run in a throwaway base (`--base fresh`, `--no-pr`). |
| **Receipts v1 vs v2** | v1 = before `705e989`: no `receiptHints`, old `nextAction` strings (in `git show 705e989 -- packages/proxy/src/receipt.ts`). Add `receiptStyle: 'v1'|'v2'` to `ProxyOptions`/`bin.ts`/`bench`, porting the old `nextAction`. | 1.5–2 | The only existing v1 run (B_v2_20261018T093754) used an older harness and grader. Re-run under the current harness for a fair comparison. |
| Receipt-field on/off, fiks on/off | Already flags: `--no-receipt-field`, `--direct` | 0 | |
| Retry budget, model, fallback runner | `RepairOptions.attempts` (default 3, not exposed on the CLI), `--model`, `runners` | 0.5 | |
| F-gate determinism runs (1 vs 3) | `failGate(…, runs)` | 0.25 | |
| `--no-pr` for loop experiments | already exists; stops after green CI | 0 | Use for all ablations; avoids PR spam. Pair with `--base fresh` (via `demo`). |

## 8. Test runtime and flakiness (from PROGRESS.md and the code)

**Size.**
- Clean clone (2026-10-20): `pnpm test` 25 files / 147 tests pass (PROGRESS.md "Final bench").
- My grep counts ≈150 `test(` sites across 25 files: contracts 24+1, proxy 34, vendor-api 12, repro 6, repair 10, bench 8, cli 53, dashboard 5.

**Runtime.** Not recorded in PROGRESS.md or any log. I did not run it: `packages/cli/vitest.config.ts` runs `git worktree add` on the shop-mcp clone, which this read-only task must not do [verify: time `pnpm test` in a later build step]. Structure that drives the time:
- The cli project runs whole shop-mcp vitest suites as children (`seed-integrity`, `negative`, `oracle`, `repair`), with per-test timeouts of 60–180 s and `maxWorkers: 3`, in its own `groupOrder`.
- `seed-integrity` `beforeAll` records 5 v2 fixture sets.
- `failGate` runs the suite 3×.

**Flakiness history.**
- Commit `705e989`: "nested suites get generous timeouts".
- `runSuite` / `localGate` pass `--testTimeout=60000` because "a busy machine must not turn into a gate verdict". Earlier load-induced timeouts were the flake.
- `failGate` also requires identical failure messages across runs ("non-deterministic: runs disagree").
- The replay fakes `Date` (capture + 10 y), and the vendor clock is frozen for recordings. Both remove time flakiness.
- PLAN.md risk 4 lists Streamable HTTP as potentially flaky; the bench and loop use stdio only.

**Operational incidents to remember.**
- `env -u CLAUDE_CODE_OAUTH_TOKEN` does not disable credentials, because the CLI loads `.env` itself. This opened a duplicate PR, #5. Use `--until-f-gate` or `--no-pr`.
- Three of four 2026-10-20 runs record `fiksDirty: true` (output files uncommitted). Commit before benchmarking.
- The login shell pins Node 22.5.1; export the nvm 22.23.3 PATH.

## Quick reference: effort totals

| Experiment enabler | Hours |
|---|---|
| Monitor interface + offline monitor-eval over logged calls | 7–10 |
| Schema-only + spec-diff + response-diff + LLM-judge baselines | 11–17 |
| Contract inference + offline eval (+ seed tag for loop) | 11–19 |
| Bench: cost logging, retries/infraError, multi-model summary keys, pass^k to k, CIs, worker pool | 7–11 |
| Ablation flags (F gate, no-repro, no-trace, re-record, receipts v1) | 8–12 |
| Domain abstraction + 1 new domain | 20–30 |
| External real-server fork (Node/TS) | 14–30 |
