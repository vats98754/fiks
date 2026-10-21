# Failure-reproduction test generation: issue-to-test, crash reproduction, record/replay, F->P validity

Area: repro-generation. Researcher pass dated 2026-10-21. Machine-readable catalog: `repro-generation.sources.json` (same keys as column 2 below).
Status: every source was opened (arXiv abstract or HTML full text, publisher/repository record, README or PDF). Quotes were extracted from the fetched text by a summarizing fetcher and should be re-matched character-for-character by the citation verifiers; quotes I did not see verbatim are marked [verify]. All numbers are the source authors' own, not ours.

## 1. Scope and searches run (2026-10-21)

Questions: (a) how often do LLMs produce valid fail-to-pass (F->P) reproduction tests; (b) how is validity measured, and does anyone check that a test fails *for the stated reason*; (c) is there evidence that a runtime artifact (stack trace, execution log, field trace, recorded traffic) makes reproduction easier (C17-C19); (d) what record/replay practice exists for HTTP fixtures; (e) which of these can we run as baselines.

Searches (WebSearch; "ext" = extended):
1. LIBRO "Large Language Models are Few-shot Testers" bug reproduction arXiv
2. SWT-Bench testing and validating real-world bug-fixes with code agents arXiv
3. Otter generating tests from issues to validate SWE patches arXiv
4. Issue2Test generating reproducing test cases from issue reports arXiv
5. AEGIS agent-based issue reproduction test generation arXiv 2024
6. TDD-Bench Verified fail-to-pass tests before fix arXiv
7. (ext) reproduction test validity "fail for the wrong reason" LLM generated tests SWE-bench
8. EvoCrash search-based crash reproduction guided genetic algorithm Soltani
9. Botsing crash reproduction framework JCrashPack benchmark
10. BugRedux reproducing field failures in-house execution data Jin Orso
11. ReCDroid automatically reproducing Android application crashes from bug reports
12. SWE-bench FAIL_TO_PASS PASS_TO_PASS definition evaluation harness
13. Agentic Bug Reproduction for Effective Automated Program Repair at Google BRT
14. TDFlow agentic workflows test driven software engineering 2510.23761
15. Keploy generate tests from API traffic record replay mocks open source

The shared per-turn WebSearch budget (200 calls across the swarm) ran out after search 15. Three planned searches did not run: Polly/VCR, rr, Multi-SWT-Bench. I reached those sources by fetching their known primary URLs directly (GitHub READMEs, arXiv). No search was rerouted through a third-party engine. Sources a follow-up pass should search for: AssertFlip (named in ReProAgent's tables), CrashTranslator, JCrashPack (EMSE), Koyuncu et al. iFixR (the 96% statistic LIBRO cites), and the OpenAI SWE-bench Verified annotation post (403 on fetch, so it is not cited).

Deep-read in full text (arXiv HTML, first ~100k chars): SWT-Bench (2406.12952v3), Otter (2502.05368v2), e-Otter++ (2508.06365v3), TDFlow (2510.23761v2), BRT Agent (2502.01821v2), Multi-SWT-Bench (2609.34752). Read in part: Issue2Test v4, TDD-Bench-Java, ReProAgent, BRT cogeneration, Test Overfitting, LIBRO (ar5iv), ReCDroid (PDF p.1), Luo et al. (PDF text).

Could not open: OpenAI "Introducing SWE-bench Verified" (403); Jin & Orso ICSE'12 PDF (404 after redirect), so BugRedux is cited from the Georgia Tech tech-report abstract and project page.

## 2. Source catalog

Clusters: **A** benchmarks and F->P definitions; **B** LLM issue-to-test generators; **C** repro tests as repair input (helps / hurts); **D** classical crash and field-failure reproduction; **E** record/replay and traffic-to-test tooling; **F** test validity, determinism and overfitting.

| # | key | year | type | central claim | cluster |
|---|---|---|---|---|---|
| 1 | swe-bench | 2024 | paper | 2,294 issue/PR tasks; patch judged by running the PR's tests | A |
| 2 | swe-bench-dataset-card | 2024 | tool-docs | FAIL_TO_PASS = tests resolved by the PR and tied to the issue; PASS_TO_PASS = pass before and after | A |
| 3 | swe-bench-verified-card | 2024 | tool-docs | 500 instances human-validated, because the original tests were not reliably valid oracles | A/F |
| 4 | libro | 2023 | paper | LLM report-to-test: 33% (251/750) on Defects4J; stack traces raise reproduced crash bugs 69 to 84 | B |
| 5 | swt-bench | 2024 | paper | Success = at least one F->P test and no x->F test; best 18.5% (SWE-Agent+) on Lite; any thrown error counts as a failure | A |
| 6 | swt-bench-harness | 2024 | repo | MIT Docker harness; Lite/Verified; ~120GB disk | A/E |
| 7 | tdd-bench-verified | 2024 | paper | 449 issues; F->P plus coverage of the golden change | A |
| 8 | tdd-bench-harness | 2024 | repo | Apache-2.0 harness reporting TDD_Score and F->P count | A |
| 9 | otter | 2025 | paper | 31.4%/37.0% F->P (GPT-4o); error-failing tests are F->P only 3.7% of the time vs 57.1% for assertion failures | B/F |
| 10 | e-otter-plus-plus | 2026 | paper | Execution feedback + LLM "right reason" critic: 63.0% F->P on TDD-Bench-Verified; critic F-score 0.78-0.83 | B/F |
| 11 | tdd-bench-java | 2026 | paper | Java: 43.6-46.4% F->P; industrial issues 4%, rising to 20% with identifier hints | B |
| 12 | issue2test | 2025 | paper | Targets tests that fail for the issue's reason (LLM-judged); 32.9% on SWT-bench-lite | B/F |
| 13 | aegis | 2024 | paper | FSM-guided agent; +23.0% F->P over best baseline; +12.5% relative Agentless resolution | B/C |
| 14 | brt-agent-google | 2025 | paper | Google: 85% of candidates fail on buggy code, but only 28% are F->P; BRTs give +30% relative plausible fixes | B/C |
| 15 | brt-cogeneration | 2026 | paper | One agent writing fix + BRT: fixes biased toward its own BRT; BRTs deleted | C/F |
| 16 | reproagent | 2026 | paper | SOTA agent, 58.4% (Lite) / 70.3% (Verified) F->P; removing execution feedback 56.9% to 18.8% | B |
| 17 | multi-swt-bench | 2026 | paper | 8 languages incl. TS/JS; >80% fail-on-buggy but F->P 9.7-28.5 pp lower; best 79.4%; edits invalidate repros | A/F |
| 18 | tdflow (C17) | 2025 | paper | 94.3% with human tests vs 68.0% with generated tests on Verified; bottleneck is writing tests | C |
| 19 | swe-doctor (C20) | 2026 | paper | F->P BRTs give limited or negative gains (single manifestation, partial patches); multi-faceted diagnoses help | C/F |
| 20 | test-overfitting-swebench | 2025 | paper | 21.8-33.0% of patches passing generated tests fail hidden tests; refinement increases it | C/F |
| 21 | frtg-jos-c18 (C18) | 2026 | paper | ~90% of SWE-bench Lite issues lack a failure-reproducing test; issues lack stack traces | A/D |
| 22 | evocrash | 2020 | paper | Stack-trace-guided GA crash reproduction; tests help developers fix faster | D |
| 23 | botsing | 2020 | paper | Open, extensible stack-trace-to-test framework (Java) | D |
| 24 | bugredux | 2012 | paper | Field execution data guides symbolic execution; 17 failures in 15 programs | D |
| 25 | recdroid | 2019 | paper | NLP + GUI exploration: 33/51 (63.5%) Android crashes from text | D |
| 26 | adbgpt | 2024 | paper | LLM prompting replays 81.3% of Android bug reports | D |
| 27 | crashjs | 2024 | paper | 453 Node.js crashes as a benchmark | D |
| 28 | rr | 2017 | paper | Low-overhead user-space record/replay for reproducing hard failures | E |
| 29 | vcr | 2010- | repo | HTTP cassettes: record once, replay deterministically | E |
| 30 | pollyjs | 2018- | repo | JS record/replay/stub of HTTP (Apache-2.0) | E |
| 31 | nock | 2011- | repo | Node HTTP recorder; "lockdown" forbids unrecorded calls (MIT) | E |
| 32 | keploy | 2022- | tool-docs | Socket-level traffic capture becomes tests plus dependency mocks; oracle = recorded response (Apache-2.0) | E |
| 33 | flaky-tests-luo | 2014 | paper | Flakiness is mostly async wait (45%), concurrency (20%) and order dependency (12%); network and time are causes | F |

## 3. Clusters

**A. Benchmarks and the F->P definition.** SWE-bench's FAIL_TO_PASS / PASS_TO_PASS split is the shared protocol [swe-bench-dataset-card]. SWT-Bench turns it into a test-generation task: success means at least one F->P test and no test that fails after the fix [swt-bench §3.1]. TDD-Bench-Verified adds coverage of the golden change [tdd-bench-verified]. Multi-SWT-Bench extends the task to 8 languages, including TypeScript and JavaScript. Its validity rule also demands that *all* generated tests pass on the patched code [multi-swt-bench §2.1]. Every one of these needs a **golden patch** to decide validity. None checks the failure's cause deterministically. SWT-Bench counts any thrown exception, including errors from bad syntax, as a failure [swt-bench §3.1].

**B. LLM issue-to-test generators (yield).** On Python SWE-bench-derived sets, F->P yield rose from about 15-19% in 2024 [swt-bench Table 2] to 31-37% in early 2025 [otter Tables 1, 3], then 63% [e-otter-plus-plus] and 58-70% [reproagent Tables 2-3] in 2026. Claude Code with Claude Opus 5 reaches 79.4% F->P on Multi-SWT-Bench-Lite [multi-swt-bench Table 4]. Yield falls sharply off-benchmark. Java reaches 43-46%, and on 150 proprietary industrial issues it was 4%, or 20% with identifier hints [tdd-bench-java §6.2]. Google's industrial BRT Agent reached 28% plausible BRTs [brt-agent-google Table 2]. The gains all come from **execution feedback** (running the candidate on the old code) and **localization**. ReProAgent drops from 56.9% to 18.8% without its execution-feedback review, and correct localization raises it from 50.7% to 67.8% [reproagent Tables 7-8]. e-Otter's largest ablation drop comes from removing the critic that reads the old-code execution log [e-otter-plus-plus Table 4].

**C. Repro tests as repair input.** The evidence is split (see §4). Given a valid test, repair is close to solved: 94.3% with human tests [tdflow, C17]. Generated tests help as **filters**: SWE-Agent precision more than doubles [swt-bench §5.3], and one leaderboard system's precision rose from 60.8% to 91.9% at 33% recall [otter §6.7]. They also help as **inputs** at Google (+30% relative plausible fixes) [brt-agent-google §6.2]. As **targets**, they can hurt: F->P BRTs give limited or negative gains [swe-doctor], and 22-36% of passing patches overfit [test-overfitting-swebench Table 1].

**D. Classical crash and field-failure reproduction.** Here the runtime artifact *is* the input. EvoCrash and Botsing seed the search with the stack trace and use "reproduces the same stack trace" as the oracle [evocrash; botsing]. BugRedux uses field execution data to guide symbolic execution and shows that a "suitable yet limited" amount of data suffices [bugredux]. ReCDroid and AdbGPT reproduce Android crashes from report text, at 63.5% and 81.3% [recdroid; adbgpt]. All of them need a **crash** (an exception or stack trace) as the oracle. A silent wrong-data failure has no crash, which is why this line does not transfer directly. As the C18 source states, issues often lack the stack traces these methods depend on [frtg-jos-c18].

**E. Record/replay.** rr records nondeterministic inputs at the process boundary and replays them to reproduce hard failures [rr]. VCR, Polly.JS and nock do the same at the HTTP boundary for tests. nock's "lockdown" mode forbids unrecorded calls [vcr; pollyjs; nock]. Keploy captures production-like traffic into tests plus dependency mocks [keploy]. These tools set the engineering practice fiks's fixtures follow. **Their oracle is the recorded response itself.** A test recorded from buggy traffic asserts the buggy output, so it passes on the buggy code. It is a regression oracle, not an F->P repro. fiks's contribution is pairing a recording made *at violation time* with an independent correctness oracle (the contract).

**F. Validity, determinism, overfitting.**
- Fails-on-buggy is necessary but not sufficient. At Google, 85% of candidate BRTs failed on the buggy code but only 28% were plausible [brt-agent-google]. Multi-SWT-Bench reports that F->P runs 9.7-28.5 pp below fail-on-buggy [multi-swt-bench §4.1.2].
- Failure type predicts validity. Tests that fail with errors are F->P 3.7% of the time, vs 57.1% for assertion failures [otter Table 6]. e-Otter++ shows the same pattern (9.1% vs 50.4%) [e-otter-plus-plus Table 14].
- Cause checks today are LLM judges, with an F-score of about 0.8 [e-otter-plus-plus Table 5; issue2test Fig. 9; tdd-bench-java §4.1].
- Agents invalidate or delete their own repros [multi-swt-bench §4.2.2; brt-cogeneration §1].
- Nondeterminism (async waits, network, time) is the main source of flaky tests [flaky-tests-luo].

## 4. Contradictions and why they disagree

1. **Do repro tests help repair?** Yes, per [brt-agent-google] (+30% relative plausible fixes), [aegis] (+12.5% relative Agentless resolution) and [swt-bench]/[otter] (precision gains). Limited or negative, per [swe-doctor] for F->P BRTs as guidance and [test-overfitting-swebench] (refinement raises overfitting). *Why they disagree:* (i) the metric differs. Precision of a filter is not the resolve rate of a guided agent, and "plausible" (passes the oracle BRT) is not "correct" (passes hidden tests). (ii) The role differs: post-hoc selector vs generation target. (iii) The test source differs. SWE-Doctor and the overfitting study use generated tests of uneven validity, while TDFlow's 94.3% uses human tests. The consistent reading: a *valid* repro is strongly useful, and an *invalid or narrow* one can mislead. Validity and coverage of manifestations are the variables.
2. **How good is LLM reproduction?** Reported rates run from 4% [tdd-bench-java, industrial] and 18.5% [swt-bench 2024] up to 79.4% [multi-swt-bench 2026]. *Why:* model generation (2024 vs 2026 frontier), the benchmark (curated public Python vs proprietary or other languages), possible contamination of public SWE-bench repos, and the metric (single-test F->P vs "all tests pass after the fix").
3. **Internal inconsistencies to handle carefully.** TDFlow gives 68.0% (Table 2) vs 69.8% (Sec. 1) for generated tests on Verified. **C17 in RESEARCH.md uses 68.0%; we should say "Table 2" explicitly.** ReProAgent's text names 38.0% as the best Lite baseline while its Table 3 lists e-Otter++ at 40.2%. Issue2Test's numbers differ between arXiv versions (cite v4). AEGIS's arXiv abstract says +23.0% F->P, while a conference-listing summary said 19.0% [verify].
4. **Crash reproduction success** (EvoCrash: high on its own sample vs about 43% on JCrashPack [verify, snippet only]) reflects benchmark difficulty, not a conflict.

## 5. Claim ledger for deep-read sources

**SWT-Bench [swt-bench]**
- L1. Success requires at least one F->P test and no x->F test (§3.1, quoted).
- L2. A test fails if any error is thrown, including syntax errors. There is no cause check (§3.1, §6).
- L3. SWE-Agent+ 18.5%, LIBRO 14.1%, AutoCodeRover 9.1% S on Lite (Table 2).
- L4. Filtering on generated tests more than doubles SWE-Agent precision, to 47.8%, at 20% recall (§5.3).
- L5. Change coverage correlates with success: 69.4% on successful instances vs 72.0% for golden tests (Table 3).

**Otter / TDD-Bench-Verified [otter]**
- L1. Otter 31.4% and Otter++ 37.0% F->P on TDD-Bench-Verified (GPT-4o, Table 1); 25.4% and 29.0% on SWT-bench Lite (Table 3).
- L2. F->P share by failure type: assertion 57.1%, other 39.6%, error 3.7% (Table 6).
- L3. Patch filtering: 60.8% to 91.9% precision at 33% recall (§6.7).
- L4. Cost is under $0.10 per issue (§6.5).

**e-Otter++ [e-otter-plus-plus]**
- L1. 63.0% (283/449) F->P with Claude 3.7 Sonnet (Tables 2-3).
- L2. Without the critic: 37.2% to 29.4% (GPT-4o, Table 4).
- L3. The critic judging right-reason failure has an F-score of 0.78-0.83 (Table 5).
- L4. Surrogate-patch execution in selection raises the count from 213 to 283 (§4.4).

**TDFlow [tdflow, C17]**
- L1. 88.8% (Lite) and 94.3% (Verified) with human tests (Tables 1-2).
- L2. 68.0% with generated tests (Table 2); the text says 69.8%.
- L3. 7 test-hacking cases in 800 manually reviewed runs (§4.4).
- L4. The bottleneck is writing tests (§5, quoted).

**BRT Agent at Google [brt-agent-google]**
- L1. Candidate vs plausible BRTs: 85% vs 28%; LIBRO 41% vs 10% (Table 2).
- L2. Plausible fixes with a BRT: 17/23 vs 13/23 without (§6.2).
- L3. 86% of plausible BRT patches were valid on manual inspection (§6.1.1).
- L4. Inputs were issue text plus the buggy files. The effect of traces is not tested.

**Multi-SWT-Bench [multi-swt-bench]**
- L1. 1,963 instances, 8 languages, 51 repos (Table 1).
- L2. More than 80% fail on buggy code, but F->P is 9.7-28.5 pp lower (§4.1.2).
- L3. Best F->P is 79.41% (Table 4).
- L4. Revisions invalidate working repros (§4.2.2), with wrong-reason cases in App. C.

## 6. What this means for fiks

**Where fiks differs.**
- *Oracle source.* Issue-to-test systems must infer the oracle from prose, and they judge validity against a golden patch they do not have at deployment [brt-cogeneration §5.3.1]. fiks's oracle is the outcome contract that already flagged the violation. Its input is the exact call plus the raw upstream exchange, not prose. This is the C19 claim. The closest published support is directional only. Stack traces raised LIBRO's reproduced crash bugs from 69 to 84 [libro Table III]. Identifier hints raised industrial F->P from 4% to 20% [tdd-bench-java]. Execution logs and localization drive the 2026 SOTA [e-otter-plus-plus; reproagent]. BugRedux showed limited field data suffices [bugredux]. **No paper measures prose-only vs captured-trace input for LLM test generation on the same bugs.** That is a gap fiks can fill.
- *Validity check.* Prior systems check "fails for the right reason" with an LLM critic (F-score about 0.8). fiks's F gate is deterministic. The failing test must raise an `AssertionError` naming exactly the violated property IDs. An `UNMATCHED_REQUEST` (replay mismatch) counts as a wrong reason. Failures must be identical on 3/3 runs (`packages/repro/src/gate.ts` `classifyFailure`, `failGate`). That check is possible only because the oracle is a named property. It also matches Otter's finding that assertion failures are the valid ones.
- *No golden patch needed for F.* fiks establishes F on the current code alone. P is established on the agent's patch, plus the full contract suite and all stored traces (a PASS_TO_PASS analogue). The repro is generated before repair and frozen. The P gate rejects a deleted or skipped repro, which addresses the failure modes in [brt-cogeneration] and [multi-swt-bench §4.2.2].
- *Determinism by construction.* Replaying the recorded HTTP removes the network and time sources of flakiness [flaky-tests-luo; vcr; nock lockdown].
- *Record/replay with an independent oracle.* Keploy-style traffic tests assert equality with recorded output, so they pass on buggy code. fiks's assertion is the contract.

**Where fiks is weaker.**
- The repro "generator" is a template over a hand-written or mined contract. It achieves validity by moving the hard part, the oracle, to the contract author. Detection outside the contract vocabulary is bounded [C11].
- Evidence so far covers 5 seeded drifts on one server. Literature numbers come from hundreds to thousands of real issues.
- Strict replay matching (method + path + body + header names) fails on nonces, timestamps, retries and token refresh. Any such case yields "wrong reason", so no repro is produced (`paper/research/codebase-map.md` item 5).
- The repro asserts only the violated property: one manifestation. This is the C20 risk. It is mitigated by the full suite and traces, but the mitigation is unmeasured against a hidden-test oracle like [test-overfitting-swebench].
- fiks has no golden patch, so "P passed" means plausible, not correct [brt-cogeneration §4.2.1].

**Strongest reviewer counter-argument.** "Your F->P rate is trivially near 100% because the test is generated from the same contract that detected the violation. It is circular. The real reproduction problem, finding an oracle for an unknown bug, is assumed away. Meanwhile 2026 agents already write valid F->P tests 58-79% of the time from prose [reproagent; multi-swt-bench]. Give Claude Code the same violation receipt and it may do as well, without your template." To answer it, fiks must (a) run exactly that baseline, an LLM or agent writing the repro from the violation text and from the full trace, and score it with the *same* deterministic F gate plus a held-out correctness check; and (b) report how often contracts exist and fire on real bugs (contract-coverage experiments in other areas).

## 7. Candidate hypotheses (each with its falsifier)

- **H-R1 (validity of trace-derived repros).** On violations captured by fiks (seeded plus real-bug forks), trace-derived repros pass the deterministic F gate at least 95% of the time, while an agent-written repro from the violation text alone, scored by the same gate, does so less often. *Falsified if* the agent baseline's F-gate pass rate is within the CI of fiks's, or fiks's own rate is below 80%. Use a paired McNemar test over violations.
- **H-R2 (trace > prose as generator input).** For an LLM test generator, input = call + raw upstream exchange + violated property gives a higher F-gate pass rate than input = prose description of the same symptom. *Falsified if* there is no significant paired difference. This is the direct test of C19, which the literature lacks.
- **H-R3 (stated-reason gate catches what plain F->P misses).** Among candidate repros (agent baseline plus mutated templates: broken import, fixture mismatch, wrong property), the plain SWT-Bench criterion accepts a measurable share that fiks's stated-reason gate rejects. *Falsified if* both gates agree on 100% of candidates, which would make the extra check redundant.
- **H-R4 (repro + suite + traces limits overfitting).** Patches that pass fiks's P gate fail a held-out check (unseen contract variants, other manifestations of the drift, a hidden human-written test) less often than patches validated by the single repro alone. The literature reference is 21.8-35.9% [test-overfitting-swebench]. *Falsified if* the held-out failure rates are not lower.
- **H-R5 (determinism).** Replayed repros produce identical results on N≥20 reruns for every captured trace. *Falsified by* any disagreement.
- **H-R6 (repro yield on real servers).** On real MCP servers (forks), the share of violations that yield an F-passing repro is limited mainly by replay matching (`UNMATCHED_REQUEST`), not by the oracle. *Falsified if* other wrong-reason classes dominate. Report the full failure-reason histogram either way.
- **H-R7 (repro helps repair).** A repair agent given the frozen repro produces held-out-correct fixes more often than one given only the violation text (the "repair without repro" ablation in codebase-map). *Falsified if* there is no difference. Given [swe-doctor], a null result is plausible and must be reported.

## 8. Candidate baselines we can actually run

| Baseline | What it tests | License / access | How |
|---|---|---|---|
| Agent-written repro from violation text (SWE-Agent+/e-Otter-style prompt via Claude Agent SDK) | H-R1, H-R3 | our code; model via existing OAuth | Same worktree. Prompt: receipt text plus repo. Ask for a failing vitest test. Score with `failGate` and with plain F->P. |
| Agent-written repro from full trace | H-R2 | as above | Same, plus the recorded exchange JSON in the prompt |
| Snapshot/traffic test (Keploy-style; implement with nock or Polly.JS record) | shows a recorded-response oracle cannot give F->P | nock MIT, Polly Apache-2.0, Keploy Apache-2.0 | Record v2 traffic and assert deep-equal on the tool result. Expected: passes on buggy code, so the F gate fails. Keploy itself needs eBPF/Linux; nock is the cheap stand-in. |
| Plain SWT-Bench F->P criterion | H-R3 | definition only | Re-score every candidate without `classifyFailure` |
| Calibration on SWT-Bench Lite / Multi-SWT-Bench-Lite (TS subset) | shows our LLM baseline generator is not a strawman | SWT-Bench harness MIT; TDD-Bench Apache-2.0; Multi-SWT-Bench license [verify] | Run our agent-repro prompt on a small random sample (e.g. 50 Lite instances). Compare to published rates. Docker needs ~120GB, so budget it. |
| Crash-reproduction tools (EvoCrash, Botsing) | not runnable meaningfully | Java, crash oracle | Discuss only. There is no stack trace for silent failures. |

## 9. Open gaps

1. No published study compares prose vs captured-runtime-trace input for LLM reproduction-test generation on the same bugs (H-R2 would be new).
2. No published rate of "fails for the wrong reason" among LLM-generated repros. The literature gives proxies (error vs assertion; fail-on-buggy vs F->P) and LLM-critic accuracy only.
3. All issue-to-test validity needs a golden patch. Deployment-time validity without one is open; fiks's contract-named failure is one answer, and it needs measuring.
4. Reproduction of silent (non-crashing) API/tool failures is absent from the crash-reproduction literature. Its benchmarks (JCrashPack, CrashJS) are crash-only.
5. Record/replay robustness to nonces, timestamps and retries in API traffic is engineering lore, not measured. H-R6 would quantify it for MCP servers.
6. Not yet searched (budget exhausted): AssertFlip, CrashTranslator, JCrashPack EMSE paper, iFixR (Koyuncu et al.), the OpenAI SWE-bench Verified post. Also unchecked: Multi-SWT-Bench's license and whether its TS instances are runnable.

## 10. Notes for RESEARCH.md maintainers
- C17: cite TDFlow Table 2 (68.0%) and note that the paper's Sec. 1 says 69.8%.
- C18: confirmed (Journal of Software 37(4), 2026, abstract).
- C20: confirmed (SWE-Doctor abstract, arXiv 2607.00990).
- Possible new claim: "Fails-on-buggy is not validity. At Google, 85% of candidate BRTs failed on buggy code, but 28% were F->P [brt-agent-google Table 2]. Error-type failures are F->P 3.7% of the time [otter Table 6]."
