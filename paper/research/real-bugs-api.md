# Real public-API drifts that silently broke wrappers, SDKs and MCP servers (research area: real-bugs-api)

Author: research swarm, area `real-bugs-api`. Date: 2026-10-21.
Companion files: `real-bugs-api.sources.json` (45 sources), `real-bugs-api.candidates.json` (44 candidates).
Existing claim IDs reused where the source is the same: C3/C4 (MCP fault taxonomy), C13–C16 (drift and undocumented breaks), C26 (MCP `outputSchema`), C27 (spec-diff tools). The keys `godefroid2020diff`, `github-events-2025`, `stategraph-2025-dispatch` and `github-dispatch-2026` match the ones in `api-contracts.sources.json`.

## 1. Scope and searches

**Question.** Which real, public API behavior changes (or long-standing documented behaviors) made open-source clients return wrong data without an error? For each one: was there a client issue and fix, would a provider OpenAPI diff show it, and could fiks replay it offline?

**What counts.** A candidate qualifies when the provider returns a successful response (HTTP 200 or a normal payload) and the data is wrong, missing, truncated, stale, in the wrong unit, or a write was silently dropped. Candidates where the provider changed nothing and the wrapper misread documented behavior are kept but marked `provider_change: no`. Those are latent contract mismatches, not drift, and the paper must keep the two apart.

**Method, and an important limitation.** The swarm-wide WebSearch budget (200 calls per turn, shared) was already used up when this agent started. Every WebSearch call returned "budget used up". So no web-search queries were run for this area. Discovery used:
1. Direct WebFetch of provider documentation and changelog pages I could name from memory (Stripe, GitHub, Shopify, Slack, Discord, Twitch, YouTube, Telegram, PyPI, Atlassian, GitLab, Google Drive/Places, Notion, Microsoft Graph, Meta, Anthropic, OpenAI, Twilio, AWS, Spotify). Each listed fact was fetched on 2026-10-21.
2. Raw client CHANGELOG files fetched from raw.githubusercontent.com and grepped (discord.py, PyGithub, python-gitlab, yfinance, tweepy, pyTwitchAPI, stripe-node, openai-python, anthropic-sdk-python).
3. Blobless bare clones of 14 client repos, with `git log --grep` over commit messages. Repos: dj-stripe, pycontribs/jira, python-telegram-bot, python-slack-sdk, go-github, discord.py, tweepy, litellm, github-mcp-server, octokit paginate plugin, google-api-python-client, shopify-api-ruby, yfinance, jellyfin trakt.
4. `gh api repos/<o>/<r>/issues/<n>` (read-only) to confirm each cited issue/PR's title, dates and body.

No GitHub search API or third-party search proxy was used. Consequence: coverage leans toward repos and providers I could name. That is a selection bias, stated in §10. Several provider pages could not be fetched (X/Twitter docs returned HTTP 402; a Twilio API-changes page returned 404; the Atlassian changelog anchor for the search/jql deprecation was not found). Facts that depend on those pages are marked [verify].

**Tallies.** These come from `real-bugs-api.candidates.json`. The script is in the scratchpad; recompute them before citing.
- n = 44 candidates.
- **Spec visibility.** `spec_visible`: no = 29, unknown = 6, yes = 9.
- **Silence.** `silent`: yes = 36, partial = 8. Partial means silent at the API but loud in at least one client, or silent only for untyped or unpinned clients.
- **Provider change.** `provider_change`: yes = 32 (provider changed behavior); no = 12 (latent mismatch).
- **Client type.** wrapper-lib 23, sdk 12, mcp-server 4, gateway 4, product 1.
- **Client evidence.** 12 candidates have both a client bug report and a fix link. 15 are provider-initiated, silent, and invisible to a spec diff, which is the target class for fiks.
- **Report-to-fix latency.** For the 9 candidates with both an issue/report date and a fix date: median 7 days, range 0 to 1,300 days. The 1,300-day case is PyGithub's 300-file cap. These latencies run from the *report* to the fix. Time from drift onset to report is unknown for all of them (see §10).

## 2. Source catalog

| # | source (key) | year | type | central claim | cluster |
|---|---|---|---|---|---|
| 1 | godefroid2020diff | 2020 | paper | 14 regressions over 17 Azure API versions; 9 in services with the spec held fixed | K1 method / prior art |
| 2 | yasmin2020deprecation | 2020 | paper | 87.3% of breaking web-API versions gave no prior deprecation signal | K1 |
| 3 | github-breaking-changes | 2026 | docs | Adding enum values and fields is "additive", shipped to all versions | K2 provider policy |
| 4 | stripe-upgrades | 2026 | docs | Older SDK majors used the account default version | K2 |
| 5 | stripe-changelog-2022-11-15 | 2022 | docs | `charges` removed; refunds not auto-expanded; new decline codes labelled Breaking | K2, K4 |
| 6 | stripe-currencies | 2026 | docs | ISK/UGX are sent as two-decimal values (100x trap) | K5 units |
| 7 | stripe-search | 2026 | docs | Search not for read-after-write; stale status mismatches | K6 writes/freshness |
| 8 | shopify-versioning | 2026 | docs | Retired versions fall forward silently | K2 |
| 9 | github-commits-doc | 2026 | docs | 300-file and 250-commit caps | K3 pagination |
| 10 | github-contents-doc | 2026 | docs | `content: ""`, `encoding: "none"` for files of 1 MB or more | K4 omission |
| 11 | github-search-doc | 2026 | docs | Partial results on timeout with HTTP 200 | K3 |
| 12 | github-events-2025 | 2025 | blog | Event payload fields removed in place | K4 |
| 13 | slack-2025-rate-limits | 2025 | docs | `limit` cut to 15 for new non-Marketplace installs | K3 |
| 14 | discord-message-content | 2026 | docs | Empty content without the privileged intent | K4 |
| 15 | discordpy-pomelo | 2023 | repo | discriminator "0" required a client fix | K4 semantics |
| 16 | twitch-changelog | 2026 | docs | Fields kept but stale or always-empty | K4 |
| 17 | youtube-revision-history | 2021 | docs | dislikeCount made private | K4 |
| 18 | telegram-bot-api | 2026 | spec | ids exceed 32 bits | K5 |
| 19 | pypi-json-api | 2026 | docs | `downloads` always -1; `releases` dropped on the version endpoint | K4 |
| 20 | atlassian-gdpr-migration | 2018 | docs | username/userKey removed | K4 |
| 21 | jira-pr-2326 | 2025 | issue | search → search/jql, nextPageToken | K3 |
| 22 | gitlab-pagination-headers | 2026 | docs | x-total omitted above 10k records | K3 |
| 23 | python-gitlab-1686 | 2021 | issue | Same omission crashed one client | K3 |
| 24 | gdrive-shared-drives | 2026 | docs | Shared-drive items omitted without flags; short pages | K3/K4 |
| 25 | places-details-doc | 2026 | docs | permanently_closed → business_status | K4 |
| 26 | notion-2025-09-03 | 2025 | docs | Old-version search silently misses multi-source DBs | K4 |
| 27 | msgraph-paging | 2025 | docs | $top may be ignored; headers not carried to later pages | K3 |
| 28 | facebook-graph-v2-4 | 2015 | docs | Fields returned only on request | K4 |
| 29 | anthropic-stop-reasons | 2026 | docs | refusal is HTTP 200; pause_turn must be continued | K7 enum |
| 30 | litellm-23899 | 2026 | issue | refusal fell through to "stop" | K7 |
| 31 | litellm-25517 | 2026 | issue | Cache tokens counted twice (~2x spend) | K5 |
| 32 | litellm-9812 | 2025 | issue | Cache-creation tokens charged twice | K5 |
| 33 | litellm-18750 | 2026 | issue | Negative token counts | K5 |
| 34 | pygithub-1745-2939 | 2024 | issue | 300-file silent cap for ~3.5 years | K3 |
| 35 | ghmcp-3160-3195 | 2026 | issue | Labels silently dropped; fixed by a requested-vs-returned check | K6 |
| 36 | ghmcp-2347-2367 | 2026 | issue | MCP tool truncated to first page | K3 |
| 37 | ghmcp-3417-3419 | 2026 | issue | Empty content for large files reached the MCP tool | K4 |
| 38 | yfinance-price-repair | 2026 | docs | Yahoo prices sometimes 100x wrong; statistical repair | K5 |
| 39 | tweepy-extended | 2023 | docs | Text truncated to 140 chars in compatibility mode | K3/K4 |
| 40 | openai-structured-outputs | 2026 | docs | Refusal item does not follow the schema | K7 |
| 41 | twilio-message-resource | 2026 | docs | price null until after send; status asynchronous | K6 |
| 42 | aws-s3-consistency | 2020 | docs | Eventual → strong read-after-write | K6 |
| 43 | spotify-2024-11 | 2024 | blog | preview URLs removed for new apps | K4 |
| 44 | hyrums-law | n.d. | other | All observable behavior is depended on | K0 framing |
| 45 | fowler-tolerant-reader | 2011 | blog | Be tolerant when reading | K0 counter-position |

## 3. Clusters

- **K0. Framing: why "non-breaking" still breaks.** Under Hyrum's Law, clients depend on observed behavior. Under Tolerant Reader, clients are told to ignore what they do not understand. Together they explain the mechanism: a provider's additive change meets a tolerant client, and the result is a default value instead of an error.
- **K1. Prior empirical and method work.** Web-API breaking changes are rarely announced (yasmin2020deprecation; also C15, and serbout2024semver in api-contracts). Differential testing at the response level does find regressions the spec misses (godefroid2020diff).
- **K2. Version-default triggers (API-16, API-17, plus version gating in API-11/12).** The client code does not change, but the version that answers it does: Stripe's account default for older SDKs, and Shopify's fall-forward. The version diff is in the spec, but the client cannot see that the switch happened. This argues for the receipt recording the served API version.
- **K3. Pagination, truncation and partial results (11 candidates: API-01, 02, 05, 07, 18, 24, 27, 29, 30, 32, 33).** This is the largest real-world class. The seeded D4 is realistic. Real variants are richer than "page 1 only":
  - caps inside a single object (300 files);
  - a body flag for partial results (`incomplete_results`, `incompleteSearch`);
  - count metadata that disappears above 10k;
  - short pages that do not mean "end";
  - headers not carried to later pages;
  - a provider cutting `limit` for one class of apps (Slack 2025).
- **K4. Omission, empty values and removal (12 candidates: API-03, 09, 11, 12, 19, 22, 23, 26, 28, 31, 34, 40).** Some fields are removed outright (Events API, dislikeCount, Jira username). More often the field is *kept* while its value is degraded: always an empty array, stale, -1, or an empty string. A schema check passes every one of these. This is C4's "conforms to the schema but violates assumptions", observed at real providers.
- **K5. Units, accounting and range (6 candidates: API-14, 25, 36, 37, 38, 39).** These are real 100x unit traps (Stripe ISK/UGX, Yahoo cents/pence), 2x accounting errors in a major LLM gateway, negative counts, and 32-bit id overflow. They are the real analogs of seeded D1.
- **K6. Lost writes and freshness (6 candidates: API-04, 06, 15, 21, 41, 42).** GitHub silently dropping labels is a real read-after-write failure (API-04). The official GitHub MCP server fixed it with exactly the postcondition fiks proposes. Eventual consistency (Stripe Search, old S3) and asynchronous fields (Twilio price/status) are documented traps for a naive postcondition. fiks's D3 check therefore needs a consistency-aware read path.
- **K7. Enum and shape additions (4 candidates: API-13, 35, 43, 44).** New values such as `refusal` and `pause_turn` arrive with HTTP 200. Clients map unknown values to a default ("stop"), which turns a safety refusal into a normal completion (litellm #23793/#23899). This is a category the seeded D1–D5 bench does not have.
- **Other (5 candidates).** Version-default and spec contradiction (API-10, API-16, API-17) and semantic mismatches (API-08 issues include PRs; API-20 discriminator "0").

## 4. Contradictions and why they disagree

1. **Is adding an enum value breaking?** GitHub says no: "Adding enum values" is additive and shipped to all supported versions (github-breaking-changes). Stripe labels "Adds new decline codes…" as **Breaking** in its 2022-11-15 changelog (stripe-changelog-2022-11-15). *Why they disagree:* GitHub classifies by wire compatibility (old parsers still parse). Stripe classifies by client behavior (code that switches on codes changes meaning). Our K7 evidence (litellm) supports Stripe's view for agent-facing tools. Most spec-diff tools follow the wire view, so an enum addition shows up as a diff entry but not as "breaking".
2. **Tolerant reader vs fail-loud.** Fowler advises tolerance. Every K4/K7 silent failure here is tolerance working as designed: a missing field becomes null, an unknown enum becomes the default branch. *Why they disagree:* tolerance optimizes availability for human-operated integrations, where a person will notice wrong output later. Agents act on the output immediately (C1, C2, C9). fiks's position: stay tolerant in parsing, but make the tolerance *observable*. That means a receipt `unverifiable`/`violated` instead of silent defaulting.
3. **What does response-level differential testing find?** Godefroid et al. found that all 9 service regressions were *unspecified extra properties*, which are mostly benign. Our candidates are dominated by *value-level* changes (empty, stale, unit, truncated) with identical structure. *Why they disagree:* their oracle is a structural response diff, which flags shape changes and abstracts over values. Value drift needs semantic invariants. Their result is therefore not evidence that silent value drift is rare; their method could not see it.
4. **Spec diff as the main defense (serbout2024semver, oasdiff in C27) vs our tally.** Our tally: 29 of 44 candidates not spec-visible, 6 unknown, 9 yes. *Why they disagree:* spec studies sample changes that are *in* specs by construction. Our sample comes from client bug trackers and changelogs, which over-represent behavioral breaks. Neither sample is unbiased. The paper should report both and not generalize the 29/44 figure.

## 5. Claim ledgers (deep-read sources)

**godefroid2020diff** (full PDF text read)
- L1. Method: test every (client spec version, service version) pair with a RESTler-generated client and diff the responses. Supports: Sec. 2, Fig. 2. Status: verified.
- L2. 14 regressions across 17 versions of the Azure DNS/Network APIs (2016-12 to 2019-04): 5 spec, 9 service. Supports: Abstract; Sec. 4.3. Status: verified.
- L3. All 9 service regressions in Table 2 are "Unspecified property X in service response". 7 were later added to the spec; 2 were never specified. Supports: Table 2. Status: verified.
- L4. Use for fiks: prior art for "service changed, spec fixed". It is also a limit on that prior art, because its oracle is structural. Do not cite it as finding value drift.

**yasmin2020deprecation** (full PDF text read)
- L1. RADA analyzed 2,224 OpenAPI specs of 1,368 APIs from APIs.guru. Supports: Abstract. Status: verified.
- L2. 87.3% of the 251 versions that introduced breaking changes gave no deprecation information in the previous version. Supports: Sec. I; RQ1-Findings. Status: verified.
- L3. Only 3 of 219 deprecation-related APIs used proactive runtime signals (special headers or error codes). Supports: Sec. I. Status: verified.
- L4. Caveat: this is an arXiv preprint (peer-reviewed venue not confirmed [verify]) and covers spec-visible changes only.

**pygithub-1745-2939** (issue and PR bodies read via the GitHub API)
- L1. User report: a commit with 926 files yields `len(commit.files) == 300`, with no error (2020-11-05).
- L2. The fix makes `Commit.files` a PaginatedList and follows Link headers, up to GitHub's 3000-file limit (PR created 2024-04-05, closed 2024-05-28).
- L3. PyGithub's test suite uses recorded HTTP replay data (the `tests/ReplayData` directory exists; listing returned 1,000 entries, the API page cap). So this is a strong candidate for an offline replay experiment.

**ghmcp-3160-3195** (issue and PR read)
- L1. GitHub returns success on issue create/update but drops labels when the caller lacks `AddLabelsToLabelable`. Supports: #3160.
- L2. The fix compares requested labels with the labels returned by the same create/PATCH response, with no extra readback, and returns a partial-failure MCP error. Supports: #3195 "What changed".
- L3. Report to merged fix took 7 days. This is the strongest single precedent for fiks's D3 postcondition. It is also evidence that maintainers fix such bugs quickly *once a user notices*.

**litellm-23899 + #23793** (PR and issue read)
- L1. Anthropic's `refusal` stop_reason was missing from `_FINISH_REASON_MAP` and defaulted to `stop`. Supports: PR body.
- L2. The issue title states the general bug class: "Unmapped finish reasons are mapped to 'stop'". Supports: #23793.
- L3. Anthropic documents `refusal` as a normal HTTP 200. Supports: anthropic-stop-reasons.

**yfinance-price-repair** (doc page and changelog read)
- L1. Yahoo "mixes up currencies e.g. $/cents or £/pence. So some prices are 100x wrong." yfinance detects these statistically (scipy) and flags repaired rows.
- L2. Fixes continue years later. Example: #2907 (2026-07) stops permanently converting GBp/ZAc/ILA prices. Unit drift is ongoing, not a single event.

## 6. What this means for fiks

**Where fiks differs.**
- Existing defenses either diff specs (C27; blind to 29 of 44 here), or have each client hand-code its own detector: yfinance's price repair, github-mcp-server's label comparison, python-gitlab's None handling.
- fiks generalizes the second pattern. A contract vocabulary is checked at the proxy, the observed violation becomes a test, and the patch lands in the wrapper.
- Several fixes in our set are exactly the patch a fiks repair agent would need to write: follow pagination (#2939, #2367), compare requested vs returned (#3195), and add an enum mapping (#23899).

**What the bench should add.** The real data says the seeded D1–D5 set is realistic but incomplete:
- **D6 enum-addition fallthrough** (K7).
- **D7 permission- or config-dependent partial write or empty value** (API-04, API-19).
- **D8 kept-but-degraded field**: stale, always-empty, or sentinel -1 (API-21, 22, 26).
- **D9 accounting identity / range** (API-36–38).

D6, D8 (sentinel) and D9 can be detected with cheap invariants. D8 stale-value cases (Twitch view_count) need ground truth that the proxy does not have. Those should be reported as out of vocabulary (C11).

**Where fiks is weaker.**
1. Some fixes are not code changes. Slack's limit needs Marketplace approval. Discord needs a privileged intent. A repair PR can only add pagination or a clear error.
2. Statistical unit drift (Yahoo 100x scattered in time series) needs distributional detectors, not per-call invariants.
3. Read-after-write against eventually consistent stores produces false positives unless the contract knows the consistency model (Stripe Search, old S3, Twilio).
4. 12 of the 44 are latent wrapper bugs, not drift. A reviewer will say fiks is "just a better test oracle". That is partly true, and fine, but it must be stated.

**Strongest counter-argument a reviewer would raise.** "Maintainers already fix these fast once reported: a median of 7 days across 9 cases, 0–22 days for github-mcp-server and litellm. Typed SDKs catch removals at compile time (stripe-node). So the value is detection latency, and you have no data on time from drift to report."

Answer: concede that repair speed after a report is not the bottleneck in most cases. Make the paper's claim about (a) time from drift onset to detection and (b) the cases nobody reported for years (PyGithub, 1,300 days). Measure (a) on the replay set by injecting each drift at a known time. Do not claim fiks beats humans at fixing.

## 7. Candidate hypotheses (each with a falsifier)

- **H-RB1.** Among real silent API drifts and mismatches in public trackers and changelogs, a majority are not visible in a provider OpenAPI diff. *Falsified if:* after a second, independently sampled set (e.g., GitHub issue search with a fixed query protocol, run when the search budget allows) is classified by two raters (kappa reported), spec-visible ≥ 50%.
- **H-RB2.** On the replayable subset (API-01, 03, 04, 05, 06, 29, 35, 36, 37, 38, plus others with recorded fixtures), fiks's fixed contract vocabulary detects ≥ 80% of the drifts. The vocabulary is: pagination completeness, non-empty for known-good input, closed-world enum, requested-vs-returned postcondition, range/identity. Detection must have 0 false positives on pre-drift replay traffic. *Falsified if:* detection is < 80%, or there is any false positive on pre-drift traffic, or detection is no better than schema-only validation.
- **H-RB3.** Schema-only validation (MCP `outputSchema` [C26] / JSON Schema) detects ≤ 20% of the replayable subset, because shapes are unchanged. *Falsified if:* schema-only detects > 20%.
- **H-RB4.** For replayable candidates with an upstream human fix, the fiks repro test fails on the pre-fix commit and passes on the upstream fix commit (F→P agreement with the human fix) in ≥ 70% of cases. *Falsified if:* < 70%, or if the fiks patch fails the upstream maintainers' own regression test.
- **H-RB5.** Enum-addition fallthrough (D6) is caught by a closed-world enum check with no false positives on v1 traffic, while an LLM-judge monitor misses it in more than half of cases. *Falsified if:* the judge detects D6 at a rate within the CI of the contract check.

## 8. Candidate baselines we could actually run

| Baseline | License | How |
|---|---|---|
| oasdiff on provider specs | Apache-2.0 (oasdiff); specs: github/rest-api-description MIT, stripe/openapi MIT | Diff the spec versions before and after each provider-change candidate. Count which candidates appear as breaking, non-breaking, or not at all. Directly tests H-RB1 on the subset with public specs. |
| JSON Schema / `outputSchema` validation | ajv MIT; MCP SDK | Validate replayed responses against the provider schema or the server's `outputSchema`. Baseline for H-RB3. |
| Upstream human fix as oracle | per repo: PyGithub LGPL-3.0, github-mcp-server MIT, litellm MIT core [verify enterprise dir], python-gitlab LGPL-3.0 [verify], pycontribs/jira BSD-2, yfinance Apache-2.0, discord.py MIT | Fork under vats98754 (ORCHESTRATION rule). Check out the pre-fix commit, replay the recorded response, run the fiks repro, then check out the fix commit. Compare F→P. |
| LLM-judge monitor | n/a (API) | Give the judge the tool call and response. Ask whether the result is correct. Compare against the contract on the same replay set (H-RB5). |
| Detection-only (no repair) | ours | Proxy receipts without a PR. Isolates what repair adds. |
| Hand-coded client detectors | yfinance (Apache-2.0) | yfinance's price repair is a real hand-built detector for unit drift. Use it as a ceiling or comparison for D1-style statistical detection. |

Most practical first set (offline, MIT/BSD/LGPL, fix commit known): API-01 (PyGithub has ReplayData), API-03/04/05/06 (github-mcp-server; the PRs include tests with real response shapes), API-35/36/37/38 (litellm; the PRs include tests), API-29 (python-gitlab).

## 9. Notes for the drift taxonomy (mapping to fiks D-codes)

- **D1 unit** → API-14 (Stripe ISK/UGX), API-39 (Yahoo), API-36/37 (2x accounting).
- **D2 rename/removal** → API-09, 11, 23, 28, 31; kept-but-degraded variants: API-21, 22, 26.
- **D3 lost write** → API-04, 06; consistency caveats: API-15, 41, 42.
- **D4 pagination** → API-01, 02, 05, 07, 18, 27, 29, 30, 32, 33.
- **D5 timestamp/format** → API-20 (format semantics). I found no verified real ISO→epoch timestamp drift in this pass [gap].
- **Proposed new categories:** D6 enum fallthrough (API-13, 35, 43, 44); D7 config/permission-dependent emptiness (API-04, 19, 40); D8 stale/sentinel (API-21, 26); D9 identity/range (API-25, 36, 37, 38).

## 10. Open gaps

1. **Search coverage.** WebSearch budget was exhausted, so the set comes from providers and repos named from memory. Fix: rerun with a fixed query protocol (GitHub issue search per provider × class keywords) once budget allows. Report the sampling frame.
2. **Drift onset to detection time** is unknown for every candidate. Only report-to-fix is measured (median 7 days, n = 9). Required to answer the reviewer's main counter-argument (§6).
3. **[verify] dates.** Discord message-content enforcement (2022), Twitter extended-tweet rollout (2017), Telegram id width change, S3 strong consistency (2020-12), Facebook v2.4 (2015), Spotify preview_url response behavior (null vs absent), Atlassian changelog entry for search/jql.
4. **No verified real timestamp-format drift (D5)** client bug in this pass.
5. **Spec visibility was judged, not computed.** Values marked "unknown" (6) need an actual oasdiff run on archived provider specs. The 9 "yes" values should also be confirmed by running oasdiff.
6. **Stripe ISK/UGX has no client bug instance yet.** Without one, API-14 is a documented trap, not an observed bug.
7. **Licensing.** litellm has a non-MIT enterprise directory and GitHub reports NOASSERTION; python-gitlab also reports NOASSERTION. Confirm before forking.
8. **anthropic-sdk-python changelog.** The `pause_turn` entry links to PR #343, which is an unrelated 2024 PR (probably a generator-repo number). The actual fix commit is ab1ec609 per the changelog line [verify].
