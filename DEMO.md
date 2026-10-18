# fiks: 3-minute demo

Before you start, have these ready:
- `.env` with `CLAUDE_CODE_OAUTH_TOKEN`, and `gh` signed in.
- The dashboard running: `pnpm dashboard`.
- Two terminals.
- One browser tab on [vats98754/shop-mcp pull requests](https://github.com/vats98754/shop-mcp/pulls).

## 0:00 – 0:30 The problem

Say:
> "Agents trust tool results; that's their only view of the world [C1]. MCP servers often fail without an error: a 200 with the wrong data [C3]. Given a null or malformed payload, agents make something up in 56.6% of cases [C9]. A monitor can warn one agent, but the tool stays broken for the next one [C11, C12]."

Show `vendor-diff`. The vendor's spec is identical before and after its update, and five behaviors changed:

```bash
pnpm fiks vendor-diff
```

## 0:30 – 1:10 Catch it

Run one drift through the proxy:

```bash
pnpm fiks scenario D2
```

Point at the receipt the agent sees: `price is null, but p-1001 should have one. Do not treat the missing price as meaningful…`.

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

## 2:10 – 2:50 What it changed

Switch to the dashboard.
- **Headline:** before the vendor change, 100% pass^5. After it, 67% without fiks and 33% with receipts (bench).
- **"What the agent told the user":**
  > "With receipts the agent gave no wrong answers, but it also declined more. That's why the receipt isn't the product. The fix is."
- **Loop table:** four drifts, each from violation to green PR in under two minutes, in one agent attempt (bench).
- **Timeline:** click D1 and walk it from violation to PR, with every step linked to evidence.

## 2:50 – 3:00 Close

Say:
> "fiks turns silent tool failures into tested fix PRs: the bug is caught in the traffic through the proxy, reproduced, fixed and green before a human looks at it. We haven't found anyone else starting from silent runtime violations [C28]. The limits are in the README: seeded drifts, contract coverage [C11], and green isn't proof [C20]."

## If something breaks on stage

- **No network or no model:** run `pnpm demo --drifts D1,D2,D3 --until-f-gate`. It still shows trace → test → fails for the stated reason, offline.
- **CI is slow:** say "fiks won't open the PR until this is green", then show an existing PR (#1–#4).
