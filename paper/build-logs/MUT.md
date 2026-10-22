# MUT build log

Branch `ws/MUT`, based on main `c144b03` (CORE-SEED merged). Wave 1; no external actions, no
installs, no dependency fragments (`@fiks/mutate` has no dependencies and no other package imports
it yet).

## What landed (`packages/mutate`, `@fiks/mutate`)

- `mutateResponse(op, json, seed, ctx?)`: M1-M14 and B1-B4 (PLAN 5.4) as pure functions of a
  parsed JSON body. Returns `{applicable, site, changed, json, body, status?, addHeaders?, note}`.
  `mutateRecordedResponse(op, {status, headers, body}, seed, request?)` applies an operator to a
  recorded upstream response (the `response` of `HttpExchange`) and keeps the recorded body bytes
  when the body does not change. `mutationHash` hashes what a mutant sends upstream.
- `mutatePatch(op, refFixDiff, llm, opts?)`: P1-P8. Renders the committed prompts
  (`prompts/system.md`, `prompts/frame.md`, `prompts/P<n>.md`), makes exactly one call to the
  injected `llm({op, system, prompt})`, and turns the reply into a normalized diff. With
  `opts.baseFiles` (BASE sources; `baseFilesAt(repo, ref, diff)` reads them with `git show`) every
  hunk is located in the base, applied in memory (`result`), and re-emitted with correct starts
  and counts (`verified: true`). Rejected replies (no hunks, files outside the allowed set,
  renames/new/deleted/binary files, hunks that do not match the base) give `ok: false` with an
  `error`, never a throw; errors thrown by `llm` propagate (infra errors belong to the caller).
  `identicalToReference` flags a reply equal to the reference fix after normalization.
- `catalog.json`: conventions (site, idKey, timestamp, enumLike), one definition per operator,
  the M3 synonym table, prompt paths, the wrapper rules, `implementation` (sha256 of every
  `src/*.ts` and `prompts/*.md`) and `hash` = sha256 of the canonical JSON of the catalog without
  `hash`. `pnpm tsx packages/mutate/src/catalog-hash.ts` prints the hash and exits 1 when the
  catalog is stale; `--write` recomputes and formats the file.

## Choices other streams should know

- **Sites.** An operator draws one normalized path (`items[*].price`) with a PRNG keyed by
  sha256(`<op>:<seed>`) and changes every concrete value at that path, the way a real field-level
  drift does. When nothing is eligible the result is `applicable: false` and the input unchanged;
  DET should count these per (operator, response), not drop them.
- **M14** depends on the request method: for POST/PUT/PATCH the 2xx acknowledgement keeps its
  shape but the root id becomes a phantom id; for any other method (or none) the response becomes
  404 `{"error":"not_found","message":"Not found."}` (the written resource is absent on read).
  Callers pass `request.method`.
- **M12** swaps an idKey between two elements of an array of objects, or, outside arrays, moves an
  integer or digit-suffixed id to the next identity.
- **B1** is "reorder array", as PLAN 5.4 says, so it keeps JSON semantics only up to array order
  (multiset per array); B2 keeps every recorded property; B3 keeps the parsed value; B4 keeps
  status and body bytes. The tests check exactly these.
- **Typecheck of patch mutants** (PLAN 5.4 "every result must typecheck") is not run here: it needs
  the target repo's toolchain and belongs in the sandboxed pool build (HOLD/ORCH). `result` gives
  the new file contents to check.
- Test fixtures (`test/fixtures/responses.json`): the `shop-*` exchanges were recorded from
  `@fiks/vendor-api` v1 with a frozen clock; the `tracker-*` exchanges are synthetic and marked so
  in the file, until DOM2's tracker vendor exists.

## Acceptance (round 1, 2026-10-21)

| Item | Result |
|---|---|
| SETUP: `node scripts/apply-dep-fragments.mjs && pnpm install --no-frozen-lockfile` | "nothing to apply"; install done. The install rewrites `pnpm-lock.yaml` (importers for `packages/domains`, `packages/interfaces` and now `packages/mutate`, already missing on main); not committed, per PLAN 7.1 |
| `pnpm vitest run packages/mutate` | 4 files, 49 tests passed: a golden test per M1-M14 (hand-derived outputs on inputs with one eligible site, checked under 4 seeds), B1-B4 semantics over every fixture x 25 seeds, purity and "a mutant always differs" over every fixture x 25 seeds |
| Same seed -> identical output hashes over 3 runs | `test/determinism.test.ts` runs `test/fingerprint.ts` (every operator x fixture x 5 seeds) in 3 separate `tsx` processes: identical, and equal to the in-process value |
| Stub llm, P1-P8 on each D1-D5 oracle patch, applies cleanly | `test/patch.test.ts`: 40 results, each `ok` and `verified`, each passes `git apply --check` on a `git archive seed-v1` export of `.work/shop-mcp`, applies to exactly the in-memory `result`, and reverses cleanly. The stub writes sloppy replies (wrong hunk counts/starts, prose and CRLF around the fence, bare blank lines, trailing whitespace, a dropped hunk) |
| `pnpm tsx packages/mutate/src/catalog-hash.ts` | prints the catalog hash (64 hex), exit 0 |
| `pnpm typecheck && pnpm lint` | both exit 0 |

Extra: full `with-lock suite pnpm test`: 32 files, 207 tests passed.

Catalog hash at this commit: `f8a55b1603946055d9962f59943decd3f4702fcd7d213d329d0734a8298e0801`.
