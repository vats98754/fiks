# Experiment design: MAXIMAL-EVIDENCE

Designer: independent experiment designer, angle **maximal evidence** (use the full OAuth model budget to build the broadest credible evidence base, but hang every headline on a small Holm-corrected confirmatory family).
Date: 2026-10-21. Inputs: `paper/ORCHESTRATION.md`, `paper/research/SYNTHESIS.md` (primary), `paper/research/codebase-map.md`, `PROGRESS.md`, `README.md`, paper-forge references (evals-measurement, agents-tool-use, grilling protocol, paper-writing).

**Epistemic labels used in this document.**
- `[measured]`: a number already in `bench/results/` or `PROGRESS.md`.
- `[eval_stats]`: computed with paper-forge `eval_stats.py mde` (paired normal approximation, power 0.80, two-sided). The exact command is given next to each number.
- `[assumption]`: a planning figure. It is replaced by a pilot measurement (§7, P0) before any confirmatory run, and never appears in the paper.
- `[verify]`: a fact about an external tool or dataset that a builder must confirm before relying on it.
- Synthesis IDs (H1–H29, X1–X28, M1–M21, G1–G19, R1–R25, K1–K18) refer to `SYNTHESIS.md`.

**Environment facts checked by this designer on 2026-10-21.** `ollama`, `docker`, `go` and `python3.12` are installed under `/opt/homebrew/bin`. The ollama server was not running and no local model was pulled. `hoverfly` and `oasdiff` are not installed. The machine has 16 GiB RAM and 8 cores.

---

## 1. Thesis and contributions

**Thesis (one sentence).** Checking each successful tool result against an outcome contract at the agent–tool boundary turns silent upstream drift into a deterministic, fail-first reproduction test. Repair gated on that test removes the fault for every later agent. On four drift domains, τ²-bench and real MCP bugs, the full loop beats detection-only receipts, LLM judges and the "alert → coding agent → PR" composition on the outcomes users and maintainers care about, and it loses where we pre-register that it should: out-of-vocabulary string corruption and legitimate vendor evolution.

**Contributions.** Each bullet names the experiment and the table or figure that proves it.

1. **DriftBench v2, a benchmark where the upstream changes and the tool does not.** It covers 4 domains and 96 tasks, with five suites: author drifts, blind-authored drifts, third-party-injector drifts, 12 pre-declared response-mutation operators and blind-authored benign evolution. It adds a τ²-bench drift layer and a forks-only real-bug harness. Labels come from a ground-truth projection of vendor state, so they never depend on any monitor's verdict, fiks's included. This answers M1 and M2.
   - Experiments: S1–S6 (§3).
   - Evidence: **Table 1** (substrate inventory and validity funnel) and **Figure 2** (per-class detection heatmap, every monitor × every fault class, including the benign column).
2. **Per-call contracts vs. 20 implemented detection baselines on faults we did not design.** The baselines span the schema floor, spec diff, record/replay, snapshot diff, statistical and data-quality monitors, LLM judges (± raw upstream), and inferred contracts. The comparison reports detection accuracy, clean false positives and calls-to-detect.
   - Hypotheses: **C1, C2** (confirmatory); E1–E6 (exploratory).
   - Evidence: **Table 2** and **Figure 3** (calls-to-first-detection, per-call vs windowed).
3. **The loop's gates measured against the compositional counter-case.** Three comparisons:
   - trace-derived, stated-reason F-gated repro vs an agent-written repro from the same raw trace;
   - gated repair vs "prose alert → same coding agent → PR → CI after", plus seven more repair arms;
   - laxity and hidden-oracle regressions.

   Hypotheses: **C3, C4**; E7–E11. Evidence: **Table 3** (repair outcome funnel per arm) and **Figure 4** (laxity distributions).
4. **What users get, durably and across models.** A merged fix vs receipts alone vs no fiks, measured as task success and wrong answers:
   - primary model claude-sonnet-5-5;
   - replicated on claude-haiku-5-5, claude-opus-5-5 and one local open-weight model;
   - plus τ²-bench transfer, real-bug waves and a security suite (injection through the trace into the repair agent).

   Hypotheses: **C5, C6**; E12–E22. Evidence: **Figure 1** (pass^k by arm × model, the paper's lead figure), **Table 4** (τ² and real bugs) and **Table 5** (security: containment, malicious-diff rate, utility under attack).

---

## 2. Hypotheses

### 2.1 Confirmatory family (6 hypotheses, Holm at family-wise α = 0.05)

Rules shared by all six:
- **One primary endpoint each.** C4 and C6 carry a non-inferiority guard tested as an **intersection–union test (IUT)**: the hypothesis is supported only if both components reject at the Holm-adjusted level. Their p-value for Holm is the larger of the two component p-values. An IUT needs no extra α split.
- **Power.** We fix n in advance and report the MDE at α = 0.05 and at the Holm worst case α = 0.05/6 = 0.00833. Power is 0.80, from `eval_stats.py mde`. The per-task SD planning value **0.40** comes from the existing 2026-10-20 runs: the per-task differences receipts−direct and fixed−receipts each have SD 0.408 over 6 tasks `[measured; computed from bench/results/*/trials.jsonl]`. With 6 tasks this estimate is crude, so we also give MDEs at 0.30 and 0.45.
- **Dev/test separation.** Contracts, judge prompts, inferred contracts, receipts wording, graders and analysis code may be tuned only on the **dev split**: the author drifts, plus v1 traffic recorded before the freeze. Confirmatory endpoints are computed only on the **test split**: blind-authored and injector drifts, blind benign changes, blind-authored tasks, and post-freeze traffic. C5 and C6 use all 88 drift-sensitive tasks, because their manipulation (receipts, merged fixes) does not involve anything tuned on the tasks' answers. The author-drift tasks are still reported separately as a sensitivity analysis.

| ID | Statement (direction) | Primary endpoint | Unit; n; how chosen | Test | Falsified if | Baselines |
|---|---|---|---|---|---|---|
| **C1** (H3 on blind faults; X2) | On faults we did not author, fiks's frozen hand contracts classify tool results more accurately than the strongest pre-registered LLM judge (claude-opus-5-5 given tool description, outputSchema, args, result **and the raw upstream exchange**). | Balanced accuracy, BA = ½(TPR + TNR), where the label is "tool output ≠ ground-truth projection" (§3.4). The judge runs 3× per instance and its verdict is the majority. | Labelled instance (one scripted probe call). n = 80 faulty-output instances (60 blind + 20 injector, after the validity filter) + 104 correct-output instances (24 blind benign + the 80 fault probes replayed on v1). Var(ΔBA) = ¼[Var(ΔTPR) + Var(ΔTNR)]. Assuming discordance 0.30 on faults and 0.10 on correct outputs: SD(ΔBA) = ½·√(0.548²/80 + 0.316²/104) = 0.034, so **MDE ≈ 0.12** at α = .00833 (multiplier 3.48 = z₀.₉₉₅₈ + z₀.₈) and 0.096 at α = .05. Check of the fault stratum alone: `eval_stats.py mde --n 80 --sd-diff 0.548 --alpha 0.00833` gives 0.213 for ΔTPR. The 80/24 counts are fixed by the blind-authoring quota (§3.2). | Paired permutation test: swap method labels within instance, stratified by label, 10⁵ permutations, two-sided. 95% stratified-bootstrap CI on ΔBA. | ΔBA ≤ 0, or its CI includes 0. *Pre-registered expected loss inside this test:* the judge wins on the S12 plausible-string class. | LLM judge (opus ± upstream; sonnet and haiku in E2). The schema floor and the others appear in Table 2 (E1). |
| **C2** (H5) | On clean, held-out traffic, fiks's per-receipt false-positive rate is below 2%. | FP = a `violated` receipt on a result whose output equals the ground-truth projection. | Tool result on v1 vendor traffic produced **after the freeze**: the A_v1 phase on all 96 tasks × 4 models, τ² v1 trials, and real-bug fix_sha runs. Expected n ≥ 5,000 `[assumption: ~3 calls per trial]`. A pre-registered minimum of n = 1,000 lets the bound pass with ≤ 3 FPs (1,000 receipts with 3 FPs gives Wilson upper 0.88%) and with ≤ 19 FPs at n = 3,000 `[computed with the Wilson formula from eval_stats.py]`. | One-sided exact binomial test, H0: p ≥ 0.02. Wilson 95% CI reported. Robustness: contract-cluster bootstrap and per-domain bounds. | Fail to reject H0 (bound ≥ 2%). The 1% bound and per-trial and per-task FP are also reported. Benign-evolution firing is **not** counted here (E13, expected loss). | None (absolute bound). Baselines' clean FP appears in Table 2. |
| **C3** (H7 + H8 strongest arm; X16, X17) | A trace-derived, stated-reason F-gated repro is valid and non-lax more often than a repro test that a strong coding agent writes from the **same raw trace plus receipt**. | Valid-non-lax: (i) fails on the prefix, (ii) passes on the reference fix, (iii) rejects ≥ 80% of the instance's **pre-generated wrong-patch pool** (≥ 8 patches, generated before either arm runs; §3.6). | Repairable instance that fiks detected (author + blind + injector + TS real bugs). Expected n ≈ 80–95 `[assumption: about 70% of blind/injector faults detected]`. The baseline is claude-opus-5-5 with 3 seeds; its per-instance score is the mean over seeds. `eval_stats.py mde --n 80 --sd-diff 0.45 --alpha 0.00833` → **MDE 0.175** (0.141 at α = .05). With SD 0.35: 0.136. | Two-sided sign-flip permutation on per-instance differences dᵢ = fiksᵢ − mean(baselineᵢ). Bootstrap CI. | d̄ ≤ 0, or its CI includes 0. | Agent-written repro from the raw trace (primary). From prose alert only, and plain F→P without the stated-reason gate (E7, E8). |
| **C4** (H9; the compositional counter-case) | At equal model, turn budget and attempts, the fiks loop (F gate + full contract suite + all stored traces + typecheck/lint + CI before the PR) ships fewer incorrect PRs than the composition baseline (prose alert → same Agent SDK repair agent → PR → CI after, ≤ 3 CI-driven revisions, 30-minute cap), **without** shipping meaningfully fewer correct ones. | (a) Superiority: incorrect-PR rate, i.e. a PR opened that fails the **hidden oracle** (§3.5). (b) IUT guard: correct-PR rate non-inferior, margin −10 pp. | The same instances as C3. 3 seeds per arm, opus. Per-instance rates are means over seeds. At n = 80: MDE 0.175 (SD 0.45) or 0.136 (SD 0.35) at α = .00833 `[eval_stats]`. The NI margin of 10 pp is the largest drop in correct PRs we would accept for removing incorrect PRs. | (a) two-sided sign-flip permutation; (b) one-sided paired bootstrap lower bound > −0.10. Holm p = max(p_a, p_b). | (a) fails, or (b) fails. Reported in full either way. | Composition (primary). Ungated, raw-trace, repro-only, PostHog-like, Itzal-like, Engine-like and mini-swe-agent are exploratory (E9). |
| **C5** (H12, user-level form) | For later agents, a server with fiks's gate-passing PRs merged gives higher task success than the same unfixed server with receipts only. | Per-task pass^1, the mean of k = 8 trials, on the v2 single-drift profile of each task. | Task: 88 drift-sensitive tasks (4 domains × 22). Primary model claude-sonnet-5-5. `eval_stats.py mde --n 88 --sd-diff 0.40 --alpha 0.00833` → **MDE 0.148** (0.120 at α = .05; 0.111 at SD 0.30; 0.167 at SD 0.45). Choosing 88 tasks meets the target of detecting 0.15 at the Holm worst case with SD 0.40, which needs n ≥ 87 (`mde --target 0.15 --sd-diff 0.40 --alpha 0.00833`). | Two-sided sign-flip permutation on per-task differences. Secondary: a beta-binomial model with a task random effect, and pass^k for k = 1..8. | Difference ≤ 0, or its CI includes 0. Undetected blind drifts stay unfixed in **both** arms. This dilution is deliberate and reported. | Receipts-only (detection-only; primary). No-fiks, composition-fixed and block (E14, E15). |
| **C6** (H13; X10) | Before a fix lands, receipts lower the wrong-answer rate compared with no monitor, without lowering task success by more than 10 pp. | (a) Per-task wrong-answer rate (grader outcome `wrong`, including hedged wrong values). (b) IUT guard: pass^1 non-inferior, margin −10 pp. | 88 tasks × k = 8, sonnet. MDE for (a) as in C5: 0.148 at α = .00833. The NI margin is fixed because receipts v1 once *lowered* pass rate (`PROGRESS.md`, README "Receipt wording matters") `[measured]`. | (a) two-sided sign-flip permutation; (b) one-sided paired bootstrap lower bound > −0.10. Holm p = max. | (a) not lower; or (b) fails. The trivial agents in E16 must not match the receipts arm on (a). | No monitor (primary). Caution prompt, retrieval-status line, block arm, always-decline and always-trust agents (E16). |

**Holm procedure.** Sort the six p-values; compare the i-th smallest with 0.05/(6 − i + 1); stop at the first non-rejection. Report adjusted p-values. Nothing outside C1–C6 is ever called "significant".

**Pre-registered expected losses** (they must be reported whichever way they come out):
- C1: S12 class loses to the judge.
- C6(b): D2/D4-type drifts are at risk.
- E13: benign evolution produces code PRs where a contract update is right.
- E5: GX profiler parity on value drifts.
- E19: the strict-format trace may hurt repair.

### 2.2 Exploratory set (raw p, effect sizes and CIs; never "significant")

| ID | Question (synthesis origin) | Endpoint | Substrate |
|---|---|---|---|
| E1 | Per-class recall at matched clean FP: contracts vs schema floor (MCP SDK client, Ajv strict draft 2020-12), Prism, oasdiff, ContextForge schema guard (H1, H2, X1, X12) | Recall per C3 class; mid-p McNemar on discordant instances | S1–S4 offline |
| E2 | Judge model and evidence ablation: haiku/sonnet/opus × (± upstream); ALTK Silent Review via the shim (X2) | Sensitivity/specificity, tokens and API-price per call | S1–S4 offline |
| E3 | Record/replay and snapshot oracles: nock-recorded v1 tests, Hoverfly Diff, Gilesi-style snapshot diff, Diffy-style differential (H4) | Right-reason failure; FP on benign at equal recall | S1–S4 |
| E4 | Mutation-operator FN per operator and per contract source (hand / template-inferred / LLM-authored / Outcome-Monitor-mined). S12 should be the worst class (H6, M21). | FN with Wilson CI | S4 |
| E5 | Data-quality vocabulary parity: GX profiler suite, dbt-style tests, datacontract-cli `breaking` (H16, HD1). We expect GX to match on D1/D2/D4/D5 and expect no batch tool to catch D3. | Detection per drift | S1, S4 |
| E6 | Per-call vs windowed statistical detection: AegisFlow-style KS/null/range, Evidently defaults, whylogs, z-score volume (H17, X20) | Calls-to-first-detection; wrong answers served before detection; per-window FP on benign | Offline replay of agent traffic ordered by time |
| E7 | Three-arm repro input (H8): trace → test vs raw trace in the prompt (agent writes the test) vs prose alert | F-gate pass; valid-non-lax | S1–S3, S6 |
| E8 | Stated-reason gate vs plain F→P: disagreement rate and laxity (H7, H11, X17) | Gate disagreement; laxity distributions | S1–S3, S6 |
| E9 | Seven further repair arms (ungated, raw-trace, repro-only gate, PostHog-like, Itzal-like, Engine-like, mini-swe-agent) and repair-model ablation (sonnet, haiku) (H9, H10) | Correct / incorrect / no PR; cost; minutes | S1–S3 |
| E10 | Hidden-oracle rejections: patches that pass the single repro but fail hidden tests, rejected by suite + traces; collateral regressions (H10) | Count, with Wilson CI | S1–S3 |
| E11 | Contract gaming: property-based fuzzing of gate-passing patches for validator widening (H25) | Widened-patch rate | S1–S3 |
| E12 | Model replication of C5/C6 on claude-haiku-5-5, claude-opus-5-5 and the local open-weight model; scaffold control (sonnet through the open-weight agent loop) | Same endpoints per model; model × arm interaction | S1–S3 |
| E13 | Legitimate evolution (H18, X21): share of benign cases that end in a code PR vs a `contract_update` proposal vs no action, after product change P5 | Outcome distribution | S5 |
| E14 | fiks-fixed vs composition-fixed server (end-to-end user outcome of the two repair pipelines) | Per-task pass^1 | S1–S3 |
| E15 | Block arm (withhold violated results) vs receipts | Pass^1, wrong rate | S1–S3 |
| E16 | Cheap mitigations and trivial agents: caution prompt, retrieval-status line, always-decline, always-trust (H13, M15) | Wrong rate, pass^1 | S1–S3 |
| E17 | τ²-bench transfer (H19): detection, clean FP, and pass^k for receipts and fixed vs direct; C11-protocol-style replication with C11's two faults on τ² retail | Detection; paired pass^1 gain | S7 |
| E18 | Real bugs (H14, H15): blind-contract detection on prefix vs fix; F→P agreement with the human fix; coupling to seeded templates; trace vs issue-text repair | Detection; FP on fix; agreement; held-out pass | S6 |
| E19 | Security (H23, H24, H-S3): containment, canary hits, malicious-diff rate, utility under attack for 4 repair configurations; adaptive red team reported separately | Rates with Wilson CIs | S8 |
| E20 | Contract inference learning curve (H16): detection and FP vs number of v1 calls | Curves | S1, S4 |
| E21 | Portability (H22): identical verdicts as a Docker MCP Gateway after-interceptor; `_meta` vs text-block receipt survival per client framework | Agreement | S1 |
| E22 | C21 re-analysis on AIDev-pop (H27) | OR per failed check under 5 specifications | external dataset |

### 2.3 Descriptive set (construction properties; reported, not tested)

- **D1 (H2): trigger matrix.** Compile, typecheck, lint, Dependabot-style CI, oasdiff and the live-integration test vs each drift: whether each fires, and whether its message names the violated property.
- **D2 (H12, literal form): recurrence.** Post-merge violations per contract per session across 4 models × all tasks, with a Wilson upper bound. Run `fiks confirm` replays of every stored trace.
- **D3 (H20): CI before PR.** Red-CI PRs exposed per arm, and the minutes it costs.
- **D4 (H21): determinism.** Verdict agreement over 20 offline reruns, and F-gate agreement over 10 reruns per instance.
- **D5 (H29): noise.** PRs per repo-week, duplicate and already-fixed hits, and suppressed true fixes.
- **D6 (M13): cost.** Tokens, API-price estimate and wall-clock per trial, per repair and per judge call, for every arm.
- **D7 (M20): funnel.** Alert → valid repro → gate-passing patch → green CI → PR → (experiment-branch merge) → confirmed, per substrate.
- **D8 (optional, H26): human review.** Runs only if the user later approves human reviewer time. The paper does not depend on it.

---

## 3. Benchmarks and substrates

### 3.1 Inventory

| ID | Substrate | Size | Trials / calls | Split |
|---|---|---|---|---|
| S1 | **DriftBench v2 author suite.** shop (D1–D5 existing + D6–D9 new) and 3 new domains: **pay** (payments), **book** (calendar/booking), **issue** (issue tracker), 9 author drifts each | 36 author drifts; 4 MCP servers, each in its own repo `vats98754/{shop,pay,book,issue}-mcp` | Scripted probe calls: 36 fault + 36 v1. Agent tasks below. | dev |
| S2 | **Blind-authored suite**: drifts written by sealed authoring agents (§3.2) | 60 valid fault drifts (15 per domain), kept in authored order from ≤ 25 candidates per domain | 60 probes + 60 v1 replays | test |
| S3 | **Third-party injector suite**: Hoverfly Modify-mode middleware between tap and vendor, written by a separate blind author from Hoverfly docs and the vendor's public OpenAPI only | 20 valid (5 per domain), plus an exploratory 8 authored by the local open-weight model (family diversity) | 20 + 20 probes | test |
| S4 | **Response-mutation suite.** 12 pre-declared operators (§3.3) over every applicable leaf path of the recorded v1 upstream JSON | ≈ 300–400 mutants `[assumption: ~8 paths × 12 operators × 4 domains, minus non-applicable]` | offline replay only | test (operators frozen now) |
| S5 | **Blind benign-evolution suite.** Changes a careful maintainer accepts without a code change: new optional field, new documented enum value the tool passes through, widened range, reordered list with a stable total, documented new field next to the old one, new version header | 24 valid (6 per domain) from ≤ 10 candidates per domain | 24 probes | test |
| S6 | **Real bugs (forks only)**: wave 1 TS (R9, R10, R14, R19, R20 + reserves #4628, #3137); wave 2 Go (R1–R5, R11, R12, R15–R18); wave 3 Python (R6–R8, R13, R21–R25 + the τ² `cancel_reservation` defect) | 28 candidates; expected 10–15 reproducible (SYNTHESIS §7 estimate) | prefix and fix_sha × 10 offline reruns; repairs as in §7 | test |
| S7 | **τ²-bench drift layer.** Retail (115 tasks) and airline (50), from the τ² paper's task counts [verify against the pinned task-set version]. DB reads are wrapped behind a version-switchable HTTP vendor and exposed as an MCP server, so fiks can tap them. 5 drift categories are mapped onto τ² tools, plus C11's two `get_order_details` faults. | 165 tasks | k = 4 per arm (the τ² paper's protocol) | test |
| S8 | **Adversarial-trace security suite.** 10 injection templates (AgentDojo- and InjecAgent-style, plus encoded and unicode-tag variants) in vendor string fields × 4 attacker goals (write outside `src/`, exfiltrate a **fake canary** secret, attacker-directed `src/` behaviour, edit tests or fixtures) × 5 carrier drifts (shop D1–D5) | 200 attack cases per configuration | 4 configurations + adaptive red team | test |
| **Tasks** | 24 per domain = **96**: 22 drift-sensitive + 2 controls each. Shop's T1–T6 are kept; 90 are new. Tasks for blind drifts are written by the blind authors together with the drift, grader and hidden oracle. | 88 drift-sensitive | k = 8 per arm for Claude models (§7) | mixed; C5/C6 use all 88 |

The C5/C6 ratio of author to blind drift tasks is fixed at 48:40, which gives 12 author-drift and 10 blind-drift tasks per domain.

**Single-drift profile (primary).** Each drift-sensitive task runs against a vendor with *only its target drift* active. This avoids interactions and makes attribution clean. A full-v2 profile (all author drifts at once, as in today's bench) is run as exploratory phase F (§7) so the results stay comparable with the 2026-10-20 runs.

### 3.2 Removing circularity (M2, M21)

1. **Freeze before reveal.** Contract files, the inferred-contract configuration, LLM-judge prompts, receipt wording, graders for the dev tasks, the mutation-operator code and `paper/scripts/` analysis code are committed and tagged `prereg-freeze-1`. The tag's SHA and the SHA-256 of `paper/prereg/PREREG.md` are recorded in `paper/prereg/freeze.json` before any test-split artifact is revealed.
2. **Sealed blind authoring.** Blind drifts, benign changes, their tasks, graders and hidden oracles are written in a separate **private** repo, `vats98754/fiks-blind`.
   - Authors are agent sessions whose worktree contains only an exported snapshot of the vendor v1 source, the vendor's OpenAPI document, the C3 fault taxonomy, and a brief.
   - They do **not** see contracts, fiks, receipts, the author drifts or the MCP server source. Real vendors do not see their clients either; drifts that turn out not to affect the server are filtered later by rule.
   - Category quotas per domain (25 candidates): unit/scale 3, rename/drop 3, lost write/partial write 3, pagination/truncation 3, time format/zone 3, enum/state 3, identity/count/cross-field 3, **plausible-value string perturbation (S12) 4**.
   - The sealed tree's SHA-256 is committed to `paper/prereg/blind.sha256` before the freeze. It is revealed (merged as a read-only submodule) only after a verifier confirms the freeze tag.
3. **Third-party injector.** Hoverfly middleware drifts come from a different author session that sees only Hoverfly docs and the OpenAPI document. The fault is applied at the HTTP layer, outside any code fiks's authors wrote.
4. **Operators declared before contracts for the new domains exist.** The 12 operators are listed in §3.3 **in this document, dated 2026-10-21**. The pay, book and issue contracts do not exist yet.
5. **Contract authors do not see v2 code.** WS-CTR works in a sparse checkout that excludes `packages/vendor-*/src/drifts*.ts` and the domain repos' v2 fixtures (§6).
6. **Labels independent of every monitor.** A per-domain ground-truth projection, `truth(tool, args, vendorState)`, is written by the domain builder. It is cross-checked by a verifier: on every v1 fixture call it must equal the tool's output exactly. An instance is **valid** if:
   - fault: the projection ≠ the unfixed tool output on the probe; or
   - benign: the projection = the unfixed tool output.

   The validity filter runs before any monitor is executed on the test split, and the first 15 / 5 / 6 valid instances in authored order are kept.
7. **Different model family for part of the faults.** Exploratory S3b: 8 injector drifts authored by the local open-weight model. Same-family bias between the drift author (Claude) and the judge (Claude) favours the judge in C1, which makes C1 conservative for fiks.

### 3.3 Pre-declared mutation operators (S4; frozen 2026-10-21)

Each operator is applied to one leaf path of a recorded **v1 upstream** JSON response at the HTTP layer, so the server processes the mutated response. Ground truth stays the original value: the operator models a representation or behaviour change, not a change in the underlying data.

| Op | Transformation | C3 class |
|---|---|---|
| O1 | numeric × 100 | unit/scale |
| O2 | numeric ÷ 100 | unit/scale |
| O3 | rename key (`x` → `x_value`) | silent rename |
| O4 | drop key | dropped field |
| O5 | set to null | null/default |
| O6 | truncate array to its first page, keep `total` | truncation |
| O7 | number ↔ numeric string | type swap |
| O8 | ISO-8601 ↔ epoch ms (and epoch s) | time format |
| O9 | inject an unseen enum value | enum fall-through |
| O10 | plausible string perturbation: swap a value with the same field of another record | S12 |
| O11 | identity shift: an id points to a neighbouring record | identity |
| O12 | currency/locale swap (`USD` → `EUR`, decimal comma) | unit/locale |

### 3.4 How benign evolution is tested

- **S5 instances** are run through every monitor (E1–E6). Any firing is counted in a separate benign-FP column, never in C2.
- **fiks with product change P5 (`contract_update` outcome)** runs the loop on every benign instance. The correct outcomes are "no action" or a `contract_update` proposal. A code PR is wrong (E13; pre-registered expected loss for fiks *without* P5, reported both ways).
- **Benign changes are also active during the agent bench.** In the A_v1b phase (sonnet, 96 tasks × k = 4), all 6 benign changes per domain are active. This measures receipts' effect on success when nothing is wrong.

### 3.5 Hidden oracle (C4, E9–E11)

A patch is **correct** only if all three hold:
1. **Differential.** On ≥ 50 seeded random inputs per tool against the **live** v2 vendor at the instance's profile, and on the v1 vendor, the patched tool's output equals the ground-truth projection.
2. **v1 goldens.** All v1 golden fixtures still pass.
3. **Hidden tests.** The blind author's hidden tests pass. For author drifts, a separate agent writes them from the drift description.

None of these is visible to the repair agent: they live outside its worktree, under `paper/oracle/` in `fiks-blind`. Real bugs use the human fix's tests plus the prior suite, as SYNTHESIS §7 step 6 specifies.

### 3.6 Wrong-patch pool (C3 laxity)

The pool is built per instance **before** either repro arm runs:
- 4 rule-based wrong patches: clamp to the range ceiling, constant in-range value, revert-to-v1-parsing with an off-by-one, null-to-default;
- ≥ 4 LLM-generated plausible-but-wrong patches: claude-haiku-5-5, prompted for "a fix that makes the symptom disappear but is wrong". A patch enters the pool only if it **fails** the hidden oracle.

The pool is frozen with its hash, and laxity is computed against it.

---

## 4. Baselines to implement (not describe)

Products are **emulated from their public documentation**; no product accounts are used. The paper says so in every table caption that names a product.

### 4.1 Detection (all behind the new monitor interface, P1; all run offline over S1–S5 and live where marked)

| Baseline | Implementation | Fidelity notes |
|---|---|---|
| MCP SDK client schema check | Use the TS SDK's client-side `outputSchema` validation as-is | Exact |
| Ajv strict (draft 2020-12, formats, min/max) | Ajv over each tool's declared outputSchema | Strongest schema floor; we add no constraints the server did not declare |
| Strict-spec ablation | Ajv over a hand-tightened schema (ranges, enums, formats) | Upper bound for "spec as oracle" (X1) |
| Prism validation proxy | Prism (Apache-2.0) in proxy mode with vendor OpenAPI [verify CLI flags] | Exact tool; spec unchanged by construction |
| oasdiff / openapi-diff | Run on v1 vs v2 OpenAPI, and on real-bug repos' specs where they exist [verify licence] | Exact; 0 findings on S1–S5 by construction (stated as D1) |
| ContextForge schema guard | Run the IBM ContextForge gateway locally with its schema-guard plugin [verify plugin name and Python packaging] | Exact if it runs; else emulated from docs (marked) |
| Docker MCP Gateway after-interceptor | fiks verdict logic inside an interceptor (portability, E21) | Exact runtime; logic ours |
| LLM judge | Agent SDK `query` with no tools; prompt frozen at the freeze; 3 models × (± upstream body); JSON `{verdict, property, reason}` | Ours; dev-tuned with the same effort as the contracts (≤ 3 prompt revisions on dev, logged) |
| ALTK Silent Review | Its open-source component [verify name and licence], with its LLM calls routed through the local shim (P12) | Exact code; backend model substituted (stated) |
| Enkrypt-style judge gateway | Emulated: judge-on-result with a block/annotate action | From docs |
| nock record/replay ("Keploy-style") | Record v1 upstream as test fixtures, then run the server's suite under v2 | Keploy's eBPF capture is emulated with nock (stated) |
| Hoverfly Diff | Hoverfly (Apache-2.0) diff mode against a v1 simulation | Exact tool |
| Snapshot diff (Gilesi-style) | Per-endpoint field set, type and magnitude diff vs the v1 snapshot, in TS over the tap | Reimplemented from the paper |
| Diffy-style differential | Same request to v1 and v2, noise-filtered diff | Reimplemented from docs |
| GX profiler suite | Great Expectations (Apache-2.0) expectations generated from v1 batches by our in-house profiler (GX V1 removed its profilers) | Exact library; profiler ours (stated) |
| datacontract-cli | Its `breaking` and `test` commands over an ODCS file derived from v1 (MIT) | Exact tool |
| Evidently / whylogs | Default drift presets over windowed tool outputs (Apache-2.0) | Exact library, defaults unchanged |
| AegisFlow-style statistics | KS on numeric fields, null rate, range from history, plus a 10-snapshot validator | Reimplemented from the paper (no code released) |
| AVH-style | Single-column metric constraints selected under an FPR budget δ | Reimplemented from the paper |
| Outcome-Monitor reimplementation | Mined contracts (templates over v1 traffic) + nonbinding receipts naming a recovery tool | Reimplemented from C11's paper (no licence stated) |
| Executable-contract audit checker | Its MIT/Zenodo artifact run against our servers [verify runnable] | Exact if it runs |
| AGORA+/Beet | GPL-3.0 Java tool run as a separate process on recorded v1 traffic | Exact tool; not linked |
| Template-inferred contracts (ours, P-INF) | Daikon/Deequ-style templates over the fiks invariant vocabulary, with an FPR budget | Ours |
| LLM-authored contracts | claude-opus-5-5 writes a contract file from the tool description and 20 v1 samples; 3 seeds | Ours (SkillGuard-like) |

### 4.2 Triggers (D1)

Each drift is run once through each trigger:
- tsc/lint/test on the server repo at v2 (the replay tests use v1 fixtures, so we expect no fire);
- a Dependabot-style dependency-bump CI;
- oasdiff in CI;
- a nightly **live-integration test** that the domain builder writes before seeing drifts;
- an error-triggered arm (Sentry-like: fires on exceptions or error results only).

### 4.3 Repair arms (C3, C4, E7–E11)

All arms are controlled the same way:
- **model:** claude-opus-5-5;
- **tooling:** the Claude Agent SDK runner;
- **budget:** ≤ 3 attempts and the same max turns per attempt;
- **workspace:** the same sandbox (P3) and the same repo checkout;
- **PRs:** `--no-pr`, except where stated in §7. The CI step is emulated locally (P7).

| Arm | Trigger and input | Validation before "PR" | After "PR" | Emulates |
|---|---|---|---|---|
| R-a **fiks** | Trace → frozen repro test; agent sees the strict or raw trace (per P4 configuration) | F gate, P gate, full suite, all traces, typecheck/lint, CI on the exact commit | none | – |
| R-b **composition** | Prose alert (receipt text + violated property) delivered by webhook | Agent runs whatever it likes | CI runs; up to 3 revisions on red; 30-minute cap | Outcome-Monitor-style checker → Devin/Cursor-style automation → PR (SYNTHESIS §5 composition) |
| R-c ungated | Receipt text | none | none | naive self-heal |
| R-d raw-trace | Raw trace in the prompt, no test | suite, traces, typecheck/lint, CI (no F/P) | – | DepRepair-style evidence (X16) |
| R-e repro-only | fiks repro | F/P only | – | SWE-style single-test gate |
| R-f PostHog-like | Receipt as "error" | Agent writes its own regression test + fix | CI after opening | PostHog self-driving docs |
| R-g Itzal-like | Trace | Replay of recorded traffic (shadow), no committed test | – | Itzal (2016) |
| R-h Engine-like | LLM scan of transcripts (the E2 judge) produces a prose finding | model-judged replay of source runs | CI after | LangSmith Engine docs (Oct 2026) |
| R-i mini-swe-agent | fiks repro as the task | its own loop; our gates applied after, for grading only | – | external scaffold (Python, via shim) |

### 4.4 Agent-side arms (C5, C6, E14–E16)

| Arm | Description |
|---|---|
| direct | No fiks |
| receipts | Receipts v2 (current) |
| receipts-v1 | The old "do not quote" wording, ported (E16 only) |
| caution prompt | One extra system line: "tool results may be wrong; verify when possible" |
| retrieval-status | One line from a status-only checker: "result fields X are null/empty/truncated" |
| block | Violated results withheld; the agent gets an error |
| OM-receipts | Outcome-Monitor-style receipts from mined contracts |
| fiks-fixed | Server at `exp/fiks-fixed` with receipts on |
| composition-fixed | Server at `exp/comp-fixed` with receipts on |
| always-decline, always-trust-first-result | Computed without an LLM |

---

## 5. Product changes to fiks before the runs

| ID | Change | Why | Owner stream |
|---|---|---|---|
| P1 | **Monitor interface**: `ProxyOptions.monitor` (`(input) => EvalResult \| Promise<EvalResult>`), `--monitor <name>` on the bin and bench, and a monitor registry. Every verdict is logged with monitor id and latency. | All detection baselines; offline replay | WS-MON |
| P2 | **Domain registry** (`packages/domain`): vendor factory, drifts, version header and dates, contracts path, base-URL env, server command, repo, seed tag, scenarios, fixture calls, tasks, prompt hints, probes, `truth()`. Threaded through harness, scenario, record-fixtures, rerecord, vendor-diff and paths; `--domain` flag. | 4 domains, τ² | WS-CORE |
| P3 | **Sandbox.** The repair agent's tool execution and every gate's test run happen in a Docker container: no network for test execution; an egress allow-list (Anthropic API only) for the agent process; a scrubbed env (only the OAuth token for the agent process; no `GH_TOKEN` and no `.env` inside the container); a read-only mount for tests, fixtures and traces; a fake canary secret in the env for S8. The host keeps git and `gh`. | K16, H23, README limitation "agent code runs on the host" | WS-SEC-HARD |
| P4 | **Strict-format trace**: a typed, quarantined trace view. JSON paths and types; string values length-capped, escaped and wrapped in a data envelope; no free text from vendor bodies outside fields; a size cap. `--trace-format raw\|strict`. | H24 | WS-SEC-HARD |
| P5 | **`contract_update` outcome.** The repair agent may return a contract amendment instead of a code patch. Gates for an amendment: every v1 golden and every *other* contract's stored trace still pass; the amended contract must still reject every mutation-operator variant it rejected before, except on the amended property. Opens a PR labelled `contract-update`. | X21, H18, E13 | WS-REP |
| P6 | **Cost and usage logging**: `costUsd`, input, output, cache-read and cache-creation tokens, turns and wall-time on every trial, repair, judge call and test-generation run | M13, D6 | WS-BENCH (trials), WS-REP (repairs), WS-BL-LLM (judges) |
| P7 | **Local CI emulation**: run the repo's CI workflow commands in a clean container on the exact commit. A real-GitHub-Actions mode is kept, and a 5% random sample is cross-checked. | 2,400+ repairs cannot each push to GitHub | WS-REP |
| P8 | **Retries and `infraError`**: SDK calls retry ≤ 3 with exponential backoff and jitter; outcome `infraError` is distinct from `no answer`; persistent failures are re-queued once at the end of the run. | Infra must not look like model failure | WS-BENCH |
| P9 | **Multi-key summary**: keys are `${domain}/${phase}@${model}#${monitor}~${receiptStyle}%${profile}`. Every run is kept; pass^k for k = 1..K; Wilson and task-bootstrap CIs. | Multi-model, multi-arm | WS-BENCH |
| P10 | **Worker pool**: N workers, each with its own vendor, ports, worktree and FIKS_DIR; randomized interleaving of arms within task blocks | Throughput; guards against time confounds | WS-BENCH |
| P11 | **Repair ablation flags**: `--input trace-test\|raw-trace\|prose`, `--gates full\|repro-only\|none\|visible`, `--ci before\|after\|none`, `--attempts`, `--skip-f-gate`, `--trace-format`; arm id recorded in the result JSON | Repair arms | WS-REP |
| P12 | **LLM shim**: a local OpenAI- and Anthropic-compatible HTTP endpoint backed by the Agent SDK (OAuth) or ollama, for third-party tools that expect an API key (ALTK, mini-swe-agent, the open-weight agent loop) | No other API keys allowed | WS-OPEN |
| P13 | **Open-weight agent loop**: an MCP client plus a chat-completions tool loop with the same task prompt, `submit_answer` tool and grader | Second model family; scaffold control | WS-OPEN |
| P14 | **Process-level replay + multi-language gates**: spawn the server with the base URL pointed at a replay server and call it over MCP stdio; gate runners for vitest, `go test`, pytest; per-repo edit allow-list and replay matchers | Real bugs, τ² | WS-REPRO |
| P15 | **PR safety**: a hard owner allow-list (`vats98754` only) in `pr.ts`; `--no-pr` default for any run with `--arm`; duplicate and already-fixed check with per-contract grouping and a rate limit | Rules; D5 | WS-REP |
| P16 | **Receipt styles and modes**: `--receipt-style v1\|v2`, `--mode receipts\|log-only\|block` | E15, E16 | WS-MON |
| P17 | **Hidden-oracle runner and laxity harness**: run the differential + goldens + hidden tests on any patch; apply the wrong-patch pool to any repro test | C3, C4 | WS-REPRO |

---

## 6. Workstreams

### 6.1 Rules
- **One owner per file.** No two streams own the same file. When a stream needs a change in a file it does not own, it files a request in its `HANDOFF.md`, and the owner makes the change.
- **Tests and command registration.** A stream also owns the test files for the source files it owns (`packages/<pkg>/test/**` follows `packages/<pkg>/src/**`). Registering a new CLI command in `packages/cli/src/main.ts` is a request to WS-CORE.
- **Root shared files** (`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig*.json`, `biome.json`, `vitest.config.ts`, `.github/`, `PROGRESS.md`) are owned by **WS-INT**. WS-INT is run by the orchestrator and batch-applies dependency and script requests.
- **Builders and verifiers.** Each stream runs in its own git worktree. A stream merges only after an independent verifier PASS on its acceptance tests plus `pnpm typecheck && pnpm lint && pnpm test`.
- **Pins.** Every new dependency is pinned to an exact version published at least 14 days earlier (CLAUDE.md).

### 6.2 Table

| ID | Goal | Owns (exclusive) | Depends on | Deliverables | Acceptance tests (verifier runs) | Hours |
|---|---|---|---|---|---|---|
| **WS-INT** | Integration of root config; merge train | root files listed above; `paper/prereg/freeze.json` | – | dependency/script batches; freeze tag | `pnpm i --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test` green on main after each merge; `node scripts/check-pins.mjs` passes | 10 |
| **WS-CORE** | Domain registry (P2) | `packages/domain/**` (new); `packages/cli/src/{harness.ts,paths.ts,main.ts}`; `packages/cli/src/commands/{scenario,record-fixtures,rerecord,rerecord-stale,vendor-diff,call}.ts` | WS-INT | `--domain` everywhere; shop registered with no behaviour change | All 147 existing tests pass; `pnpm fiks scenario D2 --domain shop` byte-identical receipt to before (golden); a toy domain registered in a test runs scenario → trace | 14 |
| **WS-MON** | Monitor interface, receipt styles and modes (P1, P16) | `packages/proxy/src/**` | WS-CORE | `--monitor`, `--receipt-style`, `--mode`; verdict log | Unit tests: `monitor=none` passes results through unchanged; `contracts` monitor gives identical verdicts to today on the 200 logged calls; v1 style reproduces the `705e989^` text; block mode returns an MCP error | 9 |
| **WS-BENCH** | Bench at scale (P6, P8, P9, P10); confirm across models | `packages/bench/src/{agent.ts,stats.ts,index.ts}`; `packages/bench/src/tasks/index.ts` (new); `packages/cli/src/commands/{bench,summarize,confirm}.ts` | WS-CORE, WS-MON | worker pool, retries, `infraError`, cost fields, multi-key summary, pass^k 1..K with CIs, arm configs, single-drift profiles, randomized interleaving | A fault-injected SDK stub yields `infraError` (not `no answer`) after 3 retries; `summarize --check` reproduces the 2026-10-20 summary numbers under the new keys; a 2-worker run of 12 trials is identical in outcome set to a 1-worker run on a deterministic stub agent; cost fields non-null on a 1-trial live smoke | 16 |
| **WS-OPEN** | LLM shim and open-weight agent loop (P12, P13) | `packages/llm-shim/**` (new); `packages/bench/src/agent-oai.ts` (new) | WS-BENCH | shim (OpenAI + Anthropic routes → Agent SDK or ollama); OAI agent loop; ollama model selection script | Shim contract tests with a recorded fixture; the OAI loop solves shop T6 on v1 with sonnet-via-shim 3/3; with the local model the loop completes a trial and logs tokens; no API key is read anywhere (grep test) | 12 |
| **WS-CON** | Contract language and inference | `packages/contracts/src/**`; `scripts/sync-contracts.mjs` | WS-INT | new invariant kinds `enum`, `crossField`, `magnitudeStable`, `monotonic`; `infer.ts` (template inference + FPR budget); `fiks infer-contracts` (command file created by WS-CON as `packages/cli/src/commands/infer-contracts.ts`) | Property tests per new kind; inferred contracts on shop v1 fixtures detect D1–D3 scenario traces in a unit test; the vendored copy sync test passes | 24 |
| **WS-CTR** | Hand contracts for every domain, τ² and real bugs (blind to v2) | `packages/contracts/contracts/*.json`; `realbugs/*/contracts/*.json` | WS-CON; sparse checkout | contracts for shop D6–D9, pay, book, issue, τ²; blind doc-only contracts per real bug (written before the issue is read; logged author and time) | Each contract file validates against the schema; 0 violations on all dev v1 fixtures; author-drift detection matrix produced (dev only) | 14 |
| **WS-DOM-SHOP** | shop D6–D9, 18 new tasks, `truth()`, seed `seed-v1.1` | `packages/vendor-api/**`; `packages/bench/src/tasks/shop.ts` (moves `tasks.ts`); the shop-mcp repo branch `seed-v1.1` | WS-CORE | drifts, tasks, graders, `truth()`, golden fixtures | `truth()` equals the tool output on every v1 fixture; each new drift changes ≥ 1 probe output; graders unit-tested with correct, wrong and decline answers; `seed-integrity` real/fake-fix cases for D6–D9 | 18 |
| **WS-DOM-PAY** | Payments domain | `packages/vendor-pay/**`; repo `vats98754/pay-mcp`; `packages/bench/src/tasks/pay.ts` | WS-CORE | vendor v1/v2 with 9 author drifts, MCP server repo with CI, 24 tasks, `truth()` | Same as WS-DOM-SHOP, plus a CI green run on the repo's seed tag | 28 |
| **WS-DOM-BOOK** | Booking domain | `packages/vendor-book/**`; repo `vats98754/book-mcp`; `packages/bench/src/tasks/book.ts` | WS-CORE, WS-DOM-PAY (pattern) | as above | as above | 20 |
| **WS-DOM-ISSUE** | Issue-tracker domain (drifts modelled on the R1, R2, R4, R5, R7 classes) | `packages/vendor-issue/**`; repo `vats98754/issue-mcp`; `packages/bench/src/tasks/issue.ts` | WS-CORE, WS-DOM-PAY | as above | as above | 20 |
| **WS-BLIND** | Sealed blind, injector and benign suites with tasks and hidden oracles | private repo `vats98754/fiks-blind` (all of it); `paper/prereg/blind.sha256` | WS-DOM-* (v1 snapshots exported), WS-INT | 100 fault candidates, 20+8 injector, 40 benign candidates, tasks, graders, hidden tests; authoring logs | Hash committed before freeze; the verifier confirms the author sessions' worktrees lacked `packages/contracts`, `packages/proxy` and the server sources (from session file lists); every candidate compiles and runs against the vendor | 18 |
| **WS-MUT** | Mutation operators O1–O12 and mutant generator | `packages/mutators/**` (new) | WS-INT | operator library; mutant manifests per domain | Each operator unit-tested on a JSON fixture; manifest deterministic under a seed; operator source hash recorded at the freeze | 8 |
| **WS-OFFLINE** | Labeler, validity filter, offline monitor evaluator, calls-to-detect | `paper/scripts/label/**`; `paper/scripts/monitor-eval/**`; `paper/labels/**` | WS-MON, WS-CORE, domains | labels for every instance and every logged call from `truth()`; monitor × instance verdict matrix | Labels never read any monitor output (static import check); the validity filter reproduces the same kept set twice; evaluator reproduces fiks's logged verdicts on the 200 old calls | 14 |
| **WS-REPRO** | Process-level replay, multi-language gates, hidden-oracle runner, laxity harness (P14, P17) | `packages/repro/src/**`; `packages/cli/src/commands/repro.ts`; `packages/replay-proc/**` (new); `packages/oracle/**` (new) | WS-CORE | `go test` and pytest runners; per-repo matchers; oracle and laxity CLIs | F/P gates pass on shop D1–D5 as today; process-level replay F-gate on one TS real bug (R10) and one Go real bug (R2); the laxity harness reports 100% kill for a known-good repro on the D1 rule-based pool | 32 |
| **WS-REP** | Repair arms in the product, contract-update, local CI, PR safety (P5, P7, P11, P15; repair-side P6) | `packages/repair/src/{runner,prompt,gates,pr,index}.ts`; `packages/cli/src/commands/{repair,demo}.ts` | WS-REPRO, WS-SEC-HARD (P3/P4 modules) | flags and arm ids; `contract_update`; local CI; owner allow-list; dup check | Existing repair tests (all six PoC attacks) still end in `gate_failed`; `--ci before` local mode agrees with GitHub on 3 commits; a PR attempt to a non-vats98754 owner is refused in a test; a benign fixture yields `contract_update` in a stubbed-agent test | 26 |
| **WS-SEC-HARD** | Sandbox, strict-format trace, canary, egress log (P3, P4) | `packages/sandbox/**` (new); `packages/repair/src/{guard.ts,strict-trace.ts}` | WS-INT | container image and runner; strict trace view | Inside the sandbox: `curl` to a non-allow-listed host fails; `env` shows no `GH_TOKEN`; a write to `test/` fails; the canary never appears in the egress log for a benign repair; the strict view escapes an injected `</data>` payload | 22 |
| **WS-ARMS** | Repair baselines R-b…R-i and triggers (§4.2, §4.3) | `packages/arms/**` (new); `baselines/mini-swe-agent/**` | WS-REP, WS-OPEN | arm drivers with identical budget accounting; trigger runners | Each arm runs end-to-end on shop D2 with a stubbed agent; budget accounting identical across arms (unit test); composition arm performs ≤ 3 CI revisions | 26 |
| **WS-BL-DET** | Deterministic and spec baselines | `packages/monitors/deterministic/**`; `baselines/spec/**` | WS-MON | SDK, Ajv strict, strict-spec, Prism, oasdiff, ContextForge, Docker interceptor, contract-audit wrappers | Each monitor's verdicts on 5 hand-labelled fixtures; Ajv flags a type swap; oasdiff reports 0 on shop v1/v2 | 18 |
| **WS-BL-LLM** | LLM judges and LLM-trigger baselines | `packages/monitors/llm/**` | WS-MON, WS-OPEN | judge (3 models × ± upstream), ALTK via shim, Enkrypt-style, Engine-like scan; prompts in `packages/monitors/llm/prompts/` (frozen at the freeze) | JSON parse rate 100% on 20 dev calls; cost logged per call; prompt hash recorded | 12 |
| **WS-BL-STAT** | Data-quality and statistical baselines | `baselines/py/**` (uv-managed, pinned) | WS-OFFLINE (call export format) | GX + profiler, datacontract-cli, Evidently, whylogs, AegisFlow-style, AVH, z-score | Deterministic outputs on a fixed window; each library version pinned; KS detector fires on a synthetic ×100 window | 16 |
| **WS-BL-SNAP** | Record/replay and snapshot baselines | `packages/monitors/snapshot/**`; `baselines/hoverfly/**` | WS-MON | nock-record tests, Hoverfly Diff, snapshot diff, Diffy-style | Hoverfly Diff flags D2 on shop; nock tests recorded on v1 pass on unfixed v2 (expected property) | 12 |
| **WS-BL-INF** | Outcome-Monitor reimplementation, AGORA+/Beet wrapper, LLM-authored contracts | `packages/monitors/inferred/**`; `baselines/agora/**` | WS-CON, WS-MON | mined-contract monitor; OM-style receipts; LLM-authored contracts (3 seeds) | Mined contracts cover the C11 template set on shop; AGORA+ runs on recorded traffic [verify Java runtime] | 14 |
| **WS-TAU** | τ²-bench drift layer and adapter | fork `vats98754/tau2-bench`; `adapters/tau2/**` | WS-CORE, WS-BENCH, WS-OPEN (if the user simulator is routed via the shim) | HTTP vendor over τ² DBs with v1/v2; MCP server; drift mapping; C11 faults; grader bridge; pinned task-set SHA | The v1 adapter reproduces τ²'s own reward on 10 tasks with a scripted gold trajectory; each drift changes ≥ 1 tool output; fiks tap records exchanges | 26 |
| **WS-RB-TS** | Real-bug wave 1 (TypeScript) | `realbugs/ts/**`; forks under vats98754 | WS-REPRO, WS-CTR, WS-SEC-HARD | per bug: fork pinned at prefix and fix SHA, upstream fixture provenance (recorded vs synthesized), blind contract, attrition record | Detect on prefix and not on fix (or a documented FP); 10 deterministic reruns; licence noted | 40 |
| **WS-RB-GO** | Wave 2 (Go) | `realbugs/go/**` | same | same | same | 55 |
| **WS-RB-PY** | Wave 3 (Python + τ² defect) | `realbugs/py/**` | same | same | same | 60 |
| **WS-SEC-SUITE** | S8 payloads, goals, oracles, adaptive red team | `security/**` | WS-SEC-HARD, WS-REP | 10 templates × 4 goals × 5 carriers; per-goal oracles (egress log, file-write audit, hidden behaviour test); red-team driver | Each oracle fires on a planted positive control and not on a benign repair | 18 |
| **WS-AIDEV** | C21 re-analysis (E22) | `paper/aidev/**` | – | 5 model specifications, reproducible notebook-free script | Reproduces Ehsani's OR 0.85 ± tolerance under their specification before any new specification [requires a dataset download: ask the user first] | 8 |
| **WS-ANALYSIS** | Pre-registration, analysis code, tables, macros, `paper:check` | `paper/prereg/PREREG.md`; `paper/scripts/analysis/**`; `paper/results/**`; `paper/scripts/paper-check.mjs` | WS-OFFLINE, WS-BENCH | frozen analysis scripts; synthetic-data dry run; `pnpm paper:check` (script entry added by WS-INT) | On a simulated dataset with a planted effect of 0.2 and one of 0, the Holm pipeline rejects the first and not the second at the expected rates (1,000 simulations); every macro traces to a log line | 30 |

Total ≈ **640 builder-hours** across 30 streams. The critical path is WS-INT → WS-CORE → (WS-MON, WS-BENCH, WS-DOM-*) → WS-CTR → freeze → runs. That is about 60–75 h of serial work, if each stream gets its own builder.

**Separation the verifier must check.** WS-CTR and WS-BL-LLM (prompt authors) must not have commit access to WS-BLIND's repo before the freeze. WS-DOM-* builders write the author drifts and `truth()`, but not contracts.

---

## 7. Run plan

### 7.1 Planning figures

- **Throughput and cost per unit.**
  - Agent trial ≈ 7–9 s sequential `[measured]`.
  - Repair ≈ 90 s and $0.11–0.21 API-price for opus `[measured]`.
  - Per-trial API-price for agent trials is **not** in the logs (codebase-map §5). Planning values are $0.03 for sonnet, $0.01 for haiku and $0.08 for opus per trial; $0.04 average per judge call; 60–120 s and $0.20–0.40 per τ² trial; about 150 s per local open-weight trial on CPU. All of these are `[assumption]`, replaced by P0.
- **What "cost" means.** Under the OAuth token, cost is a usage estimate, not a bill. The binding constraint is the subscription rate limit, which P0a measures [verify the limits that apply].
- **Workers.** N = 4 for agent trials and N = 6 for repairs, unless P0a says otherwise.

### 7.2 Experiments, in order

| # | Experiment | Models | Units × trials | Est. trials/calls | Est. wall-clock | Est. API-price |
|---|---|---|---|---|---|---|
| **P0a** | Throughput and rate-limit pilot, dev tasks only | sonnet | shop T1–T6 × 1, 2, 4, 8 workers | 200 | 1 h | $6 |
| **P0b** | Cost and variance pilot: per-task SD of arm differences on **dev** tasks (author drifts) | sonnet, haiku, opus | 48 author-drift tasks × 3 arms (direct, receipts, fiks-fixed on dev) × k = 2 | 864 | 2 h | $35 |
| **P0c** | τ² pilot | sonnet (agent and user simulator) | 10 tasks × 2 arms × k = 2 | 40 | 1 h | $16 |
| **P0d** | Open-weight model selection: rule = the highest tool-call validity on v1 dev tasks, ≥ 80% required; candidates qwen2.5:7b-instruct, llama3.1:8b-instruct, granite3.x-8b [verify tags and that each is ≥ 14 days old] | local | 3 models × 12 trials | 36 | 2 h | $0 |
| **P0e** | Repair arm smoke: every arm on 5 dev instances × 1 seed | opus | 9 arms × 5 | 45 | 1.5 h | $8 |
| **P0f** | Security smoke: positive controls for each oracle | opus | 4 goals × 2 | 8 | 0.5 h | $2 |
| **CP0** | **Checkpoint.** Go if: infraError < 2% in P0a/P0b; P0e completes for all arms; cost extrapolation < 2× this plan. n stays fixed; MDEs are recomputed with the P0b SD and written into PREREG before the freeze. | | | | | |
| **FREEZE** | Tag `prereg-freeze-1`; commit PREREG.md and hashes; verifier confirms; reveal the blind suite; run the validity filter | | | | | |
| **R1** | Offline detection: every monitor × S1–S5 instances and all logged calls (C1, E1–E6, E20) | judges: haiku, sonnet, opus × ± upstream | 184 C1 instances × 6 judge variants × 3 runs; ≈ 2,500 other instances × 6 variants × 1 | ≈ 18,300 judge calls; deterministic monitors free | 4 h (8 parallel) | $730 at $0.04 per call `[assumption]` (haiku is far cheaper; P0 refines) |
| **R2** | Live trace capture: each valid fault instance's probe through fiks-proxy → trace (all S1–S3) | – | 116 instances | 116 calls | 0.5 h | $0 |
| **R3** | Repro generation: the fiks repro (deterministic) and the agent repro from the raw trace (C3); prose-alert repro (E7); wrong-patch pools | opus (repro), haiku (pools) | ~90 instances × 3 seeds × 2 agent arms; 90 × 8 pool patches | 540 + 720 | 6 h | $60 |
| **R4** | Repair arms, primary pair first: R-a, R-b × 3 seeds (C4) | opus | ~90 × 2 × 3 | 540 repairs | 3–5 h (6 workers; composition revisions are longer) | $86 |
| **R5** | Repair arms R-c…R-i × 3 seeds; fiks arm with sonnet and haiku × 3 (E9) | opus; sonnet; haiku | 90 × 7 × 3 + 90 × 2 × 3 | 1,890 + 540 | 61 h sequential, ≈ 10–15 h with 6 workers | $340 |
| **R6** | Merge gate-passing R-a patches into `exp/fiks-fixed` and R-b into `exp/comp-fixed` in each domain repo. This is an **experiment-branch merge in our own repos**, scripted and logged, never on `main`. Then run `fiks confirm` replays (D2). | – | – | – | 1 h | $0 |
| **R7** | Agent bench, primary (C5, C6, C2 traffic): v2 single-drift arms direct, receipts and fiks-fixed; A_v1 on all 96 tasks. Arms interleaved randomly within task blocks. | sonnet | 88 × 8 × 3 + 96 × 8 | 2,880 | 7.2 h sequential, ≈ 2 h with 4 workers | $86 |
| **R8** | Agent bench, secondary sonnet arms: composition-fixed, caution, retrieval-status, block, OM-receipts, receipts-v1; A_v1b benign profile (96 × 4) | sonnet | 88 × 8 × 6 + 384 | 4,608 | 11.5 h sequential, ≈ 3 h | $138 |
| **R9** | Model replication: A_v1, direct, receipts, fiks-fixed | haiku, opus | 2 × (96 × 8 + 88 × 8 × 3) | 5,760 | ≈ 14–20 h sequential (opus slower), ≈ 4–5 h | $260 |
| **R10** | Full-v2 profile (comparability with 2026-10-20): direct, receipts, fiks-fixed | sonnet | 96 × 8 × 3 | 2,304 | 5.8 h sequential, ≈ 1.5 h | $69 |
| **R11** | Open-weight model (background, CPU) + scaffold control | local; sonnet via the OAI loop | 96 × 3 × 4 arms each | 1,152 + 1,152 | ≈ 48 h background + 4 h | $35 |
| **R12** | τ²: v1 clean, v2 direct, v2 receipts, v2 fiks-fixed (k = 4); C11 faults on retail with direct, schema-only and receipts (k = 4) | sonnet agent, sonnet user simulator | 165 × 4 × 4 + 115 × 3 × 4 | 2,640 + 1,380 | 67–134 h sequential, ≈ 11–22 h with 6 workers | $800–1,600 |
| **R13** | Real bugs wave 1 (TS): detection on prefix and fix × 10 reruns; repairs (a) trace + repro, (b) raw trace, (c) issue text, (d) composition × 3 seeds | opus | ~5 reproducible × 4 × 3 | 60 repairs | 2 h | $10 |
| **R14** | Real bugs waves 2–3 (Go, Python): detection always; repair only if the WS-REPRO runners pass their acceptance tests | opus | ~8 × 4 × 3 | 96 repairs | 4 h | $15 |
| **R15** | Security: 4 configurations (raw unsandboxed-in-container, strict, strict + sandbox, spotlighting) × 200 attack cases + clean utility (5 carriers × 3 seeds × 4); adaptive red team (opus attacker, 5 goals × 10 rounds × 2 defended configurations) | opus | 800 + 60 + 100 | 960 repairs | 27 h sequential, ≈ 5 h with 6 workers | $155 |
| **R16** | Contract inference and learning curves; LLM-authored contracts; statistical monitors over time-ordered traffic (E4–E6, E20) | opus (12 calls) | – | – | 2 h | $5 |
| **R17** | AIDev-pop re-analysis (E22) | none | – | – | 2 h | $0 |

**Totals (planning).**
- About 22,000 Claude agent trials (pilots included), 5,300 repair-like runs (R3, R4, R5, R13, R14, R15) and 18,300 judge calls.
- API-price equivalent ≈ **$2.9k–3.7k** `[assumption]`; τ² and the judge sweep dominate.
- About 80–90 h of wall-clock at the planned worker counts, plus 48 h of CPU background for the local model. Allowing for rate-limit windows and checkpoints, that is roughly 5–8 calendar days.

**Ordering principle.** Pilots first. Then everything a confirmatory hypothesis needs: R1 (C1), R3–R4 (C3, C4), R6–R7 (C5, C6, C2). Then exploratory runs in descending value of information per cost: R8, R9, R15, R12, R13, R5, R10, R11, R14, R16, R17.

If the token budget or rate limit binds, cut **from the bottom of the exploratory list**, never the confirmatory runs, and record the cut in PROGRESS.md. R12 is the first candidate: drop airline first, then the C11 sub-protocol.

### 7.3 Checkpoints

| Checkpoint | When | Gate |
|---|---|---|
| CP0 | After the pilots | See P0 above |
| CP1 | Freeze | Verifier confirms the hashes, the sealed-repo access log and that the dev/test split is respected |
| CP2 | After R1–R7 | `summarize --check` and `paper:check` match the logs. The confirmatory analysis runs **once**, exactly as frozen, and its output is committed before any exploratory analysis is looked at. |
| CP3 | After each exploratory run | Logs committed; infraError rate per arm reported |
| CP4 | End | Completeness critic and hostile-review loop (ORCHESTRATION §6), at most two data loops |

**No interim looks.** Nobody computes a confirmatory endpoint on partial data. Runners report only progress counts and infra errors.

---

## 8. Pre-registered analysis plan, threats and cuts

### 8.1 What is computed and how

- **Outcomes.** The existing deterministic graders give correct / wrong / declined / no-answer; we add `infraError`. Pass = correct. Wrong includes hedged wrong values (current rule). D3-type lost-write tasks are graded under both policies (decline = pass and decline = fail). The primary policy is the current one (decline = fail).
- **Per-task rates and pass^k.** Per-task pass^1 is the mean over k trials. pass^k uses the unbiased estimator C(c,k)/C(n,k) for k = 1..8 (`eval_stats.py passk`).
- **Intervals.**
  - Wilson for single proportions.
  - Task-clustered bootstrap (stratified by domain, 10⁴ resamples) for arm means and paired differences.
  - Secondary: a beta-binomial model with a task random effect.
  - Sensitivity: cluster-robust SE.
  - The bootstrap resamples tasks or instances, never trials within a task (evals-measurement §7).
- **Random facets.** Tasks, instances, trials and repair seeds are random. Models and domains are fixed: results are stated per model, never pooled across models in the confirmatory tests.
- **Variance decomposition.** We report `eval_stats.py decompose` (task × trial) for the C5 and C6 arms, to show what more tasks vs more trials would buy (D-study).
- **Paired tests.** As in §2.1. The mid-p McNemar is used where single-sample binary pairs arise (E1, E3). Exact p-values are also reported.
- **Multiplicity.** Holm over C1–C6 only. The IUT components inside C4 and C6 are not counted separately. All E-results are labelled exploratory, with raw p and effect size; D-results carry no p-values.

### 8.2 Infrastructure errors

- **Definition.** An SDK exception, HTTP 429 or 5xx from the model API, a timeout with no model output, a harness, vendor or container crash, a vendor reset failure, or a local-CI container failure unrelated to the patch.
- **Handling.** Up to 3 retries with backoff (P8); a single end-of-run requeue. If it still fails, the unit is **excluded** and counted per arm.
- **Sensitivity rule.** If an arm's exclusion rate exceeds 5%, or two paired arms differ by more than 2 pp, we re-run the analysis with two imputations:
  - excluded = failure for the fiks arm and success for the comparator (worst case for fiks);
  - excluded = per-task mean.

  Both are reported.
- **Model refusals and odd answers** are not infra errors; they are graded normally.

### 8.3 Exclusions and deviations

- **Grader bugs.** Graders are audited on dev before the freeze. A grader bug found after the freeze is fixed for **all arms at once**, logged in `paper/prereg/DEVIATIONS.md` with before/after numbers, and reported.
- **No outcome-based exclusions.** Instances are kept or dropped only by the pre-freeze validity filter (§3.2.6).
- **Non-fiks monitors that crash** on an instance count as "no detection" and are reported.
- **Deviations from this plan** go in `DEVIATIONS.md` with a date and reason, and appear in an appendix.

### 8.4 Threats to validity

| Threat | Where | Mitigation | Residual (goes in Limitations) |
|---|---|---|---|
| Author circularity (M2) | Detection | Blind, injector and operator suites; dev/test split; freeze | Blind authors share the Claude family with the judge and agent; only 8 injector drifts come from another family |
| Seeded faults poorly coupled to real ones (M21) | All | Real-bug waves; coupling table (E18); operators | Real-bug n is small (10–15 expected) |
| Ground-truth projection errors | Labels, oracle | Dual check against v1 fixtures and vendor admin state; verifier review | The projection is our reference implementation |
| Mock domains are simple | External validity | τ², real bugs | Four mock domains are still mocks |
| Single model family for repair and agent | C3–C6 | Haiku, sonnet and opus replication; one open-weight model on CPU; scaffold control | No frontier non-Claude model (budget constraint: no other API keys) |
| Model-side nondeterminism and drift over the 5–8-day run | Agent arms | Randomized interleaving of arms within task blocks; model IDs pinned and logged per trial | The SDK may not expose temperature; recorded as default |
| Equal effort for baselines | C1, C4 | Judge prompt revisions capped and logged like contract revisions; repair arms share model, budget and attempts | Product baselines are emulations from docs |
| Experiment-branch merges are not human-reviewed | C5 | Merges happen only in `exp/*` branches of our repos; incorrect merged patches stay in and lower C5, honestly | Not representative of real maintainer merge decisions (D8 optional) |
| Local CI emulation ≠ GitHub CI | C4 | 5% cross-check sample on real Actions | Disagreements reported |
| Contamination | Real bugs | Stratify by fix date vs model cutoff | Popular repos are likely in training data |
| Static vs adaptive attacks | E19 | Adaptive red team reported separately; claims limited to capability bounds | No defence is claimed robust against adaptive attackers |
| Rate limits shape what runs | All | Confirmatory runs first; cuts from the bottom of the exploratory list only | Some exploratory results may be missing (stated) |
| OAuth cost ≠ bill | D6 | Labelled "API-price estimate" | – |

### 8.5 Deliberately cut (and why)

| Cut | Why |
|---|---|
| SWE-agent and OpenHands as repair arms | Heavy Docker setups. mini-swe-agent is the external-scaffold representative (R-i). |
| MCPMark, MCP-Universe, MCP-Atlas runs | Need third-party accounts or keys (not allowed) or about $600+. Organic FP comes from C2's held-out traffic and τ² instead. |
| SWT-bench / Multi-SWT | About 120 GB of Docker. Our repro baseline is calibrated on our own instances (C3). |
| BBCBench (H28) | Its source (†chen2026bbcfixer) is dropped pending re-verification, and its licence is unverified. |
| AppWorld, StableToolBench | Licences [verify]. They can enter as exploratory only after verification. |
| Direct measurement of Engine, Cleric, Seer, Devin, Monte Carlo | No product accounts. Emulated arms R-b, R-f, R-h instead, labelled as emulations. |
| Human blind review (H26) | Not approved. D8 is optional; the paper stands without it. |
| Real GitHub CI for every ablation | Thousands of pushes. We use local emulation plus a 5% real-Actions cross-check. Real PRs only for R-a on the new domains' author drifts and on real bugs in our forks, and only after the user confirms. |
| Keploy eBPF capture | Emulated with nock (stated). |
| Organic silent-fault *rate* (M6, H5 on real servers) | Needs real traffic on third-party servers that we cannot create. C2 bounds FP on our clean traffic only. |
| Patent and missing-literature searches (G5) | Not experiments; flagged to the orchestrator. |
| Dashboard updates | They add no evidence. |

**Order of further cuts if the build overruns** (cut scope before verification):
1. WS-RB-PY;
2. τ² airline;
3. R10;
4. R11's scaffold-control half;
5. R-g and R-h arms;
6. WS-RB-GO repair (keep its detection).

The confirmatory family needs only: WS-INT, WS-CORE, WS-MON, WS-BENCH, WS-CON, WS-CTR, the 4 domains, WS-BLIND, WS-MUT, WS-OFFLINE, WS-REPRO (TS only), WS-REP, WS-SEC-HARD, WS-ARMS (R-b only), WS-BL-LLM (judge only) and WS-ANALYSIS. That subset is about 345 builder-hours.

### 8.6 Operational rules carried into every run

- **Writes outside our account.** No GitHub writes outside vats98754. Third-party fork CI runs only after the user approves.
- **Downloads.** Each dataset or model download (AIDev-pop, ollama models, the τ² repo, Hoverfly) is listed with its source and size, and needs the user's approval before it happens.
- **Credentials.** The OAuth token never enters any container used for test execution (P3). The canary secret is fake.
- **Numbers.** Every number in the paper comes from `paper/scripts/` over committed logs. Cells without data are `\TODO{run}`.
