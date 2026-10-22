# R9 attrition and screening (PLAN 5.10 steps 5, 7 and 9)

**Status: attrited from E7 (not reproduced by the blind contract).** The fault itself
reproduces deterministically at process level, and the held-out manifestations separate the
prefix from a correct head. But the protocol's F check fails: `pnpm tsx
realbugs/R9/harness/run.ts --sha prefix --runs 10` gives **0/10** violations of the named
property `cloudflare.zones_list/textJson` (10/10 `verified`, one distinct verdict). The contract
is pre-registered (written blind, committed `52ef0ba` before the first read of the fix diff) and
is not changed after the fact. Three independent reasons, any one of which removes R9 from the
FIKS vs COMP vs ISSUE-TEXT comparison:

1. **The blind contract misses the fault (false negative on the trigger).** The issue reports
   the literal text `[object Object]`, so the contract was written for a *text block* that is
   not JSON, and it exempts results with no text block ("checked only by (a) and by the declared
   outputSchema", decided blind). On the wire, the 0.2.0 server answers `tools/call zones_list`
   with `{"result": {"toolResult": {"content": [...]}}}` (recorded:
   `fixtures/prefix-wire.json`): the pre-2025 compatibility shape, with no top-level `content`.
   A spec client (MCP SDK 1.32 `CallToolResultSchema`, used by fiks's proxy and by RBX's
   `spawnServer`) defaults `content` to `[]` and passes the unknown `toolResult` key through. The
   agent therefore receives an empty, non-error result; the `[object Object]` string is what a
   client prints when it stringifies `toolResult`, not something the server sends. With no text
   block, `textJson` holds vacuously; `carriesUpstream` is skipped because the 0.2.0 `zones_list`
   never calls the API (it returns two hard-coded records); and the tool declares no
   outputSchema, so the standard property does not apply. The frozen fiks vocabulary has no
   property for "a successful result carries no content" (C11), and the bug-specific one written
   blind did not cover it either.
2. **The faulty code is not in the repository at the prefix.** It exists only in the published
   npm artifact `@cloudflare/mcp-server-cloudflare@0.2.0` (integrity in `pins.json`; still the
   latest version on npm). Its source (`src/tools/*.ts`, last at the commit "@cloudflare/
   mcp-server-cloudflare 0.2.0", `d4b871f`) was deleted from the repo at `8896f0a` (2025-04-11).
   At the prefix the repo holds only the remote Workers servers, whose own `zones_list` and
   `workers_list` (`packages/mcp-common/src/shared-tools/`) return standard JSON text blocks.
   The harness therefore runs, for a tree without a publishable stdio package, what the issue's
   `npx -y @cloudflare/mcp-server-cloudflare run <account-id>` resolves to: the 0.2.0 artifact
   (`harness/server.ts`).
3. **No arm can repair it offline in the sandbox.** The only proposed fix, PR #469 (closed, not
   merged), adds a wrapper package `packages/mcp-server-cloudflare` that depends on the npm
   0.2.0 artifact and rewrites its responses. The prefix lockfile does not contain that artifact
   (`git show prefix:pnpm-lock.yaml | grep -c mcp-server-cloudflare@0.2.0` → 0), so a repair
   agent in the SBX container (`--network none`, offline store built from the prefix lockfile)
   cannot add the dependency, and there is no source to edit. The remaining direction (re-implement
   the stdio server in the repo) is a feature build, not a repair. There is also no merged human
   fix to compare against.

R9 has no assigned reserve (PLAN 5.10 lists reserves for R10 and R19 only), so none was
attempted.

## What does reproduce (kept for the record and for E7's attrition table)

- `harness/run.ts --sha prefix --runs 10`: every run, the agent receives "content 0 block(s),
  isError false, structuredContent no, non-standard keys [toolResult]".
- `heldout/run.ts --sha prefix` → **incorrect**: H1 (zones_list, other account), H2
  (domain_list), H3 (queue_list) and H4 (domain_list, upstream 403 → silent empty success) fail;
  the control C1 (worker_list, already a standard text block in 0.2.0) passes. `--sha fix` (PR
  #469's head, reference only) → correct, 5/5.
- The blind contract is `verified` or `unverifiable` on every held-out case, on prefix and fix
  alike (the `[contract: …]` column of `heldout/run.ts`), so it does not separate them anywhere.

## Duplicates and already-fixed check (step 7)

- `gh search issues --repo cloudflare/mcp-server-cloudflare "object Object"` and `"toolResult"`
  (2026-10-22T12:33Z): #468 (open) and two earlier reports of the same fault:
  - #269 "[Bug] Inconsistent response format causes [object Object] output for some tools"
    (opened 2026-01-04, closed 2026-03-09 as completed with no linked PR or commit). It names
    the root cause (the `toolResult` wrapper) and more affected tools (zones_get, ai_*,
    queue_list, do_list_namespaces). No fixed version was published: npm still ends at 0.2.0.
  - #12 "Consistent error with a missing "content" array" (2025-02, closed not planned): the
    same missing-`content` shape seen through a strict client (Cline).
- PR #469 (one commit `7e57621`, parent = the prefix) was closed without merging; no other PR
  references #468.

## Contamination stratum (step 9)

- #468 (2026-09-01) and PR #469 (2026-09-01) are after the stated training cutoff of the repair
  models (June 2026). But the fault, its root cause and the affected tools are described in #269
  (2026-01) and #12 (2025-02), and the 0.2.0 artifact has been public since 2025-03: the
  **pre-cutoff** stratum applies to the fault and to its obvious repair (unwrap `toolResult`).

## For RBA

`adapter.json` has `"status": "attrited"`; RBA should not dispatch R9 in R8. The harness,
held-out runner and adapter fields are complete so the attrition evidence can be re-run from a
fresh worktree (`node scripts/ensure-realbugs.mjs --id R9`, then the two commands above).
