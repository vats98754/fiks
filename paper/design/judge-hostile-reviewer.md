# Judge report: HOSTILE REVIEWER lens

Judge lens: SE/APR + agent evaluation + security reviewer at a top venue. Questions asked of each design: is the novelty tested against the closest prior work; are the baselines strong and fair (above all the composition baseline and the LLM judge with upstream); are the seeded drifts circular; does anything external (real bugs, τ²) carry weight; is the repair loop secure; do the claims exceed the evidence. Would I accept the resulting paper?

Date: 2026-10-21. Inputs read: all three designs in full, ORCHESTRATION.md, SYNTHESIS §5 and §9–10, codebase-map §5–8, PROGRESS.md, and `packages/repair/src/{guard,runner,pr}.ts`. Every power number below comes from `eval_stats.py mde` (paired normal approximation, power 0.8).

## Verdict

| Design | Score (1–10) | Would I accept the resulting paper? |
|---|---|---|
| **narrow-rigor** | **7.5** | Weak accept, if the must-fix items below are done. As written: borderline. Its headline C4 is partly true by construction, and the oracle uses fiks's own contracts. |
| reviewer-first | 6.0 | Borderline reject. The primary composition gets a prose alert with no raw upstream, so it is weak. Confirmatory slots go to receipts, which are prior art (RF-H2), and to a self-comparison that holds by construction (RF-H5). The repair claim (RF-H3) is Opus-only and has an MDE of 0.28. |
| maximal-evidence | 4.5 | Reject as planned. The composition is a strawman (prose only). C5 holds by construction ("a correct fix beats no fix"). C6 is receipts again, which are prior art. The thesis overclaims ("removes the fault for every later agent"). The plan needs about 640 builder-hours, 30 streams and about $3k of API-price usage under unmeasured OAuth caps. Many of its 20 "baselines" rest on unverified emulations. |

**Winner: `design-narrow-rigor.md`.** It is the only design whose confirmatory family lines up with the three parts of the novelty: trigger, artifact and gate placement. It is the only one that gives the composition the same raw trace, the same guard and the same contract suite in CI. It powers the end-to-end claim across 3 models: at n = 60 and σ_d = 0.25 the MDE is 0.110 (C4). It pre-registers its likely losses: C1 on shop ranges, C3 on clamp-type patches, and the judge in E3. And it stays clear of the two claims a hostile reviewer would attack first, detection superiority and receipt effects.

---

## 1. narrow-rigor: 7.5

**Strengths**
- The novelty is stated narrowly and tested part by part. The paper says what is prior art (§0, §8.4), and every confirmatory test maps onto trigger, artifact or placement.
- It has the strongest composition baseline of the three designs:
  - same detector, raw trace, model, guard, budget and sandbox as fiks;
  - "reproduce first" in the prompt;
  - repo CI that already contains fiks's contract suite and stored traces;
  - a ladder COMP → L1 → FIKS that separates placement from repro.
- The held-out oracle has several parts: ≥ 3 manifestations, renamed-id variant, a differential against a reference fix, 2-of-3 SAST, and a second independent reference fix on 20% of drifts.
- Blind authoring is containerized with mount manifests. Drifts are injected by a third-party injector that cannot import contracts, and tracker contracts are frozen before any drift exists. Contract vocabulary and operators are frozen too.
- The statistics are sound:
  - drift is the unit of analysis;
  - sign-flip permutation tests with BCa intervals;
  - Holm over 5 tests;
  - non-inferiority with a fixed δ;
  - the top-up rule uses detection counts only;
  - pairwise deletion for infrastructure errors, with a worst-case imputation;
  - the analysis scripts are checked by simulation for Type I error.
- Feasibility is plausible: about 250–330 builder-hours, $450–720 API-price, 5 workers, and a cut order that never touches verification.

**Weaknesses (hostile reading)**
- **C4 is partly true by construction.** COMP "opens a PR" on any non-empty diff, and its graded head may be red. FIKS opens a PR only when green. Counting incorrect PRs "whatever its CI colour" means C4 largely measures "CI before PR filters red heads". Any product can turn that on with a draft-until-green setting, and the design itself expects placement to drive most of the C4 effect (E1). The part that is actually novel, **FIKS vs L1** (does the named repro add anything once the gates exist?), is only exploratory.
- **The oracle uses the treatment's own instrument.** Criterion 5 counts "0 contract violations" on held-out traffic as part of correctness. Those are fiks's contracts, and FIKS and L1 are gated on them, so the grader shares the treatment's blind spots. Criterion 2, 100% differential agreement with one Claude-written reference fix on all agent-visible fields, will mark correct but different fixes as incorrect: rounding, `null` vs absent, error vs empty.
- **The C3 patch pool depends on the arms.** Pooled candidates from FIKS already passed the fiks repro (P gate). Candidates from COMP and L1 were shaped by agent tests and CI. So FAR and FRR are computed on patches that were selected by the very tests being compared.
- **C2 is almost true by construction.** A deterministic replay of a recorded violation fails on base for the named property nearly always. The only real content of V_fiks is "the reference fix satisfies the contract". The C2 slot would do more work as FIKS-vs-L1.
- **Taxonomy circularity remains.** Blind briefs use the C3 and R1–R25 classes, and the invariant vocabulary was designed from those same classes. Shop keeps its hand contracts, written alongside D1–D5. The evasive stratum is 24% of drifts and enters C2–C5 only if detected.
- **The C1 corpus is ≥ 80% mechanical enumeration** (entity × tool). That is pseudo-replication: false positives cluster by (property × entity class). "< 1% of distinct results" must never become a per-call field claim, and the cluster bound needs equal prominence.
- **External validity is thin**: 2 mock domains, TypeScript only, 3–5 real bugs as case studies, no τ². This is acceptable for a narrow claim, but the paper's title and abstract must say "mock domains + case studies".
- **The sandbox design (P1) leaves a hole.** "Agent process on host, tool executions proxied into the container" only covers Bash. Read, Grep and Glob still run on the host, and `mayRead` is lexical (`path.resolve`, not `realpath`). Agent code running in a container that mounts the worktree read-write can plant a symlink, `src/x.ts → /Users/…/fiks/.env`. The host Read tool then follows it and the OAuth token reaches the model context, and from there a diff. Also, `claudeEnv()` copies all of `process.env` into the agent process today.

## 2. reviewer-first: 6.0

**Strengths**
- The attack-ranked framing (A1–A9) maps directly onto reviewer objections.
- It has the best freeze ledger: tag ancestry checked by the verifier, and the order operators → vocabulary → tasks → contracts → PREREG → drifts.
- Shop is re-contracted blind by an isolated agent, and the hand contracts become dev-only. This answers circularity better than narrow does.
- 50% of drift ideas come from an open-weight model, the only real second-family input to the substrate.
- The security design is the most complete:
  - strict typed trace that keeps no vendor free text;
  - `mayRead` denies fixtures and traces in strict mode (fixture quarantine);
  - unprivileged CI with provenance hashes;
  - a 4-way attack-success definition;
  - 240 trials paired against the current loop.
- Benign cases get a "documented vs undocumented changelog" stratum, and triage carries a ≥ 90% routing guard on true drifts.
- The ablation grid separates evidence from gating: RA3 is raw trace + gates, RA4 is prose + gates, RA5 is repro without gates.

**Weaknesses**
- **The primary composition, RA1, gets a prose alert with no raw upstream and no test.** It may also edit any file except `.github/`, while fiks may edit only `src/`. That mixes up evidence, gating and edit rights, and a reviewer will call it a strawman. RA3 and RA4 are only exploratory.
- **RF-H3 is underpowered.** It runs on Opus only with r = 3, on 40–60 eligible drifts: MDE 0.275 at n = 40 and sd 0.5, α 0.0083. The utility scale (−1, 0, +1) hides the trade-off, though the component rates are reported.
- **RF-H2 spends a confirmatory slot and about 12,200 trials on receipts,** which are prior art (Outcome Monitors). A win there adds no novelty.
- **RF-H5 holds by construction.** fiks-current opens a code PR on every eligible benign case by design, so "triage beats no triage" is certain. Only its guard carries information.
- **RF-H1 makes detection superiority over a dev-tuned judge confirmatory.** It may well lose, which is acceptable, but a loss would then be the headline.
- **RF-H4 (ASR < 5%) as a confirmatory security claim invites the adaptive-attacker critique.** The guarantees are capability bounds; static-template ASR adds little to them.
- **Scope is large:** 4 domains, Go real bugs and ollama, at about 290 hours and $1.6k. That is feasible but tight.

## 3. maximal-evidence: 4.5

**Strengths**
- **Labels come from a ground-truth projection `truth()` that never reads any monitor.** It is verified against v1 fixtures.
- **The wrong-patch pool is built before either arm runs:** rule-based patches plus Haiku-written "plausible-but-wrong" patches, each admitted only if it fails the hidden oracle. This is the correct C3 design.
- **Blind authors see neither the MCP server source nor fiks.** There is a quota for the plausible-string (S12) class, and Hoverfly runs as a real third-party injector.
- **Intersection-union tests for non-inferiority guards,** and LLM-authored contracts (SkillGuard-like) as a baseline.
- **Its own safety controls are useful:** a PR owner allow-list in `pr.ts` (P15), and decline graded both as pass and as fail.

**Weaknesses**
- **The composition (R-b) gets a prose alert only, while fiks gets trace and test.** C4 then confounds evidence with gating. This is the weakest composition of the three.
- **C5 holds by construction.** "A merged fix beats receipts only" follows once a fix is correct, and the paper's own synthesis says recurrence after a fix is a construction property.
- **C6 (receipts) is prior art.** Two of the six confirmatory slots test nothing novel.
- **The thesis overclaims:** "removes the fault for every later agent; beats … on the outcomes users and maintainers care about".
- **The 20 detection baselines include many unverified emulations** ([verify] on ContextForge, ALTK, AGORA+ GPL Java, the executable-contract artifact). "Engine-like" and "Itzal-like" arms are loose readings of product docs. A reviewer will spot-check one and discount the rest.
- **τ² is a drift layer over the authors' own HTTP wrapper and MCP server.** fiks would repair a tool the authors wrote, so it adds little external validity for repair, yet it costs $800–1,600 and 26 h of adapter work.
- **Feasibility is poor:**
  - about 640 builder-hours across 30 streams;
  - about 22,000 agent trials, 5,300 repair runs and 18,300 judge calls;
  - under OAuth subscription caps that nobody has measured.
  This is the design most likely to end half-done, which CLAUDE.md forbids.
- **C1 counts one probe per drift.** At n = 80 faults, the fault-stratum MDE is 0.175 (`mde --n 80 --sd-diff 0.45 --alpha 0.00833`).

---

## Must-fix items for the winner (unsound or infeasible as written)

1. **Re-anchor the end-to-end claim on what is novel.**
   - Make **FIKS vs L1** confirmatory, on the harm endpoint, replacing C2. C2 becomes descriptive and is reported as near-construction.
   - Define the C4 harm endpoint as **"PR exposed with a green final CI and a held-out-incorrect head"**: the PRs a maintainer could plausibly merge. Report red-CI PRs as a separate noise and cost endpoint.
   - Keep COMP in the family on correct and green-incorrect PRs, or move it to exploratory. Do not headline a difference that comes only from red heads.
   - Power check: at n = 51 detected drifts, α = 0.01, σ_d 0.20 gives an MDE of 0.096, and σ_d 0.15 gives 0.072. Detecting an 0.08 effect at σ_d 0.20 needs n ≥ 73. State plainly that the FIKS–L1 gap may sit below the MDE, and pre-register "inconclusive" wording.
2. **Remove fiks's contracts from the correctness oracle.** Drop criterion 5's "0 contract violations", or replace it with a vendor-state / `truth()` check (graft from maximal). Correctness must not be measured with the treatment's instrument.
3. **Make the differential oracle robust and pre-registered.**
   - Define semantic equality: numeric tolerance, `null` vs absent, key order, error vs empty for invalid inputs.
   - Adjudicate any disagreement between a patch and the reference fix with the hidden tests plus the second reference fix, and extend the second fix from 20% to all test drifts. One extra Opus run per drift is cheap.
   - Report how often hidden tests and the differential disagree.
4. **Build the C3 patch pool independently of the arms being compared.** Use rule-based operators P1–P8 plus LLM-generated wrong patches and an *ungated* generator arm, produced before R3/R4 (maximal §3.6). Arm candidates may be reported as a secondary pool, stratified by source, and never as the primary pool.
5. **Close the host-side read path in the sandbox.**
   - `mayRead` must use `fs.realpathSync` and refuse symlinks leaving the worktree. The same applies to the CLI fallback's `Read(./**)` and `Glob` rules.
   - The agent process env must be reduced to the OAuth token (today `claudeEnv()` copies all of `process.env`).
   - Add canary tests for these cases:
     - (a) a symlink planted from inside the container, then Read on the host;
     - (b) the canary in `~/fiks/.env` and `$HOME`;
     - (c) canary scans of the diff, commit messages and PR body.
   - Verify early that the Agent SDK Bash call can be routed into `docker exec` (a `canUseTool` rewrite or a hook). If it cannot, run the whole agent in the container and state that the token sits inside it.
6. **Add fixture/trace quarantine to strict mode** (graft from reviewer-first P2): in strict mode the repair agent may not Read `test/fixtures/**`, `test/repro/*.json` or `test/traces/**`. Otherwise the raw-vs-strict comparison in E6 is invalid, because the agent can still read the raw injected bytes from the recorded fixtures.
7. **Report circularity per stratum.** Report C1 and E3 per domain and per contract provenance (shop hand-written vs tracker agent-authored). Re-contract shop blind with the tracker protocol (graft) as a sensitivity contract set. State that the blind briefs share the C3 taxonomy with the vocabulary.
8. **Never present C1 at the call level.** Give the cluster bound (property × entity class) equal prominence with the per-input binomial, and keep agent traffic as its own stratum.
9. **Run a feasibility gate on OAuth throughput before PREREG.**
   - K1 must measure sustained attempts per hour and any weekly cap at 5 workers.
   - If R4 (about 1,377 attempts, up to 4 sessions and 90 min each) projects past the cap, apply the pre-registered cut: drop Haiku, then re-power. Do this *before* the tag, not mid-run.
10. **Attribute or own the COMP parameters.** "≤ 3 revisions / 90 min" must be attributed with a passage or presented as the authors' parameter. The PR-before-CI behaviour of the emulated products needs a cited passage for each product named.

---

## Ideas from the runners-up worth grafting onto narrow-rigor

**From reviewer-first:**
1. **Blind re-contracting of shop** by an isolated contract-author agent, with the hand contracts kept dev-only or as a sensitivity set.
2. **Open-weight (ollama) ideation for half of the drift ideas,** reported as a stratum. This is the cheapest real second-family input to the substrate.
3. **A freeze ledger** (`freeze-ledger.json`) with tag ancestry checked by the verifier.
4. **Strict-mode `mayRead` denial of fixtures and traces;** unprivileged CI (`permissions: contents: read`); provenance hashes in the PR body.
5. **The attack-success definition with four conditions:**
   - canary egress;
   - attacker-directed behaviour in a gate-passing patch, judged by the attack's own oracle;
   - non-`src` edits;
   - a disallowed command.
   Plus the paired current-vs-hardened McNemar, and a small adaptive attacker as exploratory.
6. **A prose-only gated rung** (RA4) added to the ladder, so the input effect (prose vs raw trace vs repro) is separated from gating.
7. **A documented vs undocumented changelog stratum** for benign cases, and the triage guard on true drifts (≥ 90% routed to code).

**From maximal-evidence:**
1. **A monitor-independent `truth()` projection** for labels and the oracle (it replaces must-fix 2).
2. **A wrong-patch pool built before the arms run** (must-fix 4).
3. **Blind authors who do not see the MCP server source;** an S12 plausible-string quota inside the evasive stratum.
4. **Intersection-union testing** for C5's non-inferiority, if C4 and C5 are merged into one claim.
5. **LLM-authored contracts** (3 seeds) as an exploratory row: it answers the authoring-cost critique at about 12 calls.
6. **A PR owner allow-list in `pr.ts`** (only `vats98754`), enforced by a unit test. Today the rule rests only on a gh audit.
7. **Dual grading of declines** wherever agent answers are graded.

**Not worth grafting:** τ² (it repairs the authors' own wrapper), a confirmatory slot for receipts, C5-style recurrence (holds by construction), and the 20-baseline sweep. Keep narrow's six detection baselines plus the LLM judge with upstream; a minority of strong baselines beats a crowd of emulations.

---

## What would still be left for Limitations, after the fixes

- Every author, repairer, reference-fix writer and judge is a Claude model.
- The domains are mocks.
- Real bugs are case studies (n ≈ 3–5).
- Products are emulated, not run.
- Only static attacks are tested.
- All results are conditioned on detection.
- No human review; H26 is optional.

None of these blocks acceptance if the abstract states them as scope.
