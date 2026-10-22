# RBX build log

Branch `ws/RBX`, based on main `c144b03` (CORE-SEED merged). Wave 1. External actions: none
(no repo created, nothing pushed, nothing installed beyond the existing lockfile versions).

## What landed

- `packages/replay-proc` (`@fiks/replay-proc`), process-level replay for unmodified MCP servers:
  - `matchers.ts`: `requestKey(req, config)`. With no config it is byte-for-byte the shop-mcp
    strict key (`test/fiks/replay.ts`: method, path+query, body, significant header names);
    `strictRequestKey` is the same function. `MatcherConfig.normalisers`: `nonce` (query names,
    JSON body paths with `[*]`, form fields), `timestamp` (named fields, or `auto` for every
    ISO-8601 / epoch s / epoch ms value), `authRefresh` (method + path regex: any body/query, and
    the recorded token exchange may answer any number of times), `pattern` (url or body regex).
    Also `ignoreHeaders` and `headerValues` (headers whose value must match, e.g. a version
    header). Normalisers rewrite recorded and live requests alike and never mutate them.
  - `replay-server.ts`: `replayServer(recordings, {matchers, tls})`. Takes `Recording`s (call
    then probe exchanges) or `HttpExchange`s; each exchange answers once in `seq` order unless
    reusable; anything else gets 599 `UNMATCHED_REQUEST`. Exposes `unmatched`, `served`, `handle`.
  - `https.ts`: the HTTPS shim. `createCertificateAuthority()` (throwaway CA via the `openssl`
    CLI, 2-day certs, fresh temp dir), `localTls(ca)` for an HTTPS replay on 127.0.0.1
    (base-URL mode), and `startHttpsShim({hosts, handle, ca})`: a CONNECT/forward proxy that
    terminates TLS for the named hosts and answers from the replay, and refuses (403, listed in
    `denied`) every other destination. Child env: `HTTPS_PROXY`/`HTTP_PROXY`,
    `NODE_USE_ENV_PROXY=1`, `NO_PROXY=localhost,127.0.0.1,::1`, and CA trust through
    `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`.
  - `spawn.ts`: `spawnServer(cmd, env, opts)` + MCP stdio client. Raw `tools/list` and
    `tools/call` (no SDK output-schema validation, as in the proxy). By default the child gets
    only the SDK's default variables plus `env`, never the host's whole environment (no secrets).
  - `replay-process.ts`: `replayRecordingProcess(rec, opts)`: replay server (http, https or
    proxy mode) → base-URL env override → spawn → `tools/list` (declared outputSchema) →
    `tools/call` → read-after-write probe → `evaluate` at `capturedAt`. Same semantics as the
    shop-mcp in-process `replayRecording`, including the clock: `clock: 'skew'` (default)
    freezes `Date` at capturedAt + 10 years through `src/clock-preload.mjs`
    (`NODE_OPTIONS=--import`, Node servers only; checked under tsx too), `capture` and `real`
    are the alternatives. The evaluator is injectable (e.g. a target repo's vendored one).
    `verdictSummary` is what parity and determinism checks compare.
- `scripts/ensure-realbugs.mjs` `(--all | --id <id>) [--pins-dir <dir>]`: reads
  `realbugs/<id>/pins.json` `{repo, prefixSha, fixSha}` (`prefix`/`fix` accepted), requires
  `repo` = `vats98754/<name>` (else exit 2, even when an override URL is set), resolves
  `https://github.com/<repo>.git` or `FIKS_REALBUG_REMOTE_<ID>`, clones into
  `.work/realbugs/<id>` if absent, keeps `origin` = that URL and removes any other remote,
  fetches a pinned SHA only if it is missing (by SHA; fallback: heads, tags and `refs/pull/*`),
  and points local tags `prefix` and `fix` at the pins. Prints one JSON summary per bug
  (`cloned`, `fetched`, `tagged`). Exits 0 / 1 (git failure) / 2 (usage or pins). Exports
  `resolveRemote`, `parsePins`, `remoteEnvName`, `ensureOne`, `main` for tests. Not wired into
  any root script (root `package.json` belongs to INTEG); RB-* streams call it in SETUP.

## Notes for other streams

- RB-* `pins.json` must carry `repo`, `prefixSha` and `fixSha` (40-hex). Cloning the private
  `vats98754/rb-*` repos over https needs git credentials for github.com (e.g. `gh auth
  setup-git`); not exercised here (no real-bug repo exists yet).
- The HTTPS shim needs `openssl` on PATH (present on the host; the SBX image should keep it).
  Proxy mode relies on `NODE_USE_ENV_PROXY` (Node ≥ 22.21 / 24); servers in other languages
  honour `HTTPS_PROXY` themselves.
- `@fiks/replay-proc` depends on `@fiks/contracts` and `@modelcontextprotocol/sdk` 1.32.0 (dev:
  `zod` 4.6.5 for the test fixture server), all already in the lockfile. The lockfile importer
  entry for the new package is not committed (INTEG/orchestrator regenerate it at merge).

## Acceptance (round 1, 2026-10-21)

| Item | Result | Evidence |
|---|---|---|
| SETUP | pass | `node scripts/apply-dep-fragments.mjs` → "nothing to apply"; `pnpm install --no-frozen-lockfile` done; `node scripts/ensure-shop-mcp.mjs` (clone at `.work/shop-mcp`, tags `seed-v1`, `base-shop`) |
| `pnpm vitest run packages/replay-proc` | pass | 4 files, 23 tests passed (21.7 s) |
| D2 process vs in-process parity on the seed | pass | `test/d2-parity.test.ts`: trace `tr_079b90c89e` (from shop-mcp `7bf2e66`) on `seed-v1` via `tsx src/main.ts` + `VENDOR_BASE_URL`: violated `[shop.get_product/price.notNull]`, identical `verdictSummary` and violation objects to the seed's own `replayRecording` (run in its vitest), equal to the trace's `violated`; both verify on the fixed `7bf2e66` |
| 10 reruns identical; nonce matches after normalisation | pass | D2 10 reruns → 1 distinct (summary, violations, result); quotes fixture server 10 reruns → 1 distinct; `quotes.test.ts` strict → `POST /oauth/token …` unmatched, normalised → verified / `price.range` violated; `matchers.test.ts` replayServer nonce case |
| Unit: URL resolution, exit 2 | pass | `ensure-realbugs.test.ts`; CLI: `resolveRemote` → `https://github.com/vats98754/rb-r10-servers.git`; no-repo exit 2; `someone/…` exit 2 |
| `ensure-realbugs.mjs --id T1` with local bare repo | pass | run 1: cloned, fetched fix (only under `refs/pull/1/head`), tags at pinned SHAs, origin = `file://…/rb.git`; run 2: exit 0, 0 clone/fetch/upload-pack lines in GIT_TRACE (6 trace lines total); `git check-ignore .work/realbugs/T1` exit 0; `git status --porcelain` unchanged |
| `pnpm typecheck && pnpm lint` | pass | typecheck exit 0; lint "Checked 151 files … No fixes applied", exit 0 |

Also: full `with-lock suite pnpm test`: 32 files, 181 tests passed (327 s).
