# CU build log

Branch `ws/CU`, based on main `c144b03`. Wave 1, depends on CORE-SEED. No external actions; the
only network use was the read-only `scripts/ensure-shop-mcp.mjs` clone into the worktree's
`.work/` (needed because `packages/cli/vitest.config.ts` loads it for every `vitest run`).

## What landed (`packages/contract-update`, `@fiks/contract-update`)

- `src/outcome.ts`: the outcome `{outcome: 'contract_update', delta: {ops[], rationale}}`, a JSON
  Schema for the agent prompt (`CONTRACT_UPDATE_OUTCOME_SCHEMA`) and a strict parser
  (`parseOutcome`, `parseDelta`; unknown fields and malformed invariants are errors, every error
  listed). Ops: `replaceInvariant`, `addInvariant`, `replacePostcondition`, `setOutputSchema`,
  `addKnownGoodInput`, `removeKnownGoodInput`. There is no remove op: a contract update amends a
  property, it never deletes one.
- `src/apply.ts`: `applyDelta(file, delta)`, pure. Reports `amended` (existing properties changed),
  `added`, `contractLevel` (known-good edits) and touched contracts. A no-op replace is an error.
- `src/cases.ts`: `GateCase` plus adapters from the product trace format (`Recording`: frozen and
  stored traces, fixtures) and from `CallRecord` (clean corpus, MUT variants). Evaluation `now` =
  the capture instant, never the system clock. A CallRecord carries no read-after-write probe;
  `fromCallRecord(rec, probe)` takes one when the caller has it.
- `src/gate.ts`: `acceptDelta(delta, {contracts, trigger, storedViolations, cleanCorpus,
  mutationVariants}) -> {accepted, reasons[], findings[], notes[], amended, added, contractLevel,
  proposed, summary}`. `contracts` (the contract file in force) is the one input beyond the
  WORKSTREAMS signature; the gate cannot evaluate without it. Deterministic; inputs never mutated.
- `src/render.ts`: `renderProposal(base, result, {contractsPath})` -> `{markdown, diff, proposed}`;
  `contractDiff` is an LCS line diff of each changed contract, pretty-printed on its own. It throws
  on a rejected result and on any path that is not `*.contracts.json`: the proposal never names or
  contains code.

## Gate rules (all must hold; every failure is listed, nothing short-circuits after parsing)

1. **scope**: the delta edits only the trigger's contract, and amends only properties the trigger
   violates under the current contract; the trigger must violate the current contract at all.
2. **trigger**: under the amended contract the trigger's verdict is `verified`, and every amended
   property is still checked on it.
3. **stored**: each stored true-violation trace still violates each of its `target` properties
   that it violates under the current contract (a target it no longer violates there is a note).
4. **corpus**: no clean v1 case violates a property it did not already violate (pre-existing
   violations are notes, not blamed on the delta).
5. **mutation**: each variant is still rejected on every property that rejected it before, except
   the amended ones. Added guard (CU design choice, stricter than the P12 sentence): an amended
   property that rejected some variant before must still reject at least one, so "amend" cannot
   mean "disable" (e.g. a range widened to [0, 1e9]).
6. **input**: empty stored/corpus/variant lists and cases without a tool result fail closed.

## Test inputs and provenance

- `test/fixtures/shop-v1/*.json`: the 10 v1 fixtures of shop-mcp `7bf2e66`
  (`test/fixtures/v1/`, excluding `*.rerecorded.json`), byte-identical copies.
- `test/fixtures/traces/D{1..5}-tr_*.json`: the five stored repro traces of shop-mcp `7bf2e66`
  (`test/repro/tr_b47c5b77c6` D1, `tr_079b90c89e` D2, `tr_7280855590` D3, `tr_d02358451e` D4,
  `tr_4db46c86e4` D5), content-identical and reformatted by `biome check --write`.
- **Synthesized** in `test/helpers.ts` (the benign-author and MUT streams are not merged): the
  benign triggers (a $2,500 premium laptop added to the laptop search; known-good `p-1004`
  re-priced to $2,499) and their mutation variants (M1, M2, M5, M6 on the search; M1, M2, M5, M7
  on the product). Each variant applies one 5.4 operator to the upstream body and mirrors the v1
  server's pass-through of that field into the tool output; no server was re-run. ORCH will feed
  MUT's real variants.

## Acceptance evidence (round 1)

- SETUP: `node scripts/apply-dep-fragments.mjs` -> "nothing to apply"; `pnpm install
  --no-frozen-lockfile` exit 0. The resulting `pnpm-lock.yaml` edit (new importer, plus main's
  stale `domains`/`interfaces` entries) is left uncommitted, per the fragment rule.
- `pnpm vitest run packages/contract-update`: 2 files, 21 tests passed.
- D1 silencing: widening `items.price.range` to max 200,000 with the premium-search trigger is
  rejected with exactly one finding kind, `[stored]` on `tr_b47c5b77c6`; the trigger verified, so
  the stored-trace check alone rejects it. Also rejected when the D1 trace itself is the trigger.
- Benign widening: max 3,000 is accepted (no reasons; stored 5/5 still violate; corpus 10 cases, 0
  regressions); the D1 trace still violates `items.price.range` under the proposed contract.
- M5: widening `get_product/price.range` plus removing `{id: p-1004}` from known-good inputs is
  rejected with exactly one finding: the M5 null-price variant is no longer rejected on
  `shop.get_product/price.notNull`. The widening alone is accepted (control).
- Self-check of the suite: disabling the stored, mutation or corpus check in `gate.ts` makes 4, 1
  and 1 tests fail respectively (restored afterwards).
- `contractDiff` matches `diff -U3` hunk for hunk on a two-hunk change.
- `pnpm typecheck` exit 0; `pnpm lint` exit 0 ("Checked 161 files ... No fixes applied").

## For ORCH (`--arm fiks+cu`)

Pass the frozen trace as `trigger`, the target repo's `test/repro/*.json` as `storedViolations`,
the A0 S-dev CallRecords as `cleanCorpus`, MUT M1-M14 variants of the trigger as
`mutationVariants`, and the contract file in force as `contracts`. On rejection feed `reasons`
back to the agent; on acceptance write `renderProposal(...).markdown` and emit no `would_open_pr`.
