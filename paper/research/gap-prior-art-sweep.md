# Gap G1: adversarial prior-art sweep (patents, 2025-26 arXiv, startups, alert-triggered coding agents)

Area: gap-prior-art-sweep. Written 2026-10-21. Sources: `gap-prior-art-sweep.sources.json` (36 entries). Keys in `[brackets]` refer to that file, or to earlier area files where noted. Claim IDs (C9, C11, C12, C19, C20, C27, C28) refer to RESEARCH.md.

## 1. Scope and searches run (2026-10-21)

**Question.** SYNTHESIS §9 (G1) asks whether any system, patent or startup already does this: trigger on a semantic violation in a *successful* tool result → reproduction test → gated PR. If one does, the combination claim fails.

**What actually ran, and its limits. Read this first.**
- **WebSearch: 4 queries attempted, 4 refused.** The shared per-turn budget (200 calls) was used up before this agent started. The refused queries covered:
  - Google Patents / USPTO for "production failure → generated test → patch → PR";
  - patents for "API response drift detection and repair";
  - TDCommons for drift, test and fix.

  I did **not** work around the limit through search engines, search-engine scrapers or reader proxies. So:
  - **(a) Patents (Google Patents, USPTO, EPO): not searched.** This remains open.
  - **(b) TDCommons: no new defensive publications searched.**
- **Visa TDCommons 10178, full text (task b): not read.**
  - The landing page loads, and its abstract is re-quoted in `[visa-tdcommons-2026]`.
  - The PDF (`viewcontent.cgi?article=11480`) returns HTTP 403 behind a Cloudflare bot challenge. Bypassing it would mean defeating bot detection, so I did not.
  - The abstract describes only detection and "drift alerts". Whether the body mentions tests or repair is still **[verify]** (a human with a browser can check in two minutes).
- **(c) arXiv: a listing sweep instead of keyword search.** These are listing pages, not a search engine.
  - I downloaded every monthly listing for **cs.SE (Jan 2025 – Oct 2026)** and **cs.AI and cs.MA (Jan – Oct 2026)**: 66,709 listing rows, 62,544 unique IDs.
  - I regex-filtered the titles for: self-heal\*, MCP, API drift/evolution/breaking change, silent failure, tool fault/fault injection, reproduction test, postcondition/contract, receipt, incident, repair.
  - Filtered against IDs already in our catalogs, this gave about 300 title hits. I read **40 abstracts** (arXiv API by ID).
  - **Full text read for 7 papers:**
    - AegisFlow (PDF);
    - CoHarden;
    - SkillGuard;
    - DepRepair;
    - MCPEvol-Bench;
    - the executable-contract benchmark audit;
    - Self-Healing Harness (partial).
  - **Recall limits:**
    - titles only, so a paper with a non-matching title is missed;
    - cs.LG, cs.CL, cs.DC and cs.NI were not swept;
    - before 2026, only cs.SE was swept;
    - OpenReview was not swept.
- **(d) Startups and integration platforms.** I read product docs via `llms.txt` indexes and direct pages for:
  - Composio, Arcade, Speakeasy, Stainless, Fern, Nango, Pipedream, Merge, Workato, Zapier, Airbyte, Fivetran (404);
  - LangSmith (changelog through Oct 19, 2026) and Cleric.

  Not done:
  - a YC batch scan (W25–F26). The YC directory is a search UI.
  - Paragon, Unified.to and other unified-API vendors were not checked.
- **(e) Alert-triggered coding agents.** I read docs for:
  - GitHub Copilot coding agent, Cursor (cloud agents and Automations), Devin (Oncall and Automations), OpenAI Codex (event-triggered tasks), Jules (getting started only);
  - Azure SRE Agent (overview and GitHub connector), Sentry coding-agent handoff, PagerDuty AI agents;
  - Dynatrace and incident.io `llms.txt` (nothing new), Rootly (read-only GitHub context).

**Consequence.** This pass greatly improves recall on 2025–26 arXiv (cs.SE, cs.AI, cs.MA) and on alert-triggered agents. It does **not** close the patent gap. Every "not found" below inherits these limits.

## 2. Source catalog

| # | Source `[key]` | Year | Type | Central claim | Cluster |
|---|---|---|---|---|---|
| 1 | AegisFlow `[awan2026aegisflow]` | 2026 | paper | Pipelines: Watchdog detects silent drift statistically, then diff of failed vs successful upstream responses, LLM patch, 9/10-snapshot invariant gate, auto-commit and blue-green deploy, then 100-run monitoring | A |
| 2 | Cleric, verifying fixes `[cleric-verifying-fixes]` | 2026 | blog | Verifier agent checks the defect is gone; recurring clusters vanished 64% with the fix applied vs 22% without | B |
| 3 | Cleric product `[cleric-product]` | 2026 | docs | Per-change production expectations, then fix PR, then recovery confirmed | B |
| 4 | LangSmith changelog, Oct 2026 `[langsmith-changelog-oct2026]` | 2026 | docs | Engine: PR-merge markers on recurrence charts; replays source runs against the fix preview; iterates CI after the PR | B |
| 5 | Devin Oncall `[devin-oncall]` | 2026 | docs | Alert, incident or bug report triggers RCA, a fix in code and a fix PR | E |
| 6 | Devin Automations `[devin-automations]` | 2026 | docs | Any system (Datadog, Sentry, custom) can trigger Devin via webhook | E |
| 7 | Cursor Automations `[cursor-automations]` | 2026 | docs | Sentry, PagerDuty, webhook and CI triggers start cloud agents | E |
| 8 | Cursor cloud agents `[cursor-cloud-agents]` | 2026 | docs | VM agents build and test, and open merge-ready PRs | E |
| 9 | Copilot coding agent `[copilot-coding-agent]` | 2026 | docs | Issue/task → tests and linters in an ephemeral environment → one PR per task | E |
| 10 | Azure SRE Agent `[azure-sre-agent-overview]` | 2026 | docs | Alert → RCA → operational mitigations, in review or autonomous mode | E |
| 11 | Azure SRE GitHub connector `[azure-sre-agent-github]` | 2026 | docs | Can create issues and open or **merge** PRs | E |
| 12 | Sentry coding agents `[sentry-coding-agents]` | 2026 | docs | Seer RCA is handed to Claude, Cursor or Copilot, which open PRs | E |
| 13 | PagerDuty AI agents `[pagerduty-ai-agents]` | 2026 | docs | Approved operational remediation; no code PRs described | E |
| 14 | Workato Acumen `[workato-acumen]` | 2026 | docs | "Silent failures" = stalled jobs; incident plus RCA, no repair | C |
| 15 | Arcade hooks `[arcade-hooks]` | 2026 | docs | Post-execution hook can allow, deny or modify a tool result | C |
| 16 | Arcade tool executions `[arcade-tool-executions]` | 2026 | docs | Records inputs and outputs; a manual triage table attributes "output wrong or empty" to tool logic | C |
| 17 | Nango testing `[nango-testing]` | 2026 | docs | Recorded API responses → mocks → Vitest snapshot tests; output validation | C |
| 18 | Stainless BCD `[stainless-bcd]` | 2026 | docs | Breaking-change flags in CI (provider side, spec level) | F |
| 19 | Composio versioning `[composio-toolkit-versioning]` | 2025 | docs | Explicit toolkit versions required for execution | C |
| 20 | Visa TDCommons 10178 `[visa-tdcommons-2026]` | 2026 | def. pub. | Traffic-learned invariants → drift alerts (abstract only; body [verify]) | D |
| 21 | CoHarden `[tan2026coharden]` | 2026 | paper | F→P is not enough: lax tests admit wrong patches; test–fix error coupling | G |
| 22 | Self-Healing Harness `[tayebati2026selfhealingharness]` | 2026 | paper | 55% of gate-rejected fixes improved the trigger but regressed a protected case | G |
| 23 | Executable-contract audit `[bellibatlu2026contractaudit]` | 2026 | paper | 7 tool defects in agent benchmarks, including success reported on writes that never happen | D/H |
| 24 | SkillGuard `[fan2026skilldrift]` | 2026 | paper | Drift as contract violation; localisation raises repair 10% → 78% (skill text) | A′ |
| 25 | DepRepair `[yang2026deprepair]` | 2026 | paper | No failing test localises cross-repo breaks; raw upstream evidence costs 7–23 pp | F |
| 26 | DeltaMCP `[pujara2026deltamcp]` | 2026 | paper | Spec-diff → incremental MCP-server regeneration | F |
| 27 | MCPEvol-Bench `[liu2026mcpevolbench]` | 2026 | paper | 11 interface-evolution operators; frontier agents lose about 14% | H |
| 28 | AgentBug-Smith `[cheng2026agentbugsmith]` | 2026 | paper | Issue → reproduced harness bug; Live-Harness-Bench (200) | G/H |
| 29 | AgentChaos `[tan2026agentchaos]` | 2026 | paper | HTTP-layer value-fault injection on LLM APIs; up to −50 pts | H |
| 30 | Overreliance `[yang2026overreliance]` | 2026 | paper | Agents adopt corrupted returns (up to 68% for web search) | H |
| 31 | Post-wire changes `[patodiya2026postwire]` | 2026 | paper | Frameworks alter valid MCP results; 13 divergences | D |
| 32 | MCP actionability `[mehan2026actionability]` | 2026 | paper | MCP failure results rarely carry a cause or repair | D |
| 33 | Self-healing orchestrator `[babu2026selfhealingorch]` | 2026 | paper | Runtime recovery; silent failures cut to 0% under controlled injection | D |
| 34 | Call-site contracts `[weng2026callsite]` | 2026 | paper | Only 5.3% of LLM call sites satisfy their full contract | D |
| 35 | dcFix `[yamagishi2025dcfix]` | 2025 | paper | Spec-conformance-triggered LLM repair of REST misuse | F |
| 36 | Incident-Arena `[fu2026incidentarena]` | 2026 | paper | SRE repair benchmark with functional verifiers; frontier < 64.3% | E/H |

## 3. Clusters

- **A. Silent drift → patch, research loops.**
  - AegisFlow is the first paper found that closes "silent upstream drift detected → upstream-response diff → patch → invariant-gated validation → deploy → post-deploy monitoring".
  - It covers data pipelines, deploys autonomously, and commits no reproduction test.
  - A′: SkillGuard repairs skill *documents* from violated environment contracts.
- **B. Fix PR with post-fix confirmation (2026 commercial).**
  - LangSmith Engine (Oct 2026) and Cleric now confirm after the fix. Engine charts recurrence around the merged PR. Cleric verifies resolution and publishes fix-vs-no-fix recurrence numbers.
  - Their triggers are an LLM scan of traces (Engine) and metric expectations or alerts (Cleric). Neither triggers on a deterministic per-call contract over a tool's upstream exchange.
- **C. Integration and connector platforms.**
  - Composio, Arcade, Nango and Workato record executions, version toolkits and offer post-execution hooks.
  - Nango records upstream responses as Vitest fixtures (developer-initiated). Workato detects "silent failures", meaning stalls.
  - None documents automatic code repair from a wrong-but-successful result.
- **D. Runtime contracts, receipts and detection only.**
  - Visa (alerts), post-wire differential testing, MCP actionability audit, self-healing orchestrators (runtime recovery), call-site contracts.
  - Plus the earlier set: Outcome Monitors, ToolGate, verimcp.
- **E. Alert-triggered coding agents.**
  - Devin Oncall/Automations, Cursor Automations, Copilot coding agent, Sentry → agents, Azure SRE Agent, PagerDuty.
  - Triggers are alerts, incidents, errors, issues or arbitrary webhooks. Output is a fix PR, with CI handled after it opens.
  - No fail-first committed test or pre-PR gate is documented.
  - **This is the compositional threat:** any detector plus a webhook gives a "loop".
- **F. Spec-, dependency- or misuse-triggered repair.**
  - DeltaMCP, DepRepair, dcFix and Stainless BCD (C27 cluster). All need a spec or version change, so they are blind to spec-invisible drift.
- **G. Repro and gate quality.**
  - CoHarden (lax F→P), Self-Healing Harness (collateral regressions), AgentBug-Smith (issue → repro).
- **H. Drift and fault benchmarks.**
  - MCPEvol-Bench, AgentChaos, Overreliance, Incident-Arena, executable-contract audit.

## 4. Feature matrix for the new hits (same 12 columns and cell rules as SYNTHESIS §5)

Cell values:
- Y = documented
- P = partial, or a different form
- N = not described
- ? = docs silent

| System `[key]` | Sem | Sch | Rcpt | Trace | Repro | F | Fix | Gates | PR | Conf | Inf | Local | Quote (≤25 words) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AegisFlow `[awan2026aegisflow]` | Y (KS, null-rate, ranges "flagging unit changes"; batch-level) | Y (type consistency) | N | P (diff of failed vs successful responses; snapshots) | N (10 recent snapshots, not a committed test) | N | Y | P (≥9/10 snapshot invariants + "minimal CI" before deploy) | **N** (auto-commit + blue-green; human only at 70–80%) | Y (next 100 runs, rollback) | P (bounds from history) | N (no code) | "flagging unit changes or data corruption" |
| Cleric `[cleric-product]` `[cleric-verifying-fixes]` | P (per-change metric expectations) | N | N | P | N | N | Y | ? | Y | **Y** (verifier; recurrence stats) | P (LLM-written expectations/checks) | N | "opens a fix PR, and confirms recovery once the fix deploys" |
| LangSmith Engine, Oct 2026 `[langsmith-changelog-oct2026]` | P (LLM scan; reads successful tool results since Sep) | N | N | P | N | P (model-judged replay vs fix preview) | Y (agent code) | N (CI iterated after PR) | Y | **Y** (PR-merge markers on recurrence charts; reopen on recurrence) | P | N | "Issue charts now mark when each fix's pull request merged" |
| Devin Oncall `[devin-oncall]` | N (alerts, incidents, bug reports) | N | N | P (telemetry) | P ("Reproducing the issue" for bugs; form unstated) | ? | Y | ? | Y | P (reports list PRs opened/merged) | N | N | "open a fix PR" |
| Devin / Cursor Automations `[devin-automations]` `[cursor-automations]` | N (any webhook) | N | N | N | N | N | Y | P (agents can build/test) | Y | N | N | N | "connect automations to internal systems, CI pipelines, monitoring tools" |
| Copilot coding agent `[copilot-coding-agent]` | N | N | N | N | N | N | Y | P (tests and linters before review) | Y | N | N | N | "run tests and linters in an ephemeral cloud development environment" |
| Azure SRE Agent `[azure-sre-agent-overview]` `[azure-sre-agent-github]` | N (alerts) | N | N | P | N | N | P (ops mitigations; PR ops via connector) | P (approval modes) | P (can **merge**) | P | N | N | "open/merge PRs" |
| Sentry → coding agents `[sentry-coding-agents]` | N (errors) | N | N | P | N | N | Y | N | Y | N | N | N | "automated fix generation and pull request creation" |
| PagerDuty `[pagerduty-ai-agents]` | N | N | N | P | N | N | P (operational) | P (approved) | N | ? | N | N | "performs approved remediation" |
| Workato Acumen `[workato-acumen]` | P (stalls only) | P (schema mismatches) | N | P | N | N | N | N | N | N | P (baselines) | N | "stops processing jobs even though no error has been thrown" |
| Arcade `[arcade-hooks]` `[arcade-tool-executions]` | P (hook only) | N | P (modify result) | P (inputs/outputs, not raw upstream) | N | N | N | N | N | N | N | N | "Allow, deny, or modify the result" |
| Nango `[nango-testing]` | N | Y (`--validate`) | N | P (recorded responses) | P (mocks + snapshots; developer-run) | N | N | N | N | N | N | ? (licence unchecked) | "Save API responses during dry runs to create reproducible test fixtures" |
| Stainless BCD `[stainless-bcd]` | N | P (CI, provider side) | N | N | N | N | N | P | N | N | N | N (paid) | "flag unintentional breaking changes during your continuous integration (CI) process" |
| Visa 10178 `[visa-tdcommons-2026]` | Y (learned invariants) | ? | N | P | ? [verify body] | ? | ? | ? | ? | N | Y | N | "outputting drift alerts" |
| SkillGuard `[fan2026skilldrift]` | P (environment contracts from skill text) | N | N | N | N | N | Y (skill document) | P (literal verifier) | N (review advised) | N | **Y** (LLM-extracted) | Y (MIT/CC BY on acceptance [verify]) | "Violated contracts also make repair actionable" |
| Contract audit `[bellibatlu2026contractaudit]` | Y (advertised-surface contracts, incl. phantom writes) | P | N | N (no recorded real calls) | P (reproductions sent upstream) | ? | P (one-hunk patches for 2) | N | N (issues, not PRs) | N | N (human-written predicates) | Y (MIT, Zenodo) | "assuming the tool did what its interface advertises" |
| DeltaMCP `[pujara2026deltamcp]` | N | P (spec diff) | N | N | N | N | Y (regenerates tools) | ? | N | N | N | ? [verify] | "given a new release of it's corresponding service's OpenAPI specification" |
| DepRepair `[yang2026deprepair]` | N | N | N | N | N | N | Y | P (consumer tests in Docker) | N | N | N | N (no artifact link) | "no failing test localizes where the consumer breaks" |
| Self-healing orchestrator `[babu2026selfhealingorch]` | P (verifier-guided) | N | P (recovery in-loop) | P | N | N | N (runtime) | N | N | N | N | ? | "reduces silent failures to 0.0\%" |

**Result for G1.** No hit does all four of fiks's combination items:
1. a per-call deterministic semantic trigger on a successful result, grounded in the raw upstream exchange;
2. a committed, fail-first, stated-reason reproduction test;
3. repair of the tool's own repository, gated *before* the PR on the repro, the suite, all stored traces and CI;
4. an agent receipt paired with confirmation after merge.

**Two hits narrow it materially:**
- **AegisFlow** covers items 1 (statistical, batch-level) and 3 (patch + invariant gate + monitoring), but ships by autonomous deploy, with no test and no PR.
- **LangSmith Engine (Oct 2026) and Cleric** now cover confirmation after merge, and in Cleric's case a published recurrence comparison.

## 5. Contradictions and why they disagree

1. **Raw upstream evidence: help or harm?**
   - DepRepair: raw upstream evidence (release notes, API diffs) *lowers* LLM repair by 7–23 pp; structured evidence helps.
   - fiks (C19): the raw upstream exchange makes a ground-truth repro.
   - *Why they differ:* different objects. DepRepair feeds raw prose and diffs to the repair model. fiks turns the raw exchange into a *structured* failing test, and the test is what the repair agent sees.
   - *Check:* the planned trace-vs-prose arm should add a third arm, "raw trace pasted into the prompt, no test".
2. **Is F→P sufficient?**
   - SWE-bench-style work, and fiks's original F gate, treat F→P as the validity bar.
   - CoHarden shows lax F→P tests give zero repair gain (Table 1: Rigorous +8.5 pts, Lax 0.0).
   - fiks's stated-reason gate addresses the *wrong-reason* failure, not *laxity*. These are different defects, and fiks has measured neither against mutation patches.
3. **Does recovery at runtime make repair unnecessary?**
   - Self-healing orchestrators report silent failures cut to 0% under controlled injection.
   - fiks (C12) says monitors never fix the tool.
   - *Why they differ:* per-episode success vs recurrence. The orchestrator re-routes every time; fiks removes the fault once. The disagreement is about the metric, so report both.
4. **Who reports recurrence?**
   - SYNTHESIS lists "recurrence across agents after repair vs detection-only" as a measurement nobody reports.
   - Cleric reports 64% vs 22% cluster disappearance with vs without an applied fix. Engine charts recurrence around merged PRs.
   - *Why they differ:* the catalog predates both. Cleric's numbers are observational, vendor-run, alert-level and without CIs. fiks's would be controlled and per-contract.
   - The novelty claim must be narrowed to "controlled, pre-registered, per-contract recurrence with CIs".
5. **"Silent failure" means different things.**
   - Workato: no jobs and no error (a stall).
   - AegisFlow: a statistical distribution shift.
   - Engine: less data than the result claims.
   - fiks / C3–C4: a wrong value inside a schema-valid success.
   - Comparisons must align definitions before claiming coverage.

## 6. Claim ledgers for the deep-read sources

**AegisFlow `[awan2026aegisflow]` (PDF, 43 pp.)**
- L1 (Sec. 4, Watchdog): semantic validators use a "Kolmogorov-Smirnov test" against 30-day rolling batches, a null-frequency monitor (2σ), range bounds from history, and type consistency. The trigger is *batch-statistical*, not per call.
- L2 (Repair Agent, Phase 1): diagnosis diffs "the source with the response of the failed & successful requests". This is close to fiks's raw-upstream trace.
- L3 (Shadow Sandbox): the patch is run on "10 recent source snapshots" and checked against success invariants. It is accepted "when it passes all invariants on at least 9/10 test cases". No test is committed, and nothing must fail first.
- L4 (Hot-Swap Deployer): the deployer commits the patch with a confidence header, runs "minimal CI pipelines running syntax checks and unit tests", then blue-green deploys. Human review is used only for 70–80% pass rates.
- L5 (Sec. 6): the experiments claim 90 days of production use across three environments with a 92% patch success rate.
  - The setup text dates environment 1 to "January - March 2016" while the section says 2026. There is no code.
  - Treat the numbers as unverifiable. Cite AegisFlow only for its design.

**CoHarden `[tan2026coharden]`**
- L1 (§2.1): Laxity = share of mutation patches of the golden fix that pass the generated test but fail the golden test. The cutoff is the median, τ = 0.202.
- L2 (Table 1): Rigorous BRTs add +8.5 pts (67.3 → 75.8), Lax add 0.0, Misaligned −3.6.
  - Per-generator Lax deltas range from −3.4 to +2.2 (Table 7). "No gain" is approximate.
- L3 (§2.3): joint test–fix failure is 19.9% vs 10.6% under independence. 48.2% of Cogen failures had an F→P test paired with a wrong fix.
- L4 (§3): the test is written before any fix. The in-loop laxity proxy has no golden artifact. Result: 69.4% resolved with GPT-5-mini.
- *For fiks:* fiks's test comes from the trace, not from the fix agent, which removes the coupling in L3 by construction. Laxity (L1) is untested.

**SkillGuard `[fan2026skilldrift]`**
- L1 (§4.1): regex families plus an LLM pass produce typed contract records (median 22 per skill).
- L2 (§5): 0/599 false alarms (Wilson CI [0, 0.6]%), 76% known-drift recall, 86% conservative precision in a live study of 49 skills.
- L3 (App. M, Table 14): repair is 2/20 without localisation, 12/20 with plain drift text, 16/20 with self-refine (3 rounds), and 25/32 with SkillGuard contracts.
  - The text itself says the gap to plain text and self-refine is not significant.
- L4 (App. C): "Assumptions that are implicit, behavioral, or observable only through execution can be missed." Behavioural drift is out of scope.

**DepRepair `[yang2026deprepair]`**
- L1 (§I, §IV-A): "no failing test inside C that localizes the fault".
- L2 (§III-B): the categories are rename, compound migration, import migration and paradigm shift. None is silent behaviour with an unchanged signature.
- L3 (§V-E, Table V): raw evidence costs −7.4 to −23.2 pp.
- L4 (§VI): 95 instances limit statistical power. No artifact link is given.

**MCPEvol-Bench `[liu2026mcpevolbench]`**
- L1 (§5.2): the operators work at tool, parameter and description level, and preserve "backward compatibility and original functionality".
- L2 (App. B): mutations edit the server's source, not live upstreams.
- L3 (§6.2): Task Fulfillment falls 7.23 → 6.24 (GPT-5.4) and 7.22 → 6.18 (Sonnet 4.6).
- L4: release is not stated. The benchmark does not cover upstream-changed/tool-unchanged silent drift (SYNTHESIS M1 stands).

**Executable-contract audit `[bellibatlu2026contractaudit]`**
- L1: contracts are written from docstrings and schemas; a person writes each predicate; only dynamic probes issue verdicts.
- L2 (Findings 1, 3): MedAgentBench POST reports "accepted and executed successfully" but never writes. tau2-bench `cancel_reservation` never releases seats.
- L3: no false positives on 25 injected defects, but closed-world recall is 0.00–0.36 by class. 29 of 33 misses had a covering clause but no revealing probe.
- L4: findings and repairs were filed as issues (2026-09-12 and 2026-09-24). The artifact is MIT on Zenodo.
- L5 (limits): "The probe stage lacks a recorded-real-calls component". This is exactly what fiks's recorded traces supply.

**Cleric `[cleric-verifying-fixes]`**
- L1: the verifier is a separate agent. It generates check code, which a scheduler re-runs. Verdicts are resolved, open or undetermined.
- L2: 64% vs 22% of recurring clusters vanished with vs without an applied fix. Daily recurrence fell from 18% to 7% (4 weeks of production alerts).
- L3: the post admits verifier errors, such as treating "on main" as rolled out to production.

## 7. What this means for fiks

**Where fiks still differs** (each is checkable in the matrix above):
- **Trigger.** A deterministic per-call contract on a *successful* MCP result, including read-after-write, at the consumer-side wrapper.
  - AegisFlow is batch-statistical. Engine is LLM-scanned. Cleric uses metric expectations. Devin and Cursor use alerts or webhooks.
- **Artifact.** A committed reproduction test built from the recorded drifted exchange, which must fail first for the named property.
  - No hit commits a fail-first test. AegisFlow replays snapshots against invariants. Engine replays model-judged runs.
- **Gate placement.** Everything is green, CI included, *before* the PR opens, and the PR is never merged.
  - Engine, Seer, Bits, Devin and Copilot iterate CI after opening. AegisFlow auto-deploys. Azure SRE Agent can merge.
- **Agent receipt alongside the durable fix.** No E-cluster or B-cluster product returns a verdict to the running agent.
- **What is repaired.** The *tool's* repository (the MCP server), not the agent (Engine), the pipeline (AegisFlow) or a skill document (SkillGuard).

**Where fiks is weaker:**
- **Breadth and evidence.**
  - AegisFlow claims 90 days of production use across 45 APIs (unverifiable, but a reviewer will cite it). Cleric publishes production outcome data.
  - fiks has seeded drifts on one server.
- **Confirmation after merge is no longer unique.** Engine and Cleric do it in production.
- **Contract authoring.**
  - SkillGuard and Visa infer contracts. AegisFlow learns bounds from history.
  - fiks contracts are hand-written (Inf = N).
- **Statistical drift.** AegisFlow's distribution tests can catch drift that has no hand-written invariant. fiks's vocabulary limit (C11) applies.
- **Composability.** A team can wire an Outcome-Monitors-style checker into a Devin or Cursor webhook today.

**Strongest counter-argument a reviewer would raise.** "The fiks loop is a composition of available parts:
- a post-execution hook (Arcade, Docker, ContextForge) running output contracts (Outcome Monitors);
- a webhook to a coding agent (Devin or Cursor Automations), which reproduces and opens a PR;
- CI handled by the agent (Engine, Seer);
- recurrence confirmed by the vendor (Cleric, Engine).

AegisFlow already closes silent drift → patch → validated deploy. The novelty is glue."

*Answer required in the paper, by experiment, not by argument:*
- (i) Run the composition as a baseline: contract monitor → prose alert → off-the-shelf agent → PR, with CI after the PR. Show what the F gate and pre-PR gates add: wrong-reason rate, lax-patch rate, red-CI PRs, regressions on stored traces.
- (ii) Show that deterministic per-call contracts catch drifts that batch-statistical detectors (AegisFlow-style KS, null and range checks) miss, or catch them sooner. Example: a one-off cents drift on low-volume tools.

**Suggested C28 / novelty wording** (replaces SYNTHESIS §9's patent caveat):
> "We have not found a system whose trigger is a deterministic contract violation in a successful tool result and whose PR is opened only after a fail-first, stated-reason reproduction test built from the recorded upstream exchange, the full contract suite, stored traces and CI pass. Nearest: AegisFlow (2026) detects silent pipeline drift statistically and auto-deploys patches validated on snapshots. LangSmith Engine and Cleric open fix PRs and confirm recurrence after merge. Patent databases were not searched."

## 8. Candidate hypotheses (each with its falsifier)

- **HG1 (gates vs composition).** On the seeded and blind drift suites, fiks's pipeline yields fewer PRs that are wrong-reason, lax (per mutation-patch laxity) or regress a stored trace than the composition baseline (same contract monitor → prose alert → same repair model, CI after PR).
  - *Falsified if* the composition baseline's rates are within the pre-registered margin, with a CI overlapping zero on the paired difference.
- **HG2 (laxity).** Repro tests that pass fiks's stated-reason F gate have lower CoHarden-style laxity (share of LLM mutation patches that pass the repro but fail a held-out oracle) than F→P-only tests built from the same trace.
  - *Falsified if* the laxity distributions do not differ (paired test, Holm-corrected).
- **HG3 (raw vs structured evidence).** Repair success: trace → test > raw trace in prompt > prose alert. This is a direct DepRepair-style check of C19.
  - *Falsified if* raw-trace-in-prompt ≥ trace → test, or prose ≥ either.
- **HG4 (per-call vs statistical detection).** Deterministic contracts detect seeded drifts at lower call volume (calls-to-detect) than an AegisFlow-style batch detector (KS p < 0.01, null-rate 2σ, historical range), with no more false positives on v1.
  - *Falsified if* the statistical detector matches recall at equal volume with ≤ false positives. This also tests the authoring-cost critique.
- **HG5 (recurrence, narrowed).** In a controlled replay, recurrence after a merged fiks PR is 0 for the repaired contract, while detection-only (receipts) and runtime recovery (orchestrator-style retry) leave recurrence unchanged across agents and seeds.
  - *Falsified if* runtime recovery lowers *recurrence of the upstream fault reaching the tool* (not task failure). It should not, by construction. So the real test is whether *task-level* failure differs after repair vs runtime recovery. Report both, and cite Cleric as observational precedent.
- **HG6 (receipt survival).** Receipts in `_meta` are dropped or altered by some agent frameworks, but the text-block copy survives.
  - *Falsified if* all tested frameworks preserve `_meta` (then the dual channel is unnecessary), or the text block is also lost.
  - Method: the post-wire differential harness of `[patodiya2026postwire]`.

## 9. Candidate baselines we could actually run

| Baseline | Source | Licence | How |
|---|---|---|---|
| **Composition baseline** (monitor → webhook-style prose alert → coding agent → PR, CI after) | Emulates `[devin-automations]` `[cursor-automations]` `[langsmith-changelog-oct2026]` | n/a (our code) | Reuse fiks's contracts; replace Reproduce and the pre-PR gates with "alert text + the same repair agent, PR immediately, up to 3 CI revisions in ≤ 90 min" (Engine's documented policy). No vendor accounts (G15). |
| **AegisFlow-style statistical detector** | `[awan2026aegisflow]` Sec. 4 | reimplement (no code) | KS test on per-field values vs a v1 window (p < 0.01), null-rate > mean + 2σ, historical min/max range, type consistency. Run offline over the logged calls (G2). |
| **AegisFlow-style snapshot validation** (no committed test) | `[awan2026aegisflow]` Shadow Sandbox | reimplement | Accept a patch if invariants hold on ≥ 9/10 recent recorded snapshots. Compare against fiks's F gate on wrong-reason and laxity. |
| **CoHarden laxity metric** | `[tan2026coharden]` §2.1 | method only (code release unconfirmed) | Generate N mutation patches per golden fix with an LLM; laxity = passes-repro ∧ fails-held-out-oracle. |
| **SkillGuard contract extraction** as an inference baseline | `[fan2026skilldrift]` | MIT code, CC BY data "upon acceptance" [verify availability] | Extract contracts from tool docstrings and README, and compare with hand contracts (H15). |
| **Executable-contract checker** | `[bellibatlu2026contractaudit]` | MIT (Zenodo 10.5281/zenodo.22182792) | Run on shop-mcp tools as an advertised-surface checker (static + probes). Also yields tau2-bench and AgentDojo real-bug candidates (only in forks). |
| **Post-wire differential harness** | `[patodiya2026postwire]` | [verify] | Pass a fiks receipt through ADK, OpenAI Agents, LangChain and similar to test HG6. |
| **Spec-diff regeneration** (negative control) | `[pujara2026deltamcp]` | [verify] | It must produce no change on fiks drifts (spec unchanged). Cheaper: oasdiff (already listed). |

## 10. Open gaps

1. **Patents (Google Patents, USPTO, EPO) are still unsearched.** Needs a turn with WebSearch budget, or a human. Suggested queries:
   - "generating a regression test from a production request/response and a code patch";
   - "API response drift detection repair integration";
   - "automated pull request from runtime monitoring anomaly".
2. **The Visa 10178 body** sits behind a Cloudflare challenge. A human should confirm in a browser that it does not describe test generation or repair.
3. **More TDCommons defensive publications** were not searched.
4. **YC W25–F26 batch scan** was not done (search UI). Unverified candidates to check by name: AI-SRE and connector-maintenance startups beyond Cleric.
5. **arXiv sweep gaps.** cs.LG, cs.CL, cs.DC, cs.NI, pre-2026 cs.AI, OpenReview and abstract-level (not title-level) matching were not covered.
6. **AegisFlow's evaluation is unverifiable** (no code; date inconsistency). Contacting the authors for the artifact would let us run it rather than emulate it.
7. **Cleric and Engine were not measured directly** (accounts required; out of scope per G15). Rows rest on vendor docs.
8. **DeltaMCP, MCPEvol-Bench and the post-wire harness:** artifact availability is unconfirmed.
