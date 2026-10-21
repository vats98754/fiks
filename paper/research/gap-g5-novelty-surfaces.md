# Gap G5: novelty surfaces not yet searched (patents, TDCommons, YC W25–F26, 2025–26 arXiv/OpenReview, injection into coding agents)

Date of all searches: **2026-10-21**. Companion files: `gap-g5-novelty-surfaces.sources.json` (37 sources), `verify/g8-reverify.json` (G8).

Loop-step codes used below (from CLAUDE.md): **O** observe (per-call contract on a successful result), **C** capture (trace + raw upstream exchange), **R** reproduce (fail-first, named-property test), **F** repair (patch the tool/server code), **S** ship (PR only after all gates, never merge), **K** confirm (post-merge violation rate), **Rc** receipt to the running agent. Cell values: Y = covered, P = partly covered, N = not covered, ? = not documented.

## 1. Searches run, and their limits

**(a) Patents.**
- *Google Patents.* One query through the public `xhr/query` JSON endpoint returned results (`"pull request"`, 7,330 hits after 2015). The next four queries and three single-patent pages returned **HTTP 503 with Google's "automated queries" page**. I stopped there and did not try to get around it. Google Patents full-text search is therefore **still not done**.
- *WebSearch (10 patent-oriented queries, extended mode).* The queries covered these combinations:
  - production traffic → regression test → patch → PR;
  - API response drift detection plus repair;
  - runtime anomaly → PR;
  - LLM agent tool-output validation plus test plus fix;
  - MCP server monitoring and remediation;
  - self-healing integration connectors;
  - postcondition/invariant violation → test → repair;
  - incorrect tool output → unit test → repair;
  - generative model, trace → regression test → PR;
  - runtime monitoring → reproduction test → patch (EPO wording).
- *USPTO.* For every candidate patent, I downloaded the full-text PDF from `image-ppubs.uspto.gov`. These PDFs are image-only, so I OCR'd the front page and the claims pages with tesseract. That covered 9 patents.
- **Not reached:** USPTO PPUBS full-text search, Espacenet, WIPO Patentscope, and CNIPA/JPO/KIPO.

**(b) TDCommons.**
- *Visa 10178.*
  - The landing page loads, and its abstract was re-read.
  - The PDF (`viewcontent.cgi?article=11480`) **again returned HTTP 403**. I did not bypass it, so the body is **still unread**.
- *Four WebSearch queries scoped to tdcommons.org.* Opened from the results: No. 12336 and No. 10736.
- Seen only as search snippets, not opened: Nos. 9965/8731 (service onboarding with recursive build-error correction), 6279 (LLM test-case generation), 8590 (replay of production API payloads in a test instance) and 9454.

**(c) YC W25–F26.**
- *Directory data.* The YC directory is a search UI, so I used the public `yc-oss` mirror of the directory data (`yc-oss.github.io/api/companies/all.json`). Of its 6,320 companies, 1,400 are in batches W25, X25, S25, F25, W26, X26, S26 and F26.
- *Matching.* I regex-matched one-liners and long descriptions for:
  - self-heal, API/schema/integration drift or breaking change, MCP, integration monitoring, auto-fix/fix-PR/mergeable PR;
  - silent failure/wrong data, tool-call reliability, reproduction/regression test, AI SRE/incident, drift, contract check, data quality, upstream.
- *Results.* This gave about 65 matches. I opened the YC page or the product site for the 8 closest; the rest are listed from directory text only (§3).
- Batch labels come from the mirror. For Exla, Superlog, BentoLabs and Confident AI, the batch was re-confirmed on ycombinator.com.

**(d) arXiv (all categories, abstract level) and OpenReview.**
- *arXiv.* I ran 17 abstract-field queries through the arXiv export API (`search_query=abs:…`, newest 40 per query, filtered to 2025+). I checked them against the ~270 arXiv IDs already in our catalogs. This is the first **abstract-level** (not title-level) sweep, and it includes cs.LG and cs.CL.
  - Queries:
    - tool + drift + repair + agent;
    - MCP + repair + test;
    - API + drift + pull request;
    - tool output + verif + repair;
    - reproduction test + runtime + trace;
    - silent + tool + contract;
    - self-healing + tool + agent;
    - self-healing + API;
    - upstream + tool + wrong + agent;
    - postcondition + tool + LLM;
    - prompt injection + coding agent (+ issue / + benchmark);
    - injection + SWE-bench;
    - indirect prompt injection + repository;
    - prompt injection + pull request;
    - injection + program repair + LLM.
  - Plus 3 WebSearch queries (OpenReview runtime verification; self-evolving tool repair; MCP repair from runtime failures).
- *OpenReview.* Reached only through WebSearch. The one OpenReview hit ("Failing Tools", ARR 2026) is already in `runtime-monitors.md`.

**(e) Injection into SWE/coding agents (2026).**
- 1 WebSearch query plus the 6 arXiv injection queries above.
- I read abstracts for 8 papers.

## 2. Hits table (verified by opening the page; loop-step coverage with evidence)

| # | Source | Type, date | O | C | R | F | S | K | Rc | Evidence (≤25 words, from the opened page) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **US 12,711,009 B2** (Microsoft) `[msft-us12711009]` | patent, granted 18 Aug 2026; prov. Jul 2023 | N (trigger = detected failure: exception, call stack, memory dump, incident report, event log) | P (error file) | P (claim 9: PR comes with "software test", not fail-first) | **Y** (LLM generates repaired code) | **P** (claims 8–9 PR API; no gates claimed) | N | N | "the pull request API provides the pull request and software test for testing the indicated software code." (claim 9) |
| 2 | US 9,983,982 B1 (Visa) `[visa-us9983982]` | patent, 2018 | N | **Y** (production request/response payloads) | N | N | P (new version validated against mirrored production traffic) | N | N | "To detect potential errors in the second version, the modified request payload is compared with the request payload" |
| 3 | US 12,483,491 B2 (Zoom) `[zoom-us12483491]` | patent, Nov 2025 | N | **Y** (captured API request/response) | P (test case generated from the exchange; not fail-first) | N | N | N | N | "generates and outputs standardized test information based on the first network information to a test case generation service." |
| 4 | US 12,699,546 B1 (U.S. Bank) `[usbank-us12699546]` | patent, Aug 2026 | P (statistical + ML anomaly on frontend performance) | P | N | **Y** (code patch) | P (claim 14: review → approval → modify; no PR/tests) | P (claim 13: post-patch metric change → retraining) | N | "A code patch is generated; the code patch being configured to avoid the anomaly." |
| 5 | US 12,549,574 B1 / US 12,562,968 B1 (Airia) `[airia-us12549574]` `[airia-us12562968]` | patents, Feb 2026 | P (MCP SSE-bridge proxy detects changes in server resource profile; security rules) | N | N | N | N | N | N | "A system detects changes in model context protocol (“MCP”) processes, and performs a remedial action." |
| 6 | US 10,810,065 (SAP), US 12,147,395 (Oracle), US 11,695,666 (JPMC) | patents, 2020–2024 | P (schema/infra drift) | N | N | P (API definition / pipeline rules / infra remedy) | N | N | N | "a self-learning and self-healing API platform" (SAP abstract) |
| 7 | Visa TDCommons 10178 `[visa-tdcommons-2026]` | def. pub., May 2026 | **Y** (learned per-endpoint invariants over production exchanges) | P | ? (body unread) | ? | ? | N | N | "drift alerts characterizing the detected drift conditions" (abstract) |
| 8 | TDCommons 12336 `[tdcommons-12336]` | def. pub., 20 Oct 2026 | **Y** (inferred data contract on ingestion) | N | N | P (LLM repairs the *record*, then a deterministic validator re-checks) | N | N | N | Paraphrase: violating records repaired by an LLM, then validated deterministically before write |
| 9 | **D3 Security Morpheus "Self-Healing Integrations"** `[d3-morpheus-selfhealing]` | vendor, Apr 2026 | **Y (claimed)** (API response deviates from expected contract) | ? | ? | **Y (claimed)** (regenerates connector code) | N: tests then autonomous deploy "without human intervention"; no PR | ? | N | "When an API response deviates from the expected contract, the platform identifies the specific change." |
| 10 | **Exla (YC W25)** `[exla-yc-w25]` | startup | P (baseline of normal behaviour over logs/traces; "silently regresses") | P | N | Y (claimed) | P (opens a fix PR; no gates described) | N | N | "it catches the deviation immediately, pins it to the exact commit that caused it, and opens a fix PR." |
| 11 | Superlog (YC Sp26) `[superlog-yc-s26]` | startup | N (Sentry new issue) | P | N | Y | P (one mergeable PR per incident; no gates documented) | ? | N | "posts one mergeable PR per incident into Slack." |
| 12 | BentoLabs AI (YC Sp26) `[bentolabs-yc-s26]` | startup | P (agent drift from "tool contracts"; method undocumented) | P | N | P (prompt/skill/harness, not tool code) | N | ? | N | "tool contracts, show affected users and root cause, and suggest the prompt, skill, or harness fix." |
| 13 | Lemma (YC F25) `[lemma-yc-f25]` | startup | P (audits traces against agent instructions; caught invented IDs on successful tool calls) | P | N | P (via user's coding agent) | N | P (online eval after fix) | N | "Every one returned success, so nothing surfaced in error monitoring." |
| 14 | Confident AI (YC W25) `[confidentai-yc-w25]` | startup | P | P | P (trace → eval case) | N | N | P | N | "automatically turns problematic traces into the the next eval" |
| 15 | Trodo (Cryptique Inc.) `[trodo-2026]` | vendor | P (every trace; deterministic checks first, e.g. failed tool call; LLM judge last) | P | N | P (hands off to Claude Code/Cursor; fixes target prompts/config) | N | **Y** (replay vs failing traces; reopen on recurrence) | N | "Trodo reopens it in triage with its full history." |
| 16 | self-healing-api-agent (GitHub) `[codingwinterz-selfhealing-api-agent]` | repo | N (OpenAPI spec diff) | N | N | Y (client Python call sites) | P (parse-only gate, then PR) | N | N | "diffs published spec files, not live endpoints" |
| 17 | Kitchen Loop `[roy2026kitchenloop]` | arXiv Mar 2026 | N (synthetic user exercises spec) | N | P ("Unbeatable Tests") | Y | Y (1,094+ merged PRs; drift-control pause gates) | P | N | "The primitives are not new; our contribution is their composition into a production-tested system" |
| 18 | Verified Tool Calls `[mansoor2026verifiedtoolcalls]` | arXiv Jul 2026 | **Y** (postcondition verification at agent–tool boundary; delayed visibility, partial updates) | N | N | N | N | N | P (verify-before-retry) | "augments tool calls with postcondition verification, verify-before-retry logic, and idempotency keys." |
| 19 | Tool-Making agents `[kujanpaa2026toolmaking]` | arXiv Jul 2026, EMNLP Ind. | N | P (execution traces, backend values) | P (labelled cases) | P (repairs candidate tools offline) | N | N | N | "Versioned tools also improve auditability and expose specification gaps and upstream data drift." |
| 20 | SchemaShield-Lite `[chattopadhyay2026schemashield]` | arXiv Oct 2026 | N (input-side schema validation under interface drift) | N | N | N (repairs the call) | N | N | N | "positions validation-and-repair as a practical robustness layer for deployed LLM-agent tool use." |
| 21 | ResonAct `[chintada2026resonact]` | arXiv Sep 2026 | P (streaming tool-reliability metrics) | P | N | N (runtime remediation policies) | N | N | N | "ResonAct dynamically selects remediation policies and performs actions." |
| 22 | PROCTOR / "LLM-as-a-Judge Is Not an Oracle" `[wahi2026judgenotoracle]` | arXiv Sep 2026 | – | – | – | P (prompt mutations) | P (deterministic gates) | – | – | "every change is gated instead by a deterministic verification layer the judge cannot override." |
| 23 | From Bug Report to PR `[milev2026bugreport2pr]` | ACM CAIS 2026 | N (Jira ticket, New Relic traces) | P | ? | Y | P (human review) | ? | N | UNREACHABLE (403); Crossref metadata only, so treat content as unverified |
| 24 | AppLooper, Kintsugi/Sentinel, TDCommons 10736, ResonAct-like runtime healers | various | weak | | | | | | | see sources.json |

**Injection into SWE/coding agents via tool or trace content (2026):**

| # | Source | What it measures | Evidence |
|---|---|---|---|
| I1 | **CapScope** `[bouras2026capscope]` (arXiv Sep 2026) | Injection via repository files or **tool output** into a coding agent inside a *repair workflow*, across 5 injection surfaces (300 runs). The injected effect executed in 33–47/75 runs under baselines vs 3/75 with per-sub-agent typed capabilities. | "placing instructions in repository files or tool output that cause the agent to perform actions the user did not request" |
| I2 | **SWExploit** `[chen2025swexploit]` (arXiv Sep 2025) | Adversarial issue text with misleading reproduction/error information makes APR agents emit **functionally correct but vulnerable** patches (attack success up to 0.91). | "provide misleading reproduction and error information while preserving the original issue semantics" |
| I3 | GitInject `[isbarov2026gitinject]` | Live GitHub-workflow injection; 11 attacks; all 4 providers susceptible by default. | "all tested providers are susceptible to at least one attack class in their default configuration" |
| I4 | LivePI `[zhao2026livepi]` | 7 surfaces including repositories; total attack success 10.7–29.6% on 2026 frontier backbones. | "total attack success rates range from 10.7% to 29.6%" |
| I5 | Workspace topology `[day2026workspacetopology]`; PackHallu `[wang2026packhallu]`; Iterative VibeCoding `[hills2026iterativevibecoding]`; SoK `[maloyan2026sokcoding]` | Respectively: where injected text sits changes attack success; rule-file injection swaps dependencies; payloads spread across PRs evade monitors; meta-analysis reports >85% adaptive success. | see sources.json |

None of these injects through a **runtime trace or recorded upstream fixture** that then feeds a gated repair loop. SWExploit (issue text) and CapScope (tool output in a repair workflow) are the nearest. fiks's "fixture-poisoning" contribution (SYNTHESIS §9, item 4) stays open, but it must cite both. SWExploit shows directly that test-passing gates can launder injected vulnerabilities.

## 3. Listed but not opened (directory text only; no coverage claim)

The YC W25–F26 regex matched these, and their directory text describes AI SRE, agent monitoring or gateway work:
- AI SRE and incident tools: Deeptrace (F25), IncidentFox (W26), HyperProbe (S26), OnePatch (F26).
- Agent monitoring: Sentrial (W26), Agnost AI (S26).
- Gateways and marketplaces: Executor (S26, MCP gateway), Amorphic Labs (S26, MCP capability marketplace).
- Other: Pomerado (F26, "self healing, deterministic APIs" over websites), Velum Labs (W26, data quality).

None of the directory texts mentions a contract on successful tool results, a reproduction test, or gated PRs.

## 4. What changed for the novelty claim

**New closest work, by fiks loop step:**
1. **Patent: Microsoft US 12,711,009 B2 (granted Aug 2026).**
   - *What it claims:* LLM repair of code from error context, with a PR API that returns the PR **and a software test**.
   - *Consequence:* the generic step "detected issue → generated fix → PR with test" is claimed prior art. fiks must not describe "auto-PR with a test from a runtime failure" as new.
   - *Gaps:* the claims rely on failures (exceptions, dumps, incidents). They do not cover contract violations in successful results, fail-first tests or pre-PR gates.
   - *Limits of this reading:* this is a reading of the claims, not a freedom-to-operate opinion.
2. **Vendor: D3 Security Morpheus "Self-Healing Integrations" (Apr 2026).**
   - *What it claims:* a deviation of an API response from the expected contract → regenerated connector code → tested → **auto-deployed without human intervention**.
   - *Consequence:* this is the closest trigger-plus-repair product found. It sits next to AegisFlow on the "autonomous deploy" side.
   - *Gaps:* it is marketing copy. No mechanics, no PR, no repro test and no MCP.
3. **Startup: Exla (YC W25).**
   - *What it claims:* a silent-regression baseline over logs → commit → fix PR.
   - *Gaps:* the detection is statistical/log-based, and no gates are documented.
4. **Paper: Verified Tool Calls (arXiv 2608.02645).**
   - *What it does:* postcondition verification at the agent–tool boundary for non-atomic writes.
   - *Consequence:* add it to "not new: runtime output contracts / read-after-write checks", next to Outcome Monitors and ToolGate.
5. **Patents: Visa US 9,983,982 and Zoom US 12,483,491.**
   - *What they cover:* validating a new version against mirrored production request/response pairs, and generating tests from captured API exchanges.
   - *Consequence:* these support the "record/replay as tests" prior-art row with patents, not just products.

**Updated novelty statement (dated 2026-10-21; patents partially searched):**

> We have not found a system, paper, patent or defensive publication with both of the following properties:
> 1. Its **trigger** is a deterministic contract violation in a *successful* tool/MCP result. The check runs per call and is grounded in the raw upstream exchange, including read-after-write postconditions.
> 2. It **opens a PR only after** all of these pass: a fail-first, stated-reason reproduction test built from the recorded upstream exchange; the full contract suite; all stored traces; typecheck/lint; and CI. It never merges.
>
> Nearest prior art:
> - Error- or incident-triggered LLM repair with a PR and an accompanying test is patented (Microsoft US 12,711,009 B2, 2026).
> - Contract-deviation-triggered regeneration of integration code with autonomous deployment is marketed (D3 Morpheus, 2026).
> - Statistical silent-drift detection → patch → validated deploy is published (AegisFlow, 2026).
> - Post-merge recurrence confirmation exists (LangSmith Engine, Cleric).
> - Per-call postcondition checks at the agent–tool boundary are published (Outcome Monitors; Verified Tool Calls, 2026).
>
> Patent search covered WebSearch plus USPTO full texts of 9 retrieved patents. Google Patents full-text, Espacenet and Patentscope were not searched.

**Unchanged:**
- The defensible novelty is still narrow: the trigger, the named-property fail-first repro without a golden patch, and gates (including CI) before the PR, with a receipt to the running agent.
- The "Not new" list in SYNTHESIS §9 should add:
  - Microsoft '009 (error → LLM fix → PR + test);
  - D3 Morpheus (contract deviation → regenerated connector → auto-deploy);
  - Exla (baseline regression → fix PR);
  - Verified Tool Calls (postconditions);
  - Visa '982 and Zoom '491 (production-traffic validation and capture-to-test).
- The injection contribution stays conditional, and must cite SWExploit and CapScope.

## 5. Still not searched (explicit)

1. **Google Patents full-text queries** were blocked by Google's automated-query protection after one call. **Espacenet, WIPO Patentscope, USPTO PPUBS search and the CN/JP/KR offices** were not reached. The 9 patents read came from WebSearch hits, not from a systematic CPC sweep (G06F 11/36, G06F 8/70, G06F 11/07, H04L 67).
   - Suggested next step: a human runs the three `gap-prior-art-sweep` §10 queries plus "contract violation" AND "pull request", restricted to CPC G06F 11/36 and G06F 8/65–8/71, for 2015–2026.
2. **Visa TDCommons 10178 body.** It returned 403 again. A human with a browser must check whether it describes tests or repair.
3. **TDCommons Nos. 9965/8731, 6279, 8590 and 9454** were seen only as search snippets.
4. **YC.**
   - The scan used a third-party mirror and keyword matching. Companies with non-matching descriptions are missed.
   - Only 8 of about 65 matches were opened.
   - Pre-W25 batches were not re-scanned.
5. **arXiv and OpenReview.**
   - The arXiv sweep was 17 abstract-level queries × the 40 newest results. That is not exhaustive, and older relevant 2025 papers may sit beyond the cut-off.
   - OpenReview was reached only through web search. ICLR 2027 submissions and NeurIPS 2026 workshop pages were not browsed.
6. **Post-2025 agent-evaluation statistics** (part of G5 in SYNTHESIS §9) were not searched in this pass.
7. **Products were not measured** (Exla, Superlog, D3 Morpheus, Trodo, Lemma). Every row rests on vendor pages.
8. **"From Bug Report to Pull Request" (ACM CAIS 2026)** full text returned 403. Its row rests on a search snippet plus Crossref metadata.
