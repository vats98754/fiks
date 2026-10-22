# DOM2 build log

Branch `ws/DOM2`, based on main `c144b03` (CORE-SEED merged). Wave 1; depends on CORE-SEED only.
Imports: `@fiks/interfaces`, `@fiks/domains` and the MCP SDK. No other `@fiks/*` package is
imported (`@fiks/repro`, `@fiks/proxy`, `@fiks/contracts` are not), so the repro hooks, the
recorder and the minimal rule proxy are self-contained copies of the shop-side logic.

## What landed (fiks)

- `packages/vendor-tracker` (`@fiks/vendor-tracker`):
  - `src/server.ts`, `src/model.ts`, `src/catalog.ts`, `src/main.ts`: issue-tracker vendor, v1
    only (drifts come from an injector rule, so the served OpenAPI never changes). 20 original
    issues `TRK-101..120` with 30 seed comments; paginated `GET /issues` (page size 10, not stated
    in the docs: clients follow `next_page`); issue, comments, transitions (workflow table),
    labels, assignees; `/__admin/state` (the plain `VendorState` JSON, incl. an event log of every
    mutation and refused transition) and `/__admin/reset`. `--catalog original|extended-only|all`
    (`TRACKER_CATALOG`), extended entities from `catalog/extended.json`
    (`TRACKER_EXTENDED_CATALOG`; absent until A0) validated with `authorBatch` kept, keys in the
    `TX-...` namespace. `TRACKER_CLOCK` freezes the clock for the standalone binary.
  - `docs/openapi.json` + `docs/tracker.md`: public docs, committed in `96ec54e`, before any
    tracker contract (including the dev stub, `41dad82`). No `example`/`minimum`/`maximum` and no
    numeric bound on any response field; no fiks vocabulary.
  - `src/truth.ts` (`trackerTruth`), `src/entityClass.ts`, `src/originEntity.ts`,
    `src/paths.ts`: see "Rules" below. A biome `noRestrictedImports` override and
    `test/static.test.ts` (transitive local-import closure) keep `@fiks/contracts`/`@fiks/proxy`
    out of truth/originEntity/entityClass.
  - `src/enumerate.ts`: S-ext (get_issue + list_comments per issue), S-grid (200 seeded search
    inputs from title prefixes, word pairs, keys, labels, assignees, type x state filters),
    S-write (add_comment -> list_comments, first allowed transition -> get_issue).
  - `src/hooks.ts`: `trackerReproEmitter` (trace JSON + repro test in tracker-mcp's
    `test/repro/` layout, same shape as shop's), `trackerSuite` (tracker-mcp vitest suite, JSON
    reporter, scope `**`), `TRACKER_ALLOWED_EDIT_PATHS = ['^src/.+\\.ts$']`.
  - `src/domain.ts`: `trackerDomain` (`frozenClock = 2026-10-01T12:00:00.000Z`, `seedTag =
    seed-tracker-v1`, `contractsPath = packages/contracts/contracts/tracker-mcp.contracts.json`
    (written at A0), `baseUrlEnv = TRACKER_BASE_URL`, `versionHeader = tracker-api-version`,
    `paginatedEndpoints = [GET ^/issues$ page]`, `repo.dir() = FIKS_TRACKER_DIR ??
    .work/tracker-mcp`). `injectorHook` reads the factory ORCH registers through CORE's
    `registerInjectorFactory` (same `Symbol.for('fiks.injector.factory')` slot); it throws a clear
    error when none is registered. `createVendor` refuses any version but `v1` and any built-in
    drift list.
  - `tasks/prompts.json` (20 prompts, PLAN 5.9) + `src/tasks.ts` graders (answer terms + vendor
    state checks).
  - `src/record.ts` (tap + recorder over tracker-mcp stdio), `src/record-fixtures.ts`
    (tracker-mcp `test/fixtures/v1`), `src/devdrift.ts` + `src/build-trk-dev-1.ts` (TRK-DEV-1).
  - `fixtures/dev-stub.contracts.json`: dev-only stub contract (search, get_issue,
    list_comments; no postconditions, so the v1 fixtures without probes still replay).
  - `fixtures/driftpkgs/TRK-DEV-1.json` + `TRK-DEV-1/`: see "TRK-DEV-1".
  - `tracker-sync-ref.json`: pins tracker-mcp main `bfc0e1ea1b13b4d03d1fc43ce19977a7013ecceb`,
    required tag `dev-tracker-stub`.
- `packages/cli/src/bootstrap/10-tracker.ts`: `registerDomain(trackerDomain)`.
- `scripts/ensure-tracker-mcp.mjs`: clone (ssh; the repo is private; `TRACKER_MCP_REMOTE`
  overrides) into `.work/tracker-mcp` (`FIKS_TRACKER_DIR`), one `fetch --tags` per pinned ref
  (`fiks.fetchedFor`), refuses a dirty clone, ends detached at the pin, installs deps
  (`FIKS_TRACKER_SKIP_INSTALL=1` skips). Idempotent.
- `deps-fragments/DOM2.json`: `@fiks/vendor-tracker` into `packages/cli`.

## Rules (entity class, origin, truth)

- Entity class = the issue's catalogued `type:state` (e.g. `bug:open`), a stable property of the
  entity: calls that move an issue do not change its class. Child tools (comments, labels,
  assignees, transitions) take the parent issue's class. `search_issues` element paths
  (`items[i]...`) take the element's class; collection paths (`''`, `items`, `count`, `total`)
  take the filter class `<type|*>:<state|*>` when a type or state filter is given, else `all`.
  Unknown keys fall back to the type/state the output reports, else `unknown`.
- Origin unit = the issue key (get_issue; every path of a child tool = the parent issue);
  search element paths = the element's key; search collection paths = the S-grid query id
  `query:<canonical JSON of the args>`.
- truth(call, state): `state` is the vendor state right after the call (in-process object or the
  `/__admin/state` JSON; identical). add_comment: the comment the output names (else the latest
  with that body); transition_issue: the latest logged move of that key to `to` (refused -> the
  input is invalid, error expected). Semantic equality as PLAN 3.0 (null = absent, instants,
  NFC, float tolerance).

## tracker-mcp (external, github.com/vats98754/tracker-mcp, private; created 2026-10-22 UTC)

- main `bfc0e1e`: 7 tools (search_issues follows `next_page`, get_issue, list_comments,
  add_comment, transition_issue, update_labels, assign_issue), each with an outputSchema;
  `test/fiks` copied from shop-mcp (`replay.ts`, `check.ts`, `contracts.test.ts`,
  `traces.test.ts` unchanged; `run.ts` loads `vendored/tracker-mcp.contracts.json` only if it
  exists, else no contract), vendored `evaluate.ts`/`types.ts` = fiks main `packages/contracts`
  with the generated header; 15 v1 fixtures (frozen clock); `vendor/openapi.json` = the docs;
  CI `permissions: contents: read`, `persist-credentials: false`, no secrets. Biome ignores
  recorded data (`test/fixtures`, `test/repro/*.json`, `test/traces`, `vendor`). No contracts.
  CI run 39708948718: success.
- branch `dev/stub` and annotated tag `dev-tracker-stub` = `1b8547a` = main + the stub contract
  at `test/fiks/vendored/tracker-mcp.contracts.json` (byte-identical to
  `fixtures/dev-stub.contracts.json`). CI run 39709012696: success. Not an ancestor of main.
- Nothing else was pushed. `seed-tracker-v1` does not exist yet (ORCH seed-tag at A0).

## TRK-DEV-1 (dev only, never confirmatory)

- Rule `TRK-DEV-1/rule.json`: `GET ^/issues/[^/]+/comments$`; transform moves the comment list
  from `items` to `comments` and sets `tracker-api-version: 2026-10-01` on every response (spec
  unchanged, status 200, `total` unchanged). Transform follows the packages/injector contract as
  built by INJ (default export `{description, setHeaders?, response(req, res, ctx)}`,
  `import type` only); hash = sha256(canonical rule + "\n" + transform bytes), as INJ's
  `ruleHash`. INJ was not merged when this was built: the hidden-test data is produced by a
  minimal rule proxy in `src/devdrift.ts`; once INJ lands, `validate-rule.ts` should accept the
  rule unchanged (to be confirmed by INJ/HOLD).
- Base behaviour: tracker-mcp's `list_comments` reads `body.items ?? []`, so it silently returns
  `items: [], count: 0` with `total: 3` -> stub property `tracker.list_comments/countMatchesTotal`
  violated.
- ref A (`refA.patch`): read `comments ?? items`. ref B (`refB.patch`, written independently in
  style): accept whichever envelope field is an array, error if none, `Number(total)`.
- Hidden tests (5, self-contained vitest files for `<tracker-mcp>/test/hidden/`, lenient stub
  matched by method + path): other issue (3 comments), single comment, no comments, add then
  list (another tool flow on the drifted field), v1 format preserved. Renamed-id variant
  (`hidden-renamed/`): every `TRK-<n>` -> `TRK-9<n>`, `cm-<n>` -> `cm-9<n>`. Upstream bodies come
  from vendor v1 behind the rule under the frozen clock; expected outputs from v1 truth().
  `generators.ts`: seeded `generate(seed, n)` over list_comments/add_comment inputs.
- `tsx packages/vendor-tracker/src/build-trk-dev-1.ts [--check]` regenerates the generated
  files byte-identically.

## Acceptance evidence (round 1)

See the structured report for the command list. All run on `ws/DOM2` after SETUP
(`node scripts/apply-dep-fragments.mjs && pnpm install --no-frozen-lockfile`; package.json and
lockfile edits not committed).
