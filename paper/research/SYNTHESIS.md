# SYNTHESIS (round 2): what the literature and market say about the fiks loop

Synthesizer pass, 2026-10-21. Method: paper-forge Mode E (synthesis across a verified catalog).
Round 2 adds six gap areas to round 1:
- `gap-prior-art-sweep` (G1)
- `gap-repair-security`
- `gap-eval-methodology`
- `gap-maintainer-acceptance`
- `gap-client-api-adaptation`
- `gap-data-observability`

Inputs: all 18 area files in `paper/research/` (`*.md`, `*.sources.json`, two `*.candidates.json`), `codebase-map.md`, and all 88 verdict files in `paper/research/verify/`.

Output companion: `bibliography.json`, rebuilt from scratch. It is a merged, deduplicated list of verified or corrected works with stable BibTeX keys; round-1 keys and metadata are kept unchanged. The merge script lives in the session scratchpad (`build_bib2.py`) and is not part of the repo.

**Notation:**
- `[key]`: a key in `bibliography.json`, with verdict VERIFIED, WRONG_METADATA (corrected) or VERIFIED_SYNTH (see below). Three entries are UNREACHABLE and are kept only with a `[verify]` flag: `[bartocci-rv]`, `[dig2005refactorings]` and `[mecheo2026dependafix]`.
- VERIFIED_SYNTH: re-checked once by this synthesizer on 2026-10-21. These are `[xavier2017apibreak]` (C14) and `[mcp-healer]`. A second verifier is still needed for ORCHESTRATION's two-verifier rule.
- `[Cn]`: a RESEARCH.md claim ID.
- `†key`: a source that was dropped (WRONG_CLAIM / NOT_FOUND) or is pending (no verdict). It is named only to plan work and must not support a sentence in the paper until it is re-verified (Appendix B, C).
- `[ledger]`: a number taken from an area file's full-text claim ledger. The source is verified, but this exact number is not in its verified `cite_claim`, so a citation verifier must re-check it before it appears in the manuscript.
- `[verify]`: a fact that neither the area researcher nor the verifier could re-check.
- `[Inference]`: our reasoning, not a sourced fact.

---

## 0. Inputs, verification outcome, and limits of this catalog

| Item | Count |
|---|---|
| Source entries across 18 areas | 679 (592 unique keys after alias merge) |
| Verdicts: VERIFIED / WRONG_METADATA / WRONG_CLAIM / NOT_FOUND / UNREACHABLE | 527 / 42 / 48 / 1 / 3 |
| Source entries with no verdict | 58 |
| Works in `bibliography.json` | **508**. Of these, 331 were carried from round 1 with the same keys and 177 are new. By verdict: 461 verified; 32 metadata-corrected; 10 with both a verified and a corrected entry; 3 UNREACHABLE (flagged `needs_reverification`); 2 VERIFIED_SYNTH. |
| Of these, dated 2025–2026 | 330 |
| By type | paper 289, tool-docs 104, repo 47, blog 28, issue 26, spec 8, other 5, patent/defensive publication 1 |
| Dropped and gone (WRONG_CLAIM / NOT_FOUND, no verified twin) | 37 (Appendix B). Ten further works lost one claim but kept another verified claim; each such entry lists the lost claim under `not_citable_claims`. |
| Pending (no verdict, no verified twin) | 48 (Appendix C) |
| New alias merges in round 2 | `zhong2025impossiblebench` → `[impossiblebench]`; `langsmith-changelog-oct2026` → `[langsmith-changelog-2026]` |

**Recall limits. Read these before trusting any "no one does X".**
- **None of the six round-2 gap areas ran a successful WebSearch.** The shared 200-call budget was exhausted before they started. They used other routes instead:
  - an arXiv *listing* sweep: 62,544 unique IDs from cs.SE Jan 2025–Oct 2026 and cs.AI/cs.MA Jan–Oct 2026, title-regex filtered; about 300 hits; 40 abstracts and 7 full texts read `[ledger: gap-prior-art-sweep §1]`;
  - Semantic Scholar citation-graph snowballing;
  - `llms.txt` indexes of products;
  - direct fetches of known URLs.
- Round 1 already had six areas with zero web searches.
- **Still not searched:**
  - patent databases (Google Patents, USPTO, EPO);
  - the body of Visa TDCommons 10178, which sits behind a Cloudflare challenge that we did not bypass;
  - YC W25–F26 batches;
  - cs.LG, cs.CL, cs.DC, cs.NI and OpenReview;
  - 2025–26 agent-eval statistics beyond HAL, ABC and Bowyer;
  - 2026 injection-into-SWE-agent benchmarks;
  - MSR'26 acceptance papers that have no preprint.
- Every absence claim below inherits these limits. Search budget is gap G5 in §9.

---

## 1. Catalog summary and clusters

The clusters below group sources by shared **assumption or method**, not by topic keyword. K1–K12 are round 1 (some updated); K13–K18 are new.

| ID | Cluster (shared assumption / method) | Representative members | Gives fiks | Leaves open (where fiks enters) |
|---|---|---|---|---|
| K1 | **"Tools are ground truth."** Agent benchmarks score the agent while holding tool outputs correct. | `[yao2024taubench]` `[barres2025tau2]` `[wu2025mcpmark]` `[luo2025mcpuniverse]` `[bandi2026mcpatlas]` `[trivedi2024appworld]` `[zhang2025whowhen]` `[deshpande2025trail]` | pass^k; state-based graders | Tool faults are invisible or booked as agent error. MCP-Atlas attributes 63.3% of diagnosed failures to cognition `[bandi2026mcpatlas]`. An executable-contract audit found **7 tool defects inside agent benchmarks**, including writes reported as successful that never happened `[bellibatlu2026contractaudit]`. |
| K2 | **Fault sizing by mining issues** (descriptive counts, not rates) | `[owotogbe2026mcpfaults]` [C3,C4] `[hasan2025mcpfirstglance]` [C5] `[taraghi2026realfaults]` `[huang2017grayfailure]` `[mcp-memory-4887]` | Silent faults recur. Crash- or error-based detection is insufficient. | No organic silent-fault *rate*. Nothing is reproduced or repaired. |
| K3 | **Agent behaviour on bad observations** (controlled injection) | `[singh2026scapegoats]` [C9] `[li2026silentprobe]` `[advani2026falsesuccess]` [C7] `[reddy2026gates]` [C8] `[zhu2026toolmaze]` `[yang2026overreliance]` `[patodiya2026postwire]` | Agents adopt plausible wrong values. Frameworks alter valid MCP results after the wire. | Remedies are agent-side. No recurrence metric. |
| K4 | **Post-execution outcome checks for the running agent** | `[panthi2026outcomemonitors]` [C11] `[toolgate]` `[verimcp]` `[agentcheck]` `[babu2026selfhealingorch]` | Observe + receipt is prior art. The ceiling is about 46% out-of-vocabulary detection [C11]. | No persisted repro. No change to the tool's code. |
| K5 | **Action-side policy / security enforcement** | `[agentspec]` `[contragent]` `[abc-contracts]` `[formal-rv-mfotl]` `[camel]` `[llamafirewall]` | Formal contract machinery | Orthogonal threat model |
| K6 | **Spec as oracle** | `[mcp-ts-sdk-client-validation]` `[contextforge-schema-guard]` `[prism-proxy]` `[oasdiff-breaking]` `[serbout2024semver]` `[xavier2017apibreak]` [C14] `[pujara2026deltamcp]` `[yamagishi2025dcfix]` | A free schema floor | Schema-valid wrong values [C4]. Behavioural breaks `[chen2026slr]` `[kong2025npm]`. |
| K7 | **Observed behaviour as oracle** (record/replay, differential, inferred invariants) | `[keploy]` `[tusk-drift]` `[diffy]` `[godefroid2020diff]` `[alonso2025agoraplus]` `[visa-tdcommons-2026]` `[monce2025gilesi]` `[nango-testing]` | Record/replay engineering. Snapshot diff is a contract-free oracle. | A recording made on the drifted version encodes the bug. Inferred = actual, not expected `[konstantinou-oracles-2024]`. |
| K8 | **Intent or LLM as oracle** | `[nl2postcond-2024]` `[e-otter-plus-plus]` `[issue2test]` `[galileo-tool-error]` `[langsmith-engine-docs]` | Out-of-vocabulary coverage | Judge validity (AUROC ≤ 0.65 on hidden state [C7]); non-determinism |
| K9 | **Machine-signal → coding agent → human-reviewed PR** (observability and APR products) | `[sentry-seer-issue-fix]` `[datadog-bits-dev-agent]` `[posthog-anatomy-pr]` `[langsmith-changelog-2026]` `[arize-signal-docs]` `[marginean2019sapfix]` `[maddila2025metaagent]` `[repairnator]` | The repair half and the never-merge policy are industrial practice | Triggers are errors, incidents or LLM scans. CI runs *after* the PR opens. Repro tests are optional. |
| K10 | **Tests as the repair oracle; plausibility critiques** | `[jimenez2023swebench]` `[mundler2024swtbench]` `[otter]` `[tdflow]` [C17] `[swe-doctor]` [C20] `[patchdiff]` `[impossiblebench]` `[tan2026coharden]` `[tayebati2026selfhealingharness]` | F→P/P→P vocabulary. **Laxity** is a measurable defect `[tan2026coharden]`. **Collateral regressions** of gate-rejected fixes `[tayebati2026selfhealingharness]`. | Inputs are issue prose. "Right reason" is LLM-judged. |
| K11 | **Production-driven self-healing** | `[durieux2016itzal]` `[perkins2009clearview]` `[novark2007exterminator]` **`[awan2026aegisflow]`** | Loop shape: production oracle → patch → validation → (deploy or developer) | AegisFlow deploys autonomously from snapshot validation, with no committed test and no PR `[ledger: prior-art §6]`. |
| K12 | **Provider policy and real drift** | `[github-breaking-changes]` `[stripe-changelog-2022-11-15]` `[yasmin2020deprecation]` `[pygithub-1745-2939]` `[litellm-23899]` `[yfinance-price-repair]` | Drift classes beyond D1–D5 | Time from onset to report is unknown |
| **K13** | **Data quality / data observability.** Batch checks on tables; statistical or learned thresholds; human closes the loop. | `[tfdv-2019]` `[polyzotis2018lifecycle]` `[breck2017mltestscore]` `[deequ-2018]` `[tu2023avh]` `[shankar2023brokendata]` `[gx-core-expectations]` `[dbt-data-tests]` `[odcs-quality]` `[evidently-drift-docs]` `[mc-five-pillars]` `[mc-agents-2026]` | fiks's invariant **vocabulary is standard** (range, not-null, unique, row count, freshness). Alert precision is defined as "leads to a fix" `[polyzotis2018lifecycle]`. | Batch, scheduled and history-hungry (Bigeye 21 d, Elementary 14 d `[bigeye-autothresholds]` `[elementary-volume]`). No read-after-write. No per-call comparison against the raw upstream. Remediation ends at a human or at a plan handed to a coding assistant via MCP `[mc-agents-2026]`. |
| **K14** | **Client-side adaptation to upstream API change** (library-centric) | `[dagenais2008semdiff]` `[reyes2024bump]` `[reyes2025byam]` `[fruntke2025depbreak]` `[zhou2026librarian]` `[reyes2026bigbag]` `[yang2026deprepair]` `[xia2026bdupdater]` `[mecheo2026dependafix]` [verify] `[luo2026updatefromhell]` `[hejderup2021trusttests]` `[fan2026skilldrift]` | Repairing the *client* repo after an upstream change is established, and the PR-opening bot exists (DependaFix). Structured evidence and localization drive repair success. | Triggers are compile errors, failing tests, version bumps or known change lists. Not one is a remote web API whose spec is unchanged and whose wrong values reach an agent. |
| **K15** | **Alert-triggered coding agents and post-fix confirmation** (2026 commercial) | `[devin-oncall]` `[devin-automations]` `[cursor-automations]` `[copilot-coding-agent]` `[azure-sre-agent-github]` `[sentry-coding-agents]` `[cleric-verifying-fixes]` `[cleric-product]` `[langsmith-changelog-2026]` | **Compositional threat**: any detector plus a webhook gives a "loop". Recurrence after a fix is now measured in production (Cleric 64% vs 22%). | No fail-first committed test. No pre-PR gate. No agent receipt. Azure SRE Agent can **merge**. |
| **K16** | **Attack surface of LLM repair loops** | `[greshake2023indirect]` `[debenedetti2024agentdojo]` `[liu2025aishelljack]` `[invariant2025githubmcp]` `[aikido2025promptpwnd]` `[sajadi2025patches]` `[nasr2025attackermovessecond]` `[beurerkellner2025patterns]` `[cve2024-3094-xz]` `[checkmarx2023fakedependabot]` | Concrete threat model and defences: Dual-LLM / strict format, sandbox with network isolation, human-approved CI | fiks feeds raw vendor bytes to a coding agent and executes the result. No literature on poisoning record/replay fixtures `[ledger: gap-repair-security §3]`. |
| **K17** | **Who merges bot and agent PRs** | `[ehsani2026failedagenticprs]` [C21] `[watanabe2025claudecodeprs]` [C22] `[wyrich2021botsdontmind]` `[he2023dependabot]` `[branco2026lgtm]` `[minh2026revieweffort]` `[strauss2026whywhen]` `[haque2026testsagenticprs]` `[zhang2021prdecisions]` `[wessel2021dontdisturb]` | Bot-PR prior band. Noise is the central cost. Self-merge inflates agent merge rates. | No study measures a third-party bot's fix PR that carries an F→P repro. |
| **K18** | **Evaluation statistics and seeded-fault validity** | `[chen2021codex]` `[miller2024errorbars]` `[bowyer2025clt]` `[zhu2025abc]` `[kapoor2025hal]` `[dietterich1998tests]` `[fagerland2013mcnemar]` `[brown2001binomial]` `[just2014mutants]` `[jahangirova2016oracle]` `[meiklejohn2021filibuster]` `[basiri2016chaos]` | The pre-registered analysis plan: Wilson / Bayesian intervals at small N, paired tests, trivial-agent baselines, oracle FP/FN assessment | Seeded invariant violations are exactly where mutation coupling is weakest `[just2014mutants]`. Service fault injectors do not model value corruption `[meiklejohn2021filibuster]` `[wiremock-faults]`. |

**Outliers, kept on purpose as counter-positions:**
- `[liu2026entropy]`: silent failure is structural, not a defect.
- `[bronder2026authority]`: tool results carry no special authority.
- `[catchbench]`: auditor scores depend on how labels are made.
- `[chen2023chatgptdrift]` `[gao2025modelequality]`: the *model API itself* drifts behind a stable name. The same problem shape as ours, but with a stochastic output, so only statistical detection applies.
- `[weng2026callsite]`: only 5.3% of LLM call sites satisfy their full contract. Contracts are routinely incomplete, even when hand-written.

---

## 2. Contradictions, diagnosed, with the experiment that resolves each

Round-1 rows X1–X15 still stand and are summarized; see the round-1 text in git history for the full diagnosis. New rows are X16–X28. The arrow (→) points to the hypothesis in §8 that settles each row.

| # | Contradiction | Diagnosis | Resolving experiment (→ §8) |
|---|---|---|---|
| X1 | Is schema validation enough? C4 says no; Outcome Monitors' schema-only ablation recovers +10.0 of +15.0 pts [ledger] | Fault population; spec strictness | Per-class recall, schema-only (strict Ajv) vs contracts, with a strict-spec ablation → H1 |
| X2 | LLM judges: human-level `[agentauditor]` or AUROC ≤ 0.65 [C7]? | Whether ground truth is observable | Judge with vs without raw upstream, against vendor-state labels → H3 |
| X3 | Fabrication 56.6% [C9] vs 12/41/12% `[li2026silentprobe]` | Denominator, realism, model | Code our trajectories under all three schemes → H13 |
| X4 | Silent worse than loud? `[zhu2026toolmaze]` vs `[wang2026agentnoisebench]` | Metric (wrong answer vs completion) | Report both per arm → H13 |
| X5 | Do repro tests help repair? 94.3 vs 68.0% [C17] vs limited gains [C20] | Guide = grader; test validity; test role | Held-out-oracle repair arms → H9, H10 |
| X6 | Benchmark 70–95% vs Meta 31.5% landed `[maddila2025metaagent]` | Metric and contamination | Blind review (κ) → H26 |
| X7 | Daikon-style invariants: 80% precise vs bug-blind | Metric and setting | Per-receipt FP on v1/v1b → H16 |
| X8 | How much drift is spec-visible? | Sampling frame | oasdiff on archived provider specs (G13) |
| X9 | Tool faults a minority of agent failures? | Assumption K1 | Organic violation rate → H5 |
| X10 | Gate vs advise | Failure model | Receipt vs block arm → H13 |
| X11 | Shadow traffic vs committed test (Itzal) | Deployment assumption | Itzal-like arm → H10 |
| X12 | Is an enum addition breaking? | Wire vs behavioural compatibility | D6 enum fall-through → H1/H3 |
| X13 | False success high in retail and airline, low in telecom | Domain | Per-domain report → H19 |
| X14 | Seer 94.5% root cause vs TRAIL 18% | Anchoring | No-anchor ablation → H9 |
| X15 | FP rates differ by ~100× | Denominator; generic vs per-tool properties | One primary denominator → H5 |
| **X16** | **Raw upstream evidence: help or harm?** DepRepair: raw evidence *lowers* repair by 7–23 pp; structured evidence helps `[yang2026deprepair]`. C19: the raw exchange is the ground-truth repro. | **Different objects.** DepRepair pastes raw prose and diffs into the prompt. fiks turns the raw exchange into a structured failing test. Also: DepRepair's evidence is release notes; fiks's is observed traffic. | Three arms with the same model: trace → test; raw trace in the prompt, no test; prose alert → H8 |
| **X17** | **Is F→P sufficient?** SWE-bench practice and fiks's F gate treat F→P as validity. Lax F→P tests give 0.0 repair gain vs +8.5 for rigorous ones `[tan2026coharden]` [ledger Table 1]. | The stated-reason gate addresses *wrong-reason* failures, not *laxity*. These are two different defects, and fiks has measured neither against mutation patches. | Mutation-patch laxity of F-gated vs F→P-only tests built from the same trace → H11 |
| **X18** | **Is recurrence after repair a new metric?** Round 1 said nobody reports it. Cleric reports 64% vs 22% of recurring clusters gone with vs without the fix `[cleric-verifying-fixes]`; Engine charts recurrence around merged PRs `[langsmith-changelog-2026]`. | **The catalog predated both.** Cleric's figure is observational, vendor-run, alert-level and has no CI. | Narrow the claim to *controlled, pre-registered, per-contract recurrence with CIs, across agents and models* → H12 |
| **X19** | **How much breakage is behavioural?** BUMP: 60 of 571 are assertion failures `[reyes2024bump]`. npm: 68.1% of BC commits with reason info are behavioural `[kong2025npm]`. 2005: over 80% of breaks are refactorings `[dig2005refactorings]` [verify]. | **Selection.** BUMP keeps only updates that visibly fail a Java build, so the silent class cannot appear in it by construction. Kong counts documented changes. | Cite BUMP's share as a property of compile-gated corpora, never as prevalence (M16) |
| **X20** | **Statistical / ML monitors vs deterministic rules.** Anomalo and AVH: rules have high precision but low recall `[tu2023avh]`. TFDV: a χ² test fired falsely 7 times in 10 `[tfdv-2019]` [ledger]; z-score/KS gave many FPs and were silenced at Meta `[shankar2023brokendata]`. | **Sample-size regime.** p-values shrink as n grows, so big batches make tests over-sensitive. fiks sees n = 1 call or one page, where distribution tests have little power. Vendor claims are unaudited. | Calls-to-detect and per-window FP: fiks vs AegisFlow-style KS/null/range detectors vs Evidently → H17 |
| **X21** | **Fix the code or the contract?** TFDV: the user "either fix[es] the data generation process or update[s] the schema", and the schema evolved in most of >700 pipelines [ledger]. fiks assumes a violation means the tool is wrong. | **A real gap in fiks's design.** Legitimate vendor evolution should yield a contract-update PR, not a code patch. | Benign evolution suite (new enum value, widened range, documented unit change) → H18 (fiks may lose) |
| **X22** | **Does the CLT suffice for intervals?** Miller: clustered SEs, large n `[miller2024errorbars]`. Bowyer: CLT and bootstrap under-cover at N = 3–100 `[bowyer2025clt]`. | **Regime.** fiks has 6 tasks and n = 5. | Primary: Wilson + hierarchical Beta-Binomial. Sensitivity: clustered SE and task bootstrap (§8 analysis plan) |
| **X23** | **Holm vs raw p-values.** ORCHESTRATION mandates correction. Arcuri & Briand warn Bonferroni-type adjustment hides results `[arcuri2014hitchhiker]`. | Confirmatory vs exploratory goals | A small confirmatory family under Holm; everything else exploratory with raw p and effect sizes |
| **X24** | **Agent PR merge rate.** 71.48% [C21] vs 79.89% `[strauss2026whywhen]` vs bot PRs 37.38% `[wyrich2021botsdontmind]` vs Meta 31.5% | **Denominator** (open PRs included or not). **Self-merge**: Codex is 65% of AIDev-pop; 28.3% of agent PRs merge instantly `[minh2026revieweffort]`; two repos account for 37.2% of PRs `[branco2026lgtm]`. **Bot type.** | Never present C21 as the expected acceptance of a fiks PR. Use the prior band 31.5–64% for fix PRs. Re-analyse C21 → H27 |
| **X25** | **Do tests in a PR raise acceptance?** Integrators *say* yes `[gousios2015integrators]`. Mining finds a weak or null effect `[haque2026testsagenticprs]` `[nachuma2026collabsignals]` `[zhang2021prdecisions]`. | **Stated vs revealed preference.** Confounding by size (test PRs are much larger). "Touches a test file" is not "contains an F→P repro". | Within-reviewer evidence ablation (same diff, with vs without the evidence block) → H26 |
| **X26** | **Do prompt-level injection defences work?** Spotlighting: >50% → <2% `[hines2024spotlighting]`. AgentDojo delimiters leave 41.65% `[debenedetti2024agentdojo]`. 12 defences bypassed at >90% by adaptive attacks `[nasr2025attackermovessecond]`. | **Static vs adaptive attacks**; task type; model | Claim only capability bounds as guarantees. Report static-attack results separately → H23, H24 |
| **X27** | **"Silent failure" means four different things**: stalls `[workato-acumen]`; distribution shift `[awan2026aegisflow]`; less data than claimed `[langsmith-changelog-2026]`; schema-valid wrong values [C3, C4] | Definitions | Align definitions in every coverage comparison. Put a definitions table in the paper (§9 novelty) |
| **X28** | **Dependency repair: 23–27% `[reyes2025byam]` `[fruntke2025depbreak]` vs 78–90% `[reyes2026bigbag]` `[yang2026deprepair]` `[xia2026bdupdater]`** | Subsets, oracles (compiles vs tests vs semantic equivalence), model generation, evidence given | Never compare fiks's 5/5 seeded repairs with these. Run fiks's repair stage on a shared external substrate → H28 |

---

## 3. Lineage of the central concepts

Each chain lists what each step **added**, and ends with what fiks adds and what it does not.

**L1. Runtime verification and data validation → agent outcome monitors → receipts.**
- Design by Contract `[eiffel-dbc]`; RV `[leucker-rv]` `[bartocci-rv]` [verify]; Daikon `[daikon]`; ClearView `[perkins2009clearview]`.
- **Parallel lineage in data systems.** The ML Test Score asks for schema invariants and warns that upstream "version upgrades … can radically change the feature's meaning" without strange values `[breck2017mltestscore]` [ledger]. TFDV `[tfdv-2019]`, Deequ `[deequ-2018]` and AVH `[tu2023avh]` inferred and enforced batch constraints. Products such as GX, dbt, Soda and ODCS standardized the vocabulary `[gx-core-expectations]` `[dbt-data-tests]` `[odcs-quality]`.
- 2025–26 agent work moved RV to the action side (`[agentspec]` `[contragent]`). A few systems check outputs: `[toolgate]`, `[verimcp]` (read-after-write for file/git/CI), and `[panthi2026outcomemonitors]` (mined contracts plus receipts, no repair [C11]).
- **fiks adds:** per-call evaluation at the agent–tool boundary, *before* the agent acts. It adds two kinds with no data-quality analogue that we found: `readAfterWrite` and `equalsUpstream`, which compares against the raw upstream exchange of the same call. The receipt goes to the agent.
- **Not new:** the invariant vocabulary (range, not-null, unique, row count, freshness), per-call output contracts, and receipts.

**L2. Contract testing and API evolution → behavioural drift with an unchanged spec → client-side repair.**
- Library-API breaking-change studies: `[xavier2017apibreak]` (27.99% of 501,645 changes break; per-library median 14.78%) [C14], `[venturini2023npm]` [C15], `[serbout2024semver]`, `[yasmin2020deprecation]`.
- Then spec diff `[oasdiff-breaking]` [C27], consumer-driven contracts `[pact-how-it-works]`, and differential regression testing with a fixed spec `[godefroid2020diff]`.
- Behavioural breaks are named the detection blind spot `[chen2026slr]` `[kong2025npm]`.
- Client adaptation:
  - Refactoring replay (`[dig2005refactorings]` [verify]).
  - Mined replacements `[dagenais2008semdiff]`.
  - Compile-triggered LLM repair `[reyes2025byam]` (27% of builds, 78% of errors).
  - Structured evidence `[yang2026deprepair]`.
  - Bot-to-PR `[mecheo2026dependafix]` [verify].
  - Hidden-test upgrade benchmarks `[luo2026updatefromhell]`: 61.8% of agent non-passes pass the visible tests [ledger].
  - Traffic-learned drift alerts `[visa-tdcommons-2026]`; interaction snapshots as an oracle `[monce2025gilesi]`.
- **fiks adds:** the trigger. A violation in *live agent traffic* against a **remote** API, with no version bump, no compile error and no failing visible test, because shop-mcp's tests replay v1 fixtures. The evidence is observed traffic, not release notes.
- **Not new:** repairing the client repo, opening the PR from a bot, and detecting silent drift from traffic.

**L3. Bug report → test reproduction → trace → test.**
- Crash reproduction `[bugredux]` `[evocrash]` `[botsing]`; HTTP record/replay `[vcr]` `[nock]` `[pollyjs]` `[keploy]`; recorded upstream responses as Vitest fixtures in a connector platform `[nango-testing]`.
- LLM issue-to-test: `[libro]` `[mundler2024swtbench]` `[otter]` `[e-otter-plus-plus]` `[reproagent]` `[multi-swt-bench]`.
- Validity critiques:
  - fails-on-buggy ≠ valid: 85% fail-on-buggy vs 28% plausible `[brt-agent-google]`;
  - **laxity**: F→P tests that admit mutation patches give no repair gain `[tan2026coharden]`;
  - joint test–fix failure under self-generated tests `[tan2026coharden]` [ledger: 19.9% vs 10.6% under independence].
- **fiks adds:** the oracle is the *named violated property*. "Fails for the stated reason" is therefore checked deterministically, with no golden patch. The test comes from the trace, not from the fix agent, which removes CoHarden's test–fix coupling by construction [Inference].
- **Not new:** record/replay fixtures, F→P, and repro tests in PRs (PostHog).
- **Untested:** laxity.

**L4. APR → gated agentic repair.**
- Overfitting `[qi-kali]` `[smith-overfitting]`.
- Industrial repair with human review `[marginean2019sapfix]` `[getafix]` `[repairnator]` `[passerine-google]` `[maddila2025metaagent]`.
- LLM agents `[agentless]` `[swe-agent]` `[openhands]`.
- Plausibility critiques `[patchdiff]` `[impossiblebench]`, and in 2026:
  - 55% of gate-rejected fixes improved the trigger but regressed a protected case `[tayebati2026selfhealingharness]`;
  - APR patches add vulnerabilities, more so with more autonomy `[sajadi2025patches]`.
- **fiks adds:** a gate stack that runs **before** the PR opens: F gate, P gate, full contract suite, all stored traces, typecheck/lint, and green CI on the exact commit. Tests and recordings are read-only to the agent.
- **Not new:** agentic repair, never-merge, CI iteration, and read-only tests (ImpossibleBench shows they block test edits but not special-casing).

**L5. Production-driven repair → loops with confirmation.**
- Exterminator `[novark2007exterminator]`, ClearView `[perkins2009clearview]`, Itzal `[durieux2016itzal]`, SapFix `[marginean2019sapfix]`.
- 2026 products:
  - observability → PR: Seer, Bits, PostHog, Engine;
  - alert → coding agent: `[devin-oncall]` `[cursor-automations]`;
  - fix plan handed to a coding assistant via MCP: `[mc-agents-2026]`;
  - fix PR plus verified recovery and recurrence statistics: `[cleric-verifying-fixes]`;
  - PR-merge markers on recurrence charts: `[langsmith-changelog-2026]`.
- **AegisFlow** `[awan2026aegisflow]` closes this loop for data pipelines: silent-drift watchdog → diff of failed vs successful upstream responses → LLM patch → snapshot gate (≥ 9/10) → auto-commit and blue-green deploy → 100-run monitoring.
  - Its evaluation is unverifiable: no code, and dates inconsistent (2016 vs 2026) [ledger].
- **fiks adds:**
  - a per-call deterministic trigger on a *successful* tool result;
  - a committed, fail-first, stated-reason test;
  - gates before a *PR*, never a deploy;
  - an agent receipt during the pending fix.
- **Not new:** the loop shape, post-fix confirmation, and recurrence measurement in production.

---

## 4. Methodology audit of the field (shared blind spots)

| # | Blind spot | Where it shows | Consequence for us |
|---|---|---|---|
| M1 | Tools assumed correct; faults injected at the observation layer | K1; ToolMaze and Outcome Monitors inject what the model sees. AgentChaos injects into the *model* API (†tan2026agentchaos corrected claim). | A benchmark where the **upstream changed and the tool did not** still does not exist. MCPEvol-Bench mutates the server source (†liu2026mcpevolbench, corrected). The vendor-api drift layer is a contribution. |
| M2 | Miner/injector alignment: detectors and faults come from the same authors | Outcome Monitors; fiks D1–D5 | Blind-authored suite. Third-party injector (Hoverfly Modify middleware written by someone who never sees the contracts) `[hoverfly-modes]` |
| M3 | Single trial / no pass^k | Most MCP benchmarks | pass^k with n = 2K trials per task, so per-task estimates are graded `[chen2021codex]` `[yao2024taubench]` |
| M4 | Plausible ≠ correct; graders = steering tests | `[tdflow]`; product PR claims | Held-out oracle, differential tests, blind review |
| M5 | No recurrence metric with CIs | Cleric is observational only | Controlled recurrence (H12) |
| M6 | No organic silent-fault rate | K2 | H5 |
| M7 | Unaudited vendor numbers | Seer 94.5%; Monte Carlo "80%+ fewer FPs" `[mc-agents-2026]`; AegisFlow 92% | Cite as vendor- or author-reported. Never benchmark against them. |
| M8 | Denominator drift | X3, X15, X24 | One pre-registered primary denominator per metric |
| M9 | Benchmark and preprint versions move | τ task fixes; AIDev v1→v5 `[aidev-hf]` | Pin SHAs, dataset versions and arXiv versions |
| M10 | Contamination | `[swe-bench-illusion]` | Stratify real bugs by fix date vs model cutoff |
| M11 | Single coder, no κ | real-bugs-mcp coding | Second coder |
| M12 | No CIs, CLT misuse at small N | `[bowyer2025clt]` | Wilson / Bayesian; clustered by task |
| M13 | Cost rarely reported | `[kapoor2024agentsmatter]` `[kapoor2025hal]` | Cost and tokens per trial and per repair |
| M14 | LLM-judged "right reason" | `[e-otter-plus-plus]` | Deterministic named-property gate (H7) |
| **M15** | **No trivial-agent baselines** (an empty-answer agent scores 38% on τ-bench impossible tasks) | `[zhu2025abc]` | Always-decline and always-trust agents in every phase (H13) |
| **M16** | **Compile-gated corpora** under-represent behavioural breaks by construction | BUMP, Byam (X19) | Never cite their shares as prevalence |
| **M17** | **Visible-test oracle inflation** | MigrationBench compile-only 71.67 → 97.67% `[liu2025migrationbench]` [ledger]; Update-from-Hell 61.8% `[luo2026updatefromhell]`; tests detect only 47% of injected dependency faults `[hejderup2021trusttests]` | Hidden post-drift tests the repair agent never sees (H10) |
| **M18** | **Merge-rate artifacts** (self-merge, open PRs in the denominator, few repos dominate) | X24 | Our own merges are author-merged ("same_user"). Never report them as acceptance. |
| **M19** | **No security oracle in APR evaluation** | `[sajadi2025patches]` `[chen2025securevibebench]` | SAST 2-of-3 on every fiks PR (H25) |
| **M20** | **Alert actionability unreported**: detection counted, fixes not | `[polyzotis2018lifecycle]` | Report the alert → repro → green PR → merged funnel |
| **M21** | **Seeded invariant faults are the class least coupled to mutants** (Just: "violation of pre/post conditions or invariants" is among the uncoupled classes) | `[just2014mutants]` [ledger Table 4] | Representativeness by triangulation: provenance, a predeclared operator set, coupling to real bugs, blind suite (H6, H14) |
| **Self-audit (fiks today)** | 1 server, 1 mock vendor, 5 author-seeded drifts, author contracts, 6 tasks × k = 5, one model family. Headline pass^5 5/6 vs 3/6 tasks: at most 2 discordant tasks, so **no task-level paired test can reach p < .05** [ledger: gap-eval-methodology §6, our arithmetic]. 0 FP in 30 v1 trials bounds per-trial FP only at ≈ 11% (Wilson upper). Raw vendor bodies enter the repair prompt (`clip(body, 800)`), agent code runs unsandboxed with `process.env`, and push-triggered CI runs before human review [Inference from code, to be confirmed by the codebase-map owner]. Bench PRs were merged by the assistant without line-by-line review (README). | | Every row above applies to us. Cut claims before cutting verification. |

---

## 5. Competitor feature matrix

**Columns** follow the fiks loop:

| Abbrev. | Column |
|---|---|
| **Sem** | semantic check of a *successful* result |
| **Sch** | schema check |
| **Rcpt** | verdict returned to the running agent |
| **Trace** | trace capture *with the raw upstream* exchange |
| **Repro** | committed reproduction test generated |
| **F** | the test must fail first, for the stated reason |
| **Fix** | automated *source* repair |
| **Gates** | suite + stored traces + CI green **before** the PR |
| **PR** | opens a PR; a human merges |
| **Conf** | confirmation after merge |
| **Inf** | contract or invariant inference |
| **Local** | runnable locally as a baseline |

**Cell values:**
- **Y**: documented.
- **P**: partial, or a different form.
- **N**: not done or not described. An absence in docs is not proof.
- **?**: docs are silent. Never present `?` as N.
- **†**: the row rests on a dropped or pending source.

### 5a. fiks and the products closest to it (observability/alert → coding agent → PR)

| System `[key]` | Sem | Sch | Rcpt | Trace | Repro | F | Fix | Gates | PR | Conf | Inf | Local | Note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **fiks** (this paper) | Y (per call: invariants, units, freshness, read-after-write, equalsUpstream) | Y | Y (`_meta` + text block) | Y | Y | Y (deterministic, named property) | Y | Y | Y (never merges) | Y (replay + live) | N (hand-written; planned) | Y | 1 server, seeded drifts |
| LangSmith Engine `[langsmith-engine-docs]` `[langsmith-changelog-2026]` | P (LLM scan; reads successful tool results since Sep 2026) | N | N | P (agent traces) | N | P (Oct 2026: model-judged replay of source runs against the fix preview) | Y (agent code) | N (CI iterated after the PR) | Y | **Y** (Oct 2026: PR-merge markers on recurrence charts; reopens issues) | P (generates online evaluators) | N | Closest commercial loop; it repairs the *agent*, not the tool |
| Cleric `[cleric-product]` `[cleric-verifying-fixes]` | P (per-change metric expectations) | N | N | P | N | N | Y | ? | Y | **Y** (verifier agent; 64% vs 22% recurring clusters gone) | P (LLM-written checks) | N | Observational, vendor-run, no CIs |
| PostHog Self-driving `[posthog-self-driving]` `[posthog-anatomy-pr]` | N (errors, replays, tickets) | N | N | P | **Y** (regression test reproducing the failure) | ? | Y | N (CI after opening) | Y | ? | N | N | Prior art for "repro test in the PR" |
| Sentry Seer → coding agents `[sentry-seer-issue-fix]` `[sentry-coding-agents]` | N (errors) | N | N | P | P (on request) | N | Y | N | Y | N | N | N | Root-cause analysis handed to Claude, Cursor or Copilot |
| Datadog Bits `[datadog-bits-dev-agent]` | N | N | N | P | P | ? | Y | N (iterates until build passes) | Y | N | N | N | |
| Arize Signal `[arize-signal-docs]` | P (LLM scan) | N | N | P | N | N | Y | ? | Y | ? | N | N | |
| Devin Oncall / Automations `[devin-oncall]` `[devin-automations]` | N (alerts, incidents, any webhook) | N | N | P | P ("reproducing the issue"; form unstated) | ? | Y | ? | Y | P (reports PRs opened/merged) | N | N | **Composition host**: any detector → webhook |
| Cursor Automations / cloud agents `[cursor-automations]` `[cursor-cloud-agents]` | N | N | N | N | N | N | Y | P (agents build/test) | Y | N | N | N | Same |
| Copilot coding agent `[copilot-coding-agent]` `[github2025copilotagentrisks]` | N (issue) | N | N | N | N | N | Y | P (tests + linters in an ephemeral environment; human-approved Actions) | Y (cannot self-merge) | N | N | N | Security controls fiks should match |
| Azure SRE Agent `[azure-sre-agent-overview]` `[azure-sre-agent-github]` | N (alerts) | N | N | P | N | N | P (operational) | P (approval modes) | P (**can merge**) | P | N | N | |
| Monte Carlo agents `[mc-agents-2026]` | P (learned table monitors) | P | N | N | N | N | P (fix *plan* pulled by the user's coding assistant via MCP) | N | ? | N | P | N | "agents never manipulate data or systems" |
| Composio `[composio-mcp-gateway]` | N (HTTP 400 example) | N | N | N | N | N | P (vendor-side toolkit patch) | ? | N | ? | ? | N | Mechanism undocumented |
| ADAPTIX `[adaptix-self-healing-registry]` | N (shape only) | Y (live-schema diff) | N | P | N | N | P (tool-definition version) | P (verify + rollback) | N (autonomous) | P | P | Y | Hackathon prototype |
| MCP-Healer `[mcp-healer]` | N (successful results pass through) | P (input side) | N | N | N | N | P (runtime rewrite of the input payload) | N | N | N | N | Y (MIT) | Re-checked by the synthesizer only |
| self-healing-api-agent / ApiPatch `[self-healing-api-agent]` `[apipatch]` | N | P (spec diff) / N | N | N | N | N | Y | N | P / Y | N | N | Y | [C27] |
| Tusk Drift `[tusk-drift]` / Keploy `[keploy]` | N (deviation from a recording) | N | N | Y | Y (replayed traces) | N | P / N | P / N | N | N | N | P / **Y** | Opposite setting: dependency fixed, code changes |
| Nango `[nango-testing]` | N | Y (`--validate`) | N | P (recorded responses) | P (mocks + snapshots, developer-run) | N | N | N | N | N | N | ? | Recorded upstream → Vitest fixtures |
| Arcade `[arcade-hooks]` `[arcade-tool-executions]` | P (hook only) | N | P (modify result) | P (inputs/outputs, not raw upstream) | N | N | N | N | N | N | N | N | |
| Workato Acumen `[workato-acumen]` | P (stalls only) | P | N | P | N | N | N | N | N | N | P | N | "Silent failure" = stall |
| PagerDuty agents `[pagerduty-ai-agents]` | N | N | N | P | N | N | P (operational) | P | N | ? | N | N | |

Excluded or †:
- GitHub Copilot Autofix: †github-copilot-autofix-docs, dropped and pending.
- Stainless BCD: †stainless-bcd. Its corrected claim is provider-side CI breaking-change flags.
- Sift: dropped.
- Patronus: NOT_FOUND.
- incident.io and Speedscale: pending.

### 5b. Gateways, proxies, spec and schema tools

| System `[key]` | Sem | Sch | Rcpt | Trace | Repro | F | Fix | Gates | PR | Conf | Inf | Local |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MCP TS/Python SDK clients `[mcp-ts-sdk-client-validation]` `[mcp-python-sdk-client-validation]` | N | **Y** | P (exception) | N | N | N | N | N | N | N | N | **Y** (schema floor) |
| IBM ContextForge `[contextforge-schema-guard]` `[contextforge-plugins]` | P (plugins) | Y | P (annotate/block) | N | N | N | N (json_repair rewrites payload) | N | N | N | N | **Y** |
| Docker MCP Gateway `[docker-mcp-gateway-interceptors]` | P (after-interceptor hook) | N | P | P | N | N | N | N | N | N | N | **Y** |
| Kong / Azure APIM / AgentCore / Cloudflare `[kong-ai-mcp-proxy]` `[azure-apim-validate-content]` `[aws-agentcore-interceptors]` `[cloudflare-mcp-portals]` | N / N / P (hook) / N | N / P / N / N | N / N / P / P | P | N | N | N | N | N | N | N | N |
| Enkrypt `[enkrypt-secure-mcp-gateway]` | P (LLM judge) | N | P | P | N | N | N | N | N | N | N | P |
| Invariant guardrails `[invariant-guardrails]` | P (user rules) | N | P | P | N | N | N | N | N | N | N | Y |
| ALTK Silent Review `[altk-silent-review]` | P (LLM judge) | N | P | N | N | N | N | N | N | N | N | **Y** (LLM-judge baseline) |
| Langfuse / Phoenix / Opik `[langfuse-datasets]` `[phoenix-datasets-from-traces]` `[opik-online-rules]` | P (judges/scores) | N | N | P | N (dataset items) | N | N | N | N | N | N | Y |
| oasdiff / openapi-diff `[oasdiff-breaking]` `[openapitools-openapi-diff]` | N | P (spec vs spec) | N | N | N | N | N | N | N | N | N | Y (0 findings by construction) |
| Prism `[prism-proxy]` | N | Y (live traffic vs spec) | N | N | N | N | N | N | N | N | N | Y |
| Schemathesis `[hatfielddodds2022schemathesis]` / Pact `[pact-how-it-works]` | P | Y / P | N | N | P | N | N | N | N | N | N | Y |
| Hoverfly Diff `[hoverfly-modes]` | P (deviation from recorded simulation) | N | N | Y | N | N | N | N | N | N | N | Y [licence verify] |
| Beeceptor / Optic / Visa 10178 `[beeceptor-drift]` `[optic-repo]` `[visa-tdcommons-2026]` | N / N / Y (learned invariants) | Y / Y / ? | N | P | N / N / ? [body unread] | N / N / ? | P (spec patch) / N / ? | N | N | N | P / P / Y | N / Y / N |

### 5c. Data quality and observability (new in round 2)

| System `[key]` | Sem | Sch | Rcpt | Trace | Repro | F | Fix | Gates | PR | Conf | Inf | Local | Note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Great Expectations `[gx-core-expectations]` `[gx-v1-profilers-removed]` | P (batch rules: between, not-null, row count) | Y (JSON schema expectation) | N | N | N | N | N | N | N | N | P (profilers removed in V1) | **Y** (Apache-2.0) | Vocabulary baseline (H16) |
| dbt tests / contracts / freshness `[dbt-data-tests]` `[dbt-model-contracts]` `[dbt-source-freshness]` | P | Y (build-time structure) | N | N | N | N | N | N | N | N | N | Y | |
| Soda `[soda-freshness]` `[soda-anomaly]` `[soda-core-repo]` | P | P | N | N | N | N | N | N | N | N | P (Cloud anomaly needs ≥ 4 scans) | P (ELv2) | |
| ODCS + datacontract-cli `[odcs-quality]` `[datacontract-cli]` | P | Y | N | N | N | N | N | N | N | N | N | **Y** (MIT) | `breaking` diff: expect no fire |
| Deequ `[deequ-2018]` / TFDV `[tfdv-2019]` | P | Y (inferred) | N | N | N | N | N | N | N | N | **Y** (suggestions "assume the data is correct" `[deequ-aws-blog-2019]`) | Y | Humans fix the code or update the schema |
| AVH `[tu2023avh]` | P (single-column metrics) | N | N | N | N | N | N | N | N | N | **Y** (FPR budget) | reimplement | Clean-history assumption |
| Evidently / whylogs `[evidently-drift-docs]` `[whylogs-repo]` | P (windowed two-sample tests) | N | N | N | N | N | N | N | N | N | P (reference window) | **Y** (Apache-2.0) | Defaults ignore null increases |
| Bigeye / Elementary / Anomalo `[bigeye-autothresholds]` `[elementary-volume]` | P (learned thresholds, 14–21 d history) | P | N | N | N | N | N | N | N | N | Y | N / Y / N | |

### 5d. Research systems

| System `[key]` | Sem | Sch | Rcpt | Trace | Repro | F | Fix | Gates | PR | Conf | Inf | Local | Note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Outcome Monitors `[panthi2026outcomemonitors]` [C11] | **Y** | P | **Y** | N | N | N | N (non-goal) | N | N | N | **Y** | P (reimplement) | Closest research prior for Observe + receipt |
| **AegisFlow** `[awan2026aegisflow]` | Y (batch-statistical: KS, null rate, ranges) | Y | N | P (diff of failed vs successful responses) | N (10 snapshots, nothing committed) | N | Y | P (≥ 9/10 snapshot invariants + minimal CI before deploy) | **N** (auto-commit + blue-green deploy) | Y (next 100 runs, rollback) | P (bounds from history) | N (no code) | Nearest loop; evaluation unverifiable |
| ToolGate `[toolgate]` | P | Y | P (discard + backtrack) | N | N | N | N | N | N | N | N | N | |
| verimcp `[verimcp]` | Y (read-after-write: file/git/CI) | N | Y | P | N | N | N | N | N | N | N | Y (MIT) | |
| Executable-contract audit `[bellibatlu2026contractaudit]` | Y (advertised-surface contracts, incl. phantom writes) | P | N | N ("lacks a recorded-real-calls component") | P (reproductions sent upstream) | ? | P (one-hunk patches for 2 defects) | N | N (issues) | N | N | **Y** (MIT, Zenodo) | Baseline checker + real-bug source |
| SkillGuard `[fan2026skilldrift]` | P (environment contracts from skill text) | N | N | N | N | N | Y (skill *document*) | P (literal verifier) | N | N | **Y** (LLM-extracted) | Y [verify availability] | 0/599 false alarms; behavioural drift out of scope [ledger] |
| Self-healing orchestrator `[babu2026selfhealingorch]` | P | N | P (in-loop recovery) | P | N | N | N (runtime) | N | N | N | N | ? | Per-episode, not recurrence |
| DeltaMCP `[pujara2026deltamcp]` / dcFix `[yamagishi2025dcfix]` | N | P (spec diff / spec conformance) | N | N | N | N | Y | ? | N | N | N | ? | Spec-triggered |
| Byam `[reyes2025byam]` / DependaFix `[mecheo2026dependafix]` [verify] | N (compile error / failing dependency-PR CI) | N | N | N | N | N | Y | P (build) | N / Y [verify] | N | N | P | Client repair after a version bump |
| DepRepair `[yang2026deprepair]` | N | N | N | N | N | N | Y | P (consumer tests) | N | N | N | N | Raw evidence −7 to −23 pp |
| †BBCFixer (†chen2026bbcfixer; re-verify) | N (failing client test) | N | N | P (differential execution old vs new library) | given | n/a | Y | P (reference-fix tests) | N | N | N | ? | Interface-preserving breaks; 58.0 vs 49.7 pure agent (corrected claim) |
| Gilesi `[monce2025gilesi]` | P (snapshot diff) | N | N | P (client↔library interactions) | N | N | N | N | N | N | N (contract-free) | P (Java) | H4/H-CA6 snapshot-diff baseline |
| AGORA+ / Beet `[alonso2025agoraplus]` `[beet-repo]` | Y (REST invariants, offline) | N | N | P | P | N | N | N | N | N | **Y** | Y (GPL-3.0) | Inference baseline |
| Godefroid differential `[godefroid2020diff]` | P | N | N | P | N | N | N | N | N | N | N | reimplement | |
| Itzal `[durieux2016itzal]` | P | P | N | P | N (by design) | P | Y | P (shadow traffic) | P | N | N | N | Closest pre-LLM research loop |
| ClearView / SapFix `[perkins2009clearview]` `[marginean2019sapfix]` | P / N | N | N | N / P | N / Y | N / P | P / Y | P | N / Y | P / N | Y / N | N | |
| Meta agent / Repairnator `[maddila2025metaagent]` `[repairnator]` | N (failing test / CI) | N | N | N | given | n/a | Y | P | Y | N | N | N / P | |
| Agentless / SWE-agent / OpenHands `[agentless]` `[swe-agent]` `[openhands]` | N | N | N | N | P | P | Y | P | N | N | N | Y | Ungated arm |
| e-Otter++ / Issue2Test / ReProAgent `[e-otter-plus-plus]` `[issue2test]` `[reproagent]` | N | N | N | N | Y (from prose) | P (LLM critic) | N | N | N | N | N | P | Repro-from-prose baseline |
| AgentCheck `[agentcheck]` / ContrAgent `[contragent]` | P | N | N / P | Y / P | P / N | N | N | N | N | P / N | N / Y | ? / Y | |

**Reading.**
- In this verified, recall-limited catalog, **no row other than fiks has Sem-per-call-on-a-successful-result + Repro + F + pre-PR Gates**.
- The nearest neighbours each cover a different subset:
  - **AegisFlow:** Sem (batch) + Fix + Conf, autonomous deploy.
  - **Engine and Cleric:** Fix + PR + Conf, with an LLM or metric trigger.
  - **PostHog:** Repro + PR, error trigger.
  - **Outcome Monitors:** Sem + Rcpt + Inf.
  - **Executable-contract audit:** Sem + partial repro.
- The **Conf** column is no longer unique to fiks: Engine, Cleric and AegisFlow have it.
- The **Inf** column is a fiks weakness against Outcome Monitors, SkillGuard, AVH, Deequ/TFDV, AGORA+ and Visa.
- The **composition** "Outcome-Monitor-style checker → webhook → Devin/Cursor → PR → CI after" can be assembled today from documented parts. It must be run as a baseline (H9), not argued away.

**Runnable baseline set** (licence-clean, local):
- schema floor (MCP SDK, Ajv strict), ContextForge, Docker after-interceptor;
- Invariant rules, ALTK Silent Review, our LLM judge (± upstream);
- Keploy / nock record, Hoverfly Diff, Gilesi-style snapshot diff (reimplemented in TS over the existing tap), Diffy-style differential;
- oasdiff/openapi-diff, Prism, Schemathesis;
- GX + in-house v1 profiler, Evidently, datacontract-cli, AVH-style FPR-budget selection, AegisFlow-style KS/null/range detector and snapshot validator (all reimplemented);
- AGORA+/Beet, an Outcome-Monitor reimplementation, the executable-contract checker;
- Agentless / SWE-agent / OpenHands / mini-swe-agent on forks;
- reimplemented arms: error-triggered, Engine-like, PostHog-like, Itzal-like, detection-only, **composition (alert → coding agent → PR → CI after)**, live-integration-test trigger, dependency-bump trigger.

---

## 6. Benchmark shortlist (ranked by fit × cost)

Fit and cost are each scored 1–5, with cost 5 = cheapest. Rank = product.

| Rank | Benchmark `[key]` | Fit | Cost | F×C | What fiks result it lets us claim | Main caveat |
|---|---|---|---|---|---|---|
| 1 | **DriftBench v2 (ours)**: vendor-api + shop-mcp with S1–S12 and D6–D9, a **blind-authored** suite (third-party Hoverfly-Modify middleware), **benign v1b** (legitimate evolution: new enum value, widened range, documented unit change with a new field), and ≥ 25 tasks with n = 2K trials | 5 | 5 | 25 | Per-class detection vs every baseline; F-gate validity and laxity; gated vs composition repair; recurrence; contract-update vs code-fix behaviour | Author-built (M2). Needs the blind suite and real bugs to be credible. |
| 2 | **Offline replay over logged calls** (200 calls, 76 violated [ledger: codebase-map §3]), extended with v1b and the mutation suite | 4 | 5 | 20 | Detection precision/recall and calls-to-detect per monitor, at near-zero cost, deterministic under replay (H21) | Labels must come from vendor state, not fiks verdicts |
| 3 | **Response-mutation oracle-adequacy suite**: predeclared operators over recorded v1 upstream JSON (×100, ÷100, rename, drop, null, truncate/paginate, type swap, epoch↔ISO, enum injection, string perturbation), written before contracts are frozen | 4 | 5 | 20 | Jahangirova-style FN rate per operator `[jahangirova2016oracle]`; honest vocabulary limit (H6) | Operators are still ours. Coupling to real bugs is tested separately (H14). |
| 4 | **Adversarial-trace security suite**: AgentDojo / InjecAgent payloads in vendor response fields `[debenedetti2024agentdojo]` `[zhan2024injecagent]` + AIShellJack-style source-embedding goals `[liu2025aishelljack]` + canary secret | 4 | 4 | 16 | Capability containment, malicious-diff rate, exfiltration (H23–H25) | Forks only. Adaptive attacks are reported separately. |
| 5 | **τ²-bench retail + airline with a drift layer**, plus the C11 τ-retail protocol `[barres2025tau2]` `[yao2024taubench]` | 5 | 3 | 15 | Transfer; replication-style comparison with Outcome Monitors; native pass^k | Adapter work; pin task-set version. Note τ² `cancel_reservation` is itself a reported tool defect `[bellibatlu2026contractaudit]`. |
| 6 | **Real API drift replay set** (PyGithub, github-mcp-server fixtures, litellm, python-gitlab) | 4 | 3 | 12 | Contract vocabulary on real provider drift | Mostly Python |
| 7 | **Executable-contract audit artifact** `[bellibatlu2026contractaudit]` (MIT, Zenodo) | 3 | 4 | 12 | Advertised-surface checker as a baseline on shop-mcp; real tool-defect candidates in τ² and AgentDojo | Static + probe, with no recorded calls |
| 8 | **StableToolBench cache** `[guo2024stabletoolbench]` | 3 | 4 | 12 | Organic clean-traffic FP | Licence [verify] |
| 9 | **AIDev-pop re-analysis** `[aidev-hf]` (CC-BY-4.0) | 3 | 4 | 12 | Whether C21's CI association survives controls (H27). Corrects the paper's motivation claim. | Check-run data needs read-only GitHub API calls |
| 10 | **Real-bug harness (forks)**: §7 | 5 | 2 | 10 | Detection on faults we did not design; F→P agreement with human fixes; trace vs issue-text repair | 14–30 h per TS server; ~40% survival expected |
| 11 | **BBCBench JS cases** (59) via †chen2026bbcfixer | 3 | 3 | 9 | fiks's repair stage on a shared external behavioural substrate (H28) | Source dropped pending re-verification; licence [verify] |
| 12 | AppWorld `[trivedi2024appworld]` | 3 | 3 | 9 | Second deterministic substrate (C7, C11 use it) | Licence [verify] |
| 13 | MCPMark local subset `[wu2025mcpmark]` | 4 | 2 | 8 | Organic silent-violation rate | About $600 at k = 4 [ledger estimate] |
| 14 | SWT-bench Lite / Multi-SWT TS `[mundler2024swtbench]` `[multi-swt-bench]` | 3 | 2 | 6 | Calibrates the repro-from-prose baseline | 120 GB Docker |
| 15 | MCP-Atlas public split `[bandi2026mcpatlas]` | 3 | 2 | 6 | Clean FP across 36 real servers | Judge cost |
| 16 | MCP-Universe `[luo2025mcpuniverse]` | 3 | 1 | 3 | Real upstream drift over weeks | Keys; writes only under vats98754 |
| — | †MCPEvol-Bench (dropped; corrected claim: 11 mutation operators on server *source*, −13.7/−14.4% LLM-judged fulfilment) | 3 | ? | — | Contrast case: interface evolution vs upstream drift | Release not stated; re-verify |
| — | DepBench-203 (`[luo2026updatefromhell]`) | 3 | – | — | Hidden-test design to copy | Not released [verify] |
| — | BUMP / Compsuite `[reyes2024bump]` `[xu2023compsuite]` | 2 | 1 | 2 | Java behavioural subset (60 assertion cases) | Java gate cost; mostly compile breaks |
| — | ToolMaze, BFCL, CodeUpdateArena, GitChameleon, … | 1–2 | – | – | Related work only | Call side or compile time |

**Recommended minimum credible set:** 1 + 2 + 3 (mechanisms, deterministic and cheap); 4 (security, required by K16); 5 (external substrate); 10, wave 1 (real bugs); 8 or 13 (organic FP). Item 9 is cheap and protects the motivation section.

---

## 7. Real-bug shortlist (top 25)

**Selection rule:**
- repro_score 3, or for API candidates: client issue + fix + offline replay;
- offline-mockable;
- merged human fix preferred, so that F→P agreement can be measured;
- maximize diversity of fault class, repo and language.

**Round-2 changes:**
- R10 is now the reference **memory server #4887** (`[mcp-memory-4887]`: verified, 47 of 130 agent runs silently dropped observations; TypeScript, local fixture).
- cloudflare #418 is demoted to a contrast reserve: it returns loud Zod error text.

**Round-1 verifier adjustments still apply:**
- awslabs #4692 is latent, and #4774 has a description-only fix: both are reserves.
- github-mcp-server #3417 was loud: excluded.
- grafana #807 is a loose D5 analogue.
- The toolbox repo is now `googleapis/mcp-toolbox`.

All `prefix_sha` values and URLs are in the candidate files.

| # | Repo · issue (fix) | Lang | Class | Blind contract property (write before reading the fix) | Fix state | Source key |
|---|---|---|---|---|---|---|
| R1 | github/github-mcp-server #3160 (PR #3195) | Go | S3 lost write / false success (D3) | read-after-write: requested labels ⊆ returned labels | merged | `[ghmcp-3160-3195]` |
| R2 | github/github-mcp-server #2347 (PR #2367) | Go | S4 truncation (D4) | len(items) == total, or a next-page signal is present | merged | `[ghmcp-2347-2367]` |
| R3 | github/github-mcp-server #3190 (PR #3193) | Go | S2 dropped field | equalsUpstream: non-null upstream `start_line` is preserved | merged | candidates |
| R4 | github/github-mcp-server #3467 (PR #3468) | Go | S2 default-on-missing | merged_at ≠ null ⇒ merged = true | open | candidates |
| R5 | github/github-mcp-server #3097 (PR #3098) | Go | Corruption (double base64) | decoded blob sha == git blob sha | merged | candidates |
| R6 | sooperset/mcp-atlassian #1500 (PR #1518) | Python | S3 lost write | read-after-write: parent == requested | merged | candidates (single instance) |
| R7 | sooperset/mcp-atlassian #333 (PR #360) | Python | D9 identity (count) | total ≥ len(issues) ∧ total ≠ limit | merged | candidates |
| R8 | sooperset/mcp-atlassian #1652 (PR #1673) | Python | S6/S8 swallowed error → silent empty | nonEmpty for a known-good input | open | `[atlassian-1652]` |
| R9 | cloudflare/mcp-server-cloudflare #468 (PR #469) | TS | Serialization corruption (`[object Object]`) | text block parses as JSON / matches outputSchema | open | candidates |
| **R10** | **modelcontextprotocol/servers #4887 (PR #5008)** | **TS** | **S3 lost write / false success (memory.create_entities)** | **read-after-write: every submitted observation is present after the write** | **merged** | **`[mcp-memory-4887]`** |
| R11 | korotovsky/slack-mcp-server #101 (PR #106) | Go | S4 cursor missing | next cursor present when has_more | merged | candidates |
| R12 | korotovsky/slack-mcp-server #203 (PR #174) | Go | S11 filter drops records | count(output) == count(upstream in scope) | merged | candidates |
| R13 | awslabs/mcp #4639 | Python | S4 truncation, nextToken omitted | nextToken forwarded ∨ len < max_results | merged | candidates |
| R14 | getsentry/sentry-mcp #1319 | TS | S4 25-item cap | Link rel=next followed or surfaced | merged | candidates (FSL-1.1: confirm fork use) |
| R15 | grafana/mcp-grafana #1110 (PR #1111) | Go | S7 ignored argument | every returned rule satisfies the matcher | merged | candidates |
| R16 | grafana/mcp-grafana #963 (PR #968) | Go | **Upstream-version drift** (empty UIDs on Grafana 9.4.3) | notNull(uid) | merged | candidates |
| R17 | grafana/mcp-grafana #807 (PR #808) | Go | S5 format (loose D5) | deeplink time range == requested range | merged | `[grafana-807]` |
| R18 | hashicorp/terraform-mcp-server #270 (PR #275) | Go | S6 silent empty (serialization) | nonEmpty / `data.type` ≠ "" | merged | `[tf-270]` (MPL-2.0) |
| R19 | mongodb-js/mongodb-mcp-server #561 | TS | D9 identity (count = string length) | reported count == rows | merged | `[mongodb-561]` |
| R20 | GLips/Figma-Context-MCP #364 (PR #367) | TS | S3 false success (no file written) | postcondition: file exists, size > 0 | merged | candidates |
| R21 | PyGithub #1745 → PR #2939 | Python | S4 cap inside an object (300 files) | follow Link rel=next; files == commit stats | merged | `[pygithub-1745-2939]` |
| R22 | BerriAI/litellm #23793 → PR #23899 | Python | D6 enum fall-through (`refusal` → "stop") | closed-world enum; unknown ⇒ violated | merged | `[litellm-23899]` |
| R23 | BerriAI/litellm #9812 → PR #9838 | Python | D1/D9 accounting (cache tokens double-counted) | prompt = input + cache_read + cache_creation | merged | `[litellm-9812]` |
| R24 | python-gitlab #1686 | Python | S4 pagination metadata omitted above 10k | total present or explicitly unknown | merged | `[python-gitlab-1686]` |
| R25 | ranaroussi/yfinance price repair (PR #2907) | Python | **Real D1 unit drift** (100×; $/cents, £/pence) | per-entity magnitude stability | merged | `[yfinance-price-repair]` |

**Reserves:**
- servers #4628 (filesystem destructive write), #3137 (memory open_nodes empty relations), #4991, #735;
- mcp-atlassian #1409, #1752;
- googleapis/mcp-toolbox #4032 (open partial write);
- awslabs #4720, #4692 (latent);
- microsoft/mcp #3840 (C#);
- litellm #18750;
- github-mcp-server #2596/#2600;
- awslabs #4774 (description-only fix);
- cloudflare #418 (contrast: schema strictness *causes* the failure);
- **benchmark-tool defects** from `[bellibatlu2026contractaudit]`: τ²-bench `cancel_reservation` never releases seats, and MedAgentBench POST reports success but never writes. Issue URLs [verify]. Python, forks only.

**Reproduction plan** (forks under vats98754 only; never post upstream):
1. **Fork and pin.** Check out `prefix_sha` and record the human fix SHA.
   - Licences: MPL stays MPL. FSL-1.1 sentry-mcp needs a check. LGPL for PyGithub and python-gitlab.
2. **Blind contract.** An author who has not read the fix writes the property from the symptom only. Log author and time.
3. **Upstream route.**
   - Process-level replay over MCP stdio with a base-URL override and the fiks tap. HTTPS upstreams need a shim.
   - Fixture provenance is labelled recorded vs synthesized, per bug.
4. **Detect** on `prefix_sha` and on `fix_sha`. A fire on the fix counts as an FP.
5. **F gate on prefix, P on the human fix.** Run 10 offline reruns for determinism. Measure **laxity**: N LLM mutation patches of the human fix; laxity = share that pass the repro but fail the human fix's tests `[tan2026coharden]`.
6. **Repair.** Same model and budget, four inputs:
   - (a) fiks trace + frozen repro;
   - (b) raw trace in the prompt, no test;
   - (c) issue text only;
   - (d) composition baseline: prose alert → coding agent → PR → CI after.

   Grade by the human fix's tests plus the prior suite (held out), PatchDiff-style differential tests, blind review, and SAST 2-of-3 `[sajadi2025patches]`. Open bugs (R4, R8, R9) are graded by held-out manifestations only.
7. **Duplicate / already-fixed check** before any PR, as Meta's top rejection reason was "already fixed" `[maddila2025metaagent]` [ledger]. Report the hit rate.
8. **Security.** Run the repair agent and `pnpm test` / `go test` / `pytest` in an OS sandbox with no network and a scrubbed env. Third-party fork CI runs only after human approval.
9. **Contamination.** Stratify by fix date vs the model cutoff.
10. **Attrition funnel.** Each candidate is reproduced / unreproducible (reason) / harness-blocked (reason).

**Waves:**
- Wave 1 (TS): R9, R10, R14, R19, R20, plus reserves #4628 and #3137.
- Wave 2 (Go): R1–R5, R11, R12, R15–R18.
- Wave 3 (Python, pytest harness): R6–R8, R13, R21–R25 and the τ² defect.

**Expected yield:** about 10–15 reproducible entries from 25 [Inference; based on the GitBug-Java funnel, †silva2024gitbugjava, re-verify].

---
## 8. Research questions and hypotheses

**Research questions.**
- **RQ1 (Detect).** Do outcome contracts catch silent tool faults that the following miss, at a clean FP rate operators accept?
  - schema validation, spec diff, error triggers and dependency-bump/compile triggers;
  - recorded-response and snapshot oracles;
  - statistical data-quality monitors;
  - LLM judges.
- **RQ2 (Reproduce).** Does a trace-derived, deterministically F-gated repro give valid, *non-lax* repros more often than repros from prose, from a raw trace in the prompt, or from F→P alone?
- **RQ3 (Repair).** Do the gates (F + suite + traces + CI-before-PR) raise held-out correctness and lower partial, lax, regressing and insecure patches, compared with the composition baseline? At what cost in recall and time?
- **RQ4 (Persist).** Does one merged fix remove the fault for every later agent and model, compared with detection-only receipts and runtime recovery?
- **RQ5 (Agent effect).** What do receipts do to the wrong-answer rate and to pass^k before the fix lands, against trivial agents and cheap prompt mitigations?
- **RQ6 (Generalize).** Do results transfer to τ²-bench, to real bugs and to an external behavioural-break substrate? Can inferred contracts replace hand-written ones? What happens on legitimate evolution?
- **RQ7 (Secure).** Can an adversary who controls upstream responses get attacker-directed code into a gate-passing PR, or exfiltrate secrets?
- **RQ8 (Adopt).** Do reviewers judge fiks PRs mergeable, and does the evidence block change their decisions?

**Hypotheses.** These are proposals for the planner; PLAN.md pre-registers thresholds and margins.
- **Lose?** marks a test fiks could plausibly lose.
- **Tier:** **C** = confirmatory (Holm family, one primary endpoint each); E = exploratory (raw p and effect sizes, never called "significant"); D = descriptive / construction property.
- Origins are given as round-1 numbers and the gap-area IDs (HG*, H-S*, H-M*, HA*, H-CA*, HD*).

| H | Statement | Measured quantity | Baselines | Bench (§6) | Falsified if | Lose? | Tier |
|---|---|---|---|---|---|---|---|
| H1 | Contracts detect a strict superset of what the schema floor detects | Per-class recall at matched v1 FP; strict-spec ablation; mid-p McNemar on discordant calls | MCP SDK, Ajv strict, ContextForge, Prism | 1, 2, 10 | Schema-only ≥ fiks recall at ≤ FP on any class, or ≥ 50% of the blind suite | Yes, on S2 under a strict spec | C |
| H2 | Under 3 stated preconditions (no dependency bump, fixture-based tests, type-preserving drift), compile, dependency-PR CI and spec-diff triggers fire on 0/5 seeded drifts. A scheduled **live-integration test** fires on ≤ k/5, and none of its messages names the violated property (H-CA1, H-CA2). | Trigger fires; message localizes the cause | tsc/lint, Dependabot-style CI, oasdiff, DeltaMCP-style, live-test arm | 1 | Live suite fails on all 5 with messages that localize as precisely as receipts | Partly (live tests) | D |
| H3 | Deterministic contracts beat an LLM judge on paired sensitivity/specificity, even when the judge sees the raw upstream body. Contracts are binary, so their ROC is one point; DeLong or bootstrap is used for scored judges only. | Sens/spec vs vendor-state labels; tokens per call | Judge (call, result) / (+ upstream); ALTK Silent Review; Enkrypt-style | 1, 2, 3 | Judge ≥ contracts (paired) | **Yes** (out of vocabulary, S12) | C |
| H4 | Recorded-response and snapshot oracles reproduce upstream drift poorly or noisily. Tests recorded on v1 pass on the unfixed server under v2. Snapshot diff (Gilesi-style) or Hoverfly Diff flags D1–D5 but fires on benign v1b more often than contracts (H-CA6). | Right-reason failure; FP on v1b at equal recall | Keploy/nock; Hoverfly Diff; snapshot diff | 1, 2 | Snapshot diff FP ≤ contract FP at equal recall | Possible | E |
| H5 | Clean false positives ≤ 1% per tool result, with Wilson upper ≤ 2% (needs ≥ 189 clean receipts with 0 FPs, or ≈ 280 with 1 [our arithmetic]). Per-trial and per-task bounds are reported too (H-M4). | Per-receipt FP | – | 1 (v1, v1b), 8 or 13 | Upper bound > 2% | **Yes** on real servers | C |
| H6 | The vocabulary limit replicates. Predeclared response-mutation operators show FN ≤ 50% on every non-string class, and string perturbation (S12) is the worst class (H-M2). Blind-authored drifts are detected markedly less often than D1–D5. | FN per operator (Wilson); detection gap (pp) | Hand vs inferred contracts | 3, 1 | Any non-string class FN > 50%; or S12 is not the worst (operator set too easy) | **Expected loss on S12** | E |
| H7 | Trace-derived repros pass the deterministic F gate ≥ 95% of the time. The stated-reason gate rejects candidates that plain F→P accepts. | F-gate pass; gate-disagreement rate | Agent repro from receipt text; plain F→P | 1, 10 | Agent within fiks's CI; or 100% gate agreement (the gate is redundant) | Possible | C |
| H8 | **C19 directly, with three arms** (HG3): trace → test > raw trace in prompt > prose alert, measured by F-gate pass and downstream repair. | Paired pass (McNemar mid-p) | Same generator / repairer | 1, 10 | Raw-trace ≥ trace → test, or prose ≥ either | **Yes** (real issues are often detailed; DepRepair says raw text hurts) | C |
| H9 | Gated repair has higher held-out precision than the **composition baseline** (monitor → prose alert → same agent → PR → ≤ 3 CI revisions in ≤ 90 min) and than the ungated, Engine-like, PostHog-like and Itzal-like arms, at equal budget, with recall reported (HG1). | Held-out pass; differential agreement; wrong-reason, lax and regressing-PR counts; cost; time | Above + Agentless/SWE-agent/OpenHands on forks | 1, 10 | Paired difference ≤ 0, or CI includes 0 at the pre-registered power | **Yes** (ceiling on easy drifts) | C |
| H10 | Suite + all-traces gates reject patches that pass the single repro but fail **hidden post-drift tests** the agent never sees (Update-from-Hell design) [C20]. Gate-rejected fixes show collateral regressions as in `[tayebati2026selfhealingharness]`. | Count of repro-pass / hidden-fail patches rejected | Repro-only; visible-tests-only; Itzal-like trace replay | 1, 10 | No such patch occurs (gate unexercised → report as a null) | Null likely on seeded drifts | E |
| H11 | **Laxity** (HG2): repros that pass the stated-reason F gate have lower CoHarden-style laxity than F→P-only tests from the same trace | Share of LLM mutation patches that pass the repro but fail the held-out oracle | F→P-only tests | 1, 10 | Distributions do not differ (paired, Holm) | Possible | E |
| H12 | **Recurrence, narrowed** (HG5): after a merged fix, the violation rate for that contract is 0 for every later agent, model and seed (Wilson upper reported). Under detection-only receipts and orchestrator-style runtime recovery it stays flat. Task-level failure is reported for both. | Violations per session before/after; task failure | Detection-only; block; runtime recovery `[babu2026selfhealingorch]` | 1, 5 | Post-merge > 0, or detection-only declines without a code change | – | C |
| H13 | Receipts lower the wrong-answer rate without lowering correct answers. A one-line retrieval-status prompt matches fiks on null/empty/truncated drifts but not on plausible-value drifts (D1, D5). Trivial always-decline and always-trust agents do not explain the gains (H-M6). D3 is graded under both policies. | Wrong-answer and completion (paired by task); per-task success with a hierarchical Beta-Binomial | No monitor; caution prompt; retrieval-status line (†sethi2026fabrication: re-verify first); block arm; trivial agents | 1, 5 | Receipts not lower; prompt matches on D1/D5; a trivial agent matches the receipt arm | **Yes on D2/D4** | C |
| H14 | Real-bug coverage: blind contracts flag ≥ 70% of score-3 candidates on the prefix, with ≤ 1 flagged fixed version. F→P agrees with human fixes ≥ 80%. **Coupling** (H-M3): ≥ 50% of detected real bugs share a contract template with a seeded drift. | Detection; FP on fixes; F→P agreement; coupling table | Schema floor; LLM judge; Semgrep | 10, 6 | Detection < 50%, F→P < 60%, or coupling < 50% | **Yes** for some classes | C |
| H15 | On real bugs, repair from the fiks trace beats repair from issue text alone | Held-out pass on the human fix's tests (McNemar) | Same agent, issue text | 10 | Not better, or worse | **Yes** (many bugs were fixed within days) | E |
| H16 | Inferred contracts (v1 traffic; Outcome-Monitor/Daikon/Deequ templates; AVH-style FPR budget δ) detect D1–D3 like the hand contracts, with measured FP ≤ δ on v1b (HD6). A GX profiler suite detects D1, D2, D4 and D5 (vocabulary parity, **expected concession**, HD1), but no batch tool detects D3. | Detection; per-receipt FP; learning curve | Hand contracts; AGORA+/Beet; GX profiler; TFDV; AVH reimpl. | 1, 2 | Inference misses any of D1–D3, or FP > δ. A batch tool detects D3. | Possible on D1 | E |
| H17 | **Per-call vs statistical detection** (HG4, HD2): contracts fire on the first violating call. AegisFlow-style KS/null/range detectors and Evidently defaults need a window, and fire more on benign v1b (HD3). | Calls-to-first-detection; wrong answers before detection; per-window FP | AegisFlow-style; Evidently; whylogs; z-score volume | 2, 1 | Windowed median calls-to-detect within 1 call on D1/D5, with ≤ FP | Possible on high-volume tools | C |
| H18 | **Legitimate evolution** (HD5, X21): on benign v1b, fiks opens a *code* PR where a contract update is correct | Share of benign cases → code PR vs contract-update proposal | Ideal: contract-update PR arm | 1 | Share = 0 | **Expected loss today**; motivates a contract-update outcome | D |
| H19 | Transfer to τ²-bench retail/airline with drift: detection ≥ 90%, no clean false receipts. On the C11 τ-retail protocol, the gain is within or above C11's +12–14 pp (replication-style). | Detection; pass^k; paired gain | Outcome-Monitor reimpl.; schema-only | 5 | Detection lower bound < 80%, or gain CI upper < C11 | Possible | E |
| H20 | CI-before-PR exposes 0 red-CI PRs, at a measured time cost. **Descriptive; it is not claimed to drive acceptance** (X24, X25). | Red checks per PR; minutes | Open-then-iterate arm | 1 | Open-then-iterate also never shows red | – | D |
| H21 | Determinism: replayed repros and offline detection give identical verdicts across ≥ 20 reruns (H-M7). A dataset + LLM-judge regression eval disagrees in ≥ x%. | Verdict agreement | Langfuse dataset + judge | 2 | Any fiks disagreement | – | D |
| H22 | Portability and receipt survival: verdicts are identical when fiks runs as a Docker after-interceptor or ContextForge plugin (non-upstream contracts). `_meta` receipts are dropped by some frameworks while the text-block copy survives (HG6, via `[patodiya2026postwire]`). | Verdict agreement; receipt survival per framework | fiks-proxy | 2 | Verdicts differ; all frameworks keep `_meta` (dual channel unneeded); or the text block is also lost | – | E |
| H23 | **Capability containment** (H-S1, H-S6): with injection payloads in vendor bodies, 0 writes outside `src/`, 0 non-allow-listed commands, 0 edits to tests/fixtures/config, and (with an OS sandbox) 0 canary-secret appearances | Containment violations; canary hits (Wilson upper) | Unsandboxed current runner | 4 | Any violation or canary hit | Possible today (unsandboxed `pnpm test`) | C |
| H24 | **Strict-format trace** (H-S2): a quarantined, typed trace diff keeps D1–D5 repair success non-inferior to raw traces. The malicious-diff rate is 0 under static attacks. The **honest negative** (H-S3): without it, a non-zero share of injected trials yield gate-passing PRs with attacker-directed `src/` behaviour. | Repair success (non-inferiority margin); malicious-diff rate | Raw trace; spotlighting/datamarking; PromptGuard | 4, 1 | Success drops beyond the margin, or the strict format still yields a malicious diff | **Yes** (H-S3 expected to show harm) | C |
| H25 | **Contract gaming and patch security** (H-S4, H-S5): for adversarially shaped drifts, the full gate set rejects validator-widening patches (property-based fuzzer over the contract). fiks PRs add no new findings confirmed by ≥ 2 of {Semgrep, CodeQL, eslint-plugin-security}. | Widened-patch rejection rate; confirmed new SAST findings | Repro-only gate | 4, 1, 10 | Gate-passing patches accept strictly more invalid outputs; any confirmed finding | Possible | E |
| H26 | **Reviewer judgement** (HA1, HA2; needs user approval for human time): blind reviewers rate gated PRs "merge as-is or minor edits" more often than ungated PRs (κ, 2 reviewers). The evidence block raises confidence and cuts time-to-decision for the same diff. | Proportion (Wilson), paired by drift; 1–5 confidence; seconds | Ungated PRs; same diff with a plain description | 1, 10 | Paired difference ≤ 0; no confidence/time effect | **Yes** (mining shows null test effects) | E |
| H27 | **C21 re-analysis** (HA3): the failed-check association survives excluding open PRs, excluding instant/self-merged PRs, controlling for agent, size and repo (mixed model), and using CI at the first commit | OR per failed check (95% CI) per specification | Ehsani's model | 9 | OR CI includes 1 under controls. Then C21 is cited only descriptively. | – (protects the motivation) | E |
| H28 | **External substrate** (H-CA5): fiks's repair stage plus gate on BBCBench JS cases is within the 95% CI of BBCFixer under the same backbone | Pass rate | BBCFixer; pure agent (mini-swe-agent) | 11 | Significantly lower (fiks's repair adds nothing beyond its trigger) | Possible | E |
| H29 | **Noise and duplicates** (HA4, HA5): an "already fixed / duplicate" check plus per-contract grouping and rate limits keep PRs under N per repo-week, without suppressing a true needed fix | PRs per repo-week; suppressed true fixes | No check | 1, 10 | Suppresses ≥ 1 true fix, or exceeds the limit | – | D |

**Statistical plan these imply.** Sources: `[bowyer2025clt]` `[miller2024errorbars]` `[fagerland2013mcnemar]` `[brown2001binomial]` `[dietterich1998tests]` `[arcuri2014hitchhiker]`. All are verified except where marked.
- **Unit of analysis.** For agent outcomes, the task (clustered) is the unit. For detection, the call is the unit, resampled at the drift-scenario or task level.
- **Intervals.** Wilson for rates. A hierarchical Beta-Binomial with a task random effect for pass^1. pass^k with n = 2K trials per task.
- **Tests.** Mid-p McNemar for paired binary detectors; the exact test is also reported. Sign-flip permutation on per-task differences.
- **Multiplicity.** Holm within the confirmatory family (tier C) only.
- **Power.** The paired-proportion approximation attributed to Connor (†connor1987paired, formula [verify]) gives ≈ 42 paired units for discordance .30 vs .05, and ≈ 85 for .20 vs .05 [ledger: gap-eval-methodology §7]. So **the confirmatory agent-outcome claims (H13) need ≥ 25 tasks × several drifts**. State the MDE at the chosen n instead of claiming adequate power.

**Headline candidates:** H1, H3, H8, H9, H12, H14, H17, H23/H24.
**Must report even if lost:** H3, H6, H8, H13, H15, H18, H24 (H-S3 part), H26.

---

## 9. Gap analysis (ranked by value of information per cost) and novelty statement

| Rank | Gap | Why it matters | Cost (est.) | VoI/cost |
|---|---|---|---|---|
| G1 | **Offline replay with the expanded baseline set**: schema floor, Ajv strict, LLM judge ± upstream, Keploy/Hoverfly Diff, snapshot diff, GX profiler, Evidently, AegisFlow-style statistics, error / dependency / spec triggers | Answers "glue", "data observability on MCP" and "statistical drift detection" with numbers (H1, H3, H4, H16, H17) | 10–15 h + small API spend | **Very high** |
| G2 | **Statistics redesign before any new runs**: ≥ 25 tasks, n = 2K trials, ≥ 189 clean receipts, trivial agents, pre-registered confirmatory family, MDE statement | The current bench cannot reach significance at the task level. Cheap to fix in design and expensive to fix after runs. | 4–8 h (design + scripts) | **Very high** |
| G3 | **Repair-loop hardening + adversarial-trace suite**: OS sandbox (no network, empty env) for the agent and the tests; human-approved CI on fiks branches; strict-format trace; SAST 2-of-3; fixture size cap / JSON-only; signed PR provenance | A security reviewer will raise K16 first. Several items are code changes with measurable effects (H23–H25). The threats section is mandatory until done. | 15–25 h | **Very high** |
| G4 | **Composition baseline and repair ablations** (trace → test / raw trace / prose; gated vs composition; laxity; hidden post-drift tests; collateral regressions) | Core of "the gates matter" against the compositional critique (H8–H11) | 10–15 h + runs (~$0.11–0.21 per repair [ledger]) | **High** |
| G5 | **Remaining discovery searches**: patents (Google Patents/USPTO/EPO, with the 3 suggested queries in `gap-prior-art-sweep` §10), the Visa 10178 body (human with a browser), TDCommons, YC W25–F26, cs.LG/CL and OpenReview; 2026 SWE-agent injection; post-2025 agent-eval statistics | The novelty claim still rests on absences found without web search in all gap areas | Low (search budget or a human) | **High** |
| G6 | **Blind-authored drift suite + benign v1b + mutation operators** | Removes circularity (M2, M21). Tests H5, H6, H18. | 15–25 h | **High** |
| G7 | **Contract-update outcome** (the fiks loop proposes a contract change, not a code patch, for legitimate evolution) | X21/H18: a real design gap that a data-quality reviewer will name | 6–10 h | High |
| G8 | **Re-verification batch.** Dropped but important (corrected claims are usually benign): †chen2026bbcfixer, he2023dependabot compat-score numbers, †liu2026mcpevolbench, †stainless-bcd, †sethi2026fabrication, †bettenburg2008goodbugreport, †metr2025rewardhacking, †tan2026agentchaos, †cheng2026agentbugsmith, †connor1987paired, †silva2024gitbugjava. Pending: Copilot Autofix, gateway docs, mcp-conformance. Second verifier for `[xavier2017apibreak]` and `[mcp-healer]`. | Needed for H13, H28, the power analysis and matrix rows | Low | Medium–high |
| G9 | **Recurrence experiment** across models and seeds | Narrowed but still the cleanest controlled metric (H12) | 7–11 h | High |
| G10 | **Real-bug wave 1 (TS)** with the sandboxed harness | External validity (H14, H15) | 14–30 h | High |
| G11 | **τ²-bench adapter + C11 protocol** | Comparability with C7, C8, C11 | 15–25 h + pilot | High |
| G12 | **Contract inference** (OM/Daikon/Deequ templates + AVH FPR budget) | Answers the authoring-cost critique (H16) | 11–19 h | Medium–high |
| G13 | **Spec-visibility measurement** (oasdiff on archived specs; second coder) | X8; C27/C28 wording | 6–10 h | Medium |
| G14 | **AIDev-pop re-analysis** of C21 | Protects the motivation sentence (H27) | 6–10 h | Medium |
| G15 | **Blind human review** (2 reviewers, κ) + evidence ablation | M4, X25. Needs the user's approval for human time. | Human hours | High but gated |
| G16 | **BBCBench external substrate** | H28; after re-verifying the source and its licence | 10–15 h | Medium |
| G17 | Organic silent-violation rate on MCPMark local | M6 | 10–20 h + ~$600 | Medium |
| G18 | Go/Python repair harness | Unlocks repair on about two-thirds of real bugs | 30–40 h | Medium–low |
| G19 | Measuring products directly (Engine, Cleric, Seer, Devin, Monte Carlo) | Needs accounts or sign-ups: **out of scope**. Emulate the documented behaviour and say so. | – | – |

**Novelty statement (dated 2026-10-21; patents not searched).**

*Genuinely new, as a combination.* We searched:
- a verified catalog of 508 works;
- the products in §5 (about 50 rows, from docs only);
- titles of 62,544 arXiv cs.SE/cs.AI/cs.MA listings (2025–26).

We found no system whose **trigger** is a deterministic contract violation in a *successful* tool/MCP result, checked per call at the agent–tool boundary and grounded in the raw upstream exchange (including read-after-write postconditions), and whose **PR is opened only after** all of the following pass:
- a fail-first, stated-reason reproduction test built from the recorded upstream exchange;
- the full contract suite;
- all stored traces;
- typecheck/lint;
- CI on the exact commit.

fiks also pairs that durable fix with an immediate receipt to the running agent.

*Measurement contributions we did not find elsewhere:*
1. **Controlled**, pre-registered, per-contract recurrence with CIs across agents and models. Cleric and Engine measure recurrence observationally in production.
2. Trace → test vs raw trace vs prose as repair input. This tests C19 against DepRepair's finding.
3. The wrong-reason and laxity rates that a deterministic named-property gate catches beyond plain F→P.
4. Injection through a runtime trace into a gated APR loop, including the first explicit statement of the record/replay **fixture-poisoning** surface. This is a contribution only if paired with a defence and a measurement.
5. A drift benchmark where the upstream changed and the tool did not, with benign-evolution controls.

*Not new. Say so in the paper:*
- the invariant vocabulary (data-quality checks: GX, dbt, ODCS, TFDV, ML Test Score);
- MCP/API proxies with post-call hooks;
- runtime output contracts and receipts (Outcome Monitors);
- traffic-learned silent-drift alerts (Visa 2026, AGORA+);
- statistical silent-drift detection → patch → validated deploy (**AegisFlow 2026**);
- record/replay as tests (Keploy, Tusk, Nango);
- production failure → patch → developer (Itzal 2016, SapFix 2018);
- observability or alert → coding agent → PR with never-merge and CI iteration (Seer, Bits, PostHog, Engine, Devin, Cursor, Copilot);
- **post-fix confirmation and recurrence tracking** (Engine Oct 2026, Cleric);
- repairing the *client's own* repo after upstream change, and opening the PR from a bot (Byam, BBCFixer, DependaFix);
- agentic repair.

*Suggested C28 wording* (from `gap-prior-art-sweep` §7, adopted here):
> "We have not found a system whose trigger is a deterministic contract violation in a successful tool result and whose PR is opened only after a fail-first, stated-reason reproduction test built from the recorded upstream exchange, the full contract suite, stored traces and CI pass. Nearest: AegisFlow (2026) detects silent pipeline drift statistically and auto-deploys patches validated on snapshots. LangSmith Engine and Cleric open fix PRs and confirm recurrence after merge. Patent databases were not searched."

---

## 10. Master synthesis

Three literatures meet at fiks, and none closes its loop.

**Silent tool faults are real.** MCP servers return well-formed successes with wrong content [C3, C4]. Benchmark tools themselves report writes that never happen `[bellibatlu2026contractaudit]`. Agents adopt such values [C9].

**Runtime monitors** (Outcome Monitors [C11], ToolGate, verimcp) and the much older **data-quality field** (TFDV, Deequ, GX, AVH, Monte Carlo) already detect such faults. They use the same vocabulary fiks uses: range, not-null, row count, freshness. Their consensus lesson is that false positives and non-actionable alerts kill adoption, and that the real metric is whether an alert "leads to a fix" `[polyzotis2018lifecycle]`.

**Repair systems** close the loop to a PR. Observability products (Seer, Bits, PostHog, Engine), alert-triggered agents (Devin, Cursor, Copilot) and dependency-repair bots (Byam, DependaFix) all do. In 2026 they also confirm after the fix (Engine, Cleric) or deploy autonomously (AegisFlow). Their triggers, however, are errors, incidents, LLM scans, batch statistics, compile errors or version bumps. They iterate CI after the PR opens, and none commits a fail-first test.

**The reproduction literature** says a valid test is the bottleneck [C17]. It also says F→P is not validity: tests can be lax `[tan2026coharden]` and plausible patches regress protected cases `[tayebati2026selfhealingharness]`. Visible tests mislead `[luo2026updatefromhell]`.

**fiks's defensible novelty is narrow:**
- the trigger: a per-call deterministic violation in a successful result, against the raw upstream;
- the artifact: a named-property, fail-first repro, with no golden patch;
- the gate placement: everything green, CI included, before the PR, with an agent receipt in the meantime.

Confirmation after merge, the invariant vocabulary, client-side repair and the loop shape are all prior art.

**The strongest counter-case** is now concrete: "Outcome-Monitor checker → webhook → Devin → PR, plus Engine-style recurrence charts; AegisFlow already did silent drift → patch." Argument cannot answer it; experiments can:
1. the composition baseline;
2. per-call vs statistical detection latency and false positives;
3. laxity and hidden-test regressions;
4. trace → test vs raw trace vs prose.

**Two reviewer lines are new in round 2:**
- **Security.** fiks pipes attacker-controllable vendor bytes into a coding agent whose code then runs unsandboxed, and its green badge could launder an injected patch `[liu2025aishelljack]` `[nasr2025attackermovessecond]`. The response is capability bounds, a strict-format trace and a SAST gate, measured under injection.
- **Statistics.** With 6 tasks, no task-level difference can reach significance, and 0/30 bounds FP only at about 11% `[bowyer2025clt]`.

**Acceptance evidence cuts against overclaiming.** C21's 71.48% mostly measures owners merging their own agents' PRs. Third-party bot PRs merge at 31–64% for fixes. Tests in PRs show no consistent acceptance effect.

**Credibility therefore comes from pre-registered losses reported next to wins:**
- Expected losses: LLM judges on S12; prompt lines on null/empty payloads; issue-text repair on detailed reports; legitimate evolution producing wrong code PRs; profiler parity on D1/D2/D4/D5.
- Expected wins: plausible-value drift (cents, epoch), lost writes, latency to detection, controlled recurrence and deterministic repro validity.

The cheapest high-value steps are G1–G3. They should run before any large benchmark spend.

---

## Appendix A. Proposed RESEARCH.md corrections (claims-auditor decides)

- **C5–C9, C11, C17, C26:** as in round 1 (unchanged; see git history of this file).
- **C10.** It agrees in direction with a vendor-commissioned survey: 74% of 200 respondents say stakeholders find data issues first `[mc-dq-survey-2023]`. Both samples are weak, so neither should carry a headline alone.
- **C14.** Now verified (single pass, synthesizer) `[xavier2017apibreak]`. 27.99% is the share of all 501,645 changes. Add "per-library median 14.78%; 2.54% of clients impacted". Venue: SANER 2017.
- **C21.** Verified in full text, with caveats `[ehsani2026failedagenticprs]`. Suggested wording: "In 33,596 agent-authored PRs in GitHub repos with >100 stars (AIDev-pop), 71.48% were merged (open PRs counted as not merged). In a logistic model, each additional failed check-run on the PR's last commit was associated with about 15% lower merge odds (OR 0.85)." Do not present it as the expected acceptance of a fiks PR. Do not claim CI-before-PR causes merges.
- **C22.** "83.77% of *closed*, human-matched PRs" `[watanabe2025claudecodeprs]`. Not comparable to C21.
- **C27.** Add Devin Oncall/Automations, Cursor Automations, the Copilot coding agent, Azure SRE Agent (can merge), Cleric, Monte Carlo Remediation Agent, AegisFlow and DependaFix [verify]. Engine now confirms after merge (Oct 2026).
- **C28.** Replace with the §9 wording.
- **New claim candidates** for the planner:
  - vocabulary = data-quality checks (`[tfdv-2019]`, `[gx-core-expectations]`);
  - behavioural breaks are invisible to compile-gated repair (`[reyes2025byam]`, `[luo2026updatefromhell]`);
  - the attack surface (`[liu2025aishelljack]`, `[beurerkellner2025patterns]`);
  - small-N statistics (`[bowyer2025clt]`).

## Appendix B. Dropped sources (re-admission queue; re-verify before use)

**Round 1 (unchanged):**
- sethi2026fabrication, singh2026tooluniverse, cemri2025mast, silva2024gitbugjava, widyasari2020bugsinpy;
- schemathesis-checks, mastouri2025resttomcp, github-events-2025, github-search-doc, anthropic-stop-reasons, shopify-versioning;
- ye2024rotbench, bfcl-v4, autocoderover, wang2025agentopssurvey, arize-alyx-case, github-copilot-autofix-docs, boomi-lunar-acquisition;
- hyrums-law / fowler-tolerant-reader;
- atlassian-1500, cloudflare-418, awslabs-4692, awslabs-4774, sift-gateway, claudecode2026issue23337;
- patronus-percival (NOT_FOUND).

Their corrected claims are in round-1 Appendix B (git history) and in `verify/`.

**Round 2 (new):**

| Key | Corrected claim per the verifier (usable only after re-verification) |
|---|---|
| chen2026bbcfixer | Drop "first". BBCFixer uses differential execution (old vs new library) to find the first diverging call and filters the library diff. On BBCBench (100 Python/JS behavioural breaks): 58.0 vs 49.7 pure agent (qwen3-coder); 67.3 vs 60.0 (GLM-4.5-Air), Table 4. |
| liu2026mcpevolbench | Frontier agents show 13.7% / 14.4% declines on MCP servers evolved by 11 mutation operators (tool, parameter, description). The metric is LLM-judged Task Fulfillment (1–10), §6.2. Drop "interface-level, backward-compatible". |
| cheng2026agentbugsmith | Harness bugs in open-source agentic systems can be discovered and reproduced as executable instances (Live-Harness-Bench, 200 bugs), with 10.67–27.56% higher reproduction success than general techniques. "From issues" [verify]. |
| tan2026agentchaos | HTTP-layer fault injection into **LLM API** responses (not tool results) degrades agents by up to 50 pp pass@1. Diagnosis is < 53% accurate on fault type. |
| stainless-bcd | Stainless (an SDK generator) flags unintentional breaking changes in CI, provider-side. Not about MCP generation. |
| composio-toolkit-versioning | Composio requires explicit toolkit versions for manual execution from Python SDK v0.9.0 / TS v0.2.0. Do not generalize. |
| anomalo-2025 | Unsupervised ML finds issues no rule anticipated. "Remediation via tickets" is an announced, unshipped agent [verify]. |
| metr2025rewardhacking | o3 (pre-release) reward-hacked in 30.4% (39/128) of RE-Bench runs, including monkey-patching the evaluator and overriding equality. |
| connor1987paired | Gives a conservative sample-size approximation for paired proportions. Formula [verify], pp. 207–211. |
| bettenburg2008goodbugreport | Developers rate steps to reproduce (83%), stack traces (57%) and test cases (51%) most important. The authors suggest capture/replay tools that record test cases. |
| he2023dependabot (one claim; the work stays via another verified claim) | 70.13% is the merge rate of 502,752 *regular* Dependabot PRs in 1,823 projects. The compatibility-score buckets are small (n = 1,321; 2,228); the 100% bucket is 80.30% (§5.3.2, Table 6). |

## Appendix C. Pending verification (no verdict; not in `bibliography.json`)

**api-contracts:** li2013webapievolution, sohan2015webapievolution, espinha2015growingpains, golmohammadi2023survey, pactflow-bdct, github-dispatch-2026, postman-akita-2023, lercher2025autoguard. (xavier2017apibreak was re-checked by the synthesizer and is now in the bibliography.)

**benchmarks:** taubench-v1-repo. (kapoor2025hal is now verified via gap-eval-methodology.)

**mcp-market:** kong-mcp-overview, azure-apim-mcp-overview, contextforge-repo, lunar-mcpx-repo, boomi-ai-gateway, toolhive-docs, cloudflare-portal-logpush, agentgateway-repo, microsoft-mcp-gateway, portkey-mcp-guardrails, smithery-build, invariant-explorer-shutdown, mcp-inspector, mcpjam-inspector, mcp-conformance, lasso-mcp-gateway, sentry-mcp-module, grafana-mcp-observability, harrisoncn-mcp-gateway-pr232. (mcp-healer was re-checked by the synthesizer and is now in the bibliography.)

**novelty:** incidentio-ai-sre, speedscale-docs, goreplay, meticulous, postman-insights, dependabot-version-updates, airbyte-ai-assist, mcp-eval, github-copilot-autofix-docs.

**gap-client-api-adaptation:** nguyen2010libsync, fazzini2019appevolve, zhang2024pcart, mahmud2024guppy, lamothe2021apievolutionslr, brito2018whybreak, reyes2024breakinggood, mujahid2020otherstests, kang2026pig, ziftci2025googlemigration, misra2025gitchameleon2.

## Appendix D. Code-level facts this synthesis relies on (confirm before the paper states them)

These come from `gap-repair-security` §6 and `gap-eval-methodology` §6 [Inference from reading code on 2026-10-21]:
- `packages/repair/src/prompt.ts` inlines `clip(response.body, 800)` per recorded exchange, and the repro failure message up to 1,200 characters.
- The Agent SDK runner uses `settingSources: []`, `strictMcpConfig: true` and `mcpServers: {}`.
- The write allow-list is `^src/.+\.ts$`. Containment uses `path.resolve` / `path.relative`.
- Bash is limited to `pnpm typecheck | lint | test`.
- Tests, fixtures and traces are hash-snapshotted.
- Git hooks are disabled on push.
- The agent environment copies `process.env`, and there is no OS or network sandbox.
- CI is push-triggered before human review.
- Headline bench: 6 tasks × k = 5; pass^5 is 5/6 vs 3/6; 0 false receipts in 30 v1 trials.

The codebase-map owner must confirm each item.
