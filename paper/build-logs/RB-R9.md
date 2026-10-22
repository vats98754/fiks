# RB-R9 build log

Branch `ws/RB-R9`, based on main `bd19858` (wave 1 complete). Real bug R9:
cloudflare/mcp-server-cloudflare #468, "List tools (zones_list, domain_list, worker_list) return
literal "[object Object]" instead of JSON" (open); proposed fix PR #469 (one commit `7e57621`,
parent = prefix `db90847`), **closed without merging**.

**Outcome: R9 is attrited** (`realbugs/R9/ATTRITION.md`). The blind contract gives 0/10
violations on the prefix. Three reasons:

1. **The contract misses the fault.** The 0.2.0 server sends its payload under a non-standard
   `toolResult` key and sends no `content` array, so a spec client sees an empty success. The
   contract was written blind to exempt results with no text block.
2. **The faulty code is not in the repository.** It exists only in the published npm artifact.
3. **No sandboxed repair can reach it.** The artifact is not in the prefix lockfile, so an
   offline repair cannot add it.

The held-out manifestations do separate the prefix (incorrect) from PR #469's head (correct).

## External actions (PLAN 8.0-3, approved)

- 2026-10-22T12:21:55Z `gh repo create vats98754/rb-r9-mcp-server-cloudflare --private
  --disable-wiki --disable-issues` (no `--source`, not a fork). `gh repo view … --json
  isFork,visibility,parent` → `isFork: false`, `PRIVATE`, `parent: null`.
- 12:22:05Z: pushed two refs from a plain `git clone` of upstream:
  - `db90847…:refs/heads/r9-prefix` (the prefix; it became the default branch);
  - `7e57621…:refs/tags/r9-fix` (the PR head).

  I pushed to `r9-prefix`, not `main`, so that upstream's workflows that run on a push to `main`
  (deploy-staging, release, semgrep) never trigger. `gh run list` and `gh pr list --state all`
  on the repo are both empty. Upstream has no `dependabot.yml`.
- Downloads (all for building the target): the npm registry packages in PR #469's lockfile,
  installed with a filtered `pnpm install`, and the published `@cloudflare/mcp-server-cloudflare@0.2.0`
  plus its dependencies, installed with `npm ci` from the committed lock. Both installs use
  `--ignore-scripts`.
- Nothing else was written to upstream or to any repository outside vats98754 (audit in the
  acceptance table).

## What landed (`realbugs/R9/**`, metadata only; the clone lives at `.work/realbugs/R9`)

- `pins.json`: `repo` `vats98754/rb-r9-mcp-server-cloudflare`, prefixSha `db90847…`, fixSha
  `7e57621…` (unmerged PR head; reference only), `round: 7`, and the npm artifact with its
  integrity.
- `contract.json` and `contract-log.md`:
  - The blind contract was written at 12:15:07Z from the issue text, PR metadata, the tree
    listing and the registered tool names.
  - It was committed as `52ef0ba` at 12:15:34Z. The first read of the PR diff was at 12:15:37Z.
  - It has the bug-specific properties `textJson` (the named property) and `carriesUpstream`,
    plus the standard `outputSchema` property.
  - `contract-log.md` also records the post-hoc false negative and the gap in the fiks
    vocabulary (C11).
- `fixtures/`:
  - `trigger.json` is **synthesized**: a zones_list call with a Cloudflare v4 envelope as the
    upstream response. No Cloudflare account or token is used.
  - `prefix-wire.json` is **recorded** by `harness/record.ts`: the raw JSON-RPC response of the
    prefix artifact's process.
- `harness/`:
  - `server.ts` decides what to run for each tree. If the tree has a publishable stdio package,
    it runs that package (pnpm, filtered install). Otherwise it runs the npx-resolved 0.2.0
    artifact (`npm ci` from `harness/npx-0.2.0/package-lock.json`). The upstream is replayed
    through the RBX HTTPS shim in proxy mode for `api.cloudflare.com`; the query string is
    ignored when matching.
  - `check.ts` holds the contract evaluator and the held-out oracle. `run.ts` is the F/P CLI and
    `record.ts` records the wire response. `adapter.ts` imports `RealbugAdapter` with its type.
  - Tests: unit tests plus an integration test on the clone, and `tsconfig.json` /
    `vitest.config.ts` (`pnpm vitest run --config realbugs/R9/harness/vitest.config.ts`).
- `heldout/`:
  - `cases.json` has 4 manifestations (H1 zones_list on another account, H2 domain_list, H3
    queue_list, H4 domain_list returning 403 upstream) and 1 control (C1 worker_list). All are
    synthesized.
  - `run.ts` grades a head by the direction-neutral oracle. Exit 0 means correct.
- `issue.md`: the upstream title and body. `adapter.json`: the RealbugAdapter fields, plus
  `status: attrited` and notes.
- No deps-fragments: the harness imports workspace sources by relative path. No file outside
  `realbugs/R9/**` and this log changed.

## Acceptance (round 1, 2026-10-22)

| Item | Result | Evidence |
|---|---|---|
| SETUP | pass | `node scripts/apply-dep-fragments.mjs` → "nothing to apply"; `pnpm install --no-frozen-lockfile` exit 0 (pnpm-lock.yaml change not committed) |
| `run.ts --sha prefix --runs 10`: 10/10 failures | **fail** (attrition) | "0/10 failures for cloudflare.zones_list/textJson, 10/10 pass, 1 distinct verdict(s); expect fail -> NOT MET", exit 1. Every run: "agent received: content 0 block(s), isError false, structuredContent no, non-standard keys [toolResult]". For reference, `--sha fix --runs 10 --expect pass` → 10/10 verified, exit 0 |
| Held-out manifestations exist and fail on the prefix | pass | `heldout/run.ts --sha prefix` → incorrect, exit 1: H1–H4 FAIL ("no JSON payload reaches the agent", and for H4 "upstream failed but the result is not an error"); C1 ok. `--sha fix` → correct 5/5, exit 0 |
| contract-log timestamps precede the first PR #469 diff read | pass | contract written 12:15:07Z (sha256 `9554489…`), committed `52ef0ba` at 08:15:34-04:00 (= 12:15:34Z); first diff read 12:15:37Z (session `date -u`) |
| clone remote / not a fork / no outside writes | pass | `git -C .work/realbugs/R9 remote -v` → only `origin https://github.com/vats98754/rb-r9-mcp-server-cloudflare.git` (fetch, push); `gh repo view … --json isFork` → `false`; `gh repo list vats98754` with pushedAt ≥ 12:00Z → rb-r9 (ours, 12:22:10Z), plus rb-r10 and rb-r20 (other streams); `gh api users/vats98754/events` newest = 2026-10-20 (no public write); only read calls were made to upstream (`gh issue view`, `gh pr view --json` metadata, `gh api` commits, `gh search issues`, `git clone`/`fetch`) |
| adapter.json typed + issue.md non-empty | pass | `pnpm tsc -p realbugs/R9/harness/tsconfig.json` exit 0; negative check (remove `testRunner`) → TS2741; `issue.md` 2261 bytes |
| If unreproducible: ATTRITION.md | pass | `realbugs/R9/ATTRITION.md` gives the three reasons, plus the duplicates check (#269, #12), the contamination stratum (pre-cutoff fault) and a note for RBA |
| no clone in tree / no gitlink / fresh worktree | pass (runs; F not reproduced) | `test ! -e realbugs/R9/repo` ok; `git ls-files -s realbugs/R9 \| awk '$1==160000'` prints nothing. Fresh `git worktree add --detach <scratch> HEAD` (no `.work/`) → SETUP → `node scripts/ensure-realbugs.mjs --id R9` (cloned from vats98754, tagged prefix and fix, exit 0, `.work` ignored) → `run.ts --sha prefix --runs 1` → "0/1 failures … expect fail -> NOT MET". This is the same result as in the stream worktree, and `heldout/run.ts --sha prefix` → incorrect (H1–H4 FAIL) |
| harness tests | pass | `pnpm vitest run --config realbugs/R9/harness/vitest.config.ts` → 2 files, 21 tests passed |
| `pnpm typecheck && pnpm lint` | pass | typecheck exit 0; lint "Checked 489 files … No fixes applied", exit 0 |
| suite offline (adapter suiteScope) | pass (scoped) | SBX image `fiks-sbx/r9:b975cb13bb547c79` (digest `sha256:6d64f9f4…`, built from the prefix lockfile by `packages/sandbox/src/build.ts` under the docker lock), `--network none -e CI=1 -e HOME=/tmp`, sources copied over `/work`: `packages/tools` 1 file / 6 tests passed, `packages/mcp-common` 13 files / 156 tests passed. The whole-repo `vitest run` (root projects including `apps/*`) timed out at 900 s offline (exit 124), so `apps/*` is outside suiteScope |

Not run: the full `pnpm test` suite. Nothing under `packages/` or `apps/` changed, and the root
vitest projects do not include `realbugs/`.
