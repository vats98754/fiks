# Fiks — Evidence Base

Every product claim, pitch line, README sentence and slide must cite a claim ID below (e.g. [C5]).
Anything not traceable here or to our own benchmark logs gets cut. Labels:
- **[Primary]** read from the original source. **[Secondary]** reported by someone else; verify before quoting on stage.
- **[Inference]** our reasoning from the evidence, not a measured fact. Say "we believe" when presenting it.

---

## A. What an agent is, and what it needs

**C1 [Primary]** Anthropic defines agents as systems where LLMs dynamically direct their own processes and tool usage, and says agents must get "ground truth" from the environment (tool results, code execution) at each step to assess progress.
https://www.anthropic.com/research/building-effective-agents

**C2 [Inference]** Formally, an agent is a policy a_t ~ π(·|h_t) acting on observations o_t = Env(a_t). Its only contact with reality is o_t. If a tool returns wrong data that looks valid, the agent conditions on a false world state. Per-step reliability p over n steps gives task success ≈ pⁿ.

## B. The problem is real, frequent, and silent

**C3 [Primary]** First empirical taxonomy of MCP server runtime faults: 833 confirmed fault threads from 473 maintained repos. Tool faults 23.0%, Data & Schema 17.6%, State & Configuration 17.1% (together 57.9%). The authors observe servers returning well-formed success responses despite incorrect behavior ("gray failure"), and conclude detection based only on crashes or explicit errors is insufficient. Survey of 55 developers (4.6% response rate): Tool Execution faults seen by 73%, Tool Result Propagation by 67%.
https://arxiv.org/abs/2606.05339

**C4 [Primary]** Same paper: "Data Type and Structure" faults are payloads that *conform to the declared schema* but violate downstream assumptions (e.g. a permitted null). So JSON Schema validation alone cannot catch them.
https://arxiv.org/abs/2606.05339

**C5 [Primary]** Static analysis of 1,899 open-source MCP servers: 14.4% have critical or blocker-level bugs.
https://arxiv.org/abs/2506.13538

**C6 [Secondary]** Analysis of 177,436 tools in public MCP repos (Nov 2024–Feb 2026) found action tools that modify external state grew from 27% to 65% of tool usage. Cited in arXiv 2607.25635; original by Stein.
https://arxiv.org/pdf/2607.25635

**C7 [Primary]** False success (agent claims completion, environment disagrees) is 45–48% of failures in single-control τ²-bench domains. No LLM-judge configuration exceeded AUROC 0.65 at detecting it.
https://arxiv.org/abs/2606.09863

**C8 [Primary]** On a budget agent in τ²-bench airline, 78% of failures were silent wrong-state writes with no tool error. Deterministic pre-execution gates raised success 29.6% → 42.0%.
https://arxiv.org/abs/2607.07405

**C9 [Primary]** When tools return HTTP 200 with empty/null/malformed payloads, agents fabricate results in 56.6% of valid responses.
https://papers.cool/arxiv/2607.19449

**C10 [Primary, n=1 system]** In one production agent runtime, ~70% of silent failures were caught by humans reading output, not by tests, health checks or audits.
https://arxiv.org/abs/2606.14589

## C. Detection alone is not enough (why we close the loop)

**C11 [Primary]** Outcome Monitors (contract checks + receipts naming recovery tools) raised ToolMaze completion 10.9% → 28.1%. Most tasks still fail, and detection outside the mined contract vocabulary fell to 46%.
https://papers.cool/arxiv/2608.19303

**C12 [Inference]** A runtime monitor helps the current agent retry. It never fixes the tool, so every future agent hits the same fault. The durable fix is a code change in the tool, verified by a test.

## D. Upstream drift breaks integrations, and docs/specs don't reliably announce it

**C13 [Primary]** YC Fall 2026 RFS "Self-Maintaining APIs" (Harsha Gaddipati): breaking changes ship with little warning and changelogs go unread. The author reports >30% of service downtime at AWS came from unnoticed external API/package changes (personal account, not a study). Asks for agents that scan customer code, find affected usages and open PRs; "Dependabot for APIs."
https://www.ycombinator.com/rfs

**C14 [Primary]** Large study of 317 Java libraries / 500K API changes: 27.99% of changes break backward compatibility; frequency rises over time. (Library APIs, not web APIs.)
https://homepages.dcc.ufmg.br/~mtov/pub/2017-saner-breaking-apis.pdf

**C15 [Primary]** In npm client packages, more than one-fifth of manifesting breaking changes were undocumented. In Bioconductor, ~55% of detected breaking changes were undocumented.
https://www.ime.usp.br/~gerosa/papers/TOSEM-BreakingChanges.pdf
https://vtechworks.lib.vt.edu/bitstream/handle/10919/113116/Chowdhury_H_T_2023.pdf

**C16 [Primary]** Postman 2025 State of the API (5,700+ respondents): API changes are most often communicated via team chat (75%) vs formal documentation (42%); 55% cite inconsistent documentation; only 24% design APIs with AI agents in mind.
https://www.postman.com/state-of-api/2025/

## E. Why a fix PR from a real failing call can work

**C17 [Primary]** TDFlow: given human-written reproduction tests, issue resolution reaches 94.3% on SWE-bench Verified vs 68.0% with LLM-generated tests. The authors conclude the bottleneck is generating a test that truly reproduces the bug.
https://arxiv.org/pdf/2510.23761

**C18 [Primary]** ~90% of SWE-bench Lite issues are submitted without a failure-reproducing test.
https://experts.illinois.edu/en/publications/failure-reproducing-test-case-generation-method-based-on-large-la/

**C19 [Inference — core thesis]** A silent failure caught at runtime comes with the exact tool call, raw upstream response, and the violated property. That is a ground-truth reproduction, not a guess from prose. This attacks the bottleneck in C17/C18 directly.

**C20 [Primary — risk]** SWE-Doctor: a fail-to-pass test can cover only one manifestation of a bug and lead to partial patches. Mitigation for us: every PR must also pass the full contract suite and all recorded traces, not just the new test.
https://arxiv.org/abs/2607.00990

**C21 [Primary]** 33k agent-authored GitHub PRs: 71.48% merged; each failed CI check lowers merge odds ~15%. → We only open PRs with green CI.
https://www.alphaxiv.org/abs/2601.15195

**C22 [Primary]** 567 Claude Code–assisted PRs across 157 projects: 83.8% merged, 54.9% of those without modification.
https://arxiv.org/abs/2509.14745

## F. Market and positioning

**C23 [Primary]** Bot traffic passed human traffic on Cloudflare-hosted sites: 57.4% automated vs 42.6% human (June 2026).
https://www.nbcnews.com/tech/tech-news/bot-web-traffic-overtaken-human-web-traffic-data-shows-rcna348522

**C24 [Secondary]** HUMAN Security: agentic AI traffic grew ~7,851% year over year.
https://workos.com/blog/ai-agent-web-traffic-what-developers-need-to-change

**C25 [Primary]** YC hackathon premise: YC's motto is increasingly "make something agents want"; bot and agent traffic now exceeds human traffic. Co-host Manufact sponsors a "Best MCP Server for agents" track [Secondary].
https://events.ycombinator.com/MakeSomethingAgentsWant
https://www.tipranks.com/news/private-companies/manufact-deepens-ai-agent-ecosystem-engagement-with-yc-hackathon

**C26 [Primary]** MCP spec 2025-11-25 lets tools declare `outputSchema`; servers MUST return `structuredContent` that conforms to it (corrected from "SHOULD" after the claims audit re-read the spec). (Our contracts extend this with semantic invariants, per C4.)
https://modelcontextprotocol.io/specification/2025-11-25/server/tools

**C27 [Primary] Adjacent products — what they start from:**
- Spec-diff tools (oasdiff; Speakeasy SDK previews) detect changes *in the spec*. A behavioral change with an unchanged spec is invisible to them.
  https://github.com/oasdiff/oasdiff · https://speakeasy.com/docs/sdks/guides/sdk-preview-breaking-changes
- Sentry Seer Autofix starts from errors: stack traces, breadcrumbs, traces, then opens a fix PR.
  https://sentry.io/seer/
- ApiPatch and similar OSS agents fix breaking changes the LLM already knows about or that appear in spec diffs.
  https://pypi.org/project/apipatch/0.8.2/ · https://github.com/codingwinterz/self-healing-api-agent
- n8n is building an internal "self-healing" agent (PRs dated Oct 2026), a demand signal.
  https://github.com/n8n-io/n8n/pull/40979

**C28 [Inference — wedge]** We start from failures that *don't throw*: semantic contract violations observed in live agent traffic (C3, C4, C7–C9). Spec-diff tools can't see them (C27), error-driven autofix never gets an error (C27). We have not found a product that turns silent runtime violations into verified fix PRs; absence of evidence is not proof, so say "we haven't found one."

**C29 [Secondary — price anchor only]** Sentry Seer reported at ~$40 per active contributor per month on top of a paid plan.
https://devtoollab.com/blog/best-ai-bug-detection-tools

## G. Known unknowns (do not bluff these)
- Hackathon judging criteria and submission format: not public. Get from the Discord before M5.
- Real-world precision of contracts on third-party servers: unmeasured. Our bench uses seeded drifts.
- Whether vendors or agent operators pay first: unvalidated. Talk to 3+ MCP server maintainers at the event.
