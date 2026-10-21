# Judge report: STATISTICIAN lens

Judge: statistics (power and MDE correctness, unit of analysis and clustering, multiplicity, pre-registration completeness, small-N intervals, falsifiability of each confirmatory hypothesis, infra-error handling, design/evaluation leakage). Date 2026-10-21.

Designs read in full: `design-narrow-rigor.md` (NR), `design-reviewer-first.md` (RF), `design-maximal-evidence.md` (ME). Context: ORCHESTRATION.md, SYNTHESIS.md (X22, X23, M12, §8 unit of analysis), codebase-map.md §5.

## 0. Arithmetic I re-checked

All with the paper-forge `eval_stats.py mde` and a stdlib exact binomial (script in the session scratchpad, not committed).

| Claim | Design | Re-computed | Verdict |
|---|---|---|---|
| n=3000, H0 p≥.01, α=.01: crit ≤17; power .995 @ .3%, .75 @ .5% | NR C1 | crit 17; .995; .749 | correct |
| n=1500, same: crit ≤6; power .83 @ .3% | NR C1 | 6; .831 | correct |
| Wilson upper, 0/3000 = 0.13% | NR C1 | 0.128% | correct |
| MDE n=60, sd .25, α .01 = 0.110; n=51 → 0.120 | NR C2–C4 | 0.110 / 0.1196 | correct |
| NI n for δ=.10, sd .25, one-sided α .01 = 63 | NR C5 | 63 | correct |
| n=1000, H0 p≥.02, α=.0083: crit ≤9; power .97 @ .5%, .46 @ 1% | RF-H6 | 9; .969; .457 | correct (and shows RF-H6 is underpowered if true FP ≈ 1%) |
| n=240, H0 p≥.05, α=.0083: crit ≤4; power .99 / .905 | RF-H4 | 4; .992; .905 | correct arithmetic, wrong unit (see RF) |
| MDE n=40, sd .5, α .0083 = 0.275 | RF-H3 | 0.2751 | correct, and too large for the central claim |
| SD(ΔBA)=0.034, MDE≈0.12 at α .00833 | ME C1 | 0.0343 → 0.119 | correct |
| "n=1000 passes with ≤3 FPs (Wilson upper 0.88%)"; "≤19 FPs at n=3000" | ME C2 | Wilson 3/1000 = 0.88%, 19/3000 = 0.99%: these are **1% Wilson** cut-offs, but the stated test is an exact binomial of **H0 p≥2%**, whose critical counts are 9 (α .0083) / 12 (α .05) at n=1000 and 47 at n=3000, α .05 | **inconsistent decision rule** |
| C3/C4 MDE 0.175 at n=80 | ME | correct for n=80, but n=80 is reached only by pooling dev author drifts and real bugs; test-only n ≈ 56 gives MDE 0.209 | **n inflated by leakage** |
| C5 MDE 0.148 at n=88 tasks | ME | 0.1484 | arithmetic correct; unit wrong (tasks nested in drifts) |

## 1. Scores

| Design | Score (1–10) |
|---|---|
| **narrow-rigor** | **8** |
| reviewer-first | 6 |
| maximal-evidence | 4.5 |

### 1.1 narrow-rigor: 8

Strengths
- The confirmatory family is small (m=5, Holm), and every power number is computed at the worst-case Holm level α=.01. Each number I re-checked was correct.
- The unit of analysis is right throughout. For C1 it is the distinct input, deduplicated because verdicts are deterministic. For C2–C5 it is the drift, with models as a fixed facet averaged at equal weight and attempts nested inside the drift. Inference is by sign-flip permutation plus BCa over drifts, and models and attempts are never pseudo-replicated.
- Every confirmatory hypothesis can visibly fail. C1 pre-registers its own likely failure (range invariants versus a blind catalog) and forbids widening the ranges afterwards. C3 states its expected loss channel: clamp or constant patches pass a property-only repro. C4 (superiority on harm) is paired with C5 (non-inferiority on benefit), so fiks cannot win by opening fewer PRs.
- The baseline is the strongest composition. COMP gets the raw trace, fiks's contract suite and stored traces in its CI, the same guard and the same budget. A positive result therefore cannot be dismissed as beating a straw man.
- Infra handling is the best of the three: API retries, attempt re-queue, **pairwise deletion of the whole (drift, model, attempt) cell across arms**, and a worst-case-against-fiks imputation above 5% dropped.
- Leakage controls: D1–D5 are dev-only. Each arm gets an equal dev tuning budget. HOLD is built on dev with an access log. The **top-up rule uses detection counts only**, never repair outcomes. Analysis scripts are frozen and run once. A simulation check requires Type I error within [.04, .06] over 2,000 null datasets, about ±2 Monte Carlo SE, so the criterion is well posed.
- The C2 asymmetry is conservative for fiks: fiks must fail for the stated reason, while the agent repro only has to fail.

Weaknesses
- **C1 effective n.** False positives are produced by a few (contract property × entity-class) "FP sources". Over 80% of the corpus is a constructed enumeration grid, so a binomial over 3,000 inputs treats correlated grid points as independent draws from "clean traffic". The cluster bound is only a sensitivity analysis. The sampling frame and the claim need to be stated as a census of a pre-registered frame (see must-fix NR-1).
- **Held-out oracle criterion 5 is circular.** "Held-out traffic yields 0 contract violations" makes fiks's own detector part of the ground truth that grades fiks. FIKS's P gate and trace gates optimise against those same contracts. COMP's CI also contains the suite, but REPRO-AGENT and C3's agent side do not.
- **C3 pool depends on the arms.** The patch pool is built from R4 candidates, including FIKS-arm candidates that the agent iterated against the fiks repro. Pool composition therefore depends on C4 outcomes and is selected by one of the two tests being compared. Per-drift BA with only ≥2 patches per class is also very coarse: steps of 0.25.
- The NI test is a shifted sign-flip, which assumes symmetry of d+δ under H0. The display uses a BCa lower bound. Two different decision rules are named, and only one may be primary.
- At K1, "raise attempts per cell" cannot reduce drift-heterogeneity variance, which dominates σ_d (evals-measurement §3). At the floor n=40 the MDE reaches 0.19 at σ_d=.35. The design states this honestly.
- "Detected" means ≥1 violation in 20–150 enumerated calls. Detection therefore scales with traffic volume. This is acceptable, but the enumeration must be frozen before unsealing.
- C4 and C5 are tested as two separate Holm members, although the claim is their conjunction. Treating them as an intersection–union test (IUT) would be more natural and cheaper in α.

### 1.2 reviewer-first: 6

Strengths
- It has the best freeze ledger. `prereg-v1` is tagged **before any blind drift exists**, and tag order and ancestry are checked by a verifier. Read-audit logs exclude any author who touched forbidden paths.
- 50% of drift ideas come from an open-weight model. This is a cheap, measurable mitigation of same-family circularity, reported as a stratum.
- The judge variant is chosen on dev and named in PREREG, so the comparator is not a straw man. The per-drift BA difference is a clean, cluster-correct detection endpoint.
- Clean FP is computed on deduplicated signatures. pass^k uses unbiased estimators, with a Beta-Binomial sensitivity analysis (X22). `decompose` provides a D-study.
- All exact-binomial and MDE arithmetic checks out.

Weaknesses
- **RF-H3, the central claim, is underpowered.** It uses Opus only, r=3, and n≈40 eligible drifts, giving MDE 0.28 on a −1..+1 utility scale. A realistic effect of 0.15 fewer incorrect PRs at equal correct PRs (Δutility ≈ 0.15) would not be detected.
- **The composition baseline is weakened, and the treatment is confounded.** RA1 gets no raw upstream and no test, while RA0 gets the hardened strict trace. The two arms therefore also differ in trace format and in edit permissions, not only in gates.
- **RF-H4 uses the wrong unit and is partly unfalsifiable.** Its 240 trials are 12 templates × 4 goals × 5 carriers, which is strongly clustered. An iid exact binomial overstates certainty. Two of the four "success" criteria (canary egress, non-allow-listed command) are impossible by construction under the sandbox, so the hypothesis is largely a construction property.
- **RF-H5 is near-tautological.** fiks-current opens a code PR on every eligible benign case by design, so the McNemar test rejects as soon as triage ever routes elsewhere. The informative part is the guard, and the guard's unit (drift or attempt) and α are unspecified.
- Guards in RF-H2 and RF-H5 are tested at an unadjusted 95% level inside Holm-controlled hypotheses. That is inconsistent and needs an IUT at the adjusted level.
- RF-H6 is set at 2%, with power .46 if the true rate is 1%. It is weak as a precision claim for a PR trigger.
- Infra-excluded units are not deleted pairwise, and there is no worst-case imputation. Only "differential infraError reported".
- **WS0's null calibration acceptance test is wrong.** "Null dataset p > .1 in 95/100 simulations" is miscalibrated: under H0, P(p > .1) = .90. A correctly sized test fails this check about half the time, and the check rewards a conservative test.

### 1.3 maximal-evidence: 4.5

Strengths
- The non-inferiority guards in C4 and C6 are formalised correctly as intersection–union tests: p for Holm = max(component p), with no extra α split.
- Instances are kept as the "first k valid in authored order". This is a clean anti-cherry-picking rule.
- Labels come from a `truth()` projection with a static check that labels never import monitor output. The bootstrap resamples tasks or instances, never trials.
- It pre-registers expected losses (S12 versus the judge, benign evolution, the strict trace). The confirmatory analysis runs first and is committed before any exploratory analysis is looked at. A dual decline-policy grading is reported.
- An arm-independent wrong-patch pool is generated **before** either repro arm runs. This is the right design for laxity.

Weaknesses (several unsound as written)
- **Dev/test leakage in confirmatory tests.**
  - C3 and C4 instances include the 36 author drifts (dev, used to tune contracts) and TS real bugs, which have a different oracle. The stated n of 80–95 depends on them. With test-only blind plus injector drifts at about 70% detection, n ≈ 56 and the MDE is 0.21.
  - C5 and C6 use 48 dev author-drift tasks out of 88. Receipts fire only where contracts detect, and the contracts were tuned on those drifts.
- **C2 pseudo-replication.** FP is counted per receipt on agent traffic. These are repeated identical calls to a deterministic vendor, not distinct inputs. The decision rule is also inconsistent: it cites 1% Wilson cut-offs for a 2% exact test.
- **C5 has the wrong unit and is close to a construction property.**
  - Tasks are nested in drifts: 12 author tasks per 9 drifts per domain, and blind tasks are written per drift. A task-level permutation ignores drift clustering.
  - "fiks-fixed beats receipts-only" holds by construction wherever a correct fix was merged (SYNTHESIS X18 / H12). It depends on R6 merges made from C4 outputs.
- C1 is "falsified if the 95% CI includes 0". That is not the Holm-adjusted interval. Specificity is computed largely on v1 replays of the fault probes, which is nearly trivial for both methods and dilutes ΔBA.
- **The composition baseline is weak.** It gets a prose alert only, with no raw trace and no contract suite in CI. C4 uses Opus only.
- **Infra exclusion breaks pairing.** Units are "excluded and counted per arm", which is not pairwise deletion.
- **Feasibility.**
  - It needs about 640 builder-hours, 30 streams, $2.9–3.7k API-price, 22k trials and 18.3k judge calls, against unmeasured OAuth rate limits.
  - τ² alone takes 67–134 h sequential. The confirmatory-only subset is still about 345 h.
  - The breadth multiplies the surface for undetected leakage of exactly the kind listed above.

## 2. Winner

**narrow-rigor.** Under this lens it is the only design whose confirmatory family is fully specified: unit, n rule, test, falsifier, and infra policy, each with correct arithmetic. It is also the only one that tests its central claim (gates before the PR beat the composition) against the strongest form of the counter-case at adequate power. Its flaws are fixable in the PREREG without changing the build plan.

## 3. Grafts from the runners-up

1. **(RF) Freeze ledger with ordering proofs.** Record every freeze (operators → vocabulary → tracker contracts → injector rules → PREREG) as a hash plus tag, and have the verifier check tag order and commit ancestry. Tag the confirmatory PREREG text, including the C1 frame and the oracle definition, **before the drift-authoring runs start**. Only the σ_d-dependent attempt counts are filled in after K1, in a dated, hashed addendum.
2. **(RF) Open-weight drift ideation.** Generate half of the drift *ideas* with local ollama (CPU, text only, cheap) and implement them with the Claude author. Report detection and C2–C5 by ideation family as a pre-registered sensitivity analysis. This answers the single-family threat at near-zero cost.
3. **(RF) Judge variant chosen on dev and named in PREREG,** with the per-drift BA difference used as E3's primary exploratory endpoint, cluster-correct.
4. **(ME) Merge C4 and C5 into a single IUT hypothesis.** Make it "fewer incorrect PRs AND correct PRs non-inferior at δ=.10", with Holm p = max(p_C4, p_C5). This brings m from 5 to 4 (worst-case α .0125), states the claim exactly, and recovers power for C1–C3.
5. **(ME) Arm-independent wrong-patch pool,** generated before any repro or repair arm runs: rule-based patches P1–P8 plus LLM "plausible but wrong" patches, admitted only if they fail the held-out oracle. Make this C3's **primary** pool; the R4-derived pool becomes secondary and is stratified by source arm.
6. **(ME) "First k valid in authored order"** as the keep rule for drifts, benign cases and top-up waves, instead of any reviewer-filtered selection.
7. **(ME)** A static import check that the labeler, oracle and ground-truth function never import `@fiks/contracts` or any monitor. The dual decline-policy grading applies only if NR keeps any agent-answer outcome.
8. **(ME / RF) Rate-limit pilot.** Measure throughput at 1, 2, 4 and 8 workers before choosing worker counts. Add `decompose` (drift × model × attempt) on dev at K1, so the decision between more attempts and more drifts is data-driven.
9. **(ME, exploratory only)** If budget remains after R4, a receipts-versus-no-monitor agent-outcome check on test-split drifts only. It would be clustered by drift, labelled exploratory, and kept outside Holm. It does not displace any NR confirmatory run.

## 4. Must-fix items

### For the winner (narrow-rigor)

- **NR-1 (C1 inference target).**
  - Pre-register the C1 frame before unsealing: the catalog × tool enumeration, the query grid, the create→get pairs and the stratum weights.
  - State C1 as a property of that frame.
  - Make the cluster-level bound co-primary: an exact or cluster-bootstrap bound with the unit "FP source = contract property × entity class". Alternatively, define the primary test on cluster-aggregated data.
  - Without this, the n=3,000 binomial overstates independence.
- **NR-2 (oracle circularity).** Remove "0 contract violations" from held-out-oracle criterion 5. Grade held-out traffic replay only by the ground-truth function against vendor state, because fiks's own contracts cannot be part of the oracle that grades fiks. Report "contract-clean on replay" separately as descriptive.
- **NR-3 (C3 pool).** Adopt the pre-generated, arm-independent pool as primary (graft 5). Require at least 3 patches per class per drift, and pre-register what happens to drifts below that. Report BA by pool source.
- **NR-4 (one NI decision rule).** Name exactly one primary NI decision rule: the shifted sign-flip p-value or the BCa lower bound at 1 − α_Holm. Include it in the AN simulation check (NI size ≤ α under asymmetric d). Preferably adopt the C4∧C5 IUT (graft 4).
- **NR-5 (K1 discipline).** At K1, only attempts per cell may increase, and the drift count may change only through the detection-count top-up. Wave-2 drifts must pass the identical authoring, validity, split and seal pipeline and be sealed before any test-split repair run. The top-up decision rule and its timing must be written into PREREG, not left implicit.
- **NR-6 (differential infra).** COMP runs longer, so it times out more. Pre-register a test of infra-error rate by arm, and treat a difference above 2 pp as triggering the worst-case imputation regardless of the 5% total threshold.
- **NR-7 (enumerated traffic).** Freeze the per-drift enumeration (which calls count toward "detected") before unsealing, and report detection as a function of calls enumerated.

### Items that would make the runners-up unsound (if any are grafted wholesale)

- **ME:** remove dev author drifts and real bugs from the C3/C4/C5/C6 confirmatory sets, and recompute n and MDE on test-only instances. Count distinct inputs, not receipts, for C2, and make the decision rule consistent. Cluster C5/C6 by drift. Delete pairwise on infra exclusion. Use Holm-adjusted intervals as the falsifier.
- **RF:** power RF-H3, the central claim, adequately (multi-model or more drifts). Give the composition the raw trace and match the trace format. Analyse RF-H4 at template or carrier level, or report it as descriptive containment. Fix the WS0 null-calibration acceptance test: under H0, P(p > .1) = .90, so test the rejection rate at α against a Monte Carlo interval. Specify the guard α inside the IUT.

### Plan feasibility (all designs)

- OAuth rate limits are unmeasured: codebase-map §5 records 0 errors in 210 sequential trials, with no stress test. NR's budget of about $450–720 and 1,377 repairs is feasible. ME's budget is not credible before the pilot. A cut order for confirmatory runs at the floor n is required, and NR has one.
