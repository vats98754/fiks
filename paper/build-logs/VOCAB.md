# VOCAB build log

Branch `ws/VOCAB`, based on fiks main `c144b03`. Wave 1 (depends on CORE-SEED). Plan items P15
(vocabulary, fpCapability, `disabled`, perElement) and P19 (re-vendor + pinned sync).

## Freeze-ledger entry (F2)

| Item | Value |
|---|---|
| shop-mcp re-vendor commit (`base-shop^{commit}`, peeled) | `b77a0a05f2c18fadd289e7bf59b2ccc0aaff3155` |
| `base-shop` annotated tag object | `92aabd40e5d27b6ff108230bac2cbe32f0322368` |
| shop-mcp branch carrying it | `fiks/revendor-f2` (parent `7bf2e66`, shop-mcp main at the time) |
| Files changed vs `7bf2e66` | `test/fiks/vendored/evaluate.ts`, `test/fiks/vendored/types.ts` only |
| shop-mcp CI on that commit | success, https://github.com/vats98754/shop-mcp/actions/runs/39704372646 |
| Pinned in fiks | `packages/contracts/shop-sync-ref.json` (`ref`) |
| `seed-v1^{commit}` | `bb037cf8ac313d2ad2c5d683476a527a9147e1c7` (unchanged) |

External actions taken by this stream (PLAN §8.0-3): one push of branch `fiks/revendor-f2` and tag
`base-shop` to `vats98754/shop-mcp`. shop-mcp `main` was not touched (still `7bf2e66`).

**Merge checklist (orchestrator, at VOCAB's merge into fiks main; not done by the builder):**

```
git -C .work/shop-mcp push origin 'base-shop^{commit}:refs/heads/main'   # fast-forward only
```

(`7bf2e66` is the parent of `b77a0a0`, so this is a fast-forward while shop-mcp main is still
`7bf2e66`.) Log it in PROGRESS.md.

## What landed

- `packages/contracts/src/types.ts`, `evaluate.ts` (vendored into shop-mcp by the commit above):
  - invariant kinds `enum` (closed world; null/absent skipped; optional `onlyKnownGood`),
    `crossField` (`left op right` per object at `path`, numbers with `tolerance`, timestamps as
    instants, JSON equality otherwise) and `pageComplete` (the last 2xx upstream page carrying
    `upstreamCursorPath` must say "no more"; skipped when no response carries it);
    `InvariantKind`, `CrossFieldOp`;
  - receipt text: a message per new kind, and `describeViolation(v)` (one line:
    `<propertyId>: <message> (expected <expected>)`);
  - `disabled: true` / `disabledReason` on any property (`PropertyFlags`): not evaluated, listed
    in `EvalResult.disabled` (present only when non-empty, so receipts without flags are
    unchanged), never in `checked`; `EvalOptions.reenable` (full property ids) evaluates them;
  - `EvalOptions.perElement`: range, notNull, nonEmpty, unique, freshness, enum and crossField
    return one Violation per violating element (`path` = concrete element location). Default off;
    the default path is byte-identical to ec241bc (tests below).
  - `evaluate(contract, input, opts = {})`: the third argument is new and optional.
- `packages/contracts/src/fp-capability.ts` (not vendored): `fpCapability(property, endpointMeta)`
  → `entailed | capable | knownGoodOnly` per PLAN §3.1, `fpCapabilityTable(file, endpointFor)`,
  `propertyFamily(path)` (last non-index segment, D12). `EndpointMeta = {paginated, idFamilies?}`;
  `idFamilies` defaults to `['id']` (unique on a primary id is entailed). `onlyKnownGood` wins over
  the kind rule.
- `scripts/sync-contracts.mjs --check --ref <sha>`: compares against `git show <sha>:<path>` in the
  clone; `--ref` without `--check` exits 2.
- `packages/contracts/shop-sync-ref.json` + `test/sync.test.ts`: the sync test checks against the
  pinned peeled commit, so a fresh clone passes whatever its HEAD is.
- `scripts/ensure-shop-mcp.mjs`: clones if missing; refuses a dirty clone (exit 1, nothing
  changed); fetches tags (and the pinned commit if still missing) once per pinned ref, remembered
  as `fiks.fetchedFor` in the clone's git config, so later runs make no network call; checks out
  the pinned ref detached; installs deps when the lockfile is newer. `FIKS_SHOP_DIR` overrides
  the location; `FIKS_SHOP_SKIP_INSTALL=1` skips the install (tests on throwaway clones). Fails if
  the local `base-shop` tag does not peel to the pinned ref.
- `scripts/contract-disable.mjs --contracts --ids --reason --log`: full property ids
  (`<contract>/<property>`), invariants and postconditions. Unknown or already-disabled id or
  usage error: exit 2, file untouched, no log line. Edits textually (keeps layout; re-runs Biome
  only if the file was Biome-formatted before), then a structural JSON diff must show exactly the
  listed properties' `disabled` and `disabledReason`, else nothing is written (exit 1). Appends
  `{at, contracts, ids, reason, contractsSha256Before, contractsSha256After}`.
- Tests: `test/vocab.test.ts` (kinds with true/false fixtures, perElement, disabled/reenable,
  ec241bc byte-identity, fpCapability, propertyFamily), `test/contract-disable.test.ts`,
  `test/ensure-shop-mcp.test.ts` (throwaway local clones, no network), `test/sync.test.ts`.
- `test/replay-logged.ts`, `test/capture-scenarios.ts`, `test/replay-lib.ts`, and fixtures
  `test/fixtures/scenario-records.json` (D1–D5 + v1-all through the harness, shop-mcp seed-v1,
  vendor clock 2026-10-18T12:00Z) and `tool-schemas.seed-v1.json` (seed-v1 tools/list
  outputSchemas).

## Notes for other streams

- MON: pass `{ perElement: true }` and `{ reenable: [...] }` as the third `evaluate` argument;
  read `EvalResult.disabled`. Old two-argument calls are unchanged.
- DET/AN: `fpCapabilityTable(SHOP_CONTRACTS, () => ({ paginated: false }))` gives the §3.1 shop
  table; the tracker needs its `paginatedEndpoints` and primary-id families as `EndpointMeta`.
- After VOCAB merges, `pretest` leaves `.work/shop-mcp` detached at `base-shop`; a clone with local
  edits makes `pnpm test` stop at pretest (by design).
- `pnpm-lock.yaml` in this worktree differs from main only by the CORE-SEED packages that
  `pnpm install` adds; not committed (fragment rule).

## Acceptance evidence (round 1)

See the structured report for commands and outputs; key numbers:
`replay-logged.ts bench/results`: 200 logged CallRecords (114 verified, 76 violated, 10
unverifiable), 0 verdict changes, 0 checked/violation-id changes, 0 old/new differences; D1–D5
scenario traces (fixture and live): 0 old/new differences.

## Round 2 (rebased on main 6157cb4, head 7cb0969)

All VOCAB acceptance items re-run on the rebased head and green. These cover SETUP, contracts
56/56, replay-logged (0 changes), ls-remote (main 7bf2e66, fiks/revendor-f2 = base-shop^{commit}
= b77a0a0), the fresh-clone sync check, ensure-shop-mcp (pin, dirty refusal, GIT_TRACE fetch
counts 1 then 0), typecheck and lint.

Cross-stream blocker (MON-owned file, not edited by VOCAB): `with-lock suite pnpm test` fails only
`packages/proxy/test/replay.test.ts` "--per-element passes perElement: true ...". The fixture's spy
calls the real evaluator with `perElement: true`, then replaces only the first range violation with
its own per-element rows. With VOCAB's real per-element support, the items[2] violation is already
present, so it appears twice. Proposed one-line fix in the spy:
`realEvaluate(c, i, o && { ...o, perElement: false })`. When it was applied temporarily (then
reverted), the file passed 12/12. MON's real-evaluator test (two rows at items[0] and items[2])
already passes against VOCAB's evaluator.

## Round 3 (rebased on main aa7e28a, BENCHX + DOM2 merged)

`git rebase main` applied both VOCAB commits cleanly (no conflicts). SETUP re-run: apply-dep-fragments
"nothing to apply", `pnpm install --no-frozen-lockfile` exit 0, ensure-shop-mcp leaves
`.work/shop-mcp` at b77a0a0 = shop-sync-ref.json ref.

Re-verified on the rebased tree: `pnpm vitest run packages/contracts` 56/56; replay-logged 200
CallRecords, 0 verdict changes, 0 old/new differences (D1-D5 fixture and live traces);
ls-remote main 7bf2e66, fiks/revendor-f2 = base-shop^{} = b77a0a0; fresh-clone sync check
"identical"; diff 7bf2e66..base-shop lists only vendored evaluate.ts/types.ts; seed-v1 bb037cf;
`grep -c disabled` 5; contracts diff vs ec241bc empty; shop-mcp CI on b77a0a0 success;
ensure-shop-mcp pins a main-HEAD clone, refuses a dirty clone at main (exit 1, HEAD unchanged),
GIT_TRACE fetch count 1 then 0; typecheck and lint clean.

`with-lock suite pnpm test`: exit 1, 1 failed | 279 passed (280). The only failure is still the
MON-owned `packages/proxy/test/replay.test.ts` spy test (same cause as round 2; VOCAB does not edit
it). With the one-line spy fix `realEvaluate(c, i, o && { ...o, perElement: false })` applied
temporarily (reverted, not committed), the full suite gives exit 0, 49/49 files, 280/280 tests.
MON or the orchestrator must land that fix before or with VOCAB's merge.
