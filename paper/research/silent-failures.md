# Silent failures and fault taxonomies (research area: silent-failures)

Date of searches: 2026-10-21. Machine-readable catalog: `silent-failures.sources.json` (37 sources, same keys as below).
Claim IDs C1–C28 refer to `RESEARCH.md`; a source that backs an existing claim reuses its ID.

## 1. Scope and searches

**Question.** How large is the silent-failure problem in MCP servers, tool-using agents and LLM tool APIs? What is it made of, and which fault classes produce no error? The answers should give us a principled fault taxonomy for the fiks benchmark.

**In scope:** empirical MCP fault studies; agent and multi-agent failure taxonomies; agent behaviour on empty, null or malformed tool output (fabrication); false success; noisy-tool benchmarks; real public bug reports of silent tool faults; foundational systems work on gray and error-handling failures.

**Out of scope:** runtime monitors, gateways, API contract testing and repair (other areas). Those are cited here only where they size or shape the problem.

**Searches run (WebSearch; standard unless noted):**
1. empirical study MCP server faults taxonomy 833 fault threads
2. agents fabricate results empty null malformed tool output HTTP 200 arXiv
3. why do multi-agent LLM systems fail taxonomy MAST
4. silent failures tool-using LLM agents taxonomy 2026 arXiv (extended)
5. Gray failure Achilles' heel cloud-scale systems HotOS 2017
6. Where LLM agents fail AgentErrorTaxonomy AgentErrorBench
7. empirical study bugs in LLM agent frameworks tool invocation failures GitHub issues
8. benchmark robustness of LLM agents to unreliable noisy tool outputs
9. Microsoft taxonomy of failure modes in agentic AI systems (security-focused; not used)
10. StableToolBench API instability
11. Which agent causes task failures and when (Who&When)
12. empirical study web API evolution breaking changes clients silent behavioral change
13. github issue MCP server tool returns empty result instead of error silently
14. modelcontextprotocol python-sdk structuredContent outputSchema validation silently empty
15. "silently" wrong data MCP server pagination only first page github issue
16. LLM agent tool wrong units timezone 1970 epoch silent
17. MCP tool calls large-scale analysis error rate isError 2026 (extended)
18. ToolBeHonest tool hallucination benchmark

**Full-text reads (arXiv HTML or PDF):** 2606.05339 (C3), 2609.00035 (SilentProbe), 2609.14758 (Fabrication After Tool Failure), 2607.19449 (C9), 2609.26836 (ToolUniverse audit) and 2603.05637 (Taraghi et al.).
**Targeted reads:** 2606.14589 (C10), 2608.19303 (C11), 2602.11348 (AgentNoiseBench), 2606.08162, 2607.19793, plus PDF greps of 2506.13538 (C5) and 2607.25635 (C6).
**Abstracts only:** everything else. For those, every number in this file is from the abstract.

## 2. Source catalog

| # | Source (key) | Year | Type | Central claim | Cluster |
|---|---|---|---|---|---|
| 1 | Owotogbe et al., *Taxonomy of Runtime Faults in MCP Servers* (owotogbe2026mcpfaults) [C3, C4] | 2026 | paper | 833 runtime-fault threads, 473 repos; Tool 23.0%, Data & Schema 17.6%, State & Config 17.1%; well-formed success despite incorrect behaviour | A. MCP fault studies |
| 2 | Taraghi, Morovati, Khomh, *Real Faults in MCP Software* (taraghi2026realfaults) | 2026 | paper | 407 labelled bug issues; faults sit at boundaries; practitioners rate Tool Response Handling most prevalent (66.67%) | A |
| 3 | Hasan et al., *MCP at First Glance* (hasan2025mcpfirstglance) [C5] | 2025 | paper | Static analysis of 1,899 servers; 14.4% have critical/blocker-level bugs | A |
| 4 | Singh, Gopalan, Narayanan, *Silent Failures… Audit of ToolUniverse* (singh2026tooluniverse) | 2026 | paper | 91 validated silent failures in real MCP-served science tools; 52 API layer, 25 wrapper layer; missing fields 38 | A / D |
| 5 | Li et al., *SilentProbe* (li2026silentprobe) | 2026 | paper | Production APIs: prose-only constraints fail silently 44/61; agents detect 12%, repair 0%, false negative 41%, invent 12% | B. Agent behaviour on bad output / D |
| 6 | Sethi et al., *Fabrication After Tool Failure* (sethi2026fabrication) | 2026 | paper | Signalled failure → 0.0% dishonesty; status:ok without value → up to 45.3%; one prompt line 14.10% → 0.87% | B |
| 7 | Singh, *Guardrails as Scapegoats* (singh2026scapegoats) [C9] | 2026 | paper | HTTP 200 empty/null/malformed/truncated payloads: fabrication 56.6% of 396 valid responses | B |
| 8 | Bronder, *Does a Tool Result Carry More Authority…* (bronder2026authority) | 2026 | paper | False values adopted from tool results (57/60), but equally from inline text (60/60) | B |
| 9 | Advani, *False Success in LLM Agents* (advani2026falsesuccess) [C7] | 2026 | paper | False success 45–48% of failures (single-control τ²); LLM judges AUROC ≤ 0.65 | C. Agent-level taxonomies |
| 10 | Reddy et al., *Reason Less, Verify More* (reddy2026reasonless) [C8] | 2026 | paper | 78% of failures silent wrong-state writes; gates 29.6% → 42.0% | C |
| 11 | Wu, *When Errors Become Narratives* (wu2026narratives) [C10] | 2026 | paper | 22 incidents, 5 classes; ~70% caught by humans reading output | C |
| 12 | Cemri et al., *MAST* (cemri2025mast) | 2025 | paper | 14 modes, 3 categories, 1600+ traces, κ = 0.88 | C |
| 13 | Zhu et al., *AgentErrorTaxonomy / AgentDebug* (zhu2025agentdebug) | 2025 | paper | Errors by agent module; cascading root causes | C |
| 14 | Zhang et al., *Who&When* (zhang2025whowhen) | 2025 | paper | Post-hoc attribution: right agent 53.5%, right step 14.2% | C |
| 15 | Chen et al., *Agent-Reactive Bugs* (chen2026agentreactive) | 2026 | paper | 255 reports; many bugs are silent with no oracle; reproduction hampered by stochasticity | C / A |
| 16 | Zhu et al., *Bugs in Modern LLM Agent Frameworks* (zhu2026frameworkbugs) | 2026 | paper | 998 reports; API misuse, incompatibility, documentation desync | C |
| 17 | Islam et al., *When Agents Fail* (islam2026whenagentsfail) | 2026 | paper | 1,187 bug posts; types, root causes, effects | C |
| 18 | Zhu et al., *ToolMaze* (zhu2026toolmaze) | 2026 | paper | Explicit/implicit × transient/permanent; implicit cuts recovery ~37% | E. Benchmarks with fault injection |
| 19 | Wang et al., *AgentNoiseBench* (wang2026agentnoisebench) | 2026 | paper | 24 models; −20.8% average; tool noise > user noise; explicit execution failures most destructive to score | E |
| 20 | Panthi & Abdelfattah, *Outcome Monitors* (panthi2026outcomemonitors) [C11] | 2026 | paper | Mined invariants and receipts lift ToolMaze 10.9% → 28.1%; 83% vs 22% recall (structured vs plausible-string) | E (detail in monitors area) |
| 21 | Yao et al., *τ-bench* (yao2024taubench) | 2024 | paper | pass^k; pass^8 < 25% in retail | E |
| 22 | Guo et al., *StableToolBench* (guo2024stabletoolbench) | 2024 | paper | Real online APIs unstable; cached and simulated API server | E |
| 23 | Zhang et al., *ToolBeHonest* (zhang2024toolbehonest) | 2024 | paper | Hallucination when tools are missing or insufficient; GPT-4o 37.0/100 | B |
| 24 | Huang et al., *Gray Failure* (huang2017grayfailure) | 2017 | paper | Differential observability: detectors miss what applications experience | F. Foundations |
| 25 | Yuan et al., *Simple Testing Can Prevent Most Critical Failures* (yuan2014simpletesting) | 2014 | paper | Most catastrophic failures come from mishandled non-fatal errors | F |
| 26 | Serbout & Pautasso, *Web APIs and SemVer* (serbout2024semver) | 2024 | paper | 1,970 of 3,075 APIs do not always signal breaking changes | F / drift |
| 27 | Liu, *Entropy Principle* (liu2026entropy) | 2026 | paper | Claims silent failures are structural, not defects (weak evidence) | C (opposing view) |
| 28 | Xu & Wu, *MCP Error Messages…* (xu2026errormessages) | 2026 | paper | Rate-limit recovery 6% vs 88% depending on message wording | B (loud errors) |
| 29 | Majeed, Mahmoud, Nadi, *Empirical Study of MCP Applications* (majeed2026mcpapps) [C6] | 2026 | paper | Cites Stein: action tools 27% → 65%; only 37.2% of apps gate tool execution | A (context) |
| 30 | MCP spec 2025-11-25 Tools (mcpspec20251125tools) [C26] | 2025 | spec | outputSchema MUST conform; isError channel; clients SHOULD validate results | G. Protocol |
| 31 | PostHog, *63M MCP tool calls* (posthog2026mcpcalls) | 2026 | blog | Explicit error rate 2–5.7% by client; silent faults not measured | D. Industry / real bugs |
| 32 | StackOne, *AI agent testing failures* (stackone2026agenttesting) | 2026 | blog | 429 in a 200 body read as "no records found" | D |
| 33 | codebase-memory-mcp v0.10.1 release (deusdata2026codebasememory) | 2026 | repo | Empty structuredContent with success status under a permissive outputSchema | D |
| 34 | atlassian-mcp-server #118 (atlassian2026issue118) | 2026 | issue | Search silently truncated to one page; totalCount = page size | D |
| 35 | IBM mcp-context-forge #4208 (ibm2026contextforge4208) | 2026 | issue | Gateway passed a missing structuredContent as valid | D |
| 36 | anthropics/claude-code #23337 (claudecode2026issue23337) | 2026 | issue | Empty results through the client, valid over direct stdio | D |
| 37 | Stripe docs, currencies (stripe2026currencies) | 2026 | tool-docs | Amounts in minor units, with per-currency exceptions | D (realism of D1) |

## 3. Clusters

**A. MCP fault studies (sizing).** Two independent taxonomies, built from different corpora, agree that many MCP faults surface after a call that "succeeded":
- **C3** (Owotogbe et al.) coded runtime-fault threads and excluded build and environment issues. The silent subcategories it names are:
  - Tool Result Propagation: "success response … returned despite an underlying tool failure"
  - Resource State: stale data
  - Resource Identification: silent empty results
  - Output Representation
  - Configuration Handling: settings "silently ignored"
- **Taraghi et al.** coded all MCP bug issues from Python-SDK servers. Configuration categories dominate their counts, but practitioners rank Tool Response Handling (malformed, incomplete or "semantically unusable" output) as the most prevalent fault (66.67%). They recommend validating responses after successful invocation (A2).
- **ToolUniverse audit** is the only study that counts silent failures in a real tool suite by running it: 91 validated failures. Most are missing fields (38) and filtering or ranking inconsistencies (20), and most originate in the API (52) or wrapper (25) layer.
- **C5** is static analysis. It measures code quality, not runtime silent faults.

**B. What agents do with bad tool output.** Four controlled studies converge on one finding: the envelope's success or error signal matters more than the payload.
- Sethi et al.: signalled failures produce 0.0% dishonesty; status:ok with no usable value produces up to 45.3%.
- C9 (Singh): fabrication in 56.6% of valid responses to HTTP-200 empty/null/truncated/malformed payloads.
- SilentProbe (real production APIs): 12% detection, 0% repair, 41% false negatives, 12% invented figures.
- Bronder: models adopt false values from tool results, but just as readily from announced inline text. So the problem is general credulity toward announced data, not tool-result authority as such.
- ToolBeHonest is the older line, covering missing or insufficient tools rather than wrong output.
- Xu & Wu: the wording of what the tool says swings recovery from 6% to 88% (loud errors only).

**C. Agent-level failure taxonomies.**
- MAST, AgentErrorTaxonomy and Who&When place root causes in the agent or in agent coordination, and implicitly treat tool output as ground truth.
- The 2026 work adds silent classes: false success (C7), silent wrong-state writes (C8), error swallowing and chained fabrication (C10), and silent bugs at the model–harness boundary (Chen et al.).
- Liu (2026) argues silent failure is structural and therefore not fixable as a defect. It is the opposing thesis, but its frequencies have no stated method.

**D. Real public bugs and industry evidence (exemplars for the taxonomy; candidates for the real-bug harness):**
- silent empty under a permissive outputSchema (codebase-memory-mcp v0.10.0)
- silent pagination truncation with a misleading total (atlassian-mcp-server #118; our D4)
- a gateway that silently accepted missing structured output (IBM #4208)
- a client-side silent empty (claude-code #23337)
- an error-in-body read as "no records" (StackOne)
- explicit error rates of 2–5.7% on one large server (PostHog), which says nothing about silent rates

**E. Benchmarks with fault injection.**
- ToolMaze (explicit/implicit × transient/permanent)
- AgentNoiseBench (five tool-noise types on τ²-bench and VitaBench)
- τ-bench (pass^k)
- StableToolBench (real API instability; a cached corpus of organic responses)
- Outcome Monitors (C11): uses ToolMaze, AppWorld, τ-bench retail and the 53,078 StableToolBench responses as a false-positive corpus

**F. Foundations.**
- Gray failure, whose defining feature is differential observability. C3 borrows the concept explicitly.
- Yuan et al.: most catastrophic failures trace to mishandled non-fatal errors, the classic precedent for error swallowing.
- Serbout & Pautasso: breaking changes are often not signalled even when they are visible in the spec.

**G. Protocol.** The MCP spec offers two error channels (JSON-RPC protocol errors and `isError` results) and a structural output check (`outputSchema`). Nothing in the protocol checks whether a result is semantically correct [C26].

## 4. Contradictions, and why the sources disagree

1. **833 or 837 threads (C3).** One search snippet said 837. The paper's abstract, §4.5 funnel and §6 all say 833 (2,016 − 71 − 623 − 489). We keep **833**. C3 also has internal inconsistencies (Schema Compatibility 69% in §6 vs 58% in Table 1; State & Configuration 17.1% vs 17.2%). We should cite only the category shares we re-derived from §6 counts (192, 147 and 143 of 833).
2. **Which MCP fault class dominates.** C3 ranks Tool first (23.0%). Taraghi et al. rank configuration first (31.74% + 28.64% + 27.45%). The corpora differ:
   - C3 covers runtime faults only, with build and environment issues excluded.
   - Taraghi et al. cover all MCP-related bug issues from Python-SDK servers, configuration included.
   - The units differ too: threads vs labels.

   Both agree that response-boundary faults matter. Taraghi et al. note that issue counts under-rank them relative to practitioner experience, which is consistent with silent faults being under-reported.
3. **Is silent worse than loud?** ToolMaze finds implicit failures cut recovery the most (~37%), while AgentNoiseBench finds explicit execution failures most destructive (score 0.31). The metrics differ: a loud failure blocks completion and lowers score, while a silent failure yields a confident wrong answer that a score-only metric may even count as completion. For fiks, the claim must be "silent faults produce undetected wrong answers", measured as a wrong-answer rate, not "silent faults lower the success score more".
4. **How often agents fabricate.** Reported rates are 56.6% (C9), 14.10% overall and up to 45.3% for one class (Sethi et al.), and 12% invented plus 41% false negatives (SilentProbe). The studies differ in:
   - denominator: C9 counts valid responses only (396 of 480); Sethi et al. report in-scope items with signalled failures included; SilentProbe uses the user-facing outcome after up to four turns
   - models: GPT-4o and Llama vs gemini-2.5-flash vs 12 models through OpenRouter
   - prompts: neutral vs deployment vs CrewAI
   - payload realism: stubs vs live APIs

   Report them as a range with denominators, never as one number.
5. **Do tool results carry special authority?** Bronder's first two studies say yes (7/24 vs 0/24); the third says no (57/60 vs 60/60 for announced text). The model, task and conditions differ across the studies. For our purposes, agents adopt plausible values from tool output regardless, so the fix has to come from outside the model.
6. **Where the fix belongs.** The sources point in four directions:
   - SilentProbe: "one line of schema rather than a better model", i.e. fix the spec at the vendor.
   - Sethi et al.: one prompt sentence, i.e. fix the agent.
   - Chen et al.: users want harness guardrails, while developers blame the LLM.
   - fiks: fix the tool code.

   These are complementary. The prompt fix works only when the payload is visibly unusable; the schema fix works only when the vendor controls the spec; neither helps when an upstream returns plausible but wrong values (unit drift, epoch dates) and the wrapper must change. The strongest version of each competitor should appear in related work.
7. **Silent failure: structural or a defect?** Liu (2026) says silent failures are structural. C3, ToolUniverse and the real issues show concrete defects, fixed by code changes, in specific servers. The disagreement is partly definitional: Liu means emergent multi-agent information loss, which fiks does not address.

## 5. Claim ledgers for the deep-read sources

**owotogbe2026mcpfaults (C3/C4), arXiv 2606.05339 v2**
- 833 threads, 473 repos in the mining pool, 200 analysed, 177 contributing threads; 11/27/73 taxonomy (Abstract, §4.4–4.6).
- Tool 192 (23.0%), Data & Schema 147 (17.6%), State & Config 143 (17.1%) (§6).
- "return well-formed JSON-RPC success responses despite incorrect behavior" (§6). Detection based only on crashes or errors is insufficient (§6, Implications).
- Data Type and Structure: payloads "conform to the declared schema" but break downstream assumptions; example: a null LLM content field (§5.9).
- Survey: 55 of ~1,200 invited (~4.6%); Tool Execution 73%, Tool Result Propagation 67% (§4.6, Table 1).
- Threats: counts are descriptive, not prevalence; κ = 0.938; excludes clients and hosts (§7).

**taraghi2026realfaults, arXiv 2603.05637 v2**
- Data: 279 repos → 9,742 closed issues → 407 MCP bug issues labelled; survey n = 41.
- Shares: Server/Tool Configuration 31.74%, Server/Host 28.64%, Server Setting 27.45%, Documentation 6.92%, General Programming 5.25% (§4.1).
- Tool Response Handling has survey prevalence 66.67%, the highest (§4.2.1, Table 4). Recommendation A2: "Validate responses after successful tool invocation" (§4.4).
- MCP faults draw more discussion than non-MCP faults (339-issue comparison), with small effect sizes.

**singh2026tooluniverse, arXiv 2609.26836 v2**
- Sample: 63 sampled tools, 15 analysed in detail (104 wrappers), 198 manually reviewed test cases; 91 validated failures.
- By layer: 52 API, 25 wrapper.
- By issue type: missing data or fields 38, search/filter/ranking 20, missing functionality 8, data mismatch 6, agent misinterpretation 5, false success 4. 7 of 15 tools failed in >50% of test cases.
- Candidate discovery used an LLM agent, so the results are not exhaustive (authors' caveat).

**li2026silentprobe, arXiv 2609.00035**
- Ecosystem audit: 721,320 parameters across 2,501 OpenAPI documents; 15.2% declare any machine-checkable constraint; 40.1% of documents have at least one prose-only constraint (§4.1).
- Probing: honest errors in 111/111 machine-checkable perturbations; silent failure in 44/61 prose-only perturbations (§4.2).
- Intervention: promoting the vocabulary to an enum took failures from 88/88 to 0/89 (§4.3).
- Agents: detect 12%, repair 0%, false negative 41%, invented figure 12% (§4.4).
- Classes: silent empty, silent drop, silent coercion, semantic downgrade (§4.5).
- Limits: non-random endpoints; the prose-only prevalence did not replicate across corpora (2.4% vs 0.3%); competing interest (Monid) (§5.1).

**sethi2026fabrication, arXiv 2609.14758**
- Design: 1,024 items, 8 failure types (6 of them status:ok); primary analysis on 688 in-scope items.
- Signalled failures: 0.0% dishonesty. Unsignalled: up to 45.3% (REDACTED_PERMISSION).
- Overall: 14.10% under the deployment prompt, 24.67% under CrewAI's prompt.
- Mitigation: a retrieval-status line takes 14.10% to 0.87%, with transfer to CrewAI, LlamaIndex and smolagents. The flag is faithful 99.69–99.89% of the time, so a regex can detect it.
- Limits: deterministic stubs, one generator model, a same-family judge validated on 30 items.

**singh2026scapegoats (C9), arXiv 2607.19449**
- Profiles: empty_valid, malformed, null_field, truncated, all HTTP 200 with "no exception is raised" (§3.2).
- Models: GPT-4o-mini, GPT-4o, Llama 3.1 8B, Llama 3.3 70B; 12 stubs.
- Rates: n = 396 valid of 480 trajectories; fabrication 56.6%, honest surrender 43.2%; no CI reported (§4.1, Table 3).
- **Action for RESEARCH.md:** change the C9 URL to arxiv.org/abs/2607.19449 and add "of 396 valid responses; 4 models".

## 6. What this means for fiks

**Where fiks differs.**
- Every source above stops at detection, characterisation or agent-side mitigation:
  - prompts (Sethi et al.)
  - gates (C8)
  - monitors with receipts (C11)
  - spec fixes advised to vendors (SilentProbe)
  - post-hoc attribution (Who&When)
- None turns an observed silent violation into a code change in the tool.
- Two facts make the server repair valuable rather than redundant:
  - The ToolUniverse audit locates 25/91 silent failures in the wrapper layer, exactly what a PR to the MCP server fixes.
  - The real issues (codebase-memory-mcp, atlassian #118) were fixed by server code changes, after users noticed, not by agents.
- C3's "gray failure / differential observability" framing [Huang et al.] gives fiks a principled description: the proxy restores observability between "server says success" and "agent gets wrong data", and the PR removes the gap for every later client.

**Where fiks is weaker.**
1. *Fault model = contract vocabulary.* Outcome Monitors recall drops to 22% for corruption inside plausible strings [C11]. Our D1–D5 are all structured-value faults, the easy half.
2. *Server-side scope.* Some silent faults live in the client (claude-code #23337, tools/list pagination) or in the upstream API itself (52/91 in ToolUniverse). A PR to the MCP server can only work around upstream faults, and cannot touch client faults.
3. *Seeded drifts.* Every MCP fault study warns that frequency counts are descriptive. We have no measured precision on organic traffic. Outcome Monitors offers a cheap check we have not run: a false-positive audit on StableToolBench's organic responses.
4. *Cheap competitors.* A one-line retrieval-status prompt cuts fabrication to 0.87% when the payload is visibly unusable [Sethi et al.]. That covers null, empty and truncated outputs (D2-like) without any proxy.

**Strongest counter-argument a reviewer would raise.**
> "Your benchmark seeds five drifts, each chosen to be expressible in your contract language, on a vendor and server you wrote. The literature shows the hard silent faults are plausible-but-wrong values outside any mined vocabulary (22% recall in C11), client-side faults, and upstream API faults. For the cases you do catch, a prompt line (Sethi et al.) or an enum in the spec (SilentProbe) removes most of the harm at near-zero cost. Show that fiks catches and repairs faults you did not design, at a false-positive rate operators accept, and that the repair adds value over those cheap mitigations."

**Answer plan (experiments, not rhetoric):**
- Real-bug harness on forks of open-source servers with verified silent bugs (codebase-memory-mcp v0.10.0, ToolUniverse wrapper-layer cases).
- An organic false-positive audit on clean traffic (StableToolBench cache; fiks on unmodified public servers).
- Head-to-head against the prompt-line and schema-only baselines on unit drift (D1) and epoch drift (D5), where the payload looks usable and the prompt line cannot help.
- A held-out drift set designed by someone other than the contract author.

## 7. Candidate hypotheses (each with its falsifier)

- **H-S1 (schema is not an oracle).** On the fiks drift suite, plus held-out drifts and real bugs, `outputSchema` validation flags at most a minority of silent faults; fiks contracts flag a strict superset.
  *Falsified if* schema-only validation flags ≥ 50% of faults, or flags a fault that fiks misses.
- **H-S2 (envelope signal drives fabrication).** Without fiks, agents state wrong values on silent drifts. With fiks receipts (an explicit violation signal), wrong-answer rate drops toward the 0% Sethi et al. saw for signalled failures, while correct-answer rate does not fall.
  *Falsified if* the wrong-answer rate with receipts is not lower (paired test, CI excluding 0), or correct answers fall by more than the wrong-answer reduction.
- **H-S3 (prompt-line baseline is insufficient for plausible-value drifts).** The Sethi et al. retrieval-status line removes most wrong answers on null, empty or truncated drifts (D2, D4-like), but not on plausible-value drifts (D1 cents, D5 epoch), where fiks receipts do.
  *Falsified if* the prompt line matches fiks on D1 and D5.
- **H-S4 (vocabulary limit replicates).** fiks detection recall is high for structured-value faults and low for corruption inside plausible strings, as in C11.
  *Falsified (in our favour) if* recall on the plausible-string class is comparable. If recall is low, it is reported as a limitation, not hidden.
- **H-S5 (repair generalises across clients).** After a fiks PR merges, violation rate is 0 for every agent and model tested, not only the one that triggered the trace. Detection-only monitors leave the per-call violation rate unchanged.
  *Falsified if* any model still sees a violation on the fixed path, or a detection-only baseline also drives the violation rate to 0.
- **H-S6 (taxonomy coverage of real bugs).** Of the verified real silent bugs in open-source MCP servers, at least k (pre-registered) are expressible as fiks contract classes and reproducible from a captured trace (F gate).
  *Falsified if* fewer than k pass the F gate in forks.
- **H-S7 (low false positives on clean traffic).** The fiks false-positive rate per tool result on clean traffic is ≤ the 1.39% reported for Outcome Monitors.
  *Falsified if* it is higher (with CI) on the organic corpus.

## 8. Proposed silent-fault taxonomy for the benchmark (grounded mapping)

| Class | Definition (no error raised) | Literature anchor | fiks drift today | Proposed new drift |
|---|---|---|---|---|
| S1 Unit/scale | Same field, value in a different unit or scale | C4 (schema-valid but wrong); Stripe minor units | D1 | currency minor units per currency (JPY zero-decimal) |
| S2 Rename → null | Field renamed upstream; wrapper emits null or omits it | C3 Data Type & Structure; null_field (C9); missing fields 38/91 (ToolUniverse) | D2 | nested-field move |
| S3 Lost write / false success | Mutation reported OK but not persisted | C3 Tool Result Propagation; C7; C8 | D3 | idempotency-key change → duplicate write |
| S4 Truncation / pagination | Partial result presented as complete | atlassian #118; truncated (C9, Sethi) | D4 | cursor-based pagination with misleading total |
| S5 Format coercion | Value parsed under the wrong format | SilentProbe silent coercion | D5 | timezone dropped (naive vs UTC) |
| S6 Silent empty | Valid query returns zero rows | SilentProbe; empty_valid (C9); C3 Resource Identification; codebase-memory-mcp | – | upstream enum vocabulary change → empty |
| S7 Parameter silently dropped | Filter accepted and ignored | SilentProbe silent drop; C3 Configuration Handling | – | filter param renamed upstream |
| S8 Error in body | Upstream error carried in a 200 body | StackOne 429-in-200; C3 Message Semantics; malformed (C9) | – | rate-limit JSON in 200 |
| S9 Stale data | Cached or old value returned as current | C3 Resource State; STALE_EXPIRED (Sethi) | – | cache TTL ignored |
| S10 Permission-empty | Redacted or empty because of scope, reported as no data | REDACTED_PERMISSION, the worst class at 45.3% (Sethi) | – | token scope reduced |
| S11 Ranking/filter inconsistency | Results present but wrong order or wrong subset | ToolUniverse (20/91) | – | sort order flipped |
| S12 Plausible-string corruption | Wrong text inside a valid string | C11 (22% recall) | – | negative control: expected to be missed |

S12 is deliberately included as a class fiks is expected to miss. It keeps the benchmark honest.

## 9. Candidate baselines we could actually run

| Baseline | What it is | License / availability | How we run it |
|---|---|---|---|
| Schema-only | Validate `structuredContent` against `outputSchema` (spec "clients SHOULD validate") | MCP TS SDK (MIT); Ajv (MIT) | Proxy mode with semantic invariants disabled |
| Gateway schema validation | IBM mcp-context-forge output validation (post-#4204) | GitHub; Apache-2.0 [verify] | Run the gateway in front of shop-mcp; count flagged drifts |
| Retrieval-status prompt line | Sethi et al. one-sentence mitigation | Text from the paper | Add to the bench agent system prompt; no fiks; compare wrong-answer rate |
| LLM-judge monitor | Judge each tool result for plausibility | Our implementation (C7 reports AUROC ≤ 0.65 on a related task) | Same model family as the agent; measure detection and FP |
| Mined-invariant monitor | Outcome Monitors classes (echo, positivity, categorical domain, affine, date order), mined from v1 traffic | Reimplement from the paper; code availability [verify] | Mine on v1 bench traffic, evaluate on v2 and held-out drifts |
| Pre-execution gates | Read-before-write checks (C8) | Reimplement from the paper | Only relevant to D3-like write faults |
| Differential probe | SilentProbe baseline/valid/perturbed calls | Reimplement from the paper | Detects request-side silent drops (S6/S7); offline only |
| Detection-only fiks | fiks receipts, no repair | Ours | Isolates the value of repair (H-S5) |

Candidate external fault-injection benchmarks:
- ToolMaze: repo availability [verify]
- AgentNoiseBench: τ²-bench based; code [verify]
- Sethi et al.'s 1,024-item benchmark: release [verify]
- StableToolBench cache: false-positive corpus; public on GitHub [verify license]

## 10. Open gaps

- **Silent-fault prevalence on organic MCP traffic is unmeasured** anywhere we found. PostHog measures only explicit errors; C3 and Taraghi et al. count issues, not rates. A measured silent-violation rate on real traffic would be a contribution in itself, even a small one.
- **No study links a silent violation to a merged fix.** The real issues we found were fixed after humans noticed (cf. C10's ~70%). Time-to-fix for silent vs loud MCP faults is not reported. Taraghi et al. compare MCP vs non-MCP faults, not silent vs loud.
- **Fabrication numbers come from stubs and a few model families** (Gemini; GPT-4o and Llama). Only SilentProbe uses live APIs. No study covers Claude models on silent tool faults except Bronder (one model, synthetic task).
- **Client-side silent faults** (pagination of tools/list, empty rendering) form a separate class that no taxonomy above separates cleanly from server faults.
- **To verify before citing:**
  - Stein's primary source for C6
  - Yuan et al.'s body-text percentages
  - AgentNoiseBench's exact tool-vs-user gap
  - ToolMaze code release
  - year of the codebase-memory-mcp v0.10.1 release
  - Atlassian server source availability
  - mcp-context-forge license
  - SilentProbe and PostHog quotes, taken from fetch summaries rather than read verbatim
