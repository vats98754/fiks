# fiks paper program: orchestration plan

Goal: an arXiv preprint that makes, and fully backs, the case that fiks closes the loop that on-market and research tools leave open: silent tool failure caught at runtime → proven reproduction test → green-CI repair PR → confirmed. "Better" is a set of falsifiable hypotheses tested against named baselines on several benchmarks and real public bugs, not an adjective.

Decisions (user, 2026-10-21): arXiv preprint; maximal bench budget on the OAuth token; real-world bugs reproduced only in forks/clones under vats98754 (never post to third-party repos); large swarms.

## What "certified" means (all must hold before release)
1. **Numbers.** Every number in the paper is emitted by `paper/scripts/` from logs in `bench/results/` or `paper/results/`; `pnpm paper:check` rebuilds every table and macro and diffs them. No hand-typed numbers.
2. **Citations.** Every reference exists and says what we say it says: two independent verifiers, each recording the URL and the passage or section that supports the citing sentence. Unverifiable → removed.
3. **Statistics.** Pre-registered analysis plan (written before the runs); CIs on every rate (Wilson / bootstrap); paired tests for every with-vs-without comparison; multiple-comparison correction stated; power analysis for each headline comparison.
4. **Hostile review.** A panel of reviewers (paper-forge Mode B, distinct lenses: SE/APR, agents/evals, statistics, security, novelty) finds no unaddressed major issue; each concern is fixed, answered by an experiment, or stated in Limitations.
5. **Claims audit.** claims-auditor PASS on the manuscript (same rule as README: no fact without a claim ID, citation, or log).
6. **Reproducibility.** A clean clone regenerates every table from committed logs; the run commands for each experiment are in the appendix; LaTeX builds with no undefined references.
7. **Disclosure.** AI-assistance statement; limitations cover seeded vs real drift, contract coverage [C11], partial-patch risk [C20], single-vendor model family if that remains.

## Roles
| Role | Who | Does |
|---|---|---|
| Orchestrator | main session | runs one workflow per phase, reads every result, decides the next phase, keeps PROGRESS.md |
| Planner | `planner` agent | turns research + design panel output into `paper/PLAN.md` (RQs, hypotheses, experiments, baselines, power, analysis plan) |
| Researchers | parallel agents, one per literature/market area | write `paper/research/<area>.md` with verified sources |
| Citation verifiers | 2 per area, adversarial | re-fetch each source, refute misquotes, mark VERIFIED / WRONG / UNREACHABLE |
| Design panel | 3 independent designers + judges | competing experiment designs, scored; best one grafted |
| Builders | parallel agents in git worktrees | one workstream each (see Phase 3); never touch another stream's files |
| Verifiers | `verifier` agent per builder output | PASS/FAIL with evidence; FAIL loops back to the builder |
| UX tester | `agent-ux-tester` | after proxy/contract/bench changes |
| Runners | background shell jobs, not agents | long benchmark runs; logs only |
| Analysts | agents using paper-forge `eval_stats.py` | tables/figures from logs via scripts |
| Writers | parallel section agents | LaTeX sections in `paper/sections/` |
| Reviewers | hostile Mode B panel | scored reviews + rebuttal-risk list |
| Claims auditor | `claims-auditor` | final gate |
| Completeness critic | one agent per phase | "what is missing?" → next round of work |

## Phases and gates
1. **Discover** (research swarm, ~25 agents). Areas: silent-failure taxonomies; runtime monitors/guardrails; MCP gateways and scanners on the market; agent observability platforms; API contract testing and breaking-change detection; invariant/spec inference; failure-reproduction test generation; LLM program repair and self-healing systems (incl. patch overfitting); agent/tool benchmarks; real-world MCP/API bug mining (×2); adversarial novelty search. In parallel: a codebase map of fiks extension points. **Gate:** every area file citation-verified; synthesis (frontier map, contradictions, gaps, competitor feature matrix, benchmark shortlist, real-bug candidates with reproducibility ratings).
2. **Design** (judge panel → planner). Output `paper/PLAN.md`: research questions, hypotheses H1..Hn each with its falsifying result, baselines (implemented, not described), benchmarks, ablations, power analysis, compute plan, pre-registered analysis. **Gate:** design critic + feasibility verifier PASS.
3. **Build** (parallel builders in worktrees, each with a verifier loop; merged one at a time on green). Workstreams fixed by PLAN.md; expected: drift taxonomy + additional MCP servers/domains; implemented baselines (schema-only validation, spec-diff, LLM-judge monitor, detection-only, observability-style logging, repair without repro gate); contract inference from v1 traffic; real-bug harness (forks only); external benchmark adapters; multi-model bench; analysis scripts and `paper:check`.
4. **Run** (background runners, checkpointed, resumable). **Gate:** `summarize --check` and `paper:check` match logs; pre-registered analysis applied as written; deviations logged.
5. **Write** (section writers in parallel from PLAN.md + results + verified bibliography).
6. **Certify** (citation re-verify, number trace, hostile review panel, claims audit, completeness critic). Concerns that need data loop to Phase 3/4 (at most two loops; anything left goes to Limitations).
7. **Package** PDF, source tarball, arXiv checklist, disclosure; final report.

## Rules
- Integrity: never invent a result or citation; a cell is a computed number or `\TODO{run}`. Label epistemic status.
- No GitHub writes outside vats98754. Forked third-party code keeps its license.
- Cut scope before cutting verification. Never half-do a step; record what is missing in PROGRESS.md.
- Secrets only in `.env`; never printed.
