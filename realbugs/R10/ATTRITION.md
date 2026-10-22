# R10 attrition and screening (PLAN 5.10 steps 7 and 9)

**Status: reproduced; no attrition.** servers #4887 reproduces at process level over MCP stdio:
`pnpm tsx realbugs/R10/harness/run.ts --sha prefix --runs 10` gives 10/10 violations of
`memory.create_entities/readAfterWrite`, and `--sha fix --runs 10` gives 10/10 verified. The
reserve (servers #3137, `open_nodes` relations) was therefore not attempted.

## Duplicates and already-fixed check (step 7)

- `gh search issues --repo modelcontextprotocol/servers create_entities` (2026-10-22): #4887 is
  the only issue about dropped observations for an existing name. Related, not duplicates:
  #5058 (open: mutating tools annotated non-destructive "drop data they didn't touch"), #5153
  (open: idempotentHint), #4885 (unreadable lines, fixed just before the prefix: the prefix
  commit is that fix's merge), #4797 (two processes sharing a file).
- Not already fixed at the prefix: the prefix's own `src/memory/__tests__/tools.test.ts` pins
  the buggy behaviour (two tests commented "KNOWN BUG #4887: pins current (wrong) behavior; the
  fix changes this assertion"), and the trigger fires there.

## Contamination stratum (step 9)

- Issue opened 2026-09-28; fix PR #5008 merged 2026-10-05 (merge `1520a8b`, base `v2/main`).
  Both are after the repair models' training cutoff as stated for Opus 5.5 (June 2026):
  **post-cutoff** stratum for the fix.
- In-repo hint at the prefix: the "KNOWN BUG #4887" comments and the characterising test
  `drops observations for an entity that already exists (#4887)` are visible to every arm in
  the clone. Every arm sees the same tree, so the hint does not favour one arm, but it lowers
  the difficulty of localisation; report it with the R10 rows.
- The issue text (`issue.md`, ISSUE-TEXT arm) states the human fix's direction ("keep the
  documented behaviour and report which entities were skipped").

## Grading caveats for RBA

- A correct fix must edit `src/memory/__tests__/tools.test.ts` (it pins the old response and
  the exact tool description), so `allowedEditPaths` admits `src/memory/__tests__/*.ts`.
- `humanFixTests` are implementation-specific (they import `skippedEntityNames` and
  `skippedEntitiesNotice` and assert the exact notice text and description). A head that fixes
  the bug the other way (store the observations) fails them; `heldout/run.ts` accepts both.
- The upstream repo is npm (package-lock.json), not pnpm, so SBX's per-repo image builder does
  not support it yet. The suite was checked offline in the SBX base image instead (see
  `adapter.json` notes).
