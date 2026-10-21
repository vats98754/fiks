# Novelty: adversarial prior-art search for the fiks loop

Area: novelty. Written 2026-10-21. Sources: `novelty.sources.json` (37 entries). Keys in `[brackets]` refer to that file. Claim IDs (C11, C13, C27, C28) refer to RESEARCH.md.

## 1. Scope and searches run

**Question.** As of 2026-10-21, has any paper, product, startup, open-source project or patent built the full fiks loop, or large parts of it? The loop is: runtime detection of a semantically wrong *successful* tool/API result → trace capture with raw upstream HTTP → deterministic reproduction test that must fail first (F gate) → automated source repair → gated PR (repro, suite, traces, typecheck, lint, green CI on the exact commit) → never merge → confirm after merge.

**How the search ran, and its limits (read this first).**
- This run's shared WebSearch budget (200 calls per turn, across all swarm agents) was already used up when this agent started. All four WebSearch calls it made were refused. So this file contains **no new keyword searches**.
- Instead it uses:
  1. WebFetch on candidate URLs known in advance (product docs, GitHub repos, arXiv abstracts and full text), all fetched on 2026-10-21;
  2. sources already verified by sibling areas (`observability`, `mcp-market`, `llm-repair`, `api-contracts`, `silent-failures`, `runtime-monitors`). These are re-fetched where marked, and otherwise reused with the sibling's quote.
- **Consequence.** Recall is limited to candidates we already knew to look for. Patent databases (Google Patents, USPTO, EPO) were **not searched**. Neither were recent arXiv papers or startups we did not already know by name. A follow-up search pass is listed under Open gaps (§9). Every "we did not find" below inherits this limit.
- **Fetched and read on 2026-10-21 (32 URLs).** Itzal (abs and full PDF), Exterminator (full PDF), Outcome Monitors (HTML full text), LangSmith Engine, Arize Signal, PostHog anatomy-of-a-PR, Sentry Seer Issue Fix, Datadog Bits Code, incident.io AI SRE, Composio MCP Gateway, ADAPTIX, self-healing-api-agent, apipatch (PyPI JSON), n8n PR #40979, Tusk Drift, Keploy, Speedscale, GoReplay, Diffy, Meticulous, Optic, Beeceptor drift, Visa TDCommons #10178, Postman Insights, Airbyte AI Assist, Superface OneSDK, Byam, BUMP, R-Hero, Kodezi Chronos, mcp-eval, Meta Engineering Agent, Dependabot docs.
- **Dropped after reading (not relevant enough).**
  - superglue (FSL): its README makes no self-healing claim.
  - Superface OneSDK: no automatic adaptation is claimed.
  - Kodezi Chronos: a debugging LLM with no production monitoring in its abstract.
  - R-Hero: its abstract does not describe its trigger or PRs.
- **Failed to load.** The apipatch 0.8.2 HTML page cited in C27 did not render. The PyPI JSON for v0.9.0 was used instead.

## 2. Source catalog

Cluster codes:
- **A**: production-driven repair, research lineage
- **B**: observability/trace → PR products (2025–26)
- **C**: "self-healing" tool/MCP/integration products and prototypes
- **D**: traffic → test / replay
- **E**: drift detection only
- **F**: upstream-change → client-fix, loud trigger
- **G**: detector-as-oracle / CI-bot repair

| # | Source | Year | Type | Central claim | Cluster |
|---|---|---|---|---|---|
| 1 | Itzal, Durieux/Hamadi/Monperrus `[durieux2016itzal]` | 2016/18 | paper | Production oracle detects a failing request → sandboxed patch search → regression on shadow traffic → patches to developers (PRs envisioned) | A |
| 2 | ClearView `[perkins2009clearview]` | 2009 | paper | Learned invariants + runtime monitors → binary patches evaluated in deployment | A |
| 3 | Exterminator `[novark2007exterminator]` | 2007 | paper | Runtime memory-error patches, merged collaboratively across users | A |
| 4 | SapFix + Sapienz `[sapfix2018]` | 2018 | blog | Crash found by search-based testing → patch → tests → human review | A/G |
| 5 | Meta Engineering Agent `[maddila2025metaagent]` | 2025 | paper | Failing test → agentic fix → LLM judge → human review; 31.5% of reviewed fixes landed | G |
| 6 | Repairnator `[repairnator]` | 2018 | paper | CI build failure → patch → PR | G |
| 7 | Copilot Autofix `[github-copilot-autofix-docs]` | 2026 | docs | Static alert → fix; validated by re-running the detector | G |
| 8 | LangSmith Engine `[langsmith-engine-docs]` | 2026 | docs | Scheduled trace scans → issues → root cause → draft PR; replay validation (beta); never merges | B |
| 9 | Arize Signal `[arize-signal-docs]` | 2026 | docs | 6-hourly trace scans → issues → proposed fix → PR (Enterprise) | B |
| 10 | PostHog Self-driving `[posthog-self-driving]`, `[posthog-anatomy-pr]` | 2026 | docs | Signals → report → PR with a regression test that reproduces the failure; CI fixed after the PR opens | B |
| 11 | Sentry Seer `[sentry-seer-issue-fix]` | 2026 | docs | Error issue (≥10 events/14 d) → root cause → fix → PR; tests only on request | B |
| 12 | Datadog Bits Code `[datadog-bits-dev-agent]` | 2026 | docs | Error Tracking/APM signal → fix PR; CI auto-fix; never auto-merges | B |
| 13 | incident.io AI SRE `[incidentio-ai-sre]` | 2026 | docs | Declared incident → root cause → PR the user merges | B |
| 14 | Composio MCP Gateway `[composio-mcp-gateway]` | 2026 | docs | Toolkits self-patch from production call patterns (example: a recurring 400); published to every agent | C |
| 15 | ADAPTIX `[adaptix-self-healing-registry]` | 2026 | repo | Error + live-schema diff → autonomous tool-definition repair; checks shape only | C |
| 16 | MCP-Healer `[mcp-healer]` | 2026 | repo | Rewrites input payloads after 400s or schema errors | C |
| 17 | self-healing-api-agent `[self-healing-api-agent]` | 2026 | repo | OpenAPI spec diff → affected code → PR; no tests | C/F |
| 18 | ApiPatch `[apipatch]` | 2026 | repo | LLM knowledge + docs → fix deprecated calls → PR; syntax checks only | F |
| 19 | n8n self-healing agent `[n8n-pr-40979]` | 2026 | issue | Failed execution → verifier-gated candidate; no trigger; closed unmerged | C |
| 20 | Tusk Drift `[tusk-drift]` | 2026 | docs | Live traffic → API tests with recorded outbound calls; deviations on PRs classified; AI root cause + fix suggestions | D |
| 21 | Keploy `[keploy]` | 2026 | docs | Socket-level recording → tests + mocks; oracle = recorded response | D |
| 22 | Speedscale `[speedscale-docs]` | 2026 | docs | Captured traffic → replay against code changes, with mocks | D |
| 23 | GoReplay `[goreplay]` | 2026 | repo | Passive capture and replay of HTTP traffic | D |
| 24 | Diffy `[diffy]` | 2019 | repo | Differential proxy: candidate vs primary/secondary noise | D/E |
| 25 | Meticulous `[meticulous]` | 2026 | docs | Session recordings → visual E2E tests, self-maintaining | D |
| 26 | Postman Insights `[postman-insights]` | 2026 | docs | Traffic observability; Repro Mode recreates failing calls | D/E |
| 27 | Beeceptor drift `[beeceptor-drift]` | 2026 | docs | Traffic vs OpenAPI → drift events → AI **spec** patch after approval | E |
| 28 | Visa TDCommons #10178 `[visa-tdcommons-2026]` | 2026 | defensive pub. | Learned behavioral invariants from traffic → silent-drift alerts | E |
| 29 | Outcome Monitors `[outcome-monitors]` (C11) | 2026 | paper | Mined contracts + receipts; never repairs | E |
| 30 | ALTK Silent Review `[altk-silent-review]` | 2025 | repo | LLM judge flags silent tool errors; no repair | E |
| 31 | Optic `[optic-repo]` | 2026 | repo | Spec diff + traffic-verified spec; archived Jan 2026 | E |
| 32 | Byam `[reyes2025byam]` | 2025 | paper | LLM fixes client code after a breaking dependency update (build failure); 27% of builds | F |
| 33 | BUMP `[reyes2024bump]` | 2024 | paper | 571 reproducible breaking dependency updates | F |
| 34 | Dependabot `[dependabot-version-updates]` | 2026 | docs | Version-bump PRs; compatibility left to the user's tests | F |
| 35 | Airbyte AI Assist `[airbyte-ai-assist]` | 2026 | docs | Build-time connector help; no runtime repair | C (negative) |
| 36 | mcp-eval `[mcp-eval]` | 2026 | repo | Tests MCP servers with real agents; tests generated from tool definitions | D (pre-deploy) |

### Loop-step coverage of the closest 16

Columns:
- **Obs**: inline, per-call check of a *successful* result with a semantic oracle
- **Rcpt**: annotation given to the running agent
- **Cap**: trace with the raw upstream exchange
- **Test**: committed, deterministic reproduction test
- **F**: test must fail first, for the stated reason
- **Fix**: automated *source* repair
- **Gate**: suite + traces + CI green **before** the PR opens
- **PR**: PR, human merges
- **Conf**: post-merge confirmation

Cell values: Y = documented; P = partial or different form; N = not done or not described; `?` = not stated.

| System | Obs | Rcpt | Cap | Test | F | Fix | Gate | PR | Conf |
|---|---|---|---|---|---|---|---|---|---|
| **fiks** | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Itzal (2016) | P (exception/HTTP oracle; domain oracles allowed but not evaluated) | N | P (failing request replayed in shadow) | N (shadow-traffic replay, no committed test) | P (patch must pass the request oracle) | Y (template patch models) | P (regression on shadow traffic) | P (dashboard; PRs "imagined") | N |
| ClearView (2009) | P (learned invariants; failure monitors) | N | N | N | N | P (binary runtime patch) | P (in-field evaluation) | N | P |
| SapFix (2018) | N (crashes from pre-release testing) | N | P | Y (Sapienz tests) | P | Y | P | Y (review) | N |
| LangSmith Engine | P (scheduled, LLM/evaluator/feedback signals) | N | P (traces) | N (dataset examples, not test code) | P (replay "confirm it reproduces", beta) | Y | ? | Y (draft, never merge) | P (reopens recurring issues) |
| Arize Signal | P (scheduled LLM scan) | N | P | N | N | Y | ? | Y (Enterprise) | P (observe again) |
| PostHog Self-driving | P (errors/replay/tickets) | N | P | Y | ? (not stated) | Y | N (CI after PR) | Y | ? |
| Sentry Seer | N (errors only) | N | P (stack, traces, logs) | P (on request) | N | Y | N (CI after PR) | Y | N |
| Datadog Bits Code | N (errors/APM) | N | P | N | N | Y | N (CI after PR) | Y (never auto-merges) | N |
| Composio gateway | P (call patterns; example is a 400) | N | ? (payloads not stored) | N | N | P (toolkit patch, vendor-side) | ? | N (auto-published) | P ("next call" succeeds) |
| ADAPTIX | N (errors + schema diff; shape only) | N | P | N | N | P (tool-definition version) | P (verify, rollback) | N (autonomous) | P |
| self-healing-api-agent | N (spec diff) | N | N | N | N | Y | N | Y | N |
| Tusk Drift | N (triggers on own code changes) | N | Y (inbound and outbound) | Y (replayed traces) | N | P (suggests fixes) | P (runs on PRs) | N | N |
| Keploy | N | N | Y | Y (recorded-response oracle) | N | N | N | N | N |
| Outcome Monitors (C11) | Y | Y | N | N | N | N | N | N | N |
| Visa TDCommons | Y (learned invariants, alerts) | N | P (fingerprints) | N | N | N | N | N | N |

Evidence for each cell is in the matching source's `quote`, `location` and `central_claim`. Cells marked `?` must not be presented as "N" in the paper.

## 3. Clusters

- **A. Production-driven repair (2007–2018).** Exterminator, ClearView and Itzal show that three ideas are old:
  - runtime oracle → patch;
  - learned invariants → patch;
  - production failure → source patch validated on production traffic → developer.

  Itzal even states the vision of patches arriving as PRs in the developer's GitHub dashboard. Itzal's own taxonomy separates *runtime repair* (ClearView, failure-oblivious: modify the execution) from *patch generation* (modify source). fiks is the second kind.
- **B. Observability → PR products (2025–26).** LangSmith Engine, Arize Signal, PostHog Self-driving, Sentry Seer, Datadog Bits and incident.io all end in a human-merged PR, and several iterate on CI. Their triggers are errors, incidents, evaluator scores or user feedback, or scheduled LLM scans of traces. Their repair target is the team's own app or agent. Only PostHog documents a reproduction test inside the PR.
- **C. "Self-healing" for tools and integrations (2026).** Composio, ADAPTIX, MCP-Healer, self-healing-api-agent and n8n all trigger on errors or spec diffs. The first three repair at runtime: a toolkit patch, a tool-definition version, or input coercion. None produces a test. ADAPTIX states that its verification proves shape, not business meaning.
- **D. Traffic → tests (Keploy, Tusk Drift, Speedscale, GoReplay, Diffy, Meticulous).**
  - Mature capture and replay. The oracle is the recorded or old response, or a differential comparison.
  - Dependencies are served from recordings, so the tests guard the team's own code changes, not upstream drift.
  - Tusk adds AI root cause and fix suggestions.
- **E. Drift detection only (Visa TDCommons, Beeceptor, Optic, Outcome Monitors, ALTK).** This cluster detects silent or behavioral drift, sometimes from learned traffic invariants. The outputs are alerts, receipts, or spec patches; Beeceptor's patches make the *spec* match reality. None repairs code.
- **F. Upstream change → client fix, loud trigger (Byam/BUMP, Dependabot, ApiPatch).** The trigger is a compile or build failure, a new version, or known deprecations.
- **G. Detector-as-oracle and CI bots (Repairnator, Copilot Autofix, Meta agent, SapFix).** These start from an existing failing test, a failing build or a static alert. The repair half of fiks is industrial practice.

## 4. Contradictions and why they disagree

1. **What "self-healing" means.** Composio, ADAPTIX and MCP-Healer use it for runtime mutation with no human in the loop: patch the toolkit, version the tool definition, or coerce the payload. Engine, Seer and Bits use "fix" for human-merged source PRs. Itzal draws the same line in 2016, contrasting runtime repair ("modifying the execution") with patch generation.
   - *Why they disagree:* vendors who own the tool layer (Composio) can hot-patch. Vendors who sit outside it (observability) can only propose code.
   - *For fiks:* fiks is in the second camp, plus a runtime receipt. The paper should define its terms the way Itzal does.
2. **Validation on production traffic vs. a committed test.** Itzal argues that user traffic "reduces the risk of overfitting" compared with test suites. It discards patches with an execution-comparison oracle on shadow traffic. fiks (and the C17/C20 lineage) uses a committed F→P test plus the full suite and stored traces.
   - *Why they disagree:* Itzal assumes the operator can run a shadow copy on live traffic and read-only production state, and its paper notes this cannot repair state-modifying code. fiks targets a tool owner who receives a PR and may have no shadow environment. A committed test is durable and reviewable.
   - *Not refuted:* the overfitting concern. fiks's stored-trace replay is a small version of Itzal's idea, and the paper should say so.
3. **Recorded-response oracle vs. property oracle.** Keploy, Tusk and Speedscale treat the recorded response as truth, and Tusk classifies deviations as intended or unintended. fiks treats the contract property as truth.
   - *Why they disagree:* they guard against regressions in *your* code with dependencies held fixed. fiks guards against changes in *the dependency* with your code fixed. A Keploy or Tusk recording made on v1 replays v1 upstream responses (inference, to be tested as H-N2).
4. **Composio: learns from production calls vs. stores no payloads.** The same page says both. The sibling mcp-market area explains this as error-metadata-only learning, which would make it blind to silent wrong values. Inference, not verifiable.
5. **Is a reproduction test necessary at all?**
   - Engine validates by replaying traces and by dataset examples.
   - PostHog adds a reproduction test.
   - Seer adds one only when asked.
   - SWE-Doctor (C20) and the TDFlow line (C17) disagree on how much F→P tests help repair.

   *Why:* there is no shared benchmark measuring the effect of the repro artifact on correctness of fixes for runtime-observed faults. This is the open question H-N3 targets.
6. **Corrections to existing claims.**
   - n8n PR #40979 (C27) was **closed without merging** on 2026-10-15.
   - ApiPatch is now v0.9.0 (2026-09-08), and the 0.8.2 page cited in C27 did not render.
   - C28's "we have not found a product…" wording must now name Engine, PostHog, Composio and Itzal as the nearest prior work (see §6).

## 5. Claim ledgers for deep-read sources

**Itzal: Production-Driven Patch Generation and Validation (arXiv 1609.06848v2; full PDF read)**
- L1 (Abstract): the vision is that developers receive "each morning in her GitHub dashboard a list of potential patches that fix certain production failures."
- L2 (Sec. 1): "it uses production oracles (such as uncaught exceptions) to detect failures and trigger patch search." Patches are validated on "shadow traffic."
- L3 (Sec. 3.1.1): the request-oracle can be generic (no exception, non-5xx) "and it can also work with domain-specific oracles written by software engineers". Its example is a schema check. The evaluation uses NPE and uncaught-exception patch models only.
- L4 (Sec. 2.1): it notes that converting production failures into failing test cases is very hard, and so avoids test cases altogether.
- L5 (Sec. 3.1.3): the shadow application has read-only DB access, which "prevents repair of code related to state modification."
- L6 (Sec. 3.2.5): patches go to a dashboard. PRs are "imagine[d]".
- L7 (Answer RQ2): on 80 patches, HTTP-status, content, method-coverage and block-coverage oracles discard 16, 52, 39 and 42 patches respectively.
- L8 (RQ4): a patch that silently skipped an action passed validation where the human fix raised a clear warning. The cause is the lack of domain knowledge in the oracle.
- *For fiks:* this is the closest research prior art. Every element of fiks's core thesis (C19) is a direct answer to L4, L5 and L8:
  - the runtime violation **is** the failing test;
  - recorded upstream fixtures make write paths testable (D3);
  - domain contracts supply the missing domain knowledge.

**Outcome Monitors (arXiv 2608.19303; HTML full text read to char 100k)** (C11)
- L1 (Sec. 1): the monitor appends nonbinding receipts and "never restricts an action, executes a repair, reveals a benchmark fault label, or consults the evaluator."
- L2 (Sec. 3, Alg. 2): ToolMaze contracts are mined from clean traces with five-fold cross-fitting. AppWorld contracts come from response schemas, and τ-bench retail contracts from the public DB.
- L3 (Sec. 5): completion rises from 10.9% to 28.1%. Incident-derived faults are detected 46.1% / 45.3% of the time. Recall is 83% on structured-value violations vs 22% on corruption inside plausible strings.
- L4: the false-positive rate is 1.39% per observed tool outcome (Appendix E), and the monitor fires on 0.80% of 53,078 organic public-API responses.
- L5 (Sec. 6): "Recovery from organic failures remains open." No live deployment was used.
- *For fiks:* the Observe and receipt steps are close prior art. Repair is the paper's explicit non-goal. L3's string-corruption recall is a ceiling warning for contract-based detection generally.

**LangSmith Engine docs (re-fetched)**
- L1: Engine scans "on a dynamic schedule" and treats feedback as "a high-priority signal."
- L2: it "Diagnoses the root cause against your traces and connected source code"; fixes target prompts or code.
- L3: it can "Replay an issue's traces to confirm it reproduces and that Engine's fix resolves it" (beta, Cloud), and creates dataset examples.
- L4: it opens draft PRs and never merges. Supported frameworks are Deep Agents, LangChain and LangGraph.
- L5: the docs say nothing about generated test code.
- *For fiks:* this is the most complete commercial loop. Reproduction there is trace replay, not a committed F-gated test. The repair target is the agent app, not a third-party tool server.

**Composio MCP Gateway (re-fetched)**
- L1: "learn from real production calls"; the example is GMAIL_SEND_EMAIL with a 400 seen in "12% of calls."
- L2: "v2.1.4 published to every agent". No tests, review or staged rollout are described.
- L3: "Tool-call payloads are never stored."
- *For fiks:* this is the strongest market claim of "fix once for every agent," and it is error-triggered. Its internals are unverifiable, so the paper should cite it as a claim, not as a measured system.

**PostHog anatomy of a PR (re-fetched)**
- L1: the PR includes "a regression test that reproduces the original failure."
- L2: the agent "babysits CI until the checks are green," after opening the PR.
- L3: "Nothing ships without you." PRs are billed at $15, with a refund if not useful.
- *For fiks:* this is prior art for "repro test in PR." The differentiators left are the fail-first gate, green CI before opening, and the silent-violation trigger.

**Tusk Drift (fetched)**
- L1: it "Captures traces from live traffic automatically," inbound and outbound (HTTP, gRPC, DB, Redis).
- L2: replay serves outbound requests "from recorded data."
- L3: on PRs it "classifies if the deviation is intended or unintended," does root-cause analysis and suggests code fixes.
- *For fiks:* this is the closest traffic-to-test competitor. It assumes the dependency is fixed and the service code changed, which is the opposite of fiks's setting.

## 6. What this means for fiks

**Not new (say so in the paper):**
- An MCP or API proxy with post-call hooks (sibling mcp-market: Docker, ContextForge and others).
- Runtime contract and invariant checking, including invariants learned from traffic (ClearView, Visa TDCommons, Outcome Monitors, AGORA in the sibling spec-inference area).
- Receipts to the agent (Outcome Monitors).
- Traffic record and replay as tests (Keploy, Tusk, Speedscale).
- Production failure → source patch → developer, including the GitHub-PR vision (Itzal 2016).
- Observability → root cause → PR with a never-merge policy (Engine, Signal, PostHog, Seer, Bits).
- A repro test inside the PR (PostHog).
- Fixing once for all users (Exterminator 2007; Composio claim).
- Repair agents (SWE-agent line).

**Plausibly new, as a combination, with the caveat in §1 that patents and unknown startups were not searched:**
1. **Trigger.** A semantic contract violation on a *successful* tool result (no error, status 200, schema-valid), checked inline per call. The cause is upstream *behavioral* drift with an unchanged spec. Every repair system in §2 triggers on errors, incidents, scheduled LLM scans, spec diffs or failing tests. Itzal permits domain oracles but evaluated only exceptions.
2. **Artifact.** A deterministic committed test built from the recorded *drifted* upstream HTTP exchange. It asserts the violated property and must fail first, for the stated reason. Traffic-to-test tools record the *old* behavior as truth. PostHog's test has no stated F gate. Engine replays traces.
3. **Gate order.** Green CI on the exact commit, plus all stored traces, *before* the PR exists. Seer, Bits and PostHog open the PR and then fix CI.
4. **Target.** The *tool/MCP server's* own repository, fixed on behalf of every agent that calls it. Products in cluster B fix the team's own agent or app. Composio patches only its own toolkits and does it without review.
5. **Two-speed response.** A receipt for the current agent plus a durable code fix, with post-merge confirmation by replaying stored traces. No single system in §2 does both.

**Where fiks is weaker:**
- **Scale and maturity.** Products run on real production traffic. fiks has one server and five seeded drifts. Itzal used 34 real production failures.
- **Contracts.** fiks's contracts are hand-written per server. Engine and Signal use LLM discovery with no contracts. Visa and Outcome Monitors learn invariants.
- **Overfitting checks.** Itzal validates on far more diverse traffic than fiks's handful of stored traces.
- **Scope.** fiks has no security guardrails and no OTel or enterprise features.
- **Never-merge** is standard practice, so it is not a differentiator.

**Strongest counter-argument a reviewer would raise.**

> "This is Itzal (2016) with an LLM patcher, aimed at MCP. The 2026 products already go from traces to reviewed PRs, and PostHog already puts a reproduction test in the PR. The only new parts are a stricter trigger and a fail-first check. On five drifts seeded by the same authors who wrote the contracts, detection is true by construction."

Required answers:
- (a) cite Itzal and the cluster-B products explicitly, and claim only the combination;
- (b) show the trigger matters, by running error-triggered and spec-diff baselines on the same drifts (H-N1, H-N6);
- (c) show the F-gated repro matters, by ablating it (H-N3);
- (d) show the recorded-response oracle misses upstream drift (H-N2);
- (e) add drifts the contract authors did not write, plus real bugs from the sibling bug-mining areas.

**Rewording for C28** (proposed; a claims-auditor decision):

> "Prior work turns production failures into patches (Itzal, 2016), and 2026 observability products turn traces and errors into reviewed PRs (LangSmith Engine, PostHog, Sentry Seer). We have not found a system whose trigger is a semantic violation in a successful tool response and whose PR is gated on a fail-first reproduction test built from the recorded upstream exchange. Patent databases were not searched."

## 7. Candidate hypotheses (each with its falsifier)

- **H-N1 (trigger blindness of error-driven loops).** A Seer/Bits/Composio-style trigger (`isError`, exception, HTTP ≥ 400 seen by the server or agent) fires on at most 1 of D1–D5 across all bench trials. fiks fires on all 5. *Falsified if* the error trigger fires on ≥ 3 drifts within the bench tasks.
- **H-N2 (recorded-response oracles miss upstream drift).** Keploy tests recorded on v1, replayed with recorded mocks after the vendor moves to v2, pass for all drifts: the drift is invisible. If re-recorded against v2, they flag diffs but cannot say which side is correct, and they also flag benign v1↔v1 noise. *Falsified if* mocked Keploy replay fails on ≥ 3 drifts, or live-mode Keploy separates drift from noise as well as fiks contracts at equal false-positive rate.
- **H-N3 (the F-gated repro improves repair).** Hold the repair agent and model fixed. Arms:
  - (i) fiks: F-gated repro + suite + traces;
  - (ii) Engine-like: trace + diagnosis text, no test;
  - (iii) PostHog-like: the agent writes its own repro, with no F gate and CI after the PR.

  Arm (i) yields more patches that pass a held-out contract suite and the stored v2 traces, and fewer partial patches (C20). *Falsified if* (ii) or (iii) is within the CI of (i) on held-out correctness.
- **H-N4 (gate order).** CI-before-PR yields 0 PRs ever showing a red check. CI-after-PR (Seer/Bits/PostHog style) shows red checks on ≥ 1 PR, costing merge odds per C21. *Falsified if* CI-after-PR arms also never show red. This is mostly a design property, so report it as descriptive and not as a headline.
- **H-N5 (spec-diff blindness).** oasdiff, self-healing-api-agent and ApiPatch produce 0 detections or changes on the byte-identical v1/v2 spec. *Falsified if* any of them proposes a change that fixes a drift.
- **H-N6 (recurrence).** With detection only (receipts, as in Outcome Monitors or ALTK), the violation rate per session stays flat across N future sessions. After a merged fiks PR it drops to 0. *Falsified if* it declines without a code change.
- **H-N7 (Itzal-style traffic validation vs. committed test).** Validating candidate patches only by replaying stored traces (Itzal-like, no committed test) accepts more overfitting patches than fiks's full gate. *Falsified if* acceptance of patches that fail held-out contracts is equal.

## 8. Baselines we can actually run

| Baseline | Licence | How |
|---|---|---|
| Keploy `[keploy]` | Apache-2.0 | Record shop-mcp ↔ vendor-api on v1. Replay on v2 in mock mode and in live mode. Count drifts detected and v1↔v1 noise (H-N2). |
| Diffy `[diffy]` | CC BY-NC-ND 4.0: non-commercial, unmodified use only (check before relying on it) | v1 vendor as primary/secondary, v2 as candidate. Gives a differential drift-detection rate, with no repair. |
| GoReplay `[goreplay]` | OSS core [verify licence] | Capture source for the Keploy and Diffy runs only. |
| oasdiff (C27), Optic `[optic-repo]` | Apache-2.0 / MIT (archived) | Run on the v1/v2 specs; expect 0 (H-N5). |
| self-healing-api-agent `[self-healing-api-agent]` | [verify licence] | Run against shop-mcp with the v1/v2 specs; expect no PR (H-N5). Use forks under vats98754 only. |
| ApiPatch `[apipatch]` | MIT | `apipatch pr --dry-run` on shop-mcp; expect no relevant change. |
| ALTK Silent Review `[altk-silent-review]` | Apache-2.0 | LLM-judge detection baseline per call (H-M3 in mcp-market). |
| Outcome-Monitor-style detection only `[outcome-monitors]` | reimplemented (fiks receipts with repair off) | H-N6 recurrence. |
| Error-triggered repair (Seer/Bits/Composio proxy) | reimplemented trigger in fiks | Start the repair agent only on `isError`, exception or HTTP ≥ 400 (H-N1). |
| Engine-like and PostHog-like repair arms | reimplemented as ablations of fiks's repair step | H-N3 and H-N4. Same model, budget and worktree. |
| Itzal-like validation | reimplemented: accept a patch on stored-trace replay only | H-N7. The original Itzal is Java with NPE patch models, so it does not apply to TypeScript MCP servers. |

Not runnable on equal terms: LangSmith Engine, Arize Signal, PostHog, Sentry Seer, Datadog Bits, Composio, Tusk Cloud, Speedscale (all SaaS or proprietary, need production data upload or enterprise plans). Describe these, do not benchmark them.

## 9. Open gaps

1. **No keyword searches in this pass** (budget exhausted). These need a follow-up:
   - patents: Google Patents, USPTO and EPO, for "automatically generating a test from a production failure and generating a patch" and "API response drift repair";
   - more TDCommons defensive publications;
   - 2026 arXiv papers on "self-healing tools/agents" and "API drift repair";
   - YC W25–F26 startups (e.g., integration-maintenance companies);
   - Fivetran, Zapier and Workato AI maintenance features;
   - Speakeasy and Stainless SDK regeneration.
2. **Unverified items.** Tusk Drift SDK licence and the exact oracle (the docs only imply the recorded response). GoReplay core licence. Exterminator venue (PLDI 2007, from the PDF filename and memory). The Itzal NIER track year: its reference list says the "37th ICSE," which conflicts with a 2017 date. The self-healing-api-agent licence. The mcp-eval licence (its README is inconsistent).
3. **Composio internals** are not verifiable from public pages.
4. **No measured comparison exists in the literature** between a committed F-gated repro and trace replay or shadow-traffic validation for runtime-observed faults. fiks would be first to measure it (H-N3, H-N7) only if we run it.
5. **The Outcome Monitors HTML** was read to 100k of 108k characters; the last appendix pages were not read.
