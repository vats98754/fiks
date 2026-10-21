# API contracts and breaking-change detection

Area: api-contracts. Researcher pass 1, 2026-10-21. Machine-readable catalog: `api-contracts.sources.json` (42 entries, keys used below).
Status labels: **[deep-read]** = full text opened and quoted; **[abstract]** = abstract/landing page opened; **[verify]** = existence confirmed but the cited text was not re-opened (do not cite until a verifier opens it).

## 1. Scope and searches

Questions:
1. What fraction of breaking changes are invisible to spec diffs (behavioral vs. syntactic)?
2. Which tools are runnable baselines against a v1→v2 behavioral drift where the OpenAPI document is byte-identical (fiks D1–D5)?
3. Who already detects drift from traffic or infers contracts, and does anyone go from detection to a fix?

Searches run 2026-10-21 (WebSearch standard unless noted):
- empirical study breaking changes web APIs OpenAPI evolution
- behavioral breaking changes web API undocumented change empirical study REST
- oasdiff breaking changes detection; OpenAPITools openapi-diff; Optic diff/capture; Specmatic backward compatibility; Stoplight Prism validation proxy
- Pact consumer-driven contract provider verification; PactFlow bi-directional contract testing
- Schemathesis ICSE 2022; RESTler ICSE 2019; EvoMaster; Golmohammadi REST testing survey
- Brito/Valente "Why and How Java Developers Break APIs"; Li et al. ICWS 2013; Sohan et al. SERVICES 2015; Espinha et al. JSS 2015
- Kong npm breaking changes 68.1%; Venturini TOSEM; Jayasuriya FSE 2024; Mostafa ISSTA 2017; Ochoa "Breaking Bad?"
- AGORA test oracles REST invariants; LLM REST testing 2025 (AutoRestTest, LlamaRestTest, RESTGPT); MASTOR; LogiAgent; ARMeta
- Godefroid differential regression testing REST APIs
- AutoGuard SANER 2025; Lercher microservice API evolution
- Stripe API versioning backward-compatible changes; API drift detection products (Akita, Beeceptor, TDCommons)
- (extended) silent API response change incidents on GitHub; REST drift with unchanged spec, LLM-agent tools, 2026 arXiv
- Hyrum's law (secondary sources only, not catalogued)

Deep-read in full text: Serbout & Pautasso 2024 (PDF, via pdftotext), Chen et al. 2026 SLR (arXiv HTML), Kong et al. 2025 (arXiv HTML), Godefroid et al. 2020 (PDF, via pdftotext). Also read in full: Schemathesis checks reference and stateful-testing guide, oasdiff BREAKING-CHANGES.md, Stripe api-versions page, Prism validation-proxy guide, and fiks's own `packages/vendor-api/openapi.json` + `src/drifts.ts` (for baseline predictions in §6).

## 2. Source catalog

| # | Source (key) | Year | Type | Central claim | Cluster |
|---|---|---|---|---|---|
| 1 | Serbout & Pautasso, How Many Web APIs Evolve Following SemVer? (serbout2024semver) [deep-read] | 2024 | paper | 3,075 OpenAPI histories, 506,273 changes: 1,970 APIs ship breaking changes in minor/patch; ~1/3 of change types are undecidable statically | A |
| 2 | Chen et al., Breaking Changes in Software Ecosystems SLR (chen2026slr) [deep-read] | 2026 | paper | 43 detection approaches: high accuracy on syntactic breaks, limited on behavioral; behavioral breaks evade static detection | A |
| 3 | Kong et al., Breaking Changes in npm (kong2025npm) [deep-read] | 2025 | paper | 68.1% of 1,519 documented breaking changes are behavioral; 19% escape regression testing | A |
| 4 | Godefroid et al., Differential Regression Testing for REST APIs (godefroid2020diff) [deep-read] | 2020 | paper | 14 regressions in 17 Azure API versions: 5 in specs, 9 in services | B, C |
| 5 | Venturini et al., I Depended on You (venturini2023npm) = C15 [abstract+sections] | 2023 | paper | 21.9% of manifesting breaking changes undocumented | A |
| 6 | Mostafa et al., Behavioral Backward Incompatibilities (mostafa2017bbi) [abstract] | 2017 | paper | 296 BBIs in 52 of 68 Java version pairs; mostly undocumented | A |
| 7 | Jayasuriya et al., Behavioral Breaking Changes on Clients (jayasuriya2024bbc) [abstract] | 2024 | paper | 2.30% of 30,548 dependency updates had behavioral breaks hitting client tests | A |
| 8 | Xavier et al., Historical and Impact Analysis (xavier2017apibreak) = C14 [verify] | 2017 | paper | 27.99% of 500K Java API changes break compatibility | A |
| 9 | Ochoa et al., Breaking Bad? (ochoa2022breakingbad) [abstract] | 2022 | paper | 83.4% of 119,879 Maven upgrades comply with semver | A |
| 10 | Li et al., How Does Web Service API Evolution Affect Clients? (li2013webapievolution) [verify] | 2013 | paper | 16 change patterns in 5 web APIs; web-specific migration challenges | A |
| 11 | Sohan et al., A Case Study of Web API Evolution (sohan2015webapievolution) [verify] | 2015 | paper | Change docs/communication often inadequate | A |
| 12 | Espinha et al., Web API Growing Pains (espinha2015growingpains) [verify] | 2015 | paper | Existence only | A |
| 13 | Lercher et al., Microservice API Evolution in Practice (lercher2024microservice) [abstract] | 2024 | paper | 17 interviews/11 companies: ineffective change communication, costly impact analysis | A |
| 14 | Lam et al., Putting the Semantics into SemVer (lam2020semver) [abstract] | 2020 | paper | Contracts as input to compatibility judgement | D |
| 15 | Hatfield-Dodds & Dygalo, Schemathesis (hatfielddodds2022schemathesis) [abstract] | 2022 | paper | Schema-derived PBT; 1.4–4.5x more defects than runner-up | B |
| 16 | Schemathesis checks + stateful docs (schemathesis-checks) [read] | 2026 | tool-docs | response_schema_conformance; ensure_resource_availability; links inferred | B |
| 17 | Atlidakis et al., RESTler (atlidakis2019restler) [abstract] | 2019 | paper | First stateful REST fuzzer; 28 GitLab bugs | B |
| 18 | EvoMaster repo (evomaster-repo) [read] | 2026 | repo | 30+ oracles incl. schema mismatch; black/white-box | B |
| 19 | Golmohammadi et al., Testing RESTful APIs: A Survey (golmohammadi2023survey) [abstract] | 2023 | paper | 92 articles; open oracle challenges | B |
| 20 | Alonso et al., AGORA (alonso2023agora) [abstract] | 2023 | paper | Traffic-mined invariants: 81.2% precision, 6/10 seeded output errors | D |
| 21 | Alonso et al., AGORA+ (alonso2025agoraplus) [abstract] | 2025 | paper | 80% precision on 25 ops/20 APIs; 48% seeded errors; 32 bugs | D |
| 22 | Kim et al., AutoRestTest (kim2025autoresttest) [abstract] | 2025 | paper | LLM+MARL beats 4 black-box tools | B |
| 23 | Zhang et al., LogiAgent (zhang2025logiagent) [abstract] | 2025 | paper | LLM logical oracles: 234 issues, 66.19% accuracy | D |
| 24 | Deng et al., MASTOR (deng2026mastor) [abstract] | 2026 | paper | LLM semantic oracles, 75.4% mutation score | D |
| 25 | Khan et al., ARMeta (khan2026armeta) [abstract] | 2026 | paper | LLM metamorphic relations for REST | D |
| 26 | oasdiff BREAKING-CHANGES (oasdiff-breaking) = C27 [read] | 2026 | tool-docs | Judges changes against the declared contract; ERR/WARN | C |
| 27 | OpenAPITools openapi-diff (openapitools-openapi-diff) [read] | 2026 | repo | compatible/incompatible classification | C |
| 28 | Optic (optic-repo) [read] | 2026 | repo | Spec diff + traffic capture; archived Jan 2026, Atlassian | C, E |
| 29 | Prism validation proxy (prism-proxy) [read] | 2026 | tool-docs | Proxy flags traffic-vs-spec discrepancies | C, E |
| 30 | Specmatic (specmatic-repo) [read] | 2026 | repo | Spec as executable contract tests | C |
| 31 | Pact, How Pact works (pact-how-it-works) [read] | 2026 | tool-docs | Consumer examples replayed against provider | C |
| 32 | PactFlow BDCT (pactflow-bdct) [verify] | 2026 | tool-docs | Static pact-vs-OAS comparison | C |
| 33 | Stripe, How API versioning works (stripe-api-versions) [read] | 2026 | tool-docs | Opaque-string format changes and new fields declared compatible | F |
| 34 | GitHub, Events API payload changes (github-events-2025) [read] | 2025 | blog | Fields removed in place, 200 OK | F |
| 35 | Stategraph, GitHub broke the contract (stategraph-2025-dispatch) [read] | 2025 | blog | 204→200 with body while OpenAPI still said 204 | F |
| 36 | GitHub, dispatch returns run IDs (github-dispatch-2026) [verify] | 2026 | blog | Run details made opt-in | F |
| 37 | Beeceptor drift detection (beeceptor-drift) [read] | 2026 | tool-docs | Traffic-vs-spec drift; AI patch to the spec | E |
| 38 | VISA TDCommons defensive publication 10178 (visa-tdcommons-2026) [abstract] | 2026 | patent | Learn per-endpoint behavioral invariants from traffic; alert on silent drift | E, D |
| 39 | Postman acquires Akita (postman-akita-2023) [verify] | 2023 | blog | Traffic-based API monitoring | E |
| 40 | Mastouri et al., From REST to MCP (mastouri2025resttomcp) [abstract] | 2025 | paper | 88.6% of 116 official MCP servers REST-backed | G |
| 41 | Raj et al., BreakGuard (raj2026breakguard) [abstract] | 2026 | paper | LLM tests detect 30.3% of real BCs; weaker on behavioral | D |
| 42 | Lercher et al., AutoGuard (lercher2025autoguard) [verify] | 2025 | paper | Spec-from-source diff in CI | C |

## 3. Clusters

- **A. Empirical evolution studies (how often, how announced).** Web APIs: Serbout & Pautasso (spec-level, n=3,075), Li 2013, Sohan 2015, Espinha 2015, Lercher 2024 (interviews). Libraries: Xavier 2017 (C14), Venturini 2023 (C15), Mostafa 2017, Kong 2025, Jayasuriya 2024, Ochoa 2022. Synthesis: Chen 2026 SLR.
- **B. Spec-driven API test generation / fuzzing.** RESTler, Schemathesis, EvoMaster, AutoRestTest; survey by Golmohammadi. Oracle = spec + 5xx (+ a few stateful checks).
- **C. Spec diff and contract testing.** oasdiff, openapi-diff, Optic diff, Specmatic, AutoGuard, PactFlow BDCT (static); Pact CDC (example replay, needs provider cooperation); Godefroid's differential regression testing (version-vs-version behavior).
- **D. Oracle / invariant inference.** AGORA/AGORA+ (Daikon over traffic), LogiAgent, MASTOR, ARMeta (LLM oracles), BreakGuard (LLM tests for dependency BCs), Lam 2020 (contracts as compatibility input), VISA disclosure.
- **E. Runtime drift monitoring products.** Prism proxy, Optic capture, Beeceptor drift, Akita/Postman, VISA disclosure. All alert or patch the spec; none found that patches the consuming code.
- **F. Real-world drift incidents and provider policies.** GitHub Events (2025), GitHub workflow dispatch (2025/2026), Stripe compatibility policy.
- **G. MCP bridge.** Mastouri 2025: most MCP servers are thin REST wrappers, so REST drift becomes MCP tool drift.

## 4. Answer to Q1: how much breaking change is invisible to a spec diff?

There is no direct measurement for web APIs. We found no study that takes a population of web-API breaking changes observed in traffic and classifies them as spec-visible or spec-invisible. This is a gap the paper can name. The proxy evidence comes from two independent settings and gives roughly two thirds:
- **npm libraries:** behavioral ("change behavior") breaking changes are 68.1% of 1,519 documented breaking changes (kong2025npm, §3.3.2). Signature/spec-style tooling cannot see these by construction (chen2026slr §3.1: "These changes evade static detection and appear only during execution").
- **Azure REST APIs:** 9 of 14 regressions found by differential testing were service regressions (godefroid2020diff, abstract). Those are measured with the client/spec version held fixed (§2.3), so a spec diff cannot see them by construction. 9/14 ≈ 64%. This is our arithmetic on their counts. It is one API family and one tool's yield, not a prevalence estimate.
- **Spec-level studies are a lower bound on total change.** Serbout & Pautasso rely on oasdiff alone. They classify 33 of 195 change types as undecidable (§3) and write that subtle changes may go undetected (§7.1).

A safe sentence for the paper: "In the two settings where both kinds were counted, behavioral breaks that leave the interface unchanged were about two thirds of the total (68.1% in npm [kong2025npm]; 9 of 14 Azure regressions [godefroid2020diff]). Spec-diff tools cannot see this class by construction [chen2026slr, oasdiff-breaking]." Do not generalize it as a web-API prevalence figure.

Counter-weight on base rates: per-update, client-visible behavioral breaks are rare (2.30% of Maven updates, jayasuriya2024bbc), and semver compliance can be high (83.4%, ochoa2022breakingbad). A monitor will see few true violations per call, so false-positive rate matters more than recall in deployment.

## 5. Contradictions and why they disagree

1. **How often do upgrades break?** Xavier 2017 (C14) reports 27.99% of API changes breaking, and Raemaekers (as cited by Ochoa) reports about one third of releases. Ochoa 2022 finds 83.4% semver-compliant upgrades, and Jayasuriya 2024 finds 2.30% of updates with client-visible behavioral breaks. *Why:* the unit differs (change vs release vs upgrade vs client-impacting update), the corpus and time period differ, and so does the detector (static signature diff vs client test execution). Breaking at the API surface ≠ breaking a given client.
2. **Is documentation the problem?** Kong reports that 95.4% of regression-detected breaking changes are documented. Venturini reports 21.9% undocumented (C15), and Mostafa says most BBIs are undocumented. *Why:* Kong's 95.4% applies only to 173 commits that the regression tests detected, in projects that keep explicit BC notes. The others sample manifesting client breaks. Documented but unread (C13, C16) and undocumented are different failure modes, and fiks covers both.
3. **Does schema validation catch "spec-unchanged" drift?** Our README/C27 wording is that spec-diff cannot see it. That is true. But a *schema-conformance check of live v2 traffic against the unchanged spec* (Prism proxy, Schemathesis `response_schema_conformance`) can catch some of it. In fiks's own vendor spec, `created_at` is `type: string, format: date-time`, and D5 sends a number (`o.created_at.getTime()`, `server.ts:92`). So schema validation at the vendor boundary should flag D5. This is our inference, not yet run. The paper must keep "spec diff" separate from "spec-based runtime validation".
4. **Fix direction.** Drift monitors (Beeceptor, Optic capture) repair the *spec* to match reality. Pact and fiks hold the consumer's expectation fixed and repair or block the *code*. Both are legitimate. Which is right depends on whether the spec or the behavior is authoritative, and for a third-party vendor the consumer cannot change either.

## 6. Claim ledgers for deep-read sources

**serbout2024semver**
- Dataset: 3,075 APIs, 132,909 commits, 2,028 repos, 506,273 changes of 195 types, 16,053 versions (Abstract).
- 96 breaking / 66 non-breaking / 33 undecidable change types; "approx. one third of the changes are undecidable" (§3).
- Best case: 517 APIs consistently use a major version for breaking changes; 1,970 APIs do not always signal them; 927 never break (Abstract; Table 7).
- Uses oasdiff as the only detector; construct-validity threat: subtle changes may go undetected (§7.1).

**chen2026slr** (preprint, not peer-reviewed)
- 97 primary studies; 43 detection approaches "reach high accuracy on syntactic breaks but limited coverage on behavioral ones" (Abstract).
- Defines behavioral breaks as preserving the interface while altering runtime semantics (§3.1).
- Behavioral breaks are studied in only 9 of 21 "Nature" papers. Measuring them needs "manual inspection or test-based oracles" (§3.1, §3.1.2).
- Cites Kong: 1,034 of 1,519 (68.1%) behavioral, and Mostafa: 162/296 BBIs in the top behavioral category (§3.1, Table 2).
- Opportunities: "LLM-augmented behavioral contract inference" and repair. "The bottleneck is contract generation, not verification" (Abstract; §7).

**kong2025npm**
- 381 npm projects; 1,519 breaking-change commits (§3.3.3, §8).
- "Change Behavior BCs make up the largest proportion of all BC types (68.1%)" (§3.3.2).
- 19% of documented BCs cannot be detected via regression testing (§4.1).
- 95.4% of *regression-detected* BCs are documented (165/173; §4.1). This is a narrow scope; do not generalize it.

**godefroid2020diff**
- Two regression types: spec regressions and service regressions. The latter is detected by comparing (c_n, s_n) with (c_n, s_n+1) (§2.3).
- Typical service regression: "the format of the response unexpectedly changes and is undocumented", e.g. renamed response properties, "which is more frequent" (§2.3).
- Spec regressions "may be guessed by statically comparing (diffing)" specs, but confirming them needs testing (§2.3).
- Output comparison has to abstract away nondeterminism (dates, ETags, request IDs, random values) (§3.2–3.3). This is a false-positive source that fiks's semantic invariants avoid by not diffing raw values.
- Results: 17 Azure networking versions, 14 regressions (5 spec, 9 service) (Abstract). Yield depends on RESTler's exploration (§4.6).

## 7. What this means for fiks

**Where fiks differs.**
- *Oracle:* outcome contracts (schema + semantic invariants + read-after-write) at the **MCP boundary**. Prior art uses the vendor spec (B, C), version-vs-version diffs (Godefroid), or mined or LLM invariants offline (D).
- *Trigger:* live agent traffic. There is no fuzzing campaign and no need for both vendor versions to be reachable.
- *Output:* a fail-to-pass repro from the captured upstream exchange plus a gated code PR. Every tool and paper here stops at an alert, a test report, or a spec patch. The VISA disclosure (abstract) stops at "drift alerts". Beeceptor patches the spec. Chen 2026 lists detection plus repair as an open opportunity.
- *Who can run it:* the **consumer** (the MCP server owner) without vendor cooperation. Pact needs the provider to verify pacts, and AutoGuard and MASTOR need provider source.

**Where fiks is weaker.**
- Contracts are hand-written per tool (C11 vocabulary limit). AGORA/AGORA+ infer about 100 invariant types automatically at about 80% precision. fiks currently infers none.
- Detection happens only after an agent hits the drift in production, so at least one bad result reaches an agent (the receipt mitigates this). Schemathesis or Godefroid-style diffing can catch some drifts before deployment.
- Schema-conformance validators would catch D5 (and Schemathesis's stateful `ensure_resource_availability` plausibly D3) on the unchanged spec, so "invisible to spec-based tools" is too strong. The defensible claim is "invisible to spec diff; partially visible to spec-based runtime validation (type-changing drifts only)".
- The seeded spec is permissive. `price` is optional and nullable, and objects allow extra properties. Under a strict spec (`required: [price]`, `additionalProperties: false`), schema validation would also catch D2. A reviewer will say the seeded spec was chosen to disadvantage baselines.

**Strongest counter-argument a reviewer would raise.**
"Version-differential testing (Godefroid 2020) plus a strict schema plus a read-after-write stateful check (Schemathesis) catches D2, D3, D4 and D5 *before* any agent sees them. Date-versioned vendors (Stripe, and fiks's own `vendor-api-version` header) make both versions callable. What is left (D1 cents with an unchanged type) is a one-line range assertion any team would write in a consumer test. The repair half is generic LLM APR."
Answer needed in the paper:
- (a) Run these baselines rather than argue (below) and report per-drift detection.
- (b) Show what each produces. A diff or a failed check is not a repro in the MCP server's own test suite and is not a fix.
- (c) Measure false positives on v1 and on declared-compatible changes (Stripe's opaque-string and new-field policy).
- (d) Add a strict-spec ablation.

## 8. Candidate hypotheses (each with its falsifier)

- **H-AC1 (spec diff blind spot).** oasdiff `breaking` and openapi-diff report 0 ERR/WARN for v1→v2 on every seeded drift. *Falsified if* either tool reports any finding. This is a sanity check with an expected trivial result, so state it as a construction property, not a discovery.
- **H-AC2 (schema validation catches only type-changing drift).** Prism proxy `--errors` and Schemathesis `response_schema_conformance` on v2 with the unchanged spec flag D5 only, among D1, D2, D4, D5. *Falsified if* they flag D1, D2 or D4, or miss D5.
- **H-AC3 (stateful check vs lost write).** Schemathesis stateful `ensure_resource_availability` detects D3. *Prediction uncertain.* If it detects D3, fiks's advantage on D3 is limited to repro + fix and does not include detection. Report either way.
- **H-AC4 (strict-spec ablation).** Making the vendor spec strict (`price` required, non-null, `additionalProperties: false`) lets schema validators catch D2 but still not D1 or D4. *Falsified if* D1 or D4 is caught by schema alone, or D2 is still missed.
- **H-AC5 (differential baseline precision).** Godefroid-style v1-vs-v2 response diffing (via the version header) flags all of D1–D5 but has lower precision than fiks on v1-vs-v1 reruns and on declared-compatible changes. *Falsified if* differential diffing reaches ≥ fiks precision with equal recall after standard abstractions (dates, ids).
- **H-AC6 (invariant inference).** AGORA+ invariants mined from v1 traffic catch D1 and D4 (range or count invariants) on v2. *Falsified if* AGORA+ catches ≥ as many drifts as fiks's hand contracts at ≥ equal precision. Then fiks should adopt inference, and the paper's contribution moves to repro + repair.
- **H-AC7 (actionability).** For every drift detected by any baseline, only fiks yields a fail-to-pass test in the shop-mcp repo plus a green-CI PR. *Falsified if* a baseline's output can be converted into a passing F→P test without manual work. Measure the human minutes needed to turn each baseline's output into a repro.
- **H-AC8 (real-world transfer).** On replayed real incidents (GitHub Events field removal; workflow dispatch 204→200), fiks contracts at an MCP wrapper detect the change, and spec diff of GitHub's published OpenAPI between the before and after dates reports nothing breaking. *Falsified if* GitHub's OpenAPI description changed in the same window to reflect the change.

## 9. Candidate baselines we can actually run

| Baseline | License | How to run against fiks bench | Expected to see |
|---|---|---|---|
| oasdiff `breaking` | Apache-2.0 | `oasdiff breaking v1/openapi.json v2/openapi.json` (identical files) | none (H-AC1) |
| OpenAPITools openapi-diff | Apache-2.0 | Docker `openapitools/openapi-diff --fail-on-incompatible` | none |
| Prism validation proxy | Apache-2.0 | `prism proxy packages/vendor-api/openapi.json http://localhost:<vendor> --errors`; point shop-mcp's vendor base URL at Prism; run bench tasks | D5 (type), others no |
| Schemathesis | MIT | `schemathesis run packages/vendor-api/openapi.json --url http://localhost:<vendor>` against `VENDOR_VERSION=v2` and v1 (FP); default phases incl. stateful | D5; maybe D3 |
| Schemathesis on shop-mcp | MIT | Not applicable directly (MCP, not HTTP). Could wrap via an MCP→HTTP shim; low value | — |
| EvoMaster black-box | LGPL-3.0 | `evomaster --blackBox true --bbSwaggerUrl ... --outputFormat ...` against v2 | D5 via schema oracle; others unlikely |
| RESTler | MIT | compile spec → fuzz-lean against v2 | 5xx only → likely none |
| Differential (Godefroid-style) | ours (re-implement; RESTler is MIT) | replay the same request set with `vendor-api-version` v1 vs v2, diff JSON after abstracting ids/dates | D1–D5 + FPs (H-AC5) |
| AGORA+ / Beet + Daikon | see Zenodo 10.5281/zenodo.14728849 (license [verify]) | mine invariants from v1 traces stored by fiks; check on v2 | D1/D4 plausibly (H-AC6) |
| Pact (consumer side) | MIT | write consumer tests for shop-mcp → vendor with type matchers; verify against v2 vendor | depends on matchers; documents the cost of hand-writing |
| Strict-spec variant | — | tighten `openapi.json` and rerun Prism/Schemathesis | D2 + D5 (H-AC4) |

Not runnable or out of scope: Optic (archived, MIT, runnable but unmaintained), PactFlow BDCT (commercial), Beeceptor/Akita (SaaS), AutoGuard (Spring Boot source only), MASTOR/LogiAgent (research code availability [verify]).

## 10. Open gaps

1. No study measures the spec-visible vs. spec-invisible share of breaking changes for **web APIs from traffic**. Our two-thirds figure comes from npm and Azure proxies. A small mining study (e.g., GitHub REST OpenAPI description history vs GitHub changelog behavior entries) would fill this, but it is a separate project.
2. Real-world incident evidence is anecdotal (vendor blogs, one changelog). The GitHub dispatch case rests on one party's account; GitHub's 2026 changelog is [verify].
3. The full text of the VISA defensive publication is unread. Before claiming novelty, a verifier must check whether it describes test generation or repair.
4. Pact matcher behavior on integer-vs-decimal (D1) is not verified.
5. Licenses and availability of AGORA+ (Zenodo), MASTOR and LogiAgent artifacts are not verified.
6. Brito et al. 2018 ("Why and How Java Developers Break APIs", arXiv:1801.05198) was found but not catalogued. Add it if the paper needs motivations for breaking changes.
7. Entries marked [verify] in the JSON (xavier2017apibreak, li2013, sohan2015, espinha2015, golmohammadi2023 oracle statement, pactflow-bdct, github-dispatch-2026, postman-akita-2023, lercher2025autoguard) need a verifier to open the cited text before use.
