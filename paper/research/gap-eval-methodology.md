# Gap area: evaluation methodology (statistics, detector comparison, seeded-fault validity)

Date: 2026-10-21. Machine-readable catalog: `gap-eval-methodology.sources.json` (39 sources).
Reused keys: `yao2024taubench`, `zhu2025abc` (already in `bibliography.json`). No RESEARCH.md claim ID (C1-C28) covers these sources; new claim IDs are left to the planner.

## 1. Scope and how the search was done

**Scope.** These are the methodology sources a top ML or SE venue will hold the fiks evaluation to, and that the pre-registered analysis plan (ORCHESTRATION §"Statistics") needs:
- **(A) Agent-eval statistics:** pass@k and pass^k estimators, error bars, clustering, small-N intervals, nondeterminism, cost reporting, benchmark checklists.
- **(B) Detector comparison:** paired tests on the same items (McNemar, DeLong), small-n binomial bounds, multiplicity, and power for paired proportions.
- **(C) Seeded-fault validity:** mutation analysis and its coupling to real faults, oracle assessment, dependency fault injection and service virtualization, and the representativeness argument.

**Search log (honest account).**
- The shared WebSearch budget for this workflow turn was used up before this agent's first query. Both attempted queries returned "web search budget is used up": `Holistic Agent Leaderboard HAL Kapoor 2025 ...` and `"AI Agents That Matter" Kapoor ...`.
- Discovery therefore relied on *direct retrieval of canonical sources by known identifier*: arXiv abstract and HTML pages, author-hosted PDFs (text extracted locally with `pdftotext`), DOI metadata lookups (Crossref `works/<doi>`, Semantic Scholar `paper/DOI:<doi>`), publisher and PMC pages, and official tool docs.
- No search engine was queried through Bash or a proxy.
- Consequence: **the 2025-2026 agent-eval-statistics literature is under-sampled.** Anything published after mid-2025 on agent-eval variance is a gap (§9).

**Read depth.**
- *Full text, deep-read:* Miller 2024 (HTML), Bowyer et al. 2025 (HTML), Chen et al. 2021 (§2.1 and App. A from PDF), Just et al. 2014 (PDF), Meiklejohn et al. 2021 Filibuster (PDF).
- *Partial (HTML first ~100k chars):* ABC (`zhu2025abc`).
- *Abstract or introduction only:* Jahangirova 2016, LDFI, Chaos Engineering, Arcuri & Briand (key sections grepped), Koehn 2004 (bootstrap section), Fagerland 2013 (PMC), HAL, AI Agents That Matter, Atil 2024, Dietterich 1998, Brown et al. 2001, Natella 2016.
- *Metadata only, so claims are marked [verify]:* Papadakis 2018, Andrews 2005, Gopinath 2014, Durães & Madeira 2006, DeLong 1988, Sun & Xu 2014, Connor 1987, Wilson 1927, Hanley & Lippman-Hand 1983. Holm 1979 is known only via Wikipedia.

## 2. Source catalog

| # | Source | Year | Type | Central claim | Cluster |
|---|---|---|---|---|---|
| 1 | Chen et al., *Evaluating LLMs Trained on Code* `chen2021codex` | 2021 | paper | Unbiased pass@k = E[1 − C(n−c,k)/C(n,k)] from n ≥ k samples; plug-in 1−(1−p̂)^k is biased (App. A) | A |
| 2 | Yao et al., τ-bench `yao2024taubench` | 2024 | paper | pass^k = E_task[C(c,k)/C(n,k)]: probability that all k i.i.d. trials succeed | A |
| 3 | Miller, *Adding Error Bars to Evals* `miller2024errorbars` | 2024 | paper | CLT SEs; clustered SEs (up to 3× naive); resampling; paired SEs; power formula | A |
| 4 | Bowyer, Aitchison, Ivanova, *Don't use the CLT…* `bowyer2025clt` | 2025 | paper (ICML position) | At N ≈ 3–100, CLT, clustered-CLT and bootstrap CIs under-cover; use Wilson or Bayesian, and paired Bayes for paired data | A |
| 5 | `bayes_evals` repo `bayes-evals-repo` | 2025 | repo (MIT) | Bayesian independent and paired comparisons for binary evals | A |
| 6 | Zhu et al., Agentic Benchmark Checklist `zhu2025abc` | 2025 | paper | Task/outcome validity and reporting checklist; a trivial agent scores 38% on τ-bench impossible tasks; up to 100% relative mis-estimation | A |
| 7 | Kapoor et al., HAL `kapoor2025hal` | 2025 | paper | 21,730 rollouts; accuracy-vs-cost Pareto (dollars, tokens); log inspection finds shortcuts and unsafe actions | A |
| 8 | Kapoor et al., *AI Agents That Matter* `kapoor2024agentsmatter` | 2024 | paper | Optimize cost jointly with accuracy; holdout sets inadequate; reproducibility poor | A |
| 9 | Atil et al., *Non-Determinism of "Deterministic" LLM Settings* `atil2024nondeterminism` | 2024 | paper | Up to 15% accuracy variation across runs under nominally deterministic settings | A |
| 10 | He (Thinking Machines), *Defeating Nondeterminism* `he2025nondeterminism` | 2025 | blog | Batch-invariance failure under varying server load drives API nondeterminism | A |
| 11 | Dror et al., *Hitchhiker's Guide … NLP* `dror2018hitchhiker` | 2018 | paper | Significance testing often ignored or misused; test-selection protocol | A |
| 12 | Koehn, *Statistical Significance Tests for MT* `koehn2004bootstrap` | 2004 | paper | Paired bootstrap resampling; 95% CI held in 97/100 test sets at 300 items | A/B |
| 13 | Arcuri & Briand, *Hitchhiker's guide … randomized algorithms in SE* `arcuri2014hitchhiker` | 2014 | paper | Fisher exact for pass/fail, A12 or odds-ratio effect sizes, many runs; report raw p-values; critique of Bonferroni | A/B |
| 14 | Dietterich, *Approximate Statistical Tests…* `dietterich1998tests` | 1998 | paper | McNemar is the only acceptable test when an algorithm is run once; the unpaired difference-of-proportions test has high type I error | B |
| 15 | McNemar `mcnemar1947` | 1947 | paper | Test for correlated proportions | B |
| 16 | Fagerland, Lydersen, Laake `fagerland2013mcnemar` | 2013 | paper | Exact conditional McNemar is very conservative; use mid-p (or asymptotic) | B |
| 17 | Wilson `wilson1927` | 1927 | paper | Score interval for a binomial proportion | B |
| 18 | Brown, Cai, DasGupta `brown2001binomial` | 2001 | paper | Wald interval unreliable; Wilson or Jeffreys for small n | B |
| 19 | Hanley & Lippman-Hand `hanley1983rule3` | 1983 | paper | Zero events in n gives a 95% upper bound ≈ 3/n [verify wording] | B |
| 20 | Holm `holm1979` | 1979 | paper | Step-down FWER control, uniformly more powerful than Bonferroni [verify original] | B |
| 21 | DeLong et al. `delong1988auc` | 1988 | paper | Nonparametric comparison of correlated AUCs [metadata only] | B |
| 22 | Sun & Xu `sun2014fastdelong` | 2014 | paper | Fast DeLong algorithm [metadata only] | B |
| 23 | pROC (CRAN) `proc-cran` | 2011/2025 | tool-docs | AUC comparison by U-statistic (DeLong) or bootstrap | B |
| 24 | statsmodels `statsmodels-proportion` | 2025 | tool-docs | Wilson, Jeffreys and Clopper-Pearson CIs; exact or χ² McNemar, no mid-p | B |
| 25 | Connor `connor1987paired` | 1987 | paper | Sample size for paired proportions [formula: verify] | B |
| 26 | Field & Welsh, *Bootstrapping Clustered Data* `field2007clusterboot` | 2007 | paper | Validity of cluster bootstraps depends on the resampling scheme and model; theory is mixed | A/B |
| 27 | Just et al., *Are mutants a valid substitute for real faults?* `just2014mutants` | 2014 | paper | 73% of 357 real faults coupled to mutants; detection correlation independent of coverage; 27% uncoupled to common operators, 17% to any mutant | C |
| 28 | Papadakis et al. `papadakis2018mutation` | 2018 | paper | [verify] Mutation-score/real-fault correlation weak once suite size is controlled | C |
| 29 | Andrews, Briand, Labiche `andrews2005mutation` | 2005 | paper | [verify] Mutants resemble real faults; hand-seeded faults are harder to detect (biased) | C |
| 30 | Gopinath, Jensen, Groce `gopinath2014mutations` | 2014 | paper | [verify] Real fixes differ from typical mutation operators | C |
| 31 | Jahangirova et al., *Test oracle assessment and improvement* `jahangirova2016oracle` | 2016 | paper | Oracle quality = FPs found by test generation + FNs found by mutation; +48.6% fault detection | C |
| 32 | Meiklejohn et al., Filibuster `meiklejohn2021filibuster` | 2021 | paper | Service-level fault injection; corpus from a systematic review of 50 industry chaos talks; fault model = exceptions and error responses; "does not consider the corruption of service responses" | C |
| 33 | Alvaro, Rosen, Hellerstein, LDFI `alvaro2015ldfi` | 2015 | paper | Reason backwards from correct outcomes to the faults that could prevent them | C |
| 34 | Basiri et al., *Chaos Engineering* `basiri2016chaos` | 2016 | paper | "Vary real-world events": sample faults from historical outages | C |
| 35 | Natella, Cotroneo, Madeira, SFI survey `natella2016sfi` | 2016 | paper | Fault representativeness as a core SFI property | C |
| 36 | Durães & Madeira, G-SWFIT `duraes2006gswfit` | 2006 | paper | [verify] Fault types and frequencies from field data | C |
| 37 | WireMock, *Simulating Faults* `wiremock-faults` | 2025 | tool-docs | Delays plus transport/protocol bad responses; semantic drift must be hand-stubbed | C |
| 38 | Hoverfly modes (Diff, Modify) `hoverfly-modes` | 2025 | tool-docs | Diff mode compares live responses with recorded simulation; Modify uses middleware rewrite | C |
| 39 | Shopify Toxiproxy `toxiproxy` | 2025 | repo (MIT) | Transport-level toxics only | C |

## 3. Clusters

**A. Agent-eval statistics (1–13, 26).**
- *Estimators.* There is agreement on the estimators: pass@k [1] and pass^k [2] are unbiased combinatorial estimators from n ≥ k trials.
- *Intervals and uncertainty.* There is no agreement on how to put intervals on them.
  - Miller [3] gives the frequentist toolkit (clustered and paired SEs, power) and assumes large n.
  - Bowyer et al. [4] show that toolkit fails at the scale of most agent benchmarks, and of fiks.
- *Reporting norms.* ABC [6], HAL [7] and AI Agents That Matter [8] add requirements: trivial-agent baselines, verified ground truth, cost reporting, holdouts and log inspection.
- *Nondeterminism.* Atil [9] and He [10] establish that nondeterminism exists even at fixed settings, so k > 1 is required and seeds do not control variance.
- *SE venue norms.* Arcuri & Briand [13] are the SE-venue norm for randomized algorithms. Both the bench agent and the repair agent qualify.

**B. Comparing detectors on the same items (12–25).**
- *Paired tests.* The same calls are labeled by several detectors, so every comparison is paired: McNemar [14–16] for binary detectors, DeLong or paired bootstrap [12, 21–23] for scored detectors.
- *Rates near 0 or 1.* These need score or exact intervals [17–19], not Wald.
- *Multiplicity and power.* Holm handles multiplicity [20]. Power for paired proportions is driven by the discordant cells [25] (and Miller §5).

**C. Validity of seeded faults (27–39).** There are two traditions.
- *Mutation analysis (SE testing).* It asks whether artificial faults stand in for real ones. Just [27] says mostly yes (73% coupled). Papadakis [28] and Andrews [29] add caveats [verify]. Jahangirova [31] turns mutation into an oracle-adequacy measure, which is exactly what a contract is.
- *Fault injection (dependability, distributed systems).* It asks whether injected faults are representative.
  - Natella [35] and Durães [36] cover the dependability side.
  - Chaos Engineering [34] says "sample from historical outages".
  - Filibuster [32] builds its corpus from a systematic review of public incident talks, because real microservice bugs are rarely public.
  - LDFI [33] targets faults by outcome lineage.
- *Tooling.* WireMock, Hoverfly and Toxiproxy [37–39] show what standard tools model: latency, resets, malformed bytes and record/replay diff. Semantic value drift is not on their fault menus.

## 4. Contradictions and why they disagree

| # | Disagreement | Why | What fiks does |
|---|---|---|---|
| X-a | **CLT is fine (and bootstrap unnecessary)** [3 §2.1] vs **CLT and bootstrap under-cover badly at small N** [4 Abstract, §3.1, §3.5] | Regime. Miller's examples have 164–1,000+ questions and he recommends ≥ 1,000 [3 §5]. Bowyer tests N = 3–100. Both agree clustering matters; they disagree on whether a frequentist cluster correction is enough. Bowyer finds only a clustered Bayesian model reached coverage [4 Fig. 3]. | fiks is in Bowyer's regime: 6 tasks, n = 5 per drift. Primary intervals are Wilson for rates and a hierarchical Beta-Binomial with task random effects for pass^1. Miller's clustered SE and the task bootstrap are reported as sensitivity analyses, flagged as likely too narrow. |
| X-b | **Correct for multiplicity (Holm)** [ORCHESTRATION; 20] vs **Bonferroni-type adjustments hinder science; report raw p-values** [13 §9] | Different goals. FWER control suits confirmatory claims; Arcuri & Briand worry about selective non-reporting across many exploratory comparisons. | Pre-register a small confirmatory family (one primary endpoint per headline hypothesis) under Holm. Report every other comparison as exploratory with raw p-values and effect sizes, never "significant". |
| X-c | **Use McNemar** [14] vs **the exact conditional McNemar is too conservative** [16] | Dietterich compares tests at ML sample sizes, where the χ² form is fine. Fagerland studies small matched samples, where the exact conditional test's type I error is "half that of the nominal level or lower". | Use mid-p McNemar for small discordant counts. Report the exact test as well. |
| X-d | **Mutants are a valid substitute for real faults** [27] vs **correlation weak after controlling for suite size** [28, verify] and **hand-seeded faults are biased** [29, verify] | Just controls for coverage, not size. Papadakis controls for size [verify]. Andrews separates mechanically generated mutants from hand-seeded faults [verify]. The fiks-relevant point is in Just's own Table 4: violated pre/post-conditions or invariants are among the uncoupled classes. | Do not argue representativeness from mutation analysis alone. Use the triangulation in §7.3: provenance, predeclared operators, coupling to real bugs and a blind-authored suite. |
| X-e | **Run experiments in production** [34] vs **run them during development, in tests** [32] | Different costs of failure. Chaos targets emergent infrastructure behavior; Filibuster targets bugs knowable at test time. | fiks does both: live proxy observation ("production") and offline replay of recorded upstreams ("development"). The paper should evaluate both separately, as live trials and replay over the logged calls. |
| X-f | **Lower temperature for repeatability?** Miller: "Don't touch the thermostat" [3 §3.3]. Atil and He: even "deterministic" settings vary [9, 10] | Not a real conflict. Both imply you cannot buy variance reduction by changing sampling settings. | Keep default sampling. Use k trials and record model snapshot, date and seed. Treat API nondeterminism as part of the variance to estimate. |

## 5. Claim ledgers for deep-read sources

**Miller 2024 `miller2024errorbars`** (arXiv:2411.00640v1, HTML)
- L1 (§2.2, Table 4): clustered/naive SE ratio 3.05 on DROP; "far from trivial (up to 3X)".
- L2 (§3.1): repeated answers to the same question are not independent. Pooling K×N answers into one SE is wrong, and clustering is needed. This is fiks's k = 5 trials per task.
- L3 (§4.2): use paired SEs "wherever practicable". The gain depends on the correlation of question difficulty between arms. For fiks, task difficulty is highly correlated across phases.
- L4 (§5, Eq. 9–10): sample size n = (z_{α/2}+z_β)²(ω²+σ_A²/K_A+σ_B²/K_B)/δ². With n = 198 questions, raising K from 1 to 10 lowers the MDE from 13.2% to 7.5%. More trials help, but cannot replace more tasks.
- L5 (§3.3): do not tune temperature to cut variance.

**Bowyer, Aitchison, Ivanova 2025 `bowyer2025clt`** (arXiv:2503.01747v3, HTML)
- L1 (Abstract): CLT methods are "usually dramatically underestimating uncertainty".
- L2 (§3.1): "recommend using WS or Bayesian intervals in practice". Clopper-Pearson is exact but conservative.
- L3 (Fig. 3 caption, §3.2): "neither simple CLT nor clustered CLT intervals produce correct coverage". Only a clustered Bayesian model was calibrated.
- L4 (§3.4): "We would recommend using the paired Bayes method".
- L5 (§3.1, §3.5): bootstrap CIs under-cover.
- L6 (§3 set-up): N ∈ {3, 10, 30, 100}; θ drawn from a prior; 200 datasets per θ; 5 seeds. No hard N threshold (§4). Code: `bayes_evals` (MIT).

**Chen et al. 2021 `chen2021codex`** (§2.1 and App. A, PDF text)
- L1 (§2.1, Eq. 1): generate n ≥ k samples, count c, and use 1 − C(n−c,k)/C(n,k). The paper uses n = 200, k ≤ 100.
- L2 (App. A, Fig. 13): the plug-in 1−(1−p̂)^k "results in a consistent underestimate". The gap does not close even when n > 5k.
- L3 (Fig. 3): numerically stable product form.
- Implication: pass^k mirrors this as C(c,k)/C(n,k) [2]. With n = k = 5 (fiks today), each task's pass^5 estimate is a 0/1 indicator. That estimate is unbiased but has maximal variance. Running n = 2K trials (e.g., 10 for K = 5) makes the per-task estimate graded.

**Just et al. 2014 `just2014mutants`** (FSE'14, PDF text)
- L1 (§1, §3.1): 357 real faults, 5 programs, 230,000 mutants. A coupling effect exists for 73% of real faults.
- L2 (§3.3, Fig. 8): mutation score correlates with real-fault detection. The correlation is stronger than for statement coverage and holds independently of coverage.
- L3 (§3.2, Table 4): 27% are not coupled to common-operator mutants. 10% need new or stronger operators. 17% (63 faults) are not coupled to any mutant: algorithm changes (37), code deletion (7), similar method called (5), context sensitivity (4), "Violation of pre/post conditions or invariants" (3), numerical errors (4) and specific literal replacements (3).
- Implication: the fault class fiks targets (wrong-but-valid values, invariant violations) sits where generic code mutation is weakest. So the fault model must be derived from domain evidence, not from a code-mutation tool.

**Meiklejohn et al. 2021 Filibuster `meiklejohn2021filibuster`** (SoCC'21, PDF text)
- L1 (Abstract, §2): real microservice bugs are rarely public, so the corpus (8 small and 4 industrial apps) was built from "50 presentations (representing 32 companies)" on chaos engineering, with stated inclusion criteria.
- L2 (fault list, §5): "Callsite exceptions" and "Error responses" (HTTP error codes with an optional body).
- L3 (§8 "Nondeterminism"): "our design does not consider the corruption of service responses".
- L4 (§8 "Cloud Services"): the authors re-implemented non-HTTP services as HTTP for expediency and argue this is not fundamental. A reviewer will accept that kind of corpus simplification when it is disclosed.
- Implication: Filibuster gives a precedent for an author-built corpus justified by a *systematic, documented review of public incident evidence*. It also confirms that service-level fault injection leaves out exactly the value-corruption class fiks covers.

**ABC, Zhu et al. 2025 `zhu2025abc`** (arXiv:2507.02825v5, HTML, partial)
- L1 (§1): on τ-bench, a trivial agent that returns empty responses is credited on impossible tasks (38%).
- L2 (§4.1 T.7–T.9): verify ground truth and solvability, ideally with an oracle solver.
- L3 (§4.2 O.g.1–O.g.3): state checks must include every successful outcome, plus relevant and irrelevant state.
- L4 (§4.3 R.10, R.12–R.13): report statistical significance; compare with trivial agents.

## 6. What this means for fiks

**Where fiks's current evaluation is weaker than the standard these sources set.**
1. *Unit of analysis.* The headline table is 6 tasks × 5 trials. pass^5 with fiks receipts is 83.3% vs 50% without, which is 5/6 vs 3/6 tasks (README, bench).
   - Paired by task, at most 2 tasks are discordant. Mid-p McNemar needs ≥ 5 discordant units all in one direction to reach p < .05, and the exact test needs 6 (our arithmetic).
   - So **no task-level test on the current bench can reach significance**, whatever the effect.
   - Trial-level counts (25/30 vs 18/30 correct) are clustered in 6 tasks [3 §3.1]. Treating them as 30 independent units is the anti-conservative error Miller and Bowyer warn about.
   - Illustrative Wilson intervals (ours, from README counts): 18/30 → [0.42, 0.75] and 25/30 → [0.66, 0.93]. Even unclustered, they overlap.
2. *pass^k with n = k.* Each task's estimate is an indicator [1, 2]. Running n = 2K trials makes it graded and lowers variance.
3. *False-positive bound.* "0 violated receipts in 30 v1 trials" bounds the per-trial FP rate only at ≈ 10% (rule of three) or 11.3% (Wilson upper) [17–19].
   - H5's target (Wilson upper ≤ 2%) needs ≥ 189 clean receipts with 0 FPs, or ≥ 280 with 1 FP (our computation).
   - Receipts within a trial are correlated, so the paper should also report the per-trial and per-task bound.
4. *Detector comparisons (H1, H3).*
   - Contracts are binary. Their ROC is a single point, so their AUROC equals balanced accuracy. Compare them by paired sensitivity and specificity (mid-p McNemar on discordant calls) [14, 16].
   - Use DeLong or paired bootstrap AUROC only for scored detectors such as an LLM judge with confidence [12, 21].
   - Calls are clustered within trials, tasks and drift classes. Resample at the drift-scenario or task level [26]; DeLong's independence assumption does not hold.
5. *Seeded faults (M2).* D1–D9 and S1–S12 are author-designed. Andrews [29, verify] is the canonical citation a reviewer will use against hand-seeded faults.
6. *ABC grader issues.*
   - The D3 order task counts "could not confirm" as a failure, though fiks argues that is the right answer. That is ABC's impossible-task problem in reverse [6].
   - Add a **trivial always-decline agent** and an **always-trust agent** (R.12–R.13). Also report the D3 grading under both policies.

**Where fiks differs, which helps.**
- Its oracle is not authored per fault. Contracts are written once per tool, and drifts are applied to the upstream. Jahangirova's FP/FN protocol [31] can measure that oracle independently of the fault authors.
- Ground truth is the vendor's own state (state-based grading, ABC O.g). This avoids the LLM-judge grading confound.
- It records raw upstream HTTP, so every detection can be **replayed offline** without model nondeterminism. Detection rates (H1, H3, H5, H13) are then deterministic per call, and only agent-level outcomes (RQ5) need the small-N agent statistics.

**Strongest counter-argument a reviewer would raise.** In paraphrase:

> "The fault model, the contracts and the bench tasks were written by the same team. The seeded faults are exactly the invariant-violation class that Just et al. show generic mutants do not couple to, so there is no independent evidence they resemble real drift. With 6 tasks and 5 trials, no with-vs-without difference is statistically distinguishable. The 0/30 FP claim bounds FP only at ~11%."

The answer has to come from data, not argument. The required data is §7 H-M1 to H-M4, plus the real-bug harness and the blind-authored suite (SYNTHESIS G3).

## 7. Candidate hypotheses (methodological) and what falsifies them

| ID | Hypothesis | Test (pre-registered) | Falsified if |
|---|---|---|---|
| H-M1 | With the task set expanded (≥ 25 tasks across DriftBench v2 and the τ² drift layer), receipts raise the per-task success proportion vs no-fiks | Primary: exact paired sign-flip permutation test on per-task differences in success proportion. Interval: hierarchical Beta-Binomial (task random effect) for the difference. Sensitivity: task-cluster bootstrap and `bayes_evals` paired comparison. Holm within the confirmatory family. | 95% interval for the difference includes 0, or Holm-adjusted p ≥ .05 |
| H-M2 | Contract oracle adequacy: on response-level mutants of recorded v1 upstream payloads, generated by a predeclared operator set written before contracts were frozen (scale ×100/÷100, rename, drop, null, truncate/paginate, type swap, epoch/ISO swap, enum injection, string perturbation), contracts miss few non-string mutants | Jahangirova-style FN rate per operator [31]; Wilson CI per operator | FN rate > 50% on any non-string operator class, or the string-perturbation (S12) class is *not* the worst. The latter would mean the operator set is too easy. |
| H-M3 | Coupling: seeded drift classes are coupled to real bugs. Every real bug (R1–R25) that fiks detects is detected by a contract template that also fires on at least one seeded drift. | Coupling table in the style of Just et al. §3.1 [27] | < 50% of detected real bugs share a template with any seeded drift. That would mean the seeded suite does not represent what fiks catches in the wild. |
| H-M4 | Clean false positives are rare per receipt | 0–1 FPs over ≥ 189 / ≥ 280 clean receipts on v1, benign v1b and organic traffic; also report per-trial and per-task bounds | Wilson 95% upper bound > 2% |
| H-M5 | Trial-to-trial variance within tasks is non-negligible, which justifies k ≥ 5 | ICC of trial outcomes within task, by phase; report the share of tasks with 0 < c < n | ICC ≥ 0.95 in every phase, so k = 1 would have sufficed. Report either way. |
| H-M6 | Trivial agents do not explain the gains | Always-decline and always-trust agents on every phase, under both D3 grading policies | Either trivial agent matches the with-receipts arm on pass^1 in any phase |
| H-M7 | Detection results are deterministic under replay | Re-run offline replay of the logged calls 3×; detection and receipts identical | Any receipt differs across replays. Fix this before using any detection statistic. |

Power, illustrative and ours: by the paired-proportion formula usually attributed to Connor [25] (formula [verify]), discordance p10 = .30 vs p01 = .05 needs ≈ 42 paired units at α = .05 and power .8. p10 = .20 vs p01 = .05 needs ≈ 85. With ~25 tasks × multiple drifts as paired units, H-M1 is feasible only for large effects. The plan should state the MDE at the chosen n (Miller Eq. 10) instead of claiming adequate power.

## 8. Candidate baselines we could actually run

| Baseline | Role | License | How |
|---|---|---|---|
| Always-decline agent; always-trust agent | ABC trivial-agent check (H-M6) | ours | Scripted `submit_answer` policies in `bench` |
| Hoverfly **Diff mode** (recorded-response oracle) | RQ1 detector: flags any deviation from v1 recordings. It should get high drift recall and fire on every benign v1b change. | Apache-2.0 [verify] | Hoverfly in front of vendor-api, simulation captured on v1, then v2 and v1b replayed through diff |
| Hoverfly **Modify** / WireMock stubs | Independent drift injector for the blind-authored suite. A third party writes middleware and fiks never sees it. | Apache-2.0 [verify] | Middleware rewrites vendor responses per a sealed drift spec |
| Toxiproxy / WireMock transport faults | Negative control: transport faults must surface as errors, not as "violated" receipts | MIT / Apache-2.0 | Run D0-transport scenarios. Expect the receipt "unverifiable" or an error, never "verified". |
| Response-mutation generator (ours) | Oracle-adequacy FN measurement (H-M2) | ours | Operators over recorded upstream JSON; replay offline |
| Filibuster | Shows the injection-based alternative cannot express value corruption. Optional, Python-only. | Apache-2.0 | Only as a cited contrast; porting to TS shop-mcp is not worth it |
| Analysis stack | Intervals and tests | statsmodels (BSD-3), `bayes_evals` (MIT), pROC (GPL-3, external R) | `paper/scripts/` computes Wilson and Jeffreys, mid-p McNemar (by hand), sign-flip permutation, task bootstrap, a hierarchical Beta-Binomial model and DeLong; pROC is used only to cross-check |

## 9. Open gaps

1. **Recent literature not searched.** The WebSearch budget was exhausted. Agent-eval statistics papers from 2025-26 beyond HAL, ABC and Bowyer are not covered. Examples: reliability-focused agent metrics, variance studies on τ²-bench or SWE-bench, and inference-time nondeterminism in agents. Re-run discovery when the budget allows.
2. **No source gives a CI for pass^k specifically.** We found none in the sources read. The proposed approach (hierarchical Beta-Binomial per task, then the pass^k functional of the posterior; or a task bootstrap) is our inference and needs a statistician's check or a source.
3. **Metadata-only sources need full-text verification before citing claims beyond the title:** Papadakis 2018, Andrews 2005, Gopinath 2014, Durães & Madeira 2006, DeLong 1988, Connor 1987 (exact formula), Hanley & Lippman-Hand 1983 (exact wording), Holm 1979 (original).
4. **Clustered ROC.** A source for AUROC with clustered observations (Obuchowski 1997, *Biometrics*, is the usual citation) was not retrieved [verify].
5. **HAL appendices** were not read for per-task repeat counts or variance reporting. ABC's last ~60k characters were not read.
6. **WireMock and Hoverfly licenses** were not confirmed from the pages fetched.
7. **Representativeness weights.** If pooled detection is reported, the class weights should come from field frequencies (C3 category shares, à la Durães [36]). Mapping S1–S12 onto C3 categories is not done yet.
