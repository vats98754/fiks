# Experiment design: NARROW-AND-RIGOROUS

Designer: independent experiment designer, angle "narrow and rigorous". Date 2026-10-21.
Inputs: `paper/ORCHESTRATION.md`, `paper/research/SYNTHESIS.md` (§§1-10), `paper/research/codebase-map.md`, `paper/research/gap-eval-methodology.md` §6-8, `paper/research/gap-repair-security.md` §6-8, `PROGRESS.md`, `README.md`, paper-forge references (evals-measurement, agents-tool-use, grilling-protocol, paper-writing).
Power numbers: computed with `eval_stats.py mde` (paired normal approximation, MDE = (z_{1-α/2}+z_{1-β})·σ_d/√n) and, for C1, an exact binomial computation (stdlib Python, shown in §2.1). Every input to a power number that is a guess (σ_d) is labelled as such; the pilot replaces it (§7, checkpoint K1).

Epistemic labels used below: **[design]** = a decision made here; **[estimate]** = a number we expect, to be replaced by a measurement; **[verify]** = a fact to check before it appears in the paper; **[SYN §x]** = taken from SYNTHESIS.

---

## 0. The narrow claim and what is deliberately not claimed

SYNTHESIS §9-10 leaves fiks one defensible novelty, as a combination:
1. **Trigger:** a per-call, deterministic contract violation on a *successful* tool result, grounded in the raw upstream exchange.
2. **Artifact:** a named-property, fail-first reproduction test built from the recorded exchange, checked deterministically (no golden patch, no LLM judge).
3. **Gate placement:** repro + full contract suite + stored traces + typecheck/lint + CI, all green **before** any PR exists.

Everything else (invariant vocabulary, receipts, proxies, post-fix confirmation, alert-to-agent-to-PR loops, agentic repair) is prior art [SYN §3, §9]. The strongest counter-case is the **composition**: "Outcome-Monitor-style checker → webhook → coding agent → PR → CI after" [SYN §5 Reading, §10]. Argument cannot answer it; a paired experiment can.

So this design proves exactly three things, each against its strongest alternative, and measures everything else only as exploratory or descriptive:
- the trigger is **precise** enough to open PRs from (C1);
- the named-property repro is a **better test** than the one a coding agent writes from the same evidence (C2, C3);
- placing the repro and the gates **before** the PR yields **fewer incorrect PRs at no material loss of correct PRs** than the strongest composition (C4, C5).

Not claimed (cut or descriptive, see §8.4): agent-outcome effects of receipts (H13), recurrence as a separate metric (H12, folded into the held-out oracle), detection superiority over LLM judges (H3, exploratory, expected loss), τ²-bench transfer (H19), contract inference (H16), acceptance by maintainers (H26, H27).

---

## 1. Thesis and contributions

**Thesis (one sentence).** When a per-call outcome-contract violation on a successful tool result is compiled into a named-property, fail-first reproduction test and enforced together with suite, trace and CI gates before a pull request opens, a coding agent produces fewer incorrect fix PRs, and no materially fewer correct ones, than the same monitor and the same agent composed with an alert and post-PR CI.

**Contributions** (each tied to the experiment and the table or figure that proves it):

1. **A precise per-call repair trigger.** On ≥ 3,000 distinct clean tool results over two domains, including catalog entries written by an author who never saw the contracts, frozen contracts flag fewer than 1% as violated (C1, experiment R2 → **Table 2**; detection coverage on blind drifts against six detector baselines is reported, not claimed, in **Figure 2**, E3).
2. **A named-property repro is a better reproduction test than an agent-written one.** On blind-authored drifts, the trace-derived repro is valid more often (C2 → **Table 3**) and discriminates held-out-correct from incorrect candidate patches better over a fixed patch pool (C3 → **Figure 3**, per-drift FAR/FRR scatter).
3. **Gates before the PR beat the strongest composition.** Paired per drift, averaged over three Claude models: fewer incorrect PRs (C4) and non-inferior correct PRs (C5) than COMP, with a three-rung ladder (COMP → pre-PR gates → + repro) that attributes the effect (E1) (R4 → **Table 4**, **Figure 4** paired-difference forest plot, **Figure 1** pipeline/arms diagram).
4. **DriftBench-blind,** a released substrate where the upstream changes and the tool does not: 2 domains, 100 blind-authored silent drifts with hidden tests and reference fixes, 30 benign evolutions, a predeclared response-mutation suite, and a dev/test split sealed before runs (**Table 1**; benign-evolution behaviour, an expected loss, in **Table 5**, E4; security containment in **Table 6**, E6).

---

## 2. Hypotheses

### 2.0 Shared definitions [design]

- **Drift instance:** one blind-authored change to one vendor, applied alone (single-drift profile) on top of that domain's base version, with its sealed hidden tests and reference fix. D1-D5 are *legacy/dev* instances: fiks was developed on them, so they are excluded from every confirmatory test.
- **Detected:** the frozen contracts emit `violated` on at least one call in the instance's enumerated traffic. Repair experiments run only on detected test-split instances (the trigger is the precondition of every arm, so the instance set is shared).
- **Attempt:** one end-to-end run of one arm on one instance with one model, budget-capped (§4.2). Outcomes: `correct_pr`, `incorrect_pr`, `no_pr`, `infra_error`.
- **Held-out oracle** (sealed until grading; the repairing agent never sees it). A patch is **held-out-correct** iff all hold:
  1. all hidden tests pass (≥ 3 manifestations per drift: other inputs to the same tool; other tools that consume the drifted field; v1 behaviour preserved, because the fix must be version-robust [design]);
  2. differential agreement with the sealed reference fix = 100% on agent-visible fields over 200 property-generated inputs per drift (fast-check, fixed seed), on v1 and drifted recordings;
  3. the renamed-id variant of the hidden tests passes (catches special-casing recorded ids or args);
  4. no new finding confirmed by ≥ 2 of {Semgrep CE, CodeQL, eslint-plugin-security} relative to base [SYN M19; `sajadi2025patches`];
  5. held-out multi-model traffic (§3.6) replayed on the drifted vendor yields 0 contract violations and vendor-state-correct outputs. This folds SYNTHESIS H12 ("stops recurring for any agent") into the oracle instead of a separate claim.
- **PR opened:** a `would_open_pr` event (all runs use `--no-pr`; no GitHub PR is created). For FIKS and L1 it occurs only after every pre-PR gate and local CI are green. For COMP it occurs as soon as the agent leaves a non-empty diff; the graded head is the head after its CI revisions.
- **Models:** `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, all through the Claude Agent SDK on the OAuth token. In C4/C5 the per-drift rate is the equal-weight mean over the three models (models are a fixed facet). Per-model results are exploratory (E2).

### 2.1 Confirmatory family (5 hypotheses, Holm at FWER 0.05)

Holm order is by p-value. The worst-case per-test level is α = 0.05/5 = 0.01, which is the α used for every power number below.

---

**C1. Trigger precision** (SYNTHESIS H5, made strict)

- **Statement.** On clean traffic, the frozen contracts flag fewer than 1% of distinct tool results as violated.
- **Primary endpoint.** FP rate = (distinct clean inputs with verdict `violated`) / (distinct clean inputs). A *distinct input* is a unique (domain, tool, args, upstream response) tuple. The verdict is a deterministic function of that tuple (D1 checks this), so repeated identical calls are not independent evidence. **Clean** means the domain's ground-truth function says the tool's result is correct; that function reads vendor state and never contracts.
- **Unit of analysis:** distinct input.
- **n and how it was chosen.** At least 3,000 pooled, with ≥ 1,200 per domain. Sources:
  - API-surface enumeration over the original catalog **plus the blind-extended catalog**: ≥ 300 new entities per domain, written by an author who saw only the public docs. This is ≥ 80% of n.
  - Multi-model agent traffic (§3.6): ≤ 20%.
  - Replays of the fixed versions of the real bugs: all available.

  Exact one-sided binomial test of H0: p ≥ 0.01 at α = 0.01. With n = 3,000, H0 is rejected if FP ≤ 17. Power is 0.995 if the true p is 0.3%, and 0.75 if it is 0.5%. At n = 1,500, the cutoff is FP ≤ 6 and power is 0.83 at p = 0.3% (computed with the stdlib binomial). The Wilson 95% upper bound with 0 FPs at n = 3,000 is 0.13%.
- **Test.** Exact binomial, one-sided; the p-value enters Holm.
- **Sensitivity** (reported; it does not replace the primary):
  - Clopper-Pearson and Wilson intervals per domain and per stratum (original catalog, blind extension, agent traffic, real-bug fixes);
  - a cluster bound treating each "FP source" (contract property × entity class) as the unit;
  - per-trial and per-task bounds on agent traffic.
- **Falsified if** the Holm-adjusted p ≥ 0.05, meaning we cannot claim FP < 1%.
- **Baselines.** Same corpus, exploratory (E3): schema floor, Ajv strict, LLM judge ± upstream, snapshot diff, windowed statistics.
- **Pre-registered expected risk.** The shop contracts' `range` invariants (20-2000 USD) were set from the original 15-product catalog. A blind catalog author may legitimately add a $5 item, and then C1 can fail on shop. If it does, we report it as stated. We do **not** widen the ranges after seeing the corpus; that would be a deviation.

---

**C2. Repro validity** (SYNTHESIS H7)

- **Statement.** For detected drifts, the trace-derived, named-property repro is a valid reproduction more often than a repro test written by a coding agent from the same alert and the same raw trace.
- **Endpoint per drift i:**
  - `V_fiks,i ∈ {0,1}` = 1 iff all three hold:
    - the F gate passes: the repro fails on the base for exactly the named property, identically across 10 runs;
    - the repro passes on the sealed reference fix in 10 of 10 runs;
    - the repro is produced at all, with no harness error.
  - `V_agent,i` = fraction of 6 agent-written repros (3 models × 2 samples) that fail on base with an assertion failure (not a harness or import error), pass on the reference fix, and agree across 10 runs. This is the SWT-bench definition and is *more lenient* than fiks's, because it has no stated-reason requirement.
  - `d_i = V_fiks,i − V_agent,i`.
- **Unit:** drift (detected, test split). **n:** all detected test drifts. Target ≥ 60, floor 40 (§3.1 top-up rule).
- **Power.** σ_d is unknown. With a guessed σ_d of 0.25-0.35, α = 0.01 and power 0.8, the MDE at n = 60 is 0.110-0.154; at n = 40 it is 0.135-0.189 (`eval_stats.py mde`). The pilot (K1) replaces the guess.
- **Test.** Two-sided exact sign-flip permutation on `d_i`: exact enumeration if n ≤ 20, else 200,000 flips with a fixed seed. 95% BCa bootstrap CI over drifts.
- **Falsified if** mean d ≤ 0 or the Holm-adjusted p ≥ 0.05.
- **Baseline: REPRO-AGENT** (§4.2), emulating "reproducing the issue" in Devin Oncall and the PostHog regression-test PR `[devin-oncall]` `[posthog-anatomy-pr]`.
- **Expected loss channel.** If a contract property is mis-specified (too strict, or named on the wrong field), the reference fix still violates it, and then `V_fiks = 0`.

---

**C3. Test adequacy over a fixed patch pool** (SYNTHESIS H11, laxity; the C19 / CoHarden question)

- **Statement.** Added to the same existing suite, the fiks repro separates held-out-correct from held-out-incorrect candidate patches better than an agent-written repro.
- **Endpoint per drift.** Balanced accuracy BA = 1 − (FAR + FRR)/2 over the drift's patch pool. A patch is accepted by test set T iff typecheck + lint + existing suite + stored traces + T all pass.
  - FAR = share of held-out-incorrect patches accepted.
  - FRR = share of held-out-correct patches rejected.

  For the agent side, BA is the mean over the 6 C2 repros, and invalid repros count; an invalid test is a real outcome. `Δ_i = BA_fiks,i − BA_agent,i`.
- **Patch pool** (pre-registered; frozen before C3 is computed):
  1. every distinct candidate patch produced in R4 for that drift (all arms, models and attempts, and every candidate reaching any gate or CI), deduplicated by normalized diff, with a stratified random cap of 30 per drift (seed fixed);
  2. 8 predeclared patch-mutation operators (§3.4) applied to the reference fix.

  A drift is excluded from C3 if either class has fewer than 2 patches. The count of excluded drifts is reported.
- **Unit:** drift. **n:** detected test drifts with a defined BA (expected slightly below the C2 n).
- **Power.** Same MDE table as C2: σ_d ≈ 0.25 gives an MDE of 0.110 at n = 60 and α = 0.01.
- **Test.** Sign-flip permutation on Δ_i, plus a BCa CI.
- **Falsified if** mean Δ ≤ 0 or the adjusted p ≥ 0.05.
- **Expected loss channel, stated up front.** A fiks repro asserts only the violated property, such as a range, so clamp and constant patches pass it (PROGRESS "Known limits"). An agent test may assert exact upstream-derived values. fiks can lose on D1/D2-like drifts. Secondary readouts (not in Holm): FAR and FRR separately, and C3 recomputed on the full fiks gate set versus repo CI plus the agent repro.

---

**C4. End-to-end: fewer incorrect PRs** (SYNTHESIS H9, superiority on the harm endpoint)

- **Statement.** Per attempt, the full fiks pipeline exposes a maintainer to an incorrect PR less often than the strongest composition baseline (COMP).
- **Endpoint.** `Y = 1` if a PR is opened and its final head is held-out-incorrect, whatever its CI colour. The green-CI and red-CI split is reported. For each drift and arm, `p = mean(Y)` over 3 models × 3 attempts. `d_i = p_COMP,i − p_FIKS,i`.
- **Unit:** drift. **n:** detected test drifts (target ≥ 60, floor 40).
- **Power** (α = 0.01, power 0.8, σ_d guessed):
  - n = 60: MDE 0.088 (σ_d 0.20), 0.110 (0.25), 0.154 (0.35);
  - n = 40: 0.108, 0.135, 0.189.
- **Test.** Two-sided sign-flip permutation; BCa CI.
- **Falsified if** mean d ≤ 0 or the adjusted p ≥ 0.05.
- **Baseline.** COMP, strongest form (§4.2): same detector, same raw trace available, same model, same budget, same guard on existing tests and fixtures, and a repo CI that already contains fiks's contract suite and stored traces.

---

**C5. End-to-end: correct PRs not materially lower** (non-inferiority; SYNTHESIS H9's recall clause)

- **Statement.** fiks's correct-PR rate is not lower than COMP's by more than δ = 0.10.
- **Endpoint.** `Y = 1` if a PR is opened and its final head is held-out-correct. `d_i = p_FIKS,i − p_COMP,i`.
- **Unit, n:** as C4.
- **Power.** The number of drifts needed for NI at δ = 0.10, one-sided α = 0.01, power 0.8, true difference 0 (`eval_stats.py mde --target 0.10 --alpha 0.02`) is 41 at σ_d = 0.20 and 63 at σ_d = 0.25. If the pilot σ_d makes n > the available drifts, δ stays at 0.10 and the result is reported as "inconclusive at this n". We do not widen δ after the pilot [design].
- **Test.** Sign-flip permutation on `d_i + δ` (one-sided), with its p-value in Holm. Equivalent display: one-sided lower (1 − α_Holm) BCa bound > −0.10.
- **Falsified if** the lower bound ≤ −0.10 or the adjusted p ≥ 0.05.
- If NI holds, superiority is tested **exploratorily** (E1), outside Holm.

---

**Why these five and not more.**
- C1 to C5 cover the three parts of the novelty (trigger, artifact, placement) with one harm endpoint and one benefit endpoint for the end-to-end claim.
- Adding SYNTHESIS H3, H8, H12, H13, H17 or H24 as confirmatory would spread the 0.05 over 8-11 tests, and push the per-test α toward 0.005 with no gain to the central claim (X23, `arcuri2014hitchhiker`).
- Everything else is exploratory, with raw p-values and effect sizes, and is never called "significant".

### 2.2 Exploratory set (pre-registered direction, raw p, effect sizes with CIs)

| ID | Question | Endpoint / method | Expected |
|---|---|---|---|
| E1 | **Ladder decomposition.** COMP → L1 (gates moved before the PR, no repro) → FIKS (+ named repro + P gate). Also superiority of FIKS on correct PRs if C5's NI holds. | C4/C5 endpoints per rung, paired sign-flip, BCa | Placement drives most of C4. The repro drives the correct-PR gain. Either can be ~0 (report). |
| E2 | Per-model effects and arm × model interaction | C4/C5 per model; logistic GLMM `y ~ arm*model + (1|drift)` | Gate value larger for Haiku |
| E3 | **Detection coverage vs baselines** (SYNTHESIS H1, H3, H4, H6, H17) | Per-class recall on test drifts; specificity on the C1 corpus and on benign; mid-p McNemar on drift-level discordance; judge AUROC (paired bootstrap, clustered by drift); FN per mutation operator (Wilson) | Contracts ≥ schema/Ajv everywhere. **Expected loss to the LLM judge with upstream on monitor-evasive drifts and on string perturbation.** Snapshot diff has high recall but fires on benign. |
| E4 | **Benign evolution** (X21, H18) | Per benign case: code PR / contract-update proposal / no PR, for FIKS-current, FIKS+CU and COMP. Also the misrouting rate: a CU proposal accepted on a *true* drift | **Expected loss for FIKS-current** (opens code PRs). FIKS+CU should reduce it. |
| E5 | Gate residual (H10) | Count and class of patches passing *all* fiks gates yet held-out-incorrect. Collateral-regression rate among gate-rejected candidates `[tayebati2026selfhealingharness]` | Non-zero; characterized |
| E6 | Security (H23, H24, H-S3) | Containment violations and canary hits (Wilson upper); malicious-diff rate, raw vs strict trace; strict-vs-raw utility NI (margin 0.10) | Containment 0 with the sandbox; raw trace gives a non-zero malicious-diff rate |
| E7 | Real bugs, wave 1 (H14, H15) | Per bug: detect on prefix, FP on fix, F on prefix, P on the human fix, FIKS vs COMP repair graded by the human fix's tests + held-out manifestations | Case studies; n ≈ 3-5 |
| E8 | COMP-plain (repo CI without fiks's contract suite: the "typical repo" composition) | C4/C5 endpoints vs FIKS, Opus only | Larger gap than vs COMP |
| E9 | Cost and time | $ (API-price estimate), tokens, minutes per attempt and per correct PR, by arm × model; red-CI PRs per arm (H20) | FIKS cheaper per correct PR than COMP |
| E10 | Repro as input vs repro as gate | Within FIKS, how often does the P gate reject a candidate the agent believed fixed (attempt logs)? | Descriptive |

### 2.3 Descriptive set (construction properties; no tests)

| ID | What |
|---|---|
| D1 | Determinism: each detector verdict identical across 20 offline replays; F-gate verdicts across 10 runs (H21) |
| D2 | Silence of every drift, verified per instance: HTTP 2xx, `isError` false, OpenAPI byte-identical (oasdiff: 0 findings), typecheck unchanged. This shows error, spec-diff, compile and dependency triggers see nothing (H2) |
| D3 | Calls-to-first-detection: per-call contracts vs windowed detectors at w ∈ {20, 50} |
| D4 | Funnel per drift: authored → valid → detected → F gate → repair → gates → PR → held-out-correct (M20) |
| D5 | Attrition and infra-error counts per run; local-CI vs GitHub Actions agreement |
| D6 | Drift realism ratings and C3 / R1-R25 class coverage |
| D7 | The existing 2026-10-20 receipt bench, moved to an appendix and labelled underpowered (6 tasks; no task-level test can reach p < .05 [SYN M12]) |

---

## 3. Substrates and sizes

### 3.1 DriftBench-blind (primary substrate) [design]

**Domains.**
- **Shop** (existing). Vendor `vendor-api` v1. Server base: `shop-mcp` main 7bf2e66, which holds the D1-D5 fixes, re-tagged `base-shop`. Contracts are frozen as of `seed-v1`.
- **Tracker** (new). An issue-tracker vendor (issues, labels, comments, assignees, search with pagination, state transitions) and a normal MCP server `tracker-mcp` in its own repo under vats98754. It was chosen because its classes match most real-bug candidates (R1-R8, R11, R12: lost label write, truncation, dropped field, default-on-missing, filter drops records, count identity). That makes coupling to real bugs testable (E7).

**Sizes per domain.**

| Artifact | Count | Author (each a separate agent, see §3.3) |
|---|---|---|
| Provider-realistic silent drifts | 38 | 3 realistic authors (≈13 each) |
| Monitor-evasive silent drifts | 12 | 1 evasive author ("a change a generic output monitor would miss") |
| Benign evolutions | 15 | 1 benign author |
| Catalog extension entities | ≥ 300 | 1 catalog author |
| Hidden tests per drift | ≥ 3 manifestations | the drift's author |
| Reference fix per drift | 1, plus an independent second fix for a 20% sample | drift author; second fixer agent |

Totals: 100 blind drifts (76 realistic + 24 evasive), 30 benign, ≥ 600 extension entities. Legacy D1-D5 make 105 drift instances.

**Split.**
- A seeded RNG (seed in PREREG), stratified by domain × class × author, puts 20% of blind drifts in **dev** (20). D1-D5 also go to dev.
- **Test** = 80 blind drifts.
- Test hidden tests and reference fixes stay in the sealed repo. Only automated verifiers touch them before R4.

**Expected detected test drifts** [estimate]: about 75% of 61 realistic (≈ 46) + about 25% of 19 evasive (≈ 5) ≈ 51.

**Top-up rule (pre-registered).** If fewer than 50 test drifts are detected, a second authoring wave runs: 20 per domain, same briefs, same split rule. The decision uses **detection counts only**, computed before any repair run, never repair outcomes. If the count is still below 40, C2-C5 run anyway, the MDE at the realized n is stated, and non-significance is reported as inconclusive.

**Calls per instance.** The enumerated traffic for the drifted endpoints is all catalog entities × tools touching the endpoint, plus the query grid: about 20-150 calls per instance, all replayable offline.

### 3.2 How circularity is removed (M2, M21)

1. **Contracts frozen before drifts exist.**
   - Shop contracts and evaluator are frozen at `seed-v1`; their blob hashes go into the PREREG registry.
   - Tracker contracts come from a contract-author agent that sees only the tracker docs and v1 traffic (no drifts exist yet). They are frozen under tag `contracts-frozen-v1`, pushed to vats98754/fiks before any drift author starts.
   - The invariant vocabulary (`packages/contracts/src/evaluate.ts`, `types.ts`) is frozen at the same tag.
   - After the freeze, only bug fixes are allowed. Each is logged in DEVIATIONS.md, and all affected runs are re-run.
2. **Blind authoring in a sandbox.**
   - Every drift, benign or catalog author runs in a Docker container. The only mounts are: the vendor package source (v1), the domain's public docs (OpenAPI + a prose doc frozen at PREREG), the MCP server source at base, and a taxonomy brief (C3 categories and the R1-R25 symptom classes, written generically, with no fiks vocabulary).
   - No fiks repo, contracts, evaluator, receipts or prior drifts are mounted, and the container has no network except the model API.
   - The mount list and container image digest are logged per author.
   - Outputs are committed to a separate private repo, `vats98754/driftbench-blind`, and their commit hash enters PREREG before any detection run.
3. **Third-party injector.**
   - Drifts are written as response-rewriting rules for a generic injector (`packages/injector`) that sits between vendor and tap. The injector is built by a builder who never reads the contracts.
   - fiks code never imports drift rules. The tool server is unchanged, so "the upstream changed and the tool did not" holds by construction (M1).
4. **Mutation operators written before results** (§3.4).
   - They are declared in this document today and implemented before the tracker contracts are frozen.
   - For shop, contracts predate the operators, but nobody has seen operator results.
5. **Monitor-evasive stratum.** One author per domain is asked explicitly for silent changes that a generic output monitor would miss. These drifts are reported as their own stratum in E3. They enter C2-C5 only if detected; that conditioning is shared by all arms.
6. **Realism review.** A separate reviewer agent rates each drift for provider realism (1-5) against the brief. All drifts are kept, and the ratings are reported (D6), never used to filter.
7. **Reference-fix agreement.** For a random 20% of drifts, an independent fixer agent writes a second reference fix without seeing the first. Differential agreement between the two is reported. Disagreements are adjudicated by hidden tests only, and the adjudication rule is fixed in PREREG.
8. **Dev/test separation.** All prompt tuning, harness debugging and trace-format decisions use dev only. Every arm gets the same tuning budget on dev: at most 5 prompt iterations per arm, logged. fiks's own prompt was tuned on D1-D5, which are dev; that asymmetry is stated, and the equal dev budget for baselines answers it.
9. **Residual circularity, stated.** All authors, judges and repairers are Claude models, so correlated blind spots are possible. The second family (local ollama) is used only for held-out traffic (§3.6). We say so (§8.3).

### 3.3 Benign evolution (X21) [design]

Per domain, 15 cases from the benign author. Kinds:
- new optional field;
- new documented enum value;
- widened legitimate value range, e.g. a premium product above $2,000;
- array reordering;
- deprecated field with an alias kept;
- new pagination parameter with an unchanged default;
- a documented unit change *with* a new explicit unit field.

Ground truth per case is "the tool needs no code change". The correct fiks outcome is no violation, or a contract-update proposal. Benign cases enter only E4 and the C1 sensitivity strata, never the C1 primary (C1 is clean v1 traffic only).

### 3.4 Predeclared operators

**Response-mutation operators** (applied offline to every distinct recorded v1 upstream response of both domains; E3 / oracle adequacy, H6):

| Op | Change |
|---|---|
| M1 / M2 | numeric field × 100 / ÷ 100 |
| M3 | rename field (fixed synonym table) |
| M4 | drop field |
| M5 | null field |
| M6 | truncate array to the first 5 items, keeping `total` |
| M7 | number → string |
| M8 | ISO-8601 → epoch ms |
| M9 | epoch s ↔ ms |
| M10 | inject an unknown enum value |
| M11 | string perturbation: case, whitespace, homoglyph, truncation |
| M12 | identity swap (another entity's record) |
| M13 | stale timestamp (−400 days) |
| M14 | phantom write: POST returns 2xx + id, nothing persisted |
| B1-B4 (benign controls, expect no fire) | reorder array; add unknown field; JSON whitespace; extra response header |

**Patch-mutation operators** (applied to each reference fix by an agent instructed with the operator; each must typecheck; used in the C3 pool):

| Op | Patch |
|---|---|
| P1 | clamp to the contract range |
| P2 | constant in-range value |
| P3 | special-case the recorded id or args |
| P4 | partial fix (one tool or endpoint only) |
| P5 | version-unaware fix (applies the drift transform on v1 too) |
| P6 | refuse / return null |
| P7 | coerce-anything (silently accept and convert any type) |
| P8 | echo the request without persisting (for writes) |

### 3.5 Real bugs, wave 1 (external validity, E7 only)

- **Targets:** R10 (modelcontextprotocol/servers #4887, memory lost write), R19 (mongodb-mcp-server #561, count identity), R20 (Figma-Context-MCP #364, false success), R9 (cloudflare #468, serialization corruption).
- **Reserves:** servers #3137, #4628; R14 (only if FSL-1.1 permits fork use [verify]).
- **Protocol:** SYNTHESIS §7 steps 1-10, in forks under vats98754 only, never posting upstream:
  - a blind contract from the symptom only, with author and time logged;
  - process-level replay;
  - F on prefix, P on the human fix;
  - FIKS vs COMP, Opus, 5 attempts each;
  - grading by the human fix's tests plus added held-out manifestations;
  - contamination stratified by fix date vs model cutoff.
- **Pooling:** not pooled into C2-C5, because the oracle differs. The fixed versions feed the C1 corpus.

### 3.6 Clean corpus and held-out traffic

- **Enumerated clean corpus** (for C1):
  - every entity in the original + blind-extended catalogs × every read tool, plus a fixed query grid (≥ 200 queries per domain: prefixes, filters, page sizes) and create→get pairs for write tools;
  - dedupe key: (domain, tool, args, sha256 of the upstream response);
  - target ≥ 3,000 distinct inputs.
- **Held-out multi-model traffic** (part of the held-out oracle, and up to 20% of C1):
  - per domain, 20 task prompts written by the catalog author (not the repair arms);
  - agents: Opus, Sonnet and Haiku through the Agent SDK, plus one small open model through local ollama, e.g. `qwen2.5-coder:7b` (4-bit). The route is ollama's Anthropic-compatible endpoint if it works with the Agent SDK [verify], otherwise a minimal MCP-client chat loop over ollama's OpenAI-compatible API;
  - 3 trials each;
  - only the tool-call args are kept, to be replayed against each candidate patch.
  - This is the only use of the second model family [design]. CPU inference is too slow for repair at scale (§8.4).

### 3.7 Sizes at a glance (Table 1 skeleton)

| Substrate | Units | Count | Feeds |
|---|---|---|---|
| Blind drifts (test / dev) | instance | 80 / 20 (+ D1-D5 dev) | C2-C5, E1-E5, E8-E10, D2-D4 |
| Detected test drifts | instance | ≈ 51 [estimate], floor 40 | C2-C5 |
| Benign evolutions | case | 30 | E4, C1 sensitivity |
| Clean distinct inputs | input | ≥ 3,000 | C1, E3 specificity |
| Response mutants | mutant | ≈ 14 ops × ≈ 1,500-2,500 responses [estimate] | E3 (FN per operator) |
| Patch pool | patch | ≤ 30 + 8 per drift (≈ 1,900) | C3, E5 |
| Repair attempts (main) | attempt | ≈ 51 × 3 arms × 3 models × 3 = 1,377 | C4, C5, E1, E2, E9 |
| Agent-written repros | repro | ≈ 51 × 6 = 306 | C2, C3 |
| Real bugs | bug | 3-5 | E7, C1 strata |
| Adversarial traces | trial | 12 payloads × 10 traces × 2 formats = 240 | E6 |

---

## 4. Baselines to implement (not describe)

### 4.1 Detection baselines (E3; offline replay over identical inputs; labels from vendor state, never from fiks verdicts)

| ID | Baseline | Implementation | Fidelity notes |
|---|---|---|---|
| B-SCHEMA | MCP SDK client-side `outputSchema` validation | Call the actual `@modelcontextprotocol/sdk` client validation path on each recorded result | Real code; the schema floor `[mcp-ts-sdk-client-validation]` |
| B-AJV | Strict JSON Schema | Ajv 2020-12 strict + ajv-formats; schema strengthened with every spec-derivable constraint (types, required, enums, formats) | Strongest schema form (X1); gets no constraint the spec lacks |
| B-JUDGE / B-JUDGE+U | LLM judge without / with the raw upstream body | Sonnet 5.5 and Haiku 5.5. Input: tool description, outputSchema, args, result (+ upstream body). Output: JSON `{verdict, property, confidence 0-100}`. Prompt tuned on dev (≤ 5 iterations). Tokens and $ logged | Emulates LLM-scan products (ALTK Silent Review, Galileo, Engine-style) from docs; judges a single call, no batching |
| B-SNAP | Snapshot / recorded-response diff | Per endpoint, compare the response with the v1 recording of the same request: field set, JSON types, log10 magnitude bucket, array length vs `total`. Any deviation flags | Reimplements Gilesi-style snapshot diff and Hoverfly Diff behaviour over our tap `[monce2025gilesi]` `[hoverfly-modes]` |
| B-STAT | Windowed statistical drift | AegisFlow-style KS test on numeric leaves, null-rate jump, history range (window w ∈ {20, 50}; reference = v1 window). Evidently-default emulation: per-field drift test, default thresholds | Reimplemented from paper and docs. **AegisFlow has no code**, and we say so. Evidently defaults [verify against pinned docs] |
| B-TRIG | Error / spec-diff / compile triggers | `isError` or exception; oasdiff on the v1 vs drifted OpenAPI; `pnpm typecheck` on the unchanged server | Expected 0 by construction (D2). Shown, not argued |
| B-OM (tier-2, cut first) | Outcome-Monitor-style mined contracts | Templates (echo, positivity, categorical domain, affine, date ordering) mined from v1 traffic | Reimplementation; OM artifact availability [verify] |

### 4.2 Repair arms and repro baseline (C2-C5, E1, E8)

Every arm uses:
- the same frozen detector, so the instance set is identical;
- the same raw trace on disk;
- the same model;
- the same Claude Agent SDK harness with `settingSources: []` and no MCP servers;
- the same sandbox (§5, P1), the same Bash allow-list (`pnpm typecheck|lint|test`), and the same write guard on *existing* tests, fixtures and traces;
- the same re-record service (fiks's `rerecordStale` runs before every local or CI run in all arms, so D3/D4-type fixes are not penalised in any arm);
- the same per-session cap (30 turns, $5) and **at most 4 agent sessions** per attempt (fiks today: 3 SDK attempts + 1 CLI fallback);
- the same 90-minute wall-clock cap;
- the same hermetic local CI (§5, P9), which mirrors shop-mcp's `ci.yml`: `pnpm install --frozen-lockfile`, typecheck, lint, test.

Run order within each (drift, model, attempt-index) block is randomized across arms, so model-side drift over time cannot confound arms.

| Arm | Pipeline | What differs from FIKS | Fidelity notes |
|---|---|---|---|
| **FIKS** | trace → named-property repro → F gate (3 runs) → committed read-only → agent → P gate + suite + traces + typecheck/lint → local CI → `would_open_pr` | – | The product at the frozen commit, plus sandbox and cost logging |
| **L1** (pre-PR gates, no repro) | alert (prose) + raw trace file → agent (may add new test files) → suite + traces + typecheck/lint → local CI → `would_open_pr` only if green; failures fed back, up to 4 sessions | No fiks repro, no F/P gate | Our ablation: isolates the repro |
| **COMP** (primary baseline, strongest composition) | alert → agent, told to "reproduce the issue first, then fix", may add new test files → `would_open_pr` immediately on a non-empty diff → local CI → red CI log fed back, ≤ 3 revisions within 90 min → final head graded | No repro, no pre-PR gates. PR exists before CI | Emulates the documented behaviour of webhook-triggered agents `[devin-automations]` `[cursor-automations]`, "reproducing the issue" `[devin-oncall]`, and post-PR CI iteration (Engine, Seer, Bits, PostHog; SYN observability). The cap of "≤ 3 revisions / 90 min" is attributed to Engine [verify; if unverifiable, present it as our parameter]. **Strongest form:** the repo CI already contains fiks's contract suite and stored traces; the alert carries the raw trace; same guard. **Not emulated:** proprietary RCA, vendor models, telemetry integrations, their sandboxes. |
| **COMP-plain** (E8, Opus only) | as COMP, but the repo CI runs only the server's own tests (no contract suite, no stored traces) | Typical-repo CI | Same |
| **REPRO-AGENT** (C2, C3) | alert + raw trace file → agent writes one failing test under `test/` (20 turns, 1 session) → nothing else | No fix | PostHog regression-test PR and Devin "reproduce" emulation `[posthog-anatomy-pr]` `[devin-oncall]` |
| **FIKS+CU** (E4 only) | FIKS, plus the agent may end with a `contract_update` outcome | see P3 | Ours |

**Alert payload** (identical for L1, COMP, COMP-plain and REPRO-AGENT): a webhook-style JSON rendered to prose with tool, args, violated property id and message, receipt text, and the path of the raw trace file inside the worktree (`.alerts/<id>.json`, read-only). This is the strongest version: the agent can read everything fiks has.

---

## 5. Product changes to fiks before any confirmatory run

All changes land before the PREREG tag. The frozen fiks commit is the one recorded in every `meta.json`. The runner refuses a dirty tree (PROGRESS incident: `fiksDirty`).

| ID | Change | Why | Where (owning stream, §6) |
|---|---|---|---|
| P1 | **Sandbox.** Every agent Bash execution, every gate (F, P, suite, lint, typecheck), re-record replay and local CI run inside a Docker container with `--network none`, an empty env plus an allow-listed PATH, the worktree mounted read-write, and other files read-only. The agent process (holding the OAuth token) stays on the host, and its tool executions are proxied into the container. A canary `GH_TOKEN=fiks-canary-…` sits in the host env. | Closes the lethal trifecta during gates [SYN K16, gap-repair-security §6.2]; needed for E6 and as safe default for all runs | SPINE (exec-backend hook), SBX (implementation) |
| P2 | **Strict-format trace option** `--trace-format raw\|strict`. Strict: typed diff with field paths matching `^[A-Za-z_][\w.\[\]]{0,63}$`, typed and truncated scalars, no free text, hidden-Unicode stripped. | E6. The default is chosen on dev only (K1 rule: adopt strict if the dev correct-PR drop ≤ 5 pp, else raw, and say so) | SPINE (formatter hook), SEC (formatter) |
| P3 | **Contract-update outcome.** The agent may return `{outcome: "contract_update", delta}`. A deterministic acceptance gate requires that the delta (a) makes the triggering trace verify, (b) keeps every stored true-violation trace violating, and (c) keeps the clean v1 corpus verified. The output is a contract-change proposal, never a code change. | X21 / E4 | SPINE (outcome hook), CU |
| P4 | **Monitor interface** `ProxyOptions.monitor` + `--monitor`; offline replay evaluator over `CallRecord`s | E3, C1 | SPINE, DET |
| P5 | **Domain registry** (`--domain shop\|tracker`); generalised trace profile = (domain, base version, drift set); `assertStorableProfile` and the `vendorVersionOf` rules generalised | Second domain; single-drift profiles | SPINE |
| P6 | **Cost and token logging:** `costUsd`, input/output/cache-read/cache-creation tokens, turns, and wall time per phase (repro, F gate, agent, re-record, gates, CI) per attempt and per judge call | E9; M13 | SPINE |
| P7 | **Retries and `infra_error`:** exponential backoff (3 tries) on SDK, network and 429/overload errors; attempt-level `infra_error` is never graded as a model failure | §8.1 | SPINE |
| P8 | **Run registry keys** `experiment/arm/model/domain/drift/attempt`; summary keyed so that no run replaces another (fixes "latest run per phase wins") | Multi-model, multi-arm | SPINE (schema), RUN (runner) |
| P9 | **Hermetic local CI** that mirrors `ci.yml` in the sandbox image; validated against real GitHub Actions on 20 sampled heads pushed to vats98754 branches (no PRs); required agreement 20/20, otherwise investigate before R4 | Cost and rate limits; avoids PR spam; makes CI deterministic | SBX |
| P10 | **Arm hook:** `RepairOptions.arm` with an interface `{prepare, prompt, preGates, ciPolicy, prPolicy}`; FIKS is the default implementation; `would_open_pr` event; `--no-pr` mandatory in experiments | Arms | SPINE (interface), ARMS (L1, COMP) |
| P11 | **F-gate runs parameter** (3 in the product; 10 for C2 validity measurement) | C2 | SPINE |
| P12 | **PR body states the trace is untrusted** and includes the trace hash (provenance) | Security hygiene; not measured | SPINE |

---

## 6. Workstreams for parallel builders

**Ownership rules.**
- No two streams own the same path.
- **SPINE** owns *every pre-existing file* in the repo and the root configs (`package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `biome.json`, `vitest.config.ts`, `scripts/*`), except where a row below says otherwise.
- SPINE's first commit (< 2 h) creates empty skeleton packages for every new directory below, so that the `packages/*` glob and tsconfig `include` pick them up. It also adds root script entries (`paper:check`, `exp`) pointing at files that other streams own.
- Every other stream creates and edits only files under its owned paths. Any edit it needs in a SPINE file is a written request that SPINE implements.
- Each stream works in its own git worktree and merges on a verifier PASS.

| ID | Goal | Owns | Depends on | Deliverables | Acceptance tests (verifier runs) | Hours |
|---|---|---|---|---|---|---|
| **SPINE** | Hooks and product changes P4-P8, P10-P12; hook interfaces for P1-P3; vocabulary additions requested by C2 (before the freeze) | all pre-existing files under `packages/*/src`, `packages/*/test`, `apps/`, root configs, `scripts/`; new `packages/domains/src/{index,shop}.ts` | – | Domain registry; monitor / exec-backend / trace-formatter / arm / outcome hooks; cost and infra logging; registry keys; skeleton packages | `pnpm i && pnpm test` is green (≥ 147 tests). New unit tests per hook. `pnpm fiks repair --scenario D2 --no-pr --arm fiks --domain shop` gives the same gate verdict sequence as the 2026-10-20 loop log for D2. `pnpm fiks bench --phase A --k 1` writes `costUsd` and cache tokens. A forced SDK error yields `infra_error`, not `no answer` | 22-28 |
| **SBX** | P1 sandbox + P9 local CI + canary | `packages/sandbox/**` (Dockerfile, exec backend, ci-local, canary, egress log) | SPINE hook interface (stub OK) | Image pinned by digest; `ExecBackend` implementation; `ciLocal(worktree)`; GitHub Actions agreement script | A test agent command `curl https://example.com` inside the sandbox fails. `env` inside shows no canary. A test writing outside the mount fails. The D1-D5 oracle patches pass local CI and GitHub Actions identically (20/20 sampled heads, pushed to vats98754 branches, no PRs) | 12-16 |
| **DOM2** | Tracker vendor + `tracker-mcp` server repo | `packages/vendor-tracker/**`; repo `vats98754/tracker-mcp` (CI, Biome, `test/fiks` layout, seed tag `seed-tracker-v1`); `packages/domains/src/tracker.ts`; `packages/domains/docs/tracker.md` (public docs, frozen at PREREG) | SPINE (registry) | Deterministic vendor (frozen clock, admin state, identical OpenAPI across versions), ground-truth function, MCP server with ≥ 6 tools, 20 traffic task prompts | Vendor unit tests. The server's own CI is green. `pnpm fiks scenario v1-all --domain tracker` returns all `verified` once contracts exist. The ground-truth function agrees with vendor state on 100 random calls | 22-30 |
| **C2** | Tracker contracts (contract-author agent sees docs + v1 traffic only) | `packages/contracts/contracts/tracker-mcp.contracts.json`, `packages/contracts/contracts/AUTHORING-tracker.md` | DOM2 | Contracts + authoring log (inputs seen, timestamps); list of vocabulary needs sent to SPINE before the freeze | 0 violations on all v1 enumerated traffic of the *original* tracker catalog. The authoring log shows no drift artifacts were mounted. Tag `contracts-frozen-v1` pushed | 4-6 |
| **INJ** | Generic response-rewriting injector (builder never reads contracts) | `packages/injector/**` | SPINE (registry) | Rule format (JSON + sandboxed transform functions), per-profile activation, deterministic, sits vendor → injector → tap | Rule round-trip tests; D1-D5 re-expressed as injector rules reproduce the vendor's built-in v2 responses byte-for-byte on all fixture calls; no import of `@fiks/contracts` anywhere in the package (lint rule) | 8-10 |
| **MUT** | Response- and patch-mutation operators of §3.4 | `packages/mutate/**` | – | `mutateResponse(op, json)`, `mutatePatch(op, refFix)` (agent-driven, with prompts committed) | Golden tests per operator. Benign operators B1-B4 keep JSON semantics. Patch operators compile on the D1-D5 oracle patches | 6-8 |
| **BLIND** | Orchestrate sealed authoring (drifts, benign, catalog, hidden tests, reference fixes, second fixes, realism ratings) | repo `vats98754/driftbench-blind` (private) and `paper/blind-protocol/**` (briefs, container spec, mount manifests, split script) | INJ, DOM2, C2 freeze | 100 drifts + 30 benign + ≥ 600 entities; per-drift validity report; dev/test split file | An automated validity check per drift: silent (D2 conditions); seed fails ≥ 1 hidden test; reference fix passes all hidden tests on v1 and drifted; injector rule deterministic. Mount manifests show no fiks paths. Split reproducible from the seed | 12-16 builder + agent wall time |
| **HOLD** | Held-out oracle + patch pool + gate-set evaluator (C3) | `paper/harness/heldout/**`, `paper/harness/pool/**` | SBX, BLIND (dev split only during build), TRAFFIC (held-out traffic) | `grade(patch, drift) → {correct, reasons[]}`; differential runner (fast-check pinned); renamed-id variant; SAST 2-of-3 container (Semgrep CE, CodeQL CLI, eslint-plugin-security pinned); pool builder (dedupe, cap 30, seed); `accept(patch, testSet)` | On dev drifts: the reference fix is graded correct, base incorrect, and each of P1-P8 applied to D1-D5 oracle patches is graded incorrect, with the expected reason (e.g. P3 → renamed-id). Grading is deterministic across 3 reruns. Never reads test-split paths until R5 (access log) | 18-24 |
| **DET** | Detection baselines of §4.1 + offline evaluator | `packages/baselines/**`, `paper/harness/detect/**` | SPINE (monitor hook), MUT | Each baseline as a monitor; `detect-eval` writing per-call verdict rows (call id, detector, verdict, confidence, tokens) | Each baseline flags its expected case on D1-D5 (e.g. B-SNAP flags D1; B-SCHEMA does not flag D2 null). Judge rows record tokens and cost. 20 replays give identical verdicts for deterministic detectors (D1) | 16-22 |
| **ARMS** | L1, COMP, COMP-plain, REPRO-AGENT, alert renderer | `packages/arms/**` (incl. `FIDELITY.md`) | SPINE (arm hook), SBX (ci-local) | Arm implementations; budget accounting; `would_open_pr` semantics; fidelity notes with doc citations | On D2 (dev), each arm completes with Opus, `--no-pr`, producing a graded head. COMP revision loop stops at ≤ 3 revisions / 90 min. The guard blocks edits to existing tests in all arms. The alert JSON is byte-identical across L1, COMP and REPRO-AGENT for the same trace | 16-22 |
| **CU** | Contract-update outcome P3 | `packages/contract-update/**` | SPINE (outcome hook) | Outcome schema + deterministic acceptance gate | Unit tests: a delta that silences a stored true-violation trace is rejected; a delta widening the range for a benign $2,500 product is accepted when the traces still violate | 6-10 |
| **SEC** | Strict trace formatter (P2) + adversarial suite + malicious-diff detectors | `packages/repair-strict/**`, `paper/security/**` | SPINE (formatter hook), SBX | Formatter; 12 payloads (AgentDojo `important_instructions` / `tool_knowledge`, InjecAgent goals rewritten, AIShellJack-style goals; licences [verify]); canary checker; AST/SAST detectors for network calls, env reads and recorded-id special-casing | The formatter output matches the path regex and has no free text. Each detector fires on a planted positive and not on the D1-D5 oracle patches. The canary checker finds a planted canary in a test log | 14-18 |
| **TRAFFIC** | Clean corpus enumerator + multi-model held-out traffic | `packages/traffic/**` | DOM2, BLIND (catalog extension) | Enumerator; dedupe; agent traffic collector (Claude + ollama route) | ≥ 3,000 distinct inputs produced deterministically from the seed. Ground-truth labels attached. The ollama route produces ≥ 1 valid tool call per task on 3 tasks | 10-14 |
| **RB-1..RB-4** | One real bug each (R10, R19, R20, R9; reserves on failure) | `realbugs/<id>/**` + its fork under vats98754 | SPINE (registry), SBX | Fork pinned at prefix; process-level replay adapter; blind contract + log; fixtures labelled recorded vs synthesized; F/P result; held-out tests | F passes on prefix for the named property (10 runs). P passes on the human fix. The contract was authored before the fix diff was read (log). No GitHub write outside vats98754 (gh audit) | 14-24 each |
| **RUN** | Experiment runner | `packages/exp/**` | SPINE (registry keys) | `pnpm exp <R-id>`: worker pool (one vendor + worktree + container per worker); resumable append-only JSONL registry; randomized arm order; status-only progress (no outcome peeking); refuses a dirty tree | Kill -9 mid-run, then resume: the registry is complete with no duplicate keys. Status output contains no correctness fields. A 2-worker vs 1-worker run on 3 dev drifts gives identical gate verdicts | 10-14 |
| **AN** | Analysis and `paper:check` | `paper/scripts/**`, `paper/results/` (generated only) | – (synthetic data first) | Python 3.12 (stdlib + numpy, scipy, statsmodels pinned): Wilson, Clopper-Pearson, exact binomial, sign-flip permutation (exact / MC), BCa cluster bootstrap, Holm, shifted-NI test, GLMM sensitivity, McNemar mid-p; table/macro emitters; `paper:check` rebuild-and-diff | **Simulation check:** under a null DGP with drift heterogeneity, the Type I error of each C-test is within [0.04, 0.06] over 2,000 simulated datasets at α = 0.05, and NI size ≤ α. Cross-check against `eval_stats.py paired`/`mde` on toy data. `paper:check` fails on a hand-edited macro | 14-18 |
| **PREREG** | Write and freeze the pre-registration | `paper/prereg/**` (`PREREG.md`, `REGISTRY.json` of blob hashes, `DEVIATIONS.md`) | C2 freeze, MUT, AN (frozen scripts), ARMS (`FIDELITY.md`), HOLD criteria, K1 pilot decisions | Signed tag `prereg-v1` pushed to vats98754/fiks before R2-R4 | Every hash in `REGISTRY.json` matches the tagged tree. PREREG names every C-endpoint, test, n rule, exclusion and the infra policy exactly as in §8 | 6-8 |

**Critical path:** SPINE → DOM2 → C2 freeze → BLIND (tracker) → HOLD (dev validation) → R1 pilot → K1 → PREREG tag → R2-R5.
- Shop blind authoring can start as soon as INJ is done, because shop contracts are already frozen.

**Totals:** about 250-330 builder hours across 20 streams (RB counts as 4).
- With about 8 concurrent builders, 4-6 working days to the PREREG tag [estimate].

---

## 7. Run plan

Throughput and cost assumptions [estimate, replaced by R1 measurements]:
- **Repair attempt time and cost:** about 90 s and $0.11-0.21 for an Opus FIKS attempt (codebase-map §5). Sandbox and local CI are assumed to add about 30 s. COMP is assumed ≈ 1.6× FIKS time and cost.
- **Model prices:** Sonnet is assumed ≈ 0.5× Opus per attempt and Haiku ≈ 0.2× [estimate; under OAuth `total_cost_usd` is an API-price estimate, not a bill, verify].
- **Workers:** 5 parallel workers. OAuth subscription rate limits are unknown [verify]. The R1 pilot measures them, and wall-clock figures assume they halve the nominal parallel speed in the worst case.

| Run | What | Models | Trials | API-price $ [estimate] | Wall-clock [estimate] | Gate / checkpoint |
|---|---|---|---|---|---|---|
| **R0** infra validation (no LLM) | D1 determinism replays; P9 local-CI vs Actions agreement (20 heads); drift validity on all 100 + 30; mutation suite build | – | – | 0 | 3-5 h | All validity checks pass. Invalid drifts are dropped *before* the split is unsealed (logged) |
| **R1** pilot (dev only) | FIKS / L1 / COMP on 25 dev instances (20 blind + D1-D5); trace-format decision (raw vs strict, Opus, 3 attempts); REPRO-AGENT on dev; judge prompt tuning (≤ 5 iterations per arm) | Opus, Sonnet, Haiku × 2 attempts | 25 × 3 × 3 × 2 = 450 + 150 + 150 | 90-130 | 6-12 h | **K1:** estimate σ_d for the C2-C5 endpoints from dev; recompute MDEs; raise attempts per cell (never lower) or trigger top-up; freeze prompts and trace format; write PREREG; **tag `prereg-v1`** |
| **R2** detection (test split) | all detectors over the clean corpus, test drifts, benign set and mutants; judges on a stratified 1,500-call sample × 4 variants | Sonnet, Haiku (judges) | 6,000 judge calls | 40-60 | 3-6 h | Detected-test-drift count → top-up decision (counts only). C1 computed only at final analysis |
| **R3** agent repros | REPRO-AGENT on detected test drifts | 3 models × 2 | ≈ 306 | 20-35 | 2-4 h | – |
| **R4** main repair | FIKS / L1 / COMP on detected test drifts; COMP-plain on Opus | 3 models × 3 attempts (+ Opus × 3 for COMP-plain) | ≈ 1,377 + 153 | 200-280 | 15-30 h | **K2:** every 10% of cells, commit logs; status-only checks; pause if infra errors > 10% in a window (fix, resume; deviation logged) |
| **R5** grading + pool + C3 | held-out grading of every final head and every pooled candidate; pool acceptance under each test set; SAST | – | ≈ 1,900 pool patches + ≈ 1,500 final heads (overlapping) | 0 | 16-24 h (CPU-bound, 4 containers) | Grading determinism: 5% of patches re-graded; must match |
| **R6** benign | FIKS-current, FIKS+CU, COMP on 30 benign cases | Opus × 3 | 270 | 40-60 | 3-6 h | – |
| **R7** security | 12 payloads × 10 traces (D1-D5 + 5 dev blind) × {raw, strict}, sandboxed, `--no-pr` | Opus × 1 | 240 | 40-60 | 4-8 h | Any canary hit → stop and report (finding) |
| **R8** real bugs | detect, F/P, then FIKS vs COMP | Opus × 5 | ≈ 40-50 | 8-15 | 2-4 h + builder time | – |
| **R9** held-out traffic (before R5) | 2 domains × 20 tasks × 4 agents × 3 | Opus, Sonnet, Haiku, ollama 7B | 480 | 10-20 | 1 h (Claude) + 4-8 h (ollama, CPU, background) | – |
| **Total** | | | | **≈ 450-720, incl. 30% reserve** | **≈ 4-6 days of background running** | |

**Ordering.**
1. R0 → R1 → K1 → PREREG tag.
2. R9 and R2 can run in parallel.
3. Then R3, then R4, then R5.
4. R6-R8 are interleaved where workers are free.

**Cut order if time or budget binds (pre-registered; verification is never cut):**
1. COMP-plain;
2. ollama traffic;
3. B-OM;
4. real bugs beyond 2;
5. R7 down to 6 payloads;
6. Haiku in R4 (re-power on Opus + Sonnet at 4 attempts each).

**Never cut:** held-out grading, verifiers, C1-C5 at the floor n = 40.

---

## 8. Pre-registered analysis plan, threats, cuts

### 8.1 Analysis

- **What is computed.** C1-C5 exactly as in §2.1. E1-E10 with raw p and 95% BCa intervals. D1-D7 as counts and proportions with Wilson intervals.
- **How.**
  - Rates: Wilson; Clopper-Pearson for C1.
  - Paired drift-level differences: sign-flip permutation (exact if n ≤ 20, else 200,000 flips, seed in PREREG) and 10,000-resample BCa bootstrap over drifts.
  - Non-inferiority: shifted sign-flip.
  - Detector comparisons: mid-p McNemar at drift level, plus exact; judge AUROC by bootstrap clustered by drift (DeLong is invalid under clustering [SYN gap-eval §6.4]).
  - Model rates are averaged with equal weights.
- **Multiplicity.** Holm over C1-C5 only (FWER 0.05). Exploratory results are never called significant [X23].
- **Sensitivity** (reported, cannot rescue a failed C-test; a direction flip is reported prominently):
  - a GLMM `y ~ arm + (1|drift) + (1|model)` at attempt level;
  - per domain;
  - excluding the evasive stratum;
  - clustering by drift author;
  - held-out oracle without SAST and without the differential;
  - worst-case infra imputation (below).
- **Infra errors.**
  - API-call level: 3 retries with backoff.
  - Attempt level: an `infra_error` is re-queued up to 2 times. If it persists, the (drift, model, attempt-index) cell is dropped **for all arms** (pairwise deletion), and its count is reported.
  - If more than 5% of cells are dropped, a sensitivity analysis imputes against fiks: FIKS = incorrect PR / no correct PR, COMP = correct PR.
- **Exclusions (only these).**
  1. Drifts failing automated validity before unsealing.
  2. Undetected drifts (from C2-C5, by design; they are reported in the D4 funnel and E3).
  3. Drifts with < 2 patches in a class (C3 only).
  4. Persistent-infra cells (pairwise).
- **F-gate failures are not excluded.** They are FIKS outcomes (`no_pr`).
- **No interim looks.** Runners report status counts only. Analysis scripts are frozen at the tag and run once on complete data. Every later change goes in `DEVIATIONS.md` with a reason and both results.
- **Numbers in the paper.** Emitted only by `paper/scripts` from `paper/results` logs; `pnpm paper:check` rebuilds and diffs them (ORCHESTRATION certification 1).

### 8.2 What each confirmatory result would mean

| Outcome | Reading |
|---|---|
| C1 fails | Hand-written ranges overfit to the original catalog. The trigger needs calibration (E4/CU) before it can open PRs. The paper's claim is narrowed to "precise on its documented vocabulary". |
| C2 or C3 fail | A coding agent writes repros at least as good as the named-property test, and C19 does not hold against an agent baseline. |
| C4 fails | The strongest composition is as safe as fiks. fiks's contribution reduces to packaging. |
| C5 fails | Gates cost real fixes, and the trade-off is reported as a trade-off. |

All of these are publishable as stated; nothing gets reframed after the fact.

### 8.3 Threats to validity

- **Construct: the held-out oracle.**
  - Tests, a differential against a Claude-written reference fix, SAST and replayed traffic still do not prove correctness.
  - Mitigations: a second independent reference fix on 20% of drifts (agreement reported), ≥ 3 manifestations, and the renamed-id variant.
  - Without human review, the oracle is the ground truth. Optional human review (H26) is marked optional and needs the user's approval.
- **Single model family.** Drift authors, judges and repairers are all Claude. This could correlate "drifts Claude writes" with "drifts Claude fixes". The second family touches only held-out traffic. We state it as a limitation and cluster by author as a sensitivity analysis.
- **Composition fidelity.**
  - COMP is emulated from docs; no product account was used [ORCHESTRATION; G19].
  - We chose the strongest form (fiks's suite in the repo CI, raw trace in the alert, same guard, same model). This may *understate* the gap to real products, which we say.
  - The "≤ 3 revisions / 90 min" parameter is [verify].
- **Tuning asymmetry.** fiks's prompt was tuned on D1-D5. Mitigations: D1-D5 excluded from confirmatory tests; an equal dev tuning budget per arm.
- **Seeded vs real.** Two mock domains; TypeScript only; real bugs are 3-5 case studies, not pooled.
- **Conditioning on detection.** C2-C5 hold only for drifts the trigger catches. E3 reports coverage, including the evasive stratum, so the conditioning is visible.
- **Statistical.**
  - Drift heterogeneity dominates; seeds do not reduce it [evals-measurement §3].
  - The n floor is 40, and below 50 the MDE is ≈ 0.13 at σ_d = 0.25.
  - Models are a fixed facet, so results do not generalize to other model families.
- **Temporal drift of hosted models.** Arm order is randomized within blocks, and R4 runs inside a contiguous window that is recorded.
- **Security.** Only static attacks; adaptive attacks are out of scope and not claimed `[nasr2025attackermovessecond]`. Gate code runs sandboxed, but the agent process holds the OAuth token on the host.
- **Contamination.** All blind artifacts post-date the model cutoff. Real bugs are stratified by fix date vs cutoff.
- **Prior merges.** shop-mcp PRs #1-#4, #6, #7 were merged by the assistant at the owner's request without line-by-line review (README). The paper never presents them as maintainer acceptance (M18).

### 8.4 Deliberately cut, and why

| Cut | Why |
|---|---|
| Receipt agent-outcome effects (H13, X3, X4, X10) | Receipts are prior art (Outcome Monitors). Powering agent outcomes needs ≥ 25 tasks × several drifts with trivial-agent arms [SYN H13, gap-eval §7], which is a second paper. The existing bench goes to an appendix, labelled underpowered (D7). |
| Separate recurrence experiment (H12) | For a deterministic tool, post-fix recurrence across agents equals held-out generalization. It is folded into the oracle (multi-model traffic replay). |
| τ²-bench adapter (H19) | 15-25 h of adapter work for transfer of *detection*, which is not our claim. |
| Contract inference (H16) | Not part of the narrow novelty. B-OM is a tier-2 detection baseline only. |
| BBCBench (H28), AIDev re-analysis (H27), MCPMark organic rate (G17), MCP-Atlas | Sources pending re-verification, or off-claim. C21 is cited descriptively with the SYN App. A wording. |
| Go/Python real bugs (waves 2-3) | 30-40 h harness each. TS wave 1 gives case studies. |
| Human review (H26) | Not available without user approval. The paper stands without it; marked optional. |
| Adaptive attacks; SAST as a product gate | Not claimed. SAST is in the oracle, not the product, so the product under test does not change. |
| Repair with a second model family | 7B CPU inference makes an agentic repair attempt tens of minutes long [estimate]. Detection judges on ollama are possible later, as an optional extra. |
| Portability (H22), noise/duplicates (H29), live-integration trigger arm | Off the central claim. |
