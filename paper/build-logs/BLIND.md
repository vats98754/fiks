# BLIND build log

Branch `ws/BLIND`, based on main `bd19858` (wave 1 complete). Wave 2; depends on CORE, VOCAB, INJ,
DOM2, SBX, LLMR (all merged at the base). No external actions: no repo was created (the approved
private `vats98754/driftbench-blind` is not needed until F6; A1 writes to a local checkout), no push,
no install. Network use: only the read-only `ensure-shop-mcp.mjs` / `ensure-tracker-mcp.mjs`
checks of the existing `.work/` clones. No LLM call was made: every session ran with a stub author
(`--llm-stub`).

SETUP: `node scripts/apply-dep-fragments.mjs` (applied `deps-fragments/BLIND.json`: `@fiks/authoring`
into `packages/cli`) `&& pnpm install --no-frozen-lockfile && node scripts/ensure-shop-mcp.mjs`. The
resulting `packages/cli/package.json` and `pnpm-lock.yaml` edits are not committed.

## What landed

- `packages/authoring` (`@fiks/authoring`):
  - `export.ts`, `deny.ts`, `sources.ts`: manifest-built exports outside `~/fiks` (refused under
    `~/fiks`, `~/fiks-wt` or the checkout; default `$TMPDIR/blind-exports`), the manifest beside
    the export (`<dir>.manifest.json`, so the export's file list equals `files`), the deny list on
    every kind (paths and content sentinels, excluded files listed), server files read with
    `git show` at a peeled ref.
  - `session.ts`: `runAuthorSession` = LLMR `agentSession` (settingSources [], cwd = export, web
    tools disallowed) with a permission hook: realpath containment for Read/Glob/Grep/Write/Edit,
    Bash executed in a per-session `--network none` SBX container (`DockerExecBackend`) and relayed,
    every tool call logged; a `blind_sandbox` line is appended to the transcript; `auditTranscript`
    checks header, cwd, web tools, forbidden reads and sentinel strings.
  - `catalog.ts`: batches of 25, a fresh export and session per batch (same prompt), ids
    `px-bNNN-NN` / `TX-BNNN-NN` (disjoint from the original catalog), `authorBatch` `bNNN`, entities
    validated with the vendors' own `validateExtended`, `--top-up` continues the numbering.
  - `contract.ts`, `contract-schema.ts`, `record.ts`: protocols tracker / shop-blind (docs + 30
    original-catalog v1 calls, round-robin per tool, seed `contract-author-v1`) and llm (tool
    descriptions + 20 S-dev records, from `--sdev-records` or recorded here under `--monitor none`
    semantics); schema check, then VOCAB's `evaluate` on every export call (read-after-write probes
    replayed on a fresh chain); written with an AUTHORING log only when valid.
  - `drift.ts`, `a1.ts`, `runner.ts`, `keep.ts`, `split.ts`, `validate.ts`: ideation (Opus via
    `complete`, open-weight via `ollamaChat`, same prompt), seeded idea order, implementation into
    DriftPackages (base `base-shop` / `seed-tracker-v1`), ref B by a fixer that never sees ref A,
    realism rater, A1 runner (concurrency from throughput.json, cap-stop with quarantine, $ and
    session ceilings), keep rule (idea-index order, S12 minimum), seeded stratified split,
    validate-drift.
  - `nobounds.ts`: check-no-bounds.
- CLI (P18 command modules): `author`, `validate-drift`, `split`.
- `paper/blind-protocol/`: briefs (catalog x2, contract-author, contract-format, contract-llm,
  taxonomy, drift-realistic, drift-evasive, benign, fixer, rater, ideation x3) and README.

## Decisions and deviations (recorded, none changes a hypothesis or gate)

1. VOCAB ships the contract types and evaluator but no runtime loader or JSON schema.
   `contract-schema.ts` mirrors `packages/contracts/src/types.ts` field by field (known kinds,
   required fields, no unknown keys, unique ids, tools of the server, `disabled` refused); the
   evaluator is VOCAB's own `evaluate`.
2. The deny list is applied as written. Most tracker vendor source files import `@fiks/…` and are
   therefore excluded from drift/fixer exports (only `main.ts` survives); the docs carry the
   behaviour. Shop keeps `server.ts`, `openapi.ts`, `main.ts`.
3. validate-drift's determinism check replays the server's recorded upstream requests twice
   through fresh vendor + rule instances at the HTTP level (the base-shop server itself sends a
   random `Idempotency-Key`, which a tool-level comparison mistook for a nondeterministic rule).
4. validate-drift runs hidden tests and generators on the host (throwaway worktrees of the
   `.work/` clone). Author sessions' Bash runs in the container; validity checks (R0, no LLM) do not.
5. Benign changelogs: a seeded half (by drift id) keep the author's changelog line; realistic and
   evasive drifts are silent (no `changelog` field).
6. Without `--llm-stub`, `author` refuses while `$HOME/.fiks/build-swarm.active` exists.

## Acceptance evidence (re-run on bd19858 + 4e25bc3)

- `with-lock suite pnpm vitest run packages/authoring` -> `Test Files 9 passed (9)`,
  `Tests 82 passed (82)`, 255 s.
- Exports (test/exports.test.ts, 29 tests): all 8 kinds from base-shop and from tracker-mcp main
  (pinned `bfc0e1e`): outside ~/fiks; `listFiles(dir)` equals the manifest; the acceptance `find`
  and `grep -rlE` print nothing. Tracker contract-author export = docs/** + exactly 30 `calls/`.
- Contract authoring (test/contract.test.ts, 16 tests): tracker -> `tracker-mcp.contracts.json` +
  `AUTHORING-tracker.md` under `$TMPDIR/blind-ca-*`; one transcript header with cwd = the export and
  `settingSources: []`; schema valid; evaluator on 30 calls, 0 errors; AUTHORING log has model,
  manifest sha256, transcript sha256 (both re-hashed), session id, timestamps, validation; the stub's
  Bash ran in a `--network none` container (`EGRESS_DENIED EAI_AGAIN`). Same for shop-blind; llm
  seed 2 for both domains (tools.json + 20 calls). Invalid stub: exit 1, no file, `git status
  --porcelain packages/contracts/contracts` empty. Shop contracts' readAfterWrite verified via the
  replayed probe (0 violations, 0 replay mismatches).
- Catalog (test/catalog.test.ts): `--batches 3` -> 75 entities, `b001..b003`, ids disjoint from the
  original catalog, identical prompts with no other batch's output, three distinct exports of docs +
  BRIEF.md; `--top-up` adds `b004`.
- Dry run (test/dry-run.test.ts): `pnpm fiks author --kind drift --domain shop --dry-run
  --llm-stub …` -> `shop-realistic-000` (base `base-shop`, ref A, ref B, rating) passes
  `pnpm fiks validate-drift` (schema, base, spec, determinism, base-fails 2/3, refA 3/3 + renamed
  3/3, refB 3/3 + renamed 3/3) and the injector's `validate-rule --complete`. Planted invalid drifts
  fail exactly one check each: spec (`GET /openapi.json differs under the rule`), base-fails
  (`0/3 fail on base`), refA (`hidden 1/3 pass`), determinism (Math.random in the rewriter).
  Transcripts: no sentinel string; header settingSources [], cwd = export, WebFetch/WebSearch
  disallowed; the author's Bash ran in the repo image with `network: none`.
- A1 runner (test/runner.test.ts): a stub cap on call 5 pauses (no start between cap and resume),
  discards and quarantines the capped and in-flight sessions, waits to the reset, re-runs them; the
  kept set equals the uninterrupted run's. Session ceiling 5 and $1 ceiling stop the run.
  Concurrency from throughput.json = 2 on a planted file.
- Split (test/keep-split.test.ts): `pnpm fiks split --seed F7-seed` twice -> identical sha256 and
  bytes; 24 dev + D1-D5, 96 test.
- check-no-bounds (test/nobounds.test.ts): FAIL on a planted brief with `$2,000` and on a planted
  docs line `The price is between 20 and 2000 USD.`; PASS on the real briefs, shop.md and the
  tracker docs; prints the sha256 of every brief and both docs sets.
- `git diff --name-only main...HEAD` lists neither `packages/cli/package.json` nor `pnpm-lock.yaml`.
- `pnpm typecheck` and `pnpm lint`: clean.
- Not run by the builder: the full `pnpm test` (left to the merger's re-check under the suite
  lock, BA3); no `[LIVE]` item exists in this stream.
