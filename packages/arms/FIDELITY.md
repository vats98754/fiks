# Comparator arms: fidelity notes (PLAN 6.2)

Each behaviour of the non-FIKS arms is attributed either to a named product, with its URL and a
quoted passage from a verified source (`paper/research/bibliography.json` key, or the recorded
re-fetch `paper/research/verify/arms-langsmith-recheck.json`), or it is labelled **our parameter**.
`pnpm tsx packages/arms/src/check-fidelity.ts` checks this file: every product in the table has a
URL and a quoted passage, each passage is found verbatim in its recorded source, and the two
Engine strings come from the recorded re-fetch.

No arm emulates a vendor's proprietary root-cause analysis, models, telemetry or sandboxes. How
Engine judges a replay is not stated in any verified passage; our issue validation uses the frozen
deterministic contracts (fiks-iv), which is **our parameter**.

## Named products

| Product | Key | URL | Location | Quoted passage | Emulated behaviour |
|---|---|---|---|---|---|
| Devin Automations | devin-automations | https://docs.devin.ai/product-guides/automations | Trigger table; 'Webhook triggers' section | "Wire any external system (PagerDuty, Datadog, Sentry, custom tools) to Devin via a webhook URL" | The alert reaches the agent as a webhook-style JSON rendered to prose (L1, COMP, REPRO-AGENT). |
| Devin Oncall | devin-oncall | https://docs.devin.ai/product-guides/devin-oncall | Intro paragraph | "Devin starts as soon as an alert, bug report, or incident fires" | An alert starts the agent; REPRO-AGENT's "reproduce the issue" task. |
| Cursor Automations | cursor-automations | https://cursor.com/docs/cloud-agent/automations | 'Triggers' > 'Webhook triggers' | "You can use webhooks to connect automations to internal systems, CI pipelines, monitoring tools, and more." | Monitor-triggered agent run (COMP). |
| GitHub Copilot coding agent | copilot-coding-agent | https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent | Concept page | "run tests and linters in an ephemeral cloud development environment" | The agent runs tests and linters in a sandbox before finishing (all repair arms; Bash allow-list: pnpm typecheck, lint, test). |
| Sentry Seer Issue Fix | sentry-seer-issue-fix | https://docs.sentry.io/product/ai-in-sentry/seer/issue-fix | Issue Fix page: Automation; PR iteration | "Automated attempts are limited to prevent an endless loop." | CI iteration after the PR is bounded (COMP revisions). |
| Datadog Bits AI Dev Agent | datadog-bits-dev-agent | https://docs.datadoghq.com/bits_ai/bits_ai_dev_agent | Capabilities; PR behaviour | "Bits Code never auto-merges PRs or MRs." | A PR is opened (here: `would_open_pr`), never merged by the agent. |
| PostHog Self-driving | posthog-anatomy-pr | https://posthog.com/docs/self-driving/anatomy-of-a-pr | Anatomy of a PR page | "a regression test that reproduces the original failure" | COMP's "reproduce the issue first, then fix"; REPRO-AGENT's one reproducing test. |
| LangSmith Engine | langsmith-changelog-2026 | https://docs.langchain.com/langsmith/changelog | October 5-12, 2026 | "up to three revisions or 90 minutes per chain" | COMP family: at most 3 red-CI revisions within 90 minutes after the PR opens. |
| LangSmith Engine | langsmith-changelog-2026 | https://docs.langchain.com/langsmith/changelog | October 5-12, 2026 | "replays each source run against its fix preview deployment" | COMP: issue validation replays the source call against the candidate head as part of its post-PR checks (`fiks-iv` as a ciLocal extra check). |

Both Engine strings are verbatim in the recorded re-fetch of 2026-10-22
(`verify/arms-langsmith-recheck.json`, section "October 5-12, 2026"); the COMP parameters
"3 revisions" and "90 minutes" are therefore attributed to Engine, not labelled ours.

## Our parameters

| Behaviour | Arms | Value |
|---|---|---|
| L1, L1-noIV, L1p as a design (pre-PR gates without a fiks repro) | L1 family | our parameter (ablation) |
| Pre-PR gates: suite, stored traces, typecheck/lint, IV, local CI | L1, L1p | our parameter |
| Sessions per attempt, turns and $ per session | every repair arm | our parameter: 4 sessions, 30 turns, $5 |
| Wall-clock cap for the L1 family | L1 family | our parameter: 90 minutes (the same cap as COMP) |
| Issue validation by the frozen contracts on the ivProperties (fiks-iv) | L1, L1p (pre-PR), COMP (post-PR) | our parameter |
| IV failure also when the head returns an error instead of data, or no longer evaluates the target | L1, L1p, COMP | our parameter (mirrors FIKS's P gate) |
| Re-record before every replay-based check (`fiks rerecord-head`) | every arm | our parameter (FIKS product behaviour, applied to all arms) |
| COMP-plain: CI runs only the server's own tests (`test/fiks/**` excluded) | COMP-plain | our parameter (typical-repo CI) |
| ISSUE-TEXT: issue title and body only | ISSUE-TEXT | our parameter |
| REPRO-AGENT F check: 3 runs, at least one assertion failure each, fixed feedback, at most 3 rounds | REPRO-AGENT | our parameter; F filtering as in SWT-Bench (mundler2024swtbench: "contains at least one F→P test and no ×→F test") |
