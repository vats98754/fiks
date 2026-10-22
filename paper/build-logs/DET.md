# DET build log

Branch `ws/DET`, worktree `/Users/anvayvats/fiks-wt/DET`, cut from main `bd19858` (wave 1 complete:
CORE, VOCAB, MON, MUT, INJ, DOM2, LLMR, BASE and AN merged). Wave 2, round 1.

SETUP: `node scripts/apply-dep-fragments.mjs && pnpm install --no-frozen-lockfile && node
scripts/ensure-shop-mcp.mjs` (shop-mcp at the pinned `0fde2b4`, tags `seed-v1`, `base-shop`), plus
`node scripts/ensure-tracker-mcp.mjs` (tracker-mcp `bfc0e1e`, tag `dev-tracker-stub`) and the
analysis venv the PLAN preamble names (`python3.12 -m venv paper/.venv && paper/.venv/bin/pip
install -r paper/scripts/requirements.txt`; gitignored, BA7) for the per-element H1 item. The
`packages/cli/package.json` and `pnpm-lock.yaml` edits from the fragments stay uncommitted.

No external actions: no pushes, no repos, no installs beyond the venv above. No `[LIVE]` item.

## What landed

`packages/frame` (`@fiks/frame`): the pure parts. Nothing under `src/` imports `@fiks/proxy` or the
evaluator; from `@fiks/contracts` it takes only `fpCapability`, `propertyFamily` and types (lint rule
in `packages/frame/biome.json`, static test). `src/label.ts` imports neither package.

- `paths.ts`: `resolvePath` (the contracts' path grammar, written here so frame code never imports
  `select`).
- `enumerate.ts`: `frameEnumeration` (the Domain's strata on a catalog, minus the contracts'
  `knownGoodInputs` read as data, and on `extended-only` minus any row whose args name an original
  entity) and `driftEnumeration` (below).
- `endpoints.ts`: tool -> upstream endpoint per domain (read from shop-mcp and tracker-mcp
  `src/tools/*.ts`) and the injector rule matcher.
- `records.ts`: `DetCallRecord` = Appendix `CallRecord` + `inputId` (the EnumRow dedupe key),
  `seq`, `truth` {inputValid, agrees, mismatches} and, for mutants, `mutation[]`. Run directory:
  `calls.jsonl`, `controls.jsonl`, `nonattributable.jsonl`, `detection.json`, `manifest.json`.
- `verdicts.ts`: DET's compare rule. Per property: violated / verified (checked, no violation) /
  unverifiable (not checked), and a postcondition is `unverifiable` whenever the record holds no
  read-back probe (see "Postconditions offline").
- `attribution.ts`: `attributeCall` (attributable iff the property verifies on the v1 control;
  a missing control attributes nothing), the `nonattributable.jsonl` row, `summarize`, `ivSets`,
  `frozenTrace` (product trace format: full receipt `violated`, `target` = [first attributable],
  profile {domain, base v1, ruleId, ruleHash}, exchanges with the frozen clock as `startedAt`) and
  `sidecarPath` (`x.json` -> `x.iv.json`).
- `frame-k.ts`: FrameSpec from frame records. Dedupe by (domain, tool, args, sha256(upstream
  response bodies)); Clean = truth() agrees; eligible = Clean, structured, and >= 1 FP-capable
  property applies by path resolution; attribution keyed by concrete path (`items[2].price`) to the
  record's `originUnit` (Domain.originEntity at record time); entities and `authorBatch` from the
  record manifest; families; cells (property x entity class, inputs counted once); K; entailed
  properties; `neRule`, `crit` and power from `binom.ts` (exact, log-space pmf).
- `label.ts`: truth() labels for detector rows (`correct` / `wrong` / `invalid-input`).

`packages/cli/src/commands/` (new default-export modules, P18):

- `enumerate.ts`: `--domain --frame --catalog extended-only|original --seed`, or `--drift <pkg>`;
  writes JSONL + `<out>.sha256` and prints `sha256 <hex>`.
- `record.ts`: `--frame | --drift | --benign | --mutant <op>`, `--monitor contracts|none|<module>`,
  `--contracts`, `--catalog`, `--server-ref` (frame: `base-shop` / `seed-tracker-v1`; drift: the
  package's `base`), `--server-dir`, `--direct`, `--limit`. Chain: in-process vendor (v1, the
  Domain's `frozenClock`) -> injector (`@fiks/injector` `startInjector`, same clock) -> tap -> tool
  server (stdio) -> `startProxy({logOnly: true, monitor, now: frozenClock})`. Drift/benign run a
  second pass on a fresh vendor without the rule (controls, `controlOf` = the drift call id).
- `freeze-trace.ts`: first call in enumeration order with an attributable violation -> trace +
  sidecar {driftId, callId, controlCallId, attributableProperties, ivProperties, ivExcluded,
  traceSha256}; otherwise `{"detected": false}` and no sidecar. A pure function of the record dir
  and the contracts.
- `frame-k.ts`: refuses records not made with `--frame --monitor none` and any record carrying a
  receipt.
- `detect-eval.ts`: `contracts` (MON `normalizeRecord` + `replayAll`, now := capturedAt;
  `--per-element`), `b-schema`, `b-ajv`, `b-snap`, `b-trig`, `b-stat[:mode[:w]]` (BASE
  `runDetector`; B-SNAP/B-STAT reference = the inputs' controls or `--reference`). Rows =
  DetectorVerdictRow + inputId, role (call/control), mutant, truthLabel. `--replays n` fails unless
  every replay gives byte-identical rows.

`deps-fragments/DET.json`: `@fiks/baselines`, `@fiks/frame`, `@fiks/injector`, `@fiks/mutate` ->
`packages/cli`. `packages/frame/package.json` devDependencies (`@fiks/injector`, `@fiks/proxy`,
`@fiks/repro`, `@fiks/vendor-api`, `@fiks/vendor-tracker`) are for tests only; the lockfile needs a
regeneration at merge for the new importer.

## Decisions and interpretations (for the verifier and the orchestrator)

1. **Per-drift enumeration** (PLAN 5.7 "tools touching the drifted endpoint x (original + seeded
   50-entity extended sample) + the query grid"): rows of `Domain.enumerate({catalog: 'all'})`;
   S-ext rows whose tool touches the rule's endpoint and whose entity is original or sampled; the
   first 50 rows of the seeded S-grid (always, `--grid`); S-write pairs (write + its read-back) when
   either tool touches the endpoint. Seed default = the drift id. Sample = seeded Fisher-Yates over
   the sorted extended entity ids.
2. **Postconditions offline.** The evaluator returns `readAfterWrite` *violated* ("no get_order probe
   ran") on a record without a probe (MON build log). DET's compare rule maps any postcondition on a
   probe-less record to `unverifiable`, which is what PLAN N7 / 3.1 require; the test asserts it.
3. **`<contract>/outputSchema`** is checked by the evaluator but is not in the F2 `fpCapability`
   table. frame-k lists it in `entailedProps` (a truthful output that breaks the tool's own declared
   schema is a tool defect: a sanity count, never an FP), so `h1_precision.py` does not reject such a
   row as "neither FP-capable nor entailed". **Orchestrator decision needed** if this should be
   recorded as a §9.5 note before F4b.
4. **Tracker primary ids**: `EndpointMeta.idFamilies` = `['id', 'key']` for tracker (issue `key`,
   comment `id`), `['id']` for shop; `paginated` from `Domain.paginatedEndpoints` via the endpoint
   table.
5. **Frame call ids = EnumRow dedupe keys**, so MON replay rows' `callId` is the FrameSpec input id
   `h1_precision.py` expects. Drift calls also use the dedupe key; controls `<key>~v1`; mutants
   `<op>:<input callId>`, their control keeps the input call id.
6. **Events**: `[{type: 'call', monitor, at, upstreamObserved, logOnly, toolDef, receipt?, probe?}]`
   plus `{type: 'probe', ...}` when a probe ran (MON reads the call event's `probe`, BASE reads the
   probe event). Wall-clock fields (`monitorMs`, tap `startedAt`/`durationMs`) are dropped.
7. **Mutants**: every exchange of the input record (call, then probe) is mutated with seed
   `<op>:<callId>:<i>`; records where the operator applies nowhere are skipped (counted in the
   manifest). The control is the same server re-run on the unmutated exchanges (asserted equal to the
   input output). Truth for a mutant: agrees iff its output equals the control's (semantic diff).
   Postcondition operators (M14) need inputs recorded with `--monitor contracts` (probe exchanges);
   on `--monitor none` inputs readAfterWrite is unverifiable on both sides.
8. **fs spy**: the CLI loads every command module at start, and `@fiks/contracts`' index imports the
   default shop contracts JSON as a module (`SHOP_CONTRACTS`), so that file appears in the spy log of
   any `pnpm fiks` command. The test therefore passes a private copy via `--contracts` (as MON's
   acceptance does) and asserts `record --frame --monitor none` never opens it, and that the same run
   with `--monitor contracts` does (spy works).
9. **Planted base-tool/truth() disagreement**: the frame record runs on a base-shop worktree with one
   committed test plant (`get_product` upper-cases the name of `px-s0750`); the manifest records that
   commit, not base-shop's. Exactly that input is excluded from Clean.
10. **Re-record gap (CORE; affects ARMS/INTEG)**: `rerecord()` starts the harness with the default
    catalog `original` (`startHarness` -> `createVendor(opts.catalog ?? 'original')`), and the
    re-record profile carries no catalog. A frozen trace on an extended-catalog call (the planted D4
    trace; any per-drift trace whose call returns a sampled extended entity) would be re-recorded
    against the wrong catalog by `rerecord-head`. DET's parity test re-records the call with DET's
    own chain (vendor `all` + the extension + the D4 rule + frozen clock) and writes
    `<id>.rerecorded.json` in the product format. CORE/ORCH should carry the catalog (and the
    extended catalog file) in the profile before R4.
11. **Determinism**: shop-mcp `create_order` sends a random `Idempotency-Key`, recorded in the
    request headers, so `calls.jsonl` of S-write rows differs between reruns (outputs do not). The
    F4b hash is taken once from the recorded set; `freeze-trace`, `frame-k` and `detect-eval` are
    pure functions of the record files (three/twenty runs identical).
12. `seed-tracker-v1` does not exist before A0, so `record --domain tracker --frame` (default ref)
    fails until ORCH cuts the tag; tracker drifts use their package base (`dev-tracker-stub`).
13. `paper/harness/detect/**` is owned but unused in round 1 (no driver beyond the CLI was needed).

## Acceptance evidence (round 1, base bd19858)

Commands run in the worktree with the SETUP above. Test files: `packages/frame/test/*.test.ts`.

| Item | Status | Evidence |
|---|---|---|
| SETUP | pass | fragments applied (DET: 4 deps), install exit 0, ensure-shop-mcp exit 0 (0fde2b4); `git diff --name-only main...HEAD` lists neither `packages/cli/package.json` nor `pnpm-lock.yaml` |
| `pnpm vitest run packages/frame` | pass | `with-lock suite pnpm vitest run packages/frame`: 6 files, 31 tests passed (4m37s) |
| enumerate x2, 750-entity extension, 2 batches | pass | frame.test "shop: same sha256 twice; no original id, no known-good argument; single-line S-write orders" (3950 rows, 750 S-ext, every create_order 1 line) and "tracker: same sha256 twice" (4700 rows). Manual: shop sha `2d7b1cc8…`, tracker `434a4463…` |
| record --frame --monitor none on base-shop; frame-k | pass | frame.test: 3950 CallRecords, capturedAt `2026-10-01T12:00:00.000Z`, outputs + truth, no receipt/verdict/probe, `create_order` = `POST /orders` only, spy never saw the private contracts copy (the `--monitor contracts` control run did); FrameSpec `checkFrameSpec` = [], N_E 750, every eligible input attributed, the planted `get_product px-s0750` (mismatch `name`) is the only not-Clean input, 5 families, entailed list, `hash` = sha256(calls.jsonl). Static check: static.test |
| record --drift DEV-X1 log-only | pass | drift.test: outputs byte-equal to `--direct` (no proxy) on every call; violated receipts present; controls mirror every call; p-1001 `price.range` violated on drift, verified on control |
| record --domain tracker --drift TRK-DEV-1 | pass | drift.test: through the `10-tracker` bootstrap, server ref `dev-tracker-stub`; with `fixtures/dev-stub.contracts.json` >= 1 violated (detected: `tracker.list_comments/countMatchesTotal`); without contracts every verdict unverifiable |
| record --mutant M1 / M14 | pass | drift.test: on monitored v1 records, controls reproduce the input outputs; M1 outputs differ (e.g. search `items[*].price` x100); M14 outputs differ and `readAfterWrite` is attributable on phantom writes |
| freeze-trace x3 + repro F | pass | drift.test: 3 runs, identical trace and sidecar sha256; `pnpm fiks repro --trace t1.json --target base-shop --runs 3` -> "F gate on base-shop: PASS: fails for the stated reason on 3/3 runs" (shop.get_product/price.range) |
| detect-eval contracts,b-snap,b-schema | pass | drift.test: `--replays 20` -> distinctHashes 1; rows carry truthLabel and originUnit; a second run is byte-identical |
| static: label* imports | pass | static.test (and the biome rule: a probe file importing `@fiks/contracts` under `src/label*` fails lint) |
| diff excludes package.json / lockfile | pass | `git diff --name-only main...HEAD \| grep -E 'packages/cli/package.json\|pnpm-lock.yaml'` -> no match |
| offline replay = live (non-postcondition) | pass | frame.test: per-property verdicts of MON replay over the `--monitor none` records equal the live `--monitor contracts` receipts on every non-postcondition property (> 10,000 comparisons, same property sets); `readAfterWrite` unverifiable offline on every create_order (live: verified) |
| git status paper/results empty | pass | static.test |
| planted FP (a)(b)(c) | pass | planted.test: (a) the $9 search placed first is not frozen (target `shop.get_product/price.range`), its `items.price.range` row is in nonattributable.jsonl (entity px-plant9, control violated); (b) no-op rule: violations exist, `detected: false`, freeze-trace writes `{"detected": false}` and no sidecar (also `--benign` with the same package); (c) D4 on seed-v1: frozen call = the planted search, violated = {items.price.range, countMatchesTotal}, target = [countMatchesTotal], sidecar ivProperties has countMatchesTotal, ivExcluded has {items.price.range, violated} |
| FIKS parity on the planted D4 trace | pass (DET part) | planted.test: `repro --trace d4.trace.json --target seed-v1 --runs 3` F PASS, every failing line names countMatchesTotal and none items.price.range; seed-v1 + D4.patch worktree, emitted repro + re-recorded `<id>.rerecorded.json` (decision 10): `passGate` ok (repro passes, whole shop-mcp suite passes) while the re-recorded call still violates items.price.range. fiks-iv / the FIKS arm part is INTEG's |
| per-element H1 | pass | per-element.test: attribution items[0..2].price -> px-ext-a/b/c; `replay-cli --per-element` -> 2 rows (items[0], items[2]); `h1_precision.py` Z = {a: 1, b: 0, c: 1}, X 2, fpInputs 1, fpElements 2; receipt-level rows exit 2 "per-element rows required" |
| clock | pass | frame.test: capturedAt = frozenClock on every record (frame none, frame live, drift, controls, tracker); verdict maps and replay-cli rows byte-identical under the +400-day clock-shift preload |
| `pnpm typecheck && pnpm lint` | pass | both exit 0 |

Full suite (`with-lock suite pnpm --reporter=default test`, 1114 s): 110 files, 988 passed, 7
skipped, **1 failed**, not DET's: `packages/contracts/test/ensure-shop-mcp.test.ts` "a clone on main
ends detached at the pinned ref" asserts that a fresh clone's `main` differs from the pin, but
shop-mcp `main` was fast-forwarded to the pin `0fde2b4` at VOCAB's merge (`git ls-remote ... main`
= `0fde2b4c...`). It fails the same way run alone; VOCAB/orchestrator to update its precondition.
The first full-suite attempt stopped before running anything because `packages/frame` reused the
CLI project's `groupOrder` with a different `maxWorkers`; it now has its own group (4).
