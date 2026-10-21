# CORE-SEED build log

Branch `ws/CORE-SEED`, based on main `312ae5c` (the commit that adds `paper/PLAN.md` and
`paper/WORKSTREAMS.json`). Wave 0; no external actions.

## What landed

- `packages/interfaces` (`@fiks/interfaces`): every PLAN Appendix type, split by topic
  (`run.ts`, `records.ts`, `drift.ts`, `domain.ts`, `monitor.ts`, `exec.ts`, `arm.ts`, `build.ts`,
  `rerecord.ts`, `realbug.ts`). Type-only, except `formatRunKey`/`parseRunKey` for the RunKey
  string form. It depends only on `@fiks/contracts` (type imports), which is dependency-free.
- `packages/domains` (`@fiks/domains`): `registerDomain`, `getDomain`, `listDomains`. One
  registry per process (`Symbol.for` key on `globalThis`). Registering the same object twice is a
  no-op; a second object under a taken id throws. Ids are `[a-z0-9][a-z0-9-]*`.
- `packages/cli/package.json`: `@fiks/domains` and `@fiks/interfaces` as `workspace:*`. No CLI
  source changed.
- `packages/cli/src/bootstrap/README.md`: the `NN-*.ts` convention and per-file ownership.
- `scripts/apply-dep-fragments.mjs`: `--check`, `--root`, `--selftest`.

## Typing choices other streams should know

- `Domain` members use method syntax, so a domain may narrow parameters (e.g. its own vendor
  state) and still satisfy the interface. `frozenClock` is an ISO string.
- `reproEmitter(trace, spec)` returns `{files[{path, bytes}], testPath}` and writes nothing.
  `ReproTrace`, `ReproSpec` and `SuiteRun` have the same shape as `@fiks/repro`'s `Trace`,
  `ReproSpec` and `SuiteRun`, so the existing shop code fits without conversion.
- `suite.run(repoDir, scope?)` is synchronous, like today's `runSuite`. `oneFailingInScope(run,
  scope?)` is the F predicate (exactly one failing test, inside the scope).
- `createVendor(catalog, opts?)`: the Appendix form `createVendor(catalog)` compiles; `opts`
  (`version`, `drifts`, `now`) is an optional extension, default `{ version: 'v1' }` (round 2).
- `FrozenTrace.violated` is `Violation[]` (the full receipt list). `FrozenTrace.target` is
  `NonNullable<Recording['target']>`, i.e. `string[]` of property ids: the product trace format's
  `target` (`packages/contracts/src/types.ts`, consumed as property ids by
  `packages/repro/src/generate.ts` `targetOf`). Not `Violation[]` (round 2). DET should confirm.
  `all-types.ts` asserts both at compile time; flipping either type back fails `tsc`.
- `Monitor` is a callable with an optional `id`; a plain function satisfies it.
- `CliCommandModule.run` may return `void`, a number (the exit code) or a promise of either.

## Pre-existing at base

`pnpm lint` exits 1 at base `312ae5c` too: 100 errors and 1 warning, all in `paper/**` JSON
files that biome wants reformatted (`paper/WORKSTREAMS.json`, `paper/research/*.json`). This
stream does not own those paths. Running biome over every other path reports no errors.

Round 2 (rebase onto main: main still at `312ae5c`, no-op): unchanged. `pnpm lint
--max-diagnostics=1000` groups as 100 in `paper/research` and 1 in `paper/WORKSTREAMS.json`;
`biome check packages scripts` exits 0. The fix belongs to the orchestrator on main (format the
paper JSON, or add `!paper/research` and `!paper/WORKSTREAMS.json` to `biome.json`
`files.includes`). Until then the acceptance item `pnpm typecheck && pnpm lint` fails as written.

Round 3 (2026-10-21): `git rebase main` reports "Current branch ws/CORE-SEED is up to date";
main is still `312ae5c` and `biome.json`, `paper/research` and `paper/WORKSTREAMS.json` are
unchanged on main, so the orchestrator fix has not landed. Re-ran SETUP and every acceptance item:
typecheck exit 0; `pnpm lint` exit 1 with "Found 100 errors. Found 1 warning.", every diagnostic
under `paper/research/*` (100) or `paper/WORKSTREAMS.json` (1); `biome check` over this stream's
owned paths exits 0 ("Checked 25 files"); full `vitest run --reporter=json` 158/158 passed (47
files); `packages/cli/test/seed` 25/25; `domain-hooks.test.ts` 3/3; `--selftest` 22 checks
passed; `git diff --name-only 312ae5c HEAD` lists only owned paths. No code change this round.

Round 4 (2026-10-21): `git rebase --autostash main` reports "Current branch ws/CORE-SEED is up
to date"; main is still `312ae5c` (`git merge-base HEAD main` = `312ae5c`), so the orchestrator
lint fix (format the paper JSON, or exclude `paper/research` and `paper/WORKSTREAMS.json` in
`biome.json`) has still not landed. Re-ran SETUP (`apply-dep-fragments.mjs`: "nothing to apply";
`pnpm install --no-frozen-lockfile` exit 0; lockfile edit left uncommitted) and every acceptance
item: typecheck exit 0; `pnpm lint` exit 1, "Found 100 errors. Found 1 warning.", 100 in
`paper/research/*` and 1 in `paper/WORKSTREAMS.json`, none elsewhere; `biome check` over the
owned paths exits 0 ("Checked 25 files"), and over every other tracked ts/js/json file also
exits 0; full `vitest run --reporter=json` under `with-lock suite`: 158/158 passed, 0 failed;
`packages/cli/test/seed` 25/25 (exit 0); `domain-hooks.test.ts` 3/3 (exit 0); `--selftest` 22
checks passed (exit 0); `git diff --name-only 312ae5c HEAD` lists only owned paths. No code
change this round.

Round 5 (2026-10-21): `git rebase main` replayed the 4 stream commits onto main `7a1d2cf`
("biome: exclude paper/research data and run outputs from lint; format WORKSTREAMS.json"), the
orchestrator lint fix; merge base is now `7a1d2cf`. The stale uncommitted lockfile edit was
discarded before the rebase. Re-ran SETUP (`apply-dep-fragments.mjs`: "nothing to apply", no
`deps-fragments/`; `pnpm install --no-frozen-lockfile` exit 0; lockfile edit left uncommitted)
and every acceptance item:
- `pnpm typecheck` exit 0; `pnpm lint` exit 0 ("Checked 136 files ... No fixes applied."). The
  lint blocker of rounds 1-4 is resolved.
- `with-lock suite pnpm test -- --reporter=json`: exit 0, 158 passed, 0 failed, 47 files (>= 147).
- `pnpm vitest run packages/cli/test/seed`: 4 files, 25/25 passed.
- `pnpm vitest run packages/cli/test/seed/domain-hooks.test.ts`: 3/3 passed (ok fixture compiles,
  stripped negative control fails, unused-directive check).
- `node scripts/apply-dep-fragments.mjs --selftest`: "selftest: 22 checks passed", exit 0.
- `git diff --name-only 7a1d2cf HEAD`: 27 paths, all in the owns list.
Interfaces re-checked against the round-7 Appendix (DetectorVerdictRow `at`/`elementIndex`,
MonitorOptions `perElement`, FrozenTrace `violated[]` + `target[]`): present. No code change.
