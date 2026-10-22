# RB-R10 build log

Branch `ws/RB-R10`, based on main `bd19858` (wave 1 complete). Real bug R10:
modelcontextprotocol/servers #4887, "memory: create_entities silently drops observations for
existing entities"; human fix PR #5008.

## External actions (PLAN 8.0-3, approved)

- 2026-10-22T11:52:35Z `gh repo create vats98754/rb-r10-servers --private` (no `--source`, not a
  fork; wiki and issues disabled). `gh repo view ... --json isFork,visibility,parent` →
  `isFork: false`, `PRIVATE`, `parent: null`.
- Pushed from a plain `git clone` of upstream: `272d7f6…:refs/heads/main` (prefix) and
  `1520a8b…:refs/tags/r10-fix` (human fix). Nothing else pushed; nothing written to upstream.
- Side effect to decide on (not acted on): the pushed tree carries upstream's
  `.github/dependabot.yml` and workflows, so GitHub's Dependabot opened PRs #1–#3 in the private
  repo (~12:00Z) and Actions ran 15 jobs on them (TypeScript/Python CI). These are GitHub's own
  writes inside vats98754, not ours; `main` and `r10-fix` are unchanged. Disabling Actions and
  Dependabot on the repo (or closing those PRs) is a settings change that needs the user's
  approval.

## What landed (`realbugs/R10/**`, metadata only; the clone lives at `.work/realbugs/R10`)

- `pins.json` {repo `vats98754/rb-r10-servers`, prefixSha `272d7f6…` (first parent of the merge),
  fixSha `1520a8b…` (merge of PR #5008), round 7}.
- `contract.json` + `contract-log.md`: blind contract written 11:48:26Z from the issue text, PR
  metadata, README and the prefix's `tools/list`; committed `ab4fa21` 11:48:48Z; first read of
  the fix diff 11:48:52Z. Property `memory.create_entities/readAfterWrite`, kind
  `readAfterWriteRequested` (args-driven read-after-write via `open_nodes`; fiks's
  result-driven `readAfterWrite` cannot see an entity the result omits: a C11 vocabulary gap,
  recorded). Post-hoc: one documented FP on the fix (H3 same-batch repeat) and one FN on the
  prefix (H1 mixed batch) on held-out inputs; exact on the trigger.
- `fixtures/`: `state-alice.jsonl` and `trigger.json` **recorded** from the prefix server process
  by `harness/record.ts` (issue steps 1–2, args verbatim); `clean-new-entities.json`
  **synthesized** control.
- `harness/`: `server.ts` (per-SHA detached worktree of the clone under
  `.work/realbugs/R10.builds/<sha>`, `npm ci --workspace src/memory`, `tsc`; `runCase` = fresh
  temp `MEMORY_FILE_PATH` + RBX clock preload + `spawnServer` over MCP stdio → `create_entities`
  → `open_nodes` probe), `check.ts` (blind-contract evaluator + held-out oracle), `run.ts` (F/P
  CLI), `record.ts`, `adapter.ts` (typed `RealbugAdapter` import), unit + integration tests
  (`pnpm vitest run --config realbugs/R10/harness/vitest.config.ts`), `tsconfig.json`.
- `heldout/`: `cases.json` (4 manifestations, 2 controls, synthesized) and `run.ts` (heldout
  command; `--sha` or `--worktree`; exit 0 = correct).
- `issue.md` (upstream title + body), `adapter.json` (RealbugAdapter + extra fields and notes),
  `ATTRITION.md` (reproduced; duplicates/already-fixed check; contamination stratum).
- No deps-fragments: the harness imports workspace sources by relative path and is not in a
  workspace package. No file outside `realbugs/R10/**` and this log changed.

## Acceptance (round 1, 2026-10-22, HEAD `34ca896` + this log)

| Item | Result | Evidence |
|---|---|---|
| SETUP | pass | `node scripts/apply-dep-fragments.mjs` → "nothing to apply"; `pnpm install --no-frozen-lockfile` exit 0 (pnpm-lock.yaml change not committed) |
| `run.ts --sha prefix --runs 10` | pass | "10/10 failures for memory.create_entities/readAfterWrite, 0/10 pass, 1 distinct verdict(s); expect fail -> OK", exit 0; message "create_entities dropped Alice silently: open_nodes Alice read back ["Works at Acme"], missing ["Allergic to penicillin"], and the response does not name Alice" |
| `run.ts --sha fix --runs 10` | pass | "0/10 failures …, 10/10 pass, 1 distinct verdict(s); expect pass -> OK", exit 0; no contract fire on the trigger |
| contract-log timestamps precede first fix-diff read | pass | contract written 11:48:26Z, committed `ab4fa21` at 2026-10-22T07:48:48-04:00 (= 11:48:48Z); first diff read 11:48:52Z (session `date -u`) |
| clone remote / not a fork / no outside writes | pass | `git -C .work/realbugs/R10 remote -v` → only `origin https://github.com/vats98754/rb-r10-servers.git` (fetch/push); `gh repo view vats98754/rb-r10-servers --json isFork` → `false`; `gh api users/vats98754/events`: newest event 2026-10-20T15:48Z (shop-mcp), none since, so no public write (upstream is public) in this session; the feed does not show private-repo events, so the private side was audited with `gh repo list vats98754 --json name,pushedAt`: pushed since 11:40Z = rb-r10-servers (ours; last push 12:00:14Z = Dependabot's branches) and rb-r19-mongodb-mcp-server (RB-R19's stream, not ours); only read calls to upstream (`gh issue view`, `gh pr view --json` metadata, `gh api commits`, `gh search issues`) |
| adapter.json typed + issue.md non-empty | pass | `pnpm tsc -p realbugs/R10/harness/tsconfig.json` exit 0 (`adapter.ts`: `const R10_ADAPTER: RealbugAdapter = {...adapter.json}`); negative check: removing `testRunner` → TS2741, exit 2; fixture labels checked by `fixtureLabel` (TS widens JSON literals) and the unit test; `issue.md` 2159 bytes |
| unreproducible → ATTRITION + reserve | n/a | reproduced; ATTRITION.md says so; reserve #3137 not attempted |
| no clone in tree / no gitlink / fresh worktree | pass | `test ! -e realbugs/R10/repo` ok; `git ls-files -s realbugs/R10 \| awk '$1==160000'` empty; fresh `git worktree add --detach <scratch> HEAD` (no `.work/`): SETUP, `node scripts/ensure-realbugs.mjs --id R10` → cloned from vats98754/rb-r10-servers, tagged prefix+fix, exit 0, `git check-ignore` ok; `run.ts --sha prefix --runs 1` → "1/1 failures … expect fail -> OK", exit 0 |
| harness tests | pass | `pnpm vitest run --config realbugs/R10/harness/vitest.config.ts` → 2 files, 17 tests passed (unit: evaluator, held-out oracle, adapter/pins/allowedEditPaths; integration on the clone: remotes+tags, F 3/3, P 3/3, clean control, held-out prefix incorrect [H1–H4] / fix correct) |
| held-out | pass | `heldout/run.ts --sha prefix` → incorrect (H1–H4 FAIL, C1–C2 ok), exit 1; `--sha fix` → correct, exit 0 |
| suite offline | pass (base image) | `npm ci` then `--network none -e CI=1 -e HOME=/tmp` in `node:22.23.3-bookworm-slim@sha256:3ed9…` (SBX BASE_IMAGE): prefix 9 files / 149 tests pass, fix 10 files / 153 tests pass. The SBX per-repo builder supports pnpm repos only, so the real SBX image for this npm repo is RBA/SBX work |
| human-fix tests fail on the prefix | pass | fix's `create-reporting.test.ts` + `tools.test.ts` on prefix source: 7 failed / 36 passed |
| `pnpm typecheck && pnpm lint` | pass | typecheck exit 0; lint "Checked 488 files … No fixes applied", exit 0 |

Not run: the full `pnpm test` suite (nothing under `packages/` or `apps/` changed, and the root
vitest projects do not include `realbugs/`).
