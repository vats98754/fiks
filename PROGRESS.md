# Progress

Status per milestone in PLAN.md. Every PASS here is a verifier PASS with a commit.

| Milestone | Status | Commit | Notes |
|---|---|---|---|
| Planning | done | eaa44b2 | PLAN.md written by planner |
| M0 scaffold + repos | PASS | (this commit) | verifier PASS on re-run after .gitignore fix |
| M1 vendor-api + shop-mcp seed | not started | | |
| M2 proxy + contracts + receipts | not started | | |
| M3 traces + repro (F→P gate) | not started | | |
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

## Missing / blocked
- `.env` does not exist yet. `ANTHROPIC_API_KEY` is required from M4 (live repair) and M5 (bench). M0–M3 need no key.
- Hackathon judging criteria and submission rules are not yet pasted into CLAUDE.md (KICKOFF step 4).
