# Progress

Status per milestone in PLAN.md. Every PASS here is a verifier PASS with a commit.

| Milestone | Status | Commit | Notes |
|---|---|---|---|
| Planning | done | eaa44b2 | PLAN.md written by planner |
| M0 scaffold + repos | PASS | (this commit) | verifier PASS on re-run after .gitignore fix |
| M1 vendor-api + shop-mcp seed | PASS | (this commit) | verifier PASS on round 6; rounds 1-5 found gate holes (re-record fallback, D1/D4 overlap, weak contracts, trace scope, golden after re-record, error-result golden, lazy now(), refusal-as-fix, cached read-back); fixed, seed-v1 re-tagged at bb037cf, guarded by packages/cli/test/seed-integrity.test.ts (14 real/fake-fix cases) |
| M2 proxy + contracts + receipts | PASS | (this commit) | round 1 FAIL (lint, receipt length, probe/outputSchema rewrote results, no-tap silence, bin EOF); round 2 FAIL (upstream env dropped); round 3 PASS; agent-ux-tester: 0 v1 false positives in 51 calls |
| M3 traces + repro (F→P gate) | PASS | (this commit) | round 1 FAIL (F gate substring match, P gate did not require the repro ran, empty target); fixed; round 2 PASS after a lint fix. All 5 drifts: F 3/3 on seed-v1, P after oracle fix |
| M4 repair + PR (green-CI gate) | not started | | needs `ANTHROPIC_API_KEY` for the live run |
| M5 bench + summary.json | not started | | needs `ANTHROPIC_API_KEY` |
| M6 dashboard | not started | | |
| M7 README / DEMO / claims audit | not started | | |

## Environment decisions
- Node: the machine default was v22.5.1, which is below the Vitest 5 / Vite 8 floor (22.12). Installed v22.23.3 via nvm; `.nvmrc` = 22, `engines.node` = `>=22.12`, `engine-strict=true`. The login shell PATH still pins v22.5.1, so run commands with `export PATH=$HOME/.nvm/versions/node/v22.23.3/bin:$PATH` (or `nvm use`).
- Biome 2.5 deprecates `rules.recommended`; config uses `rules.preset: "recommended"` (note: `biome migrate` wrongly rewrites it to `"none"`).
- `@types/node` pinned to 22.20.5 (newest 22.x published ≤ 2026-10-04).
- shop-mcp CI actions pinned by SHA: checkout v7.0.1, pnpm/action-setup v6.1.0, setup-node v7.0.0 (setup-node v7.1.0 is newer than the 14-day cutoff).
- shop-mcp is installed with `--ignore-workspace` so the fiks pnpm workspace never adopts it.
- `.npmrc` has `reporter=silent` so `pnpm fiks ... --json | jq` gets clean JSON. Script output (tsc, vitest, fiks) still prints; pass `--reporter=default` to see pnpm's own messages.
- Re-recording rule (PLAN.md M1): a fix that changes upstream requests needs `<name>.rerecorded.json`, written by `fiks rerecord`, never by the repair agent.
- `seed-v1` was moved seven times (final: bb037cf; the last two moves only re-synced vendored contracts and tool descriptions during M2), before any PR existed, to include the M1 verifier fixes (handler errors on unmatched replay, trace `target` scoping, golden v1 fixtures that survive re-recording, frozen upstream clock, `equalsUpstream`, `vendor/openapi.json`). From now on it is frozen.

## Known limits of the gates (must appear in README Limitations)
- Contracts check ranges, nullness, counts, uniqueness, freshness, read-after-write and agreement with the upstream response. They cannot tell a correct value from a plausible wrong one when no upstream field says what the value should be. Examples found by the verifier: a D2 "fix" that returns a constant in-range price, or a D1 "fix" that clamps prices to the range ceiling, passes the suite. Fiks never merges; human review of the PR is the backstop. Never claim a green suite proves a fix is correct.

## Missing / blocked
- Credential: the user has only a Claude Code OAuth token. Put it in `.env` as `CLAUDE_CODE_OAUTH_TOKEN` and leave `ANTHROPIC_API_KEY` empty. The bench agent moves from `@anthropic-ai/sdk` to the Claude Agent SDK (see PLAN.md ground rules).
- `.env` now exists (created by the user; not loaded by any code yet). `ANTHROPIC_API_KEY` is first used in M4 (live repair) and M5 (bench). M0–M3 tests run with the key unset.
- Hackathon judging criteria and submission rules are not yet pasted into CLAUDE.md (KICKOFF step 4).
