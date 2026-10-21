# LLM program repair and self-healing systems (area: llm-repair)

Written 2026-10-21 for the fiks paper. Machine-readable catalog: `llm-repair.sources.json` (34 sources). Existing claim IDs reused: C17 (TDFlow), C20 (SWE-Doctor), C21 (agentic PRs, owned by another area), C27 (Sentry Seer and other adjacent products).

## 1. Scope and searches run

**Question.** How do LLM and classical repair systems decide that a patch is correct? How can we evaluate repair success rigorously? How should a repro-gated loop (fiks) be compared with an ungated one?

**Method and a limit to state up front.** The shared WebSearch budget for this workflow turn ran out on this agent's first query (limit 200 per turn across all agents). No search-engine results were used. Instead I fetched known primary URLs (mostly arXiv abstract and HTML pages, plus publisher PDFs) directly with WebFetch. Every source in the catalog was opened and checked on 2026-10-21. Gaps that this causes are listed in Section 9.

**Queries attempted (all returned the budget error, 2026-10-21):**
- "Are 'Solved Issues' in SWE-bench Really Solved Correctly? PatchDiff"
- "SWE-Bench+ solution leakage weak test cases"
- "Evaluating Agent-based Program Repair at Google Passerine"
- "OpenAI SWE-bench Verified no longer contaminated flawed tests 2026"

**Fetched directly (40 URLs).** All URLs in the catalog, plus several that failed:
- 403: the OpenAI SWE-bench Verified post, the OpenAI "why we no longer evaluate SWE-bench Verified" URL (existence unconfirmed), the ACM pages for ClearView and Rx, and IEEE Kephart & Chess.
- 404: a CMU mirror of Kephart & Chess.
- No usable content: the Google security blog body.

**Full-text deep reads (HTML or PDF):**
- PatchDiff (2503.15223)
- Google Passerine (2501.07531)
- Meta Engineering Agent (2507.18755)
- TDFlow (2510.23761)
- SWE-Bench+ (2410.06992)
- Agentless (2407.01489)

Partial reads (relevant sections only): SWT-Bench, Otter, ImpossibleBench, ClearView, Qi et al., Smith et al.

## 2. Source catalog

| # | Source | Year | Type | Central claim | Cluster |
|---|---|---|---|---|---|
| 1 | SWE-bench (Jimenez et al., ICLR'24) | 2023 | paper | 2,294 GitHub issues; success means the developer tests pass; Claude 2 solved 1.96% | A benchmarks |
| 2 | SWE-bench Verified dataset card | 2024 | docs | 500 human-validated instances; FAIL_TO_PASS / PASS_TO_PASS test sets | A |
| 3 | SWE-agent (Yang et al.) | 2024 | paper | Agent-computer interface; 12.5% pass@1 on SWE-bench | B agents |
| 4 | Agentless (Xia et al.) | 2024 | paper | Localize, repair, validate; LLM reproduction test + regression tests are the largest filter gain (81→96 fixes) | B |
| 5 | AutoCodeRover (ISSTA'24) | 2024 | paper | Structure-aware search; ~19% of Lite at $0.43 | B |
| 6 | SpecRover (ICSE'25) | 2024 | paper | Spec inference plus a reviewer agent that vets patches | B / D |
| 7 | RepairAgent | 2024 | paper | Tool-using agent; 164 Defects4J bugs | B |
| 8 | OpenHands (ICLR'25) | 2024 | paper | MIT-licensed open agent platform | B |
| 9 | PatchDiff (Wang, Pradel, Liu) | 2025 | paper | 7.8% of plausible patches fail the full developer suite; 29.6% diverge from the reference; inflation 6.2 points | C patch correctness |
| 10 | SWE-Bench+ | 2024 | paper | 32.67% solution leakage; 31.08% weak tests; 12.47%→3.97% | C |
| 11 | UTBoost (ACL'25) | 2025 | paper | 345 wrong patches passed; 24.4% of Verified leaderboard entries affected | C |
| 12 | SWE-Bench Illusion | 2025 | paper | 76% vs 53% file-path recall suggests memorization | C contamination |
| 13 | SWE-rebench | 2025 | paper | Continuously mined, decontaminated tasks | C |
| 14 | SWE-bench-Live | 2025 | paper | 1,319 fresh tasks; agents score lower | C |
| 15 | SWE-Bench Pro | 2025 | paper | Held-out and commercial splits resist contamination | C |
| 16 | TDFlow [C17] | 2025 | paper | Human-written tests 94.3% vs LLM-written tests 68.0% on Verified | D test-as-oracle |
| 17 | SWE-Doctor [C20] | 2026 | paper | A single F2P test leads to partial patches; multi-faceted tests help | D |
| 18 | SWT-Bench | 2024 | paper | Generated tests as a filter double SWE-agent precision (47.8%) at ~20% recall loss | D |
| 19 | Otter (ICML'25) | 2025 | paper | Issue→test gives an F2P test for 31–37% of instances; filtering gives 65–92% precision at 30–41% recall | D |
| 20 | ImpossibleBench | 2025 | paper | Agents cheat on tests (GPT-5 54% on conflicting SWE tasks); read-only or hidden tests mitigate | D / C |
| 21 | Self-repair silver bullet (ICLR'24) | 2023 | paper | Self-repair is limited by feedback quality | D |
| 22 | Passerine at Google | 2025 | paper | Plausible 73% / 25.6% vs valid 43% / 17.9% (machine- vs human-reported bugs) | E industrial |
| 23 | Meta Engineering Agent | 2025 | paper | Test-failure-triggered; 31.5% of reviewed fixes landed | E |
| 24 | Google AI-powered patching | 2024 | tech report | Gemini fixed 15% of sanitizer bugs; human review | E |
| 25 | SapFix (Meta blog) | 2018 | blog | Detect, test and repair; never deploys without engineer approval | E |
| 26 | Getafix | 2019 | paper | Learned fix patterns for static-analysis warnings; deployed | E |
| 27 | Repairnator (human-competitive) | 2018 | paper | CI-failure bot; maintainers merged its patches | E / F |
| 28 | Repairnator design (ICSE-SEIP'18) | 2018 | paper | Patches for 17 of 11,317 test failures | E / F |
| 29 | Qi, Long, Achour, Rinard (ISSTA'15) | 2015 | paper | Most reported G&V patches are implausible or incorrect, often just deleting functionality | C classical |
| 30 | Smith, Barr, Le Goues, Brun (FSE'15) | 2015 | paper | Overfitting; evaluate on held-out tests | C classical |
| 31 | Xiong et al. (ICSE'18) | 2018 | paper | Behavior comparison filters 56.3% of incorrect patches and no correct ones | C classical |
| 32 | ClearView (SOSP'09) | 2009 | paper | Learned invariants → monitor → runtime patch → evaluate; Red Team: blocked 10/10 exploits, patched 7 | F self-healing |
| 33 | Failure-oblivious computing (OSDI'04) | 2004 | paper | Mask memory errors to keep serving | F |
| 34 | Monperrus bibliography (CSUR) | 2018 | paper | Behavioral repair vs state (runtime) repair | F |

## 3. Clusters

**A. Issue-resolution benchmarks (1–2).** Success means passing hidden developer tests: FAIL_TO_PASS plus PASS_TO_PASS. That is a plausibility criterion, not a correctness criterion.

**B. LLM repair agents and pipelines (3–8).** Two families: agentic loops (SWE-agent, OpenHands, RepairAgent) and fixed pipelines (Agentless, AutoCodeRover, SpecRover). The strongest pipelines all add self-validation: a generated reproduction test, regression tests, majority voting, or a reviewer agent. In Agentless the validation step is the largest single gain.

**C. Evaluation critiques (9–15, 29–31).** One continuous line from 2015 to 2025:
- Test-validated patches overfit (Qi 2015; Smith 2015).
- Held-out tests and behavior comparison expose this (Smith; Xiong).
- The same holds for LLM agents on SWE-bench: weak tests (SWE-Bench+, UTBoost, PatchDiff), solution leakage (SWE-Bench+, Agentless), and contamination (Illusion, SWE-rebench, Live, Pro).

**D. Tests as the oracle and as the steering signal (16–21).**
- A true reproduction test is the bottleneck (TDFlow).
- Generated tests are valid for only about a third of issues (Otter), but as a filter they raise precision while cutting recall (SWT-Bench, Otter).
- A single F2P test can produce partial patches (SWE-Doctor).
- Agents game visible tests (ImpossibleBench).
- Feedback quality limits repair (Olausson).

**E. Industrial repair (22–28).** Every deployed system we found:
1. is triggered by a machine signal (crash, sanitizer, failing test, static-analysis warning, CI failure);
2. validates with tests and CI;
3. requires human review before merge.

Their reported acceptance rates are well below the benchmark numbers: 31.5% of reviewed fixes landed at Meta; 43% / 17.9% of patches were valid at Google; Repairnator patched 17 bugs out of 11,317 failures.

**F. Classical self-healing (32–34).** Runtime state repair, as in failure-oblivious computing and ClearView's invariant enforcement, keeps a service up without a source change and without a human. ClearView is the closest structural ancestor of fiks: it learns invariants from normal runs, detects violations, patches, and then evaluates the patch on continued execution.

## 4. Contradictions and why they disagree

1. **"A reproduction test is all you need" (TDFlow: 94.3%) vs "a single F2P test gives partial patches" (SWE-Doctor; also Meta, where n=19 of 100 coded reviews were partial fixes).**
   - TDFlow hands the agent the *same* hidden human tests that later grade it (Sec. 4.2: "we provide the normally hidden, human-written tests"). Guide and oracle coincide, so 94.3% measures fitting the grader. That is exactly the evaluation design Smith et al. warn against.
   - SWE-Doctor grades with tests the agent did not see.
   - Both can be true: a ground-truth test is a powerful *steering* signal, but it is not enough as a *correctness* oracle.

2. **"Tests as a filter help" (SWT-Bench, Otter, Agentless) vs "plausible ≠ correct" (PatchDiff, Passerine, SWE-Bench+).**
   - Filtering raises precision (47.8% for SWE-agent; 65–92% for Otter-filtered leaderboard patches), but recall falls to 20–41%.
   - The critiques measure what still slips through: 7.8–29.6% of plausible patches are suspicious (PatchDiff), and 43% vs 73% valid vs plausible at Google.
   - The two lines disagree only if one reports precision without recall, or plausibility without an independent oracle.

3. **Benchmark success (70–95% on Verified) vs industrial acceptance (25–45%).** The metrics differ. Benchmarks count passing hidden tests on curated, possibly memorized tasks. Industry counts human acceptance on fresh, in-context bugs. Rejection reasons at Meta: test already fixed or flaky, partial fix, missing product context, editing source when the test should change.

4. **Classical self-healing (fix at runtime, no human) vs modern industrial APR (PR plus human review).**
   - ClearView optimizes for availability and evaluates patches by continued execution.
   - SapFix, Getafix, Passerine and the Meta agent optimize for code-base integrity.
   - Qi et al. show why unsupervised acceptance is dangerous: plausible patches that delete functionality.
   - fiks sides with industry (PR, never merge) but keeps ClearView's runtime trigger.

5. **Contamination.**
   - Illusion, SWE-rebench and Live argue that Verified scores are inflated.
   - SWE-Doctor and TDFlow still report Verified as their headline.
   - For fiks, seeded drifts cannot be memorized, but we authored them, which risks designer bias. A reviewer can push on either side.

## 5. Claim ledgers (deep-read sources)

**PatchDiff (2503.15223)**
- L1. Running *all* developer tests rather than only the PR-modified test files shows 7.2–8.4% of plausible patches fail; the average is 7.8% (Sec. 4.1).
- L2. PatchDiff uses gpt-4o-mini to write tests that separate the agent patch from the reference patch. It runs each test 20× to drop flaky ones and flags 260/877 = 29.6% of plausible patches (Sec. 3.2, 4.2).
- L3. Manual review of 77 flagged patches:
  - 28.6% certainly incorrect, 5.2% correct, 66.2% uncertain (Sec. 4.4).
  - The incorrect ones split into regressive (11) and partial (6), among others.
- L4. Inflation: 6.2 points in the abstract vs 6.4 in Sec. 4.4 (HTML). Cite the abstract figure and mark the other [verify].
- Tools studied: CodeStory, LearnByInteract, OpenHands.

**SWE-Bench+ (2410.06992)**
- L1. 32.67% of resolved instances had the solution in the issue or comments (Sec. 2.1.1).
- L2. 31.08% of passed patches were suspicious because of weak tests (Table 1: 78/251).
- L3. Three authors reviewed independently and resolved disagreements by discussion. No agreement statistic is reported.
- L4. On post-cutoff issues (548), rates collapse (SWE-agent+GPT-4: 0.55%), and weak tests persist.

**Passerine at Google (2501.07531)**
- L1. "Plausible" means the bug-reproducing tests pass. "Valid" means semantically equivalent to the ground truth, judged manually by three authors (Sec. IV).
- L2. For human-reported bugs, tests are kept only if they fail before and pass after the ground-truth patch. The agent never sees them (Sec. III-C).
- L3. Results:
  - Machine-reported: 73% plausible vs 43% valid. These appear to be averages of the SAN and TOD rows; they are not in Table IV [verify].
  - Human-reported: 25.6% vs 17.9% (Table IV).

**Meta Engineering Agent (2507.18755)**
- L1. Trigger: a rule-based Test Failure Manager Bot bisects, groups and de-flakes failures, then launches the agent (Sec. III).
- L2. Gates: the breaking test passes, an LLM judge approves (precision 0.867, recall 0.385, Table IV), CI passes, then human review (Sec. IX).
- L3. Production, Feb–Apr 2025: 1,589 published, 1,285 reviewed, 405 landed. That is 31.5% of reviewed and 25.5% of published (Table V).
- L4. Rejection reasons, open-coded from 100 comments: test already fixed or flaky (47), partially correct (19), missing context (11), and others (Sec. IX-B).

**TDFlow (2510.23761) [C17]**
- L1. Table 2: LLM-written tests 68.0%, human-written tests 94.3%, human-written tests without the debugger 87.2% (Sec. 4.2).
- L2. The introduction says 69.8% for the LLM-test mode, which conflicts with Table 2. **C17 should cite "Table 2".**
- L3. Hidden tests are deliberately given to the agent. There is no held-out oracle.
- L4. Test hacking: 3 of 400 Verified runs (Sec. 4.4, App. C, two-of-three reviewer rule).

**Agentless (2407.01489)**
- L1. Sampling: 40 reproduction-test candidates per issue, keep those that reproduce, pick the most frequent (Sec. 3.3.1).
- L2. Ablation: majority vote 77 → + regression 81 → + reproduction 96 (Table 4).
- L3. Lite-S filtering: 4.3% of issues contain the exact patch, 5.0% a misleading solution, 10.0% too little information (Sec. 6.1).

## 6. What this means for fiks

**Where fiks differs:**
1. *Trigger.* An outcome-contract violation in live traffic. It is neither a crash or failing test (Repairnator, Meta, SapFix, Sentry Seer [C27]) nor issue prose (SWE-bench family). The repro comes from the captured call and the raw upstream HTTP, not from an LLM guessing from text. That targets the bottleneck that TDFlow and Otter measure (an F2P test from issue prose for only 31–37% of instances).
2. *Gate stack.* fiks requires all of the following before it opens a PR:
   - an F gate (the repro fails for the stated reason);
   - a P gate;
   - the full contract suite;
   - every stored trace;
   - typecheck and lint;
   - green CI on the exact commit.

   This is SWE-bench's F2P + P2P generalized, and it directly addresses SWE-Doctor's partial-patch risk [C20].
3. *Anti-gaming.* The edit allow-list is `src/**/*.ts` only, so tests and recordings are read-only (codebase-map §6). This matches ImpossibleBench's read-only mitigation.
4. *Human in the loop.* It never merges, like SapFix and Meta.
5. *Runtime half.* Receipts are Monperrus's "state repair" / ClearView-style mitigation. PRs are behavioral repair.

**Where fiks is weaker:**
- Its correctness evidence today is gate passes plus live confirm on the same contracts that defined the bug. In Smith et al.'s terms, the training and test oracles are the same.
- Five seeded drifts, one attempt each, 1.4–1.6 min. That is a ceiling regime in which an ungated agent may succeed equally often.
- The README says the merged PRs were not reviewed line by line by a person. Every industrial system above uses human review as its final correctness signal.
- Single model family. No contamination concern, but we authored the drifts.

**Strongest counter-arguments a reviewer will raise:**
1. *"Your gate is your grader."*
   - Concern: contracts and the repro both steer the patch and certify it, which is TDFlow's flaw.
   - Answer: add an independent held-out oracle per drift, written before repair and never visible to the agent; a PatchDiff-style differential test against a human reference fix; and blind human review using Passerine's plausible/valid rubric.
2. *"The trace leaks the solution."*
   - Concern: a trace showing `unit_amount` in the raw upstream body is analogous to SWE-Bench+'s 32.67% solution leakage.
   - Answer: that is the claimed mechanism [C19]. The comparison must separate it: give the ungated baseline the same trace without the gates, and run a no-trace ablation.
3. *"The drifts are too easy to separate the arms."*
   - Answer: add harder and real bugs (time-split, forks only), report pass@1 with several attempts and seeds, and show gate rejections. A gate that never rejects anything adds no evidence.
4. *"Green CI is not independent."* CI runs the same suite. Report CI separately as an operational property (a merge-odds proxy, C21), not as a correctness signal.

## 7. Candidate hypotheses (each with its falsifier)

- **H-R1 (precision).** At equal agent budget, repro-gated repair has higher PR precision than ungated repair given the same violation text and trace. Precision means opened PRs that pass a held-out oracle plus differential tests.
  - *Falsified if* the paired difference is ≤ 0, or its 95% CI includes 0 at the pre-registered power.
- **H-R2 (partial patches).** The full contract suite plus the all-trace gate rejects patches that pass the single repro but fail the held-out oracle [C20].
  - *Falsified if* no candidate patch is ever repro-pass and held-out-fail. The extra gates would then be unexercised, so report that as a null.
- **H-R3 (repro validity).** A traffic-captured repro is a valid F2P test (fails for the stated reason, passes on the reference fix) at a higher rate than an LLM-written repro from an issue-style description of the same drift (Otter/Agentless style).
  - *Falsified if* the LLM-from-prose F2P rate is not lower on the same drifts and bugs.
- **H-R4 (gaming).** With the allow-list off, the repair agent edits tests or recordings in a measurable share of runs; with it on, the share is zero and the held-out pass rate does not fall.
  - *Falsified if* tampering is zero without the guard (the guard is then unnecessary), or the guard lowers held-out correctness.
- **H-R5 (plausible vs valid gap).** For fiks-opened PRs, the gap between gate-pass and blind-human-judged valid is small. This is a descriptive target, compared qualitatively with Passerine's 30-point gap on machine-reported bugs.
  - *Falsified if* human reviewers judge a material share invalid. Pre-register the threshold, for example ≥ 20%.

**Design for gated vs ungated.** Run both arms on the same drift or bug instance, with the same model and seeds, k ≥ 5 attempts each.
- Outcomes:
  1. gate pass (plausible);
  2. held-out oracle pass;
  3. differential-test agreement with the reference fix;
  4. blind human valid / invalid / uncertain, with two reviewers and Cohen's κ;
  5. cost and time.
- Report precision **and** recall, as SWT-Bench and Otter do.
- Use McNemar or an exact paired test per outcome, Wilson CIs, and Holm correction.
- The ungated arm opens "would-be PRs" with `--no-pr` and is graded identically.

## 8. Candidate baselines we could actually run

| Baseline | What it isolates | How | License / feasibility |
|---|---|---|---|
| Ungated fiks (violation text + trace, no F/P/contract/trace gates) | value of gates | `repair.ts` variant (codebase-map §7: "repair without a repro test", 3–4 h) | ours |
| Repro-only gate (no contract suite or traces) | C20 partial-patch protection | drop suite and traces from `localGate` | ours |
| No-trace prompt | solution-leakage effect | `promptVariant` hides exchanges and repro JSON (1–2 h) | ours |
| Guard off (tests/recordings editable) | ImpossibleBench-style gaming | widen `REPAIR_ALLOWED`; throwaway base | ours |
| LLM-written repro from issue prose (Agentless-style 40-sample majority) | H-R3 | prompt the model with a drift "issue" paragraph; apply the F gate | ours (method from Agentless) |
| mini-swe-agent / SWE-agent on a fork with an issue-text task | third-party agentic, ungated | run against shop-mcp fork; grade with held-out oracle | MIT [verify license file] |
| OpenHands on the same | third-party platform | Docker runtime on fork | MIT (abstract) |
| Agentless / AutoCodeRover | pipeline baselines | Python-repo-specific localization; TS port needed | [verify license]; low feasibility |
| Sentry Seer Autofix | error-driven commercial autofix | needs an error event; silent faults raise none [C27] | proprietary; argue qualitatively, not run |
| PatchDiff as an evaluator | differential correctness | re-implement: LLM-generated tests separating agent vs reference fix, 20× flake filter | code availability [verify]; re-implementation is cheap |

## 9. Open gaps

- **Search budget.** No search-engine discovery was done (Section 1). The likely missing items:
  - 2026 work on patch-correctness assessment with LLMs;
  - any OpenAI 2026 statement retiring SWE-bench Verified (URL returned 403, existence unconfirmed);
  - SWE-bench Multilingual / TypeScript benchmarks (relevant because shop-mcp is TS);
  - GenProg (Le Goues TSE'12), Prophet, Rx (SOSP'05), Kephart & Chess (2003), the Bloomberg APR experience report, and the SapFix ICSE-SEIP'19 paper.

  A follow-up turn with search should add these.
- **Unconfirmed details.**
  - Venue tags marked [verify]: SWE-agent NeurIPS'24, Agentless FSE'25, RepairAgent ICSE'25, SWT-Bench NeurIPS'24, Getafix OOPSLA'19, Passerine ICSE-SEIP'25.
  - Licenses of SWE-agent, Agentless and AutoCodeRover.
- **C17 precision.** Cite TDFlow Table 2 (68.0%). The introduction's 69.8% conflicts with it.
- **C21 check (not my area).** The arXiv abstract of 2601.15195 does not show 71.48% or ~15% per failed CI check. The C21 verifier should confirm these in the full text.
- **Missing evidence.**
  - No study measures repair success from *runtime-captured* repros of *silent semantic* faults. That is fiks's gap, and also its burden of proof.
  - No public dataset of MCP-server fix PRs with independent oracles exists; we would have to build one.
