# Tuning log (dev split only)

PLAN §5.2 item 5 and §10 "tuning asymmetry". Every prompt iteration of a comparator or judge on the dev split (29 instances: 24 blind dev drifts + D1–D5) is logged here **before F8** (`prereg-v1.1`). No iteration on the test split is allowed. An iteration is one changed prompt that was run on dev; log it even if it was discarded.

Budgets:

| Arm | Budget (logged dev iterations) | Iterations used | Final prompt sha256 | Final dev result |
|---|---|---|---|---|
| **fiks** (repair prompt + repro generator) | **0 further iterations (frozen)** | 0 | see "fiks row" below | — |
| L1 | ≤ 10 | | | |
| COMP | ≤ 10 | | | |
| REPRO-AGENT | ≤ 10 | | | |
| B-JUDGE (Sonnet) | ≤ 5 | | | |
| B-JUDGE (Haiku) | ≤ 5 | | | |
| B-JUDGE+U (Sonnet) | ≤ 5 | | | |
| B-JUDGE+U (Haiku) | ≤ 5 | | | |

PLAN gives a tuning budget only to L1, COMP, REPRO-AGENT and the judge variants. An iteration on any other arm (L1-noIV, L1p, COMP-norep, COMP-plain, ISSUE-TEXT, FIKS+CU) is not provided for by PLAN; if one happens it is logged below and in `DEVIATIONS.md`.

## fiks row (frozen: 0 further iterations)

- Files: `packages/repair/src/prompt.ts` (repair prompt) and `packages/repro/src/generate.ts` (repro generator). Any change after this plan is a deviation (§5.2 item 5).
- Hashes when this log was created (fiks main `c144b03`, 2026-10-21; `shasum -a 256`):
  - `packages/repair/src/prompt.ts`: `aea6cffc6748458c6327f60f186662d437c5154334becf58887414d55cf58985` (83 lines)
  - `packages/repro/src/generate.ts`: `4284fe31c866119b9d23244859387731c04f85245bb6018812ec5ee056976c9f` (74 lines)
- Hashes at F5: the entries for these two paths in `paper/prereg/REGISTRY.json` (group `fiks-frozen`). If they differ from the hashes above, the diff is listed here with its reason. CORE's Domain-hook wiring of `generate.ts` (P8) must keep the shop output byte-identical to ec241bc; a change to the prompt text or to the generated test is a deviation.
- Prior tuning history (PLAN §5.2 item 5, checked by the plan fixer with `gh pr list -R vats98754/shop-mcp --state all` and `git log`; the git facts re-checked here with `git log --format='%h %aI' -- <file>` and `wc -l`): both files were added in 2 commits (609c9e8, 2026-10-18T02:17:05-07:00; 8c7daa8, 2026-10-18T04:04:46-07:00), 157 lines together, not modified since. fiks opened 10 repair PRs on vats98754/shop-mcp (#1–#5 and #7–#11; #5 closed as a duplicate; #6 is a harness PR). #1–#5 predate the commit of the prompt files. 5 runs are in the loop log (`bench/results/loop/events.jsonl` has 5 `repair_started` events, one per D1–D5). Other unlogged in-session iterations during the hackathon are unknown.

## Iteration log

One row per iteration, in the order run. `prompt sha256` = sha256 of the exact prompt file(s) used (sorted paths, concatenated). `dev result` = the arm's dev endpoint on the 29 instances (repair arms: `correct_pr` and `green_incorrect_pr` rates; REPRO-AGENT: F-success rate and dev BA if graded; judges: dev BA), with the RunKey prefix of the logged run.

| # | Date (UTC) | Arm | Iteration (n of budget) | Change (one line) | Prompt file(s) | Prompt sha256 | Dev result | Run log (RunKey prefix) | Logged by |
|---|---|---|---|---|---|---|---|---|---|

## Judge variant chosen at K1

The judge variant is chosen at K1 by dev BA (tie → cheaper) and recorded in `K1-ADDENDUM.md` (PLAN §8.2), from the rows above.
