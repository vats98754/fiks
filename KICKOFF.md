# Kickoff

## Setup
1. Create two empty GitHub repos: `fiks` (this project) and `shop-mcp` (the demo tool that receives fix PRs).
2. Clone `fiks`, copy this kit in (including the hidden `.claude` folder).
3. `cp .env.example .env`; fill ANTHROPIC_API_KEY, GITHUB_TOKEN, SHOP_MCP_REPO.
4. Paste the hackathon's judging criteria and submission rules (from Discord) at the bottom of CLAUDE.md.
5. Run `claude` in the repo and paste the prompt below.

## Prompt
Read CLAUDE.md and RESEARCH.md. Follow CLAUDE.md's workflow end to end without stopping for approval unless blocked on a credential. Use the planner subagent to write PLAN.md, then build milestone by milestone. After every milestone run the verifier subagent and fix until PASS. Run agent-ux-tester after proxy/bench work, designer after dashboard work, and claims-auditor before any README, DEMO.md or pitch text is final. Commit after each PASS and keep PROGRESS.md current. Never half-finish a step; if something cannot be completed, record exactly why in PROGRESS.md. Finish when the Definition of done is met, then report the demo command, the summary.json headline numbers, links to the opened PRs, and anything still missing.
