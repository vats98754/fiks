# CU build log

Branch `ws/CU`, based on main `a585b65` (rounds 5-7; originally `c144b03`). Wave 1, depends on CORE-SEED. No external actions; the
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
   on the amended properties (P12 as written; BA6, rounds 5 and 7). The amended properties are
   those the delta replaces plus, since round 7, the `onlyKnownGood` properties the trigger
   violates that an in-scope known-good edit switches off for the trigger's own input. There is
   no further condition on an amended property: the "must still reject at least one variant"
   rule kept in round 5 was stricter than P12 and was removed in round 7. A `replaceInvariant`
   keeps the invariant's `kind` and paths and a `replacePostcondition` its `probeTool` (round 4,
   a `delta` error otherwise).
6. **input**: empty stored/corpus/variant lists and cases without a tool result fail closed, and so
   does every mutation variant that is not a call of the trigger's tool with the trigger's
   arguments (round 4; it is skipped, not evaluated).

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

## Round 4 (verifier findings)

Rebase onto main: main is still `6157cb4`, so `git rebase main` -> "Current branch ws/CU is up to
date" (uncommitted SETUP lockfile edit stashed around it). SETUP re-run: "nothing to apply",
`pnpm install --no-frozen-lockfile` exit 0 (lockfile edit left uncommitted).

1. **A kind swap no longer gets around "amend, not disable"** (`apply.ts`, `gate.ts`). Two
   independent layers:
   - `applyDelta` rejects a `replaceInvariant` that changes `kind`, `path`, `itemsPath`,
     `totalPath` or `upstreamPath` of the invariant it replaces, and a `replacePostcondition` that
     changes `probeTool`; only parameters change. Verifier repro, now: `{replaceInvariant,
     shop.get_product, {id: price.range, kind: notNull, path: price}}` with `premiumProduct()` and
     `productVariants()` -> `accepted=false`, one `[delta]` reason: `changes kind ("range" ->
     "notNull")`.
   - The mutation check no longer exempts amended properties: every variant an amended property
     rejected before must still be rejected on it after. With the identity check disabled (a
     temporary local edit, reverted), the same swap is still rejected: one `[mutation]` reason, M1
     "is no longer rejected on the amended shop.get_product/price.range (was: price = 249900 is
     outside 20-2000 USD)", mutation summary 4/3/2. This also closes a partial neutralisation the
     round-3 rule let through: `items.price.range` widened to [20, 300000] admits M1 (x100) but still
     rejects M2 (/100); with the D1 trace withheld, round 3 accepted it, round 4 rejects it with one
     `[mutation]` finding on `benign-premium-search~M1`.
2. **Mutation variants must be variants of the trigger** (`gate.ts`). A variant whose tool or
   contract differs from the trigger's, or whose arguments differ (key-order independent), is an
   `input` finding and is not evaluated; the vacuous-pass check counts only usable variants.
   Verifier repro, now: `premiumProduct()` trigger, `searchVariants()`, `price.range` -> [0, 1e9]
   -> `accepted=false`, four `[input]` findings ("is a shop.search_products call, but the trigger is
   a shop.get_product call ... not a variant of the trigger"), mutation summary 4/0/0. With
   `productVariants()` the same delta is rejected as before ("disables the property instead of
   amending it").

New tests (`describe('acceptDelta: amend, not disable (round 4)')`, 5 tests): the kind swap; a
path move and a probeTool change; the partial neutralisation; search variants for a product
trigger; a variant of p-1001 mixed into p-1004's variants (one `input` finding, counts equal to the
trigger's own variants). The round-3 scope test amended `items.id.unique` by moving its path; it now
changes a parameter (`items.nonEmpty`, `onlyKnownGood: false`) so it still reaches the scope check.

Self-check (temporary local edits, each reverted): identity check disabled -> 2 tests fail;
foreign-variant check disabled -> 2 fail; amended properties exempted again (round-3 rule) -> 4
fail.

Evidence: `pnpm vitest run packages/contract-update` -> 2 files, 38 tests passed (the three P12
acceptance tests included and unchanged); `pnpm typecheck` exit 0; `pnpm lint` exit 0 ("Checked
173 files ... No fixes applied").

## Round 5 (orchestrator decision BA6)

Discarded the uncommitted SETUP lockfile edit, then `git rebase main` onto `a585b65` (BA1-BA7
amendments): 4 commits replayed cleanly. SETUP re-run: `node scripts/apply-dep-fragments.mjs` ->
"nothing to apply"; `pnpm install --no-frozen-lockfile` exit 0 (lockfile edit left uncommitted).

**BA6 (PLAN §0.B): P12 is binding as written.** The round-4 rule (every variant stays rejected on
the amended property too) was stricter than P12's "mutation variants are still rejected except on
the amended property" and is withdrawn (option a):
- `gate.ts`: the per-variant check skips amended properties again; a variant that stops being
  rejected on a property the delta does not amend is still a `[mutation]` finding. Kept: an
  amended property that rejected n > 0 variants before and none after is one `[mutation]` finding
  ("disables the property instead of amending it"); the `applyDelta` identity check (`kind`,
  `path`, `itemsPath`, `totalPath`, `upstreamPath`, `probeTool`) that blocks kind swaps; the
  foreign-variant and vacuous-pass `input` checks.
- `index.ts` header and this log's rule 5 restate the rule.
- Tests (`describe('acceptDelta: amend, not disable (P12 as written; BA6)')`): the round-4
  partial-neutralisation test is now `accepts an amendment that stops rejecting one variant on the
  amended property while it still rejects another (P12; BA6)`. The verifier's premium-search repro
  (`items.price.range` -> [20, 300000], D1 trace withheld) is now accepted with no reasons; M1
  violates `items.price.range` under the current contract and not under the proposed one, M2 still
  violates it under the proposed one. New: the same delta with the D1 trace given is rejected by
  the stored check alone (one `[stored]` finding on `tr_b47c5b77c6`). The kind swap, neutralisation
  ([0, 1e9]), outputSchema override and foreign-variant tests are unchanged and still reject.

Self-check (temporary local edits, each reverted): at-least-one rule disabled -> 3 tests fail
(neutralisation, foreign-variant control, outputSchema override); amended exemption removed (round-4
rule) -> 4 tests fail, the new BA6 acceptance test among them.

Evidence: `pnpm --reporter=default vitest run packages/contract-update` -> 2 files, 39 tests passed;
`-t "PLAN P12"` -> the 4 acceptance tests pass (D1 silencing rejected, its D1-as-trigger variant
rejected, benign $2,500 widening accepted with D1 still violating, M5-on-another-property delta
rejected); `pnpm typecheck` exit 0; `pnpm lint` exit 0 ("Checked 382 files ... No fixes applied").

## Round 6 (verifier findings: CallRecord probes)

Base: `git rebase main` -> already on `a585b65` (nothing to replay; the SETUP lockfile edit stays
uncommitted). SETUP re-run: `node scripts/apply-dep-fragments.mjs` -> "nothing to apply";
`pnpm install --no-frozen-lockfile` exit 0.

**Finding 1 (cases.ts, `fromCallRecord`).** A CallRecord's read-after-write probe was dropped, so a
clean v1 `create_order` CallRecord evaluated `violated` on `shop.create_order/readAfterWrite`
("no get_order probe ran"), was counted as an already-violating corpus case (corpus.verified 9 ->
8) and left out of the corpus check; every create_order mutation variant was "rejected" for the
same reason. Fixed:
- `callRecordProbe(r)` takes the probe where MON's `normalizeRecord` (packages/proxy/src/replay.ts)
  does: `r.probe`, else the `probe` of the `events[]` entry with `type: 'call'`. A probe without a
  tool or a result object is no probe. Its `http` becomes the probe's `upstream`, unless the record
  (or its proxy event) says `upstreamObserved: false`, as in MON's `replayRecord`; the same flag
  now drops the call's own upstream (`GateCase.upstream` is optional: absent = not observed).
- `exchanges()` keeps `seq`/`startedAt`/`durationMs` when the source exchange has them (MON's
  `asExchanges` does the same), so a probe from the proxy event equals the recording's.
- `fromCallRecord(r, probe?)` uses `callRecordProbe(r)` unless a probe is passed explicitly.
- `gate.ts`: a case whose contract declares postconditions and that has no probe is unevaluable:
  one fail-closed `input` finding (`... has no read-after-write probe ..., but
  shop.create_order/readAfterWrite needs it, so it cannot be evaluated; the gate fails closed`),
  and the case is not counted or noted as a pre-existing violation. This applies to every check
  (trigger, stored, corpus, mutation) and to recordings and GateCases too.

Cross-check against MON (temporary script, deleted): `order-create.json` wrapped as a CallRecord
with the probe in `events[0]` (`type: 'call'`) -> `MON probe: true CU probe: true same
tool/args/result: true same upstream: true`.

**Finding 2 (tests).** `accepts CallRecord inputs the same way as product-format recordings` now
converts the whole corpus, create_order included, with the probe in the proxy event; its summary
equals the recording run and `corpus = {total: 10, verified: 9, regressions: 0}`. New tests:
`takes a CallRecord's read-after-write probe where MON does (record, then its proxy event)` (event
probe and top-level probe equal the recording's; `violatedIds` of the create_order CallRecord is
`[]`; `upstreamObserved: false` drops both upstreams) and `fails closed on a create_order
CallRecord without its read-after-write probe` (exactly one `input` finding on that case, reason
names `shop.create_order/readAfterWrite`, no "already violates" note, corpus `{10, 8, 0}`; a
recording without its probe also fails closed; a probe without a result is no probe).
Self-check: with `src/` stashed (round-5 code) the three tests fail; restored, they pass.

BA6 (round 5) is unchanged and still holds: the premium-search [20, 300000] repro is accepted with
the D1 trace withheld and rejected by the stored check with it.

Evidence: `pnpm --reporter=default vitest run packages/contract-update` -> 2 files, 41 tests
passed; `-t "PLAN P12"` -> the 4 acceptance tests pass; `-t "BA6|CallRecord"` -> 9 pass;
`pnpm typecheck` exit 0; `pnpm lint` exit 0 ("Checked 382 files ... No fixes applied").

## Round 7 (verifier findings: P12 as written, known-good amendment)

Base: `git rebase main` -> refused only because of the uncommitted SETUP lockfile edit; HEAD
already contains main `a585b65` (`git merge-base --is-ancestor main HEAD` true), so there was
nothing to replay. SETUP re-run: `node scripts/apply-dep-fragments.mjs` -> "nothing to apply";
`pnpm install --no-frozen-lockfile` exit 0 (lockfile edit left uncommitted).

**Finding 1 (BA6; P12 as written).** The rule kept in round 5, "an amended property that rejected
at least one variant before must still reject at least one after", is a mutation condition that
P12 does not state, and PLAN §0.B BA6 records only "mutation variants still rejected except on the
amended property"; it is not recorded there as an amendment, so it is removed from `gate.ts`, the
`index.ts` header and rule 5 above. Repro now accepted: trigger `premiumProduct()` (p-1004 at
$2,499), `productVariants()`, `replaceInvariant shop.get_product price.range {kind: range, path:
price, min: 20, max: 1e6, unit: USD}` -> `accepted: true`, no reasons, amended
`[shop.get_product/price.range]`, trigger violated -> verified, stored 5/5 still violate, 0 corpus
regressions, mutation `{total: 4, rejectedBefore: 3, rejectedAfter: 2}` (M1 lost on the amended
`price.range` only; M5 still on `price.notNull`, M7 on `outputSchema`). Tests updated:
- `rejects an amendment that neutralises the property` -> `accepts an amendment after which the
  amended property rejects no variant (P12 as written; BA6)`, on the exact repro delta.
- Foreign-variant control: with the trigger's own variants the [0, 1e9] widening is now accepted
  (only the foreign variants make the difference).
- outputSchema override -> `rejects a contract-level outputSchema override the trigger does not
  need (scope)`: scope is now the only finding (M7 is lost on the amended `outputSchema`, which
  P12 exempts); the test asserts M7 violates `outputSchema` under the current contract and nothing
  under the proposed one.
Unchanged: the `applyDelta` identity check (kind swap and path/probe moves still `delta` errors),
the stored, corpus, foreign-variant and vacuous-pass checks. What still stops a delta from simply
switching a check off: scope (only properties the trigger violates), the stored traces, and every
variant still rejected on the properties not amended. This is the documented P12 limit.

**Finding 2 (known-good edit amends the trigger's onlyKnownGood property).** A removal of the
trigger's own known-good input switches every `onlyKnownGood` property off for that input, but
only replaced properties counted as amended, so a correct update for a trigger that violates e.g.
`price.notNull` on its own known-good input was rejected as soon as a variant kept the field null.
`gate.ts` now adds to the amended set (and to `GateResult.amended`, after the replaced ones) every
`onlyKnownGood` property of the trigger's contract that (a) the trigger violates under the current
contract and (b) is switched off for the trigger's input: at least one in-scope known-good edit
(the trigger's contract, a non-empty pattern matching the trigger's arguments), the trigger's
input known-good under the current contract and not under the proposed one. The "amended property
still checked on the trigger" and "amends only violated properties" scope rules still use the
replaced properties only. Repro now accepted: trigger `shop-v1/product-p-1004.json` with `price`
null in body and output (violates `shop.get_product/price.notNull` only), variants `~Mx` (name
changed, price null; violates `price.notNull`) and `~M0` (price 0; violates `price.range`), delta
`removeKnownGoodInput shop.get_product {id: p-1004}` -> `accepted: true`, amended
`[shop.get_product/price.notNull]`, trigger violated -> verified, mutation `{2, 2, 1}` (`~M0` still
rejected on `price.range`). Acceptance item 3 is intact: there the trigger does not violate
`price.notNull`, so the same removal does not amend it (the test now also asserts `amended ==
[shop.get_product/price.range]`) and M5 lost on it is still the one `[mutation]` finding. New test:
`counts a known-good edit of the trigger's input as amending the onlyKnownGood property the
trigger violates`.

Self-check: with `src/gate.ts` restored to round 6 (temporary, reverted) 4 tests fail (the two
round-7 acceptance changes, the foreign-variant control, the outputSchema override); restored, all
pass.

Evidence: `pnpm vitest run packages/contract-update` -> 2 files, 42 tests passed; `-t "PLAN P12"`
-> the 4 acceptance tests pass (D1 silencing rejected,
its D1-as-trigger variant rejected, benign $2,500 widening accepted with D1 still violating,
M5-on-another-property delta rejected); `pnpm typecheck` exit 0; `pnpm lint` exit 0 ("Checked 382 files ... No fixes
applied").

## For ORCH (`--arm fiks+cu`)

Pass the frozen trace as `trigger`, the target repo's `test/repro/*.json` as `storedViolations`,
the A0 S-dev CallRecords as `cleanCorpus`, MUT M1-M14 variants of the trigger as
`mutationVariants` (each with the trigger's tool and arguments; anything else fails closed),
CallRecords of a tool with read-after-write postconditions (create_order) with their probe on the
record or in the `type: 'call'` proxy event, as MON reads it (without one the gate fails closed),
the contract file in force as `contracts`, and
`declaredOutputSchemas(<server tools/list>.tools)` as `declaredOutputSchemas`. On rejection feed `reasons`
back to the agent; on acceptance write `renderProposal(...).markdown` and emit no `would_open_pr`.
