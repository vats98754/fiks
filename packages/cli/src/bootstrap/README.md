# CLI bootstrap modules

Files named `NN-<name>.ts` in this folder (`NN` = two digits) are side-effect modules. The CLI
entry point (`packages/cli/src/main.ts`, loader by CORE, PLAN P18) loads `.env`, then imports every
file matching `^\d{2}-.+\.ts$` here in sorted file-name order, then resolves the command. Nothing
else in this folder is loaded, including this README.

A bootstrap module only registers things, for example `registerDomain(...)` from `@fiks/domains`.
It exports nothing that other code relies on (`BootstrapModule` in `@fiks/interfaces`), and it
must not depend on another bootstrap file having run, except through the load order below.

## Ownership (one stream per file)

| File | Owner | Registers |
|---|---|---|
| `00-shop.ts` | CORE | the `shop` Domain |
| `10-tracker.ts` | DOM2 | the `tracker` Domain |
| `20-sandbox.ts` | ORCH | the Docker `ExecBackend` |
| `30-injector.ts` | ORCH | the injector middleware factory |
| `40-realbugs.ts` | RBA | an `rb-<id>` Domain per `realbugs/<id>/adapter.json` |

A new bootstrap file is a new number, owned by one stream. No stream edits another's file.

## Imports

A bootstrap file imports `@fiks/domains`, `@fiks/interfaces` and its owning stream's packages
only. `packages/cli/package.json` is owned by CORE-SEED: a stream that needs another `@fiks/*`
package here commits `deps-fragments/<STREAM>.json` instead, for example

```json
{ "stream": "DOM2", "add": { "packages/cli": { "@fiks/vendor-tracker": "workspace:*" } } }
```

and applies it locally with `node scripts/apply-dep-fragments.mjs && pnpm install --no-frozen-lockfile`
without committing the `package.json` or lockfile edits. The orchestrator applies fragments at merge.
