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

1. **scope**: the delta edits only the trigger's contract, amends only properties the trigger
   violates under the current contract, and adds or removes no known-good input other than the
   trigger's own (round 3); the trigger must violate the current contract at all.
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

## Round 2 (verifier findings)

Rebased onto main `c144b03` (no new commits; "Current branch ws/CU is up to date"); SETUP re-run
("nothing to apply", install exit 0; lockfile edit again left uncommitted).

1. **Vacuous passes now fail closed** (`gate.ts`). Besides empty lists, the gate adds an `input`
   finding when the stored list is non-empty but no trace violates its target under the current
   contract (`stored.used === 0`), when no clean corpus case verifies under the current contract
   (new `summary.corpus.verified === 0`), and when no mutation variant was rejected before the
   delta (`mutation.rejectedBefore === 0`). The verifier's repro (widen `get_product/price.range`
   to 3,000, `storedViolations: [shop-v1/search-laptop.json]`) is now rejected with stored
   `{total: 1, used: 0, stillViolate: 0}` and one `input` finding. One test per case; disabling
   each new check makes exactly its test fail.
2. **Declared outputSchemas** (`cases.ts`, `gate.ts`). New required `GateContext.
   declaredOutputSchemas: Record<tool, JsonSchema | null>` (`null` = the tool declares none),
   built from a tools/list result by `declaredOutputSchemas(tools)`; ORCH fills it from the
   server's `tools/list`. The gate applies it to every case (trigger, stored, corpus, variants),
   as the proxy does (`proxy.ts`, `declaredOutputSchema: schemas.get(name)`); `GateCase.
   declaredOutputSchema` is removed so no per-case value can diverge. A missing map is one `input`
   finding; a map without a case's tool is one `input` finding per tool. Fixture
   `test/fixtures/shop-tools-list.json`: the verbatim `tools/list` result of shop-mcp tag
   `seed-v1` (`9313c40`), run over stdio from a `git archive` export; tool outputSchemas are
   unchanged between `seed-v1` and `7bf2e66`. Tests: M7 (price `"2499"`) on `get_product` verifies
   without the schema but violates exactly `shop.get_product/outputSchema` with it, both under
   the current contract and under the accepted `price.range` widening (gate counts 3 of 4 variants
   rejected before and after; 2 of 3 without M7); a `setOutputSchema` override admitting a string
   price is rejected (scope, plus the amended outputSchema no longer rejecting M7); a trigger that
   also drops the required `in_stock` is rejected because it still violates the outputSchema
   after the widening. Ignoring the map in `evalCase` makes these three tests fail.
   With the schemas, the benign widening's corpus summary is `{total: 10, verified: 9,
   regressions: 0}` (`product-unknown` is an `isError` result, unverifiable).

Evidence: `pnpm vitest run packages/contract-update` -> 2 files, 28 tests passed (the four P12
acceptance tests among them); `pnpm typecheck` exit 0; `pnpm lint` exit 0 ("Checked 162 files ...
No fixes applied").

## Round 3 (verifier findings)

Rebased onto main `6157cb4` (MON merged; clean rebase after discarding the uncommitted SETUP
lockfile edit). SETUP re-run: "nothing to apply", `pnpm install --no-frozen-lockfile` exit 0
(lockfile edit again left uncommitted).

1. **Known-good edits are in scope only for the trigger's own input** (`apply.ts`, `gate.ts`).
   `applyDelta` now reports `knownGoodEdits` (`{contractId, op: add|remove, input}`). In the scope
   block, an add or remove on the trigger's contract whose pattern does not match the trigger's
   arguments (the proxy's subset match), or is empty (`{}` matches every input), is a `scope`
   finding naming the `onlyKnownGood` properties it switches on or off. Rationale: such an edit
   amends those properties for inputs the trigger does not cover, and neither the corpus nor the
   trigger's variants exercise them. Removing the trigger's own input stays in scope, so the M5
   acceptance test is unchanged: rejected by the mutation check alone. Verifier repros, now:
   `get_product` widen 3000 + remove `{id: p-1002}` -> `accepted=false`, one `[scope]` reason
   naming `shop.get_product/price.notNull`; `search_products` widen 3000 + remove
   `{query: monitor}` -> `accepted=false`, one `[scope]` reason naming
   `shop.search_products/items.nonEmpty`. Tests added for both, for adding a non-trigger input
   (`{id: p-2001}`), and for an empty pattern.
2. **The rationale cannot carry code** (`outcome.ts`, `render.ts`). `parseDelta` rejects a
   rationale with a code fence (``` or ~~~), a source-file name (`*.ts`, `*.js`, `*.py`, ... as
   `rationaleProblems`), or more than 2,000 characters; invariant ids must match
   `^[A-Za-z0-9_.-]+$` (they are quoted in the markdown). `renderProposal` re-parses the delta
   (a hand-built GateResult is refused), renders the rationale as a blockquote with each line
   trimmed and `` ` ~ < > \ `` escaped and `&` encoded, escapes notes the same way, and sizes the
   diff fence longer than any backtick run in the diff. Verifier repro, now: the 4-fence
   rationale is rejected by the gate with two `[delta]` reasons (code fence; source file
   "get_product.ts"). New adversarial test: that rationale and each problem alone are refused by
   the gate; a forged accepted result is refused by the renderer; inline backticks, an indented
   line and `<script>` render escaped (no code span, no indented code block, exactly 2 fences, no
   source path).

Self-check: with `src/` reverted to round 2 (`git stash push packages/contract-update/src`), the
five new tests fail and the other 28 pass.

Evidence: `pnpm vitest run packages/contract-update` -> 2 files, 33 tests passed; `pnpm
typecheck` exit 0; `pnpm lint` exit 0 ("Checked 173 files ... No fixes applied").

## For ORCH (`--arm fiks+cu`)

Pass the frozen trace as `trigger`, the target repo's `test/repro/*.json` as `storedViolations`,
the A0 S-dev CallRecords as `cleanCorpus`, MUT M1-M14 variants of the trigger as
`mutationVariants`, the contract file in force as `contracts`, and
`declaredOutputSchemas(<server tools/list>.tools)` as `declaredOutputSchemas`. On rejection feed `reasons`
back to the agent; on acceptance write `renderProposal(...).markdown` and emit no `would_open_pr`.
