# Gap area: data quality and data observability

Researcher pass, 2026-10-21. Machine-readable catalog: `gap-data-observability.sources.json` (34 sources). Keys reused from earlier areas: `tfdv-2019`, `deequ-2018` (from `spec-inference`).

## 1. Scope and searches run

**Question.** fiks's semantic invariants (range, notNull, nonEmpty, countMatchesTotal, freshness, unique, equalsUpstream, readAfterWrite; `packages/contracts/src/types.ts`) look a lot like standard data-quality checks. What does the data-quality and data-observability field already detect? What false-positive and alert-fatigue evidence has it published? Does any of it close the loop to a code fix in the producing connector? Which detector could we actually run as a baseline for D1 (×100 unit drift) and D5 (epoch-ms read as 1970)?

**Method and an honesty note.** The shared web-search budget for this workflow turn ran out before this agent's first query. Every `WebSearch` call returned "budget used up". So **no keyword searches were run for this area.** Every source below came from WebFetch of URLs known in advance (arXiv abstract and HTML pages, vendor docs, GitHub repos) or from links on pages fetched that way. All 34 sources were opened on 2026-10-21. Three PDFs were fetched and converted locally with `pdftotext`: TFDV (SysML 2019), the SIGMOD Record 2018 survey, and the ML Test Score. Because none of this was search-driven, coverage is biased toward sources that were already well known. Recent 2025–2026 academic work in this area is under-sampled; see §9.

**Fetches by sub-question (all 2026-10-21):**
- Industrial observability: Monte Carlo five pillars, its agents page and its 2023 survey; Anomalo; Bigeye autothresholds; Elementary.
- Rule and contract tooling: GX core repo and expectation list, GX V1 migration guide; Soda freshness, anomaly detection and soda-core; dbt data tests, source freshness and model contracts; ODCS repo and its quality section; datacontract-cli.
- Research on data validation: TFDV 2019 (full text); Polyzotis 2018 (full text); ML Test Score 2017 (full text); Deequ (AWS blog); Auto-Validate-by-History 2023 (HTML, two passes); Auto-Validate 2021 (abstract); Shankar et al. 2023 (HTML); Shankar et al. 2022 (abstract).
- Drift detectors: Evidently docs, its large-data blog post and repo; whylogs; Rabanser et al. 2019 (abstract).
- LLM-API behaviour drift: Chen, Zaharia and Zou 2023 (HTML); Gao, Liang and Guestrin 2025; Cai et al. 2025.
- Failed or wrong fetches, not catalogued: the EDBT 2021 URL I guessed for Redyuk et al. returned a different paper; HDSR returned 403, so the journal version of Chen et al. is not confirmed; the GX expectation-gallery pages returned navigation only.

## 2. Source catalog

| # | Source (key) | Year | Type | Central claim | Cluster |
|---|---|---|---|---|---|
| 1 | Monte Carlo, 5 pillars (`mc-five-pillars`) | 2020 [verify] | blog | Observability = freshness, distribution, volume, schema, lineage; it monitors, alerts and triages | A |
| 2 | Monte Carlo agents (`mc-agents-2026`) | 2026 | tool-docs | Agents monitor, troubleshoot, triage and tune; a Remediation Agent hands a fix plan to the user's coding assistant via MCP; humans stay in the loop | A, E |
| 3 | Monte Carlo / Wakefield survey (`mc-dq-survey-2023`) | 2023 | blog | n=200: 74% say stakeholders find issues first; 15 h average to resolve | A, D |
| 4 | TFDV (`tfdv-2019`) | 2019 | paper | Inferred schema plus L∞ skew. A chi-square test fires falsely 7 times in 10; spammy alerts get ignored; humans fix the code or update the schema | C, D |
| 5 | Polyzotis et al. (`polyzotis2018lifecycle`) | 2018 | paper | An alert is a "good catch" only if it leads to a fix; over-alerting leads to ignored alerts | C, D |
| 6 | ML Test Score (`breck2017mltestscore`) | 2017 | paper | Monitor 1: source-system upgrades change meaning without strange values; Monitor 2: invariants hold, with tuned thresholds | C |
| 7 | Deequ (`deequ-2018`) | 2018 | paper | Unit tests for data plus constraint suggestion (reused key) | B, C |
| 8 | Deequ AWS blog (`deequ-aws-blog-2019`) | 2019 | blog | Suggestions are heuristics that "assume the data is correct"; AWS Glue DQ is built on Deequ | B |
| 9 | Auto-Validate-by-History (`tu2023avh`) | 2023 | paper | Constraint programs inferred from pipeline history under an FPR budget; 2,000 Microsoft pipelines; Deequ/TFDV have high precision and low recall | C |
| 10 | Auto-Validate (`song2021autovalidate`) | 2021 | paper | String-domain patterns inferred from a data lake, minimising FP | C |
| 11 | Shankar et al. (`shankar2023brokendata`) | 2023 | paper | At Meta, threshold, z-score and KS validation gave many FPs and was silenced; GATE gives 2.1× precision | C, D |
| 12 | Shankar et al. (`shankar2022operationalizing`) | 2022 | paper | Interviews with 18 MLEs: monitoring is a continual loop | D (context) |
| 13 | Evidently drift docs (`evidently-drift-docs`) | 2026 | tool-docs | Defaults: KS or χ² up to 1k rows, Wasserstein or JS at 0.1 above; ignores null increases | F |
| 14 | Evidently large-data blog (`evidently-largedata-2022`) | 2022 | blog | KS flags a 0.5% change above 100k objects | D, F |
| 15 | Evidently repo (`evidently-repo`) | 2026 | repo | Apache-2.0; drift and quality test suites | F |
| 16 | GX core (`gx-core-expectations`) | 2026 | repo | 60 core expectations; Apache-2.0 | B |
| 17 | GX V1 migration (`gx-v1-profilers-removed`) | 2024 [verify] | tool-docs | Profilers removed in V1 | B |
| 18 | Soda freshness (`soda-freshness`) | 2026 | tool-docs | `freshness(col) < 3d`: age of the newest row | B |
| 19 | Soda anomaly detection (`soda-anomaly`) | 2026 | tool-docs | Prophet; needs ≥4 measurements; tune "to prevent alert fatigue" | A, D |
| 20 | soda-core (`soda-core-repo`) | 2026 | repo | Contract engine; main branch under Elastic License 2.0 | B |
| 21 | dbt data tests (`dbt-data-tests`) | 2026 | tool-docs | unique, not_null, accepted_values, relationships; a test is SQL returning failing rows | B |
| 22 | dbt source freshness (`dbt-source-freshness`) | 2026 | tool-docs | SLA-based freshness; not part of `dbt build` | B |
| 23 | dbt model contracts (`dbt-model-contracts`) | 2026 | tool-docs | Structure (names, types) enforced at build; content left to tests | B |
| 24 | ODCS (`odcs-v3`) | 2026 | spec | v3.2.0, LF AI & Data, Apache-2.0; schema, quality, SLA | B |
| 25 | ODCS quality (`odcs-quality`) | 2026 | spec | nullValues, invalidValues, duplicateValues, rowCount; mustBeBetween | B |
| 26 | datacontract-cli (`datacontract-cli`) | 2026 | repo | MIT; tests data against ODCS; `breaking` diffs contract versions | B |
| 27 | Bigeye autothresholds (`bigeye-autothresholds`) | 2026 | tool-docs | Learned bounds from 21 days of history; "bad alert" feedback widens them | A, D |
| 28 | Anomalo (`anomalo-2025`) | 2025 | blog | Unsupervised ML catches what rules miss; remediation is tickets | A, E |
| 29 | whylogs (`whylogs-repo`) | 2026 | repo | Apache-2.0 profiles, constraints and drift | F |
| 30 | Elementary (`elementary-volume`) | 2026 | tool-docs | dbt volume anomalies: 14-day training, completed buckets only | A |
| 31 | Chen, Zaharia, Zou (`chen2023chatgptdrift`) | 2023 | paper | GPT-4 behaviour changed March→June 2023: directly executable code 52%→10% | G |
| 32 | Gao, Liang, Guestrin (`gao2025modelequality`) | 2025 | paper | Model equality via MMD; 11 of 31 endpoints deviate | G |
| 33 | Cai et al. (`cai2025modelsubstitution`) | 2025 | paper | Output tests miss subtle substitution; log-probs defeated by nondeterminism | G |
| 34 | Rabanser et al. (`rabanser2019failingloudly`) | 2019 | paper | Classifier-reduced two-sample tests detect shift best | F |

## 3. Clusters

- **A. Commercial data observability** (Monte Carlo, Anomalo, Bigeye, Soda Cloud, Elementary). These run learned monitors over warehouse tables: freshness, volume, schema, distribution and lineage. Thresholds come from days to weeks of history (Bigeye 21 days; Elementary 14 days; Soda needs ≥4 regular scans). They control false positives with sensitivity knobs and human feedback, and since 2025–2026 also with LLM "agents" that triage, tune and remediate.
- **B. Declarative rules and data contracts** (GX, dbt, Soda Core, ODCS, datacontract-cli, Deequ). These are hand-written or profiler-suggested assertions on batches, either SQL that returns failing rows or expectation objects. ODCS standardises a producer–consumer contract with schema, quality and SLA sections. dbt keeps structural contracts separate from content tests.
- **C. Research on data validation for ML and pipelines** (TFDV, Polyzotis, ML Test Score, Deequ, AVH, Auto-Validate, GATE). Schemas are inferred from data and humans curate them. FP control is central: TFDV's L∞ distance, AVH's FPR budget, GATE's precision@0.9.
- **D. Alert fatigue and false positives.** This is the most consistent finding across the field. Statistical tests on large batches over-fire (TFDV, Evidently). Overfitted inferred schemas cause spurious alerts and teams switch validation off (TFDV, Shankar 2023). The measure that matters is whether an alert leads to a fix (Polyzotis).
- **E. Remediation and closing the loop.** The industrial loop ends with a human. TFDV says the on-call "isolate[s] the bug in the code, and submit[s] a fix". Anomalo opens tickets. **Monte Carlo's Remediation Agent (2026) goes furthest.** It turns a root-cause analysis into a plan that the user's coding assistant pulls via MCP to make the fix. No reproduction-test gate or CI gate is described, and the page says "agents never manipulate data or systems".
- **F. Distribution-shift detectors** (Evidently, whylogs, Rabanser). These run two-sample tests or distances on windows of data. They are runnable, Apache-2.0, and need a window of samples rather than a single observation.
- **G. LLM-API behaviour drift** (Chen 2023; Gao 2025; Cai 2025). The same named API changes behaviour, and detecting it needs repeated samples and statistical tests. This is the same structure as upstream drift behind a stable interface, but for stochastic text outputs.

## 4. Contradictions and why sources disagree

1. **Statistical and ML monitors versus deterministic rules.** Anomalo and Monte Carlo argue that unsupervised ML catches what nobody wrote a rule for. AVH reports that Deequ and TFDV have "high precision but low recall" under static configurations. Against that, TFDV deliberately avoids goodness-of-fit tests because a χ² test fired 7 times in 10 on 0.01% noise. Shankar 2023 reports that z-score and KS validation yielded many FPs and were silenced. *Why they disagree:*
   - *Sample size.* p-values shrink as n grows, so large batches make tests over-sensitive.
   - *Labels.* AVH's precision assumes the history is clean, which it checked on a 100-column sample (App. L). Vendor claims are not independently evaluated.
   - *Incentives.* Vendors sell recall.
   - *Granularity.* Table batches versus per-feature slices.

   For fiks, single tool results are small batches (n=1 or one page), which is the opposite regime. Deterministic invariants are decisive there, and distribution tests barely have power.
2. **Fix the data or fix the constraint.** TFDV says the user either fixes the data-generation process or updates the schema if the change is natural evolution. The schema evolved in most of the >700 pipelines it examined (Fig. 6). Polyzotis' "SS" may be South Sudan. fiks assumes a violation means the tool is wrong and opens a code PR. The data-validation literature says a large share of alerts reflect legitimate evolution, where the right "fix" is updating the contract. *This is a real gap in fiks's loop design.*
3. **Can anomaly FPs be tuned away?** Monte Carlo claims its Tuning Agent cuts FPs by "80%+ without losing real signal" (vendor page, unaudited). Bigeye's "bad alert" feedback widens thresholds. TFDV and Polyzotis argue that FP control is mostly about how actionable an alert is, not just its threshold. These are different notions of FP: statistical (no real change) versus operational (real change, but not worth acting on).
4. **Who catches the problem.** Monte Carlo's survey (vendor-commissioned, n=200) has 74% saying stakeholders catch issues first. This agrees in direction with C10 (~70% caught by humans, n=1 system). Both have weak sampling, so neither alone should carry a headline.

## 5. Claim ledgers for the deep-read sources

**TFDV, Breck et al. 2019 (full PDF)**
- L1. Deployed in TFX at Google: "hundreds of product teams" validate "several petabytes of production data per day" (Abstract).
- L2. In practice "the on-call engineer [must] investigate the problem, isolate the bug in the code, and submit a fix". On-calls "tend to ignore alerts that are either spammy or not actionable" (Sec. 1). The human closes the loop.
- L3. Auto-inferred schema: "an overfitted schema is more likely to cause spurious alerts … and may even lead them to switch off data validation altogether" (Sec. 3). Inference uses "reasonable heuristics" and has no guarantees.
- L4. χ² test on 100M N(0,1) points with 0.01% replaced: "would needlessly fire an alert 7 out of 10 times" (Sec. 4, Fig. 5). They chose d∞ with a human threshold instead, because it names a "culprit" value.
- L5. On an alert, the user may "either fix the data generation process or update the schema" (Sec. 6.1). The schema evolves in most of >700 pipelines (Fig. 6). Table 1 tracks the fraction of anomalies "Fixed".
- L6. Model unit tests: >70% of pipelines have one; over >80K executions, 6% failed because the "training code had incorrect assumptions about the data or the schema itself was under specified" (Sec. 6.1).

**Polyzotis et al. 2018, SIGMOD Record (full PDF)**
- L1. "If there are too many false positives, the user may end up ignoring alerts altogether" (Sec. 2).
- L2. Alert precision is defined as "what fraction of alerts lead to good catches", and a good catch is "actionable and eventually leads to a fix" (Sec. 4.1).
- L3. Distribution-shift alerts are "less actionable" than missing-feature alerts (the Kolmogorov 0.11 example) (Sec. 4.1).
- L4. "the question is not whether something is wrong if an alert fires, but whether it gets fixed" (Sec. 4.1).
- L5. A data fix may mean fixing the constraint (the "SS" example) (Sec. 4.1).

**ML Test Score, Breck et al. 2017 (full PDF)**
- L1. Data 1: encode feature expectations in a schema (e.g., adult height of 1–10 ft). Invariants "can also be inferred automatically from your system's behavior".
- L2. Monitor 1: source-system "version upgrades … can radically change the feature's meaning … without necessarily producing values that are strange enough to trigger other monitoring". The remedy given is to subscribe to announcement lists, which is a human process.
- L3. Monitor 2: "careful tuning of alerting thresholds is needed to achieve a useful balance between false positive and false negative rates".

**Auto-Validate-by-History, Tu et al. 2023 (arXiv HTML; plots not readable)**
- L1. Motivation: DQ issues "creep into recurring pipelines because of upstream schema and data drift over time" (Abstract).
- L2. Search space: single-column metrics (row count, complete and unique ratio, min, max, mean, EMD, JS, KL, KS, Cohen's d …). Programs are conjunctive (Sec. 3, Tables 1–2).
- L3. A user FPR target δ, with expected-FPR bounds from Chebyshev, Cantelli and the CLT. This assumes a clean history (Sec. 4).
- L4. Evaluated on 2,000 Microsoft pipelines × 60 executions. Recall is tested by substituting similar columns plus 10 synthetic issue types (Sec. 5.1). Deequ and TFDV have "high precision but low recall" (Sec. 5.3). Numeric values are in figures only.
- L5. Struggles with character-level perturbations, and is single-column only. It alerts; it does not repair.

**Shankar et al. 2023, "Moving Fast With Broken Data" (arXiv HTML)**
- L1. Schema validation is "necessary but not sufficient" (Sec. 1).
- L2. A 30% completeness-drop threshold "produced too many false positive alerts". Engineers "silenced them" and "eventually … abandoned this data validation method" (Sec. 2.2).
- L3. z-score and KS "yielded many false positives" when high recall was required (Sec. 4.3).
- L4. GATE: 2.1× average precision improvement on Instagram data. On the high-failure dataset 𝒟₂ its AP was 0.9× the baseline (Sec. 6.2).

**Monte Carlo agents page (vendor, 2026)**
- L1. The Remediation Agent turns each troubleshooting analysis into a plan with a root-cause classification and a recommended action (code fix or re-run). The user's coding assistant "pulls the full fix via MCP".
- L2. "Humans stay in the loop—agents never manipulate data or systems."
- L3. Vendor-only numbers: Tuning Agent "Reduce false positives by 80%+"; "average data incident takes 19 hours to resolve". There is no methodology, so cite these only as vendor claims.

**Chen, Zaharia, Zou 2023 (arXiv HTML)**
- L1. GPT-4 prime identification fell from 84.0% to 51.1% between March and June 2023; GPT-3.5 rose from 49.6% to 76.2% (Sec. 3.1).
- L2. Directly executable code generations: GPT-4 52.0%→10.0%, GPT-3.5 22.0%→2.0% (Sec. 3.5, Fig. 9).
- L3. The authors call for "continuous monitoring of LLMs" (Abstract, Sec. 5).

## 6. What this means for fiks

**Where fiks is not novel. Concede this up front.**
- The *vocabulary* is standard. Each single-result invariant has a direct analogue: range = `ExpectColumnValuesToBeBetween` / ODCS `invalidValues`; notNull = dbt `not_null` / GX `ExpectColumnValuesToNotBeNull` / ODCS `nullValues`; unique = dbt `unique`; nonEmpty and countMatchesTotal = row-count checks / `ExpectTableRowCountToEqualOtherTable`; freshness = Soda `freshness()` / dbt source freshness; outputSchema = dbt model contracts / `ExpectColumnValuesToMatchJsonSchema`.
- Mapped to the seeded drifts, the five pillars cover D5 (freshness), D4 (volume), D2 (schema and null rate) and D1 (distribution).
- The paper should say plainly that fiks reuses the data-quality vocabulary [cite `mc-five-pillars`, `gx-core-expectations`, `odcs-quality`, `tfdv-2019`, `breck2017mltestscore`].
- The ML Test Score named the D1/D5 class (meaning changes after an upstream upgrade, with plausible values) in 2017.

**Where fiks differs.** These are design differences, not results yet.
1. **Unit of observation.** Data-quality checks run on batches and tables after load, on a schedule. fiks evaluates *each tool result inline* at the agent–tool boundary and returns a receipt to the agent *before* it acts. Learned monitors need history first: 21 days for Bigeye, 14 for Elementary, ≥4 scans for Soda, a reference window for Evidently. fiks's hand contracts fire on the first violating call.
2. **Kinds with no data-quality analogue.**
   - `readAfterWrite` is a cross-call postcondition on a mutating tool (D3). Table monitors watch data at rest, not whether a write call's acknowledgment matches later state.
   - `equalsUpstream` compares the tool's output to the *raw upstream response* captured by the proxy. Reconciliation and data-diff tools compare two tables; we did not find one comparing a connector's output with its own raw HTTP input per call.
3. **Closing the loop with gates.** Every industrial path ends with a human fix (TFDV), a ticket (Anomalo), or a plan handed to a coding assistant (Monte Carlo Remediation Agent). We found none that turns the violation into a *deterministic reproduction test that must fail for the stated reason*, gates the patch on full suite plus stored traces plus green CI, and opens a PR. "We haven't found one" is the correct phrasing, and it is weakened by this area's search outage.
4. **A metric the field asked for.** Polyzotis defines a good alert as one that "eventually leads to a fix". fiks can report alert→repro→green-PR→merged conversion directly. Data-observability tools mostly report detection.

**Where fiks is weaker.**
- **Coverage of unknown unknowns.** Distribution monitors and unsupervised ML flag changes no one wrote a rule for. fiks detects only what its contracts state; C11 reports 46% detection outside the vocabulary.
- **FP evidence base.** The field has years of FP experience across thousands of pipelines (TFDV, AVH, GATE). fiks has 0/30 on its own v1 (bench), which is tiny and author-designed.
- **Contract evolution.** TFDV and Polyzotis show that much of what alerts flag is legitimate evolution. fiks has no "update the contract" outcome, so it could open wrong code PRs for intended vendor changes.
- **Inference maturity.** AVH already offers FPR-budgeted constraint inference from history. fiks's H15 inference is less principled.
- **Scale and lineage.** Commercial tools trace lineage and impact across hundreds of tables; fiks traces one call.

**The strongest reviewer counter-argument.** "This is data observability moved onto MCP traffic. Flatten tool results into a table and Great Expectations auto-profiled on v1, or Evidently drift, catches D1, D2, D4 and D5 with no hand-written contracts. Monte Carlo's Remediation Agent already hands root causes to a coding assistant via MCP. So the contribution is engineering glue."

Our answer has to be empirical:
- (a) Run those baselines on the same traffic. Report detection, *calls-to-detection* and FP on v1 and benign v1b (HD1–HD3).
- (b) Show what they cannot express (D3 read-after-write; equalsUpstream per call).
- (c) Show that the loop's gates, not the detector, carry the repair result (H7–H10 in SYNTHESIS).

If (a) shows a profiler suite matching fiks on D1, D2, D4 and D5 at equal FP, say so. Then the detection claim narrows to D3 and latency, and the paper's weight moves to repro and repair.

## 7. Candidate hypotheses (each with a falsifier)

- **HD1: Vocabulary parity, expected to be conceded.** A rule suite auto-generated from v1 tool-result traffic detects at least D1, D2, D4 and D5 at the same per-drift recall as fiks's hand contracts. The suite uses Deequ-style heuristics emitted as GX expectations: min/max with margin, not-null, row count, date range. Neither it nor any batch drift detector detects D3. *Falsified (in fiks's favour) if* the profiler suite misses D1 or D5 that fiks catches at matched FP. *Falsified (against fiks) if* a profiler suite or Evidently detects D3, the read-after-write lost write. This ties to H15 and H1.
- **HD2: Detection latency.** fiks's first receipt fires on the first violating call. Evidently (defaults) and a z-score volume monitor need a window of k ≥ w calls before they fire, where w is pre-registered (e.g., 30-call reference, 10-call current). *Measure* calls-to-first-detection and wrong agent answers produced before detection. *Falsified if* the median calls-to-detection for the windowed detector is within one call of fiks on D1 and D5.
- **HD3: Benign-drift false positives.** On benign v1b (real price changes within range, new catalogue items, seasonal volume), Evidently defaults and profiler min/max fire more often than fiks's semantic contracts. This is suggested by TFDV's 7/10 false fires and KS sensitivity. *Falsified if* the Evidently or profiler per-window FP rate is ≤ fiks's per-receipt FP rate on v1b (Wilson CIs, paired by window).
- **HD4: Alert→fix conversion.** fiks converts ≥ X% of distinct violated properties into an F-gated repro and a green-CI PR. Detection-only arms (fiks receipts only; GX/Evidently alerts) convert 0% without a human, by construction. Report this descriptively, next to TFDV's Table 1 "Fixed" fractions as context only. *Falsified if* fiks's conversion on real-bug forks (H13/H14) falls below 50%.
- **HD5: Legitimate evolution.** On intended vendor changes (a new enum value, a widened range, a documented unit change with a new field name), fiks opens a code PR even though updating the contract would be correct. *Measure* the fraction of benign-evolution cases where fiks opens a code PR instead of proposing a contract update. *Falsified if* that fraction is 0. If it is not 0, this becomes a limitation and motivates a "contract-update PR" arm.
- **HD6: Inference with an FPR budget.** AVH-style constraint selection under an FPR budget δ on v1 history reaches fiks hand-contract recall on D1, D2 and D5 with a measured clean FP ≤ δ on v1b. *Falsified if* the measured FP exceeds δ, which would mean the clean-history assumption fails, or if recall falls below the hand contracts. This is a refinement of H15.

## 8. Candidate baselines we could actually run

| Baseline | License | How | Tests |
|---|---|---|---|
| **GX Core 1.x with an in-house v1 profiler** | Apache-2.0 | GX V1 removed profilers, so write a Deequ-style suggester over flattened tool results logged by the proxy (path → column): min/max ± margin, not-null, row count, distinct set, date min/max. Emit GX expectations and validate v2 traces offline. Alternatively pin GX 0.18.x for the old profilers [verify version] | HD1, HD3, H15 |
| **Evidently DataDriftPreset / test suites** | Apache-2.0 | Reference = v1 results, current = sliding windows of v2 results per tool; default stat tests (KS or χ² ≤1k rows; Wasserstein or JS 0.1 above); add a null-share test, since drift defaults ignore nulls | HD2, HD3 (D1, D5, D2-null) |
| **TFDV infer_schema + validate_statistics** (L∞ / JS skew) | Apache-2.0 [verify] | Generate statistics from v1 JSON; infer the schema; validate v2. Python-version compatibility risk | HD1 (cross-check with the in-house profiler) |
| **whylogs constraints** | Apache-2.0 | Profile per window; constraints from v1 profile | Optional, lighter than Evidently |
| **datacontract-cli + ODCS** (DuckDB/JSON source) | MIT | Translate fiks contracts to ODCS quality rules; run `datacontract test` on flattened results. Also run `datacontract breaking` on v1 vs v2 contracts: expected no fire, since the spec is unchanged | Vocabulary-translation check; H2 spec-diff family |
| **AVH-style FPR-budget selection** (reimplemented) | Our code (paper method; no official code checked [verify]) | Cantelli bounds on v1 metric histories; select constraints under δ | HD6 / H15 |
| Soda Core | Elastic License 2.0 (main) | Usable for evaluation; not OSI. Anomaly detection is Soda Cloud only | Secondary |
| Monte Carlo, Anomalo, Bigeye | Commercial | Not runnable without an account; describe only and quote vendor claims as such | — |

Practical note: all data-quality tools expect tables. The adapter is a flattener from proxy traces to rows, one row per tool result or per array element, with columns = JSON paths. Pre-register the flattening, the window sizes and the margins before the runs.

## 9. Open gaps

1. **No keyword searches were possible** because the web-search budget was exhausted, so this pass did not cover the following. A rerun with search should target them:
   - 2025–2026 academic work on LLM-based data validation and contract inference (e.g., semantic-domain constraint learning from Microsoft's Yeye He group, newer than AVH), and data-quality agents that write fixes.
   - Monte Carlo's Remediation Agent docs and launch date, plus any independent evaluation of it.
   - Datafold, Metaplane/Datadog, Acceldata and Sifflet remediation features.
   - Redyuk et al. EDBT 2021, a kNN batch validator used as the GATE baseline.
   - Real connector bugs: Airbyte or Fivetran or Singer issues where a monitor flagged a pagination, unit or timestamp drift and a connector code fix followed. These would be strong real-bug candidates for H13 and HD4.
2. **Numbers only in figures.** AVH and GATE precision and recall values are in plots. Read them from the PDFs or contact the authors before quoting any number.
3. **Unchecked details:**
   - The journal venue of Chen et al. (HDSR returned 403).
   - The original year of the five-pillars post.
   - The GX migration-guide date.
   - The Soda Core v3 licence.
   - TFDV's current licence and Python support.
   - The `loaded_at_field`/`warn_after` keys (from the dbt sources page, not re-read).
4. **No evidence found that any data-observability tool generates a failing reproduction test** from a monitored violation. This is absence of evidence under a degraded search, so do not assert it as fact.
5. **Real-world FP of data-observability tools on API or tool-response data**, as opposed to warehouse tables, is not published, as far as this pass found.
