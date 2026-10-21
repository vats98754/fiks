# Do maintainers accept bot- and agent-authored PRs, and why? (area: gap-maintainer-acceptance)

Written 2026-10-21 for the fiks paper. Machine-readable catalog: `gap-maintainer-acceptance.sources.json` (33 sources). Existing claim IDs reused: **C21** (`ehsani2026failedagenticprs`), **C22** (`watanabe2025claudecodeprs`). Existing catalog keys reused: `repairnator`, `maddila2025metaagent`, `passerine-google`, `marginean2019sapfix`.

**Bottom line.** **C21 is verified in the full text, with three caveats.** Ehsani et al. (MSR 2026, arXiv 2601.15195v1) report:
- 33,596 agent PRs, of which 71.48% (24,014) were merged (Sec. 3, RQ1).
- From a logistic regression: "each additional failed CI check decreases the odds of a merge by about 15%" (coef −0.1579, OR 0.85, Table 1).

The caveats:
1. The 71.48% denominator includes still-open PRs. A companion paper on the same data reports 6.9% open; closed-only studies report 79.89%.
2. The pool is dominated by self-initiated Codex PRs. Codex has 21,799 PRs (65%) with an 82.59% merge rate, and 28.3% of all PRs merge "instantly". This is not "an outside bot convinced a stranger".
3. CI is read on the PR's *last* commit, and the paper does not say whether the model is multivariable. The 15% is an association, not the effect of a gate.

The right base rate for fiks (a bot proposing a fix to a tool owner) is lower and depends on the setting:
- 37.38% of all bot PRs on GitHub, 2019–20 (`wyrich2021botsdontmind`).
- 32% for Greenkeeper (`mirhosseini2017greenkeeper`, secondary).
- 70.13% for Dependabot in projects that kept using it (`he2023dependabot`).
- 31.5% of reviewed agent fixes at Meta (`maddila2025metaagent`).
- 64% for agent *fix* PRs vs 84% for docs PRs (Ehsani et al.).

Evidence that tests in a PR raise acceptance is **mixed**. Maintainers *say* tests are a positive signal (`gousios2015integrators`, `bettenburg2008goodbugreport`). In mining studies, test inclusion has no consistent independent effect (`haque2026testsagenticprs`, `nachuma2026collabsignals`, `zhang2021prdecisions`). The one strong quantitative link between machine evidence and acceptance is **Dependabot's compatibility score**, a cross-repo CI pass rate: <80% gives a 30.20% merge rate and ≥95% gives 80–84% (`he2023dependabot`, Table 6).

---

## 1. Scope and searches run (2026-10-21)

**Questions.**
- (Q1) Re-verify C21 in full text, plus the AIDev line and its 2025–26 follow-ups.
- (Q2) Bot-PR acceptance: Greenkeeper, Dependabot, Wessel et al. on noise, Repairnator, and Meta/Google figures.
- (Q3) Do tests, repro steps or CI evidence in a PR raise acceptance or speed review?
- (Q4) For each study, what are the denominators, and what does "merged" mean?

**Method note (deviation).** This area's first WebSearch call returned "web search budget is used up". The 200-call limit is shared by all agents in the turn. No further web searches were run. Discovery used:
1. Direct WebFetch of known arXiv IDs (abs, then html or pdf full text).
2. Reference lists of fetched papers (2601.15195; He et al. 2023) to find bot-PR studies.
3. The MSR 2026 Mining Challenge track listing (`msr2026-mining-challenge`). It lists ≈ 60 AIDev papers, which was used to find the 2026 follow-ups and their preprint links.
4. Author homepages (mairieli.com) for Wessel's bot papers.

Downloaded PDFs went to a scratchpad folder and were converted with `pdftotext`. Bot-protected or 403 pages (dblp, ACM DL, IEEE Xplore) were not bypassed. **Not opened:**
- Mirhosseini & Parnin ASE'17 primary PDF (404). Numbers come from He et al.'s related work.
- Alfadel et al. MSR'21 (same route).
- Gousios et al. ICSE'14 and Tsay et al. ICSE'14 (the findings come via Gousios et al. 2015).
- Several MSR'26 papers that show no preprint link: Peralta et al.; Wang & Yang; Pinna et al.; Alam et al.; Abujadallah et al.; Gonzalez & El Mezouar; Hoseinpour et al.; Oukay et al.

A follow-up session with search budget should look for those.

**Fetches (all 2026-10-21):**
- arXiv abs, html or pdf: 2601.15195 (3 passes over the full text), 2507.15003, 2509.14745, 2601.03556, 2601.21194, 2602.19441, 2601.00753, 2601.19287, 2602.17084, 2103.03591, 2103.13950, 2103.13547, 1810.05806, 2206.07230, 2105.13970, 2507.18755, 2402.09171.
- PDFs: pcanelas.com (LGTM), zenodo 18008772 (Strauss & Schulze), gousios.org (integrators), thomas-zimmermann.com (Bettenburg), mairieli.com (CSCW'18).
- Docs, pages and repos: Hugging Face AIDev card; GitHub Dependabot docs; github.com/aavetis/PRarena; daniel.haxx.se; qemu.org; wiki.gentoo.org.

## 2. Source catalog

| # | Source | Year | Type | Central claim | Cluster |
|---|---|---|---|---|---|
| 1 | Ehsani et al., *Where Do AI Coding Agents Fail?* `[ehsani2026failedagenticprs]` **C21** | 2026 | paper (MSR) | 33,596 AIDev-pop agent PRs; 71.48% merged; OR 0.85 per failed check-run; rejection taxonomy (38% abandoned, 23% duplicate, 17% CI/test failure) | A |
| 2 | Li, Zhang & Hassan, *Rise of AI Teammates in SE 3.0* (AIDev) `[li2025aidev]` | 2025 | paper | 456k agent PRs. Acceptance in the abstract: Codex 64%, Devin 49%, Copilot 35%, about 15–40 pts below humans. Codex accepted PRs have a 0.3 h median turnaround | A |
| 3 | AIDev dataset card `[aidev-hf]` | 2026 | other (dataset) | v4 is 2.74M PRs (cutoff Nov 2025); v5 at 7.6M is in progress; CC-BY-4.0 | A / baseline |
| 4 | Watanabe et al., *On the Use of Agentic Coding* `[watanabe2025claudecodeprs]` **C22** | 2025/26 | paper (TOSEM) | 567 Claude Code PRs: 83.77% merged vs 91.00% for matched human PRs (closed only). 54.9% of merged PRs were not modified after submission | A |
| 5 | Haque, Ingale & Csallner, *Tests in Agentic PRs* `[haque2026testsagenticprs]` | 2026 | paper (MSR) | Test-inclusion rose from 31% to 52%. Merge rate of test vs non-test PRs differs little, except Devin (44.1 vs 60.6). Test PRs take longer | C |
| 6 | Milanese et al., *Human-Agent vs Human PRs: testing-focused* `[milanese2026testingfocused]` | 2026 | paper (MSR) | 42.9% of agent PRs vs 40.0% of human PRs include tests (OR 1.13). Acceptance not analyzed | C |
| 7 | Branco et al., *LGTM! Auto-merged agentic PRs* `[branco2026lgtm]` | 2026 | paper (MSR) | Many agent PRs merge with no review. Repos auto-merge all or none. Two repos account for 37.2% of AIDev-pop PRs | A / D |
| 8 | Strauss & Schulze, *Why and when agentic PRs are (not) accepted* `[strauss2026whywhen]` | 2026 | paper (MSR) | Closed-only acceptance is 79.89%. 84.1% of agent PRs close within 60 min, and lift > 1 holds only for age < 5 min | A / D |
| 9 | Nachuma & Zibran, *Collaboration signals* `[nachuma2026collabsignals]` | 2026 | paper (MSR) | Outcomes: 71.5% merged, 21.6% closed, 6.9% open. Reviewer engagement is the strongest correlate; touching tests has no significant independent effect | A / C |
| 10 | Minh et al., *Early prediction of review effort* `[minh2026revieweffort]` | 2026 | paper (MSR) | 28.3% of agent PRs merge instantly (Codex 42.9%). The apparent CI benefit vanishes once agent identity is controlled | A / D |
| 11 | Haider & Zimmermann, *Themes in reviewing agentic code* `[haider2026reviewthemes]` | 2026 | paper (MSR) | 19,450 inline comments on 3,177 agent PRs; reviewers focus on docs, refactoring and style | C |
| 12 | Watanabe K. et al., *How AI coding agents communicate* `[watanabe2026communicate]` | 2026 | paper (MSR) | Agent PR-description styles vary and are associated with reviewer engagement and merge (abstract only) | C |
| 13 | MSR 2026 Mining Challenge track `[msr2026-mining-challenge]` | 2026 | other | ≈ 60 AIDev papers, at least 10 of them on acceptance or rejection; AIDev-pop is 33,596 PRs, 2,807 repos | A (index) |
| 14 | PR Arena `[prarena]` | 2026 | repo | Live GitHub-search counts. "Ready PR" success rates of 64–96% per agent; the formula is unclear (Cursor shows 101.66%) | A (counter-example) |
| 15 | Wyrich et al., *Bots don't mind waiting* `[wyrich2021botsdontmind]` | 2021 | paper (BotSE) | 20.6M PRs (2019-01 to 2020-05): bot PRs 37.38% merged vs human 72.53%; bots wait longer | B |
| 16 | He et al., *Dependabot in practice* `[he2023dependabot]` | 2023 | paper (TSE) | 502,752 Dependabot PRs in 1,823 projects: 70.13% merged, median 0.18 days. Compatibility score <80% gives 30.20% merged | B / C |
| 17 | Mirhosseini & Parnin, Greenkeeper `[mirhosseini2017greenkeeper]` | 2017 | paper (ASE), secondary | Greenkeeper PRs 32% merged; updates 1.6× more frequent; update suspicion and notification fatigue | B |
| 18 | Alfadel et al., Dependabot security PRs `[alfadel2021dependabotsecurity]` | 2021 | paper (MSR), secondary | 65.42% of Dependabot security PRs merged, mostly within a day | B |
| 19 | GitHub Docs, Dependabot compatibility score `[github-dependabot-compat-score]` | 2026 | tool-docs | The score is the % of CI runs that passed for the same update in other public repos | C |
| 20 | Wessel et al., *The Power of Bots* `[wessel2018powerofbots]` | 2018 | paper (CSCW) | 93 of 351 (26%) popular projects use bots. No consistent before/after difference in PR metrics. Bots are "not smart enough" | B |
| 21 | Wessel et al., *Don't Disturb Me* `[wessel2021dontdisturb]` | 2021 | paper (CSCW) | 21 interviews; noise is "a recurrent and central problem" of PR bots | B |
| 22 | Wessel et al., *Quality Gatekeepers* `[wessel2022qualitygatekeepers]` | 2022 | paper (EMSE) | RDD on 1,194 projects: adopting a code-review bot increases monthly merged PRs and reduces non-merged PRs | B / C |
| 23 | Monperrus et al., Repairnator `[repairnator]` | 2018 | paper | 5 human-accepted patches. Expedition 1: 15 build-passing patches from 3,551 reproduced failures, none human-competitive. PRs were sent under a human persona because of bias against bots | B / E |
| 24 | Maddila et al., Meta test-failure agent `[maddila2025metaagent]` | 2025 | paper | 1,589 diffs published, 1,285 reviewed, 405 landed (31.5% of reviewed). Top rejection reason: test already fixed or flaky (47/100) | E |
| 25 | Passerine at Google `[passerine-google]` | 2025 | paper | Plausible ≠ valid. Validity is judged by authors, not by maintainer merge | E |
| 26 | Alshahwan et al., TestGen-LLM at Meta `[alshahwan2024testgenllm]` | 2024 | paper (FSE ind.) | Engineers accepted 73% of filtered test recommendations for production | E / C |
| 27 | SapFix (Meta blog) `[marginean2019sapfix]` | 2018 | blog | Auto-generated fixes are never deployed without engineer approval | E |
| 28 | Gousios et al., *Integrator's perspective* `[gousios2015integrators]` | 2015 | paper (ICSE [verify venue]) | 749 integrators say tests are a positive signal, yet earlier mining found test inclusion "not a strong factor" | C |
| 29 | Zhang et al., *Pull Request Decision Explained* `[zhang2021prdecisions]` | 2021/23 | paper (TSE) | 3.35M PRs: same_user explains 31% of variance; ci_failed_perc explains 18% when CI is used; test_inclusion is not in the top factors | C / D |
| 30 | Bettenburg et al., *What makes a good bug report?* `[bettenburg2008goodbugreport]` | 2008 | paper (FSE) | Developers rate steps to reproduce (83%) and test cases (51%) most helpful. Reporters rarely provide them. The authors call for capture/replay tools that record tests | C |
| 31 | Stenberg, *Death by a thousand slops* `[stenberg2025slops]` | 2025 | blog | About 20% of curl security reports in 2025 were AI slop; about 5% were genuine | F |
| 32 | QEMU code-provenance policy `[qemu-ai-policy]` | 2025–26 | spec (policy) | QEMU declines contributions believed to include AI-generated content | F |
| 33 | Gentoo AI policy `[gentoo-ai-policy]` | 2024 | spec (policy) | Contributions created with NLP AI tools are forbidden (Council, 2024-04-14) | F |

**Clusters.**
- A: agent-PR acceptance (AIDev line).
- B: classic bot PRs.
- C: what evidence drives acceptance (tests, CI, repro).
- D: self-merge and denominator artifacts.
- E: industrial repair and test bots with human review.
- F: maintainer pushback against AI contributions.

## 3. Clusters

**A. Agent-PR acceptance (AIDev, 2025–26).** One dataset (AIDev, Li et al.) feeds almost every 2026 paper. Its versions are:
- v1 (Jul 2025): 456k PRs.
- v3 (Oct 2025): 932,791 PRs.
- v4: 2.74M.
- v5: 7.6M, in progress.

The enriched subset AIDev-pop has 33,596 PRs from 2,807 repos with > 100 stars. Headline merge rates on it run from 71.5% (all PRs) to 79.9% (closed only). Codex is the high outlier at 82.6%, and Copilot the low one at 43.0% (Ehsani). The earliest snapshot (500+ stars, 7,122 PRs) gave lower acceptance: Codex 64%, Devin 49%, Copilot 35%, with humans 15–40 pts higher. A separate study of Claude Code PRs (C22) found 83.77% merged vs 91.00% for humans on closed PRs. Task type matters: docs PRs merge at 84%, fixes at 64%, performance PRs at 55% (Ehsani).

**B. Classic bot PRs (2017–2023).** Bots author about a third of GitHub PRs (Wyrich). Their unconditional merge rate is about half the human rate: 37.38% vs 72.53%. Bot PRs also wait longer for interaction, even though they are smaller. Dependency bots are the best-studied case:
- Greenkeeper: 32% merged. Developers grew suspicious after a bad update, and too many PRs caused notification fatigue (Mirhosseini & Parnin, via He et al.).
- Dependabot (native): 70.13% merged among 1,823 projects that kept it with ≥ 10 merged PRs; 74.53% for security PRs. 11.3% of projects deprecated it.

Wessel's interview and survey work names noise as the central cost. One causal-design study (RDD) finds that adopting a code-review bot raises merged PRs per month.

**C. What evidence drives acceptance.**
- *Stated preference:* integrators (n = 749) treat tests and green CI as positive signals. Bug fixers rate repro steps and test cases most helpful (n = 156 developers).
- *Revealed preference:* in large mining studies, test inclusion is weak or null once size and process are controlled (Gousios 2014 and Tsay 2014 via Gousios 2015; Zhang 2021; Nachuma 2026; Haque 2026). The CI failure share is important where CI exists (Zhang: 18% of variance; Ehsani: OR 0.85 per failed check-run).
- *The strongest machine-evidence link* is Dependabot's compatibility score, a cross-repo CI pass rate. Merge rates are 30.20% below a score of 80% and 84.43% for 95–99%, with Spearman ρ = 0.37. Only 3.4% of PRs carry a score.

**D. Self-merge and denominator artifacts.**
- The top factor for PR decisions is whether submitter and integrator are the same user (Zhang).
- Agent PRs are often created *by the repo owner through the agent*. Codex "acts under user credentials" (Branco).
- 28.3% of agent PRs merge instantly; Codex has 42.9% instant merges, Copilot 0.1% (Minh).
- 84.1% of agent PRs close within an hour, and acceptance lift exists only for PRs younger than 5 minutes (Strauss).
- Two repositories account for 37.2% of AIDev-pop PRs (Branco).

So the "agent PR merge rate" mostly measures how often owners keep their own agent's work. It does not measure how often maintainers accept outside bot contributions.

**E. Industrial repair and test bots with human review.**
- Meta test-failure agent: 31.5% of reviewed diffs landed (405/1,285). Most negative comments said the test was already fixed or flaky (47/100 sampled comments).
- Meta TestGen-LLM: 73% of filtered test recommendations were accepted. Additive tests are lower-risk than fixes.
- SapFix: human approval is mandatory.
- Repairnator: 5 merged patches. It hid its bot identity because "human engineers do not accept contributions from bots as easily".

**F. Maintainer pushback.**
- QEMU (declines suspected AI content) and Gentoo (forbids it) have policies against AI-generated contributions.
- curl's maintainer reports that about 20% of 2025 security reports were AI slop and about 5% were genuine.

These are policy and anecdote, not rates. They do show that "AI-authored" can be grounds for rejection on its own, whatever the PR's quality.

## 4. Contradictions and why they disagree

| # | Contradiction | Why they disagree | Consequence for fiks |
|---|---|---|---|
| X1 | Agent PR merge rate: 71.48% (Ehsani) vs 79.89% (Strauss) vs 71.5% / 21.6% / 6.9% split (Nachuma) vs 64/49/35% (Li v1) vs 90–96% "ready PRs" (PRarena) | **Denominator:** Ehsani divides by all PRs including open (24,014/33,596); Strauss and Haque use closed only; PRarena uses "ready" (non-draft) PRs. **Snapshot and filter:** 500+ stars, Jul 2025 (Li) vs 100+ stars, Oct 2025 (AIDev-pop). **Agent mix:** Codex is 65% of AIDev-pop | Cite C21 as "71.48% of all PRs, open included". Never compare it with a closed-only rate |
| X2 | Claude Code merge rate: 83.77% (Watanabe, C22) vs 59.04% (Ehsani) vs 70.6–72.1% (Haque, closed) vs 52.5% (Li v1, Table 5) | **Identification** ("Generated with Claude Code" in the PR body vs AIDev's agent label). **Closed-only and human-matched** sampling in C22 (797 found, 54 open excluded, 176 unmatched dropped). **Small n** (459 in Ehsani) | C22 is not comparable to C21. Quote both with their denominators |
| X3 | Bot PRs: 37.38% merged (Wyrich) vs > 70% (He, Dependabot) | **Selection on adoption:** He keeps only projects with ≥ 10 merged Dependabot PRs, active, and with a dependabot.yml; Wyrich takes all of GitHub, open included. **Bot type:** Wyrich's pool includes pull[bot] mirrors and learning-lab bots | An opted-in owner (Dependabot-like) is the right setting for fiks. A stranger bot is not |
| X4 | Tests: integrators say tests are a positive signal (Gousios 2015) vs mining finds test inclusion weak or null (Gousios 2014, Tsay 2014, Zhang 2021, Nachuma 2026, Haque 2026) | **Stated vs revealed preference.** **Confounding:** test PRs are much larger (Claude median churn 1,736 vs 183 LOC, Haque) and size lowers merge odds. **Measurement:** "touches a test file" is not "contains a failing-then-passing repro". Gousios notes the modelling change (continuous vs dichotomous) | Mining gives no evidence that an F→P repro raises acceptance. It has to be tested directly (HA3) |
| X5 | CI: each failed check lowers odds ≈ 15% (Ehsani); ci_failed_perc is a top factor (Zhang) vs CI's "benefit disappears once agent identity is controlled" (Minh) | **Endogeneity and timing:** Ehsani reads check-runs on the *last* commit, so abandoned PRs stay red and merged PRs were fixed to green. Ehsani does not report whether the model is multivariable. Minh controls for agent | C21 motivates "don't show maintainers red PRs". It does not show that a CI gate causes merges |
| X6 | Industrial acceptance: Meta fix diffs 31.5% of reviewed vs TestGen-LLM 73% vs Dependabot 70% | **Change type** (additive test vs behaviour change vs version bump) and **filter strictness** before human exposure | fiks PRs change behaviour, so the relevant prior is 31.5–64% (Meta; agent fix PRs), not 70%+ |

## 5. Claim ledgers (deep-read sources)

**Ehsani et al. 2026, arXiv 2601.15195v1 (MSR 2026), C21.**
- *Data:* AIDev-pop, "over 33k PRs submitted by five major coding agents across GitHub projects with more than 100 stars" (Sec. 1). n = 33,596. Per agent: Codex 21,799; Copilot 4,970; Devin 4,827; Cursor 1,541; Claude Code 459.
- *Merge rate:* "Across all agents, 71.48% of PRs (24,014) are successfully merged." (Sec. 3, RQ1). Per agent: Codex 82.59%, Cursor 65.22%, Claude Code 59.04%, Devin 53.76%, Copilot 43.04%.
  - "Merged" is not formally defined. Not-merged PRs may be "left open or marked as rejected", and 24,014/33,596 confirms open PRs are in the denominator. Nachuma et al. report 6.9% open on the same subset.
- *CI:* the authors query "the status of the last commit in the PR" and "extract the number of failed check-runs" (Sec. 2).
  - Table 1 gives #Failed CI Checks: coef −0.1579, OR 85%, Cliff's δ −0.24, significant.
  - Text: "each additional failed CI check decreases the odds of a merge by about 15%."
  - Not reported: single vs multivariable model, standard errors or CIs, and how many PRs have CI data. The p-value column is garbled in the HTML.
- *By task:* docs 84%, CI 79%, build 74%, fix 64%, perf 55%.
- *Rejections (n = 600 sampled; 562 coded):* abandoned or not reviewed 228; duplicate 142; CI/test failure 99; incorrect 19; incomplete 15. The paper's percentages use 600 as the denominator, although only 562 were coded.
- *Verdict:* **C21's numbers are VERIFIED.** The wording needs the caveats above. Suggested rewrite: "In 33,596 agent-authored PRs in GitHub repos with > 100 stars (AIDev-pop), 71.48% were merged (open PRs counted as not merged). In a logistic model, each additional failed check-run on the PR's last commit was associated with about 15% lower merge odds (OR 0.85)."

**Watanabe et al., arXiv 2509.14745v3 (TOSEM), C22.**
- 567 Claude Code PRs across 157 projects, each matched to a human PR.
- Identification: PR body contains "Generated with Claude Code". 797 found; 54 open excluded; 176 dropped with no human match.
- Merged: 475/567 = 83.77%, vs 516/567 = 91.00% for human PRs (χ², p < 0.05). Median time to merge 1.23 h vs 1.04 h (n.s.).
- Of merged agent PRs, 54.94% merged as a single commit (261), vs 58.53% for human PRs (n.s.).
- Of rejected agent PRs, 64.1% got no feedback.
- 45.1% of merged agent PRs were revised after submission: bug fixes 47.7%, docs 29.0%, refactoring 27.1%.
- Reviewers added tests to 16.4% of revised agent PRs.
- **C22 is VERIFIED**, with the denominator "closed PRs only". The paper itself notes survival bias (Sec. 7.2).

**He et al. 2023 (TSE), arXiv 2206.07230v3.**
- 1,823 projects, selected for ≥ 10 merged Dependabot PRs, ≥ 10 stars, active, and with dependabot.yml history. 502,752 regular PRs plus 13,406 and 23,907 security PRs.
- Merge rate is "the proportion of merged PRs". Values are 70.13%, 73.71% and 76.01%. Median merge lag is 0.18 days (≈ 4 h), against a 3.00-day median close lag.
- Table 6 links the compatibility score to merge rate: unknown 69.96% (n = 485,501); < 80% 30.20%; 80–90% 67.48%; 90–95% 73.19%; 95–99% 84.43%; = 100% 80.30%. Spearman ρ = 0.37.
- Related work, secondary for Greenkeeper: "only 32% of Greenkeeper PRs are merged", with "update suspicion" and "notification fatigue" as the two causes.
- 11.3% of projects deprecated Dependabot.
- **Takeaway:** a machine-computed safety signal attached to a bot PR has a large association with merging: 30% → 84% across score bands. It is the closest published analogue of the before/after evidence fiks attaches.

**Wyrich et al. 2021 (BotSE), arXiv 2103.03591.**
- GHTorrent, 2019-01-01 to 2020-05-31, with a data gap from Jul 2019 to Jan 2020.
- Human PRs: 13,770,280; 72.53% merged. Bot PRs: 6,853,040 from 4,654 bot logins; 37.38% merged (Table II).
- "Total includes all PRs in the dataset ignoring their current status". Merged means "marked as such, regardless of whether human or bot merged it."
- Mean time to merge: 10.09 h for bot PRs vs 14 min for human PRs.
- **Takeaway:** this is the unconditional base rate for a bot's PR, and it is about half the human rate.

**Haque et al. 2026 (MSR), arXiv 2601.03556.**
- AIDev-pop; closed PRs only (31,284 of 33,596).
- "Test PR" means the PR adds or modifies a file matching test-path heuristics.
- Merge rate, non-test vs test (Table 4):

| Agent | Non-test | Test |
|---|---|---|
| Claude | 70.6% | 72.1% |
| Codex | 86.2% | 85.2% |
| Copilot | 53.8% | 56.8% |
| Cursor | 75.6% | 71.6% |
| Devin | 60.6% | 44.1% |

- Test PRs have longer turnaround for 4 of 5 agents.
- No significance tests and no size controls.
- **Takeaway:** among agent PRs, adding tests does not reliably raise merge rate.

**Branco et al. 2026 (MSR), LGTM.**
- "Auto-merge" = "merging a PR without reviews or review comments, and without comments from anyone other than the author or bots".
- Repos tend to auto-merge all agent PRs or none. Auto-merged PRs are smaller.
- `mochilang/mochi` and `MontrealAI/AGI-Alpha-Agent-v0` "represent 37.2% of PRs". The authors analyze per repo to correct for this.
- Codex "act[s] under user credentials".
- **Takeaway:** pooled AIDev merge rates are heavily driven by self-merging owners and a few repositories.

## 6. What this means for fiks

**Where fiks differs from the populations studied.**
1. fiks is a *third-party bot opening a fix PR for the tool owner*. This matches Dependabot or Repairnator, not Codex or Claude Code, where a developer asks their own agent and then merges.
   - The comparable priors are 37.38% (all bot PRs), 32% (Greenkeeper), 70% (Dependabot among adopters), 31.5% (Meta fixes, reviewed) and 64% (agent fix PRs, own repos).
   - C21's 71.48% is not the expected acceptance of a fiks PR, and the paper must not imply it is.
2. fiks attaches what the literature says reviewers want but rarely get:
   - steps to reproduce and a test case (Bettenburg: 83% and 51% of developers rate these important; reporters find test cases hardest to provide);
   - green CI (Gousios 2015; Zhang: ci_failed_perc);
   - a verifiable safety signal (Dependabot compatibility score).

   This is a *design rationale* grounded in stated preferences and one strong correlational analogue. It is not evidence that acceptance will rise.
3. fiks's CI-before-PR gate removes the "CI/test failure" rejection class (17% of rejected agent PRs in Ehsani's sample). It does nothing for the two largest classes: abandoned or not reviewed (38%) and duplicate PR (23%). At Meta the top negative-comment reason was "test already fixed" (47/100).

**Where fiks is weaker.**
- There is no maintainer outside the authors. Today's PRs are opened on our own shop-mcp repo, so any merge figure is author-merged: the "same_user" condition that Zhang finds most predictive and that Branco and Minh show inflates agent merge rates.
- Bot identity bias (Repairnator) and outright bans (QEMU, Gentoo) are acceptance factors that no gate can address.
- Noise: an always-on proxy could open many PRs. Greenkeeper's fatigue and Wessel's noise theory predict rejection by volume.

**Strongest reviewer counter-argument.**

> "Your CI gate addresses a minority cause of rejection. Mining studies show acceptance is driven by who opens and who merges, reviewer engagement, size, duplicates and abandonment, not by tests. C21 itself is a correlation measured at the PR's last commit, in a pool dominated by self-merged Codex PRs. You have shown no maintainer would merge a fiks PR."

*Answer to prepare:*
- (a) Reword C21 with its denominators and caveats (§5).
- (b) Claim CI-before-PR only as an operational property: no red PR is ever exposed (H17, descriptive). Do not claim it as an acceptance driver.
- (c) Report acceptance only from the planned blind review (G12, H9 secondary), with an explicit prior band of 31.5–64% for fix PRs.
- (d) Add a duplicate/staleness check: "already fixed upstream?", as in Meta's rules engine. Report its hit rate.
- (e) Rate-limit PRs and group them per contract, as Dependabot users do, to address noise.

## 7. Candidate hypotheses (each with its falsifier)

| ID | Hypothesis | Measure | Falsified if |
|---|---|---|---|
| HA1 (feeds H9 secondary, G12) | Blind reviewers judge gated fiks PRs "merge as-is or with minor edits" more often than ungated-arm PRs for the same drifts | Proportion with Wilson CI; paired by drift; κ between 2 reviewers | Paired difference ≤ 0, or CI includes 0. Also report the absolute rate against the 31.5–64% prior band |
| HA2 (evidence ablation) | The same diff with fiks's evidence block (trace, F→P repro, before/after) gets higher reviewer confidence and shorter time-to-decision than the diff with a plain description | Within-reviewer randomized order; 1–5 confidence; seconds to decision | No difference in confidence or time. This would match mining's null test-inclusion effect (Haque, Nachuma) |
| HA3 (re-analysis of C21) | In AIDev-pop, the failed-check association survives (i) excluding open PRs, (ii) excluding instant or self-merged PRs, (iii) controlling for agent, size and repo (mixed model), and (iv) using CI at the *first* commit | OR per failed check with 95% CI under each specification | OR CI includes 1 once agent and repo are controlled, or under first-commit CI. Then C21 should be cited only as descriptive |
| HA4 (duplicates) | A pre-PR "already fixed upstream / duplicate" check removes the largest rejection class without lowering true-fix recall | Share of candidate PRs suppressed; manual check of the suppressed ones | The check suppresses ≥ 1 true needed fix, or suppresses nothing in a setting with known duplicates |
| HA5 (noise) | Grouping by contract and a PR rate limit keep fiks below N open PRs per repo per week under live traffic | PRs per repo-week in replay | Volume exceeds the per-week limit stated in PLAN.md |

## 8. Candidate baselines we could actually run

1. **AIDev-pop re-analysis (HA3).**
   - Data: AIDev on Hugging Face (`hao-li/AIDev`, CC-BY-4.0; each repo keeps its own licence).
   - How: Python script under `paper/scripts/`. Load the PR, repo, commit and review tables. Recompute 71.48% (all) and the closed-only rate, then rerun Ehsani's logistic model with agent, size, task type and repo random effects.
   - Check-run data would need GitHub API reads. These are read-only and need no GitHub writes, but a token's rate limit applies. Commit CSVs and logs, never numbers typed by hand.
2. **Bot-PR prior table.** No run needed. Cite the rates in §4 X3/X6 with their denominators as the comparison band for G12.
3. **PR-description ablation (HA2).** Render each fiks PR twice: with the evidence block and with a plain "Fix X" description. Show reviewers in random order. The cost is only human time, which needs user approval (G12).
4. **Blind-review rubric.** Reuse Passerine's validity categories (`passerine-google`) plus a "would merge" item. Two reviewers; report κ.
5. **Open-then-iterate arm (H17).** Already in SYNTHESIS: a Seer/Bits/Engine-style flow that opens the PR first and then fixes CI. Count red-check exposures.

## 9. Open gaps

- **Primary PDFs not opened:** Mirhosseini & Parnin ASE'17 (32%, 1.6×) and Alfadel et al. MSR'21 (65.42%) are cited only through He et al. A citation verifier should fetch the primaries.
- **MSR'26 acceptance papers with no preprint found:** Peralta et al.; Wang & Yang ("Do AI-generated PRs get rejected more?"); Pinna et al. (task-stratified); Alam et al. (fix-related unmerged); Abujadallah et al. (rejected fixes); Gonzalez & El Mezouar; Hoseinpour et al. (test failures); Oukay et al. (reverts). The fix-related papers bear most on fiks.
- **Ehsani's model specification** (multivariable? n with CI data?) is not stated. Ask the authors or check their replication package.
- **Two inconsistencies in the papers themselves:**
  - Ehsani's taxonomy percentages use 600, not 562.
  - Li v1's text acceptance (Codex 64%, Copilot 35%) differs from its Table 5 (65.3%, 38.2%).
- **No study measures a third-party bot's fix PR with an attached F→P repro.** This is the gap fiks's blind review can fill, carefully. Repairnator is closest (5 merged patches, persona hidden).
- **No 2025–26 study found** on maintainers' acceptance of Sentry Seer, Datadog Bits, Copilot Autofix or LangSmith Engine PRs. Vendors publish speed or volume figures, not merge rates by external maintainers.
- **The live web was not searched in this pass** (shared budget exhausted). A follow-up should search 2026 sources on GitHub PR restrictions for AI contributions, and any Dependabot/Renovate merge-rate updates after 2023.
