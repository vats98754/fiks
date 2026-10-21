# Runtime monitors, guardrails and output validation for agent tool calls

Area: runtime-monitors. Researcher pass dated 2026-10-21. Machine-readable catalog: `runtime-monitors.sources.json` (same keys as column 2 below).
Status: every source below was opened, or for a few classical items its existence was confirmed from a publisher or library record. Items whose quote could not be re-read in full text are marked [verify]. All numbers are the source authors' own, not ours.

## 1. Scope and searches run (2026-10-21)

Question: what do runtime monitors for agent tool calls check (inputs vs outputs, safety vs functional correctness)? Do they persist anything? Does anything get the tool fixed? Which can we run locally as baselines against fiks?

Searches (WebSearch, standard unless marked "ext"):
1. AgentSpec customizable runtime enforcement LLM agents arXiv
2. ShieldAgent verifiable safety policy reasoning 2503.22738
3. LlamaFirewall AlignmentCheck CodeShield
4. Invariant Labs guardrails MCP gateway rules tool calls github
5. (ext) runtime verification LLM agents tool output contracts 2026 arXiv
6. agent behavioral contracts runtime enforcement design by contract LLM agents
7. NeMo Guardrails Colang 2310.10501 execution rails tool output
8. (ext) outcome monitors ToolMaze contract checks receipts recovery tools
9. GuardAgent knowledge-enabled reasoning
10. (ext) verifying tool results LLM agent incorrect tool output detection benchmark 2026
11. Guardrails AI validators reask github
12. Leucker Schallhart "A brief account of runtime verification"
13. NeMo Guardrails tool input/output rails validate tool call results
14. "Reason Less, Verify More" (resolved to C8, arXiv 2607.07405)
15. ToolSafe guardrail unsafe tool invocation
16. VeriGuard verified code generation agent safety
17. LLM judge monitor agent trajectory incorrect tool results AUROC
18. AgentAuditor R-Judge
19. (ext) runtime monitoring violation to automated program repair failing test from runtime trace
20. Meyer "Applying design by contract"
21. MCP TS SDK structuredContent outputSchema validation
22. Bartocci et al. "Introduction to Runtime Verification"
23. Daikon dynamic detection of likely invariants
24. MCP proxy validate tool response semantic correctness open source 2026
25. Snyk acquires Invariant Labs

Deep-read in full text (HTML): Outcome Monitors (2608.19303), AgentSpec (2503.18666v3), ContrAgent (2609.18128), ToolGate (2601.04688), Agent Behavioral Contracts (2602.22302, first 100k chars only), LlamaFirewall (2505.03574). NeMo tool-calling rail docs and the verimcp PyPI README were read in full.

Could not open: OpenReview "Failing Tools" (j7YsSnA64D, bot check), so it is NOT in the catalog. Leucker & Schallhart full text (publisher 403, Lübeck server refused); recorded from bibliographic records only. Meyer 1992 PDF is a scan with no text layer; the DbC quote comes from Eiffel's own DbC introduction page instead.

## 2. Source catalog

Clusters: **A** post-execution checks on tool outputs (functional); **B** pre-execution action gates and policy DSLs (safety/compliance); **C** security guardrails (injection, alignment, code); **D** LLM-as-judge / learned monitors; **E** product guardrail frameworks and MCP proxies; **F** fault-injection workbenches and recovery benchmarks; **G** classical RV, DbC, invariant inference; **H** position papers.

| # | key | year | type | central claim | cluster |
|---|---|---|---|---|---|
| 1 | outcome-monitors (C11) | 2026 | paper | Post-execution contract checks on tool results + nonbinding receipts naming recovery tools raise ToolMaze completion 10.9%→28.1%; never repairs; out-of-vocabulary detection 46% | A |
| 2 | toolmaze | 2026 | paper | Implicit semantic tool failures cut recovery rate by ~37%; agents trust corrupted outputs | F |
| 3 | toolgate | 2026 | paper | Hoare-style pre/postconditions per tool; failed postcondition discards the result; only verified results update symbolic state | A/B |
| 4 | verimcp | 2026 | repo | MCP proxy that re-derives the real outcome after a call (re-read file, git log, CI) and rewrites a false success into an error; idempotent replay | A/E |
| 5 | realtime-detect-repair | 2026 | paper | Telemetry ESN monitor + deterministic recompute layer; "repair" = roll back and re-run the agent, 52%→73% task success | D/A |
| 6 | agentspec | 2025 (ICSE'26) | paper | DSL rule = trigger + predicates + enforcement; triggers before actions/state change; >90% unsafe code executions prevented (abstract) | B |
| 7 | contragent | 2026 | paper | LTLf assume/guarantee contracts compiled to DFAs; same checker gates online and audits offline; return events checked too | B/A |
| 8 | abc-contracts | 2026 | paper | Design-by-Contract for agents (preconditions, invariants, governance, recovery); no postconditions in the tuple; patent pending, impl under IP clearance | B |
| 9 | formal-rv-mfotl | 2026 | paper | MFOTL via MonPoly on AgentDojo/STAC traces; generic obligations flag ~70% of attacks but fire on 29.3% of benign runs | B/G |
| 10 | vigil | 2026 | paper | Skill-spec policies (ordering, args, value flow) reduced to SMT over finite traces; >95% recall, <10% FPR | B |
| 11 | agentltl | 2026 | paper | FO-LTL procedural compliance; one spec for audit, blocking, and reward | B |
| 12 | reason-less-verify-more (C8) | 2026 | paper | Four read-only pre-write gates raise τ²-airline success 29.6%→42.0% on gpt-4o-mini; prevent silent policy-violating writes | B |
| 13 | probguard | 2025 (ASE'26) | paper | DTMC learned from traces predicts violation probability; intervene ahead of time | B |
| 14 | veriguard | 2025 | paper | Policy code verified offline, then each proposed action checked before execution | B |
| 15 | toolsafe | 2026 | paper | RL-trained guard model flags unsafe tool invocations before execution; feedback instead of termination | B/D |
| 16 | shieldagent | 2025 | paper | Guard agent checks action trajectories against policy rule circuits; 90.1% recall on ShieldAgent-Bench | B/D |
| 17 | guardagent | 2024 (ICML'25) | paper | LLM guard plans and generates guard code to check target agent actions against guard requests | B/D |
| 18 | llamafirewall | 2025 | paper | PromptGuard 2 (tool outputs, injection), AlignmentCheck (reasoning), CodeShield (code); AgentDojo ASR 17.6%→1.75%; no functional-correctness check | C |
| 19 | camel | 2025 | paper | Separates control and data flow; untrusted tool data never changes program flow; 77% AgentDojo tasks with provable security | C |
| 20 | nemo-guardrails | 2023 | paper | Programmable rails (Colang) between user and LLM | E |
| 21 | nemo-tool-rails | 2026 | tool-docs | Tool-result rail checks linkage, id uniqueness, name, content shape; does not enforce a response schema or check content | E |
| 22 | invariant-guardrails | 2025 | repo | Python-like rules over messages, ToolCall and ToolOutput; gateway evaluates rules before and after each LLM/MCP request; Apache-2.0 | E/C |
| 23 | snyk-invariant | 2025 | other (news) | Snyk acquired Invariant Labs (June 2025) for agentic AI security | E |
| 24 | guardrails-ai | 2025 | repo | Guards intercept LLM inputs/outputs; validators from Hub/Pydantic; Apache-2.0 | E |
| 25 | mcp-ts-sdk-output-schema | 2026 | tool-docs | SDK validates structuredContent against outputSchema server-side and advertises schema for client validation | E (relates C26) |
| 26 | false-success (C7) | 2026 | paper | LLM judges ≤ AUROC 0.65 at detecting false success on τ²-bench; TF-IDF classifiers 0.83 | D |
| 27 | agentauditor | 2025 (NeurIPS) | paper | Memory-augmented LLM judge reaches human-level accuracy on agent safety/security labeling | D |
| 28 | agentcheck | 2026 | paper | MCP workbench: record, replay with 12 fault types, toggle mitigation, re-check; most failures were silent confident use of bad output | F |
| 29 | catchbench | 2026 | paper | When can an auditor catch a failure: 72 entrants, 11 LLM judges, 3 information states; label process must be published | D/F |
| 30 | runtime-contract-position | 2026 | paper | Harness must enforce preventive and evidential checks before a task is accepted | H |
| 31 | who-holds-the-pen | 2026 | paper | Completion claims outpace official pass rates by ~29–38 pts; only admissible evidence should confirm completion (SpecHarness) | H/A |
| 32 | leucker-rv | 2009 | paper | Foundational account of runtime verification (JLAP 78(5)) [verify quote] | G |
| 33 | bartocci-rv | 2018 | paper | RV primer: specification languages, monitoring terminology, instrumentation, monitorability | G |
| 34 | eiffel-dbc | n.d. (Meyer 1992 lineage) | tool-docs | Client ensures precondition, supplier ensures postcondition; assertion monitoring checks software against author's intent | G |
| 35 | daikon | 2007 | paper | Dynamic detection of likely invariants from observed executions | G |

## 3. Clusters

**A. Post-execution checks on tool outputs (functional correctness).** Outcome Monitors [1] is the closest prior work to fiks's Observe step: it checks the returned result, not the call, against contracts mined from task-disjoint nominal traces (echo, positivity, categorical domain, affine relations, date ordering) or derived from public schemas, and emits a receipt. ToolGate [3] checks postconditions (structure, type, range, format) and discards failing results. verimcp [4] is the only MCP proxy we found that independently re-derives the real outcome (a read-after-write check), but only for calls it knows (files, git, CI). The deterministic layer of [5] recomputes a run's stated total from the tool results it received. Who-holds-the-pen [31] argues completion must be confirmed by admissible evidence. None of these persists a reproduction artifact or changes tool code.

**B. Pre-execution gates and policy DSLs (safety and procedural compliance).** AgentSpec [6], ContrAgent [7], ABC [8], MFOTL/MonPoly [9], VIGIL [10], AgentLTL [11], Reason-Less-Verify-More [12], ProbGuard [13], VeriGuard [14], ToolSafe [15], ShieldAgent [16], GuardAgent [17]. The common object is the agent's *action* (planned call, its arguments, the ordering of calls). ContrAgent also checks return events against assumptions [7, §5.2]. The goal is to stop unsafe or policy-violating actions; the tool is assumed correct.

**C. Security guardrails.** LlamaFirewall [18], CaMeL [19], Invariant default rules [22]. Tool outputs are scanned as *untrusted input* (prompt injection), not as possibly-wrong data. LlamaFirewall's paper describes no functional-correctness check of tool output [18, §3–4].

**D. LLM-as-judge and learned monitors.** AgentAuditor [27] claims human-level safety labeling. The false-success study [26] (C7) finds judges ≤ AUROC 0.65 when the question is whether the environment state really changed. CatchBench [29] shows benchmark numbers for auditors depend on how labels are produced. [5] reports behavior-based telemetry monitors detect "inaccurate information" poorly (per search-result summary; [verify] in full text).

**E. Product guardrail frameworks and MCP proxies.** NeMo Guardrails [20, 21] has an execution/tool rail, but the tool-result rail is structural only (linkage, names, content shape) and explicitly does not enforce a response schema or check content [21]. Invariant [22] supports rules over `ToolOutput` and deploys as a gateway; now part of Snyk [23]. Guardrails AI [24] validates LLM input/output with Pydantic-style validators. The MCP TS SDK validates `structuredContent` against `outputSchema` [25] (C26).

**F. Fault-injection workbenches and recovery benchmarks.** ToolMaze [2], AgentCheck [28], CatchBench [29]. AgentCheck is the nearest "reproduce → intervene → re-check" loop over MCP, but its mitigations are agent-side (e.g., retry), not tool code changes [28].

**G. Classical RV, DbC, invariant inference.** RV checks whether a run satisfies a property [32, 33]; DbC assigns postconditions to the supplier [34]; Daikon infers likely invariants from observed executions [35], the classical ancestor of Outcome Monitors' trace mining and of fiks's planned contract inference from v1 traffic.

**H. Position papers.** [30] and [31] both argue for runtime evidence before accepting task completion; neither builds a repair loop.

## 4. Contradictions and why they disagree

1. **Gate (block/discard) vs advise (preserve raw result).** ToolGate discards a failed result and backtracks [3, §3.4]; AgentSpec/ContrAgent block or redirect [6, 7]; Outcome Monitors deliberately preserve the raw result and only advise [1, §3]. Why: different failure models. Gates target unsafe *actions* where the safe default is "don't"; Outcome Monitors target corrupted *observations* where discarding may remove the only data. Outcome Monitors measured advisory harms too: false-trigger receipts in 14 of 114 clean treated pairs, five rescues and five harms [1, clean P0 control]. Hard enforcement was never measured head-to-head [1, Table 1 caveat "characterizes mechanisms, not measured superiority"]. fiks sides with "advise" for the agent (receipt, upstream fields unchanged) and adds a different remedy (repair the tool).
2. **Is schema validation enough?** C4 says payloads can conform to the declared schema and still be wrong. Yet in Outcome Monitors' ablation, a schema-only detector recovered much of the gain (+10.0 vs +15.0 pts, head-to-head +5.0, p=.42) [1, Appendix F, Table 8]. Why: ToolMaze's injected corruptions include type mismatches and missing fields that schemas catch; C4's faults are schema-conformant by definition. The two results measure different fault populations; neither refutes the other.
3. **LLM judges: human-level or near-chance?** AgentAuditor reports human-level accuracy [27]; the false-success study reports ≤ 0.65 AUROC [26]; ContrAgent beats GPT-4o on R-Judge (F1 91.8 vs 74.4) but notes AgentAuditor beats it [7, §6.3]. Why: R-Judge/ASSEBench label *risky content visible in the transcript*; false success requires *environment state the judge cannot see*. Silent tool faults are of the second kind, which favors grounded checks (fiks compares against the raw upstream response).
4. **False-positive rates differ by two orders of magnitude.** Generic MFOTL obligations fire on 29.3% of benign runs [9]; Outcome Monitors report 1.39% clean FPR per outcome on their synthetic audit and 0.80% firing on organic StableToolBench traffic (not all adjudicated) [1, Appendix E, O]; VIGIL reports <10% [10]. Why: generic vs learned-per-tool properties, per-run vs per-outcome denominators. Any comparison we report must fix the denominator (per call vs per trial).
5. **AgentSpec headline vs table.** The abstract says unsafe executions are prevented in over 90% of code agent cases; summing Table 3 gives about 333/422 (~79%) of invoked risky calls, so the headline's denominator is unclear [6, Table 3] [verify by hand before citing either number].

## 5. Claim ledgers for deep-read sources

**Outcome Monitors (arXiv 2608.19303v1; Panthi & Abdelfattah, Univ. of Southern Mississippi; 19 Aug 2026)**
- O1. Checks the *returned* result against outcome contracts; on violation, preserves the raw result and adds a receipt naming the violated property and admissible recovery tools [§3, Alg. 1].
- O2. Advisory only: "it never restricts an action, executes a repair, reveals a benchmark fault label, or consults the evaluator" [§3].
- O3. ToolMaze completion 35/320 → 90/320 (10.9% → 28.1%), sign-flip p<.00001, four models, two families; replicated on a third family [Abstract, Table 2].
- O4. The recovery-tool list drives the effect: stripped vs baseline +0.9; full vs stripped +11.4 [§5, Fig. 3, App. L].
- O5. Detection outside the mined vocabulary ~46% on an incident-derived suite; completion unchanged [Abstract, App. G, Table 9]. Recall 83% for value-level vs 22% for plausible-string corruption [§5].
- O6. Contracts mined from 400 nominal workflows: 15,041 invariants, five-fold task-disjoint cross-fitting [§3/Alg. 2].
- O7. Stated open problems: detection beyond the contract vocabulary; recovery from organic failures [Abstract, §6]. No live deployment.

**AgentSpec (arXiv 2503.18666v3; Wang, Poskitt, Sun; ICSE'26)**
- A1. Rule = trigger, check (conjunction of predicates), enforce [§3.1, Fig. 3].
- A2. Triggers: state_change, before_action, agent_finish, plus domain events [§3.2, Table 1]; no trigger is described for after a tool observation.
- A3. Enforcement: user_inspection, llm_self_examine, invoke_action, stop [§3.2–3.3].
- A4. Overhead in milliseconds (parsing ~1.42 ms; predicates 1.11–2.83 ms) [§5.5].
- A5. LLM-generated rules (o1): 95.56% precision, 70.96% recall on embodied tasks [Abstract, §5.3].
- A6. LangChain-only implementation, repo github.com/haoyuwang99/AgentSpec; license not stated on the repo page [verify].

**ContrAgent (arXiv 2609.18128v1; Xiao & Nuzzo, UC Berkeley; 16 Sep 2026)**
- K1. LTLf (ALTLf) assume/guarantee contracts over interaction predicates compile to DFAs; one artifact gates online and audits offline [§3–5].
- K2. Return/input events that would falsify an assumption are suppressed [§5.2]; tool outputs are tagged untrusted for injection defense [§6.2].
- K3. AgentDojo ASR 47.7% → 0.79% with trace-learned contracts at undefended utility [§6.2, Table 3]; SOPBench 90% success / 98% safety [§6.1, Table 2].
- K4. Limitation: "enforces only what the tool-call structure exposes" [§6.4].
- K5. "Repair" refers to relaxing contracts, not tools [§5.2]. Apache-2.0, `contragent replay trace.json --config x.yaml` runs offline without a model.

**ToolGate (arXiv 2601.04688; Liu et al.; 8 Jan 2026)**
- T1. Each tool is a Hoare-style contract; precondition gates invocation, postcondition gates whether the result may update the trusted state [§3.2].
- T2. Failing result "is discarded entirely, preventing contaminated outputs from propagating" [§3.4]; Alg. 1 then tries the next candidate tool.
- T3. 29.4% of calls rejected (17.6% precondition, 11.8% postcondition) [§5.4, Table 3]. Who authors the contracts is not stated. Toolset assumed fixed.

**LlamaFirewall (arXiv 2505.03574; Chennabasappa et al., Meta; 2025)**
- L1. PromptGuard 2 scans user prompts and untrusted sources such as tool outputs for jailbreaks; AlignmentCheck audits agent reasoning/actions; CodeShield statically analyzes generated code [§3].
- L2. AgentDojo: ASR 0.1763 → 0.0175, utility 0.4773 → 0.4268 combined [§4.3.2].
- L3. No check of whether tool output is functionally correct.

**NeMo Guardrails tool-calling rails (docs, 2026)**
- N1. Tool-result rail checks linkage to a prior call, unique ids, name consistency, content shape; fails closed [Tool Calling page].
- N2. It "does not yet enforce a declared response schema" and "does not run a content-safety check on the tool result" [same page].

## 6. What this means for fiks

**Where fiks differs (each difference is a testable claim, not an adjective).**
- *Object checked.* Every Cluster B/C system checks actions or untrusted text. Only Cluster A checks whether a tool's result is functionally right. fiks is in A and adds a ground the others lack: agreement with the raw upstream HTTP exchange observed by its tap. Outcome Monitors compare against mined invariants [1]; verimcp re-derives for a few known call types [4]; ToolGate checks shape and range [3].
- *Persistence.* None of the monitors here persists a reproduction artifact. Traces are replayed for audit (ContrAgent [7], MFOTL [9]) or for mitigation testing (AgentCheck [28]), never turned into a failing test in the tool's repo.
- *Remedy.* No catalogued monitor changes tool code. "Repair" elsewhere means: re-run the agent [5], relax the contract [7], retry or swap tools [1, 3, 28], or run a predefined recovery action [6, 8]. fiks's remedy is a PR on the tool, gated by F→P, the full contract suite, all stored traces, and green CI.
- *Where it sits.* fiks and verimcp are MCP proxies; Invariant is a gateway; NeMo/Guardrails AI/LlamaFirewall are in-process libraries; AgentSpec is LangChain-bound.

**Where fiks is weaker.**
- Contracts are hand-written for one server and five seeded drifts; Outcome Monitors mined 15,041 invariants task-disjointly [1, O6], AgentSpec and ContrAgent generate rules with an LLM [6, 7].
- Evaluation scale: one tool, one model, 30 trials per phase (README) vs 4–5 models, 320 episodes per arm, and three benchmarks [1].
- No formal semantics and no temporal (multi-call) properties beyond read-after-write; ContrAgent/VIGIL/MFOTL handle ordering and value flow [7, 9, 10].
- No security threat model; an adversarial tool could game contracts (Outcome Monitors also exclude this [1, limitations]).
- Upstream checks need a configurable base URL (README limitation); Outcome Monitors and judges need nothing from the tool.

**Strongest reviewer counter-argument.** "The runtime half is Outcome Monitors with a different contract source, and the repair half is standard fail-to-pass APR. Your contracts were written by the same people who seeded the drifts, so detection is circular, and you never test faults outside your vocabulary, where Outcome Monitors already show detection falls to 46%. And for a third-party MCP server the agent operator cannot merge anything; a receipt is the only remedy they control." Answers the paper needs: (i) out-of-vocabulary drift suite authored blind to the contracts (as [1] did) plus contracts inferred from v1 traffic rather than hand-written; (ii) a detection-only arm that implements Outcome-Monitor-style receipts on our bench, so "receipts" vs "receipts + merged PR" is measured, not argued; (iii) a recurrence metric across sessions/agents to show what persistence buys; (iv) state plainly that the repair half requires access to the tool repo (owner or fork).

## 7. Candidate hypotheses (with falsifiers)

- **H-RM1 (persistence).** After a fiks PR merges, the violation rate for that contract on fresh sessions (different agent, different seed) drops to 0, while a detection-only monitor (Outcome-Monitor-style receipts, no repair) shows a constant violation rate across sessions. *Falsified if* the detection-only rate also falls to ~0 across sessions without code change, or fiks's post-merge rate is > 0 on replay or live runs.
- **H-RM2 (upstream grounding).** On a drift suite authored blind to the contract vocabulary, checks that compare the tool result to the raw upstream response detect more drifts than output-only invariants mined from v1 traffic (Daikon/Outcome-Monitor style), at equal or lower false-positive rate on v1. *Falsified if* recall is not higher (Wilson CI overlap and paired test n.s.) or v1 FPR is higher.
- **H-RM3 (schema insufficiency on schema-conformant drift).** MCP SDK `outputSchema` validation, NeMo's tool-result rail, and a Guardrails-AI Pydantic validator detect at most the drifts that change type or required fields (e.g., D2 null if schema says number) and miss D1, D3, D4, D5. *Falsified if* schema-only detectors catch ≥ 3 of 5 seeded drifts or ≥ 50% of a blind suite.
- **H-RM4 (judge vs contract).** An LLM judge given (call, tool result) has lower AUROC than deterministic contracts on the drift suite, and does not reach parity even when given the raw upstream response. *Falsified if* judge AUROC ≥ contract AUROC (paired bootstrap), in which case the paper must reframe detection as non-novel and lean on persistence/repair.
- **H-RM5 (security guardrails are orthogonal).** LlamaFirewall PromptGuard 2 on tool outputs and Invariant's default rules produce no detections on D1–D5 and no false alarms on v1. *Falsified if* either flags drift traffic at a rate above its v1 rate.
- **H-RM6 (read-after-write needs post-execution).** Pre-execution gates (AgentSpec-style, ContrAgent guarantees over calls, C8-style read-only pre-write checks) cannot flag D3 (lost write) because the call is valid; fiks's postcondition and verimcp-style re-derivation can. *Falsified if* a pre-execution gate, given the same information budget, flags D3 at a rate comparable to the postcondition.
- **H-RM7 (receipts plus repair dominate receipts alone over time).** Cumulative wrong answers over N sessions are lower for fiks than for detection-only, with the gap growing with N after the merge point. *Falsified if* curves do not separate after merge.

## 8. Candidate baselines we can actually run

| Baseline | What it represents | License | How to run against fiks |
|---|---|---|---|
| MCP SDK output-schema validation [25] (C26) | schema-only, protocol-native | MCP SDK repo license (MIT per repo [verify]) | Turn on client-side validation of `structuredContent` in a bench arm; count violations per drift. Needs `outputSchema` declared on shop-mcp tools. |
| NeMo Guardrails IORails tool-result rail [21] | product structural rail | Apache-2.0 (repo [verify]) | Python sidecar: feed recorded (call, result) messages through IORails; expect structural-only catches. |
| Guardrails AI + Pydantic validators [24] | typed/range validation library | Apache-2.0 | Encode each tool result type with ranges as Pydantic models; validate recorded results offline. |
| Invariant guardrails [22] | rule DSL over ToolOutput (gateway) | Apache-2.0 | `pip install invariant-ai`; `LocalPolicy.from_string` rules equivalent to fiks invariants; run `policy.analyze` on converted traces. Gives a "same rules, different engine" control plus default security rules as a negative control. |
| ContrAgent [7] | formal temporal contracts, offline replay | Apache-2.0 | Convert fiks traces to its trace JSON; `contragent replay trace.json --config shop.yaml`; tests H-RM6 (temporal pre-execution) and gives formal-RV comparison. |
| Outcome-Monitor reimplementation [1] | mined post-execution contracts + recovery-list receipts, no repair | paper only; artifact availability [verify] (appendix truncated in our read) | Implement Alg. 2 classes (echo, positivity, categorical, affine, date ordering) mined from v1 bench traffic; emit v2 receipt shape; run as detection-only arm (H-RM1, H-RM2, H-RM7). |
| Daikon [35] | classical likely-invariant inference | free/open source (Daikon license [verify]) | Feed v1 tool results as record-structured data; use inferred invariants as contracts (H-RM2). |
| LLM-as-judge monitor [26, 27] | judge on tool results | our own prompt, Anthropic API | Judge sees (call, result) or (call, result, raw upstream); score per call; AUROC vs contracts (H-RM4). |
| LlamaFirewall PromptGuard 2 [18] | security scanner on tool output | `pip install llamafirewall`; model license (Llama community license [verify]) | Scan each tool result; negative control (H-RM5). |
| verimcp [4] | read-after-write proxy | MIT | Python MCP proxy; would need a custom verifier for create_order/get_order. Use mainly as a design comparison for D3; runnable only with a shop verifier written by us (state that). |
| AgentSpec [6] | pre-action DSL | repo license not stated [verify] | LangChain-only; would need a LangChain agent over shop tools. Low priority; ContrAgent covers the pre-execution formal arm more cheaply. |
| Telemetry + rollback re-run [5] | agent-level "repair" by re-execution | paper only | Reimplement the deterministic recompute + re-run-on-flag policy as an agent-side remedy arm (contrast with tool-side repair). |

Priority for Phase 3 (cheap, strongest reviewer value): Outcome-Monitor reimplementation (detection-only arm), schema-only (SDK), LLM judge, Invariant rules, ContrAgent replay, PromptGuard negative control.

## 9. Open gaps

- No source measures *recurrence* of the same tool fault across sessions or agents under a monitor; every monitor paper reports per-episode completion. This is the gap fiks's persistence claim needs to fill with data, not argument.
- No monitor in this area turns a violation into a test or a code change of the tool. Closest: AgentCheck's reproduce/mitigate loop (agent-side mitigations) [28] and [5]'s re-run. Absence of evidence: say "we have not found one" (C28 style).
- Outcome Monitors' artifact availability not confirmed in our read (appendix truncated) [verify]; if unavailable, our reimplementation must be described as such.
- No benchmark pairs tool results with the raw upstream ground truth; ToolMaze injects at the observation layer [1, 2], AgentCheck at the MCP response [28]. A drift benchmark where the upstream changed but the tool did not is missing.
- Contract inference for MCP results from traffic (Daikon-style) is untested on MCP specifically; Outcome Monitors mined on ToolMaze workflows only.
- "Failing Tools" (OpenReview j7YsSnA64D, reportedly ≤ 11.47% accuracy on 218 scenarios per search snippet) could not be opened; excluded.
- Behavior-based monitors' weak detection of "inaccurate information" in [5] is from a search summary; re-check the paper's failure-mode table before citing.
- AgentSpec's 90% headline vs ~79% table sum needs a manual re-read before either number appears in the paper.
