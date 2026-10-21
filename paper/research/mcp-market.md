# MCP market infrastructure (as of 2026-10-21): what checks tool outputs, and what happens next

Area: mcp-market. Researcher run: 2026-10-21. Companion file: `mcp-market.sources.json` (49 sources, keys used below in `[brackets]`).
Claim IDs from `RESEARCH.md` are reused where the same source is cited (C26 = MCP spec outputSchema; C27 = adjacent products; C28 = wedge; C3/C4 = MCP fault taxonomy; C11 = Outcome Monitors).

## 1. Scope and method

**Question.** For each on-market MCP gateway, proxy, scanner, inspector or SDK, judging from official docs, repos and issue trackers only: does it (a) validate tool outputs against a schema, (b) check outputs semantically, (c) only log or trace, (d) alert, (e) generate tests, (f) repair code or open PRs? What is the license, and can we run it locally as a baseline?

**Method.** Web searches (WebSearch, standard; one extended), then WebFetch of the official page for every product in the matrix. GitHub repos were read through `gh api` (README, plugin folders, licenses, issues). The installed `@modelcontextprotocol/sdk@1.32.0` in `~/fiks/node_modules` was grepped for client-side validation. When a page could not be opened or only a search snippet was seen, the item is marked **[verify]**.

**Searches run (2026-10-21):**
1. Docker MCP Gateway documentation interceptors
2. Kong AI Gateway MCP plugin ai-mcp-proxy docs
3. Azure API Management MCP server expose REST API as MCP docs
4. IBM ContextForge MCP gateway plugins output guardrails
5. Lunar MCPX gateway docs tool customization audit
6. Stacklok ToolHive docs MCP optimizer telemetry vMCP
7. Cloudflare MCP server portals AI Gateway MCP observability docs
8. Invariant Labs mcp-scan Snyk agent scan proxy guardrails tool output
9. MCP Inspector outputSchema structuredContent validation
10. agentgateway MCP Linux Foundation docs observability authorization
11. Amazon Bedrock AgentCore Gateway MCP interceptors response
12. Cisco mcp-scanner open source YARA LLM behavioral analysis
13. developers.cloudflare.com MCP server portals logs tool calls
14. Smithery docs MCP server observability logs analytics
15. Composio MCP docs tool output observability logs; Composio docs tool router MCP observability logs (extended)
16. MCPJam inspector evals MCP server testing
17. Enkrypt AI Secure MCP Gateway output guardrails
18. Lasso Security MCP gateway open source plugins
19. microsoft mcp-gateway github kubernetes reverse proxy MCP
20. modelcontextprotocol conformance test suite
21. Invariant Gateway guardrails MCP tool output rules
22. Datadog MCP server monitoring LLM observability
23. Boomi acquires Lunar.dev MCPX
24. IBM Agent Lifecycle Toolkit ALTK silent error review (then resolved through GitHub)
25. Keploy MCP server test generation record replay traffic
26. Sentry MCP server monitoring tool calls spans docs
27. Datadog Bits AI Dev Agent opens pull requests fixes errors
28. MCP python SDK server validates structured output against outputSchema
29. Apigee MCP server Google Cloud API hub MCP tools docs
30. MCP gateway validates tool response against outputSchema structuredContent enforcement (extended)
31. Composio "self-healing" tools schema drift patch production calls (extended)
32. docs.stacklok.com toolhive telemetry; github docker mcp-gateway interceptors; Cloudflare MCP portals cloudflare-one

**Deep-read (full page or full README plus code):** MCP spec tools page (2025-11-25 and 2026-07-28), the two official SDK clients, Docker MCP Gateway interceptors, IBM ContextForge (README, plugin docs, `schema_guard`, `citation_validator`, `webhook_notification`, `json_repair`, issue #4208), Azure APIM (overview, monitoring, validate-content), Composio MCP Gateway page, ALTK Silent Review.

## 2. Feature matrix (official docs only)

Legend: **Y** = documented; **–** = not documented (absence in docs, not proof of absence); **hook** = user code can do it via a documented post-call hook; **sec** = security-content checks only (PII, secrets, DLP, injection); **LLM** = model-judged.

| Product (source key) | Output schema validation | Semantic output checks | Log / trace | Alert | Generates tests | Repairs code / opens PR | Post-call hook | License | Local baseline? |
|---|---|---|---|---|---|---|---|---|---|
| MCP spec 2025-11-25 / 2026-07-28 `[mcp-spec-*]` [C26] | server MUST conform; client SHOULD validate | – | client SHOULD log | – | – | – | n/a | spec | n/a |
| MCP TS SDK client `[mcp-ts-sdk-client-validation]` | **Y** (throws on missing or invalid structuredContent) | – | – | – | – | – | – | MIT/Apache | **Yes** (already in fiks deps) |
| MCP Python SDK client `[mcp-python-sdk-client-validation]` | **Y** (jsonschema, raises) | – | – | – | – | – | – | MIT/Apache | Yes |
| Docker MCP Gateway `[docker-mcp-gateway-run]` `[docker-mcp-gateway-interceptors]` | – | sec (block-secrets) | **Y** (log-calls, telemetry) | – | – | – | **Y** after:exec/docker/http | MIT | **Yes** |
| Kong AI MCP Proxy `[kong-ai-mcp-proxy]` `[kong-mcp-overview]` | – (structured output listed "Not Supported") | – (guardrails "Not Supported") | **Y** logs, metrics, audit | – | – | – | – | Enterprise license | No (license) |
| Azure API Management `[azure-apim-*]` | REST-level `validate-content` exists; MCP-scope body access breaks stream | – | **Y** (gen_ai.* telemetry; payload opt-in) | via Azure Monitor (generic) | – | – | trace policy only | proprietary | No |
| IBM ContextForge `[contextforge-*]` | **Y** core structuredContent check (#4208) + `schema_guard` plugin (subset) | partial: `citation_validator` (link reachability), ALTK plugins (LLM) | **Y** OTel | **Y** `webhook_notification` on violation | – | – (json_repair rewrites the payload, not code) | **Y** tool_post_invoke | Apache-2.0 | **Yes**, strongest |
| Lunar MCPX → Boomi AI Gateway `[lunar-mcpx-repo]` `[boomi-*]` | – | – | **Y** usage, latency, errors, audit | – | – | – | – | MIT core; Boomi proprietary | Yes (core) |
| Stacklok ToolHive / vMCP `[toolhive-*]` | – | – | **Y** OTel, Prometheus (args sanitized; response = size only) | example Prometheus rules (error rate, latency) | – | – | – | Apache-2.0 | Yes |
| Cloudflare MCP portals `[cloudflare-*]` | – | sec (DLP blocks response) | **Y** Access logs, Logpush (Enterprise) | – | – | – | – | proprietary | No |
| AWS AgentCore Gateway `[aws-agentcore-interceptors]` | – | – | – | – | – | – | **Y** RESPONSE Lambda | proprietary | No |
| agentgateway (LF) `[agentgateway-repo]` | – | sec (regex guardrails, general) | **Y** OTel | – | – | – | – | Apache-2.0 | Yes |
| Microsoft mcp-gateway `[microsoft-mcp-gateway]` | – | – | **Y** telemetry | – | – | – | – | MIT | Yes (k8s) |
| Portkey MCP Gateway `[portkey-*]` | – | sec/policy (output-stage guardrails) [verify GA] | **Y** full response logged | – | – | – | Y | MIT (gateway core) [verify MCP part] | Partly |
| LiteLLM MCP guardrails `[litellm-mcp-guardrails]` | – | sec (post_mcp_call scans structuredContent strings) | Y | – | – | – | **Y** | mixed OSS/enterprise [verify] | Yes |
| Lasso MCP Gateway `[lasso-mcp-gateway]` | – | sec (secrets, PII) | **Y** xetrack | – | – | – | plugins | MIT | Yes |
| Enkrypt Secure MCP Gateway `[enkrypt-secure-mcp-gateway]` | – | **LLM** relevancy, adherence, hallucination (vendor API) | Y | – | – | – | Y | Apache-2.0 (needs Enkrypt key) | Partly |
| Smithery `[smithery-build]` | "protocol compliance" | – | **Y** analytics | – | – | – | – | proprietary | No |
| Composio MCP Gateway `[composio-mcp-gateway]` | – | – | **Y** metadata audit ("payloads are never stored") | – | – | **claims** self-patching of managed toolkits from production calls; no tests or PR described | – | proprietary | No |
| Snyk Agent Scan (ex mcp-scan) `[snyk-agent-scan]` | – | static risk scoring of tool descriptions/skills | – (does not log calls) | background reports to Snyk | – | – | – | Apache-2.0 | Yes (but not in path) |
| mcp-scan ≤0.5 proxy + Invariant Guardrails `[mcp-scan-0-3-4]` `[invariant-guardrails]` | – | **rules** over ToolOutput (user-written) | Y | – | – | – | Y | Apache-2.0 | **Yes** (rule engine local) |
| Cisco MCP Scanner `[cisco-mcp-scanner]` | static schema analyzer (input/output schema `$ref`) | static + LLM: docstring vs code | – | – | – | – | – | Apache-2.0 | Yes (static) |
| MCP Inspector `[mcp-inspector]` | likely via TS SDK client [verify] | – | interactive | – | CLI assertions (hand-written) | – | – | MIT→Apache-2.0 | Yes |
| MCPJam `[mcpjam-inspector]` | – | LLM evals (hand-written cases) | Y (JSON-RPC traces) | – | hand-written evals/E2E in CI | – | – | Apache-2.0 | Yes |
| MCP conformance suite `[mcp-conformance]` | **Y** wire messages vs spec schema | – | – | – | scenario suite (protocol) | – | – | [verify] | Yes |
| ALTK Silent Review `[altk-silent-review]` | – | **LLM** accomplished/partial/not | – | – | – | – | agent-side | Apache-2.0 | **Yes** |
| Datadog Bits AI Dev / Bits Code `[datadog-bits-dev-agent]` | – | – | Y (APM) | Y | flaky-test fixes only | **Y** PRs from errors; never auto-merges | – | proprietary | No |
| Sentry MCP spans + Seer [C27] `[sentry-mcp-module]` | – | – | **Y** result content optional | Y | – | Seer: PRs from errors [C27] | – | proprietary SDK OSS | No (Seer) |
| Grafana MCP observability `[grafana-mcp-observability]` | – | – | **Y** metrics | (Grafana generic) | – | – | – | proprietary cloud | No |
| Keploy `[keploy]` | – | – (oracle = recorded response) | records traffic | – | **Y** tests + mocks from traffic | – | – | Apache-2.0 | Yes (Linux eBPF best) |
| fiks (this paper) | Y (outputSchema) | **Y** deterministic invariants, units, freshness, read-after-write | Y receipts + traces | receipt in-band | **Y** F-gated repro test | **Y** gated PR, never merges | is a proxy | — | — |

**Reading of the matrix.** Every gateway in the market logs MCP traffic. Several expose a post-call hook (Docker, ContextForge, AgentCore, Portkey, LiteLLM, Lasso). The output checks that ship are of three kinds: (i) JSON-Schema conformance (both official SDK clients, ContextForge core and `schema_guard`, Azure `validate-content` for REST); (ii) security-content scanning (secrets, PII, DLP, prompt injection); (iii) LLM-judged relevance or "silent error" review (Enkrypt, ALTK). We found **no product documenting deterministic semantic invariants on MCP outputs** (units, ranges, freshness, read-after-write). We also found **no product that turns an output violation into a reproduction test or a code PR**. The only output-to-repair claim is Composio's vendor-side self-patching of its own managed toolkits. Its example is triggered by an HTTP 400, and no tests or PRs are described. This updates C27/C28: still "we haven't found one," now with a documented search of about 30 products.

## 3. Source catalog

| # | Source (key) | Year | Type | Central claim | Cluster |
|---|---|---|---|---|---|
| 1 | mcp-spec-2025-11-25-tools | 2025 | spec | outputSchema: server MUST conform, client SHOULD validate | A Spec & SDK |
| 2 | mcp-spec-2026-07-28-tools | 2026 | spec | structuredContent may be any JSON value; same MUST/SHOULD | A |
| 3 | mcp-ts-sdk-client-validation | 2026 | repo | TS client auto-validates structuredContent, throws | A |
| 4 | mcp-python-sdk-client-validation | 2026 | repo | Python client revalidates, raises RuntimeError | A |
| 5 | docker-mcp-gateway-run | 2026 | tool-docs | block-secrets, log-calls on by default | B Gateways (OSS) |
| 6 | docker-mcp-gateway-interceptors | 2026 | repo | after-interceptors see the full tool response | B |
| 7 | kong-ai-mcp-proxy | 2026 | tool-docs | structured output and guardrails not supported; Enterprise | C Gateways (commercial) |
| 8 | kong-mcp-overview | 2026 | tool-docs | logs, metrics, audit of MCP traffic | C |
| 9 | azure-apim-mcp-overview | 2026 | tool-docs | auth, rate limit, caching, monitoring | C |
| 10 | azure-apim-monitor-mcp | 2026 | tool-docs | MCP-scope body access breaks stream; payload logging opt-in | C |
| 11 | azure-apim-validate-content | 2026 | tool-docs | REST body schema validation, detect/prevent | C |
| 12 | contextforge-repo | 2026 | repo | Apache-2.0 gateway, 40+ plugins, OTel | B |
| 13 | contextforge-plugins | 2026 | tool-docs | tool_post_invoke can modify or block results | B |
| 14 | contextforge-schema-guard | 2026 | repo | result schema subset check, block or annotate | B |
| 15 | contextforge-issue-4208 | 2026 | issue | lenient path let missing structuredContent pass | B / F Real bugs |
| 16 | lunar-mcpx-repo | 2026 | repo | MIT aggregator with live-traffic control plane | B |
| 17 | boomi-lunar-acquisition | 2026 | other | Boomi acquired Lunar.dev; docs redirect | C |
| 18 | boomi-ai-gateway | 2026 | tool-docs | tracks usage, latency, errors | C |
| 19 | toolhive-docs | 2026 | tool-docs | Apache-2.0 runtime, registry, vMCP | B |
| 20 | toolhive-observability | 2026 | tool-docs | traces carry args; response size only | B |
| 21 | cloudflare-mcp-portals | 2026 | tool-docs | DLP-only response blocking | C |
| 22 | cloudflare-portal-logpush | 2026 | tool-docs | per-call metadata, Success/Error | C |
| 23 | aws-agentcore-interceptors | 2026 | tool-docs | RESPONSE Lambda for redactions/additions | C |
| 24 | agentgateway-repo | 2026 | repo | CEL RBAC, OTel, regex guardrails | B |
| 25 | microsoft-mcp-gateway | 2026 | repo | k8s routing, auth, lifecycle | B |
| 26 | portkey-mcp-observability | 2026 | tool-docs | full response logged, no validation | C |
| 27 | portkey-mcp-guardrails | 2026 | tool-docs | output-stage policies on tools/call | C |
| 28 | litellm-mcp-guardrails | 2026 | tool-docs | post_mcp_call scans structuredContent strings | B |
| 29 | smithery-build | 2026 | tool-docs | analytics, protocol compliance | C |
| 30 | composio-mcp-gateway | 2026 | tool-docs | "tools that fix themselves" from production calls | E Repair |
| 31 | snyk-agent-scan | 2026 | repo | static risk scoring, no proxy | D Scanners & testing |
| 32 | mcp-scan-0-3-4 | 2025 | repo | earlier proxy with response guardrails | D |
| 33 | invariant-guardrails | 2025 | repo | Python-like rules over ToolOutput | D |
| 34 | invariant-explorer-shutdown | 2026 | repo | hosted Explorer shut down Jan 2026 | D |
| 35 | cisco-mcp-scanner | 2026 | repo | docstring-vs-code behavioral analysis | D |
| 36 | mcp-inspector | 2026 | repo | interactive/CLI debugging client | D |
| 37 | mcpjam-inspector | 2026 | repo | hand-written evals and E2E in CI | D |
| 38 | mcp-conformance | 2026 | repo | wire-schema protocol conformance | D |
| 39 | lasso-mcp-gateway | 2026 | repo | response sanitization, xetrack | B |
| 40 | enkrypt-secure-mcp-gateway | 2026 | tool-docs | LLM relevancy/adherence/hallucination on outputs | B |
| 41 | altk-silent-review | 2025 | repo | LLM silent-error review; 6.8%→12.7% micro win (BIRD) | E' Detection research-grade |
| 42 | datadog-bits-dev-agent | 2026 | tool-docs | error-driven fix PRs; never auto-merges | E |
| 43 | sentry-mcp-module | 2026 | tool-docs | MCP spans may include result content | C |
| 44 | grafana-mcp-observability | 2026 | tool-docs | usage/latency/success metrics | C |
| 45 | keploy | 2026 | tool-docs | traffic → tests + mocks; recorded-response oracle | E |
| 46 | freerouting-issue-981 | 2026 | issue | outputSchema advertised, no structuredContent; strict clients fail all calls | F Real bugs |
| 47 | harrisoncn-mcp-gateway-pr232 | 2026 | repo | opt-in outputSchema enforcement in a small gateway | B |
| 48 | adaptix-self-healing-registry | 2026 | repo | autonomous runtime repair under schema drift (prototype) | E |
| 49 | mcp-healer | 2026 | repo | input-payload coercion after 400/schema errors | E |

## 4. Clusters

- **A. Spec and SDK floor (1–4).** Output validation is standardized only as JSON-Schema conformance. Both reference clients enforce it by default. So "schema-only" is a free, always-on baseline, and the paper should treat it as the zero point, not as a straw man.
- **B. Open-source gateways and proxies (5, 6, 12–16, 19, 20, 24, 25, 28, 39, 40, 47).** All of them do routing, auth, isolation and telemetry. The more advanced ones expose post-call hooks. ContextForge is the most capable: core outputSchema validation, a `schema_guard` plugin, webhook alerts on violations, and ALTK LLM plugins.
- **C. Commercial and cloud gateways and observability (7–11, 17, 18, 21–23, 26, 27, 29, 43, 44).** Governance plus telemetry. Response bodies are often not captured by default (Azure, ToolHive, Composio). Azure documents that MCP-scope policies must not touch the streamed body. A 200-OK wrong value shows up as `Success`.
- **D. Scanners and testing tools (31–38).** Pre-deployment security scanning (Snyk, Cisco), interactive or hand-written testing (Inspector, MCPJam) and protocol conformance. None derives tests from runtime traffic violations.
- **E. Repair and "self-healing" (30, 42, 45, 48, 49, plus Sentry Seer in C27).** Repair triggers are errors: exceptions, APM errors, HTTP 400s, schema-validation errors. Keploy derives tests from traffic, but its oracle is the recorded response. Composio is the closest commercial claim.
- **E′. Research-grade detection shipped as a library (41).** ALTK Silent Review is the only shipped component explicitly targeting silent tool errors. It is LLM-judged and agent-side, with no repair.
- **F. Real bugs (15, 46).** Gray-failure examples at the protocol or schema layer: a gateway that passed non-conforming results as success, and a public server whose results break strict clients.

## 5. Contradictions and why they disagree

1. **Spec says MUST and SHOULD; gateways mostly do not validate.** The spec requires conforming structuredContent and asks clients to validate `[mcp-spec-*]`. Kong lists structured output as unsupported `[kong-ai-mcp-proxy]`. Azure warns that reading the MCP response body breaks the stream `[azure-apim-monitor-mcp]`. ContextForge treated missing structured output as valid until #4208 `[contextforge-issue-4208]`. *Why:* gateways are built for auth, governance and streaming throughput, and validation sits in the client SDKs by spec design ("Clients SHOULD"). Buffering streamed bodies has a real cost.
2. **mcp-scan then vs. now.** v0.3.4 (Aug 2025) shipped a runtime proxy enforcing guardrails "on MCP tool calls and responses" `[mcp-scan-0-3-4]`. Snyk Agent Scan v0.6+ has only scan and background modes, does not log calls `[snyk-agent-scan]`, and the hosted Explorer shut down in Jan 2026 `[invariant-explorer-shutdown]`. *Why:* after the acquisition the product moved to posture scanning, and runtime guardrails went into Snyk's commercial offering [verify which product]. Evidence that the runtime-output niche is unstable in the market.
3. **Composio: learns from production calls vs. never stores payloads.** The same page claims "Tools learn from real production calls" and "Tool-call payloads are never stored" `[composio-mcp-gateway]`. *Why (inference):* learning may use only error metadata (status codes, error strings such as `invalid_recipient_format`). That would be consistent with an error-driven trigger, and therefore blind to silent wrong values. Not verifiable from public docs.
4. **Strict schema checking: safety vs. availability.** The spec and SDK clients reject non-conforming results. In freerouting #981 that made every call of a public server fail `[freerouting-issue-981]`. ContextForge's lenient path did the opposite and masked violations `[contextforge-issue-4208]`. *Why:* the ecosystem has not settled whether a gateway or client should block, annotate or pass a violation. fiks's receipt design (annotate and pass, with an observed fact) is a third option the paper should justify empirically.
5. **Spec revisions.** 2025-11-25 described structuredContent as a JSON object. 2026-07-28 allows any JSON value and adds `$ref` resolution rules for output validation `[mcp-spec-2026-07-28-tools]`. C26 in RESEARCH.md should cite the latest revision.
6. **Enkrypt hallucination check status.** Current docs list relevancy, adherence and hallucination on outputs `[enkrypt-secure-mcp-gateway]`. Older READMEs (search snippets only) listed hallucination as future work. *Why:* version drift in the docs. [verify]

## 6. Claim ledgers for deep-read sources

**MCP spec (2025-11-25 and 2026-07-28) [C26]**
- L1: If outputSchema is present, servers MUST return conforming structured results and clients SHOULD validate them (Output Schema).
- L2: Clients SHOULD "Validate tool results before passing to LLM" and "Log tool usage for audit purposes" (Security Considerations, item 2).
- L3: Tool execution errors are reported in-band with `isError: true`. Clients SHOULD pass them to the model so it can self-correct (Error Handling). A silent fault has `isError: false`, so it never enters this path.
- L4 (2026-07-28): structuredContent may be any JSON value. Clients SHOULD follow `$ref` resolution rules when validating against `outputSchema`.
- Not in spec: any notion of value-level or semantic contract, read-after-write, or freshness.

**IBM ContextForge (repo, plugin docs, plugins, #4208)**
- L1: Apache-2.0, federates MCP/A2A/REST, OTel instrumentation `[contextforge-repo]`.
- L2: `tool_post_invoke` "can modify the result or block it" `[contextforge-plugins]`.
- L3: `schema_guard` checks results for `type`, `properties`, `required` and `items` only. It does not support `enum`, `format` or min/max. It blocks, or attaches `schema_errors` `[contextforge-schema-guard]`.
- L4: Core `ToolService` validates structuredContent against outputSchema, but returned "valid" when structured data was absent (#4208, closed) `[contextforge-issue-4208]`.
- L5: Plugins also include `citation_validator` (URL reachability), `webhook_notification` (alerts on violations), `json_repair` (heuristic payload repair), `circuit_breaker`, `watchdog`, and ALTK-based plugins (read from repo READMEs via `gh api`, 2026-10-21).
- Implication: ContextForge has the parts for detection and alerting. It lacks domain invariants, trace-to-test, and code repair.

**Docker MCP Gateway**
- L1: `--block-secrets` and `--log-calls` default to true `[docker-mcp-gateway-run]`.
- L2: exec, docker and http interceptors can run before or after a call. "After" interceptors receive the tool response as JSON on stdin or POST, and may return a replacement `[docker-mcp-gateway-interceptors]`.
- L3: MIT-licensed, actively maintained (pushed 2026-09-23).
- Implication: a fiks contract checker can run as `--interceptor=after:exec:...` with no new proxy. That supports a portability claim and weakens any novelty claim about the observe step.

**Azure API Management (overview, monitoring, validate-content)**
- L1: MCP governance is rate limits, JWT, IP filtering and caching, applied to all tools of a server at once `[azure-apim-mcp-overview]`.
- L2: Tool arguments and results are not captured by default. Payload logging is opt-in. The docs warn that MCP-scope policies must not read `context.Response.Body` `[azure-apim-monitor-mcp]`.
- L3: `validate-content` validates JSON bodies against schemas (required, types, formats, regex, minimum) in detect or prevent mode `[azure-apim-validate-content]`. Whether it can be attached to the backend REST operation behind a REST-as-MCP server is [verify].
- Implication: the largest enterprise gateway checks output only by schema, and not at MCP scope.

**Composio MCP Gateway**
- L1: "Tools that fix themselves": rate limits, schema drift, malformed params, retries.
- L2: Example: GMAIL_SEND_EMAIL auto-patched after a 400 `invalid_recipient_format` seen in 12% of calls; v2.1.4 "published to every agent."
- L3: No tests, PRs or human review described. Payloads are never stored.
- Implication: closest commercial analogue of fiks's "fix once for all agents" premise, but it is vendor-internal (Composio's own toolkits), error-triggered, and unaudited in public. This is the strongest market counter-example, and the paper must name it.

**ALTK Silent Review**
- L1: A prompt-based LLM judge labels a tool response Accomplished, Partially Accomplished or Not Accomplished, given query, response, spec, input and tool type.
- L2: On BIRD-derived invocable APIs (arXiv 2506.11266), ReAct+Review gets a micro win rate of 12.7% vs 6.8% without review; average loops drop from 8.72 to 7.77.
- L3: Apache-2.0 and runs with any LLM provider. Also wired into ContextForge.
- Implication: this is the detection-side baseline a reviewer will ask for. It detects at runtime and helps retries, like C11, but it never repairs and costs an LLM call per tool call.

## 7. What this means for fiks

**Where fiks differs (supported by the matrix):**
- **Oracle.** Products check structure (schema), safety (secrets, PII, DLP, injection) or LLM-judged relevance. fiks checks deterministic domain invariants and read-after-write postconditions. This is the class C4 says schema cannot catch. We found no gateway documenting this.
- **Trigger.** Every repair product we found triggers on an error: an exception (Seer, C27), an APM or Error Tracking signal (Datadog Bits), an HTTP 400 (Composio example, ADAPTIX, MCP-Healer). fiks triggers on a violated property in a successful response.
- **Artifact.** Nobody turns a runtime output violation into a reproduction test. Keploy turns traffic into tests, but its oracle is "same as recorded" and the dependency responses are mocked from recordings. A test recorded on v1 would likely replay v1 mocks and pass after a v2 upstream drift (inference, test it). fiks's test asserts the violated property against the recorded **v2** upstream response, behind an F gate.
- **Output.** A gated PR on the tool's own repo that never merges, as opposed to vendor-side hot patches (Composio) or agent-side retries (ALTK, C11).

**Where fiks is weaker (be explicit in Limitations):**
- **Observe is not novel infrastructure.** Docker, ContextForge, AgentCore, LiteLLM, Portkey and Lasso all expose post-call hooks. fiks's checker could be one plugin. fiks lacks the auth, RBAC, rate limiting, multi-tenant operation, streaming at scale and OTel export that every gateway has.
- **Contract authoring cost.** Products ship generic checks that need zero per-tool configuration (schema from `outputSchema`, PII detectors, LLM judges). fiks contracts are per-server and hand-written today. The C11 vocabulary limit applies.
- **Evidence scale.** Composio claims production-scale self-patching across all agents. fiks has one seeded server. A reviewer will compare "1 server, 5 seeded drifts" with "every agent on our platform."
- **Coverage of security failures.** fiks does nothing for prompt injection, PII or secret leakage. Gateways do.

**Strongest counter-argument a reviewer would raise.**
"fiks is glue. ContextForge already validates outputs and alerts by webhook. `tool_post_invoke` or a Docker after-interceptor can run any invariant. An LLM judge (ALTK, Enkrypt) needs no hand-written contracts. Error-driven coding agents (Seer, Bits, Composio) already open PRs or hot-patch. On *seeded* drifts, hand-written contracts naturally win."
Required answers:
- (a) Run the gateway, LLM-judge and error-triggered baselines on the same drifts. Add drifts **not** seeded by the contract authors, so recall is not by construction.
- (b) Measure contract-authoring cost, or infer contracts from v1 traffic.
- (c) Show the repro gate matters (repair with vs. without an F-gated test).
- (d) Show recurrence: detection-only leaves the violation rate flat across future sessions.

## 8. Candidate hypotheses (with falsifiers)

- **H-M1 (schema floor).** Stock outputSchema validation (TS SDK client or ContextForge `schema_guard`), with a faithful v1 schema, detects at most the structural drifts (D2-like nulls or renames, if the field is `required`). It misses unit (D1), timestamp-semantics (D5), lost-write (D3) and pagination (D4) drifts. *Falsified if* the schema-only baseline detects ≥ as many drift instances as fiks contracts at equal false-positive rate on v1 traffic.
- **H-M2 (security guardrails are orthogonal).** Security-content guardrails (LiteLLM post_mcp_call, Lasso, Docker block-secrets) flag 0 of the behavioral drifts. *Falsified if* any flags a drift (that would also be a false-positive signal worth reporting).
- **H-M3 (LLM judge vs. contracts).** An LLM post-tool reviewer (ALTK Silent Review with a fixed model) has lower recall on unit and freshness drifts and a higher false-positive rate on v1 than deterministic contracts, and adds ≥1 LLM call per tool call. *Falsified if* ALTK's recall ≥ fiks's recall at ≤ fiks's v1 FP rate.
- **H-M4 (error triggers never fire).** On silent drifts, an error-triggered repair pipeline (repair only when `isError: true`, an exception, or HTTP ≥ 400 is observed; this simulates Seer, Bits or Composio triggering) starts on ≤ 1 of the drifts. *Falsified if* most silent drifts eventually surface as errors within the bench tasks.
- **H-M5 (recurrence).** With detection-only (receipts, or gateway block or annotate), the per-session violation rate stays constant across N future sessions. After a fiks PR merge it drops to 0. *Falsified if* violations decline without a code change (for example through caching or agent adaptation).
- **H-M6 (traffic-recorded tests are not repros).** A Keploy-style test recorded on v1 traffic passes on the unfixed server after v2 drift (no F), because dependency mocks replay v1. *Falsified if* the recorded test fails on v2 for the right reason.
- **H-M7 (portability).** fiks's contract checker run as a Docker MCP Gateway after-interceptor (or ContextForge `tool_post_invoke` plugin) yields identical verdicts to fiks-proxy on all traces, with added median latency < X ms. *Falsified if* verdicts differ or the hook lacks the data needed (for example, raw upstream HTTP is unavailable to a gateway that sits in front of the MCP server; expected limitation).

## 9. Candidate baselines we can actually run

| ID | Baseline | License | How |
|---|---|---|---|
| B1 | Schema-only (SDK client) | MIT/Apache (in deps) | Add `outputSchema` derived from v1 responses to shop-mcp tools. The stock `@modelcontextprotocol/sdk` client then throws on violation. Count detections and v1 FPs. |
| B2 | ContextForge gateway (`schema_guard` + core validation + `webhook_notification`) | Apache-2.0 | `pip install mcp-contextforge-gateway`, register shop-mcp, route bench agent through it, enable plugins in `plugins/config.yaml`. Detection-only arm. |
| B3 | Docker MCP Gateway after-interceptor | MIT | `docker mcp gateway run --interceptor=after:exec:<fiks-check>`. Tests H-M7. Needs Docker Desktop or the CLI plugin. |
| B4 | Invariant Guardrails rules | Apache-2.0 | Express the same invariants as Invariant rules over `ToolOutput` locally. Compares expressiveness and authoring effort. |
| B5 | ALTK Silent Review (LLM judge) | Apache-2.0 | `pip install agent-lifecycle-toolkit`, call `SilentReviewForJSONDataComponent` post-tool with a Claude model. Detection-only and with-retry arms. |
| B6 | Security guardrail negative control | LiteLLM / Lasso (MIT) | LiteLLM `post_mcp_call` PII/injection guardrail or Lasso `basic`/`presidio`. Expected 0 detections (H-M2). |
| B7 | Error-triggered repair | ours | Same repair agent, but triggered only on `isError`, exception or HTTP ≥ 400 (simulates C27 Seer, Bits, Composio). Tests H-M4. |
| B8 | Traffic-recorded tests (Keploy) | Apache-2.0 | Record v1 vendor traffic, replay against unfixed shop-mcp on v2 (H-M6). Linux eBPF is the main path; macOS feasibility [verify]. Could be approximated with fiks's own recorder plus a "same-as-recorded" oracle. |
| — | Not runnable | — | Kong (Enterprise license), Azure APIM, AWS AgentCore, Cloudflare portals, Composio, Smithery, Datadog Bits, Portkey hosted, Enkrypt (vendor key). Describe them in related work only. |

## 10. Open gaps

- **Composio internals:** no public docs on how patches are generated, tested or reviewed, or whether they apply to customer MCP servers. Try a trial account only if the user approves (account creation is out of scope for this agent).
- **MCP Inspector output validation:** not in the docs. Likely inherited from the TS SDK client [verify by running Inspector CLI against a server with a bad structuredContent].
- **Portkey MCP guardrails** GA status, and whether the MCP gateway is in the MIT OSS core [verify].
- **Azure `validate-content`** on the backend operation behind a REST-as-MCP server [verify].
- **HarrisonCN PR #232** mode details (off/audit/enforce) come from a search summary only [verify PR body].
- **Kong** newer versions (3.13+) may change "Not Supported" items [re-check before submission].
- **Snyk** commercial runtime guardrails (post-Invariant) were not examined. Snyk's paid product may include response guardrails [verify].
- **Apigee / Google Cloud API Registry, Gravitee, Pomerium, MintMCP, TrueFoundry, Speakeasy Gram, Arcade:** surfaced by search but not read; they likely fall in the governance/log cluster [verify if a reviewer names one].
- **Real-bug mining:** #4208 and #981 are protocol or schema-level, not the semantic drifts fiks targets. Semantic real-bug candidates must come from the bug-mining areas.
