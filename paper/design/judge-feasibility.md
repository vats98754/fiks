# Judge report: engineering feasibility

Judge lens: engineering feasibility. I checked each design against `paper/research/codebase-map.md` and the actual code at HEAD `ec241bc`. The questions were: can the workstreams run in parallel without file conflicts, are the dependencies right, are the hour and runtime estimates realistic on one 16 GB Apple M2 Mac with an OAuth token, are the acceptance tests executable, and what will break first.

Date 2026-10-21. Inputs:
- `paper/design/design-narrow-rigor.md` (NR)
- `paper/design/design-reviewer-first.md` (RF)
- `paper/design/design-maximal-evidence.md` (ME)
- `paper/ORCHESTRATION.md`, `paper/research/SYNTHESIS.md` §8 and `paper/research/codebase-map.md`
- `PROGRESS.md`
- these source files: `packages/repair/src/{runner,gates,guard}.ts`, `packages/bench/src/agent.ts`, `packages/repro/src/worktree.ts`, `packages/cli/src/{paths,harness}.ts` and `packages/cli/src/commands/repair.ts`
- `bench/results/loop/repairs/*.json`

I re-ran a sample of the power numbers with `eval_stats.py mde`. All of them reproduce:
- NR: n=60, sd 0.25, α .01 gives 0.110.
- RF: n=40, sd 0.5, α .0083 gives 0.275.
- ME: n=80, sd 0.45, α .00833 gives 0.175; n=88, sd 0.40 gives 0.148.

## Facts about the code and machine that the designs depend on

These are things I verified myself. They decide what breaks first.

| # | Fact (where) | Consequence |
|---|---|---|
| F1 | Worktrees **symlink the host clone's `node_modules`** (`repro/src/worktree.ts` `addWorktree`; `cli/src/paths.ts:31`). The host is darwin-arm64, so Biome, esbuild and rollup have native darwin binaries there. | Every design runs gates and agent Bash in a **Linux** Docker container. Mounting the worktree as it is gives a dangling absolute symlink and the wrong-platform binaries, so the gates crash. The sandbox needs its own per-repo image with `node_modules` installed for Linux from the lockfile. The F, P, suite and CI gates must all run in that image, otherwise host and container verdicts can differ. |
| F2 | The repair agent's only exec tool is `Bash`, and `canUseTool` already restricts it to `pnpm typecheck\|lint\|test` / `pnpm exec vitest run` (`runner.ts`, `guard.ts` `mayRun`). | Sandboxing the agent is cheap: `canUseTool` returns `updatedInput` with the command rewritten to `docker exec <ctr> …`. The `claudeCliRunner` fallback cannot be rewritten that way, so it must be disabled in experiments. |
| F3 | `runner.ts` and `bench/agent.ts` pass `env: { ...process.env }` to the Claude CLI subprocess. | The environment must be scrubbed to the OAuth token plus PATH and HOME. Otherwise the canary test fails in every design. |
| F4 | `--no-pr` **still pushes the branch and waits for GitHub Actions** (`commands/repair.ts` step 5 `ciGate` runs before the `noPr` return). | All three designs plan 1,000–5,000 repair runs "with `--no-pr`". As written, each one would push a branch to vats98754 and burn Actions minutes plus about 35 s of wall time. A `--ci local` mode that never pushes is required. |
| F5 | Repair results are written to `FIKS_DIR/repairs/${trace.id}.json` (`repair.ts`). `FIKS_DIR` is a module-level constant read at import (`paths.ts:9`). | Repeated attempts, arms and models on the same trace **overwrite one another**. Workers must be separate processes, and results must be keyed by (experiment, arm, model, drift, attempt). |
| F6 | `addWorktree` runs `git worktree prune` and `worktree add` on the **shared** shop clone every time. | Parallel workers race on `.git/worktrees`. Git operations need a lock, or each worker needs its own clone. |
| F7 | Ports are ephemeral (`tap.ts` `listen(0)`), so the vendor, tap and proxy can run in parallel. | Good. Nothing to fix. |
| F8 | The Docker daemon is **not running**. The machine is an M2 with 16 GB of unified memory and 8 cores. `oasdiff` and `hoverfly` are not installed. ollama is installed and will use Metal; a 7B Q4 model takes about 5 GB. | Docker Desktop's VM (by default about half of RAM), plus N Claude CLI processes (about 300 MB each), vitest workers and ollama, are all competing for 16 GB. The ollama phases and the container-heavy phases cannot run at the same time. Each tool install or model download needs the user's approval. |
| F9 | Existing repairs: 5/5 first-attempt success, 83–97 s, $0.11–0.21, 10–14 turns (`bench/results/loop/repairs`). About 35 s of each run is the GitHub CI wait. | Local CI saves about 35 s per run, and the container adds some time back. On blind drifts, both repair arms may also succeed almost always, which makes "fewer incorrect PRs" hard to show. The pilot has to measure this. |
| F10 | The OAuth token is a Claude Code credential. The codebase-map suggested an `@anthropic-ai/sdk` judge. | The judge, the authoring agents and any shim have to go through Agent SDK `query` (with a `systemPrompt` override and `tools: []`). Each call spawns a CLI subprocess, so per-call overhead and the subscription's 5-hour and weekly caps (especially Opus) are the real budget, not dollars [verify in pilot]. |

## Scores

### design-narrow-rigor.md: 8 / 10 (winner)

**Strengths**
- The smallest build that still answers the reviewers' central attack. One new domain (tracker) plus shop. About 250–330 builder hours, $450–720 API-price, about 4–6 days of runs. This is the only design whose Opus volume is likely to fit inside subscription caps.
- The file-ownership rule cannot produce conflicts: SPINE owns every pre-existing file and creates skeleton packages first. The other 19 streams write only to new paths.
- The acceptance tests are concrete and executable, for example:
  - the D2 gate-verdict sequence matches the 2026-10-20 loop log;
  - kill -9 and resume leaves no duplicate keys;
  - 2-worker and 1-worker runs give identical verdicts;
  - the null-DGP Type I error stays within [0.04, 0.06];
  - a lint rule forbids injector imports of `@fiks/contracts`;
  - a hand-edited macro makes `paper:check` fail.
- The run plan has a dev-only pilot (R1 → K1), a top-up rule decided on detection counts only, and pairwise deletion of infra cells across arms. Its cut order is pre-registered and never touches held-out grading or verification.
- The injector is TypeScript and in-repo, and D1–D5 must be reproduced byte-for-byte. This is cheaper and easier to test than RF's Python injector or ME's Hoverfly middleware.
- All repair arms share `rerecordStale`, so request-changing fixes (D3/D4 type) do not penalise any one arm.
- Cuts that are expensive and off-claim are made deliberately: τ², Go and Python harnesses, receipts-on-agents, inference.

**Weaknesses**
- **SPINE is underestimated and serialised.** The design gives it 22–28 h. Codebase-map sums give: domain registry 8–12 h, monitor 3–4 h, bench robustness 7–11 h, arm, outcome, formatter and exec hooks, profile generalisation, and re-record with injector profiles. That is realistically 40–50 h, and every other stream waits on its hooks.
- The **C3 patch pool** depends on capturing every candidate at every gate and CI revision. No stream lists that capture as a deliverable.
- **Held-out SAST** includes CodeQL on about 3,400 patches. CodeQL needs roughly 1–2 min and 2–4 GB per run, which is about 100 CPU-hours and exceeds memory alongside Docker on 16 GB. The "R5 16–24 h" estimate does not hold.
- **Blind authoring in Docker with a model-API-only egress allow-list.** Docker has no domain allow-list, so this needs a proxy sidecar. It also has to put the OAuth token inside a container. A physical export of the workspace plus guarded reads achieves the same blindness more cheaply.
- **Hermetic CI** in `--network none` runs `pnpm install --frozen-lockfile`. That needs a pre-baked offline store and Linux `node_modules` (F1), and neither is in SBX's acceptance tests.
- The **judge route is unspecified** (F10).
- The **run budget omits authoring usage**: 100 drifts with hidden tests and reference fixes, a 20% second-fix sample, 30 benign cases, more than 600 catalog entities, patch-mutation agents and realism raters. At about $3–5 per Opus drift, that is $300–600 of API-price that is not in the R table.
- R4 is about 1,530 attempts, roughly 500 of them on Opus. A cap that hits mid-run needs a balanced-block pacing rule, so that a stop leaves complete (drift × model × attempt) blocks.

### design-reviewer-first.md: 6.5 / 10

**Strengths**
- The best integrity mechanics:
  - a freeze ledger whose order the verifier checks from tag ancestry and timestamps;
  - PREREG tagged **before any blind drift exists**;
  - tasks and argument generators written before drifts;
  - exposure decided mechanically.
- Practical parallelism rules: a `commands/*.ts` glob loader in WS1's first 3 hours, so nobody edits `cli/src/index.ts`; `pnpm-lock.yaml` regenerated only by the integrator; types-only interfaces (⚑) published at hours 3–4.
- The sandbox design matches the code (F2, F3): a host SDK process whose env holds only the OAuth token, Bash and gates via `docker run --network none`. Its acceptance tests are runnable: 4 canary probes, and all M4 PoCs still end in `gate_failed`.
- RF-H4 at n = 240 with an exact binomial test is cheap and well powered. §8.7 lists the decisions the user has to make (ollama download, new repos, human add-on).

**Weaknesses**
- **Four domains (shop re-contracted + 3 new) at 7–18 h each is optimistic.** The map says 20–30 h for the first new domain and 10–14 h for each further one, before 15 tasks with graders and argument generators per domain. The 291 h total is likely closer to 380–420 h.
- **The flagship repair claim RF-H3 is underpowered** (MDE 0.28 at n = 40) and runs on Opus only. Meanwhile about 900 repairs go into 6 arms, 4 of them ablations. The budget buys breadth, not the headline.
- **The Python injector** puts a second runtime inside `rerecord`, local CI and every worker. The language-separation argument does not make the drift author any more independent.
- **E2 runs about 12,200 agent trials**, about 4,000 of them on Opus. Together with E3 and E4 that is about $1.6k API-price, which is a real risk for the weekly cap.
- **E7 merges every correct RA0 candidate into a single `exp/merged-<domain>` branch.** With about 25 drifts per domain touching the same handlers, merge conflicts are likely: PROGRESS already shows D4 waiting on D1 because both touch the same file. Fixes validated under one drift profile can also break another.
- **WS13 real bugs (TS + Go, process-level replay) at 30 h is light.** The map gives 14–30 h per Node server and adds 6–8 h for process-level replay.

### design-maximal-evidence.md: 4 / 10

**Strengths**
- The most careful statistical bookkeeping: an IUT for guards, an SD planning value measured from logs, and CP2, where the confirmatory analysis runs once and is committed before anyone looks at exploratory results.
- It checks the environment explicitly (ollama not running, oasdiff and hoverfly missing).
- Strong safety rules:
  - P15, a hard owner allow-list (`vats98754`) in `pr.ts`, which directly answers the PR #5 incident;
  - `--no-pr` by default under `--arm`;
  - every download gated on the user's approval;
  - labels from a `truth()` projection, with a static-import check that the labeller never reads monitor output.
- The cut order is explicit, and the confirmatory subset (about 345 h) is named.

**Weaknesses**
- **About 640 builder hours across 30 streams, about $2.9–3.7k API-price, about 22,000 agent trials, 5,300 repairs and 18,300 judge calls, plus 48 h of CPU.** That very likely exceeds OAuth weekly caps. Even the "confirmatory subset" needs 4 domains × 24 tasks and 36 author drifts.
- **The LLM shim (P12)** has to present an OpenAI- and Anthropic-compatible *function-calling* endpoint on top of Agent SDK `query`. That SDK is an agent loop that executes tools itself, not a raw completions API. τ² agents and ALTK depend on this shim, and it carries a fidelity risk. Running τ² over HTTP and MCP (WS-TAU, 26 h) means re-plumbing τ²'s in-process tool calls. τ² alone is 67–134 h of sequential runs.
- **Many baselines are [verify]-gated and heavy to install**: ContextForge, AGORA+ (Java, GPL), Docker MCP Gateway, Hoverfly, ALTK, mini-swe-agent through the shim. Each one is a likely stall.
- **R6 merges every gate-passing patch into one `exp/fiks-fixed` branch per domain.** That has the same conflict problem as RF's E7, and here it is **confirmatory (C5)**.
- **Ownership collisions**:
  - WS-DOM-SHOP "moves `tasks.ts`", but `bench/src/index.ts`, which re-exports it, belongs to WS-BENCH;
  - the sandbox needs `runner.ts`, which WS-REP owns, while WS-SEC-HARD owns `guard.ts`;
  - every new command must be registered by WS-CORE in `main.ts`, so about 10 streams queue on one owner.
- **The Go and Python real-bug harnesses (115 h)** are the cost centre with the lowest value of information.

## Winner: design-narrow-rigor.md

It is the only design whose builder-hours, critical path, wall clock and Opus volume fit one Mac and one OAuth token with some margin. Its ownership scheme cannot conflict, and almost all of its acceptance tests can run as written. Its weaknesses are fixable engineering gaps; they do not come from the scope itself.

## Grafts from the runners-up

1. **RF freeze ledger** (`paper/prereg/freeze-ledger.json`), with the verifier checking order from tag ancestry and timestamps. Freeze the PREREG text before blind drifts are authored. Only the pilot-derived n, attempts and σ go in afterwards, and only from dev data.
2. **RF command glob loader** (`commands/*.ts` auto-registration), **integrator-only `pnpm-lock.yaml`** and **types-only interfaces at hour ~4**. Together these take most of the serial load off SPINE.
3. **RF sandbox mechanics** in place of NR's container-proxied execution:
   - `canUseTool` rewrites the allow-listed Bash into `docker exec`;
   - the host SDK env holds the OAuth token only;
   - the CLI fallback is disabled in experiments;
   - acceptance is the 4 canary probes plus the existing M4 PoCs still ending in `gate_failed`.
4. **RF P0a rate-limit pilot rule.** Run 4 workers. If there is a 429 storm, drop to 2, and record s/trial and $/trial per model before any n is frozen.
5. **RF §8.7 / ME §8.6 user-decision list.** Get approval for: the ollama model download, new repos (`tracker-mcp`, `driftbench-blind`), tool installs (oasdiff, Semgrep image), Docker Desktop start and memory setting, and the optional human add-on.
6. **ME P15**: a hard owner allow-list in `pr.ts` and `--no-pr` by default whenever `--arm` is set.
7. **ME `truth()` labeller**, with a static-import check that labels never read monitor output (acceptance in DET/HOLD).
8. **ME CP2**: the confirmatory analysis runs once on complete data and is committed before any exploratory output is opened.
9. **ME physical-export blind workspace**: authors get an exported snapshot outside `~/fiks`, not a Docker egress allow-list.
10. **ME "env facts" pre-check**, turned into an R0 install-and-approve checklist.

## Must-fix before PLAN.md is accepted (winner, after grafts)

1. **Local-only CI path.** `--no-pr` currently still pushes and waits for GitHub Actions (F4). Add `--ci local|github|none`, use `local` in every experiment, and cross-check against Actions only on the P9 sample of 20 heads. Acceptance: an R4-style run produces no `git push` (audited with a gh/git shim).
2. **Linux container image for gates and agent Bash** (F1).
   - Build a per-repo image with Linux `node_modules` from the lockfile and an offline pnpm store.
   - Mount the worktree without the host `node_modules` symlink.
   - Run F, P, suite and local CI all in that image.
   - Acceptance: D1–D5 F/P verdicts and messages are identical between host and container, and so are the oracle-patch gate results.
3. **Repair result keys and worker isolation** (F5, F6).
   - Key results by (experiment, arm, model, drift, attempt), not `trace.id`.
   - One OS process per worker with its own `FIKS_DIR`.
   - Serialise git worktree operations with a lock, or give each worker its own clone.
   - Acceptance: 20 concurrent create/remove cycles with no corruption, and a 2-worker vs 1-worker run giving identical results.
4. **Capture every candidate patch** (C3 pool): snapshot the diff at each gate and CI invocation for all arms, including COMP revisions. This is a listed deliverable with acceptance in ARMS/SPINE.
5. **Re-record with injector profiles.** The trace profile must carry the injector rule id and hash, and `rerecord()` must start the injector in the chain. Acceptance: D3 and D4 re-expressed as injector rules, with the oracle fix passing the P gate through re-record in all arms. Without this, request-changing blind drifts end in `UNMATCHED_REQUEST` and confound C4/C5.
6. **LLM-call route.** Every judge, author, rater and repair call goes through Agent SDK `query` (OAuth), with a `systemPrompt` override and `tools: []`. Measure per-call spawn overhead and cap behaviour in the pilot. Do not use `@anthropic-ai/sdk` with the OAuth token [verify].
7. **Usage budget and pacing.**
   - Add authoring and agentic-mutation usage to the run table.
   - Pre-register a balanced-block pacing rule, so a 5-hour or weekly cap stop leaves complete (drift × model × attempt-index) blocks across all arms.
   - Order the confirmatory runs first.
8. **Make SAST feasible.** Drop CodeQL, or restrict SAST to final heads that reached `would_open_pr` and scan the diff only. Use Semgrep CE + eslint-plugin-security + one AST detector, 2-of-3. Re-estimate R5 from a timed pilot on 20 patches.
9. **Blind-authoring leakage.** `~/fiks/CLAUDE.md` describes D1–D5 and the contract design.
   - All author, contract-author, rater and repair sessions run with `settingSources: []` and a cwd outside `~/fiks`, so neither the project CLAUDE.md nor auto-memory loads.
   - Workspaces are physical exports.
   - The audit log records every tool call.
   - Acceptance: a planted "secret" sentence in `~/fiks/CLAUDE.md` never appears in any author transcript.
10. **Re-estimate SPINE at 40–50 h** and split it. SPINE-A covers the domain registry, trace profile and injector-aware re-record. SPINE-B covers the bench, run registry, cost, infra error and the arm, outcome and exec hooks. Re-derive the critical path with that estimate before the PREREG date is promised.
11. **Memory schedule.** Docker Desktop memory is set explicitly, for example 6 GB. Agent workers are capped by measured RSS, and ollama phases (R9) never run alongside R4 or R5.
12. **Detection-count risk.** Shop contracts are frozen at `seed-v1` with 4 tools. If blind detection on shop is about 30–40%, the floor of 40 detected test drifts is at risk. Pre-register the top-up wave's usage, and let the top-up go to the domain with the lower count only by a pre-declared rule.
