# Fiks — self-healing tools for AI agents

Name: Fiks. Hackathon: YC "Make Something Agents Want", Oct 17–18 2026 [C25].
Source of truth for every claim: RESEARCH.md. Never state a fact in README, UI, DEMO.md or pitch without a claim ID or a bench log.

## One sentence
When a tool silently returns wrong data to an agent, Fiks catches it, turns the exact failing call into a reproduction test, and opens a pull request that fixes the tool, so the failure never happens again for any agent.

## Who gets what
- **User of the agent:** the same failure stops recurring after one merge.
- **Agent:** gets correct tool data (ground truth [C1]); violations are flagged immediately while the fix is pending [C11].
- **Tool/MCP server owner (buyer):** bugs found from real traffic, with a proven repro and a green-CI fix, instead of waiting for users to notice [C10, C21].

## Why this, not detection-only
Detection helps one agent retry but leaves the tool broken [C11, C12]. Silent faults are a large share of MCP and agent failures [C3, C7–C9]. Specs and changelogs miss many breaking changes [C13–C16]. The bottleneck in automated repair is a true reproduction test [C17, C18]; a runtime violation gives us one for free [C19].

## The loop (build exactly this)
1. **Observe** — `fiks-proxy`: MCP proxy in front of any MCP server (stdio + Streamable HTTP). Checks every result against an outcome contract: declared `outputSchema` [C26] + semantic invariants (ranges, units, non-empty for known-good inputs, freshness) + read-after-write postconditions for mutating tools [C4, C8]. Attaches a receipt (verified | violated | unverifiable) to `_meta` AND a short final text block.
2. **Capture** — on violation, persist a trace: tool, args, raw upstream HTTP request/response, contract id, violated property.
3. **Reproduce** — generate a deterministic test from the trace using recorded upstream fixtures. Gate: the test must FAIL on current code, for the stated reason (assert on the violated property, not generic failure).
4. **Repair** — a coding agent patches the MCP server in an isolated git worktree. Gate: new test passes AND full contract suite AND all prior traces pass AND typecheck/lint pass [C20, C21].
5. **Ship** — open a GitHub PR with: what broke, the trace, the test, the diff, before/after results. Never auto-merge. Never open a PR with failing CI [C21].
6. **Confirm** — after merge, the proxy shows that contract's violation rate drop to zero on replay and live runs.

## Demo environment
- `vendor-api` — mock HTTP API, version-switchable (`VENDOR_VERSION=v1|v2`). Its OpenAPI spec does NOT change between versions (behavioral drift, invisible to spec-diff [C27]).
- `shop-mcp` — a normal MCP server wrapping vendor-api (search_products, get_product, create_order, get_order). Lives in its own git repo so PRs are real.
- Seeded drifts in v2 (each maps to a C3 category):
  - D1 unit drift: prices now integer cents, same field name → agent would pay 100×.
  - D2 silent rename: `price` → `unit_amount`, spec not updated → server returns null price.
  - D3 lost write: create_order returns 200 + id but only persists with a new required header → read-after-write fails.
  - D4 pagination: results now paginated; server reads page 1 only → `count < total`.
  - D5 timestamp: ISO-8601 → epoch ms → server parses dates as 1970 → freshness fails.
- `bench` — Anthropic SDK agent runs fixed shopping tasks via the proxy. Phases: v1 baseline → v2 drift (no fix) → v2 after merged fixes. k=5 per task. Report pass^k for k=1..5, per drift: detected?, repro valid (F→P)?, PR green?, minutes drift→PR, false positives on v1.
- `dashboard` — one page: headline before/after numbers from bench logs, per-drift loop status, and a timeline for one drift: violation → test → PR → merged → green.

## Stack
TypeScript, Node 20+, pnpm workspace. `@modelcontextprotocol/sdk`, `@anthropic-ai/sdk`; repair agent via the Claude Agent SDK or headless Claude Code (planner verifies current package names). Vitest. HTTP record/replay for fixtures. GitHub via `gh` CLI or Octokit. Dashboard: Vite + React + Recharts. Pin exact versions published ≥14 days ago.

## Workflow (mandatory)
1. `planner` writes PLAN.md before any code.
2. Build one milestone at a time.
3. After every milestone: `verifier` must PASS. Fix until green.
4. After proxy/bench work: `agent-ux-tester`.
5. After dashboard/README work: `designer`.
6. Before any README, DEMO.md or pitch text is final: `claims-auditor` must PASS.
7. Commit after each PASS; keep PROGRESS.md current.

## Definition of done
- Clean clone: `pnpm i && pnpm test && pnpm demo` runs the full loop end to end on at least D1–D3; D4–D5 stretch.
- Real PRs opened on the shop-mcp repo, each with green CI.
- summary.json produced by real runs. No hand-edited or invented numbers anywhere.
- README: 30-second pitch with claim IDs, one-command demo, chart, limitations section (C11 vocabulary limit, C20 partial-patch risk, seeded vs real drift).
- DEMO.md: 3-minute script.

## Hard rules
- Never half-do a step. If something can't be finished, say exactly what's missing in PROGRESS.md.
- Secrets only in `.env`. Never print them.
- Blocked on a credential → stop and list exactly what's needed.
- Cut scope before cutting verification.
