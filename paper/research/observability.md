# Observability, evaluation platforms, and error tracking with AI fixes

Area owner: research swarm, observability. Compiled 2026-10-21. Sources: `observability.sources.json` (keys in brackets below). Claim IDs C1-C29 refer to `~/fiks/RESEARCH.md`.

## 1. Scope and searches

**Question.** What do agent/LLM observability platforms and AI error-tracking products do today, measured against the fiks loop: (a) detect silently wrong tool data, (b) turn traces into tests or datasets, (c) open fix PRs, (d) gate fixes on a failing repro and green CI? Also: license and whether we can run each locally as a baseline.

**Searches run (all 2026-10-21, WebSearch standard unless noted; then WebFetch on the primary page):**
1. LangSmith automation rules, add to dataset, online evaluators
2. Langfuse datasets from production traces, LLM-as-judge, MIT, self-host
3. Arize Phoenix license, datasets from spans
4. Sentry Seer Autofix, root cause, PR
5. Datadog Bits AI Dev Agent, code fixes, PRs
6. Braintrust logs to dataset, online scoring
7. Datadog LLM Observability agent evaluations (tool selection, tool argument correctness)
8. W&B Weave guardrails, monitors, scorers
9. Galileo tool error metric, action completion
10. TRAIL (Patronus) on arXiv
11. Surveys and taxonomies of AgentOps observability (arXiv)
12. GitHub Copilot Autofix: how it works, validation, limits
13. Raindrop "Sentry for AI", silent failures
14. OpenTelemetry semantic conventions for MCP / GenAI tool spans
15. Sentry MCP server monitoring
16. Patronus Percival trace debugger
17. Helicone / AgentOps licenses (then GitHub API for 11 repos)
18. LangSmith Insights / Polly
19. Production agent traces to regression tests, 2026 arXiv (extended)
20. SapFix end-to-end repair (Facebook)
21. Self-healing agent observability that opens PRs from traces, 2026 (extended). This search surfaced Arize Signal, PostHog Self-driving and LangSmith Engine.
22. Arize AX Signal (extended)
23. PostHog self-driving mode
24. Factory Droid with Sentry (dropped: no primary doc describing a repro step)
25. LangSmith Engine public beta (extended), then a full download of the LangSmith changelog (`docs.langchain.com/langsmith/changelog.md`) and a grep for Engine entries
26. LangChain State of Agent Engineering
27. Opik online evaluation rules
28. Datadog MCP client monitoring
29. Braintrust datasets from production logs
30. Phoenix datasets from spans
31. Google AI-powered patching (sanitizer bugs)
32. AIOpsLab

**Deep reads (full text or full doc page):** TRAIL [deshpande2025trail]; AgentOps survey [wang2025agentopssurvey]; LangSmith Engine docs and changelog [langsmith-engine-docs, langsmith-changelog-2026]; Sentry Seer docs, changelog and cookbook [sentry-seer-*]; PostHog Self-driving [posthog-*]; Arize Signal docs, blog and Alyx case [arize-*].

**Could not open:** Patronus Percival docs (HTTP 401); SapFix PDF (403; used Meta's engineering post instead); OpenTelemetry MCP semconv page (moved to `open-telemetry/semantic-conventions-genai`, not re-read, so not cited).

## 2. Headline finding (read first)

**C28 needs rewording.** As of September 2026, **LangSmith Engine** reads "the contents of successful tool results rather than only their status", and files issues where "a call returned less data than its own result claims or where a value arrived truncated". The entry ends: "Defects that never surface as an error are no longer passed over." (LangSmith changelog, week of Sep 14-21 2026 [langsmith-changelog-2026]). Engine also clusters issues, diagnoses them against the connected repo, and opens fix PRs. It watches CI on those PRs, pushing up to 3 revisions in 90 min (Oct 5-12), and replays source runs against a fix preview deployment to validate (Oct 5-12). Since Oct 12-19 it opens PRs ready for review, and it never merges [langsmith-engine-docs]. **Arize Signal** (GA July 2026) and **PostHog Self-driving** run the same broad loop from production signals to PRs. PostHog's PRs include "a regression test that reproduces the original failure" [posthog-anatomy-pr].

So we can no longer claim that no product turns silent runtime failures into fix PRs. What still holds, from the public docs we read:
- No product we found makes a **fail-first deterministic reproduction** (F gate) a precondition for a PR.
- None opens PRs **only after CI is green**. Engine, Seer, Bits and PostHog open first and iterate on CI afterwards.
- None checks every tool call **inline against a declared outcome contract** and returns a **receipt to the running agent**. Engine and Signal scan on a schedule (Signal's default is every 6 h).
- None targets the **tool/MCP server** as the repair site. Engine proposes changes for Deep Agents, LangChain and LangGraph agent code.
- None of the loop-closing products is open source or runnable locally.

These are the differences the paper must test, not assert.

## 3. Source catalog

| # | Source [key] | Year | Type | Central claim | Cluster |
|---|---|---|---|---|---|
| 1 | LangSmith Engine docs [langsmith-engine-docs] | 2026 | tool-docs | Scheduled scan → issues → root cause → PR; replay validation; never merges | A loop-closers |
| 2 | LangSmith changelog, Engine [langsmith-changelog-2026] | 2026 | tool-docs | Reads successful tool result contents (silent defects); CI watch ≤3 revisions; replay vs fix preview | A |
| 3 | LangSmith Engine product [langsmith-engine-product] | 2026 | tool-docs | Per-issue online evaluator + failing traces to dataset; public beta | A |
| 4 | Arize Signal docs [arize-signal-docs] | 2026 | tool-docs | Scheduled trace scans → issues with proposed fix; PRs Enterprise-only | A |
| 5 | Arize "From Signal to PR" [arize-signal-to-pr] | 2026 | blog | Investigate → propose → review → ship loop; humans ship | A |
| 6 | Arize Alyx case [arize-alyx-case] | 2026 | blog | Tool called 43× with root span OK; fix plus hand-written replay regression test | A / real bug |
| 7 | Arize vs LangSmith Engine vs Braintrust Topics [arize-compare-2026] | 2026 | blog (vendor) | Topics clusters only, no PRs; Engine drafts PRs | A |
| 8 | PostHog Self-driving [posthog-self-driving] | 2026 | tool-docs | Errors/replays/tickets → reports → PR for review | A |
| 9 | PostHog anatomy of a PR [posthog-anatomy-pr] | 2026 | tool-docs | PR includes regression test reproducing the failure; CI babysat to green | A |
| 10 | Sentry Seer Issue Fix [sentry-seer-issue-fix] | 2026 | tool-docs | Errors/traces/logs → root cause → fix → optional PR; ≥10 events gate | B error-driven autofix |
| 11 | Seer PR iteration [sentry-seer-pr-iteration] | 2026 | tool-docs | Seer pushes CI fixes to its PRs, capped attempts | B |
| 12 | Seer cookbook [sentry-seer-cookbook] | 2026 | tool-docs | Stopping points; same review/test as human PR; never merges | B |
| 13 | Seer GA [sentry-seer-ga] | 2025 | blog | 38k+ issues fixed; 94.5% root-cause accuracy (vendor) | B |
| 14 | Sentry MCP monitoring [sentry-mcp-monitoring] | 2026 | tool-docs | MCP connections, tool executions, errors | C detection |
| 15 | Datadog Bits Dev Agent docs [datadog-bits-dev-agent-docs] | 2026 | tool-docs | Error Tracking → fix → PR; CI iteration; never auto-merges | B |
| 16 | Datadog Bits blog [datadog-bits-blog] | 2026 | blog | Drafts fix and unit tests; iterates until build passes | B |
| 17 | Copilot Autofix docs [github-copilot-autofix-docs] | 2026 | tool-docs | Alert → fix; validated by re-running CodeQL; draft PR | B (detector-as-oracle) |
| 18 | Copilot Autofix 3× [github-autofix-3x] | 2024 | blog | Median 28 min vs 1.5 h to fix (beta data) | B |
| 19 | LangSmith rules [langsmith-rules] | 2026 | tool-docs | Filtered traces → dataset, online/code evaluators, alerts | D trace→dataset |
| 20 | Langfuse datasets [langfuse-datasets] | 2026 | tool-docs | Dataset items from production traces; human gives expected output | D |
| 21 | Langfuse LICENSE [langfuse-license] | 2026 | repo | MIT except ee/ | D |
| 22 | Langfuse clarifications [langfuse-clarifications] | 2026 | blog | Core MIT; self-host every tier; LLM-judge free | D |
| 23 | Phoenix LICENSE [phoenix-license] | 2026 | repo | ELv2; no hosted-service use | D |
| 24 | Phoenix datasets from traces [phoenix-datasets-from-traces] | 2026 | tool-docs | Programmatic dataset from traces | D |
| 25 | Braintrust online scoring [braintrust-online-scoring] | 2026 | tool-docs | Score production traces as logged | C |
| 26 | Braintrust datasets [braintrust-datasets] | 2026 | tool-docs | Datasets from production logs | D |
| 27 | W&B Weave guardrails [weave-guardrails] | 2026 | tool-docs | Inline guardrails vs passive monitors | C |
| 28 | Datadog agent evaluations [datadog-agent-evals] | 2026 | tool-docs | Tool selection and argument checks; no result-correctness check | C |
| 29 | Datadog MCP client [datadog-mcp-client] | 2026 | tool-docs | Tool span failed only on isError | C |
| 30 | Galileo Tool Error [galileo-tool-error] | 2026 | tool-docs | LLM judge for execution errors | C |
| 31 | Opik online rules [opik-online-rules] | 2026 | tool-docs | LLM-judge rules on production traces | C |
| 32 | Raindrop [raindrop-site] | 2026 | tool-docs (marketing) | "Silent failures" in production; auto-fix loops (mockups) | C |
| 33 | Helicone repo [helicone-repo] | 2026 | repo | Apache-2.0 proxy-style LLM observability | C |
| 34 | AgentOps SDK [agentops-sdk-repo] | 2026 | repo | MIT agent monitoring SDK | C |
| 35 | OpenLLMetry [openllmetry-repo] | 2026 | repo | Apache-2.0 OTel GenAI instrumentation | C / interop |
| 36 | TRAIL [deshpande2025trail] | 2025 | paper | Best joint accuracy 18% GAIA / 5% SWE-Bench on trace error localization | E research |
| 37 | AgentOps survey [wang2025agentopssurvey] | 2025 | paper | Monitor/detect/RCA/resolve; resolution least mature | E |
| 38 | AgentOps taxonomy [dong2024agentops] | 2024 | paper | What to trace across the agent lifecycle | E |
| 39 | Who&When [zhang2025whowhen] | 2025 | paper | Step-level failure attribution 14.2% | E |
| 40 | AgentSight [zheng2025agentsight] | 2025 | paper | eBPF boundary tracing, <3% overhead | E |
| 41 | AgentAssay [bhardwaj2026agentassay] | 2026 | paper | Statistical regression tests on agent traces | E |
| 42 | Self-healing pipelines [eshun2026selfhealingpipelines] | 2026 | paper | Prescriptive detect → PR architecture; no evaluation | E |
| 43 | SapFix [marginean2019sapfix] | 2019 | paper/blog | Crash → tests → patch → human review, deployed | F foundational |
| 44 | Google AI patching [keller2024aipatching] | 2024 | paper (TR) | 15% of sanitizer bugs fixed by Gemini | F |
| 45 | State of Agent Engineering [langchain2026stateagents] | 2026 | survey | 89% observability, 52.4% offline evals, 37.3% online evals | G market |
| 46 | AIOpsLab [chen2025aiopslab] | 2025 | paper | Fault injection + telemetry benchmark for ops agents | E / benchmark |
| 47 | Patronus Percival [patronus-percival] | 2025 | tool-docs | 20+ failure modes; prompt fixes [verify, page 401] | C |

## 4. Feature matrix (from official docs; "?" = docs do not say)

| Product | Detects silently wrong tool data? | Traces → tests/datasets | Opens fix PRs | Gate: failing repro before PR | Gate: green CI before PR | Inline signal to running agent | License / local |
|---|---|---|---|---|---|---|---|
| **fiks** | Yes: per-call outcome contract (schema + invariants + read-after-write) | Trace → deterministic F→P code test with recorded upstream HTTP | Yes, to the tool repo | **Yes (F gate)** | **Yes** | **Yes (receipt)** | Ours, local |
| LangSmith Engine | **Partly**: since Sep 2026 it reads successful tool result contents for truncation and less-than-claimed data; scheduled LLM scan, not a declared contract | Failing traces → dataset + generated online evaluator | Yes (GitHub; LangChain-family agent code) | No: replay validation against fix preview, LLM judgment ? | No: CI watched after PR opens (≤3 revisions) | No | Proprietary; self-host/BYOC enterprise |
| Arize Signal (AX) | Behavioral patterns from scheduled scans (e.g. 43-call loop with OK span) | Proposed fix may be an eval change; tests ? | Yes (Enterprise) | ? (not documented) | ? | No | Proprietary |
| PostHog Self-driving | No (errors, rage clicks, tickets) | Regression test reproducing failure in PR | Yes | Not stated as fail-first | No: CI after opening | No | Proprietary feature (PostHog core OSS; not checked) |
| Sentry Seer | No: starts from Sentry issues (errors); ≥10 events | Unit tests only on request | Yes (optional) | No | No: iterates CI after | No | Proprietary; cloud GitHub/GitLab only |
| Datadog Bits Dev Agent | No: Error Tracking, APM, flaky tests | Unit tests with fix | Yes (optional draft) | Not stated | No: iterates until build passes | No | Proprietary |
| GitHub Copilot Autofix | n/a (static alerts) | No | Draft PR (agentic) | Detector re-run (CodeQL) as oracle | ? | n/a | Proprietary |
| LangSmith (rules) | Only if the user writes a code/LLM evaluator | Rule → add to dataset | No (Engine does) | No | No | No | Proprietary |
| Langfuse | Only via user LLM-judge/custom scores | Dataset items from traces (human expected output) | No | No | No | No | **MIT core, self-host** |
| Arize Phoenix | Via evals on spans (LLM judges) | Datasets from spans/traces | No | No | No | No | **ELv2, local OK** |
| Braintrust | Online scorers | Datasets from logs; pipelines | No (Topics clusters only, per competitor) | No | No | No | Proprietary |
| W&B Weave | Scorers (safety/quality); guardrails inline | Datasets/evals | No | No | No | Guardrail can block/modify | **Apache-2.0 SDK** |
| Datadog LLM Obs | No: evals cover tool selection/arguments; MCP span errors only on isError | Datasets from traces (blog) | via Bits | No | No | No | Proprietary |
| Galileo | LLM judge for execution errors | Datasets | No | No | No | Guardrail metrics | Proprietary |
| Opik | LLM-judge rules | Datasets | No | No | No | No | **Apache-2.0** |
| Helicone | No (LLM-call proxy) | Datasets | No | No | No | No | **Apache-2.0** |
| AgentOps | No (monitoring SDK) | ? | No | No | No | No | **MIT SDK** |
| Raindrop | Claims "silent failures" (behavioral signals) | Workshop: agent evals (MIT) | Mockups only | ? | ? | No | Proprietary + MIT workshop |
| Patronus Percival | Trace failure modes (TRAIL taxonomy) [verify] | ? | No (prompt fixes) | No | No | No | Proprietary [verify] |

## 5. Clusters

- **A. Loop-closers on agent traces (2026).** LangSmith Engine, Arize Signal, PostHog Self-driving. All three go from scheduled or aggregated scans to issues to PRs, with a human merge. They are LLM-driven discovery with no declared contract, and they fix the agent app or the product code. Engine is the most complete and the closest to fiks. All are new: Engine launched May 2026, Signal went GA July 2026, and PostHog is in open beta.
- **B. Error-driven autofix.** Sentry Seer, Datadog Bits, GitHub Copilot Autofix, Factory (dropped: no primary doc on a repro step). Each starts from an exception, alert or failed check. Several write tests (Bits) or re-run the detector (Copilot). All iterate CI after opening the PR, and none merges. This cluster sees nothing when nothing throws [C27].
- **C. Detection/evaluation on traces.** Braintrust, Weave, Datadog evaluations, Galileo, Opik, Raindrop, Percival, Sentry/Datadog MCP monitoring. Detection is by LLM judges or status flags. The documented tool checks cover execution errors, tool choice and arguments, not whether a successful result is true.
- **D. Trace → dataset.** LangSmith rules, Langfuse, Phoenix, Braintrust. The dataset item needs a human-supplied expected output; nothing emits a code-level failing test of the tool.
- **E. Research.** AgentOps taxonomies and surveys, trace error localization benchmarks (TRAIL, Who&When), boundary tracing (AgentSight), statistical agent regression tests (AgentAssay), and prescriptive self-healing designs (Eshun et al.).
- **F. Foundational industrial APR from production signals.** SapFix (crash → test → patch → human approval, 2018/19) and Google's sanitizer patching (15%). The fiks loop shape is old; its trigger and oracle are new.
- **G. Market.** 89% of surveyed orgs have agent observability, but only 52.4% run offline evals [langchain2026stateagents].

## 6. Contradictions and why they disagree

1. **Are agent fixes deterministic?** The AgentOps survey says resolution "demands continuous monitoring and refinement" and that every fix is "a provisional hypothesis" (Sec. 8.2, 9.4). SapFix, Copilot Autofix, PostHog and fiks treat a fix as a deterministic code change checked by a test or detector. *Why:* the survey's anomalies are mostly LLM-behavioral (prompts, reasoning, multi-agent emergence). A tool-server bug, such as a unit or field-mapping error, is ordinary deterministic code. The paper should claim determinism only for the tool layer.
2. **What "silent failure" means.** Raindrop and Arize say "silent failures", but their examples are loops, user frustration and retry storms (behavioral). Galileo Tool Error and Datadog isError flag only execution errors. LangSmith Engine (Sep 2026) is the first we found that targets "less data than claimed" and truncated values. *Why:* each vendor's signal source defines what "silent" means. None of the platforms checks values against a declared expectation such as units, ranges or read-after-write. This is the axis where fiks is distinct (C4, C8).
3. **Localization difficulty.** Seer reports 94.5% root-cause accuracy [sentry-seer-ga]. TRAIL's best model reaches 18%/5% joint accuracy, and Who&When reaches 14.2% at step level. *Why:* Seer starts from an anchored signal (a stack trace pointing at code), and its metric is vendor-defined. TRAIL and Who&When ask models to find the error in long unanchored traces. This supports C19: a contract violation is an anchor like a stack trace, for faults that have no stack trace.
4. **When CI runs.** Engine now opens PRs ready for review "so the CI and review workflows in your repository run on them", then fixes red CI (≤3 revisions). Seer and Bits also iterate after opening. fiks follows C21 (each failed CI check lowers merge odds about 15%) and opens only green PRs. *Why:* vendors use the customer's CI as their test harness, while fiks runs CI on a branch before the PR exists. This is an empirical question the paper can test (H5).
5. **The vendor's loop vs the vendor's practice.** Arize's Signal-to-PR post names no validation step, yet in its own Alyx case the engineers added a regression test that "replays the production payload". The practice adds the repro test by hand, and the product does not require it. fiks makes that step mandatory.

## 7. Claim ledgers (deep reads)

**TRAIL [deshpande2025trail]**
- L1: 148 traces, 1,987 OTel spans (575 with errors), 841 annotated errors; GAIA + SWE-Bench Lite (Sec. 1, 4). Appendix A.5 says 149 traces / 835 errors, an internal inconsistency to note.
- L2: Best joint accuracy is 0.183 on GAIA and 0.050 on SWE-Bench, both by Gemini 2.5 Pro (Table 1; Sec. 6). The abstract's "11%" is apparently a cross-split figure.
- L3: The API error category is HTTP failure codes (429/401/403/500/404) (Sec. 3.2). Silently wrong payloads appear only as the agent's "Tool Output Misinterpretation" (Sec. 3.1), not as a tool fault.
- L4: Traces use OpenInference/OTel "to ensure compatibility ... with real world tracing and observability software" (Sec. 4.1).
- L5: Performance falls with input length (Sec. 5.1.3).

**AgentOps survey [wang2025agentopssurvey]**
- L1: AgentOps has four phases: monitoring, anomaly detection, root cause analysis and resolution (Sec. 1, 4.2.1).
- L2: Table 5 compares 17 tools (Langfuse, Helicone, Phoenix, OpenLLMetry, Opik, AgentOps, ...) on metrics, logs and traces. None of them repairs anything.
- L3: Validation of a resolution is task-success uplift, judged by experts or an LLM judge (Sec. 8.1).
- L4: "Any fix should be treated as a provisional hypothesis requiring extensive validation" (Sec. 8.2).
- L5: Several anomaly classes have empty mitigation entries (Table 6). Resolution is described as the least mature stage (Sec. 9.4).

**LangSmith Engine [langsmith-engine-docs, langsmith-changelog-2026, langsmith-engine-product]**
- L1: Scheduled scans cluster and prioritize issues and diagnose them against traces and source (docs).
- L2: Reads successful tool result contents, catching less data than claimed and truncation (changelog, Sep 14-21 2026).
- L3: Validation replays source runs against the fix preview deployment, beta and Cloud only (changelog Oct 5-12; docs). Validation "requests its judgment as a tool call" (Sep 28-Oct 5), so it is model-judged.
- L4: Watches CI on its own PRs, up to 3 revisions or 90 min per chain (Oct 5-12). PRs open ready for review (Oct 12-19).
- L5: Proposes changes for Deep Agents, LangChain and LangGraph apps. Never merges. Billed in LSUs (docs).
- L6: Adds a per-issue online evaluator and puts failing traces into a dataset (product page).

**Sentry Seer [sentry-seer-issue-fix, sentry-seer-pr-iteration, sentry-seer-cookbook, sentry-seer-ga]**
- L1: Inputs are issue details, stack traces, traces, logs and profiles, plus code (docs).
- L2: Automatic runs need at least 10 events in 14 days plus a fixability score (docs, cookbook).
- L3: Tests are written only on request; there is no reproduction step in the documented flow (docs).
- L4: Iterates on failing CI with capped attempts (changelog, Sep 21 2026). Never merges (cookbook).
- L5: Vendor reports 94.5% root-cause accuracy and 38k+ issues fixed (GA, June 2025).

**PostHog Self-driving [posthog-self-driving, posthog-anatomy-pr]**
- L1: Signals are error tracking, session replay, logs, Zendesk, Linear and Sentry.
- L2: The PR includes "a regression test that reproduces the original failure". Fail-first is implied, not required.
- L3: The agent "babysits CI until the checks are green" after opening. A human merges.

**Arize Signal [arize-signal-docs, arize-signal-to-pr, arize-alyx-case]**
- L1: Scheduled (default 6 h). Issues include evidence and a proposed fix. PRs are Enterprise-only.
- L2: No documented test or CI gate.
- L3: Alyx: 34 issues in 30 days, and a tool was called 43× while the root span reported OK. The fix came with a hand-written payload-replay test.

## 8. What this means for fiks

**Where fiks differs (testable):**
1. *Oracle.* A declared outcome contract per tool, checked on every call. Engine and Signal discover issues by LLM clustering with no declared expectation, and they detect after the fact on a schedule.
2. *Receipt to the current agent.* The running agent gets the verdict in `_meta` and text. No platform returns a verdict to the agent mid-run; only guardrails (Weave, Galileo) block or modify output.
3. *Repair site.* fiks repairs the tool/MCP server. Engine repairs LangChain-family agent code; Seer and Bits repair whatever code threw.
4. *Gates.* A deterministic F→P repro built from recorded upstream HTTP, plus the full contract suite, all stored traces and typecheck/lint, with CI green before the PR. Competitors validate by replay with a model judge (Engine), by re-running the detector (Copilot), or by iterating CI after the PR is open (Engine, Seer, Bits, PostHog).
5. *Openness.* fiks runs locally and is model-agnostic in principle. None of the loop-closers is open source.

**Where fiks is weaker:**
- It needs contracts. Unknown-unknowns outside the contract vocabulary are missed, and C11 reports detection falling to 46% out of vocabulary. Engine, Signal and Raindrop find patterns nobody specified, such as loops, latency and user frustration.
- Its evidence is one server with seeded drifts. Competitors run on real production traffic at scale, though they publish no precision numbers.
- It covers only tool-layer faults. Reasoning, planning and prompt failures (TRAIL's other categories) are out of scope.
- The gates add latency: a CI run before the PR. That is minutes in our bench; production CI may take much longer.

**Strongest reviewer counter-argument:** "LangSmith Engine already reads successful tool results for silent defects, opens PRs, watches CI and replays runs against the fix. SapFix did detect → test → patch → human review in 2018. fiks recombines known parts." *Answer to prepare:* concede the loop shape is known (SapFix, Engine). The contribution is the oracle (contracts with receipts) and the hard gates. Each must be shown to matter by ablation against an Engine-style emulation on the same model: scheduled LLM detection, a trace-replay judge, PR before CI. Measures: detection recall/precision, wrong-answer rate during the detection window, patch correctness on held-out tests, and red-CI PRs exposed to maintainers. If the ablations show no difference, the paper's claim reduces to "an open-source implementation of an existing loop", and we should say so.

**RESEARCH.md updates to propose:** reword C28 to "we have not found a product that gates fix PRs on a fail-first reproduction derived from a contract violation; LangSmith Engine (Sep 2026) detects some silent tool-result defects and opens PRs" (cite langsmith-changelog-2026). Add C27 bullets for LangSmith Engine, Arize Signal and PostHog Self-driving.

## 9. Candidate hypotheses (with falsifiers)

- **H-O1 (oracle beats judge).** On D1-D5 plus new drifts, per-call contracts detect with higher recall and at least equal precision than an LLM-judge "tool error / result plausibility" monitor run on the same tool spans (Galileo- or Opik-style prompt, same model). *Falsified if* the judge's recall is ≥ the contracts' recall with a false-positive rate on v1 ≤ the contracts' rate (paired, 95% CI).
- **H-O2 (status-only is blind).** Status/exception-based monitors (isError flag as in Datadog MCP spans, or error-triggered issue creation as in Seer) flag ≤1 of the seeded silent drifts. *Falsified if* they flag most drifts, for example because D2's null price or D3's missing order makes something throw downstream.
- **H-O3 (inline vs scheduled).** Inline receipts reduce wrong final answers during the window between drift and detection compared with scheduled detection (scan every Δ = 6 h, emulated), measured over a stream of tasks. *Falsified if* the wrong-answer rate with inline receipts is not lower than the no-receipt rate in the pre-scan window. Note C7/C9 and README: earlier receipt wording made things worse.
- **H-O4 (F gate improves patch correctness).** Repairs gated on a fail-first deterministic repro plus all traces yield more patches correct on a hidden held-out test suite than repairs from issue text plus trace links validated by trace-replay judgment (Engine-style). *Falsified if* held-out correctness does not differ, or the ungated arm is better.
- **H-O5 (green-before-PR).** Opening PRs only after green CI exposes zero red-CI PRs at a bounded time cost. The open-then-iterate arm exposes ≥1 red CI run per k PRs. *Falsified if* open-then-iterate produces no red CI on these repos, which would make the gate moot. Report the time cost either way.
- **H-O6 (determinism of the repro).** fiks repro tests give identical verdicts across N=20 reruns, while dataset+LLM-judge regression evals of the same failures disagree in ≥x% of reruns. *Falsified if* the judge evals are equally stable.

## 10. Candidate baselines we can actually run

| Baseline | Emulates | How | License |
|---|---|---|---|
| Status-only monitor | Datadog MCP isError flag; Sentry exception capture | Proxy flags only `isError` or thrown exceptions; count drifts flagged | ours |
| Sentry SDK on shop-mcp | Seer's trigger condition | `@sentry/node` MCP wrapper pointed at a local mock DSN sink (no account); count events per drift | Sentry SDK MIT [verify]; no Seer (cloud-only, account needed: out of scope) |
| LLM-judge tool-result monitor | Galileo Tool Error / Opik / Phoenix evals | Same model judges each tool span (args + result) with the documented chain-of-thought style prompt; run inside Langfuse (MIT, docker compose) or Phoenix (ELv2, local) to also show platform realism | MIT / ELv2 |
| Trace → dataset + judge regression | Langfuse/Phoenix/Braintrust datasets | Promote violating traces to a Langfuse dataset; re-run experiments with an LLM judge as the regression check; compare stability with the fiks repro (H-O6) | MIT |
| Engine-style loop | LangSmith Engine / Arize Signal | Scheduled LLM scan clusters traces into issues → repair agent from issue text + trace links → validate by replaying traces with a judge → PR opened, then CI iterated (≤3 revisions) | ours (emulation; Engine itself needs an account: no sign-ups) |
| Error-driven autofix | Seer / Bits | Repair agent given only exceptions/logs (no contract, no repro); PR then CI iteration | ours |
| Detector-as-oracle without F gate | Copilot Autofix pattern | Repair until the contract check passes on replay, without requiring the test to fail first or the full trace suite | ours (ablation) |

Each emulation must be described as an emulation of documented behavior, not as the product.

## 11. Open gaps

- Engine's validation judge, the fix-preview mechanics and the issue-detection prompts are not public. We cannot measure Engine itself without an account.
- No vendor publishes precision/recall for silent-defect detection. Engine's "less data than claimed / truncated" scope is all we know.
- Whether PostHog's or Bits' tests are required to fail first is unstated in the docs.
- Patronus Percival docs could not be opened (401); claims are [verify].
- OpenTelemetry GenAI/MCP semantic conventions moved repos; we did not re-read whether `gen_ai.tool.call.result` is opt-in. This matters if fiks exports traces via OTel.
- SapFix paper PDF not opened (403); figures taken from Meta's blog only. Author list [verify].
- Licenses of Braintrust, Galileo, Raindrop core and the PostHog Self-driving feature are not verified.
- Helicone's maintenance status after its reported acquisition: secondary source only, not cited.
- Who&When venue (ICML 2025) [verify].
