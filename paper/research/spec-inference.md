# Specification and invariant inference: research notes for fiks

Area: spec-inference. Researcher pass dated 2026-10-21. Machine-readable catalog: `spec-inference.sources.json` (35 sources).
Status: one researcher pass. Nothing here has been checked by a citation verifier yet. Items marked [verify] could not be fully re-checked against the primary text.

## 1. Scope and question

fiks's contracts are hand-written (`packages/contracts/contracts/shop-mcp.contracts.json`, 4 tools). C11 shows that detection outside the contract vocabulary drops to about 46%. That limit has two sides. One is coverage: which properties exist at all. The other is authoring cost: someone has to write them for every server.

Question for this area: **can fiks infer outcome contracts automatically from v1 (pre-drift) traffic, and what precision and false-positive rate should we expect from the published evidence?** We also want algorithms we can implement against the existing `Invariant` union (`range | notNull | nonEmpty | countMatchesTotal | freshness | equalsUpstream | unique`, plus `ReadAfterWrite`).

### Searches run (2026-10-21, WebSearch standard unless noted)
1. Daikon, dynamic detection of likely invariants (Ernst)
2. nl2postcond (LLM postconditions)
3. AGORA test oracles for REST APIs (Daikon)
4. SpecGen LLM formal specifications
5. DIG polynomial invariants
6. Texada LTL specification mining
7. AutoSpec
8. Metamorphic testing of RESTful web APIs
9. JSON schema inference for massive datasets (Baazizi et al.)
10. Polikarpova et al., programmer-written vs inferred contracts
11. Deequ constraint suggestion
12. Twitter Diffy noise cancelling
13. SATORI / MASTOR LLM REST oracles
14. TOGA large-scale re-evaluation
15. TFX / TFDV data validation
16. Pei et al., LLMs and program invariants
17. SpecFuzzer
18. Outcome Monitors arXiv 2608.19303 (extended)
19. LLM invariant inference from traces, 2025-26 (extended)
20. ClearView
21. Lou et al., log invariants
22. Ammons et al., mining specifications (existence confirmed only; not catalogued)
23. Jahangirova et al., oracle assessment (not catalogued)
24. LLM metamorphic relation generation
25. Jxplain JSON schema discovery
26. Staats et al., user understanding of invariants
27. OpenAPI from traffic (mitmproxy2swagger / Optic / Akita)
28. Great Expectations data assistants (not catalogued; API churn)
29. Perracotta (not catalogued)
30. MCP output-schema inference / contract mining, 2026 (extended; no direct hit)
31. Konstantinou et al. on actual vs expected oracles
32. Regression oracles and noisy-field inference (vendor material only)
33. DeepLog
34. Le and Zhang, log anomaly detection
35. AgentSpec

Full text was read for these, via arXiv HTML or local `pdftotext` of the fetched PDF:
- Outcome Monitors (2608.19303)
- nl2postcond (2310.01831v2, including Sec. 4.3.2 and Sec. 6)
- Lou et al. ATC'10
- Deequ PVLDB'18 (Sec. 3.3, 5.3)
- MASTOR (metrics and related work)
- Lisa (2607.18711, first 100k characters)
- ContrAgent (2609.18128)
- Contract2Tool (2606.07904)

For the remaining sources we read only the abstract or README.

## 2. Source catalog

| # | Source | Year | Type | Central claim (short) | Cluster |
|---|---|---|---|---|---|
| 1 | Outcome Monitors (Panthi, Abdelfattah) [C11] | 2026 | paper | Template-mined outcome contracts from nominal traces. 0.80% FP on organic held-out traffic. About 46% detection outside the vocabulary. | A. Agent-tool contracts |
| 2 | Contract2Tool | 2026 | paper | LLM-generated requires/produces contracts. Traces beat docs (0 extra tools vs 0.08–0.40). | A |
| 3 | ContrAgent (Xiao, Nuzzo) | 2026 | paper | LTLf assume-guarantee contracts over tool calls. <1% FP for 19/23 models. Only what call structure exposes. | A |
| 4 | AgentSpec | 2026 | paper | LLM-generated runtime rules: 95.56% precision, 70.96% recall (embodied). | A |
| 5 | Lisa | 2026 | paper | Daikon filtered by docs plus LLM invariants: 12/25 bugs vs 5/25 for Daikon-only. | C. LLM specs |
| 6 | AGORA | 2023 | paper | Daikon on REST traffic: 81.2% precision, ~60% of seeded output errors, 11 bugs. | B. API traffic oracles |
| 7 | AGORA+ | 2025 | paper | 106 invariant types: 80% precision, 48% of seeded errors, 32 bugs. | B |
| 8 | Beet (repo) | 2025 | repo | OpenAPI + request/response CSV to Daikon. GPL-3.0. Arithmetic comparisons are the main FP source. | B |
| 9 | SATORI | 2025 | paper | Static LLM oracles from OpenAPI: F1 74.3% vs AGORA+ 69.3%. Together they find 90% of oracles. | B |
| 10 | MASTOR | 2026 | paper | Multi-agent LLM oracles from source: 75.4% mutation score. Precision not used, since there is no ground truth. | B |
| 11 | RESTOR | 2026 | paper | GRPO-tuned small LLM, one request/response pair: 85.42% F1 on key fields. ByteDance adoption above 96%. | B |
| 12 | Segura et al., MT of REST APIs | 2018 | paper | Metamorphic relation output patterns. 60 relations for Spotify/YouTube. | D. Metamorphic |
| 13 | Zhang et al., LLM MRs | 2025 | paper | 34–50% of LLM-proposed MRs are valid. | D |
| 14 | nl2postcond | 2024 | paper | LLM postconditions from NL: 64 Defects4J bugs. Daikon gave only 3 bug-discriminating postconditions. | C |
| 15 | SpecGen | 2025 | paper | LLM plus mutation plus verifier: 279/385 programs. | C |
| 16 | AutoSpec | 2024 | paper | Static analysis plus verifier-guided LLM specs: 79% verified. | C |
| 17 | Pei et al. | 2023 | paper | Static LLM invariants ≈ a dynamic tool with 5 traces. | C |
| 18 | Konstantinou et al. | 2024 | paper | LLM oracles capture actual, not expected, behavior. | E. Critiques |
| 19 | Molinelli et al. | 2025 | paper | LLM oracles ≈ human mutation score on a post-cutoff dataset. Leakage matters. | E |
| 20 | TOGA re-evaluation (Hossain et al.) | 2023 | paper | >47% of neural assertion oracles are false positives. | E |
| 21 | Daikon (SCP) | 2007 | paper | Template invariants true over observed runs. | F. Dynamic invariants |
| 22 | Daikon manual | 2026 | tool-docs | Confidence limit .99. Never output a falsified invariant. Redundancy suppression. | F |
| 23 | DIG | 2014 | paper | Generative nonlinear invariants rather than template filtering. | F |
| 24 | Texada | 2015 | paper | Mines arbitrary LTL templates from logs, with support and confidence. | F |
| 25 | SpecFuzzer | 2022 | paper | Fuzz candidates, Daikon-filter, rank by mutants. | F |
| 26 | Polikarpova et al. | 2009 | paper | Inferred vs written contracts: 5× relevant, 60% recall, ~1/3 wrong or irrelevant. | E |
| 27 | Staats et al. | 2012 | paper | Humans misclassify 9–32% of correct and 26–59% of incorrect invariants. | E |
| 28 | ClearView | 2009 | paper | Learn invariants, detect violation, auto-patch binaries. 7/10 exploits corrected. | G. Invariant-driven repair |
| 29 | Lou et al., log invariants | 2010 | paper | Linear count invariants. 0 wrong invariants but thousands of FP alarms (speculative tasks). | H. Anomaly detection |
| 30 | Le and Zhang | 2022 | paper | Deep log anomaly detection results do not survive realistic evaluation. | H / E |
| 31 | Deequ | 2018 | paper | Profile-to-constraint heuristics. 10/90 held-out coverage. Categorical and unique are FP-prone. | I. Data validation / schema |
| 32 | TFDV / Data Validation for ML | 2019 | paper | Infer schema, validate, detect skew. Google production. | I |
| 33 | Jxplain | 2021 | paper | Naive JSON schema discovery is imprecise on APIs and gives validation FPs. | I |
| 34 | Diffy | 2015 | repo | Primary/secondary noise cancelling for response diffs. | I / B |
| 35 | mitmproxy2swagger | 2026 | repo | OpenAPI from captured traffic (structure only). MIT. | I |

## 3. Clusters

**A. Contracts for agent tools (2026).** Outcome Monitors [C11] is the direct precedent for fiks inference. It mines contracts with no model calls, using five template classes:
- echo
- positivity
- categorical domain
- affine
- date ordering

It keeps an invariant only if it holds on every training sample and meets a per-class support minimum. Workflows are cross-fitted five-fold, and FPs are measured on held-out clean traffic. Contract2Tool and ContrAgent infer or lift contracts for tool selection and temporal safety, not output correctness. AgentSpec shows that LLM-generated rules have high precision and lower recall.

**B. Oracles from API traffic or specs.** AGORA/AGORA+ is Daikon over REST traffic, with about 80% precision per invariant. SATORI is an LLM over the OpenAPI spec. AGORA+ and SATORI are complementary: together they find 90% of ground-truth oracles. MASTOR is an LLM over the source. RESTOR is an RL-tuned LLM over a single pair, with a noise-avoidance reward. The common thread: separate stable from dynamic fields, and report per-invariant precision.

**C. LLM-generated specifications.** nl2postcond, SpecGen, AutoSpec, Pei et al. and Lisa all generate specifications with an LLM and then filter them with a checker: a verifier, a test suite or documentation. Several of these papers report that intent-derived specs find bugs that trace-mined invariants miss.

**D. Metamorphic relations.** Relations across calls avoid needing the correct value, for example that a filtered result is a subset of the unfiltered one. LLMs propose them, but only a third to a half of the proposals are valid.

**E. Critiques and replications.** Several studies question these results:
- Inferred contracts are partially wrong: about 1/3 (Polikarpova et al.).
- Humans cannot reliably vet them (Staats et al.).
- Neural oracles have high FP (TOGA re-evaluation).
- LLM oracles encode actual rather than expected behavior (Konstantinou et al.).
- Training-data leakage inflates results (Molinelli et al.).

**F. Classical dynamic invariant and specification mining.** Daikon's grammar plus statistical justification, DIG's generative relations, Texada's temporal templates with support and confidence, and SpecFuzzer's generate-falsify-rank pipeline.

**G. Repair from invariants.** ClearView is the closest end-to-end precedent for "learned invariant → violation → patch".

**H. Anomaly detection.** Count invariants from logs (Lou et al.) give interpretable alarms but still raise FPs on legitimate rare behavior. Learned detectors are fragile under realistic evaluation (Le and Zhang).

**I. Data validation and schema inference.** Deequ and TFDV infer constraints from profiles and expect a human to curate them. Jxplain shows that naive JSON schema inference is FP-prone on API data. Diffy cancels noise by running two copies of the old version. mitmproxy2swagger infers structure only.

## 4. Contradictions and why they disagree

1. **How good are Daikon-style inferred invariants?** Three groups of results:
   - Positive: AGORA/AGORA+ report 80–81% precision, and Lou et al. found "no false positive invariant".
   - Mixed: Polikarpova et al. find about 1/3 of inferred clauses incorrect or irrelevant.
   - Negative: nl2postcond found only 3 bug-discriminating Daikon postconditions, and Lisa's Daikon-only variant found 5/25 bugs with "substantial noise".

   Why they disagree:
   - (a) Different metrics: precision of each invariant (is it true?) vs bug-discrimination (does it catch a fault?).
   - (b) Different data: REST outputs and logs are value-rich and repetitive, while Java methods were exercised by weak regression tests.
   - (c) Different purpose: Lisa (Sec. VII-C) says Daikon suits regression detection, not functional-bug detection.

   For fiks, vendor drift is a regression relative to v1, which is the setting where trace mining is strongest.

2. **Correct invariants can still give false alarms.** Lou et al. had zero wrong invariants, yet 1777 + 778 FP alarms from legitimate rare behavior (speculative and cleanup tasks). Outcome Monitors report 0.80% FP per organic response, concentrated in 54 of 427 tools. Per-invariant precision (as in AGORA) is not per-alarm FP. fiks must report per-receipt FP on clean traffic.

3. **LLM vs dynamic inference.**
   - Pei et al.: static LLM ≈ Daikon with 5 traces.
   - nl2postcond: LLM postconditions discriminate far more bugs than Daikon.
   - Konstantinou et al.: LLM oracles mostly capture actual behavior.
   - TOGA re-evaluation: >47% FP.
   - Molinelli et al.: LLM ≈ human mutation score on post-cutoff data.

   These disagree because:
   - LLMs given natural-language intent (nl2postcond) can encode expected behavior.
   - LLMs given only code (Konstantinou) copy it.
   - Results on public benchmarks may be inflated by leakage (Molinelli).
   - Mutation score rewards strong oracles but does not penalize wrong ones the way an FP metric does.

4. **Static vs dynamic REST oracles.** SATORI beats AGORA+ on F1 (74.3% vs 69.3%), yet MASTOR reports SATORI at only 20.5% mutation score. These are different metrics (F1 against an annotated ground truth vs mutation score) on different subjects (black-box industrial APIs vs open-source APIs with code). Both lines agree the approaches are complementary.

5. **Which templates produce FPs?** All three sources agree that the "domain" templates (categorical, unique, arithmetic comparisons) are the FP-prone ones:
   - Deequ: the categorical `lang` domain and a spurious `isUnique` failed on held-out data.
   - Beet README: arithmetic comparisons are the main FP source.
   - Outcome Monitors: `unseen_category` is in the frozen vocabulary.

   Null, type and positivity checks are reported as stable. This is a convergent finding, not a contradiction, and it should drive which templates fiks enables by default.

## 5. Claim ledgers (deep-read sources)

**Outcome Monitors [C11], arXiv 2608.19303**
- L1. Mining is template-based with a per-class support minimum, and an invariant must hold on all training samples (Sec. 3.2, Alg. 2).
- L2. 15,041 invariants were mined from 400 nominal workflows, five-fold cross-fitted, with zero model calls in under 2 s (Sec. 3.3).
- L3. FP rates: 1.39% per outcome on synthetic clean traffic, and 0.80% of 6,860 organic held-out responses, concentrated in 54/427 tools. Flags were not adjudicated (Sec. 3.2, Sec. 5.5, App. O).
- L4. In-vocabulary audit flags 79.6% of implicit faults. The authors warn the miner and the injector may be aligned (Sec. 3.2, Sec. 6).
- L5. On the incident-derived suite authored blind to the vocabulary, same-tool detection is 46.1% / 45.3%. Recall is 83% for structured values and 22% for corruption inside plausible strings (Sec. 5.5, App. G).
- L6. The gain comes from the recovery-tool list, not from diagnostic detail (ablations).

**nl2postcond, FSE 2024**
- L1. GPT-4 produced a test-set-correct postcondition for 96% (158/164) of EvalPlus problems (Sec. 3.2.1).
- L2. Bug-discriminating postconditions for 70 methods from 64 Defects4J bugs, 12.2% of 525 (Sec. 4.2.2).
- L3. Daikon gave 3 bug-discriminating postconditions, 2 of which overfit the regression tests. It produced nothing for 17/101 bugs and timed out on 6 (Sec. 4.3.2).
- L4. False positives from incomplete test suites affected 1.1% of 900 annotated postconditions (Sec. 3.2.1).
- L5. Threats to validity: leakage and model drift (Sec. 6).

**Lou et al., USENIX ATC 2010**
- L1. Linear invariants among counts of log message types, e.g. count(JVM spawned) = count(JVM exited) (Sec. 5).
- L2. On ~24M Hadoop log lines, "No false positive invariant is found" (Sec. 5).
- L3. FP alarms still occurred: 1777 (killed speculative tasks) and 778 (job setup/cleanup) (Table 5).
- L4. The authors argue the number of FP types matters more than the count, because an operator can suppress a type once (Sec. 5).

**Deequ, PVLDB 2018**
- L1. Constraint-suggestion heuristics: complete in the sample → `isComplete`. Incomplete → `hasCompleteness` at the lower bound of a Bernoulli CI. Non-string type → `hasConsistentType`. HyperLogLog distinct ratio → `isUnique`. Numeric range → compliance. Few distinct values → `isInRange` (Sec. 3.3).
- L2. Suggestions are made on a 10% sample, with coverage measured on the other 90%. All reddit constraints held. On twitter, a categorical `lang` domain and a spurious `isUnique` (64% unique in the test data) failed (Sec. 5.3, Table 3).
- L3. A column-name classifier vetoes the spurious unique suggestion: 2% vs 81% score (Sec. 5.3).
- L4. Suggestion is human-in-the-loop by design (Sec. 3.3).

**AGORA / AGORA+ (abstracts plus the Beet README)**
- L1. 81.2% precision on 11 operations / 7 APIs (2023), and 80% on 25 operations / 20 APIs (2025).
- L2. Seeded output errors caught: ~60% (2023) and 48% (2025).
- L3. Bugs found: 11 (2023) and 32 (2025).
- L4. Beet input is the OpenAPI spec plus a CSV of requests and JSON responses. GPL-3.0. A developer confirms invariants, and arithmetic comparisons are the main FP source [verify the README wording].

**MASTOR, arXiv 2606.10465 (metrics and related work)**
- L1. Mutation score was chosen over precision or F1 because no complete ground-truth oracle set exists.
- L2. AGORA+ coverage depends on the diversity of the traces available.
- L3. AGORA+ was excluded from the baseline comparison as non-LLM.

## 6. What this means for fiks

### 6.1 An inference algorithm we can implement (grounded per step)
Function: `inferContracts(recordings) -> ContractFile`, using the inputs listed in codebase-map §4 (v1 fixtures, bench A proxy logs, scenario runs).

1. **Flatten.** Turn each tool result's `structuredContent`, the upstream JSON, the tool args and the HTTP metadata into paths (`items[*].price`). The tap pairs each tool call with its upstream exchange.
2. **Cancel noise first (Diffy).** Replay every v1 call twice against the same vendor version. Any path whose value differs between the two replays is *dynamic* (ids, timestamps, request ids). It is excluded from equality and categorical templates. RESTOR's reward for "avoidance of dynamic noise" is the learned version of this step.
3. **Instantiate templates over the existing vocabulary.** Each fiks kind maps to a source template:

   | fiks kind | Template and source |
   |---|---|
   | `notNull` / `nonEmpty` | Deequ `isComplete`; Daikon `x != null` |
   | `range` | Daikon `a ≤ x ≤ b`; Deequ compliance; Outcome Monitors positivity |
   | `unique` | Deequ `isUnique`, vetoed when uniqueness is not id-like |
   | `countMatchesTotal` | Daikon linear relation `size(items) = total`; Lou count invariants |
   | `freshness` | Outcome Monitors date ordering |
   | `equalsUpstream` | Outcome Monitors echo, applied across the wrapper boundary (tool output ↔ upstream JSON) |
   | `ReadAfterWrite` | Texada "x always precedes y" with support/confidence over call sequences (mutating call → probe returns same id) |

   For `range`, widen the observed bounds by an order-of-magnitude band. This is a design choice; nothing in the sources sets the factor. For `freshness`, widen the window from the observed ages.
4. **Justify statistically.** Keep a template only if it was never falsified and has enough support. Use Daikon's confidence rule (`--conf_limit` .99, so ≥7 agreeing samples for a 1/2-chance template) and Outcome Monitors' per-class support minimum. Use Deequ's CI lower bound for anything rate-based.
5. **Disable FP-prone templates by default.** Leave categorical domains, arithmetic comparisons and non-id uniqueness off by default (Deequ, Beet, Outcome Monitors §4.5).
6. **Optional intent channel (nl2postcond, SATORI, Lisa).** An LLM proposes candidate contracts in the fiks DSL from the MCP tool description and `outputSchema` [C26], for example "price is in USD dollars, 0.5–10,000". A candidate survives only if it holds on all v1 traffic (SpecFuzzer, Lisa). Rank the survivors by how many blind-authored upstream mutants they kill (SpecFuzzer, Jahangirova et al.). The mutants must be authored without sight of the templates (Outcome Monitors Sec. 4.3).
7. **Measure FP the way Outcome Monitors and Deequ do.** Use k-fold cross-fitting over v1 calls and report per-receipt FP on held-out clean traffic. Use per-check FP, not per-invariant precision and not mutation score.

**Where the upstream boundary gives fiks something AGORA lacks.** AGORA sees only the API's own input and output. Outcome Monitors see only the tool result. The fiks tap sees both the upstream response and the tool output for the same call, so it can mine *translation invariants* of the wrapper (`output.price == upstream.price`, `output.total == upstream.total`).

- These are only partly new: fiks already has a hand-written `equalsUpstream`.
- They catch D2-style silent renames. The upstream path disappears, so the invariant becomes unverifiable or violated.
- They do not catch D1 unit drift, because the wrapper passes cents straight through. The `range` band or per-entity stability is needed for that.
- We found no paper that mines invariants across a wrapper's upstream/downstream boundary for silent-failure detection. Absence of evidence is not proof.

### 6.2 Where fiks is weaker than prior work
- **Scale of evaluation.** AGORA+ covers 25 operations across 20 real APIs and found 32 real bugs. Outcome Monitors cover 427 tools and 6,860 organic responses. fiks has 4 tools and 1 mock vendor, with about 47 v1 calls today (10 fixtures plus 37 bench calls).
- **Vocabulary.** fiks has 7 invariant kinds plus read-after-write. Daikon/AGORA+ has 106. fiks has no cross-call metamorphic relations, so D4-like pagination is caught only by `countMatchesTotal`, which depends on the vendor's own `total`. The README notes the search task's `total` stays 7 even when one page returns.
- **Out-of-vocabulary faults.** Outcome Monitors' blind suite gave 46% detection and 22% for corruption inside plausible strings. fiks's D1–D5 were designed alongside the contract kinds, so the miner/injector alignment warning (Outcome Monitors Sec. 6) applies fully.

### 6.3 Strongest counter-argument a reviewer will raise
"Contracts inferred from v1 are regression oracles of *actual* behavior (Konstantinou; Lisa Sec. VII-C; nl2postcond Sec. 4.3.2). Every legitimate vendor change will produce violations, and fiks will then open PRs that 'fix' the tool back toward v1 semantics. AGORA+ and Outcome Monitors already infer invariants from API/tool traffic with measured precision. Your inference is not novel, and your seeded drifts were built to match your vocabulary."

Our answer has to be empirical:
- (a) Measure FP under *benign* vendor evolution: added fields, new enum values, reordered arrays, new products outside the observed price range.
- (b) Measure detection on drifts authored blind to the templates.
- (c) Present inference as an enabler that we replicate and adapt from Outcome Monitors, Daikon and Deequ, not as the contribution. The paper's novelty claim stays the loop: violation → repro (F-gate) → gated PR [C19, C28].
- (d) Show that an inferred-contract violation still yields a valid F→P reproduction. The F-gate filters spurious contracts: a violation that cannot be reproduced deterministically never reaches repair.

Point (d) is a mechanism neither AGORA nor Outcome Monitors has, and it is testable.

**Second counter-argument: "Why not just diff v1 against v2, like Diffy?"** Diffy needs a live known-good instance next to the candidate. A third-party vendor gives you only the current version. Contracts are the compressed memory of v1. This is an argument, not a measurement. We can measure it by running Diffy-style diffing as an oracle upper bound in the mock, where v1 *is* available.

## 7. Candidate hypotheses (each with a falsifying result)

- **H-SI1 (inferred ≈ hand on seeded drifts).** Contracts inferred from v1 traffic detect at least as many of D1–D5 as the hand-written contracts.
  *Falsified if* the inferred set misses any of D1–D3 that the hand set catches, at the default template configuration.
- **H-SI2 (low FP on clean traffic).** Inferred contracts produce ≤1% violated receipts per call on held-out v1 traffic under k-fold cross-fitting. This is the same order as Outcome Monitors' 0.80–1.39%.
  *Falsified if* the upper bound of the 95% Wilson CI exceeds 2%.
- **H-SI3 (benign evolution).** On a benign-drift vendor (v1b: added fields, new categories, reordered arrays, new in-range products), inferred contracts with FP-prone templates disabled raise ≤1 false receipt type per tool.
  *Falsified if* any default-enabled template fires on benign drift, or if enabling categorical/unique templates does not raise FP. The second case would contradict Deequ, Beet and Outcome Monitors.
- **H-SI4 (vocabulary limit replicates).** On drifts authored blind to the template set, inferred-contract detection is markedly lower than on D1–D5, replicating C11.
  *Falsified if* blind-drift detection is within 10 points of seeded-drift detection. That would suggest our seeded drifts are not easier, which would be good news, and must be reported either way.
- **H-SI5 (intent channel helps out of vocabulary).** Adding LLM-proposed, traffic-filtered contracts from tool descriptions raises blind-drift detection at equal or lower FP.
  *Falsified if* detection does not rise, or FP rises above H-SI2's bound (Konstantinou-style "actual behavior" failure, or the 50% invalid-MR rate of Zhang et al. leaking through).
- **H-SI6 (F-gate as a contract filter).** Every inferred-contract violation that fiks forwards to repair yields a repro test that fails for the stated property on current code and passes after the fix.
  *Falsified if* any inferred-contract trace produces an F-gate failure "for the wrong reason", or a PR whose only effect is to restore v1 behavior on a benign change.
- **H-SI7 (learning curve).** FP falls monotonically with the number of v1 calls, and there is an N at which the range/notNull FP stays ≤1%.
  *Falsified if* FP does not decrease with N, which would mean templates are overfitting structure rather than sample size.

## 8. Candidate baselines we can actually run

| Baseline | License | How |
|---|---|---|
| **Hand contracts** (current) | ours | as-is |
| **Inferred outputSchema only** (genson/quicktype-style, or Jxplain heuristics) | genson MIT, quicktype Apache-2.0 [verify] | infer JSON Schema from v1 `structuredContent`, run with `invariants: []`. Expected recall ≈ 0 on D1/D5 [C4] |
| **mitmproxy2swagger + spec-diff** | MIT | convert tap HAR to OpenAPI for v1 and v2, then diff (oasdiff, C27). Shows behavioral drift is invisible to structural inference |
| **AGORA+ (Beet + modified Daikon)** | GPL-3.0 | export v1 upstream exchanges as OpenAPI + CSV, run the Docker image `javalenzuela/daikon_agora`, translate the supported subset to fiks kinds or evaluate its Postman assertions directly. Run as a separate process; do not vendor the code |
| **Outcome Monitors miner** | code availability [verify] | otherwise reimplement the five classes from Sec. 3.2 / App. E (echo, positivity, categorical, affine, date ordering) in `infer.ts` as a named replication |
| **Deequ-heuristics reimplementation** (or PyDeequ, Apache-2.0 [verify]) | – | apply the six documented rules to flattened tool outputs, with the 10/90 protocol |
| **TFDV `infer_schema` + `validate_statistics`** | Apache-2.0 | on flattened tool outputs; statistics-drift option for D1 |
| **Diffy-style differential oracle** | Apache-2.0, archived | replay each call on v1 and v2 vendors with primary/secondary noise cancelling. Upper bound only, since it is not deployable against real vendors |
| **LLM postconditions (nl2postcond-style)** | repo microsoft/nl-2-postcond, license [verify] | prompt the same Claude model with tool description + outputSchema, emit fiks DSL, filter on v1 traffic. Ablation: unfiltered |

## 9. Open gaps
1. No published FP rate for traffic-inferred contracts under *benign* upstream evolution. All reported FPs are on same-version clean traffic.
2. No work mines invariants across a wrapper's upstream/downstream boundary (MCP server = function from upstream response to tool result). We searched for MCP output-schema inference in 2026 and found none; absence of evidence is not proof.
3. No study connects contract inference quality to *repair* quality. A weak inferred contract invites an overfitting fix. The README already notes a constant in-range price would pass; this relates to C20.
4. Unit and scale drift (D1) needs relational or distributional invariants: per-entity stability for known-good inputs, or a log-magnitude shift. None of the sources evaluates this for API outputs.
5. Human vetting is unreliable (Staats). Deequ, AGORA+ and Lisa all rely on it, so fiks should make automatic held-out FP measurement the gate instead.
6. The literature uses incompatible oracle metrics (precision, F1, mutation score, bug-discrimination). The paper should state up front that per-receipt FP and per-drift detection are the operational metrics, and why.
7. Leakage: any LLM-proposed contract evaluated on public APIs needs post-cutoff subjects (Molinelli). Our mock vendor helps here; real-bug cases need post-cutoff dates.
