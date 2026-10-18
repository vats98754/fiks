# Fiks: Build Plan (about 24 h)

Source of truth: CLAUDE.md (scope), RESEARCH.md (claims). This plan says how to build it and how to check each step.
Date written: 2026-10-18. Version pins must be published on or before **2026-10-04** (14 days before today).

---

## 0. Ground rules for this plan

- **Two repos.**
  - `fiks` lives at `/Users/anvayvats/fiks` (remote `git@github.com:vats98754/fiks.git`, branch `main`). It is a pnpm workspace.
  - `shop-mcp` lives at `https://github.com/vats98754/shop-mcp`. Develop it locally as a separate git clone at `/Users/anvayvats/fiks/.work/shop-mcp`. `.work/` is gitignored in fiks and excluded from the fiks pnpm workspace. shop-mcp has its own `package.json`, lockfile and CI. Fix worktrees go in `.work/wt/<branch>`.
- **Clean-clone story.** `scripts/ensure-shop-mcp.mjs` runs as `pretest` and `predemo`. If `.work/shop-mcp` is missing, it clones it over https (read-only works without auth) and runs `pnpm i --frozen-lockfile` inside it. Pushes and PRs go through `gh`, which is authenticated as vats98754 over ssh. `GITHUB_TOKEN` is optional.
- **The seed is frozen.** The unfixed shop-mcp code is tagged `seed-v1` and pushed. After that tag, nothing is pushed directly to shop-mcp `main`. The only changes allowed are human-merged Fiks PRs. Fiks never merges anything.
- **Credentials (updated 2026-10-18).** The user has a Claude Code OAuth token, not an API key. Both LLM parts therefore run through the Claude Agent SDK (which runs Claude Code and accepts `CLAUDE_CODE_OAUTH_TOKEN`): the repair agent (unchanged) and the bench agent (changed from `@anthropic-ai/sdk` to an Agent SDK `query()` with fiks-proxy as its MCP server, built-in tools disabled). Wherever this plan says `ANTHROPIC_API_KEY`, read "the Claude credential". Runs count against the user's plan limits: smoke on Haiku first, and report run counts. The README must say the bench agent is a Claude Agent SDK agent.
- **API key timing.** M0–M3 need no `ANTHROPIC_API_KEY`. Every test in those milestones runs with `env -u ANTHROPIC_API_KEY`. The key is first needed in **M4** (the real repair run) and in **M5** (the bench). If the key is missing at that point, stop and ask for it (hard rule).
- **Models.** Update `.env.example`: change `BENCH_MODEL=claude-sonnet-4-6` to `BENCH_MODEL=claude-sonnet-5-5`, and add `REPAIR_MODEL=claude-opus-5-5` and `SMOKE_MODEL=claude-haiku-5-5`.
  - Bench agent: **claude-sonnet-5-5**. It is realistic for agent traffic and costs $2/$10 per MTok.
  - Repair agent: **claude-opus-5-5**. Anthropic's model docs recommend it for long-running agentic coding. If Opus fails twice on a drift, fall back to Sonnet 5.5.
  - Smoke runs: **claude-haiku-5-5**.
  - All of these are dateless pinned IDs, listed on platform.claude.com models overview as of 2026-10-18.
- **Repair runner.**
  - Primary: the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`, `query()`). It is typed, gives cwd/tool allow and deny lists, and has `maxTurns`, `maxBudgetUsd` and an `AbortController`. It bundles the native Claude Code binary as an optional dependency.
  - Fallback: headless `claude -p --output-format json --max-turns N --allowedTools ...`, running in the worktree.
  - Both sit behind one interface (`RepairRunner`).
- **Every number is real.** Every number shown to anyone is derived by `fiks summarize` from `bench/results/**`. Those logs are committed as evidence.
- **Node runtime.** The local Node is 22.5.1. Vitest 5 requires Node `^22.12.0`, and Vite 8 requires `>=22.12.0`. M0 step 1 is to install the latest Node 22 LTS (`brew install node@22`, or fnm/nvm), add `.nvmrc` = `22`, and set `engines.node` = `>=22.12`. CI uses Node 22 as well. If the upgrade is not possible, use the fallback stack in §2.
- **Scratch output.** Acceptance commands write scratch output to `.fiks/` (gitignored).

---

## 1. Milestones

Every milestone ends the same way: the verifier reports PASS, PROGRESS.md is updated, and a commit is made. Run `agent-ux-tester` after M2 and M5, `designer` after M6, and `claims-auditor` in M7.

### M0: Scaffold and repos (1.0 h, no key)

**Goal:** both repos exist, the fiks workspace builds and tests green, shop-mcp has a skeleton with real CI that is green on `main`, and every version pin is checked.

**Files (fiks):**
- `package.json`, with `packageManager: pnpm@9.12.3` and these scripts: `typecheck`, `lint`, `test`, `fiks` (runs `tsx packages/cli/src/index.ts`), `demo`, `demo:confirm`, `bench`, `dashboard`.
- `pnpm-workspace.yaml` (`packages/*`, `apps/*`), `tsconfig.base.json`, `biome.json`, `vitest.config.ts` (projects), `.nvmrc`.
- Updates to `.gitignore`: add `.work/`, `.fiks/`, `*.log`, `apps/dashboard/public/data/`.
- `.env.example` (model updates; `SHOP_MCP_REPO=vats98754/shop-mcp`; `GITHUB_TOKEN` marked optional).
- `scripts/check-pins.mjs`. It fails if any dependency in any `package.json` (fiks or `.work/shop-mcp`) uses `^` or `~`, or was published after 2026-10-04. It checks dates with `npm view <pkg> time --json`.
- `scripts/ensure-shop-mcp.mjs`, `PROGRESS.md`.
- Empty package stubs, each with one smoke test: `packages/{contracts,vendor-api,proxy,repro,repair,bench,cli}` and `apps/dashboard`.

**Files (shop-mcp skeleton, first push to `main`):**
- `package.json` (same pins, `packageManager`), `tsconfig.json`, `biome.json`, one trivial test.
- `.github/workflows/ci.yml`. It triggers on `push` to all branches and on `pull_request`, and runs on `ubuntu-latest` with Node 22 and pnpm 9.12.3 using `--frozen-lockfile`. The steps are `pnpm typecheck`, `pnpm lint`, `pnpm test`. Pin each action by commit SHA of its latest release that is at least 14 days old (look up with `gh api repos/<owner>/<repo>/releases`).

**Acceptance (verifier runs literally, from `/Users/anvayvats/fiks`):**
```
node -v                                   # >= v22.12
pnpm i --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test
node scripts/check-pins.mjs               # exit 0, prints each pin with its publish date
for p in .env .work .fiks; do git check-ignore -q "$p" || exit 1; done && echo IGNORED_OK
grep -q '^BENCH_MODEL=claude-sonnet-5-5' .env.example && grep -q '^REPAIR_MODEL=claude-opus-5-5' .env.example && echo ENV_OK
git -C .work/shop-mcp remote get-url origin   # github.com[:/]vats98754/shop-mcp(.git); a clean clone uses https for fetch
gh run list -R vats98754/shop-mcp --branch main --limit 1 --json conclusion,headSha -q '.[0]'   # conclusion=success, headSha == next line
git -C .work/shop-mcp rev-parse HEAD
test -f PROGRESS.md && echo PROGRESS_OK
```

---

### M1: vendor-api v1/v2 and shop-mcp seed (3.0 h, no key)

**Goal:**
- `vendor-api` serves the same OpenAPI document in v1 and v2 but behaves differently in v2. Each drift can be toggled on its own.
- shop-mcp wraps vendor-api with four tools, is tagged `seed-v1`, and is green in CI.

**Drift design.** D1 and D4 share `GET /products`; the others each have their own endpoint. Drifts are isolated with `VENDOR_DRIFTS`, every recording stores its upstream profile (`upstream: {version, drifts}`), and stored-trace tests assert only the properties that trace violated, so a D4 fix can land without D1:

| Drift | Endpoint | v2 behavior | Bug in seed shop-mcp (silent) | Contract property that catches it |
|---|---|---|---|---|
| D1 unit | `GET /products?q=` | `price` is integer cents | passes the number through as dollars | `shop.search_products/items.price.range` (0.5 to 2000 USD; catalog is $60 to $1,500, so every cents value is above 6000) |
| D2 rename | `GET /products/:id` | `price` becomes `unit_amount` | reads `price`, gets `null` (schema allows null, see C4) | `shop.get_product/price.notNull` (known-good ids only) |
| D3 lost write | `POST /orders` | 200 + id, but persists only if `Idempotency-Key` is sent (the spec already says "recommended") | never sends the header | `shop.create_order/readAfterWrite` |
| D4 pagination | `GET /products?q=` | page size 5, `next_cursor` (already in the spec, always null in v1) | reads page 1 only | `shop.search_products/countMatchesTotal` |
| D5 timestamp | `GET /orders/:id` | `created_at` is epoch ms | `Date.parse(v) \|\| 0` gives 1970 | `shop.get_order/created_at.freshness` |

- Every response carries a `Vendor-Api-Version: 2026-01-01` (v1) or `2026-10-01` (v2) header. This is Stripe-style versioning: fixes can branch on it and stay backward compatible.
- Configuration: `VENDOR_VERSION=v1|v2`, plus optional `VENDOR_DRIFTS=D1,D3` (v2 defaults to all drifts).
- Admin endpoints: `GET /__admin/state` and `POST /__admin/reset`. Only the bench grader uses them.

**Files (fiks):**
- `packages/vendor-api/src/{server.ts,catalog.ts,drifts.ts,openapi.ts}` plus tests. Uses `node:http` with no framework. `openapi.json` is generated once and shared by both versions.
- `packages/contracts/contracts/shop-mcp.contracts.json`: data only, written here so the shop-mcp contract suite exists from the seed onward.
- `packages/contracts/src/{types.ts,evaluate.ts}`: a pure evaluator with no I/O.
- `scripts/sync-contracts.mjs`. It copies `evaluate.ts` and the contracts JSON into `.work/shop-mcp/test/fiks/` with a "GENERATED, do not edit" header. A fiks test checks that the copies are byte-identical.

**Files (shop-mcp):**
- `src/main.ts`: stdio by default; `--http <port>` for Streamable HTTP. `src/index.ts` is the library export.
- `src/server.ts`; `src/vendor.ts`, a fetch client whose base URL comes from `VENDOR_BASE_URL`.
- One file per tool: `src/tools/{search_products,get_product,create_order,get_order}.ts`. Each declares an `outputSchema` (C26) and returns `structuredContent`.
- `vendor/openapi.json`, a copy of the vendor spec.
- `test/fiks/replay.ts`: a strict replay HTTP server. Any request that doesn't match a recording gets status 599 with an `UNMATCHED_REQUEST` body.
- `test/fiks/contracts.test.ts`: every contract, run over every recording in `test/fixtures/**`. Fixtures are golden: when a fixture applies, the tool output must equal the recorded output (catches fixes that break v1).
- `test/fiks/traces.test.ts`: replays every `test/traces/*.json` and asserts every contract property except the ones it violated that are outside its `target` (faults fixed by other PRs). Re-recorded fixtures are still compared against the original golden output; recordings carry a frozen upstream clock so this comparison is exact. The folder starts empty and holds a `.gitkeep`.
- `test/fixtures/v1/*.json`: baseline recordings made against vendor v1.
- `test/repro/.gitkeep`.

**Interfaces (`@fiks/contracts`):**
```ts
type Verdict = 'verified' | 'violated' | 'unverifiable';
type Invariant =
  | { id: string; kind: 'range'; path: string; min?: number; max?: number; unit?: string }
  | { id: string; kind: 'notNull'; path: string; onlyKnownGood?: boolean }
  | { id: string; kind: 'nonEmpty'; path: string; onlyKnownGood?: boolean }
  | { id: string; kind: 'countMatchesTotal'; itemsPath: string; totalPath: string }
  | { id: string; kind: 'freshness'; path: string; maxAgeDays: number; maxFutureDays?: number };
interface ReadAfterWrite { id: 'readAfterWrite'; probeTool: string; probeArgs: Record<string, string /* path into result */>;
  expect: { probePath: string; equalsResultPath: string }[] }
interface ToolContract { id: string /* e.g. shop.get_product */; tool: string; outputSchema?: object;
  invariants: Invariant[]; postconditions?: ReadAfterWrite[]; knownGoodInputs?: Record<string, unknown>[] }
interface Violation { propertyId: string /* `${contract.id}/${invariant.id}` */; kind: string; path: string;
  expected: string; actual: unknown; message: string }
interface EvalResult { verdict: Verdict; contractId: string | null; checked: string[]; violations: Violation[] }
function evaluate(c: ToolContract | undefined, input: { args; result; now: Date; declaredOutputSchema?; probe?; upstream?: HttpExchange[] }): EvalResult; // pure
// extra invariant kind: { kind: 'equalsUpstream'; path; upstreamPath }  (tool must report what upstream said)
```

**Acceptance:**
```
pnpm --filter @fiks/vendor-api test
pnpm --filter @fiks/contracts test
pnpm fiks vendor-diff --json | jq -e '.openapiIdentical == true and (.behaviorDiffs | length) == 5'
pnpm fiks vendor-diff --json | jq -r '.behaviorDiffs[].drift'          # D1..D5
(cd .work/shop-mcp && pnpm i --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test)
git -C .work/shop-mcp ls-remote --tags origin seed-v1 | grep -q seed-v1 && echo TAG_OK
gh run list -R vats98754/shop-mcp --branch main --limit 1 --json conclusion -q '.[0].conclusion'   # success
node scripts/sync-contracts.mjs --check   # exit 0 (vendored evaluator identical)
```
`fiks vendor-diff` starts v1 and v2 on ephemeral ports, compares `/openapi.json`, makes one probe request per drift, and shuts both down.

**Trace profile rule (M1 verifier).** Isolated `VENDOR_DRIFTS` profiles still send the v2 version header while serving only some v2 behavior, a combination the real vendor never produces. A correct fix that branches on the header would wrongly fail an isolated trace. So traces that go into shop-mcp (repro tests, `test/traces`) are always captured under the full v2 profile, with `target` set to the drift's property. The M3 trace writer refuses a v2 trace whose `upstream.drifts` is not the full set. Isolated profiles are used only by `fiks scenario` detection checks and fiks unit tests.

**Re-recording rule (added during M1, frozen in `seed-v1`).** Replay matching is on method, path+query, body and the set of significant request header names. Two drifts cannot be fixed under a static replay of the broken interaction: the D3 fix sends a new header, and the read-back of the recorded 404 would still fail; the D4 fix fetches a page the trace never saw. So when the current code makes upstream requests a recording never saw, that recording "no longer applies". The suite then requires `<name>.rerecorded.json`: the same call, re-recorded by fiks (`fiks rerecord`) through the current code against the same upstream version. That copy must apply and pass. The repair agent never writes these. fiks adds them in a separate commit, `test: re-record ... (fiks)`, that contains only `*.rerecorded.json` files, and the M4 guard checks this. The F gate treats UNMATCHED_REQUEST as the wrong failure.

---

### M2: Proxy, contracts and receipts (4.0 h, no key)

**Goal:**
- `fiks-proxy` (package `@fiks/proxy`, bin `fiks-proxy`) sits in front of any MCP server.
- It forwards every request unchanged. It evaluates every `tools/call` result and attaches a receipt to `result._meta["fiks/receipt"]`, plus one appended text block.
- The upstream `content` and `structuredContent` are never rewritten.
- For read-after-write, the proxy runs the declared probe tool itself after the mutating call returns.
- An HTTP tap records upstream HTTP exchanges (they feed into M3).

**Transports.** Build stdio first (both directions), then Streamable HTTP downstream and upstream.

**HTTP tap.** `--tap VENDOR_BASE_URL`: the proxy starts a recording reverse proxy, rewrites that env var for the upstream child process, and forwards traffic to the real URL. Calls are serialized per upstream with a mutex, so every exchange belongs to exactly one call (limitation recorded in the README). Sensitive headers are redacted: `authorization`, `cookie`, `x-api-key`.

**Receipt text.** Status goes on the first line, the next action is named, and the whole block is under 60 tokens (agent-ux-tester grades this). Format:
`[fiks] VIOLATED get_product: price is null, but p-1001 should have one. Do not treat the missing price as meaningful; tell the user it is unavailable right now.` (tool name first, one plain fact per field, one action per problem kind). Property ids, the trace id and `upstreamObserved` are in `_meta` only, since the agent cannot act on them. Tool errors get `NOT CHECKED`. Budget: 60 tokens, enforced in receipt.test.ts with an estimator that reads slightly low, so the limit there is 54.

**Files:**
- `packages/proxy/src/{index.ts,proxy.ts,receipt.ts,tap.ts,http.ts,bin.ts}` plus tests. (Deviation: upstream transports live in `proxy.ts` and CLI config in `bin.ts`; there is no separate `transports.ts`/`config.ts`.)
- `packages/cli/src/commands/{call.ts,scenario.ts,vendor-diff.ts}`.
- `packages/cli/src/harness.ts`: starts vendor, shop-mcp and proxy on ephemeral ports and tears them down.

**Interfaces:**
```ts
interface Receipt { v: 1; verdict: Verdict; contractId: string | null; checked: string[];
  violations: Violation[]; upstreamObserved: boolean; traceId?: string; at: string }
interface HttpExchange { seq: number; startedAt: string; durationMs: number;
  request: { method: string; url: string; headers: Record<string, string>; body: string | null };
  response: { status: number; headers: Record<string, string>; body: string } }
interface ProxyConfig { upstream: { transport: 'stdio'; command: string[]; env?: Record<string, string> } | { transport: 'http'; url: string };
  listen: { transport: 'stdio' } | { transport: 'http'; port: number };
  contractsPath: string; tapEnvVar?: string; traceDir: string; eventsPath: string; runId: string }
interface CallRecord { tool: string; args: unknown; result: CallToolResult; receipt: Receipt; http: HttpExchange[];
  probe?: { tool: string; args: unknown; result: CallToolResult; http: HttpExchange[] } }
```

**Acceptance:**
```
pnpm --filter @fiks/proxy test
pnpm fiks scenario v1-all --json | jq -e '[.calls[].receipt.verdict] | (map(select(.=="violated")) | length) == 0'
for D in D1 D2 D3 D4 D5; do pnpm fiks scenario $D --json | jq -r '.calls[].receipt.violations[].propertyId'; done
   # expected, in order: shop.search_products/items.price.range, shop.get_product/price.notNull,
   # shop.create_order/readAfterWrite, shop.search_products/countMatchesTotal,
   # shop.get_order/created_at.freshness and shop.get_order/created_at.equalsUpstream (D5 violates both)
pnpm fiks call get_product '{"id":"p-1001"}' --vendor v2 --compare-direct --json | jq -e '.upstreamIdentical == true'
pnpm fiks call get_product '{"id":"p-1001"}' --vendor v2 --json | jq -r '.result.content[-1].text' | head -c 6   # [fiks]
pnpm fiks call get_product '{"id":"p-1001"}' --vendor v2 --json | jq -e '.result._meta["fiks/receipt"].verdict == "violated"'
pnpm fiks scenario D2 --transport http --json | jq -e '[.calls[].receipt.verdict] | index("violated") != null'
pnpm --filter @fiks/proxy test -- probe-upstream   # the proxy passes the tap's probe exchanges, so a cached read-back is still violated
env -u ANTHROPIC_API_KEY pnpm test
```
`--compare-direct` makes the same call without the proxy, then removes `_meta["fiks/receipt"]` and the last text block from the proxied result, and deep-compares the two. The proxy unit tests cover the `unverifiable` verdict (a tool with no contract) and the case where the upstream returns `isError`.

Then run **agent-ux-tester** (scripted transcripts only; it does not need the API key yet).

---

### M3: Trace capture and repro-test generator with the F→P gate (3.0 h, no key)

**Goal:**
- **Capture.** On a violation, write `.fiks/traces/<traceId>.json` and append a `violation` and a `trace_saved` event.
- **Reproduce.** Generate a deterministic vitest test into a target shop-mcp checkout. The test replays the trace's recorded HTTP exchanges through `test/fiks/replay.ts`, freezes the clock at `capturedAt`, calls the tool in-process, and asserts the violated property. Every assertion message contains the `propertyId`.
- **Repro test body.** `expectRecordingHolds(tracePath, { ignore: outOfScope(trace), mustCheck: targetOf(trace) })` from `test/fiks/check.ts`: the same rule as stored traces (no new errors where data was returned, target properties evaluated and holding, no regressions on properties that held).
- **F gate.** Run the generated test on the unfixed code. It passes the gate only if all three hold:
  - (a) the run exits non-zero;
  - (b) exactly the generated test fails, with an AssertionError whose message contains the `propertyId`;
  - (c) there are no `UNMATCHED_REQUEST` responses and no setup errors.

  The test is run 3 times and must give the same result each time.
- **P side.** The P side is proven in fiks's own test suite with human-written **oracle patches**. They live in `packages/cli/test/oracles/D{1..5}.patch` and are used only by tests, never by the demo or by PRs.

**Files:**
- `packages/repro/src/{trace-store.ts,generate.ts,gate.ts,worktree.ts,events.ts,format.ts}` plus tests.
- Deviations (recorded after the M3 verifier): the repro template is inline in `generate.ts`; the trace is stored next to its test as `test/repro/<id>.json` (not `test/traces/`, so the stored-trace suite and the repro test never fail twice for one trace); `ReproSpec.propertyIds` is a list (D5 targets two properties); `failGate`/`passGate` are synchronous; files fiks writes into shop-mcp are formatted with shop-mcp's Biome so its CI lint passes. The F gate's stated-reason check is `classifyFailure`: the first failure line must name exactly the target properties. The P gate requires the repro test to have run with every assertion passed.
- `packages/cli/src/commands/repro.ts`.
- `packages/cli/test/oracles/*.patch` (deviation: the oracle and negative tests drive the shop-mcp harness, which lives in `@fiks/cli`, so they run there; `@fiks/repro` stays free of the harness).

**Interfaces:**
```ts
interface Trace extends CallRecord { id: string; capturedAt: string; runId: string; contractId: string;
  violated: Violation[]; server: { name: string; transport: 'stdio' | 'http'; gitSha?: string }; vendorVersionHeader?: string }
interface ReproSpec { traceId: string; propertyId: string; testPath: string /* test/repro/<id>.test.ts */;
  tracePath: string /* test/traces/<id>.json */ }
interface GateResult { gate: 'F' | 'P' | 'local' | 'ci'; ok: boolean; reason: string;
  evidence: { command: string; exitCode: number; failed: { test: string; message: string }[]; logPath: string; url?: string } }
function generateRepro(trace: Trace, repoDir: string): Promise<ReproSpec>;
function failGate(repoDir: string, spec: ReproSpec, runs?: number): Promise<GateResult>;   // F
function passGate(repoDir: string, spec: ReproSpec): Promise<GateResult>;                  // P
```

**Acceptance:**
```
rm -rf .fiks/traces && pnpm fiks scenario D2 --json >/dev/null && ls .fiks/traces/*.json | wc -l        # >= 1
jq -e '(.http | length) >= 1 and .violated[0].propertyId == "shop.get_product/price.notNull"' .fiks/traces/*.json
for D in D1 D2 D3; do pnpm fiks repro --scenario $D --target seed-v1 --runs 3 --json | jq -e '.gateF.ok == true and (.gateF.evidence.failed | length) == 1'; done
pnpm fiks repro --scenario D2 --target seed-v1 --json | jq -r '.gateF.evidence.failed[0].message'   # contains shop.get_product/price.notNull
pnpm --filter @fiks/cli test -- oracle        # per drift: F fails for the property; after oracle patch, P passes AND full shop-mcp suite passes
pnpm --filter @fiks/cli test -- negative      # (1) trace whose test passes on unfixed code -> gateF.ok=false "passed on unfixed code";
                                              # (2) fixture tampered -> gateF.ok=false "wrong failure reason"
grep -rn "oracles" packages --include='*.ts' | grep -v '/test/' ; test $? -eq 1 && echo ORACLE_ISOLATED
env -u ANTHROPIC_API_KEY pnpm test
```
`--target seed-v1` makes a throwaway worktree at tag `seed-v1` under `.work/wt/`, and deletes it afterwards.

---

### M4: Repair agent, worktree and PR opener with the green-CI gate (4.5 h; the key is needed only for the live repair)

**Goal (per trace):**
1. Create a worktree at `.work/wt/fiks/<slug>-<traceId>` on branch `fiks/<slug>-<traceId>`, based on `origin/<base>` (default `main`).
2. Add the trace and the repro test. Run the F gate. Commit 1 is `test: failing repro for <propertyId> (fiks)`.
3. Run the repair agent.
   - Prompt: the trace, the contract, the violated property, the v1 baseline fixture for the same call (if it exists), `vendor/openapi.json`, an allow-list of files (`src/**`), and the exact failing assertion output.
   - Model `REPAIR_MODEL`, `maxTurns` 30, `maxBudgetUsd` 5, `settingSources: []`.
   - Tools: Read/Grep/Glob/Edit/Write, and Bash limited to `pnpm *`.
   - Allowed edits: `src/**` only. Forbidden path guard: anything under `test/**`, `.github/**`, `package.json` or `pnpm-lock.yaml` → the attempt is rejected.
4. **Re-record** (fiks, not the agent): for every trace or fixture the fixed code no longer applies to, run `fiks rerecord`. Commit only `*.rerecorded.json` files as `test: re-record changed upstream calls (fiks)`.
5. **Local gate** (C20, C21): P gate, then `pnpm typecheck && pnpm lint && pnpm test`. That last command includes the full contract suite, all stored traces and the v1 fixtures. Commit 2 is `fix: <summary> (fiks)`, containing agent edits only.
6. If any gate fails, retry at most 2 times with the failure log appended, then try the fallback runner once. Otherwise record `status: gate_failed` with the reason. Never hand-fix and report the result as the agent's.
7. **Green-CI gate.** Push the branch. Wait for the push-triggered run with `gh run watch <id> --exit-status` (15-minute timeout). Only when it is green run `gh pr create`. If CI is red or times out, no PR is opened, the branch stays for inspection, and the status is `ci_red` or `ci_timeout`. This is how "never open a PR with failing CI" is enforced in code.
8. **PR body sections:** `## What broke`, `## Trace`, `## Reproduction test`, `## Fix`, `## Before / after`, `## Gates`. Before/after shows the F output, the P output and the CI run URL. Add the label `fiks`. **Never** call `gh pr merge` or enable auto-merge.
9. `fiks confirm`:
   - Polls `gh pr view --json state,mergedAt` and appends `pr_merged`.
   - Then fast-forwards `.work/shop-mcp` to `origin/main`, replays all traces through the proxy, and checks that the violation count for each `contractId` is 0.
   - It appends `confirmed` only if that holds.

**Files:**
- `packages/repair/src/{worktree.ts,prompt.ts,runner-agent-sdk.ts,runner-claude-cli.ts,guard.ts,local-gate.ts,ci-gate.ts,pr.ts,events.ts}` plus tests. The tests use a fake `gh` shim on PATH and a local bare git remote.
- `packages/cli/src/commands/{repair.ts,confirm.ts}`.

**Interfaces:**
```ts
type RunnerKind = 'agent-sdk' | 'claude-cli' | 'oracle' | 'oracle-broken';   // oracle* only behind --selftest, never in demo
interface RepairRunner { kind: RunnerKind; run(job: RepairJob, prompt: string, signal: AbortSignal): Promise<{ ok: boolean; costUsd?: number; turns?: number; log: string }> }
interface RepairJob { traceId: string; propertyId: string; repoDir: string; baseRef: string; branch: string; worktreeDir: string;
  repro: ReproSpec; contract: ToolContract; allowedPaths: string[]; model: string; maxTurns: number; maxBudgetUsd: number }
interface RepairResult { job: RepairJob; attempts: number; runner: RunnerKind; fixCommitFiles: string[]; gates: GateResult[];
  costUsd?: number; ciRunUrl?: string; pr?: { number: number; url: string };
  status: 'pr_opened' | 'gate_failed' | 'agent_failed' | 'ci_red' | 'ci_timeout' }
interface LoopEvent { ts: string; runId: string; traceId?: string; propertyId?: string;
  type: 'violation' | 'trace_saved' | 'repro_generated' | 'gate_F' | 'repair_started' | 'gate_local' | 'branch_pushed'
      | 'gate_ci' | 'pr_opened' | 'pr_merged' | 'confirmed'; ok?: boolean; data?: Record<string, unknown> }
```

**Acceptance, no key:**
```
pnpm --filter @fiks/repair test     # covers: worktree create/cleanup; guard rejects test/** edits;
                                    # PR body sections; CI red -> fake gh never receives "pr create"; order of gates
pnpm fiks repair --scenario D2 --selftest oracle-broken --no-pr --json | tee .fiks/red.json | jq -e '.status == "ci_red"'
gh pr list -R vats98754/shop-mcp --head "$(jq -r .job.branch .fiks/red.json)" --json number -q length    # 0
grep -rnE "pr merge|--auto|merge_method|automerge" packages scripts ; test $? -eq 1 && echo NO_AUTOMERGE
```

**Acceptance, key required (live, real PRs; D1–D3 required, D4–D5 stretch):**
```
pnpm fiks repair --scenario D2 --json | tee .fiks/d2.json | jq -e '.status == "pr_opened" and .runner == "agent-sdk"'
N=$(jq -r .pr.number .fiks/d2.json)
gh pr view $N -R vats98754/shop-mcp --json state,statusCheckRollup -q '.state, ([.statusCheckRollup[].conclusion] | unique)'   # OPEN, ["SUCCESS"]
gh pr view $N -R vats98754/shop-mcp --json body -q .body | grep -cE '^## (What broke|Trace|Reproduction test|Fix|Before / after|Gates)$'   # 6
jq -r '.fixCommitFiles[]' .fiks/d2.json | grep -v '^src/' ; test $? -eq 1 && echo FIX_ONLY_SRC
jq -e '[.gates[] | select(.ok) | .gate] == ["F","P","local","ci"]' .fiks/d2.json
```
Repeat for D1 and D3. Before reporting PASS, the verifier inspects the F-gate assertion text in each PR body.

---

### M5: Bench and summary.json (3.5 h, key required)

**Goal.** An Anthropic SDK agent (`BENCH_MODEL`) runs fixed tasks through the proxy (stdio). Each run ends with a bench-local `submit_answer` tool. A deterministic grader compares the answer to vendor ground truth (`/__admin/state`).

**Tasks (6):** T1 price of p-1001 (D2), T2 cheapest laptop under budget (D1), T3 buy 2 × p-1004 and confirm the order exists (D3), T4 count all cables (D4), T5 date order o-5001 was placed (D5), T6 control (product name lookup).

**Phases.** k=5 per task, trials run sequentially:
- `A_v1`: vendor v1, shop-mcp `seed-v1`.
- `B_v2`: vendor v2, `seed-v1`, receipts visible.
- `C_v2_fixed`: vendor v2, shop-mcp `origin/main` after human merges. If the PRs are not merged yet, use `--shop-ref pr-heads` and label the phase `C_v2_prheads`. Never mislabel it.

**Metrics.**
- pass^k for k=1..5 per phase, using the τ-bench estimator C(c,k)/C(n,k) averaged over tasks.
- Per drift: `detected`, `reproValid` (F gate ok, and the P gate ok in the PR), `prGreen`, `prUrl`, `minutesDriftToPr` (first `violation` to `pr_opened`), `merged`, `confirmed`.
- `falsePositivesV1`: count of violated receipts in phase A. It must be 0.

**Files:**
- `packages/bench/src/{tasks.ts,grader.ts,agent.ts,run.ts,summarize.ts,drift-map.ts}` plus tests. `drift-map.ts` maps propertyId to a drift and is used only by the bench; the proxy knows nothing about drifts.
- `bench/results/<runId>/{trials.jsonl,events.jsonl,meta.json}` (committed).
- `bench/results/summary.json`.

**Interfaces:**
```ts
type Phase = 'A_v1' | 'B_v2' | 'C_v2_fixed' | 'C_v2_prheads' | 'C_replay';
interface TrialRecord { runId: string; phase: Phase; taskId: string; trial: number; pass: boolean; reason: string;
  calls: { tool: string; verdict: Verdict; propertyIds: string[] }[]; model: string; startedAt: string; durationMs: number;
  usage: { input: number; output: number } }
interface Summary { generatedAt: string; model: string; runIds: string[]; shopMcpSha: Partial<Record<Phase, string>>;
  phases: Partial<Record<Phase, { tasks: number; k: number; passHatK: number[] /* index 0 = k=1 */ }>>;
  drifts: Record<'D1'|'D2'|'D3'|'D4'|'D5', { detected: boolean; reproValid: boolean; prGreen: boolean; prUrl: string | null;
    minutesDriftToPr: number | null; merged: boolean; confirmed: boolean }>;
  falsePositivesV1: number; sources: string[] /* every log file read */ }
```

**Acceptance:**
```
env -u ANTHROPIC_API_KEY pnpm --filter @fiks/bench test        # pass^k math on fixed inputs; grader on scripted answers
pnpm fiks bench --phase A --k 1 --tasks T6 --model claude-haiku-5-5 --out .fiks/smoke --json | jq -e '.trials | length == 1'
pnpm fiks bench --phase A --k 5 && pnpm fiks bench --phase B --k 5      # then phase C after human merge (or --shop-ref pr-heads)
jq -e '.falsePositivesV1 == 0' bench/results/summary.json
jq -e '.phases.A_v1.passHatK | length == 5' bench/results/summary.json
jq -e '[.drifts.D1, .drifts.D2, .drifts.D3] | all(.detected and .reproValid and .prGreen and (.prUrl != null))' bench/results/summary.json
pnpm fiks summarize --check     # re-derives summary.json from bench/results/** and diffs: exit 0 = no hand edits
```
Then run **agent-ux-tester** on the real transcripts in `bench/results/<runId>/trials.jsonl`.

---

### M6: Dashboard (2.0 h, no key)

**Goal.** One page (Vite + React + Recharts) showing:
- A headline before/after pass^k chart (A vs B vs C).
- A per-drift loop status table.
- A timeline for one drift: violation → test → PR → merged → green, built from `events.jsonl`.

All data comes from `bench/results/summary.json` and `events.jsonl`, which `scripts/copy-data.mjs` copies into `public/data/` at build. No numbers are typed into the source.

**Files:** `apps/dashboard/{index.html,vite.config.ts,src/{main.tsx,App.tsx,Headline.tsx,DriftTable.tsx,Timeline.tsx,data.ts}}`, `scripts/copy-data.mjs`.

**Acceptance:**
```
pnpm --filter @fiks/dashboard build
pnpm --filter @fiks/dashboard test          # renders from a fixture summary; asserts displayed numbers == fixture values
grep -rnE '[0-9]+(\.[0-9]+)?\s*%|pass\^k\s*=\s*[0-9]' apps/dashboard/src ; test $? -eq 1 && echo NO_HARDCODED_NUMBERS
(pnpm --filter @fiks/dashboard preview --port 4173 & sleep 3; curl -sf localhost:4173/data/summary.json | jq -e '.falsePositivesV1 == 0'; kill %1)
```
Then run **designer**.

---

### M7: README, DEMO.md and claims audit (1.5 h)

**Goal.**
- **README**: a 30-second pitch with claim IDs; the one-command demo; a chart rendered from `summary.json` (`scripts/render-chart.mjs` writes an SVG); how it works; and a Limitations section covering C11 (vocabulary limit), C20 (partial-patch risk), seeded vs real drift, call serialization in the HTTP tap, and the env-var base-URL requirement.
- **DEMO.md**: a 3-minute script.
- **`pnpm demo`**: harness on vendor v2 → scripted calls → violations → traces → repro (F) → repair → CI gate → PR. It prints the PR URLs and stops. It does not merge. Without a key it stops after the F gate and prints exactly what is missing.
- **`pnpm demo:confirm`**: run after a human merges.
- **`pnpm demo --base fresh`**: creates `demo/<runId>` from `seed-v1` as the PR base, so the demo can be repeated after merges.

**Files:** `README.md`, `DEMO.md`, `scripts/{check-claims.mjs,render-chart.mjs}`, `docs/chart.svg`.

**Acceptance:**
```
node scripts/check-claims.mjs      # every [Cnn] in README.md/DEMO.md exists in RESEARCH.md; every number is tagged [Cnn] or (bench)
grep -c '^## Limitations' README.md                                          # 1
grep -E 'C11|C20' README.md | wc -l ; grep -ci 'seeded' README.md             # each >= 1
D=$(mktemp -d) && git clone git@github.com:vats98754/fiks.git $D/fiks && cp .env $D/fiks/.env && \
  (cd $D/fiks && pnpm i && pnpm test && pnpm demo --base fresh --drifts D1,D2,D3 --json | jq -e '[.results[].status] | all(. == "pr_opened")')
```
Then run **claims-auditor**, which must PASS. The final verifier PASS covers the definition of done.

**Time total:** 22.5 h of work plus 1.5 h buffer = 24 h.

---

## 2. Packages (exact pins, all published on or before 2026-10-04)

| Package | Pin | Published | Where |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | **1.32.0** | 2026-10-02 | proxy, cli, shop-mcp (1.32.1 is 10-05: too new) |
| `@anthropic-ai/sdk` | **0.131.0** | 2026-09-30 | bench (0.132+ too new) |
| `@anthropic-ai/claude-agent-sdk` | **0.3.289** | 2026-10-03 | repair. Peers: zod ^4, @anthropic-ai/sdk >=0.93, MCP SDK ^1.29 (all satisfied) |
| `zod` | **4.6.5** | 2026-09-13 | all (MCP SDK peer ^3.25 \|\| ^4; Agent SDK needs ^4) |
| `typescript` | **6.0.3** | 2026-04-16 | all. 7.0.2 (native) is "latest", but 6.x keeps the JS API stable for tooling |
| `vitest` | **5.0.3** | 2026-09-30 | all (Node ^22.12 required) |
| `@biomejs/biome` | **2.5.15** | 2026-09-30 | lint and format, both repos |
| `tsx` | **4.23.15** | 2026-09-20 | cli runner |
| `vite` | **8.3.2** | 2026-10-01 | dashboard (Node >=22.12) |
| `@vitejs/plugin-react` | **6.1.1** | 2026-08-28 | dashboard (6.1.2 is 10-05: too new) |
| `react` / `react-dom` | **19.3.0** | 2026-09-09 | dashboard |
| `@types/react` / `@types/react-dom` | **19.3.0** | 2026-09-09 | dashboard |
| `recharts` | **3.10.1** | 2026-07-25 | dashboard |
| `@types/node` | highest 22.x published ≤ 2026-10-04 | resolve in M0 | all; `check-pins.mjs` enforces the date |

- Not needed: express, nock, msw, dotenv, Octokit. Use `node:http`, the strict replay server in shop-mcp, `process.loadEnvFile`, and `gh`.
- GitHub Actions in shop-mcp: `actions/checkout`, `actions/setup-node`, `pnpm/action-setup`, each pinned by SHA as described in M0.
- **Fallback stack if Node cannot reach 22.12:** vitest 4.1.11 (2026-08-18, Node ^22.0.0) plus a vite 6.4.x and a matching `@vitejs/plugin-react` 5.x, both chosen by `check-pins.mjs` for publish date ≤ 2026-10-04. Write the decision down in PROGRESS.md.

---

## 3. Risks and fallbacks

| # | Risk | Fallback |
|---|---|---|
| 1 | Repair agent is flaky, makes partial patches (C20) or edits tests | Narrow the prompt to the trace, contract, failing assertion, v1 baseline fixture and file allow-list. The guard rejects any non-`src/` edit. Up to 2 retries with the gate log, then the `claude -p` runner, then Sonnet 5.5. After that, report `gate_failed` honestly. Never hand-fix. |
| 2 | Agent SDK native binary or auth problems | Set `pathToClaudeCodeExecutable` to the installed `claude`. Otherwise use the `claude -p` runner (same interface). |
| 3 | GitHub Actions is slow or queued, which inflates minutes drift→PR or causes timeouts | Keep CI under 2 minutes: pnpm cache, no build step, vitest only. 15-minute timeout → `ci_timeout` and no PR. Report the measured minutes as they are. |
| 4 | Streamable HTTP is flaky | Ship stdio first (all of M2–M5 use stdio). HTTP gets one acceptance line and is item 4 on the cut list. |
| 5 | Repro is non-deterministic (time, ordering, unmatched requests) | Clock frozen at `capturedAt`. The strict replay server returns 599 `UNMATCHED_REQUEST`, which the gate classifies as a wrong failure. The F gate runs 3 times. |
| 6 | False positives on v1 | Tune contracts on the v1 fixtures in M2. FP = 0 is a hard gate before M3. If a contract can't reach 0, drop that invariant and log it. |
| 7 | Drifts hide each other in v2 | D1 and D4 share `GET /products`. `VENDOR_DRIFTS` isolates drifts for detection tests only. Stored traces use the full v2 profile with `target`/`outOfScope`, so each PR is scoped to its own property. |
| 8 | A fix breaks v1, or parallel PRs conflict | The local gate includes the v1 fixtures, and the version header allows compatible fixes. One file per tool. If a conflict happens after a merge, re-run `fiks repair` on the new base. |
| 9 | Tap correlation is wrong under concurrency | A mutex serializes calls per upstream, and the bench is sequential. Stated in Limitations. |
| 10 | Node 22.5.1 is below the vitest/vite engine floor | Upgrade Node in M0. Otherwise use the fallback stack in §2. |
| 11 | Bench cost or variance | 6 tasks × k=5 × 3 phases = 90 trials on Sonnet 5.5. Smoke on Haiku 5.5 first. Anthropic SDK retries on 429/529 with backoff. |
| 12 | `vite 8.3.2` predates the 2026-10-06 patch releases | It is dev-only and local. If `pnpm audit` flags 8.3.2, take 8.3.3 as a pin exception documented in PROGRESS.md. |
| 13 | Hackathon judging and submission format unknown (RESEARCH §G) | Get them from Discord before M5 and add them to CLAUDE.md. Until then, follow the definition of done. |
| 14 | Demo can't be repeated once fixes are merged | `--base fresh` uses a `demo/<runId>` branch cut from `seed-v1`. |

---

## 4. Cut list (cut in this order)

1. Dashboard polish: keep the headline, the table and one timeline; drop animation and extra charts.
2. D5 timestamp drift: keep its contract; drop its repair and PR.
3. D4 pagination drift: same as D5.
4. Streamable HTTP transport: stdio only; say so in the README.
5. `demo --base fresh` repeatability mode.
6. Bench task count 6 → 4. **k stays 5**, and pass^k k=1..5 stays.
7. The `claude -p` fallback runner (keep the interface).
8. Live phase C: replace with `fiks confirm` trace replay only, labelled `C_replay` in summary.json.
9. The dashboard as a whole: keep the README chart rendered from summary.json.

**Never cut:** verifier gates after each milestone, the F→P gate (including the "stated reason" check), the green-CI-before-PR gate, no auto-merge, the claims audit, FP = 0 on v1, and the rule that every number comes from logs.
