# Real public silent-failure bugs in open-source MCP servers

Area: real-bugs-mcp. Date: 2026-10-21. Companion files: `real-bugs-mcp.sources.json` (26 sources) and `real-bugs-mcp.candidates.json` (68 bug candidates).

## 1. Scope and searches run

**Scope.** Public bugs in open-source MCP servers where a tool returned wrong, empty, null, stale, truncated or corrupted data, or reported success for a write that did not happen, **without** raising an error (`isError` false or no JSON-RPC error). Crashes, auth failures that surface as errors, schema-compatibility errors with LLM providers, packaging bugs and security-only issues are out of scope.

**What I ran (all on 2026-10-21):**

1. **GitHub issue search API** (`gh search issues`, read-only), keywords `silently`, `returns empty`, `returns null`, `truncated`, `pagination`, `only first`, `success but`, `not actually`, `wrong`, `wrong results`, `incorrect`, `missing`, `null`, `empty`, `not saved`. Repositories searched: modelcontextprotocol/servers, modelcontextprotocol/servers-archived (no hits; the archive repo doesn't take issues), github/github-mcp-server, sooperset/mcp-atlassian, cloudflare/mcp-server-cloudflare, korotovsky/slack-mcp-server, taylorwilsdon/google_workspace_mcp, GLips/Figma-Context-MCP, upstash/context7, elastic/mcp-server-elasticsearch. Then the search API hit its rate limit (30/min).
2. **Dumps of all issue and PR titles through the REST API** (core quota), grepped locally with a silent-failure regex. Titles pulled per repo: awslabs/mcp 3,000 (capped), microsoft/mcp 3,000 (capped), googleapis/genai-toolbox 3,000 (capped), grafana/mcp-grafana 1,365, mongodb-js/mongodb-mcp-server 1,606, getsentry/sentry-mcp 1,557, microsoft/playwright-mcp 1,762, hashicorp/terraform-mcp-server 577, stripe/ai 497, supabase-community/supabase-mcp 466, makenotion/notion-mcp-server 351, redis/mcp-redis 186.
3. **GraphQL lookups per candidate**: body, state, `closedByPullRequestsReferences`, cross-referenced PRs, merge commit, base SHA, license, primary language. Then REST lookups for the parent of each fix merge commit (used as `prefix_sha`), plus comment threads for ambiguous closures.
4. **Literature**: arXiv full text or abstract pages fetched directly by known ID. Deep-read in full: Owotogbe et al. 2606.05339 (HTML, first 100k characters) and GitBug-Java 2402.02961 (HTML). Abstract-level reads: Hasan et al., Tambon et al., BugSwarm, the Durieux & Abreu critique, BugsInPy, Multi-SWE-bench, the Gray Failure publication page, and the MCP 2025-11-25 tools spec (read in full).

**Limitation of this run (read before relying on it).** The session-wide WebSearch budget was already used up when this agent started, so **no open-web search succeeded**. Literature coverage therefore comes from known arXiv IDs plus other areas' source files. A 2025–2026 search for other MCP bug-mining or MCP real-bug-benchmark papers is still owed (see Gaps). GitHub coverage is broad for the 22 repositories above. It is not exhaustive: Linear, Atlassian's official remote server and Notion's hosted server are closed-source, and many smaller community servers were not scanned.

## 2. Source catalog

| # | Source | Year | Type | Central claim (short) | Cluster |
|---|---|---|---|---|---|
| 1 | Owotogbe et al., MCP runtime-fault taxonomy [C3] | 2026 | paper | 833 fault threads from 473 servers; gray failures exist; no reproduction or repair | Mining prior art |
| 2 | Hasan et al., MCP at First Glance [C5] | 2025 | paper | 14.4% of 1,899 servers have static bug patterns | Mining prior art |
| 3 | Tambon et al., Silent bugs in DL frameworks | 2021/23 | paper | Definition of a silent bug; 77 reproducible out of 1,168 issues | Definitions |
| 4 | Huang et al., Gray Failure | 2017 | paper | Subtle faults, not fail-stop, cause cloud incidents | Definitions |
| 5 | Silva et al., GitBug-Java | 2024 | paper | 199 bugs, 55 offline runs per bug, 508→199 funnel | Benchmark method |
| 6 | Tomassi et al., BugSwarm | 2019 | paper | 3,091 mined fail-pass pairs | Benchmark method |
| 7 | Durieux & Abreu, Critical review of BugSwarm | 2019 | paper | Only 3.6% of pairs suit repair evaluation | Benchmark critique |
| 8 | Widyasari et al., BugsInPy | 2020 | paper | 493 Python bugs, each with an exposing test | Benchmark method |
| 9 | Defects4J (repo) | 2014 | repo | Real-fault database format | Benchmark method |
| 10 | Zan et al., Multi-SWE-bench | 2025 | paper | 1,632 instances incl. Go and TS | Repair benchmark |
| 11 | MCP spec 2025-11-25, Tools | 2025 | spec | API failures → `isError: true`; outputSchema MUST conform | Normative baseline |
| 12 | servers #4991 + Wave 1 characterization suite | 2026 | issue | Maintainers pinned known silent bugs as tests, then fixed them | Industry practice |
| 13 | github-mcp-server #2347 | 2026 | issue | First-page truncation with no signal (D4) | A: truncation |
| 14 | github-mcp-server #3160 | 2026 | issue | Labels dropped and success returned; only readback reveals it (D3) | B: false success |
| 15 | mcp-atlassian #1500 (+#1189, #1578) | 2026 | issue | Jira writes skipped while success reported | B: false success |
| 16 | cloudflare #418 | 2026 | issue | Over-strict schema discards the whole response → empty | C: silent empty |
| 17 | mcp-atlassian #1652 (+#1736) | 2026 | issue | Connection error / 401 turned into `[]` | C: silent empty |
| 18 | awslabs/mcp #4692 (+#4719, #2050, #4639) | 2026 | issue | NextToken never forwarded | A: truncation |
| 19 | awslabs/mcp PR #4774 | 2026 | PR | Silent empty → agent reports $0 spend; fixed in the description | C + repair target |
| 20 | mcp-grafana #807 | 2026 | issue | ISO timestamp → wrong time window (D5) | D: wrong value |
| 21 | genai-toolbox #4032 | 2026 | issue | HTTP 200 partial write (only the first filter kept) | B: false success |
| 22 | mongodb-mcp-server PR #561 | 2025 | PR | Count = string length | D: wrong value |
| 23 | github-mcp-server #2182 | 2026 | issue | Silent truncation report **not reproducible** | Negative control |
| 24 | Sift gateway | 2026 | repo | Runtime pagination-completeness gateway | Competing approach |
| 25 | terraform-mcp-server #270 (+#531) | 2026 | issue | Empty JSON:API for every query; filter ignored | C / E |
| 26 | servers #4887 | 2026 | issue | Reference memory server drops writes | B: false success |

## 3. Candidate set: summary

68 candidates across 17 repositories, all in `real-bugs-mcp.candidates.json`. Every row was opened via the GitHub API. Its fields are: repo, issue_url, fix_url, prefix_sha, language, tool, symptom, fault_class, upstream_api, offline_mockable, license, repro_score, notes and fix_merged.

- **Languages:** Go 26, TypeScript 22, Python 19, C# 1. Note that fiks's own `shop-mcp` is TypeScript, so a TS-only repair agent covers about a third of the set.
- **Fixes:** 37 have a merged fix (fix SHA known; `prefix_sha` = first parent of the merge commit, or the PR base for unmerged fixes). The rest have an open or unmerged PR, or no fix.
- **repro_score:** 3 → 39, 2 → 18, 1 → 7, 0 → 4.
  - 3 = merged or clearly located fix, exact repro in the issue, offline-mockable.
  - 0 = hosted-only or not reproducible.
- **Offline-mockable "yes": 54/68.** 33 candidates are score ≥2, offline-mockable and have a merged fix. That is the realistic upper bound for a v1 real-bug benchmark, before the GitBug-style attrition expected in §6.
- **Upstream:** 57/68 wrap a remote HTTP/SDK API. The other 11 are local (filesystem, git, memory, browser).
- **Licenses:** MIT, Apache-2.0 and MPL-2.0 dominate. The exceptions need care:
  - getsentry/sentry-mcp is **FSL-1.1-Apache-2.0** (source-available) [verify that research forks are permitted].
  - modelcontextprotocol/servers is mid-relicensing from MIT to Apache-2.0.
  - hashicorp/terraform-mcp-server is MPL-2.0, so patches to its files stay MPL.

**Fault-class distribution** (my own single-coder coding into coarse classes; see Threats):

| Coarse class | n | score 3 | merged fix | maps to fiks seeded drift |
|---|---|---|---|---|
| B. Write not applied / partial write / false success | 20 | 9 | 9 | D3 (lost write) |
| C. Swallowed error or wrong filter → silent empty / partial | 16 | 8 | 8 | none seeded: **new class** |
| D. Wrong, missing or defaulted value (count, boolean, timestamp, field) | 14 | 8 | 9 | D1, D2, D5 |
| A. Truncation / unfollowed pagination | 10 | 8 | 6 | D4 |
| F. Corruption / encoding / serialization | 5 | 5 | 4 | none seeded |
| E. Argument silently ignored | 3 | 1 | 1 | none seeded |

**Top candidates for a fork-only real-bug harness** (score 3, offline, merged fix, upstream HTTP), grouped by fiks drift:

- **D4 (truncation):** github-mcp-server #2347 · slack #101 · awslabs PR #4639 · sentry PR #1319
- **D3 (lost or false write):** github-mcp-server #3160 · mcp-atlassian #1500 · mcp-atlassian #1409 · grafana #731 · Figma #364
- **D2 (dropped or missing field):** github-mcp-server #3190 · grafana #1195 · grafana #963
- **D5 (timestamp):** grafana #807
- **Silent empty:** cloudflare #418 · terraform #270
- **Wrong count:** mcp-atlassian #333 · mongodb PR #561
- **Corruption:** github-mcp-server #3097 · github-mcp-server #3165
- **Ignored filter:** grafana #1110 · terraform #531

**Open bugs with no merged fix** (fiks could produce the first fix, in a vats98754 fork only): mcp-atlassian #1189, #1578, #1652, #1736 · genai-toolbox #4032 · github-mcp-server #3467, #3427 · awslabs #4692, #2050 · servers #5189, #5214 · sentry #1267.

## 4. Clusters

- **A. Truncation without a signal.** The server reads page 1 and drops the cursor, or never forwards it (`NextToken`).
  - Seen in GitHub (#2347), Slack (#101, #148), AWS (aws-network #4692, ECS #4719, Step Functions #2050, HealthOmics #4639), Sentry (#1319) and Stripe hosted (#444).
  - This is the strongest real-world match to seeded D4, and it recurs within one vendor's monorepo (four AWS servers).
- **B. False success on writes.** The tool returns success, a commit SHA or HTTP 200, but the change was skipped, partial, reversed or misdirected.
  - Seen in GitHub labels (#3160), the GitHub wrong-file path (#3427), Jira parent/components/epic (#1500, #1189, #1578), Confluence empty reply (#1409), the Looker filter (#4032), the Grafana rule model (#731), Notion hosted (#258, #283, #121), Figma download (#364), and the memory and filesystem reference servers (#4887, #4628, #4797).
  - Several reporters say outright that only a readback reveals the failure (#3160). That is direct support for fiks's read-after-write postconditions [C4, C8].
- **C. Swallowed error → silent empty.** Catch-all handlers return `[]` on connection errors or 401s (Atlassian #1652, #1736). Skip-and-continue loops return an empty "success" (Azure Backup #3840; filesystem `search_files` #5189). A schema that is too strict discards everything (Cloudflare #418). A wrong filter is indistinguishable from a true zero (AWS cost $0, #4774).
  - fiks has no seeded drift for this class, yet it is the second-largest class here.
  - Each case violates the spec's expectation that API failures surface as `isError` results [mcp-spec-2025-11-25-tools].
- **D. Wrong, missing or defaulted values.**
  - Missing field → default false: GitHub `merged` (#3467).
  - Dropped `start_line`: GitHub #3190.
  - "Unknown" space and empty dates: Confluence #1752.
  - Empty UIDs on an older Grafana: #963, a true upstream-version behavioral drift.
  - Wrong counts: Jira total (#333), MongoDB (#561).
  - ISO timestamp → wrong window: Grafana #807, the D5 analogue.
- **E. Ignored arguments.** Grafana matchers (#1110), the Terraform status filter (#531), `pull_request_read` pagination params (#3316) and git `max_count` (#5214). Output-only contracts catch these only when the invariant ties the output to the input, e.g. "every returned rule matches the matcher".
- **F. Corruption.** Double base64 (#3097), lossy sanitization written back on update (#3165, #2202), `[object Object]` (#468), CRLF → LF (#4991).
- **G. Unreproducible or hosted-only** (score 0–1): GitHub hosted `search_issues` (#3188) and `check_dependency_vulnerabilities` (#3432), Notion hosted tools, the Stripe hosted fix (#444), and the non-reproducible truncation report (#2182).

## 5. Contradictions and why sources disagree

1. **"Schema validation is insufficient" [C3, C4] vs "schema validation caused the failure" (Cloudflare #418).** Both hold. C3/C4 mean that *consumer-side* schema checks miss semantic faults. #418 shows that *server-side* strictness over a whole array turns one odd record into a total silent loss. Implication: fiks should not tell maintainers to "add stricter schemas". The contract that would have caught #418 is semantic: non-empty output for a known-good input.
2. **Issue-mined silent bugs are real (most cases) vs not real (#2182).** A detailed, plausible silent-truncation report was refuted by maintainers. Owotogbe et al. also report heavy false positives in their mining [verify the exact scope of the 80% pilot figure, Sec. 7]. Issue text alone is not ground truth; a benchmark entry needs an executed fail-before/pass-after [GitBug-Java, BugsInPy].
3. **Runtime mitigation suffices (Sift gateway; detection-only, C11) vs code repair is needed.** Sift enforces pagination completeness at the gateway, and its author proposed it as the remedy for awslabs #2050. That works only when the MCP server exposes the cursor. In #4692 and #2050 the server never forwards `NextToken`, so no gateway can recover the missing pages, and the fix has to be in code.
   - The strongest form of the opposing view: for clusters A and C, a generic gateway policy (auto-paginate, turn empty results into warnings) may give most of the agent-side benefit with no PRs at all.
4. **"Fix" means code vs description.** awslabs PR #4774 and github-mcp-server #2343 were resolved partly or wholly by changing tool descriptions or guidance, not logic. So there is no single ground-truth patch for some real bugs. Repair evaluation must accept test-equivalent patches, not diff-identical ones.
5. **Merged ≠ fixed in the shipped artifact.** Several reference-server bugs (#4138, #5059) were closed as "superseded by the v2 release" with no targeted fix or test. Notion #284/#204 report shipped bundles missing merged fixes. "Merged" is a weaker signal than "the regression test passes on the released version".

## 6. Deep-read claim ledgers

**Owotogbe et al. 2026 (arXiv 2606.05339), full HTML, first 100k of 110k characters.**
- Funnel: 78,267 issues + 49,155 PRs → 4,649 fault-related (398 repos) → 2,016 MCP-keyword threads (177 repos) → 833 confirmed (Sec. 4.5). Data collected September 2025 (Sec. 4).
- The repo filter (≥5 contributors, ≥100 commits, ≥10 stars) leaves 473 repos. Analysis focuses on the top 200 by fault-related volume (Sec. 4.1, 4.4), so the corpus is not a random sample.
- "Gray failure" is discussed, not formally defined. Sec. 6: "servers return well-formed JSON-RPC success responses despite incorrect behavior." Tool Result Propagation includes "a success response is returned despite an underlying tool failure" (Sec. 5.5).
- No reproduction, benchmark or repair. Sec. 6 *proposes* fault injection and conformance tests. Quote: "Correctness must therefore be asserted at the behavioral level."
- Replication package: https://figshare.com/s/c1e1e802e1b9f38fddf0 [not opened].
- Internal inconsistencies flagged by the reader: Schema Compatibility is 69% in Sec. 6 vs 58% in Table 1; State & Configuration is 17.1% vs 17.2%. Cite Table 1 values.

**Silva, Saavedra, Monperrus 2024, GitBug-Java (arXiv 2402.02961, MSR 2024), full HTML.**
- Pipeline:
  - 66,042 repos → 1,363 locally executable.
  - 51,276 commits from Jan–Oct 2023 → 508 candidates → 348 (source-only) → 341 (export OK) → 228 (stable over 55 offline runs) → 199 after two-author curation.
- Rule: "The bug-fixes that yield the exact same test results across all 55 executions are kept" (Sec. 2.4). Environments are Docker snapshots taken after running on the fix commit (Sec. 2.3).
- Lesson for fiks: about 39% survival from candidate to benchmark is normal, so 33 strong candidates may yield roughly 13–25 entries [inference, not measured].

**Durieux & Abreu 2019 (arXiv 1905.09375), abstract.** Only 112 of 3,091 BugSwarm pairs (3.6%) suit fault localization or repair evaluation. Mined pairs must be curated, and attrition must be reported.

**Tambon et al. (arXiv 2112.13314), abstract.** A silent bug is one that leads "to wrong behavior but they do not cause system crashes or hangs, nor show an error message". 77 reproducible silent bugs out of 1,168 closed Keras issues (6.6%). Precedent for the definition and for a reproducible-subset ratio.

**MCP spec 2025-11-25, Tools (full page).**
- Tool execution errors, including "API failures", are "Reported in tool results with `isError: true`".
- Servers "MUST provide structured results that conform to this schema"; clients "SHOULD validate".
- Security section: clients SHOULD "Validate tool results before passing to LLM".
- So every bug in cluster C breaks the spec's error-reporting expectation while passing any schema check.

## 7. What this means for fiks

- **Where fiks fits.** The seeded drifts D1–D5 have real counterparts in official vendor servers:
  - D4: GitHub #2347, AWS #4692/#4639
  - D3: GitHub #3160, Jira #1500, Looker #4032
  - D2: GitHub #3190/#3467, Confluence #1752
  - D5: Grafana #807
  - D1 (unit): **no direct real counterpart found**. The closest is the wrong-numeric $0 case (#4774). Seeded D1 should be presented as plausible but not observed here.
- Real bugs come with what the C19 thesis needs: an exact call, an upstream response that can be recorded (botocore Stubber, recorded REST/GraphQL), and a stated violated property. Many reporters even name the readback that reveals the bug.
- **Where fiks differs from prior work.**
  - Owotogbe et al. classify and never reproduce.
  - Hasan et al. analyse statically.
  - GitBug-Java and BugsInPy build from fix commits after the fact.
  - fiks would start from the runtime violation, before any human fix exists. The open bugs listed in §3 are the test of that claim.
- **Where fiks is weaker.**
  1. Two of the largest real classes have no seeded drift: C (swallowed error → silent empty) and F (corruption). E (ignored argument) needs input-output invariants, which the current contract vocabulary may not express [C11 vocabulary limit].
  2. 11/68 bugs are local (filesystem, git, memory). fiks's HTTP record/replay does not apply; they need filesystem or git fixtures.
  3. Concurrency bugs (#4797) make the F gate flaky.
  4. Several fixes are description-only (#4774) or live in another repo (Playwright #1767 fixed in microsoft/playwright).
  5. Hosted-only servers (GitHub remote, Notion, Stripe) cannot be repaired from source at all.
- **Strongest reviewer counter-argument.**
  - "Your real bugs were found and fixed by humans, mostly within days, from issue reports. Many reports are detailed enough to be repairable by SWE-agent-style tools from the issue text alone [C17/C18 context]. What does a runtime-violation repro add over the issue text?"
  - The answer must be experimental: compare repair from the issue text vs from the fiks trace on the same prefixes. Also show detection on bugs *before* their report date (time-to-detect vs issue-opened date).
  - A second counter: contamination. Fixes from 2025 to early 2026 may be in model training data. Stratify by fix date relative to the repair model's training cutoff.

## 8. Candidate hypotheses (each with what would falsify it)

- **H-R1 (coverage).** fiks contracts (schema + semantic invariants + read-after-write), written without seeing the fix, flag ≥70% of the score-3 offline candidates on their buggy prefix and 0 false positives on their fixed versions.
  - *Falsified if* detection is <50%, or more than 1 of the fixed versions is flagged.
- **H-R2 (repro).** For flagged real bugs, the generated repro test fails on `prefix_sha` for the stated property and passes on the human fix commit (F→P) in ≥80% of cases, stable over 10 offline runs.
  - *Falsified if* F→P is <60% or flaky in >10% of cases.
- **H-R3 (repair).** Given the fiks trace, the repair agent produces a patch that passes the human fix's tests and the full prior suite in more cases than the same agent given only the issue text.
  - *Falsified if* the trace condition is not significantly better (paired McNemar, α=0.05) or is worse.
- **H-R4 (open bugs).** On open real bugs with no human fix (e.g. Atlassian #1189/#1652, Toolbox #4032, AWS #4692), fiks produces a green-CI patch in the fork for ≥50%, judged correct by a blinded reviewer.
  - *Falsified if* <25%, or reviewers reject most patches as overfitting [C20].
- **H-R5 (seeded ↔ real transfer).** Detection and repair rates on seeded D-drifts predict rates on the matching real class within ±20 points.
  - *Falsified if* seeded rates exceed real rates by >20 points, which would mean the seeded benchmark is too easy.
- **H-R6 (time-to-detect).** On replayed traffic, fiks flags the bug on the first violating call, which comes before the issue-opened timestamp by construction. This is only meaningful if paired with a measured false-alarm rate on fixed versions.

## 9. Candidate baselines we can actually run

| Baseline | License | How |
|---|---|---|
| Schema-only validation (MCP SDK client `outputSchema` validation) | MIT/Apache (SDKs) | Run the recorded calls through the SDK validators; count detections on the 33 strong candidates |
| Sift gateway (pagination completeness + artifacts) | MIT | Put it in front of buggy-prefix servers for cluster A; measure whether agent answers become complete. Expected to fail where the server drops the cursor |
| Issue-text-only repair (SWE-agent style) | MIT (SWE-agent) or the same Claude agent without the trace | Same prefixes and same agent; input = issue title + body only |
| Static analysis (as in Hasan et al.) | depends on scanner; e.g. Semgrep OSS rules | Run on prefix vs fix; count bugs flagged. Expected near zero for data-dependent bugs |
| LLM-judge monitor | n/a | Judge the tool result given the call; compare with C7's AUROC ceiling |
| Human fix as oracle | repo licenses | Use the human fix's tests as the hidden evaluation suite (SWE-bench style) |

## 10. Open gaps

1. **No open-web literature search was possible** (budget exhausted). Still owed:
   - other 2025–2026 MCP bug-mining or real-bug benchmark papers
   - LLM-agent framework bug studies
   - any "MCP-SWE-bench"-style dataset
   - silent-failure studies of API client libraries (SDK wrappers)

   These must be checked before claiming "no reproducible MCP real-bug benchmark exists".
2. The Owotogbe replication package (figshare) was not opened. It could add up to 833 threads to mine for reproducible candidates.
3. Not scanned: Linear (no OSS server found), Atlassian's official remote server (closed source), Shopify, HubSpot, Datadog, PayPal, Neon, Vercel, Docker Hub, Pinecone, Qdrant, Chroma, Box, Zapier, plus about 50 popular community servers. The title-dump method caps at 3,000 items per repo (awslabs/mcp, microsoft/mcp, genai-toolbox were truncated).
4. `prefix_sha` values marked [verify] (servers #5214, #5059, #4138; mcp-atlassian #1189, #1578; sentry #1267; grafana #1049; hosted cases) need pinning to the last commit before the report.
5. Fault-class coding was done by one coder, me. A second coder and Cohen's κ are needed before any distribution is printed in the paper.
6. Population bias [inference]: a large share of the 2026 reports are long, structured audits, often citing source lines and "KNOWN BUG" waves. Some may be AI-assisted audits. The issue population may therefore over-represent bugs that are easy to find statically. Note this in Threats.
7. None of the 68 candidates has yet been reproduced by us. Every repro_score is a forecast from issue evidence, not a measured F→P.
