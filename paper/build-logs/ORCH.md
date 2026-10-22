# ORCH build log

Branch `ws/ORCH`, based on main `bd19858` (wave 1 complete, CU merged). Wave 2, round 1.
External actions: none beyond the approved ones. No push, no repo, no PR, no third-party write.
Network use: the read-only clones of `ensure-shop-mcp.mjs` / `ensure-tracker-mcp.mjs` in a fresh
test worktree, and npm/Docker Hub pulls by SBX's image builds. Two [LIVE] items ran through LLMR's
`live-lock.ts` with the OAuth token (`.env` symlinked into the worktree, gitignored, never printed).
The Docker VM ran out of disk during the first fiks-tools build; `docker builder prune -f`
(build cache only, under the `docker` lock) freed 14.6 GB. No image, volume or container of any
stream was removed.

## What landed

| Deliverable | Where |
|---|---|
| `fiks repair` default export (P18) parsing its own argv. No `--arm`/`--run-key`: the legacy adapter (ec241bc flags and output) runs unchanged. `--arm fiks\|fiks+cu` or `--run-key`: experiment mode, `runArm()` | `packages/cli/src/commands/repair.ts` (`command`, `armOptionsFromArgv`, `runArm`) |
| Worktree via CORE `createWorktree(repo, base)` (`<ref>^{commit}`, local branches and peeled tags, no fetch); `--fetch` refused with `--run-key`; `--base no-such-ref` exits 2 before anything is written; `--ci github` refused in experiment mode (no push, no gh) | `runArm` |
| FIKS arm: frozen trace -> repro (CORE `generateRepro`) -> F gate (CORE `failGate`, 3 runs, `--f-runs`) in the container -> repro committed -> agent sessions (<= 4, 30 turns and $5 each, 90 min wall) -> per session: `rerecord-head` before P, the contract suite, stored traces and ci-local; then P, suite, traces, typecheck, lint, ci-local in the container -> `would_open_pr` only after ci-local is green | `runArm`, `runGates` |
| Per-attempt container: SBX `DockerExecBackend` (registered by `bootstrap/20-sandbox.ts`) with the repo image, the fiks-tools mounts, and the repo's git common dir read-only at its host path; the worktree is mounted at its host path. The agent's allow-listed Bash goes through it (SAFE `RunnerJob.backend`) | `sandboxBackendFactory()`, `bootstrap/20-sandbox.ts` |
| F and P in the container with CORE's own gate code: a per-attempt Domain (`<domain>-sbx-<id>`) whose suite runs vitest in the container and reports exactly like CORE's `runSuite` | `registerSandboxDomain`, `containerSuiteRun`, `syncContainer` |
| `rerecord-head --require-sandbox` via SBX `execFiks` before every replay-based check (`--check P\|suite\|traces\|ci`), overlays restored after the check; one RerecordLog line per call in `<run>/rerecord.jsonl` (`AttemptRecord.rerecordLog`) | `rerecordBefore`, `restoreOverlay` |
| fiks's re-recordings are not trusted as read (candidate code runs while they are written): every exchange is replayed on the host against a fresh, trusted upstream chain (vendor + the profile's injector rule, the recording's clock, no tool code); status and body must match. The verified bytes are fiks's: checked before and after every gate, written back before ci-local, committed from memory | `verifyAgainstUpstream` |
| Containment between phases: every process in the container except init is killed before and after each check (no helper survives into the next gate); files that change while the checks run, symlinks in the candidate, commits by candidate code all fail the session | `REAP`, `guarded`, `isSymlink` |
| RunKey-keyed results under `<FIKS_DIR>/runs/<exp>/<arm>/<model>/<domain>/<drift>/<attempt>/`, never overwritten (an existing key exits 2 before any capture): `attempt.json` (AttemptRecord), `result.json`, `events.jsonl` (`would_open_pr` etc.), `rerecord.jsonl`, `candidates/<id>.{json,diff}` + `candidates.jsonl` (a CandidateRecord at every gate and CI invocation and at every agent check command), `repro/fiks.json` (ReproTestRecord, source `fiks`), `sessions/<n>.{prompt.md,log}`, `egress.jsonl`, `push-attempts.json`, `pr-draft.md`; the final head gets `refs/fiks/runs/<runKey>` in the tool repo | `runArm` |
| Gate-name mapping for legacy logs: `ci` -> `ci-local`; verdicts compared by name and pass/fail | `canonicalGateName`, `gateVerdicts` |
| `--trace-format raw\|strict` passed to SAFE (`RunnerJob.traceFormat`, `buildPrompt`) | `armOptionsFromArgv`, `runArm` |
| `--agent-stub <script.json>` (SAFE `stubRunner`) on every path; edit guard from `Domain.allowedEditPaths` | `runArm` |
| `--arm fiks+cu` (E4/P12): trigger = the frozen trace; storedViolations = the head's `test/traces/**` and `test/repro/*.json` plus `--stored-traces` dirs (the trigger itself excluded, see interpretation 2); cleanCorpus = `--clean-corpus <dir>`; mutationVariants = MUT M1-M14 on the trigger's first recorded response, each re-run through the server at the base (trusted checkout, replayed upstream, through the proxy so probes are recorded); `declaredOutputSchemas` from the server's tools/list. Accepted -> CU `renderProposal` files under `proposal/`, outcome `contract_update_proposed`, no would_open_pr. Rejected -> reasons fed back, the attempt continues as code repair | `mutationVariants`, `storedViolationTraces`, `contractUpdateIn`, `replayMiddleware` |
| `bootstrap/30-injector.ts`: INJ's `startInjector` as the injector factory every Domain's `injectorHook` uses; a plain rule object's transform is found by `transformPath`, `file`, or by hash under `FIKS_INJECTOR_RULE_DIRS` / `packages/injector/fixtures/rules`; the Domain's frozen clock | `packages/cli/src/bootstrap/30-injector.ts` |
| `fiks seed-tag --domain tracker [--repo] [--from] [--tag] [--contracts] [--dry-run]`: re-vendors `types.ts`/`evaluate.ts` (sync-contracts header, `disabled` support) and the frozen contracts (`--contracts`, else `Domain.contractsPath`, else the repo's own working-tree copy, e.g. after `contract-disable.mjs`) in a throwaway worktree, commits, annotated tag (never moved), no push | `packages/cli/src/commands/seed-tag.ts` |
| `deps-fragments/ORCH.json`: `@fiks/sandbox`, `@fiks/injector`, `@fiks/contract-update`, `@fiks/llm`, `@fiks/mutate` into `packages/cli` (`@fiks/mutate` is needed for the MUT variants) | `deps-fragments/ORCH.json` |
| Fixtures (generated by the tests' own generator, committed, regenerated byte-identically): `DEV-X1.trace.json` (INJ `driftpkgs/DEV-X1.json`, base-shop), `TRK-DEV-1.trace.json` (DOM2's driftpkg, base dev-tracker-stub, the dev stub contract), `BEN-DEV-1.json` + `.transform.ts` (benign rule: a $2,500 laptop) and `BEN-DEV-1.trace.json`, `clean-v1/` (shop v1 fixture calls at base-shop as CallRecords). `test/orch/biome.json` keeps Biome off the fixture JSON | `packages/cli/test/orch/fixtures/`, `support/{gen,fixtures,regen}.ts` |

## Interpretations and decisions (for the verifier)

1. **Container tests are opt-in (`FIKS_ORCH_E2E=1`)**, like SBX's `FIKS_SANDBOX_E2E`: each attempt
   starts a per-attempt container and runs the shop-mcp suite in it several times (3-9 min per
   attempt). Without the variable `pnpm vitest run packages/cli/test/repair.test.ts packages/cli/test/orch`
   runs the product repair tests, the units, the fixture regeneration and the seed-tag dry run, and
   skips the container files. The acceptance evidence below ran them with `FIKS_ORCH_E2E=1`. The
   tests use a test-only fiks-tools image of this branch (`--ref HEAD --apply-fragments`), because
   ORCH's own `bootstrap/30-injector.ts` must be inside the container; `FIKS_TOOLS_IMAGE` overrides.
2. **storedViolations does not contain the frozen trace.** WORKSTREAMS says "every stored trace under
   the head's test/traces/** plus the frozen trace"; PLAN 6.2 passes the frozen trace as the
   trigger. With the trigger also in storedViolations, every delta is rejected (the trigger must
   verify, the same trace must still violate), which contradicts the BEN-DEV-1 acceptance. So the
   trigger is excluded by id, and stored traces are the head's `test/traces/**` and `test/repro/*.json`
   (base-shop keeps the D1-D5 true violations there) plus `--stored-traces <dir,...>`. The D1 test
   (base seed-v1, whose test/repro is empty) passes CU's fixture traces (shop-mcp 7bf2e66's stored
   D1-D5 traces) with `--stored-traces`.
3. **Mutation variants** are applied to the trigger's first exchange (the tool's main upstream
   response; MUT draws one site per response). Re-running "through the server" uses the base
   checkout on the host (no candidate code) with the mutated exchanges replayed by an upstream link.
4. **The SDK runner is not resumed.** SAFE's runner gives every query a fresh temp HOME, so a resumed
   SDK session fails immediately with `error_during_execution` (seen in the live DEV-X1 run, session
   2). Later SDK sessions therefore start fresh with the gate feedback in the prompt
   (`buildPrompt({previousFailure})`); stub scripts advance by resume, as SAFE's stub runner needs.
   The worktree keeps the agent's edits between sessions; fiks's leftovers outside the edit guard are
   reset.
5. **Fixture determinism**: exchange `startedAt`/`durationMs` are wall-clock and base-shop's
   create_order sends a random Idempotency-Key, so the generator pins them (frozen clock, 0 ms, a fixed
   key) before saving. Nothing evaluates those fields.
6. **F/P parity**: verdicts, reasons, failing test names and messages are identical host vs container
   except for one thing the test normalises: the location of `node_modules` inside vitest's own stack
   frames (host: the clone's install through the worktree symlink; container: the image's install at
   `<worktree>/node_modules`).
7. **Product mode is unchanged** (legacy adapter), including its direct `gh pr create`. Experiment mode
   makes no gh call at all (fake-gh log empty in the live run).

## Blocked / not done

- **D3 as an injector rule (acceptance item 8, D3 half): blocked on CORE.** The D3 fix adds an
  Idempotency-Key, so the repo's own v1 fixture `test/fixtures/v1/order-create.json` goes stale as
  well as the frozen trace. CORE's `rerecord()` re-records every stale recording under the given
  profile (vendor v1 + the D3 rule, which sets `vendor-api-version: 2026-10-01`), and
  `sameCallAndUpstream` then refuses the fixture: `rerecord: test/fixtures/v1/order-create.json
  re-recorded against a different call or upstream` (RerecordLog `outcome: failed`, P gate fails).
  Needed (CORE, `packages/cli/src/commands/rerecord.ts`): apply the profile's rule only to recordings
  captured under that profile (or naming none of their own upstream); a repo fixture with its own
  `upstream` keeps it. The D4 half passes. The D3 test is in place and runs with `FIKS_ORCH_D3=1`.
- **Fresh-worktree `pnpm fiks scenario v1-all --domain tracker` (acceptance item 11): blocked.** SETUP
  and `ensure-tracker-mcp.mjs` succeed in a fresh `git worktree add $TMPDIR/wt-orch HEAD`; the
  scenario then fails because (a) its default ref is the Domain's `seedTag` `seed-tracker-v1`, which
  `seed-tag` cuts at A0 from the frozen contracts (not written yet), and (b) with `--shop-ref main`
  the harness reads `packages/contracts/contracts/tracker-mcp.contracts.json` (DOM2's
  `contractsPath`, written at A0) and throws ENOENT instead of reporting unverifiable. Both are
  CORE/DOM2 code (`harness.ts`, `scenario.ts`) or wait for A0.

## Acceptance evidence (round 1)

See the structured report of this round for the command list and key output.
