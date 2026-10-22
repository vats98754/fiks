# CORE build log

Branch `ws/CORE`, based on main `c144b03` (CORE-SEED merged at `83e12bd`). Wave 1, round 1.
External actions: none. The only network access was the SETUP clone of the public
`vats98754/shop-mcp` into the worktree's `.work/shop-mcp` by `scripts/ensure-shop-mcp.mjs`
(read-only). No push, repo, account or third-party write. `pnpm-lock.yaml` changes from
`pnpm install --no-frozen-lockfile` are not committed (the new `@fiks/domains` and
`@fiks/interfaces` workspace dependencies of `packages/repro` and `packages/vendor-api` need a
lockfile regeneration at merge). No `deps-fragments/CORE.json`: every new import into
`packages/cli` was already a dependency of it.

## What landed

- **CLI loader (P18).** `packages/cli/src/main.ts` has no command switch. It loads `.env` (not
  under `--require-sandbox`), imports `bootstrap/*.ts` in sorted file-name order, imports every
  `commands/*.ts` and keeps the default exports `{name, describe, run}`, then dispatches: a
  default export wins over `legacy/<name>.ts`; a file without a default export is ignored; no
  command prints the ec241bc USAGE (exit 0), an unknown one prints it and exits 1.
  `packages/cli/src/legacy/` holds one adapter per ec241bc command (vendor-diff,
  record-fixtures, rerecord, scenario, call, repro, repair, confirm, bench, demo, summarize). Each
  parses the ec241bc flag table (`legacy/common.ts`, plus `--domain`, `--fetch`, `--run-key`
  and `--help`), calls the same named function and prints the same output; `help()` returns the
  command's ec241bc USAGE line(s). Commands that do not take `--domain` reject any value but
  `shop` (exit 2).
- **Shop Domain (P8).** `packages/vendor-api/src/domain.ts` `createShopDomain(parts)`; registered
  by `packages/cli/src/bootstrap/00-shop.ts` with the repro hooks from `@fiks/repro`
  (`shopReproEmitter`, `shopSuite`) and the bench `TASKS`. Members: `createVendor(catalog, opts)`,
  `frozenClock = '2026-10-01T12:00:00.000Z'` (`SHOP_FROZEN_CLOCK`), `truth`, `entityClass`,
  `originEntity`, `injectorHook` (wraps the factory ORCH's `30-injector.ts` registers with
  `registerInjectorFactory`, re-exported from `packages/cli/src/harness.ts`), `versionHeader`,
  `contractsPath`, `baseUrlEnv`, `serverCommand`, `repo`, `seedTag`, `scenarios` and
  `fixtureCalls` (moved to `packages/vendor-api/src/scenarios.ts`; the CLI re-exports them
  unchanged), `tasks`, `promptHints`, `enumerate`, `paginatedEndpoints`, `reproEmitter`,
  `suite`, `allowedEditPaths = ['^src/.+\\.ts$']`.
- **`--domain` threading.** harness (`startHarness({domain})`), scenario, record-fixtures,
  rerecord, rerecord-stale, vendor-diff (shop only: other domains drift through injector rules,
  so it refuses them), repro and paths (`repoDir(domain)`, `repoAt(ref, domain)`; `shopAt` kept).
- **Vendor catalog option.** `createVendor({catalog: 'original'|'extended-only'|'all',
  extended})`, `vendor-api` main `--catalog`/`--extended` (or `VENDOR_CATALOG`,
  `VENDOR_EXTENDED_CATALOG`). Extended entities come from a JSON file (default
  `packages/vendor-api/catalog/extended.json`, written at A0; not present yet), live in the `px-`
  id namespace, are validated (unique, no original id) and keep `authorBatch` in the vendor state;
  the API never serves `authorBatch`. `original` is the `CATALOG` object itself.
- **truth / entityClass / originEntity.** `packages/vendor-api/src/truth.ts` (`shopTruth`,
  `semanticDiff` with the PLAN 3.0 equality) and `src/originEntity.ts` (`shopEntityClass`,
  `shopOriginEntity`, keyed by concrete element paths such as `items[2].price`). Neither imports
  the contracts or proxy package; `packages/vendor-api/biome.json` (a nested config extending the
  root) makes that a `noRestrictedImports` lint error, checked by planting an import (error
  reported, then removed).
- **Repro package.** `createWorktree(repo, ref, {dir, branch, fetch, runKey})` resolves
  `git rev-parse --verify <ref>^{commit}`, never fetches unless `fetch` is set, and refuses a
  fetch with a run key. Every `git worktree prune|add|remove` (also `addWorktree` and `repoAt`)
  runs under `withWorktreeLock` (an atomic lock directory in the repository's common git dir,
  stale when its owner pid is dead or it is older than 120 s). `generateRepro(trace, file,
  repoDir, domain)` writes what `reproHooks(domain).reproEmitter` returns; `failGate(..., runs,
  domain)` and `passGate(..., domain)` run `reproHooks(domain).suite` and judge only failures in
  its scope (plus the domain's `oneFailingInScope`). `reproHooks('shop')` falls back to the
  ec241bc defaults when the bootstrap has not registered the shop Domain (library use, tests).
  `Trace.profile` (optional) carries the injector-aware profile.
- **Harness (P7, clock).** `startHarness` builds vendor -> [injector] -> [middleware...] -> tap
  -> server, records the chain (`h.chain`), and passes its `clock` to both the vendor and
  `ProxyOptions.now`, so `CallRecord.at` equals the vendor clock. Each `rerecord()` starts a
  fresh harness, i.e. restarts the chain.
- **rerecord with profiles.** `rerecord(file, {profile, rule})`: with a rule id the vendor runs at
  `profile.base` with that rule (the `InjectorRule` must match id and hash); without one the
  recording's own upstream decides, as at ec241bc. A trace that names its own profile must agree
  with the given one. Overlay mode accepts any repo-relative `.json` path and returns bytes only.
- **`fiks rerecord-head` (P23)**, `packages/cli/src/commands/rerecord-head.ts` (default export):
  `--worktree --profile <json|file> --from <commit> --log <file> [--recordings a,b] [--check
  P|IV|suite|traces|ci|accept] [--require-sandbox] [-- <check command>]`, and `--restore
  <manifest>`. Step 1 = `rerecordStale` (mode `stale`, `*.rerecorded.json` kept). Its suite run
  goes through the `node --require` preload `packages/repro/src/fs-read-log.cjs`
  (`FS_READ_LOG_PRELOAD`), whose log names every file the check read. Step 2 re-records every
  other recording read or named, and writes the re-recording at the original path (mode
  `overlay`) when the head sends a request the recording never saw. With a command after `--`
  the overlay is in place while it runs and the originals are restored afterwards; without one
  it stays until `--restore`. One `RerecordLog` line (plus `at`) per call; `fromCommit` is
  resolved to a sha. Under `--require-sandbox`, `main.ts` exits 2 unless `FIKS_IN_SANDBOX=1`
  and never loads `.env`.
- **Docs.** `packages/vendor-api/docs/shop.md`, see below.
- **Fixture.** `packages/cli/test/core/fixtures/D2-trace.json`, a byte copy of
  `/Users/anvayvats/fiks/.fiks/traces/tr_079b90c89e.json` (sha256
  `b6baf03ea14d2fb6ce8bc7df91a223df63177c8dfc8995f7ab1f87ef9e524d15`, in `fixtures/README.md`;
  `packages/cli/test/core/biome.json` keeps Biome from reformatting it).

## Shop docs: authorship and contract exposure (for the F2 ledger entry)

`packages/vendor-api/docs/shop.md` was written by the CORE builder (this session, Claude Opus
5.5, 2026-10-21). The author **had read the shop contracts** (`packages/contracts/contracts/
shop-mcp.contracts.json`: price range bounds, total minimum, freshness window) before writing it,
as PLAN 5.2 item 2 anticipates. Sources used: `packages/vendor-api/openapi.json`
(`src/openapi.ts`) and the vendor source (`src/server.ts`, `src/catalog.ts`), describing API
version 2026-01-01 only (no v2 behaviour, no drift). Mitigations: the docs state no numeric
bound on any contract-constrained field (price, total, created_at); JSON examples use type
placeholders (`<number>`) instead of values; the catalog's price range is not mentioned.
Mechanical check: `grep -nE '\b(20|2000|0\.5|365)\b' packages/vendor-api/docs/shop.md` prints
nothing (also asserted in `packages/vendor-api/test/entity.test.ts`). BLIND's check-no-bounds
re-checks it at F2.

## Interpretations and decisions (for the verifier)

1. **Bootstrap file pattern.** Acceptance (c) of `loader.test.ts` plants `bootstrap/zz-boot.ts`,
   which the seed README's `^\d{2}-.+\.ts$` pattern would not load. The loader therefore imports
   every `bootstrap/*.ts` (not `*.d.ts`) in sorted order; `NN-*.ts` files still load by number,
   before any `zz-*`. The README (CORE-SEED's file) still describes only `NN-*.ts`.
2. **`scenario v1-all --domain shop --json` (DEVIATION, needs an orchestrator decision).** The
   acceptance text says "every verdict is 'verified'"; that does not hold as written. Nine of the
   ten calls are `verified`; the `get_product {"id":"p-0000"}` fixture call (a deliberate
   unknown-id call) returns a tool error and the proxy reports it as `unverifiable` ("the tool
   returned an error"), with or without `--domain` and at ec241bc. Changing it would break the
   byte-identical legacy requirement (`legacy-behaviour.test.ts`), so the product is unchanged.
   The test asserts exactly that: 9 `verified` + 1 `unverifiable` for p-0000, no `violated`,
   and byte-equality (after normalisation) with the run without `--domain`. Proposed amended
   text: "every verdict is 'verified' except the deliberate unknown-id call get_product p-0000,
   which is 'unverifiable' as at ec241bc; no verdict is 'violated'; identical to the same command
   without --domain".
3. **Profile semantics for legacy recordings.** With `ruleId: null` the recording's own upstream
   (version, drifts, clock) decides, as `rerecord` did at ec241bc; `profile.base` is logged and
   used only with a rule. The D3/D4 test uses `{domain: 'shop', base: 'v2', ruleId: null}`: the
   D3/D4 traces were captured under full v2 and the stale v1 fixture under v1, and both must
   re-record against their own upstream.
4. **Overlay candidates.** Recordings under the product's own folders (`test/fixtures`,
   `test/repro`, `test/traces`) are overlaid only when named with `--recordings`: the suite
   asserts each of them through `expectRecordingHolds`, so step 1 already catches them going
   stale. Every other `.json` recording read during the suite run (e.g. `.alerts/<id>.json`, files
   loaded by agent tests) is re-recorded and overlaid when its request keys changed.
5. **`paginatedEndpoints` is `[]`.** The spec has an optional `cursor`, but v1 returns every match
   on one page, and PLAN 3.1 classes shop `countMatchesTotal` as entailed ("v1 unpaginated").
6. **extended-only has no seed order** (`o-5001` names original product `p-1005`).
7. **`00-shop.ts` imports `@fiks/bench`** for `TASKS` (already a `packages/cli` dependency), in
   addition to CORE's own packages.
8. **Repro emitter bytes.** `shopReproEmitter` serialises the trace object
   (`JSON.stringify(trace, null, 2)`) and formats it in memory with fiks's Biome (same version
   and formatter settings as shop-mcp). For traces written by `saveTrace` this is the file's
   content; `domain-hooks.test.ts` (a) shows the bytes equal ec241bc's `generateRepro` output.
9. **Enumeration.** `shopEnumerate` emits S-ext (get_product per entity), S-grid (up to 200
   seeded queries from name prefixes, word pairs, categories and names; `laptop`, `monitor` and
   `cable` excluded) and S-write (single-line `create_order` per entity x quantity 1, 2, each
   followed by `get_order` with `order_id: '$prev.order_id'`, `ORDER_FROM_PREVIOUS`). DET owns
   the `fiks enumerate` command; the frame rules are fixed in PREREG.
10. **Worktree lock evidence.** `worktree-lock.test.ts` passes (20 cycles, 4 processes, `git fsck`
    clean, no leftover worktree or lock). As a negative control I disabled the lock locally and
    ran the test twice: it also passed both times, so the test shows the locked path is
    consistent under concurrency, not that the lock is needed for this workload (git's own
    locking already serialises most of it). The lock stays as the P6 safeguard.

11. **`--require-sandbox` exit code through pnpm (DEVIATION, needs an orchestrator decision).**
    `tsx packages/cli/src/main.ts rerecord-head --require-sandbox ...` on the host exits 2 with
    "sandbox required" (asserted in `sandbox.test.ts`). Run literally as `pnpm fiks ...` it exits
    1: `pnpm run` (9.12.3) turns any non-zero child exit into 1 (checked with a bare script that
    calls `process.exit(2)`). The root `fiks` script is not CORE's file and pnpm's behaviour is
    not ours to change. ORCH, ARMS, HOLD and RBA must therefore invoke the CLI directly
    (`tsx packages/cli/src/main.ts rerecord-head --require-sandbox ...`, or node with the tsx
    loader) whenever they need to tell exit 2 apart from 1; this is documented in the header of
    `packages/cli/src/commands/rerecord-head.ts`. Proposed amended text: "tsx
    packages/cli/src/main.ts rerecord-head --require-sandbox ... on the host exits 2 with
    'sandbox required' (via `pnpm fiks` the stderr message is the same, the exit code is 1)".
12. **Planting tests use a private copy of the CLI (round 2 flake fix).** Round 1's `loader.test.ts`
    and `domain-hooks.test.ts` wrote and deleted temporary modules in the real
    `packages/cli/src/{commands,bootstrap}` under a lock that only those tests took. CLI
    subprocesses of other test files (sandbox, legacy-*, rerecord-head, ...) list those folders
    and then import each file, so a file deleted in between made them exit 1 with
    `ERR_MODULE_NOT_FOUND` (seen once in the verifier's full suite: `sandbox.test.ts:72`). The
    planting tests now copy `packages/cli/src` to `<ROOT>/.work/cli-<random>/src` (gitignored, same
    depth as `packages/cli`, so ROOT and .env resolve the same; `package.json`, `node_modules` and
    `test` are symlinked) and run that copy's `main.ts`; nothing writes into the real src any more,
    and `withSrcLock` is gone. `loader.test.ts` also asserts that the real CLI does not see the
    planted `zz-probe` while it exists in the copy.

## Acceptance evidence

See the structured report of this round (commands and key output); the full suite count is in
the last section of this file.

## Full suite (round 1)

`with-lock suite pnpm test -- --reporter=json --outputFile=<tmp>/full1.json`: exit 0,
212 passed, 0 failed, 212 total (baseline at `c144b03` in this worktree: 158/158).
`pnpm typecheck` and `pnpm lint` exit 0.
