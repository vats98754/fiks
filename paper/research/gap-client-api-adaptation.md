# Client-side adaptation to upstream API evolution (research area: gap-client-api-adaptation)

Author: research swarm, area `gap-client-api-adaptation`. Date: 2026-10-21.
Companion file: `gap-client-api-adaptation.sources.json` (37 sources).
Keys reused from `bibliography.json` (same source, same key): `reyes2024bump`, `reyes2025byam`. Referenced but not re-listed: `kong2025npm`, `chen2026slr`, `jayasuriya2024bbc`, `mostafa2017bbi`, `raj2026breakguard`, `liu2024codeupdatearena`, `islah2024gitchameleon`, `wang2025codesync`. Related RESEARCH.md claims: C14–C16 (breaking changes, undocumented), C17–C20 (repro tests and partial patches), C21 (CI and merge odds), C27 (spec diff).

## 1. Scope, method and searches

**Question.** A hostile SE reviewer will say: "fiks is client-side breaking-change repair with a new trigger." This file states the strongest version of that line of work. For each system it records:
- the **trigger** (compile error, failing test, runtime signal, or a known change list);
- the **oracle** that decides a repair is correct;
- the reported **success rate**.

It then says where fiks differs, where it is weaker, and what we can run as a baseline.

**Method, and its limitation.** The swarm-wide WebSearch budget (200 calls per turn, shared) was already used up when this agent started. All six WebSearch calls I tried on 2026-10-21 returned "budget used up". No other search engine was queried. Discovery used three routes:
1. **Citation graph.** Semantic Scholar Graph API lookups by DOI or arXiv ID. These were bibliographic lookups, not keyword search. I pulled the reference lists of Byam, BUMP and Islam et al. 2025, and the citing papers of A3, Byam, BUMP, Hejderup & Gousios 2021, Fruntke & Krinke 2025, Compsuite, and Fazzini et al. 2019. Snowballing from those seed papers surfaced every 2025–2026 item in this file.
2. **Direct fetches.** I fetched arXiv abstract and HTML pages for every arXiv source.
3. **Full PDFs.** Dig & Johnson 2005 (UIUC IDEALS) and Dagenais & Robillard 2008 (McGill), downloaded and read with `pdftotext`.

ACM DL and Wiley pages returned HTTP 403, so CatchUp (2005) and the Dig & Johnson JSME 2006 journal paper could not be opened. CatchUp is confirmed to exist (S2 metadata, DOI 10.1145/1062455.1062512), and Dig & Johnson 2005 §1 describes it. Its catalog row is marked [verify].

**Bias.** Snowballing from Byam/BUMP/A3 over-samples Java/Maven and the Monperrus/Nadi/Krinke groups. It under-samples web-API client adaptation, where little LLM-era work exists (see §8, Gaps).

**Deep-read (full text or most of it):**
- Byam (`reyes2025byam`, arXiv HTML, first 100k chars)
- BUMP (`reyes2024bump`, arXiv HTML)
- BBCFixer, "Who Broke Me?" (`chen2026bbcfixer`, arXiv HTML)
- "Update from Hell" (`luo2026updatefromhell`, arXiv HTML)
- Dig & Johnson 2005 (`dig2005refactorings`, PDF)
- SemDiff, ICSE 2008 (`dagenais2008semdiff`, PDF)

**Read in substantial part:** MigrationBench, SkillGuard ("Skill Drift Is Contract Violation"), Gilesi (API interaction snapshots), and Islam et al. 2025.

## 2. Source catalog

Clusters:
- **A.** Refactoring replay and recommendation (2005–2010).
- **B.** Example- and pattern-mined API migration (2019–2024).
- **C.** Breaking dependency update repair, compile-triggered (2018–2026).
- **D.** Behavioural breaking changes: detection and repair (2017–2026).
- **E.** LLM migration and knowledge-update benchmarks.
- **F.** Dependency bots and industry practice.
- **G.** The closest agent-era analogue.

| # | Source (key) | Year | Type | Central claim | Cluster |
|---|---|---|---|---|---|
| 1 | Henkel & Diwan, CatchUp! (henkel2005catchup) [verify: full text not opened] | 2005 | paper | Records refactorings in the library IDE and replays them on client code | A |
| 2 | Dig & Johnson, The Role of Refactorings in API Evolution (dig2005refactorings) [deep-read] | 2005 | paper | Over 80% of API-breaking changes in 4 Java components are refactorings. Behavioural modifications compile but behave differently. | A |
| 3 | Dagenais & Robillard, SemDiff (dagenais2008semdiff) [deep-read] | 2008 | paper | Recommends client adaptations by mining how the framework adapted to its own changes. Relevant replacement for 89% of broken calls. | A |
| 4 | Nguyen et al., LibSync: graph-based API usage adaptation (nguyen2010libsync) [verify: metadata only] | 2010 | paper | Learns API usage adaptation patterns from already-migrated clients | A |
| 5 | Xu, Dong & Meng, Meditor (xu2019meditor) | 2019 | paper | Mines migration edits from 602,249 GitHub projects. 218 of 225 migrations applied correctly. | B |
| 6 | Lamothe, Shang & Chen, A3 (lamothe2022a3) | 2020/22 | paper | Learns Android API migration patterns from code examples. Assists in 71 of 80 cases; 29% time saved. | B |
| 7 | Fazzini, Xin & Orso, AppEvolve (fazzini2019appevolve) | 2019 | paper | Updates Android apps for API changes using other developers' update examples | B |
| 8 | Haryono et al., AndroEvolve (haryono2020androevolve) | 2020 | paper | Data flow plus denormalisation: 26.90% more correct updates than CocciEvolve on 360 files | B |
| 9 | Zhang et al., PCART (zhang2024pcart) | 2024 | paper | Python API parameter compatibility: detection F1 96.51%, repair precision 91.97% | B |
| 10 | Mahmud et al., GUPPY (mahmud2024guppy) | 2024 | paper | GPT-4 updates deprecated Android API usages, generates tests, iterates until the tests pass | B/E |
| 11 | Lamothe, Guéhéneuc & Shang, SLR of API evolution (lamothe2021apievolutionslr) | 2021 | paper | Open challenges: drivers of API change, uniform benchmarks, impact on users | A–D |
| 12 | Brito et al., Why and How Java Developers Break APIs (brito2018whybreak) | 2018 | paper | Field study of 400 libraries: 59 breaking changes confirmed by developers of 19 projects; motivations are features, simplification, maintainability | D (motivation) |
| 13 | Reyes et al., BUMP (reyes2024bump) [deep-read] | 2024 | paper | 571 reproducible breaking dependency updates (153 Maven projects): 243 compile, 188 test failure, 60 assertion | C |
| 14 | Reyes, Baudry & Monperrus, Breaking-Good (reyes2024breakinggood) | 2024 | paper | Explains root causes for 70% of 243 breaking updates | C |
| 15 | Reyes et al., Byam (reyes2025byam) [deep-read] | 2025 | paper | Compile-error-triggered LLM repair. Best model fully repairs 27% of 103 builds and 78% of errors. | C |
| 16 | Fruntke & Krinke, Automatically Fixing Dependency Breaking Changes (fruntke2025depbreak) | 2025 | paper | Agentic repair on BUMP up to 23%; zero-shot up to 19% (test-suite success) | C |
| 17 | Zhou et al., Librarian (zhou2026librarian) | 2026 | paper | Library-knowledge fix hints plus compile feedback: 84.2% fix rate | C |
| 18 | Reyes, Baudry & Monperrus, BigBag (reyes2026bigbag) | 2026 | paper | Agent-generated AST transformations: 78.6% fix rate on 157 compile-failure BUMP cases; 33.3% cross-project transfer | C |
| 19 | Yang et al., DepRepair / DepBench-95 (yang2026deprepair) | 2026 | paper | Structured upstream evidence: 89.5% (GPT-5.5) on 95 cases in 4 ecosystems. Raw evidence costs 7–23 pp. | C |
| 20 | Xia et al., Break to Adapt / BDUpdater (xia2026bdupdater) | 2026 | paper | JavaScript has no compile oracle; mined breaking-change records reach 90.5% on 84 clients | C/D |
| 21 | Mecheo, Mahmoud & Nadi, DependaFix (mecheo2026dependafix) | 2026 | paper | GitHub App: detects a failing dependency-update PR, runs Byam, opens a repair PR | C/F |
| 22 | Chen et al., DeBBI (chen2020debbi) | 2020 | paper | Library regression tests miss BBIs; cross-project testing exposes them | D |
| 23 | Hejderup & Gousios, Can We Trust Tests to Automate Dependency Updates? (hejderup2021trusttests) | 2021 | paper | Tests cover 58% of direct dependency calls and detect 47% of direct and 35% of transitive injected faults | D |
| 24 | Mujahid et al., Using Others' Tests (mujahid2020otherstests) | 2020 | paper | Crowd client test suites detect breakage-inducing npm versions | D |
| 25 | Xu, Zhu & Li, Compsuite (xu2023compsuite) | 2023 | paper | 123 Java client-library incompatibilities, each with a developer test that reproduces it | D |
| 26 | Monce et al., Gilesi API interaction snapshots (monce2025gilesi) | 2025 | paper | Records client↔library interactions and diffs the snapshots. Kills ~96% of extreme mutants vs ~89% for tests. Detection only. | D |
| 27 | Chen et al., BBCFixer, "Who Broke Me?" (chen2026bbcfixer) [deep-read] | 2026 | paper | First execution-guided repair of *behavioural* breaks (100 Python/JS cases). Pass rate 58.0 vs 49.7 (pure agent). | D |
| 28 | Luo et al., "Update from Hell" / DepBench-203 (luo2026updatefromhell) [deep-read] | 2026 | paper | 203 bot-PR upgrade tasks with hidden tests. Best agent 104/203. In 61.8% of failures the visible tests pass. | D/E |
| 29 | Liu et al., MigrationBench (liu2025migrationbench) | 2025 | paper | Java 8→17 at repo level: 71.67% minimal pass@1 (Claude-4.5-Sonnet); a compile-only oracle inflates this to 97.67% | E |
| 30 | Islam et al., Python library migration with LLMs (islam2025pythonllmmigration) | 2025 | paper | 94% of code changes correct (GPT-4o), but only 16 of 25 migrations pass the developers' tests | E |
| 31 | Kang et al., Pig (kang2026pig) | 2026 | paper | API-level slicing for LLM Python migration: +53.5% success over the baseline across 7 LLMs | E |
| 32 | Ziftci et al., Migrating Code at Scale with LLMs at Google (ziftci2025googlemigration) | 2025 | paper | Industrial LLM migration with human review [verify: results section not read] | E/F |
| 33 | Misra et al., GitChameleon 2.0 (misra2025gitchameleon2) | 2025 | paper | 328 version-conditioned Python problems with executable tests | E |
| 34 | He et al., Dependabot in practice (he2023dependabot) | 2022/23 | paper | Compatibility scores too scarce to reduce update suspicion; 11.3% of projects abandoned Dependabot | F |
| 35 | Rombaut, Côgo & Hassan, Dependabot compatibility score (rombaut2024compatscore) | 2024 | paper | No score can be computed for 83% of updates (579,206 PRs) | F |
| 36 | Pasiunaite et al., VulnBump (pasiunaite2026vulnbump) | 2026 | paper | 307 upgrade tasks: an upgrade passes only if fix, build and tests all hold. Agents range 59.6–90.2%. | C/F |
| 37 | Fan et al., Skill Drift Is Contract Violation / SkillGuard (fan2026skilldrift) | 2026 | paper | Agent skills drift when services change. Contracts give 0/599 false alarms; localisation lifts one-round repair from 10% to 78%. | G |

Existing bibliography entries in the same space: `kong2025npm` (68.1% of npm breaking changes are behavioural), `chen2026slr` (behavioural breaks evade static detection), `jayasuriya2024bbc` (2.30% of updates break client tests behaviourally), `mostafa2017bbi`, `raj2026breakguard` (LLM tests detect 27 of 89 BUMP breaks, weakest on behavioural ones), and the knowledge-update benchmarks `liu2024codeupdatearena`, `islah2024gitchameleon`, `wang2025codesync`.

## 3. Lineage and trigger/oracle matrix

**The lineage in one chain.**
1. CatchUp (2005) replays recorded refactorings.
2. Dig & Johnson (2005) justify replay: over 80% of breaks are refactorings.
3. SemDiff (2008) and LibSync (2010) go beyond refactorings by mining the framework's or other clients' own adaptations.
4. Meditor, A3, AppEvolve and AndroEvolve (2019–2021) mine edit patterns from examples.
5. BUMP (2024) supplies a reproducible benchmark.
6. Byam, Fruntke & Krinke (2025) and then Librarian, BigBag, DepRepair and BDUpdater (2026) bring in LLMs.
7. DependaFix (2026) closes the bot loop to a PR.
8. BBCFixer and "Update from Hell" (2026) are the first to target **behavioural** (interface-preserving) breaks.

Every step before item 8 assumes a *signature* change that the client's compiler, linker or a known change list exposes.

| System | Trigger | Upstream knowledge used | Oracle | Reported success |
|---|---|---|---|---|
| CatchUp / SemDiff / LibSync | Known refactoring log; calls to removed methods | Library refactoring trace or library history | Manual relevance | SemDiff: relevant for 89% of broken calls |
| Meditor / A3 / AndroEvolve / PCART | Known migration or deprecation list | Mined client edits; code examples; API mapping | Manual inspection; generated tests (PCART) | 218/225; 71/80; +26.90% vs CocciEvolve; 91.97% repair precision |
| Byam | **Compile error** after a dependency bump | API diff, build log | `mvn test` build success | 27% builds, 78% errors (o3-mini, n=103) |
| Fruntke & Krinke | Compile/test failure on BUMP | Build output | Test-suite success | Up to 23% (agentic) |
| Librarian / BigBag | Compile error | Library code hints; AST rule synthesis | Compiles (+ tests) | 84.2%; 78.6% |
| DepRepair | Dependency update instance | Structured release notes and API diff | Consumer's own tests in Docker | 89.5% (GPT-5.5) |
| BDUpdater (JS) | Known breaking dependency update | Mined breaking-change records | Semantic equivalence to the developer fix | 90.5% |
| DependaFix | **Failing CI on a Dependabot-style PR** | Byam | Build; opens a PR if the fix succeeds | Demonstration only |
| BBCFixer | **Failing client test** after the upgrade | Differential execution old vs new library | Reference-fix tests + full suite ("upper bound") | 58.0 vs 49.7 pure agent (qwen3-coder) |
| Update from Hell agents | Upgrade instruction | None given | **Hidden** post-upgrade tests | Best 104/203 (51.2%) |
| SkillGuard | Contract extraction, then known-drift or live check | Registries, URL responses | Literal verifier (new value present, old absent) | Repair 10% → 78% with localisation |
| **fiks** | **Runtime contract violation on live MCP traffic** (no compile error, no failing test, no version bump) | Raw upstream HTTP in the trace; violated property; *no* release notes or spec change | F→P repro + full contract suite + all stored traces + typecheck/lint + green CI | 5/5 seeded drifts, 1 attempt each (bench) |

## 4. Contradictions and why they disagree

1. **How much breakage is behavioural?**
   - BUMP finds that runtime breakages are "more rarely due to subtle behavior changes captured by a test assertion": 60 of 571.
   - `kong2025npm` finds 68.1% of documented npm breaking changes are behavioural.
   - Dig & Johnson find over 80% of breaks are refactorings.
   - *Why they disagree.* The sampling frame differs. BUMP keeps only updates that visibly fail a Java build. Kong counts documented changes whether or not any client notices. Dig & Johnson studied structural API diffs of four Java components in 2005. A compile-gated corpus cannot contain the silent class by construction. So BUMP's low behavioural share is a selection effect, not a prevalence estimate.
2. **Repair success: 23–27% vs 78–90%.**
   - Byam reports 27% and Fruntke & Krinke 23%.
   - Librarian, BigBag, DepRepair and BDUpdater report 84.2%, 78.6%, 89.5% and 90.5%.
   - *Why they disagree:*
     - **Subsets.** BigBag uses only the 157 compile-failure cases; Byam filters BUMP to 103.
     - **Oracles.** Compiles, tests pass, and semantic equivalence are different bars.
     - **Model generation.** o3-mini vs GPT-5.5.
     - **Evidence.** The high scorers are given structured upstream evidence; DepRepair shows raw evidence costs 7–23 pp.
   - These numbers are not comparable across papers.
3. **Are existing tests a good oracle?**
   - MigrationBench and DepRepair use the project's own tests as the oracle.
   - Hejderup & Gousios: tests detect only 47% of injected faults in direct dependencies.
   - "Update from Hell": 61.8% of agent failures pass the visible tests.
   - MigrationBench itself: the compile-only check inflates success from 71.67% to 97.67%, and uncovered lines are "equivalent to compile only".
   - Gilesi: tests kill about 89% of mutants.
   - *Why they disagree.* Gilesi used "extreme" mutants, which are easy to kill; Hejderup used simple injected faults across all call sites. The direction agrees across all of them: visible tests under-detect behavioural change.
4. **Is localisation or knowledge the bottleneck?**
   - Knowledge: DepRepair and BDUpdater (release notes, change records).
   - Localisation: BBCFixer (differential execution) and SkillGuard (failed contract).
   - Both lines report large gains from the evidence they add. They have not been compared head to head.
   - For fiks the provider publishes no evidence (the spec is unchanged), so only the localisation route is open.

## 5. Claim ledger for deep-read sources

**Byam (`reyes2025byam`, arXiv 2505.07522 v3; S2 lists EMSE 2026 [verify venue])**
- Scope: "We focus on breaking dependency updates that lead to compilation errors." (§1)
- Oracle: build success under `mvn test`. A fully repaired build means compilation and test execution both succeed (§3.4, §5.1).
- Dataset: 103 of BUMP's 571. It excludes 78 Java-version failures, 8 Werror failures, and classpath conflicts (§4.2).
- Results: o3-mini (P8) repairs 28/103 builds (27%) and 741/955 errors (78%) (Tables 4, 6). The paper's own text is inconsistent: 27 vs 28, and 78% vs 79%.
- Partial repair example: "the updates by the LLM fix the compilation failure, but result in a test failure" (§6.2).
- No overfitting analysis, no human review of patches, no PRs (§6.5 suggests integration into bots).
- Behavioural changes are left to future work; they "often only become apparent at runtime" (§8).

**BUMP (`reyes2024bump`, SANER 2024)**
- A breaking update is a pre-commit with a passing build and a breaking commit with a failing build, where one dependency version changes (Def. 2–3).
- Failure types: compilation 243, test failure 188, enforcer 121, lock 14, resolution 5 (Table II). Test failures include 60 assertion failures (Table V).
- Docker image pairs with networking disabled, for long-term reproducibility.
- Repo: github.com/chains-project/bump. License not stated in the paper [verify].

**BBCFixer (`chen2026bbcfixer`, arXiv 2610.09267, 7 Oct 2026)**
- Definition: "the interface remains intact, but the run-time behavior changes" (§1). The break "appears as a failing test".
- Localisation: run the failing test under the old and new library; rank the library calls whose return values diverge; take the "first divergence" as the root API; filter the library diff by it (§3.1).
- Oracle: apply the reference fix's test edits; build plus the full post-upgrade suite. The authors call it "an upper bound on repair correctness" (§3.2.3, §6).
- BBCBench: 41 Python and 59 JS cases (Table 1). The authors note that BUMP and Compsuite lack behavioural labels.
- Results: 58.0 vs BDUpdater 38.0 vs Pure Agent 49.7 (qwen3-coder); 67.3 / 61.7 / 60.0 (GLM-4.5-Air) (Table 4). Successful repairs take 27% fewer steps.
- No PRs. No overfitting study. Some reference fixes may be in training data.
- Repo: github.com/Elendil3703/BBCFixer. License not stated [verify].

**"Update from Hell" (`luo2026updatefromhell`, arXiv 2608.30300, 31 Aug 2026)**
- Implicit breakage: "internal semantics change so downstream code still compiles yet misbehaves" (§II).
- Construction: 203 tasks mined from merged Dependabot and Renovate PRs (npm 68, Maven 65, Go 40, Cargo 20, Python 10). A four-state causality oracle with held-out tests (Def. 1).
- Best result 104/203 (GPT-5.5 + Codex). The harness spread is large with the same model (Table II).
- In 322 of 521 non-passes (61.8%), visible tests passed but hidden tests failed. Agents "satisfy the old visible test surface but miss the dependency-upgrade behavior" (§IV-E).
- Conclusion: benchmarks need "post-upgrade tests rather than visible-test success alone".
- No dataset URL is given in the paper [verify release].

**Dig & Johnson 2005 (`dig2005refactorings`, ICSM 2005)**
- "Over 80% of these changes are refactorings." (Abstract). Based on Eclipse, Mortgage, Struts and log4j (Table 1: 51, 11, 136 and 38 breaking changes).
- Behavioural definition: the application "might compile fine but behave differently at run time" (§2). §3.4 "Behavioral Modifications" covers changes that compile but break assumptions.
- Introduces CatchUp as refactoring-replay tool support (§1).

**SemDiff (`dagenais2008semdiff`, ICSE 2008)**
- Input: "calls to methods that no longer exist in a framework" (§1). The trigger is a broken call, a compile-level signal.
- Recommends replacements from the framework's own adaptations: "a relevant functionality replacement for 89% of the broken methods" (§1, §4). Eclipse JDT, 3 clients.
- Also cites Dig & Johnson: application developers carry "only a small fraction [less than 20%]" of changes that need human expertise.

## 6. What this means for fiks

**Where fiks differs.** These are the four things a reviewer should accept as genuinely new axes.
1. **Trigger.** Every repair system above starts from a compile error (Byam, Librarian, BigBag), a failing CI on a version-bump PR (DependaFix), a failing client test (BBCFixer), a known change list (A3, Meditor, PCART), or an upgrade instruction ("Update from Hell"). In fiks's setting none of these exists:
   - The provider changes server-side, so there is no version bump and no dependency PR.
   - The wrapper compiles unchanged (D1–D5 keep types: `price: number` still holds cents).
   - shop-mcp's own tests replay recorded **v1** fixtures (`test/fixtures/v1`, codebase-map), so they stay green.

   fiks's trigger is a **contract violation in live traffic**. The closest prior trigger is SkillGuard's live contract check, but SkillGuard maintains skill documents, not the tool's code, and opens no PRs.
2. **No upstream evidence.** The best 2026 results come from giving the model structured upstream knowledge: release notes and API diffs (DepRepair), change records (BDUpdater), library hints (Librarian). In D1–D5 the OpenAPI spec is byte-identical and there are no notes [C27]. fiks substitutes **observed evidence**: the raw upstream HTTP and the violated property. That is the role BBCFixer's "first divergence" plays, but obtained from production traffic rather than by re-running a test under two library versions. A remote web API has no "old version" to re-execute once the vendor has switched.
3. **Oracle.** BBCFixer's oracle is the developer's reference tests, which the authors call an "upper bound". "Update from Hell" shows visible tests mislead in 61.8% of failures. fiks *creates* the oracle: an F→P repro asserting the violated property, plus all stored traces and the full contract suite [C19, C20]. That is a stronger claim and also a riskier one, because the contract can be wrong.
4. **Consumer.** The client's consumer is an LLM agent that does not crash on bad data; it fabricates [C9]. Silent wrong data is the failure, not a red test.

**Where fiks is weaker.**
- **Scale and realism.** fiks has 5 seeded drifts in 1 server, written by the authors. BBCFixer has 100 real cases, "Update from Hell" 203 mined from real PRs, BUMP 571. A 5/5 one-attempt repair rate on seeded drifts is not comparable to 51% on DepBench-203, and must not be presented as if it were.
- **Contracts are hand-written.** BBCFixer and Gilesi need no contract: they diff behaviour. A reviewer will say contract authoring moves the hard part to the user [C11].
- **No head-to-head on a shared substrate.** We have no shared benchmark yet.
- **Same model family** for the agent and the repairer.

**The strongest counter-arguments.**
- (a) "BBCFixer already does execution-guided repair of interface-preserving breaks, and Gilesi already turns recorded API interactions into an oracle. fiks = Gilesi-style recording + BBCFixer-style repair + DependaFix-style PR. The novelty is the trigger and the MCP setting only."
- (b) "A nightly live-integration test plus Dependabot-cadence CI would catch D1–D5 too."

**Our answer has to be empirical:**
- (i) Show which pipelines fire on D1–D5 and on real cases (H-CA1, H-CA2).
- (ii) Show that the violated property and trace improve repair over a failure-message-only agent (H-CA3).
- (iii) Show the F→P plus stored-trace gate reduces hidden-test failures (H-CA4).
- (iv) Run fiks's repair stage on an external behavioural substrate (H-CA5).

**Implication for H2 ("spec/compile-driven pipelines never fire").** State H2 with three explicit preconditions:
1. no dependency bump in the wrapper repo;
2. tests run against recorded fixtures;
3. the drift does not change types.

Under those conditions it holds by construction. It must not be stated as a discovery. Add a **scheduled live-integration-test arm**: the strongest non-fiks trigger, which Dependabot or Renovate-style CI could run. That arm *can* fire, for example when D2's null price makes a live assertion fail. Report per drift whether it fires and whether its failure message names the cause.

**Implication for Contribution 3 ("repairs the tool's own repo").** Prior work also patches the client's own repo: Byam, BBCFixer and DependaFix all do. The new part is *what starts it and what it is checked against*, not *where the patch lands*. Reword accordingly. DependaFix (FSE Companion 2026) already opens repair PRs from a GitHub App. fiks differs in when CI runs: on the exact commit, *before* the PR opens [C21], and with a property-specific repro.

## 7. Candidate hypotheses (each with its falsifier)

- **H-CA1 (trigger coverage, construction).** On D1–D5, compile/type-error, dependency-bump-PR and spec-diff triggers fire on 0/5. fiks fires on 5/5.
  - *Falsified if* `tsc` or lint errors, or any dependency-PR CI failure, arise from switching the vendor to v2.
  - Report as a construction property, not a finding.
- **H-CA2 (existing and live tests).** shop-mcp's fixture-based suite stays green on v2 for all drifts. A scheduled live-integration suite fails on at most k of 5, and none of its failure messages names the violated property (unit, field, write loss, page count, epoch).
  - *Falsified if* the live suite fails on all 5 with a message that localises the cause as precisely as the fiks receipt.
- **H-CA3 (evidence helps repair).** With the same model and budget, repair given {violated property + trace + F→P test} succeeds more often and in fewer steps than a "pure agent" given only the drift symptom (a failing live test or a user complaint). This is consistent with DepRepair (+7–23 pp from structured evidence), SkillGuard (10%→78%) and BBCFixer (+17% relative).
  - *Falsified if* a paired comparison over drifts × seeds shows no significant difference (McNemar or exact test, pre-registered).
- **H-CA4 (gate prevents partial patches).** Patches accepted by the full fiks gate fail held-out hidden contract tests less often than patches accepted by "repro passes" alone or by "visible tests pass". The test reuses the "Update from Hell" design: hidden post-drift tests the repair agent never sees.
  - *Falsified if* hidden-test failure rates do not differ.
- **H-CA5 (external substrate).** fiks's repair stage runs on BBCBench's JavaScript cases: the failing test as the repro, plus a differential trace captured fiks-style from old and new library runs. Its pass rate is within the 95% CI of BBCFixer under the same backbone.
  - *Falsified if* it is significantly lower. That would show fiks's repair adds nothing beyond its trigger.
- **H-CA6 (contracts vs snapshot diff).** A Gilesi-style snapshot diff of shop-mcp↔vendor interactions (v1 recorded vs v2 live) flags all of D1–D5, but its false-positive rate on *benign* provider changes is higher than fiks contracts. Benign examples: added fields, reordered keys, new optional values.
  - *Falsified if* the snapshot diff's FP rate ≤ the contract FP rate at equal recall. In that case contracts are unnecessary for detection.

## 8. Candidate baselines we could actually run

| Baseline | What it is | How to run it | License / status |
|---|---|---|---|
| B-dep-trigger (DependaFix/Byam-style) | Repair fires only on a failing CI after a dependency bump or a compile error | Instrument shop-mcp CI; switch the vendor to v2; count triggers. No LLM is needed if it never fires. | Construction; no external code needed |
| B-live-tests | Nightly integration tests of shop-mcp against the live vendor | Write a v1-era live test suite (author it blind to D1–D5); run it on v2 | Ours |
| B-pure-agent (BBCFixer's "Pure Agent", mini-swe-agent) | Repair given only the failing symptom | Same repair harness with the fiks evidence stripped; or mini-swe-agent directly | mini-swe-agent is MIT [verify] |
| B-BBCFixer | Differential-execution localisation, then repair | Adapt its recorder to the shop-mcp vendor client (record vendor-call return values under v1 fixtures vs v2 live); or run it as-is on BBCBench JS | github.com/Elendil3703/BBCFixer; license not stated [verify]: ask before reuse |
| B-snapshot-diff (Gilesi-style) | Record client↔API interactions, flag any diff | Re-implement in TS over fiks's existing upstream HTTP tap (`bench/results/*/proxy/*.jsonl` already holds raw HTTP) | Gilesi is Java (github.com/alien-tools/gilesi), license not stated [verify]; re-implementation avoids the issue |
| External substrate: BBCBench (100 Python/JS behavioural cases) | Real behavioural breaks with reference tests | Run the fiks repair stage plus the gate on the 59 JS cases | As above |
| External substrate: BUMP (188 test-failure cases, 60 assertion) | Java behavioural subset | Docker images per case; the fiks repair stage needs a Java gate | Repo license [verify]; Java tooling cost is high |
| External substrate: Compsuite (123 Java cases with developer tests) | Behavioural incompatibilities with repro tests | Via its CLI | [verify license] |
| DepBench-203 ("Update from Hell") | Hidden-test upgrade tasks, 5 ecosystems | Not released per the paper [verify] | Unavailable now |

## 9. Open gaps

1. **No paper adapts a client to a behavioural change in a *remote web API* (as opposed to a library), triggered from production traffic.** Everything above runs the library locally under two versions, or assumes a version bump. This is the cleanest gap statement we can make. It is "we did not find one" under a citation-graph search, not proof of absence; the WebSearch budget was exhausted.
2. **Name collision.** Two different 2026 benchmarks are both called "DepBench": DepRepair's 95 instances and "Update from Hell"'s 203 tasks. Cite them with their authors to avoid confusion.
3. **No overfitting study** in the dependency-repair line (Byam, BBCFixer). "Update from Hell" is the only one with hidden tests. fiks's stored-trace gate could be positioned against that.
4. **CatchUp, LibSync, AppEvolve and Ziftci et al.** could not be opened in full (ACM 403). Their rows rest on metadata, the abstract, or a secondary description [verify].
5. **Licenses** of BUMP, BBCFixer, Gilesi and Compsuite are not stated in the papers; check each repo LICENSE before any reuse.
6. **A web-API-specific migration line remains to be collected:** Li et al. 2013 is in api-contracts; Espinha et al. JSS 2015 and Wittern et al. are not catalogued. A follow-up search round should add the REST-client side once the search budget allows.
