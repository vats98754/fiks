# fiks: 3-minute demo

Before you start, have these ready:
- `.env` with `CLAUDE_CODE_OAUTH_TOKEN`, and `gh` signed in.
- The dashboard running: `pnpm dashboard`.
- Two terminals.
- One browser tab on [vats98754/shop-mcp pull requests](https://github.com/vats98754/shop-mcp/pulls).

## 0:00 – 0:30 The problem

Say:
> "Agents get their ground truth from tool results at each step [C1]. MCP servers can fail without an error: a success response with the wrong data [C3]. In one study, given a null or malformed payload, agents made something up in 56.6% of valid responses [C9]. A monitor can help one agent recover [C11]; we believe the tool stays broken for the next one [C12]."

Show `vendor-diff`. The vendor's spec is identical before and after its update, and five behaviors changed:

```bash
pnpm fiks vendor-diff
```

## 0:30 – 1:10 Catch it

Run one drift through the proxy, against the tool as it was when the vendor changed (`seed-v1`):

```bash
pnpm fiks scenario D2
```

Point at the receipt the agent sees: `price is null, but p-1001 should have one; vendor sent unit_amount = 1199 (in 20-2000 USD). Don't say there is no price; if you use the vendor value, say unconfirmed.`

Say:
> "Same tool, same response. fiks checked it against an outcome contract and told the agent. It also saved the exact call and the raw upstream HTTP as a trace."

## 1:10 – 2:10 Fix it

Start the loop. It takes about a minute and a half per drift (bench):

```bash
pnpm demo --drifts D2 --base fresh
```

While it runs, narrate the gates:
> "The trace becomes a test in the tool's repo. It has to fail on today's code for exactly this reason, on repeated runs. A coding agent then fixes `src/` in its own worktree. It can't touch tests, and fiks checks every byte it commits. The fix has to pass the repro, the whole contract suite, every stored trace, typecheck and lint. Then fiks pushes and waits for CI on that exact commit, and opens the PR only if it's green. It never merges."

Open the new PR when the URL prints. If time is short, open [#1](https://github.com/vats98754/shop-mcp/pull/1) instead: the same D2 fix, made earlier in this repo. Show "What broke", the failing assertion, the small diff and the green check.

Then show the same call on today's `main`, after the merged fix:

```bash
pnpm fiks scenario D2 --shop-ref main
```

Say:
> "Same vendor, same call: verified."

## 2:10 – 2:50 What it changed

Switch to the dashboard.
- **Headline:** before the vendor change, 100% pass^5. After it, 50% without fiks and 83% with fiks receipts; about half of that gap is the agent not calling `submit_answer` (bench). With the fiks PRs merged, back to 100% (bench).
- **"What the agent told the user":**
  > "Without fiks, the agent told the user the order was placed in 1970. With fiks receipts: no wrong answers, and the only declines are the order that really was lost. Then the fixes land, and it's 100% without needing receipts at all" (bench).
- **Loop table:** all five drifts, each from violation to green PR in under two minutes, in one agent attempt, merged and confirmed (bench).
- **Timeline:** click D1 and walk it from violation to merge, with links to the trace, the test, the commit, the CI run and the PR.

## 2:50 – 3:00 Close

Say:
> "fiks turns silent tool failures into tested fix PRs: the bug is caught in the traffic through the proxy, reproduced, fixed and green before a human looks at it. We haven't found anyone else starting from silent runtime violations [C28]. The limits are in the README: seeded drifts, contract coverage [C11], and green isn't proof [C20]."

## If something breaks on stage

- **No network or no model:** run `pnpm demo --drifts D1,D2,D3 --until-f-gate`. It still shows trace → test → fails for the stated reason, offline.
- **CI is slow:** say "fiks won't open the PR until this is green", then show an existing PR (#1–#4 or #7).
