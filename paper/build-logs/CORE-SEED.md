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
- `Monitor` is a callable with an optional `id`; a plain function satisfies it.
- `CliCommandModule.run` may return `void`, a number (the exit code) or a promise of either.

## Pre-existing at base

`pnpm lint` exits 1 at base `312ae5c` too: 100 errors and 1 warning, all in `paper/**` JSON
files that biome wants reformatted (`paper/WORKSTREAMS.json`, `paper/research/*.json`). This
stream does not own those paths. Running biome over every other path reports no errors.
