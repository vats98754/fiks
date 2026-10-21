# Benchmarks for evaluating fiks: research notes

Area: benchmarks. Written 2026-10-21 by one researcher agent of the Phase 1 discovery swarm. Machine-readable sources are in `benchmarks.sources.json` (45 entries; keys are used in brackets below). Existing claim IDs are reused where the source is the same (C7, C8, C9, C11). Anything I could not re-check is marked [verify].

## 1. Scope and searches run

**Question.** Which public benchmarks could fiks be run on or adapted to? Which are comparable with published numbers, and which test what fiks claims: silent tool-side faults caught at runtime, a valid reproduction, a gated repair, and durable recovery measured by pass^k?

**Sub-questions.**
1. Agent reliability benchmarks with pass^k: τ-bench, τ²/τ³-bench.
2. MCP benchmarks: MCP-Bench, MCP-Universe, MCPMark, LiveMCPBench, MCPToolBench++, MCP-Atlas, LiveMCP-101, Toolathlon, MCP-RADAR, MCPVerse.
3. Noisy or faulty tool robustness, and tool hallucination: RoTBench, CRITICTOOL, FAIL-TALMS, ToolBeHonest, RelyToolBench, AgentDojo, ToolEmu, StableToolBench, and the silent-fault injection studies C7, C8, C9 and C11.
4. API drift and library evolution, plus their repair: ToolEVO/ToolQA-D, CodeUpdateArena, GitChameleon, VersiCode, CodeSync, BUMP, Byam.
5. Reproduction-test and repair protocols: SWE-bench, SWT-bench, TDD-Bench Verified.
6. Critiques of benchmark validity: ABC checklist, HAL, and the τ-bench task audits.

**Method and a limitation.** `WebSearch` was unavailable for this agent. The shared per-turn search budget (200 calls) was already used up by the swarm when I started, so **0 search queries ran**. Discovery therefore relied on sources I could name from prior knowledge. I verified each one by fetching its arXiv abstract page, project site or repository directly. I made about 45 `WebFetch` calls on 2026-10-21. Every source in the catalog was opened on that date. I deep-read full text, via the arXiv HTML version, for τ-bench, τ²-bench, MCPMark, MCP-Universe, MCP-Bench and Outcome Monitors [C11].

Consequence: there may be 2026 MCP or fault-injection benchmarks I do not know about. Any benchmark that names silent tool faults or API drift and appeared after mid-2026 could be missing. This gap is listed in §9 and should be closed by a follow-up search round. Quotes came from a fetch summarizer and are ≤25 words; the citation verifiers should re-check each one against the original.

## 2. Source catalog

| # | Source (key) | Year | Type | Central claim | Cluster |
|---|---|---|---|---|---|
| 1 | τ-bench [yao2024taubench] | 2024 | paper | DB-state grading; introduces pass^k; gpt-4o pass^8 < 25% in retail | A reliability |
| 2 | tau-bench repo [taubench-v1-repo] | 2024 | repo | MIT; tasks unmaintained, superseded by τ²/τ³ | A |
| 3 | τ²-bench [barres2025tau2] | 2025 | paper | Dual-control telecom; state/assertion reward; about $40 per trial across all domains with gpt-4.1 | A |
| 4 | tau2-bench repo [tau2-repo] | 2026 | repo | MIT; custom agents; frozen pinned task sets; τ³ fixes | A |
| 5 | taubench.com [taubench-site] | 2026 | docs | τ³ (banking knowledge, voice); Feb 2026 audit fixed >50 tasks | A |
| 6 | ABC checklist [zhu2025abc] | 2025 | paper | Benchmark flaws inflate scores; τ-bench counted empty responses as success | F critiques |
| 7 | HAL [kapoor2025hal] | 2025 | paper | Standardized harness and log inspection for reliable agent evaluation | F |
| 8 | MCP-Bench [wang2025mcpbench] | 2025 | paper+repo | 28 live servers, 250 tools, 104 tasks; o4-mini judge; Apache-2.0 | B MCP |
| 9 | MCP-Universe [luo2025mcpuniverse] | 2025 | paper+repo | 231 tasks, 11 real servers; 57% dynamic real-time evaluators; GPT-5 43.7% | B |
| 10 | MCPMark [wu2025mcpmark] | 2025 | paper | 127 CRUD tasks; verify.py state checks; pass^4; implicit failures are the majority | B |
| 11 | mcpmark repo [mcpmark-repo] | 2025 | repo | Apache-2.0; isolated environments; local Filesystem/Postgres/Playwright | B |
| 12 | LiveMCPBench [mo2025livemcpbench] | 2025 | paper+repo | 70 servers / 527 tools in Docker; LLM judge; Apache-2.0 | B |
| 13 | MCPToolBench++ [fan2025mcptoolbenchpp] | 2025 | paper+repo | 4k+ servers; AST/pass@k; real-tool success varies; MIT | B |
| 14 | MCP-Atlas [bandi2026mcpatlas] | 2026 | paper | 1,000 tasks, 36 servers; claim rubric; 63.3% of failures cognitive | B |
| 15 | MCP-Atlas HF [mcpatlas-hf] | 2026 | dataset | 500-task public split, CC-BY-4.0 | B |
| 16 | LiveMCP-101 [yin2025livemcp101] | 2025 | paper | Parallel reference agent for time-varying outputs; < 60% success | B |
| 17 | Toolathlon [li2025toolathlon] | 2025 | paper | 32 apps, 604 tools, script-verified; best model 38.6% | B |
| 18 | MCP-RADAR [gao2025mcpradar] | 2025 | paper | 507 tasks; objective multi-dimensional metrics | B |
| 19 | MCPVerse [lei2025mcpverse] | 2025 | paper | 550+ live tools; scale hurts most models | B |
| 20 | ToolEmu [ruan2023toolemu] | 2023 | paper | LM-emulated tools for risk testing | C faulty tools |
| 21 | AgentDojo [debenedetti2024agentdojo] | 2024 | paper+repo | Injected content in tool outputs; MIT; extensible | C |
| 22 | ToolBeHonest [zhang2024toolbehonest] | 2024 | paper | Tool hallucination; unsolvable-task detection is weak | C |
| 23 | RoTBench [ye2024rotbench] | 2024 | paper | Noise in tool documentation and parameters degrades tool use | C |
| 24 | CRITICTOOL [huang2025critictool] | 2025 | paper | Self-critique on tool-calling errors | C |
| 25 | FAIL-TALMS [trevino2025failtalms] | 2025 | paper | Broken tools are not rescued by human help | C |
| 26 | RelyToolBench [xu2024relytoolbench] | 2024 | paper | Tool hallucination; defer or clarify reduces it | C |
| 27 | StableToolBench [guo2024stabletoolbench] | 2024 | paper | Cache and virtual API server for stable evaluation | C / record-replay |
| 28 | AppWorld [trivedi2024appworld] | 2024 | paper | 457 APIs, 750 tasks, state-based unit tests | A/C substrate |
| 29 | ToolSandbox [lu2024toolsandbox] | 2024 | paper | Stateful tools, implicit dependencies | A/C |
| 30 | BFCL V4 [bfcl-v4] | 2026 | docs | Call-accuracy (AST) leaderboard; scores calls, not results | B (call side) |
| 31 | ToolEVO / ToolQA-D [chen2024toolevo] | 2024 | paper | Agent adapts to evolving tools via MCTS; tool-variability benchmark | D drift |
| 32 | CodeUpdateArena [liu2024codeupdatearena] | 2024 | paper | Synthetic API updates; knowledge editing is hard | D |
| 33 | GitChameleon [islah2024gitchameleon] | 2024 | paper | Version-specific execution-tested completion | D |
| 34 | VersiCode [wu2024versicode] | 2024 | paper | Version-aware completion and migration | D |
| 35 | CodeSync [wang2025codesync] | 2025 | paper | LLMs lag API evolution even after DPO/ORPO/SimPO | D |
| 36 | BUMP [reyes2024bump] | 2024 | paper | 571 reproducible breaking dependency updates (Java) | D/E repair |
| 37 | Byam [reyes2025byam] | 2025 | paper | LLMs fully repair 27% of BUMP builds, 78% of individual errors | E |
| 38 | ToolFuzz [milev2025toolfuzz] | 2025 | paper | Fuzzing finds tool-documentation flaws offline | C/E |
| 39 | SWE-bench [jimenez2023swebench] | 2023 | paper | Fail-to-pass issue resolution | E |
| 40 | SWT-bench [mundler2024swtbench] | 2024 | paper | Issue to reproducing test; tests filter fixes | E |
| 41 | TDD-Bench Verified [ahmed2024tddbench] | 2024 | paper | Test-first reproduction from issue text | E |
| 42 | Outcome Monitors [panthi2026outcomemonitors] = C11 | 2026 | paper | Receipts: ToolMaze 10.9→28.1%; τ-retail +14.0/+12.0 pp under injected faults | C (closest prior) |
| 43 | False success [advani2026falsesuccess] = C7 | 2026 | paper | False success 45–48% of τ² single-control failures; judges AUROC ≤ 0.65 | A/C |
| 44 | Deterministic gates [reddy2026gates] = C8 | 2026 | paper | τ² airline 29.6→42.0% with read-only gates | A/C |
| 45 | Scapegoats audit [singh2026scapegoats] = C9 | 2026 | paper | Silent-fault stubs; 56.6% fabrication | C |

## 3. Clusters

**A. Reliability benchmarks with state-based grading** (τ, τ², τ³, AppWorld, ToolSandbox).
- Tools are deterministic code over a database. τ-bench says the transition "is deterministic and implemented as a Python function" (§3). Success is judged on the final state, and pass^k is native.
- This is where silent-failure research already happens: C7, C8 and C11 all report on τ-bench or τ²-bench.
- None of these benchmarks are MCP-native, and none inject tool faults by default.

**B. MCP benchmarks over real servers** (MCP-Bench, MCP-Universe, MCPMark, LiveMCPBench, MCPToolBench++, MCP-Atlas, LiveMCP-101, Toolathlon, MCP-RADAR, MCPVerse).
- All of them assume the servers are correct and measure the agent.
- Grading splits three ways:
  - State-verified: MCPMark, Toolathlon.
  - Dynamic real-time ground truth: MCP-Universe, LiveMCP-101.
  - LLM judge or claim rubric: MCP-Bench, LiveMCPBench, MCP-Atlas.
- None injects silent server faults. None measures whether tool outputs are correct.

**C. Faulty or noisy tools and hallucination** (RoTBench, CRITICTOOL, FAIL-TALMS, ToolBH, RelyToolBench, AgentDojo, ToolEmu, C9, C11).
- Most perturb the *call side*: tool docs, names and parameters (RoTBench), or explicit errors and unavailable tools (CRITICTOOL, FAIL-TALMS).
- Some inject adversarial content (AgentDojo).
- Only C9 and C11 inject *silent, well-formed wrong results*, which is fiks's threat model.
- Every one of them evaluates the agent's response, never a fix to the tool.

**D. Library or API evolution** (ToolEVO/ToolQA-D, CodeUpdateArena, GitChameleon, VersiCode, CodeSync, BUMP).
- Most measure a model's *knowledge* of a version (static), not runtime behavior.
- ToolQA-D is the only one aimed at agents facing changed tools. Its fix is agent-side adaptation, not repair.

**E. Repair and reproduction protocols** (SWE-bench, SWT-bench, TDD-Bench, BUMP/Byam, ToolFuzz).
- These supply the fail-to-pass vocabulary and comparison points for fiks's F and P gates.
- Inputs are issue text or compile errors, never a captured runtime trace.

**F. Critiques** (ABC, HAL, τ-bench audits). Benchmark labels and reward functions themselves have bugs, so reported numbers are not stable across versions.

## 4. Contradictions and why they disagree

1. **"Agent failures are cognitive" vs "tools fail silently".**
   - MCP-Atlas attributes 63.3% of diagnosed failures to cognition rather than tool calls [bandi2026mcpatlas].
   - MCPMark finds most failures are implicit, meaning the agent finished but the state was wrong [wu2025mcpmark].
   - C3/C4 and C9 report that servers return well-formed wrong data.
   - *Why they disagree:* the MCP benchmarks curate servers and treat tool output as ground truth, so a tool-side silent fault in them is counted as an agent error or is invisible. Their attributions measure agent skill *given correct tools*. They do not measure how common tool faults are. Neither side refutes the other, but a reviewer may cite MCP-Atlas to argue that tool faults are a minor share.
2. **Same model, very different scores.** Claude-Sonnet-4 scores:
   - 78.95% on LiveMCPBench (LLM judge),
   - 29.44% on MCP-Universe (rule and dynamic evaluators),
   - 28.15% pass@1 on MCPMark (verify scripts).

   Task difficulty and the grading regime dominate. Cross-benchmark numbers are not comparable, so fiks must report *within-benchmark paired deltas*, not absolute levels.
3. **Stability vs realism.**
   - StableToolBench freezes real APIs behind a cache for reproducibility.
   - MCP-Universe and LiveMCP-101 deliberately use live, time-varying ground truth.
   - fiks needs both: replay for the F and P gates, and live runs for `confirm`. Live upstream drift is a confound on real-server benchmarks unless the run is pinned behind fiks's own tap or recording.
4. **Does false success dominate?** C7 reports 45–48% of failures in single-control τ² domains but 3% in dual-control telecom. Silent-failure prevalence is domain-dependent, so a fiks result on retail or airline should not be generalized to telecom.
5. **Live MCP execution success.** MCP-Bench reports execution success of roughly 86–100%. MCPToolBench++ says real-tool success "is not guaranteed and varies." The two measure different things (call executed vs task-level tool success). Neither measures result correctness, which is the gap fiks addresses.
6. **Version drift in the benchmarks themselves.**
   - ABC found τ-bench counted empty responses as success.
   - The τ team fixed more than 50 tasks in February 2026.
   - MCP-Atlas re-scored its leaderboard in April 2026.

   Published numbers from different versions disagree for reasons unrelated to the agents.

## 5. Claim ledgers for the deep-read sources

**τ-bench [yao2024taubench]**
- pass^k = E_task[C(c,k)/C(n,k)], read as "chance that all k i.i.d. task trials are successful" (§3). Retail has 115 tasks and airline 50 (Table 1).
- Tools are deterministic Python over JSON databases (§3, §4). Our drift layer can therefore sit between the tool functions and their data.
- Main results use at least 3 trials per task (§5).

**τ²-bench [barres2025tau2]**
- Reward is a function of the final global state: DB check, status assertions, NL assertions, communicated info and action matching (§3.3). Telecom uses assertion functions only.
- Task counts: retail 115, airline 50, telecom 114 (§3.2).
- 4 trials per task at temperature 0 (§4.1). Cost is about $0.145 per task with gpt-4.1 as agent and user, about $40 per trial over all domains [verify the section that holds the cost].
- The paper injects no tool faults. The only "errors" are ordinary tool-call errors (§3.1).

**MCPMark [wu2025mcpmark]**
- 127 tasks from 38 curated initial states, each with a verify script averaging 209.8 LOC, and the environment is reset after each task (§2).
- pass^4 is defined as all four runs succeeding (§3.1). gpt-5-medium: pass@1 52.56, pass^4 33.86. claude-sonnet-4: pass@1 28.15, pass^4 12.60 (Table 2).
- Implicit failures are the majority, often above 50% (§4.2). Limits: 100 turns, 3600 s (§3.1).
- Cost per task: claude-sonnet-4 $1.99, claude-opus-4.1 $9.18 (App. F, Table 9).

**MCP-Universe [luo2025mcpuniverse]**
- 231 tasks across 6 domains and 11 servers (§3.3).
- Evaluators: format 4, static 32, dynamic 48 (57.1%). The dynamic ones fetch real-time ground truth (§3.4).
- GPT-5 43.72% SR; Claude-4.0-Sonnet 29.44% (Table 3). Adding 94 unrelated tools roughly halves some domain scores (§4.5).

**MCP-Bench [wang2025mcpbench]**
- 28 live servers, 250 tools, 104 tasks.
- Rule checks plus an LLM judge (o4-mini, hard-coded in the runner per the README).
- No analysis of server instability or tool-output faults.

**Outcome Monitors [panthi2026outcomemonitors] = C11** (closest prior evaluation)
- τ-bench retail setup:
  - 50 of 115 tasks, seed 20260718.
  - Two persistent faults on `get_order_details`: a status outside its set, and broken affine conservation.
  - DeepSeek V4 Flash and Pro at temperature 0, 250 episodes per tier.
  - Flash rose from 41/100 to 55/100 completions (§4, §5, App. J).
- Injection changes only the text the model sees; the environment state is never mutated (§4).
- Baselines:
  - generic caution,
  - always-verify,
  - a port of Reinforced Agent,
  - a schema-only detector,
  - stripped-envelope and matched-trigger placebos.
- Incident-derived suite: detection 46.1% and 45.3% outside the mined vocabulary, with completion unchanged.
- Contracts mined from the StableToolBench cache.
- No license is stated for the artifact. The text I read makes no claim about fixing tools.

## 6. What this means for fiks

**Where fiks differs.**
- No benchmark found evaluates *tool-side repair* triggered by runtime faults. All MCP and reliability benchmarks score the agent with tools held fixed and correct. All fault-injection studies (C7, C8, C9, C11) score agent recovery.
- The library-evolution benchmarks score model knowledge, and BUMP/Byam score repair of *compile-time* breakage from a known dependency bump.
- fiks's distinctive measurable outputs have no existing benchmark metric:
  - F→P validity of trace-derived tests,
  - gate pass rate,
  - time from violation to PR,
  - post-merge pass^k returning to the clean level,
  - recurrence = 0 for future agents.

  We must define these metrics and justify them against the SWT-bench and SWE-bench protocols.

**Where fiks is weaker.**
1. Our numbers come from one mock domain with 5 seeded drifts, 6 tasks and k=5. The external benchmarks have 100–1,000 tasks.
2. fiks's tap needs an HTTP upstream whose base URL can be set by env var (codebase-map §0, §6). That rules out several real-server benchmarks without extra work: MCPMark's Filesystem and Postgres servers, and in-process τ² tools.
3. Contracts are hand-written per tool. C11 *mines* contracts, and still detects only about 46% outside its vocabulary.
4. Our run is Anthropic-only. MCP-Bench hard-codes an OpenAI judge, and published leaderboards are multi-vendor.

**Strongest counter-argument a reviewer would raise.**
> "The drifts are seeded by the authors, in a mock vendor the authors wrote, on a server the authors wrote, with contracts the authors wrote to catch exactly those drifts. Run it on a benchmark you did not build (τ²-bench, MCPMark), with faults you did not design (C11's incident-derived suite or real postmortems), against the strongest prior system (Outcome Monitors on the same τ-bench retail protocol). Show that repair adds something beyond receipts that a schema check or an always-verify policy would not already give."

A second line of attack, from MCP-Atlas and MCPMark: tool faults are a minority of agent failures, so the headroom is small.

**Implication for design.** The minimum credible external evaluation is:
- (a) τ²-bench retail and airline behind an MCP+HTTP adapter, with C11's two faults plus fiks's D1–D5 categories mapped onto τ² tools;
- (b) a clean-run false-positive measurement on at least one real-server MCP benchmark (MCPMark local subset, or MCP-Atlas public split);
- (c) a held-out fault set written by someone who did not write the contracts, following C11's protocol.

### Benchmark ranking by fit for testing fiks

| Rank | Benchmark | License | Harness | Real MCP or simulated | Can we inject drift or replay faults? | Cost to run (est.) | Comparability with published numbers |
|---|---|---|---|---|---|---|---|
| 1 | **τ²-bench retail + airline** (and τ-bench retail for C11) | MIT | Python; custom agents supported | Simulated Python tools over a JSON DB; needs an MCP + HTTP adapter so fiks can tap | **Yes, easily.** Wrap DB reads behind a mock HTTP vendor with versions v1/v2. Deterministic, so drift is exact and replayable | Low. Paper: about $40 per trial over all domains with gpt-4.1. Claude cost needs a pilot [verify] | **High.** Same substrate as C7, C8 and C11; native pass^k; must pin task-set version (Feb 2026 fixes) |
| 2 | **MCPMark** (local subset: Filesystem 30, Postgres 21, Playwright 25) | Apache-2.0 | Python; verify.py per task; isolated environments | Real MCP servers | Partial. No HTTP upstream for FS/PG, so faults go at the MCP-result layer or via a DB shim; GitHub server could be tapped [verify env var] | Medium. Claude-sonnet-4 $1.99 per task; × 76 tasks × k=4 ≈ $600 [estimate] | Medium. Published pass@1 and pass^4 on clean servers; our fault arms are new |
| 3 | **MCP-Atlas public split** | Data CC-BY-4.0; harness license [verify] | Containerized harness, claim rubric, LLM judge | 36 real servers | Clean false-positive measurement is easy. Drift injection is hard without per-server taps | Medium–high (500 tasks, judge cost) | Medium. Leaderboard re-scored in April 2026 |
| 4 | **MCP-Universe** | Apache-2.0 | YAML agents and evaluators | 11 real servers (GitHub, Maps, Yahoo Finance, Blender, Playwright, Search) | Real-drift observation via dynamic evaluators; seeded injection needs taps. GitHub writes must go only under vats98754 | High in keys (SerpAPI, Maps, GitHub PAT, Notion) | Low–medium. Live ground truth moves over time |
| 5 | **AppWorld** | [verify license] | Python, state unit tests | Simulated REST-like apps | Yes, a deterministic simulator | Medium | Medium (C7 used it; C11 held-out study) |
| 6 | **MCP-Bench** | Apache-2.0 [verify LICENSE file] | Python; o4-mini judge hard-coded | 28 live servers | False-positive scan only | Medium plus an OpenAI key for the judge | Low for an Anthropic-only run |
| 7 | **LiveMCPBench** | Apache-2.0 | Docker image | 70 servers | False-positive breadth scan | Medium | Low (LLM judge) |
| 8 | **AgentDojo** | MIT | Python, extensible | Simulated | Yes, its tool-output injection hook can carry silent faults | Low | Low (security metrics) |
| 9 | ToolQA-D (ToolEVO) | [verify] | Python | Simulated | Built-in API-change variants (loud) | Low | Agent-side adaptation baseline only |
| 10 | SWT-bench / TDD-Bench | [verify] | Docker, SWE-bench style | n/a | n/a. Use the *protocol* for the repro-validity comparison | Medium | Protocol-level |
| — | BFCL, RoTBench, ToolBH, CRITICTOOL, FAIL-TALMS, RelyToolBench, MCP-RADAR, MCPVerse, MCPToolBench++, Toolathlon, LiveMCP-101 | various | — | — | Not a fit as primary: they score the call side or agent hallucination | — | Related work |
| — | CodeUpdateArena, GitChameleon, VersiCode, CodeSync, BUMP/Byam | various | — | — | Library knowledge or Java compile breakage | — | Related work; Byam as a repair-rate reference point |

## 7. Candidate hypotheses for the paper (each with its falsifier)

- **H1 (detection transfers).** On τ²-bench retail and airline with the D1–D5 drift categories mapped onto τ² tools, fiks contracts flag ≥ 90% of injected-fault trials and produce 0 violated receipts on clean v1 runs (k ≥ 4 per task).
  - *Falsified if* detection's 95% Wilson lower bound is < 80%, or the clean-run false-positive rate's upper bound is > 2%.
- **H2 (receipts are at least as good as the closest prior).** On C11's exact τ-bench retail protocol (50 tasks, seed 20260718, two `get_order_details` faults), fiks receipts improve completion by at least as much as Outcome Monitors' reported +12–14 pp, with a model of our choice and the same faults.
  - *Falsified if* the paired gain's CI upper bound is below C11's reported gain.
  - Caveat: different models, so this is a replication-style comparison, not head-to-head.
- **H3 (repair is durable; detection-only is not).** After merging the fiks PRs, pass^k under drift is statistically indistinguishable from the clean v1 baseline, while the detection-only arm (receipts, no merge) stays below baseline.
  - *Falsified if* post-merge pass^k is significantly below clean (paired test), or detection-only matches post-merge.
- **H4 (trace-derived repro beats issue-text repro).** Tests generated from fiks traces pass the F gate (fail for the stated reason) at a higher rate than tests an LLM writes from an issue description of the same drift, following the SWT-bench protocol.
  - *Falsified if* there is no significant difference in valid F→P rate.
- **H5 (gates prevent partial patches).** Repairs gated on the full contract suite and all stored traces fail held-out traces less often than repairs gated only on the new repro test [C20].
  - *Falsified if* held-out failure rates are equal.
- **H6 (real-server false positives are low).** On clean MCPMark-local or MCP-Atlas runs, contracts inferred from v1 traffic yield ≤ 1% violated receipts.
  - *Falsified if* above 5%, which would mean contracts are brittle on real servers.
- **H7 (held-out faults).** On a fault set authored blind to the contracts (C11's incident-derived style), fiks detection exceeds C11's 46%.
  - *Falsified if* it does not. In that case, report it as the main limitation.
- **H8 (fabrication).** fiks receipts reduce fabrication, coded with C9's Honest Surrender / Fabrication categories, relative to no monitor.
  - *Falsified if* fabrication is not lower.

## 8. Candidate baselines we can actually run

| Baseline | Source of design | License / availability | How we run it |
|---|---|---|---|
| No monitor (raw MCP) | — | ours | Proxy bypass (already the "without fiks" row) |
| Schema-only validation | MCP `outputSchema` [C26]; C11 ablation | MCP SDK (MIT) | Proxy evaluator restricted to `schemaMismatch` |
| Generic caution prompt | C11 | reimplement from paper | Fixed warning text in the same envelope, no witness |
| Always-verify (re-read after every read) | C11 | reimplement | Deterministic second read through an independent path |
| LLM-judge monitor | C7 (AUROC ≤ 0.65) | reimplement | A judge model scores each tool result; threshold tuned on v1 |
| Detection-only (receipts, no repair) | C11 / fiks | ours | Freeze before the repair stage |
| Outcome Monitors port | C11 | artifact license not stated; reimplement from paper | Mined contracts + recovery-tool receipts on τ-retail |
| Repair from issue text (no trace) | SWT-bench / TDD-Bench protocol | protocol only | Give the repair agent a prose bug report, with no fixture or test |
| Repair without the F gate / with only the new test | C20, SWE-bench practice | ours | Toggle gates in `packages/repair` |
| Agent-side adaptation (retry and self-reflect) | ToolEVO | paper | Prompt-level reflection loop, no tool change |
| Pre-deployment tool fuzzing | ToolFuzz | [verify repo license] | Run on shop-mcp v2 before traffic; count drifts found |

## 9. Open gaps

1. **Discovery was search-limited.** No WebSearch ran (§1). A follow-up round should look for:
   - 2026 MCP fault-injection or "silent failure" benchmarks;
   - whether ToolMaze (C11) is released and under what license;
   - API-drift agent benchmarks newer than ToolQA-D;
   - public MCP-server bug datasets (the real-bug areas may already cover these).
2. **Licenses not confirmed:** MCP-Atlas harness, AppWorld, ToolQA-D, SWT-bench, Toolathlon, ToolFuzz. MCP-Bench is known only from a badge.
3. **No benchmark measures tool-side repair from runtime traces.** The paper must define its metrics (F→P validity, gate pass rate, time to PR, post-merge recurrence) and argue that they are valid, which invites the ABC checklist critique.
4. **Adapter cost.** τ² tools are in-process; MCPMark FS/PG have no HTTP upstream. Planner needs effort estimates (codebase-map §6 gives 14–30 h for an external real-server fork).
5. **Cost for Claude models** on τ² and MCPMark at k ≥ 4 is not published. A pilot of about 10 tasks is needed before the power analysis.
6. **Cross-version comparability.** τ-bench tasks were fixed in Feb 2026 and the MCP-Atlas leaderboard was re-scored in Apr 2026. Every reported comparison must pin versions and commit SHAs.
7. **Real versus seeded drift.** MCP-Universe's dynamic evaluators could expose *real* upstream changes over a multi-week window. Nobody has measured how often that happens; that would be a new measurement in its own right.
