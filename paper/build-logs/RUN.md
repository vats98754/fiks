# RUN build log

Branch `ws/RUN`, worktree `/Users/anvayvats/fiks-wt/RUN`, based on main `bd19858` (wave 1 merged).
Wave 2; depends on CORE and LLMR (both merged). Owns `packages/exp/**` and this file. No
dependency fragment: nothing outside `packages/exp` imports `@fiks/exp` (INTEG adds the root `exp`
script). `pnpm-lock.yaml` changes from SETUP (`pnpm install --no-frozen-lockfile` picks up the new
package) are not committed.

## What landed (`packages/exp`, `@fiks/exp`)

Entry point `pnpm tsx packages/exp/src/main.ts` (until INTEG adds `pnpm exp`):

- `<run-id> [--dry] [--dev] [--drifts a,b] [--models m,n] [--attempts n] [--workers n] [--seed s]
  [--out-root dir] [--manifest f] [--split f] [--k1 f] [--from run] [--tools-image img]
  [--cap-headroom-units n] [--rss-cap-mb n] [--attempt-timeout-min n] [--wait-on-cap]
  [--print-plan] [--approved]`
- `fit --measured <throughput.json> [--window-days 8] [--params p.json] [--peak-rss-mb n]
  [--cap-pause-fraction f] [--sustained-units-per-hour x] [--r0-hours h] [--r5-hours h] [--out f]`
- `status <run-id>`, `list`, `schema` (the status JSON schema).
- Exit codes: 0 complete, 1 error, 2 refused (guard/usage), 3 paused (cap stop, infra window,
  signal; re-run the same command to resume).

Files:

- `src/runs.ts`: run definitions T0, A0, A1, R0, R1, R2, P-pool, R3, R4, R5, R6, R7, R8, R9, R10,
  R11 as config. Block runs (R1, R3, R4, R6, R7, R8) have phases {arms, models, attempts,
  traceFormats, inputs}; command runs have argv templates. R1: FIKS, L1, COMP, REPRO-AGENT x 3
  models x 2 attempts on the dev split; under `--dry` every block also gets L1-noIV, L1p,
  COMP-norep and COMP-plain so the dry run exercises every arm (INTEG's dry-run item). R3/R4 read
  the K1 step (`--k1`, default `<out-root>/K1/fit.json`; `--dry` without one uses S0). R4:
  confirmatory FIKS/L1/COMP blocks first, then the K1-surviving rungs (Opus x 3). R6: FIKS
  (FIKS-current), FIKS+CU, COMP (Opus x 3). R7: hardened FIKS x {raw, strict} on the carriers
  manifest (skipped under `--dev`) and the dev utility phase FIKS, L1 x 2 x {raw, strict}; the
  format goes into the run key's experiment (`R7-raw`, `R7-strict`). R8: FIKS, COMP, ISSUE-TEXT
  (Opus x 5), gated on RBA. R10: gated on `paper/results/confirmatory.lock` and
  `--cap-headroom-units >= 1000` (about 2,000 Sonnet calls). R11: gated on the lock and
  `--approved`; never executed under `--dry` (only `--print-plan`).
- `src/argv.ts`: `pnpm fiks repair --arm fiks|fiks+cu` and `pnpm fiks arm --name <ARM>` with
  `--domain --trace --base --run-key --ci local --no-pr [--trace-format] [--agent-stub]`
  (ISSUE-TEXT adds `--issue`, FIKS+CU `--clean-corpus`); `assertArmArgv` throws unless `--trace`,
  `--base` and `--run-key` are present, `--ci local --no-pr` is set and no `--fetch` appears.
  `prepareArgvs` (DET `enumerate --drift`, `record --drift`, `freeze-trace`), `gradeArgv` (HOLD
  `grade --pkg --patch --tools-image`), `showcaseArgv` (R11: `repair --trace <frozen> --base
  showcase/<driftId> --domain <d> --ci github`, refusing `--arm`, `--run-key`, `--no-pr`, `--fetch`).
- `src/steps.ts`: the ConfigStep ladder S+, S0, 1..11 (PLAN 13), `projectRuns` (A1 leftovers,
  R2, A2 worst case, P-pool, R9 Claude share, R3, R4 incl. the four rungs, R6, R7 = 240 hardened
  + 40 adaptive + 232 utility, R8; never R10 or R11), `assertStrictlyDecreasing`, `fit` (S+ only
  when everything incl. the 30% reserve fits at a = 5, else the first fitting step of S0, 1..11,
  else step 11 with `fits: false`), the PLAN 8.2 R5 overlap rule (`r5NonOverlapHours`) and the
  separate `ollamaRule`. A step whose cut removes nothing (S4 with <= 40 drifts) is marked
  `applicable: false` and skipped by the walk instead of breaking the strict-decrease check.
- `src/measured.ts`: T0's `throughput.json` (LLMR `ThroughputSchema`) -> workers = largest of
  {1, 2, 4, 6} with < 2% 429/overload, no cap and workers x RSS <= 10 GB; sustained units/h =
  attempts/h x unit of the probed model x (1 - cap pause fraction).
- `src/schedule.ts`: blocks = (phase, drift, model, attempt), all arms of the phase inside, arm
  order = seeded shuffle keyed by (seed, block id); confirmatory phase first; breadth-first over the
  attempt index. Duplicate block ids or run keys throw.
- `src/registry.ts`: append-only `registry.jsonl`, one writer. A block enters only as ONE
  `block_complete` line holding all its attempt rows (status only: run key, arm, model, order,
  tries, exit code, class, result-file sha, dir, wall ms), so no run key can appear twice and a
  kill leaves either the whole block or nothing. Single `write(2)` on O_APPEND + fsync per line; a
  torn last line is skipped and a newline is written before the next append.
- `src/pool.ts` + `src/worker.ts` + `src/child.ts`: N worker OS processes (fork), each with its
  own FIKS_DIR (`<run>/workers/w<i>`); every arm try is its own process group with its own
  FIKS_DIR (`<attempt dir>/s<session>-try<n>/fiks`) and log (`output.txt`; never stdout). In-flight
  markers (`<run>/inflight/`) and pid files (`<run>/pids/`) make resume safe after `kill -9`: the
  next start kills orphaned arm process groups of the dead session, quarantines the in-flight
  blocks' attempt dirs (`quarantine/s<n>/...`, `block_discarded`) and re-runs them whole. Cap stop:
  all workers abort, in-flight blocks are discarded and re-queued, `cap_stop` is logged, and the
  run exits 3 (or, with `--wait-on-cap` and a known reset, sleeps until reset + 60 s and resumes).
  Infra (PLAN 9.3): <= 2 re-queues per attempt, then the (drift, model, attempt) cell is dropped
  for all arms (`block_dropped`, counted). Infra window: > 10% infra over the last 50 tries pauses
  the run (exit 3). RSS: every 2 s the RSS of each worker tree is sampled to `rss.jsonl`; above
  `--rss-cap-mb` (default 10 GB) no new block is dispatched. A checkpoint event every 10% of blocks.
- `src/classify.ts`: status-only attempt classes. The contract with the arm commands: exit 75 =
  infra, 76 = cap, or a `result.json` `status` / `attempt.json` `stop` starting `infra_error` /
  `cap`; exit 0/1 = the arm's own outcome; any other exit without a result, a signal, a spawn
  failure or the hard timeout (default 100 min) = infra; cap text is recognised with LLMR's
  `classifyLlmFailure`. ORCH currently exits 1 for every non-PR status and ARMS 0; both write the
  status files this reads (`status: 'infra_error'`, `stop: 'infra_error: ...'`). **INTEG item:**
  confirm that a cap inside an arm surfaces as exit 76 or a `cap` status.
- `src/status.ts`: `StatusSchema` (strict zod object; JSON schema via `main.ts schema`). Fields:
  run, state, pause reason, phase, block/attempt/step counts, infra re-queues, workers, RSS,
  elapsed. No correctness, verdict, CI, gate, PR or grade field; every printed line is validated.
- `src/guard.ts`: build-swarm guard (`$HOME/.fiks/build-swarm.active` refuses every run except
  `--dry`), `run.active` held by every non-dry run (a marker of a dead pid on this host is replaced;
  `--dry` does not take it because it uses no token and must not block live-lock items), the
  dirty-tree refusal (`git status --porcelain` excluding `paper/results/raw`, which run steps
  write), the confirmatory.lock gate, and the containment preflight
  (`pnpm vitest run packages/cli/test/orch/rerecord-containment.test.ts` before R1 and R3-R8 incl.
  `--dry`; result incl. commit and `docker image ls --filter label=fiks.sandbox.kind` ids goes to
  `meta.json` and `preflight.jsonl`; failure refuses before any plan or block).
- `src/commands.ts`: run-time steps for R2 (from the R0 split: per test drift and benign case
  enumerate/record/freeze-trace, MON `replay-cli --per-element` per domain, `detect-eval`), R5
  (`fiks grade` per completed attempt of `--from <run>`; the final head = the last captured
  candidate in `attempt.json` `candidateIds`, otherwise listed as not graded), R9 (traffic; the
  ollama agent only if the K1 fit's `ollamaRule` kept it) and R11 (seeded draw of one eligible
  drift per domain; `git push origin <base>^{commit}:refs/heads/showcase/<id>` on the domain's
  `.work` clone, then the product-mode repair).
- `src/inputs.ts`: the dev split = D1-D5 (record via INJ `packages/injector/fixtures/driftpkgs`,
  grade via HOLD `packages/heldout/fixtures/dev/<id>/manifest.json`), DEV-X1, TRK-DEV-1 (DOM2's
  package for both), plus `dev` entries of the R0 split file when it exists. Manifest inputs
  (F9 eligible list, benign list, R7 carriers, R8 inputs): `{id, domain, base, trace, pkg?, ...}`.
- `meta.json`: run, seed, dry, frozen commit, plan sha, repo, out root, argv, test seams used,
  workers, RSS cap, node, K1 source, preflight, session; a resume appends to `resumes[]` and is
  refused if the commit, seed, plan or dry flag changed. `plan.json`: inputs, prepare steps,
  command steps, blocks with every argv.
- Test seams (honoured only with `--dry`; a live run refuses them): `FIKS_EXP_FIKS_BIN`,
  `FIKS_EXP_TSX_BIN`, `FIKS_EXP_PREFLIGHT_CMD`, `FIKS_EXP_REPO` (the tree the guards check).
- `--dry`: every arm argv carries `--agent-stub` (fix stub per drift, `repro-agent.json` for
  REPRO-AGENT) and every child env has `FIKS_LLM_FORBID=1` with `CLAUDE_CODE_OAUTH_TOKEN` and
  `ANTHROPIC_API_KEY` removed; default out root `.fiks/exp-dry` (gitignored). Live default out root
  `paper/results/raw/<run>`; tests always pass `$TMPDIR` dirs.
- `fixtures/dry/` (generated by `scripts/gen-dry-stubs.ts`, `--check` regenerates in memory):
  D1, D3, D4, D5 = `packages/cli/test/oracles/D<n>.patch` as edit steps on seed-v1 (never the
  shop-mcp fix commits); D2 = a P1 clamp (`Math.min(Math.max(p.price ?? 20, 20), 2000)`, the
  get_product `price.range`); DEV-X1 and `noop` = no edit; TRK-DEV-1 = DOM2's ref A;
  `repro-agent.json` = one new `test/repro-agent.test.ts` that loads `.alerts/<id>.json` through
  `test/fiks/run.ts` `replayRecording` and asserts no violation (fails on base, F-valid).

## Decisions and deviations to review

1. **Status `state: 'error'`** (not `failed`), so no status value reads as a verdict.
2. **R11 safety beyond the spec:** R11 also needs `--approved` and never executes under `--dry`
   (its first step is a real `git push` of the showcase branch). `--print-plan` shows both argv.
3. **R11 argv adds `--domain <d>`** (needed for the tracker PR). Product mode in ORCH is currently
   the legacy shop-only path, which does not accept `--ci github` or `--domain tracker`: INTEG must
   check R11's argv against the merged `fiks repair` before R11 can run.
4. **S4 subset applies to R4 confirmatory drifts only**, as in the PLAN 13 table
   ("13.5 x 61 -> 13.5 x 40 units"); R3 keeps all detected drifts. At R4 time the subset is drawn
   from the real F9 list with the K1 seed (`stratifiedSubset`, stratum = manifest `stratum`).
5. **Projection defaults are PLAN [estimate] values** (`DEFAULT_PARAMS`, e.g. judge/pool calls
   converted at the PLAN 8.1 API-price midpoints, A2 = 40 x 3.5 units, R5 = 75 h, R0 = 6 h);
   `fit --params` replaces them with measured values at K1.
6. **K2 "commit logs every 10% of blocks"**: the runner writes a `checkpoint` event every 10%; it
   does not run `git commit` itself (the run-step operator commits `paper/results/raw/<run>`).
   Subprocess logs are `.txt` because the root `.gitignore` drops `*.log`.
7. **The dev split includes DEV-X1 and TRK-DEV-1** (WORKSTREAMS RUN `--dev`). A live R1 with the
   PLAN's 29 instances (24 blind + D1-D5) passes `--drifts`.
8. **R7 adaptive attacker** has no CLI in SEC (only `adaptive.ts` with injected runners); it is
   counted in the projection but is not a runnable R7 phase yet (INTEG/SEC).
9. **A0/A1/R0/R2/P-pool/R9/R10 argv templates** follow the WORKSTREAMS deliverables of BLIND,
   DET, HOLD, TRAFFIC, SBX and MON; several of those commands are not merged yet, so INTEG must
   check each template against the merged CLIs.
10. `@fiks/repair` is a devDependency of `@fiks/exp`, used only by `test/stubs.test.ts` to parse
    the stub fixtures with SAFE's own `parseStubScript`.

## Acceptance evidence (2026-10-22, on 557e8c0 + this log)

| Item | Status | Evidence |
|---|---|---|
| SETUP | pass | `node scripts/apply-dep-fragments.mjs` -> "nothing to apply"; `pnpm install --no-frozen-lockfile` ok; `node scripts/ensure-shop-mcp.mjs`, `node scripts/ensure-tracker-mcp.mjs` ok (seed-v1 = bb037cf, dev-tracker-stub = 1b8547a) |
| R11 refused without lock; argv lack --no-pr/--arm/--run-key, carry --ci github and --base showcase/<id>; not projected | pass | `test/argv.test.ts` "R11 ..." (3 tests) |
| `pnpm vitest run packages/exp` | pass | 5 files, 48 tests passed (125.7 s) |
| K1 ladder: strictly decreasing S0..11; no R10/B-OM/ollama step; S+ only when everything incl. reserve fits at a = 5; projection contents; R0 + non-overlappable R5 in the wall-clock | pass | `test/steps.test.ts` (12 tests) |
| Ollama rule cuts the R9 ollama share when > 10 h; Claude fit unchanged | pass | `test/steps.test.ts` "ollama wall-clock rule" |
| kill -9 mid-run, resume -> registry complete, no duplicate run keys | pass | `test/runner.test.ts` "kill -9 mid-run ..." (2 workers, 8 blocks x 8 arms; >= 2 complete before SIGKILL of the process group; resume discards in-flight blocks, all 64 run keys exactly once) |
| Simulated cap stop leaves only complete blocks; incomplete re-run whole | pass | `test/runner.test.ts` "a simulated cap stop ..." (exit 3; only D1/1 complete; D2/1 discarded + quarantined; resume re-runs all 8 arms of D2/1) |
| Status output validates against a schema with no correctness/verdict fields | pass | `test/runner.test.ts` "status-only output" |
| 2-worker vs 1-worker identical outcome rows; arm order reproducible from the seed | pass | `test/runner.test.ts` "workers and seeds" |
| Every arm argv has --trace and --base, never --fetch | pass | `test/argv.test.ts` (unit over all 10 arms + `--print-plan` of R1, R3, R4, R6, R7: > 100 argv) |
| Refuses a dirty tree | pass | `test/runner.test.ts`; also live: `R1 --dry ...` in this worktree -> "refused: the tree ... is dirty (1 path(s), e.g. M pnpm-lock.yaml)", exit 2 |
| build-swarm.active (temp HOME): T0 exits non-zero with a clear message | pass | `test/runner.test.ts`; also with the real `$HOME/.fiks/build-swarm.active`: `pnpm tsx packages/exp/src/main.ts T0` -> "refused: /Users/anvayvats/.fiks/build-swarm.active exists ...", exit 2; same for `R1` |
| R1 --dry --dev --drifts D1,D2 --models claude-haiku-5-5 --attempts 1: --agent-stub on every arm, FIKS_LLM_FORBID=1 in every child env, mocked LLMR call counter 0, blocks = 2 x 1 x 1 | pass | `test/runner.test.ts` "--dry" (stub bin = `stub-llm.ts`, which asks LLMR `assertLlmAllowed` and calls `complete()`; both throw `LlmForbiddenError`; counter file empty; 16 arm calls, 8 distinct arms) |
| build-swarm.active: R1 --dry starts; R1 without --dry exits non-zero | pass | `test/runner.test.ts` (the --dry test creates the marker first) |
| Preflight mocked to fail: R7 --dry and R4 --dry exit non-zero before any block; passing -> meta.json records it; T0, A0, R2 do not run it | pass | `test/runner.test.ts` "containment preflight" (4 tests) |
| `pnpm typecheck && pnpm lint` | pass | both exit 0 ("Checked 509 files ... No fixes applied.") |

Live-tree `--dry` R1 (real `pnpm fiks`, real preflight) on a clean tree: refused at the preflight
("containment preflight failed (exit 1)"; vitest: "No test files found" for
`packages/cli/test/orch/rerecord-containment.test.ts`), because ORCH, ARMS, DET and HOLD are not
merged on this base. The gate behaves as specified; the end-to-end dry run with the real arms is
INTEG's item.
