# INJ build log

Branch `ws/INJ`, based on main `c144b03` (CORE-SEED merged). Wave 1. No external actions: no
pushes, no repos, no installs. `node scripts/ensure-shop-mcp.mjs` made a read-only clone of
`vats98754/shop-mcp` under the worktree's `.work/` (gitignored). The root vitest config loads
every project's config, and `packages/cli/vitest.config.ts` needs that clone, so
`pnpm vitest run packages/injector` cannot start without it.

Round 2: `git rebase main` was a no-op (main is still `c144b03`); SETUP re-run. The only changes
are the lint-rule fix and its tests (the `biome.json` and `test/isolation.test.ts` entries below).
The verifier's repro (`../../../contracts/…` in `src/transforms/zz.ts`, `../contracts/…` in
`packages/injector/zz.ts`, a dynamic import of the contracts package in `src/zz2.ts`, plus an
`import type` variant in `src/transforms/zz3.ts`) now gives `Found 4 errors.` from
`pnpm biome lint packages/injector`, one `noRestrictedImports` per file. Round 1 flagged only
`zz2.ts`.

The builder read `packages/vendor-api`, `packages/interfaces`, the CLI's scenario and fixture
call lists, and shop-mcp `seed-v1`'s vendor client (`src/vendor.ts`, the `vendor.get/post` lines of
`src/tools/*.ts`), plus the D1–D5 oracle patches, which show the D1 fix keys on the version header.
It did not read `packages/contracts`, any `*.contracts.json` or `packages/proxy`.

## What landed (`packages/injector`, `@fiks/injector`)

- `src/rule.ts`: the `InjectorRule` schema (`ruleSchemaErrors`), `readRule`, `validateRule`
  and `ruleHash`.
  - The rule hash is `sha256(canonicalJson(rule without hash) + "\n" + transform module bytes)`, so
    rule-file formatting does not change it, and every change to match, clock or code does.
  - `match.method` is `*` or `GET|POST`-style. `match.pathPattern` is a regex source matched
    against the pathname only.
  - `transform` is relative to the rule file.
  - A transform must be self-contained (`import type` only), because only its own bytes are
    hashed.
- `src/transform.ts`: the transform module contract. The default export is
  `{description, setHeaders?, response(req, res, ctx)}`.
  - `response` rewrites matched responses.
  - `setHeaders` applies to every response.
  - `ctx.now()` is the rule clock, and `ctx.state` is per injector instance.
- `src/injector.ts`: `startInjector({target, rule, clock?, ruleDir?, verifyHash?, port?})`
  returns `{url, rule, close, reset, stats}`. It also exports `injectorMiddleware(rule, opts)`,
  which is structurally `UpstreamMiddleware`; each `start(target)` is a fresh injector, as P7's
  restart requires.
  - The rule's hash is checked before listening; a tampered rule is refused.
  - Under `clockFrozen`, the `date` header is the frozen clock, never Node's wall clock. The
    default frozen instant is `2026-01-01T00:00:00.000Z`; record runs pass `Domain.frozenClock`.
  - Bodies, queries and end-to-end headers are forwarded unchanged. Hop-by-hop headers and
    content-length are recomputed.
  - An unreachable upstream gives a 502 that names the rule.
- `src/driftpkg.ts`: `driftPkgSchemaErrors`, `loadDriftPackage` and `validateDriftPackage`.
  - Paths are relative to the manifest.
  - The manifest's `injectorRule.hash` must equal the rule's hash, and its ids and domain must
    match the rule's.
  - `--complete` also requires the grader part that HOLD fills.
- `src/validate-rule.ts`: the CLI (`[--complete] [--write-hash] <rule-or-manifest.json>...`).
  Exit 0 means valid, 1 means a problem, 2 means a usage error.
- `biome.json` (nested, `root: false`, `extends: "//"`): `style/noRestrictedImports`, scoped to
  `packages/injector`. Round 2 (verifier finding): the round-1 globs only caught relative paths
  exactly two levels up (`../../contract*/**`), so `../../../contracts/...` from `src/transforms/`
  and `../contracts/...` from the package root passed. The groups are now `@fiks/contract*`,
  `@fiks/prox*` (each also `/**`) and the depth-independent `**/contract*`, `**/contract*/**`,
  `**/prox*`, `**/prox*/**`. Biome matches these gitignore-style against the specifier text.
  - Covered (each a probe in `test/isolation.test.ts`, at `packages/injector/probe.ts`, `src/`,
    `src/transforms/` and `test/`): any specifier with a path segment starting `contract` or
    `prox` (the package names, subpaths, bare `contracts`, relative paths at any depth, absolute
    paths) in `import`, `import type`, `export … from`, `export type … from`, side-effect
    `import '…'` and dynamic `import('…')`.
  - Not covered by the lint rule (checked by hand, Biome 2.5.15): `require('…')` or
    `createRequire(…)('…')`, and a segment that differs only in case (`../../../Contracts/…`,
    which resolves on macOS's case-insensitive file system). Biome globs have no character
    classes and no case option. A test covers these instead (below).
  - Side effect: an injector-local file or folder named `contract*` or `prox*` cannot be
    imported. None exists.
  - The globs are spelled so that the acceptance `grep -R` finds nothing in the package.
  - The package imports the shared types by relative path (`../../interfaces/src/drift.ts`), not
    through `@fiks/interfaces`. That package depends on `@fiks/contracts`, so a pnpm symlink to it
    under `packages/injector/node_modules` would make `grep -R` (which follows symlinks) match.
  - The only workspace dependency is `@fiks/vendor-api` (dev, tests).

## Rules and manifests

| id | base | match | change |
|---|---|---|---|
| D1 | seed-v1 | GET `^/products$` | `items[].price` → `Math.round(price*100)`, same field |
| D2 | seed-v1 | GET `^/products/[^/]+$` | `price` → `unit_amount` (key moves last, as v2 serializes it) |
| D3 | seed-v1 | GET\|POST `^/orders(/[^/]+)?$` | POST without `Idempotency-Key`: the id is remembered as dropped; a later GET of it → 404 `{"error":"not_found","message":"Unknown order."}`. The latest acknowledgement of an id wins, so ids reused after a vendor reset stay right |
| D4 | seed-v1 | GET `^/products$` | pages of 5 by offset `cursor`, `next_cursor` string or null, `total` unchanged |
| D5 | seed-v1 | GET\|POST `^/orders(/[^/]+)?$` | `created_at` ISO → epoch ms (create response and order resource) |
| DEV-X1 | base-shop | GET `^/products/[^/]+$` | silent: `price` in minor units (integer cents); `currency` moved after it (value unchanged). Search, statuses, OpenAPI and version header unchanged |

- D1–D5 also set `vendor-api-version: 2026-10-01` on every response, as vendor v2 does. The D1
  oracle fix (`packages/cli/test/oracles/D1.patch`) converts only when that header is
  ≥ 2026-10-01, so a rule without it would grade the reference fix wrong.
- DEV-X1 sends no version bump, because no release is announced.
- Every manifest has `stratum: dev`, `authorSession: INJ-builder-r1` and an `ideationFamily`
  (unit, rename, lost-write, pagination, timestamp-format, unit).
- `hiddenTests`, `refA`, `refB`, `renamedIdVariant` and `generators` are empty: HOLD fills them in
  its own full copies.
- All six rules are `clockFrozen: true`. None reads the clock, but the flag freezes the `date`
  header.

## Tests (`pnpm vitest run packages/injector`: 3 files, 62 tests)

- `test/parity.test.ts`:
  - For each of D1–D5, every sequence is compared:
    - the 6 CLI scenarios (`v1-all` = the 10 fixture calls, D1…D5);
    - the 10 fixture calls;
    - the extras: search `''` (3 pages under D4), create with an Idempotency-Key, a second create,
      an invalid create, an unknown order, `/openapi.json` and an unknown route.
  - Each sequence runs on a fresh vendor v2 with only that drift, and on a fresh vendor v1 plus the
    rule. Both use the same frozen clock.
  - The two sides must have equal status, content-type, `vendor-api-version` and body bytes on
    every response.
  - Requests are what seed-v1 shop-mcp sends. On top of that, every search follows `next_cursor`
    and every create is followed by a get_order probe.
  - The test is not vacuous: each drift's v2 differs from v1 somewhere, and each rule matched
    requests.
  - The determinism test runs 10 times per rule (6 rules) under the frozen clock and hashes
    every header (incl. `date`) and every body of all sequences. The run gives one hash per rule.
  - DEV-X1: every status, content type and version header equals v1's, `/openapi.json` is
    byte-equal, and only get_product bodies differ, at least once.
- `test/rule.test.ts`: covers the following.
  - Schema rejections.
  - Hash: the shipped hashes equal the computed ones; key order and formatting do not change the
    hash; match, flag and one-byte transform edits do; `startInjector` refuses a stale hash.
  - Transform rejections: a value import, a bad default export, a missing file.
  - Manifests: the six ids and bases; no base, a stale hash or a foreign rule fails; `--complete`.
  - The CLI: main() exit codes; the acceptance command spawned with tsx; `--write-hash`.
  - Injector behaviour: middleware restarts have fresh state; bodies and headers reach upstream;
    a 502 on a dead upstream; frozen vs live `date`.
- `test/isolation.test.ts` (20 tests):
  - No file in the package (node_modules excluded) names the two packages.
  - The real root and injector Biome configs, in a temp tree, reject 16 forbidden import probes
    (the forms listed above, at four depths). A probe at `packages/cli/...` is not flagged (the
    rule is scoped), and a normal import passes. Biome's stdin mode prints no diagnostics, hence
    the temp tree. Against the round-1 `biome.json`, 8 of the 16 probes fail.
  - A resolution check, independent of the lint globs: every quoted relative or absolute string
    in the package's `.ts/.js` files is resolved (realpath, compared case-insensitively) and must
    not land in `packages/contracts/` or `packages/proxy/`. Files outside the package reached that
    way (today only `packages/interfaces/src/drift.ts`, which imports nothing) are walked
    transitively, and none may import the two packages by name or path. Manual mutations,
    reverted: `require('../../../proxy/…')` and `import type … '../../../Contracts/…'` in
    `src/transforms/`, and an `import type` of `../../interfaces/src/domain.ts` (which imports
    the contracts package by type), each fail this test.
- Mutation check (manual, reverted): D4 page size 5→4, D3 without the 404, and D5 `ms+1`, each
  re-hashed. The three parity tests and the "differs from v1" test fail.

## Notes for other streams

- ORCH `bootstrap/30-injector.ts`: `injectorMiddleware(loadDriftPackage(f).rule, {clock: domain.frozenClock})`.
- DET/HOLD: `loadDriftPackage(file)` gives `{pkg, rulePath, rule}`, and the rule's `hash` is the
  P7 profile hash.
- D3 state lives in the injector, not in the vendor. In-process `vendor.state.orders` still holds
  the dropped orders, and `droppedOrders` is empty. A `truth()` over vendor state therefore needs
  the injector's view; the D3 rule does not rewrite `/__admin/state`.
- The `pnpm install` in SETUP rewrites `pnpm-lock.yaml`: main's lockfile predates CORE-SEED's
  packages, and this branch adds `packages/injector`. As PLAN 7.1 requires, it is not committed;
  the orchestrator regenerates it at merge.
