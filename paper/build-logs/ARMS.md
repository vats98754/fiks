# ARMS build log

Branch `ws/ARMS`, worktree `/Users/anvayvats/fiks-wt/ARMS`, based on main `bd19858` (wave 1 complete).
Wave 2, round 1. External actions: none beyond reading the public LangSmith changelog page (one
`curl` and two WebFetch reads, recorded below) and Docker image builds (npm registry pulls inside
the test-only fiks-tools build). Nothing was pushed, no repo was created, no PR was opened, no
`gh` call was made.

## What landed

- **`packages/arms` (`@fiks/arms`)** and **`packages/cli/src/commands/arm.ts`** (`pnpm fiks arm`,
  default-export command module; it imports `@fiks/arms` lazily so every other CLI command stays
  light). `deps-fragments/ARMS.json` adds `@fiks/arms` to `packages/cli` (package.json and lockfile
  edits are applied locally by SETUP and not committed).
- **Arms** (`src/arms.ts`, `src/attempt.ts`): L1, L1-noIV, L1p, COMP, COMP-norep, COMP-plain,
  ISSUE-TEXT, REPRO-AGENT as `Arm` specs (preGates, ciPolicy, prPolicy, ivPlacement, evidence).
  - L1 family: up to 4 sessions; per candidate: commit (fixed identity and date, so the same diff on
    the same parent has the same sha in every arm), suite gate (typecheck, lint, `pnpm test` = repo
    tests + contract suite + stored traces) through SBX `runPreGate`, IV through SBX `runPreGate`
    (L1, L1p), then local CI (SBX `ciLocal`); `would_open_pr` only when all are green; failures
    (incl. `IV FAIL <property id>: <message>`) are fed to the next session. A session that adds no
    change is not re-checked.
  - COMP family: `would_open_pr` on the first non-empty diff; CI = SBX `ciLocal` (+ fiks-iv as an
    extra check for COMP; COMP-plain runs the repo's ci.yml with its `pnpm test` step limited to
    `vitest run --exclude "test/fiks/**"`); red log fed back; at most 3 revisions, 4 sessions and
    90 minutes. ISSUE-TEXT = COMP-norep with the issue title and body as the only evidence.
  - REPRO-AGENT: 1 session, 30 turns; F check = 3 runs of the agent's test on base in the
    container (loads, >= 1 `AssertionError` in every run); fixed feedback through SAFE
    resume-with-message; at most 3 F rounds; one `ReproTestRecord` per round (first `isFirst`,
    last `isFinal`), with `recordingsRead` from the fs-read-log preload and `inlineRecording`.
  - Budget (`src/budget.ts`): 30 turns and $5 per session, 4 sessions, 90 minutes, 3 COMP
    revisions; every arm builds its `RunnerJob` through `armJob`, so the budget fields are identical.
  - Guard: SAFE's canUseTool with `allowedEditPaths = Domain.allowedEditPaths` (REPRO-AGENT: none)
    and `allowedNewFilePaths = ^test/(?!fiks/|fixtures/|repro/|traces/)…\.test\.ts$`; test files
    the agent created in an earlier session or F round are added as exact paths (SAFE's create-only
    rule is per runner call, so a later or resumed session could not otherwise revise its own test).
  - `--agent-stub` (SAFE stubRunner): repair arms play the script's session n in session n;
    REPRO-AGENT resumes one stub session. `--trace-format raw|strict` goes to every RunnerJob.
- **Containment** (`src/sandbox.ts`, `src/checks.ts`): one `DockerExecBackend` per attempt (repo
  sandbox image, worktree at `/work`, fiks-tools mounted read-only). The attempt checkout is a
  standalone clone (its `.git` is inside the mount, so `git` works in the container; no remote, no
  hardlinks into the source clone). Every rerecord-head call goes through SBX `execFiks` with
  `--require-sandbox`; IV runs as `rerecord-head --check IV --recordings .alerts/<id>.json --
  fiks-iv …`, so it evaluates the overlay re-recording when the head changes its requests. Suite
  and CI run with the overlay in place (`rerecord-head` without a command, then `--restore`).
  After each check the stale `*.rerecorded.json` it wrote are removed, so every rerecord-head call
  starts from the same candidate tree and its RerecordLog line is the same in every arm. The agent's
  Bash goes to the container with `SANDBOX_ENV`. Nothing that runs candidate code is spawned on the
  host.
- **fiks-iv** (`src/iv-cli.ts`, `src/iv.ts`, bin `fiks-iv`): replays a trace on a head through the
  frozen contracts (packages/replay-proc `replayRecordingProcess`: the head's server over stdio,
  strict replay of the recorded exchanges, clock = capturedAt + 10 years as in test/fiks/run.ts,
  contracts evaluated at capturedAt by fiks's evaluator). `--properties <trace>.iv.json` restricts
  evaluation to ivProperties and prints ivExcluded; `--run-key` without it exits 2 ("IV sidecar
  required"). IV also fails on an unmatched upstream request, on an error returned where the frozen
  call returned data, and when a target property in scope is not evaluated (both as in FIKS's P);
  documented in FIDELITY.md as our parameter.
- **Alert renderer** (`src/alert.ts`): webhook JSON (tool, args, violated ids and messages, target,
  receipt text from @fiks/proxy, `trace: {path: .alerts/<id>.json, sha256}`, the replay-helper
  sentence) -> prose, one renderer for all arms. `.alerts/<id>.json` is the frozen trace's bytes.
  L1p's JSON lacks only `trace` and `replayHelper`.
- **Fixtures** (`test/fixtures/`, `test/support/fixtures.ts`, `SIDECARS.md`): D3, D4, D4-plantedfp
  and TRK-DEV-1 traces (CORE harness + injector rule + trace store, frozen clock; regenerated
  byte-identically by the tests) and hand-written sidecars for those and D2, each equal to the one
  derived from its v1 control run (verdicts recorded in SIDECARS.md).
- **FIDELITY.md** + `src/check-fidelity.ts`; **bibliography.json** `langsmith-changelog-2026`
  corrected; `paper/research/verify/arms-langsmith-recheck.json`.

## Deviations and findings (recorded, not hidden)

1. **langsmith-changelog-2026 location.** The WORKSTREAMS text says "Sep 7-14 2026 and Oct 5-12
   2026". The recorded re-fetch of the whole page (2026-10-22, HTML sha256
   `ae06ea5f…f826f17`, headings in document order) puts "Engine now reads the contents of
   successful tool results …" under **September 14-21, 2026**; the observability-1 verifier's
   "Sep 7-14" correction came from reading only the first 100k of 231k characters. Both COMP strings
   ("up to three revisions or 90 minutes per chain", "replays each source run against its fix
   preview deployment") are verbatim under **October 5-12, 2026**. The entry now says Sep 14-21 and
   Oct 5-12; `verification` = [VERIFIED]; the acceptance `node -e` check exits 0.
2. **Planted-FP extension has two products, not one.** With catalog `all` the extended entities
   follow the 15 originals and the D4 page holds 5 items, so a single extended product can be on the
   first page only when nothing is paginated. The fixture uses the 4 original laptops plus a $9 and
   a $999 extended laptop (`search_products {query: laptop}`): page 1 ends with the $9 laptop.
3. **Exchange timestamps.** The tap stamps `startedAt`/`durationMs` with the wall clock; the
   fixture generator sets them to the frozen clock and 0 (replay ignores both). Without this no
   trace regenerates byte-identically. ORCH's TRK-DEV-1 copy must do the same for INTEG's
   byte-equality check.
4. **Injector factory.** Re-recording through an injector rule needs the factory ORCH's
   `bootstrap/30-injector.ts` registers. Until ORCH merges, ARMS's container tests build the
   test-only tools image from a throwaway clone of HEAD plus one test-only bootstrap
   (`35-arms-test-injector.ts` -> `test/support/injector.ts`, packages/injector `startInjector`);
   it is never committed to fiks. With 30-injector.ts in HEAD the image is exactly `build-tools.ts
   --ref HEAD --apply-fragments`.

## Blocked on other streams (exact cause)

- **D3 as an INJ rule (CORE).** `rerecord-head` step 1 re-records the stale v1 fixture
  `test/fixtures/v1/order-create.json` (the D3 fix adds an Idempotency-Key) with the drift's profile,
  i.e. vendor v1 *plus the D3 rule*; `rerecord()` then refuses the result ("re-recorded against a
  different call or upstream": the rule changes the version header). Every arm's gate on the D3
  oracle head therefore fails. A recording that was not captured under the profile should be
  re-recorded against its own upstream (as for ruleless profiles). The D3 half of the D3/D4 test
  detects this exact refusal and skips with the reason; D4 passes.
- **Planted-FP L1 exposure (CORE).** `rerecord()` starts the vendor with the original catalog
  (`startHarness` default; neither the trace nor the profile carries the catalog), so the overlay
  re-recording of the `all`-catalog trace drops the extension and the D4.patch head's page-2 request
  stays unmatched. fiks-iv's own behaviour on this trace (sidecar: exit 0 on the D4.patch head, 1 on
  countMatchesTotal on base; without it 1 on items.price.range) is verified host-side on a
  re-recording made with the trace's catalog.
- **TRK-DEV-1 arms (CORE).** `startHarness` reads `Domain.contractsPath` for every non-shop domain;
  the tracker contracts are authored at A0, so `rerecord()` throws ENOENT on any tracker head, and
  the harness leaks its vendor/injector/tap servers on that error, so the CLI never exits.
  `runArm` refuses a non-shop domain whose contracts file does not exist (instead of hanging), the
  test asserts that refusal and skips the 7-arm run with the reason. fiks-iv on TRK-DEV-1 (base
  exit 1 on `tracker.list_comments/countMatchesTotal`, ref A exit 0) passes.

## Acceptance evidence

See the structured report (commands and key output).
