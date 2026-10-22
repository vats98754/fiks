# SBX build log

Branch `ws/SBX`, based on main `c144b03` in rounds 1-2 and on main `aa7e28a` in round 3. This is wave 1. The only external actions were pulls from
Docker Hub (`node:22.23.3-bookworm-slim`, pinned by digest) and from the npm registry during image builds. Nothing
was pushed, no repo was created and no PR was opened.

## What landed (`packages/sandbox`, `@fiks/sandbox`)

- **`docker/repo.Dockerfile` and `src/build.ts`: the per-repo image.**
  - It is built from a node base image that is pinned by digest.
  - It adds `curl` and `git`, plus pnpm 9.12.3 from npm.
  - The global `/usr/local/etc/npmrc` puts the store at `/opt/pnpm-store` whatever `HOME` is.
  - It runs `pnpm fetch` and `pnpm install --frozen-lockfile --offline` in `/work`.
  - The git shim is installed at `/opt/fiks-shim/git`.
  - The build context holds only the lockfile inputs at a commit. Those are `pnpm-lock.yaml`, `.npmrc`,
    `pnpm-workspace.yaml` and the `package.json` of every lockfile importer.
  - The tag is `fiks-sbx/<repo>:<sha256(manifest)[:16]>`. The printed digest is the image id (`sha256:…`).
- **`src/backend.ts`: `DockerExecBackend`, which implements `ExecBackend`.**
  - Each attempt gets one container, and every command goes through `docker exec … env -i <env> cmd`, so a
    command sees exactly the given env.
  - Default env: `{PATH, CI=1, HOME=/tmp}`.
  - Any env name that looks like a secret is refused (`GH_TOKEN`, `*TOKEN*`, `ANTHROPIC*`, `CLAUDE*`, `*CANARY*`,
    …).
  - The docker CLI runs with a scrubbed env.
  - Container settings: `--network none`, `--read-only`, tmpfs `/tmp`, `--cap-drop ALL`, `no-new-privileges`,
    memory, cpu and pids limits, and `--init`.
  - The worktree is bind-mounted at `workdir` (default `/work`).
  - **node_modules:** the host `node_modules` symlink is taken out of the worktree and restored by `cleanup()`. A
    per-container volume copied from the image's Linux `node_modules` is mounted at `<workdir>/node_modules`.
  - An optional egress log is kept: JSONL, one line per denied-egress line seen in command output.
  - `pushAttempts()` reads the in-container shim log.
- **`src/ci-local.ts`: `ciLocal(worktree, image, extraChecks?, opts?) → {green, log, steps}` and
  `runPreGate(worktree, image, checks, opts?)`.**
  - It mirrors the target's `.github/workflows/ci.yml` with a small parser (`run:` scalars or `|`/`>` blocks;
    `uses:` steps are reported as provided by the image).
  - Each step runs as `bash --noprofile --norc -eo pipefail -c` at the worktree root (GitHub's default run shell;
    round 2, was `bash -e -c`).
  - Round 2: `parseWorkflow` throws `UnmirroredWorkflowError` on any construct it does not mirror (see Round 2).
  - `pnpm install` gets `--offline`.
  - The first failing CI step skips the rest of CI, as Actions does. Extra checks always run.
  - `green` means every executed step passed.
- **`src/probes.ts`: `runCanaryProbes`.** It checks that:
  - egress fails three ways (curl, node fetch, raw TCP);
  - loopback works;
  - env is exactly the expected variables, with no canary or token;
  - writes fail at `/`, `/opt`, `/etc` and `/usr/local/bin`, and work inside the worktree;
  - host paths (`~/fiks/.env`, `/Users`, the host `$HOME`) are absent;
  - `HOME=/tmp`, and `$HOME/fiks/.env` gives ENOENT.

  Denied egress probes are appended to the egress log. `makeCanaries()` produces `GH_TOKEN=fiks-canary-…`.
- **`docker/git-shim.sh` and `src/shim.ts`: the git push shim.** The same POSIX-sh shim runs on the host
  (`installGitShim(binDir, logPath)`, which puts it first on PATH) and in images. It records and refuses
  `push`, `send-pack`, `http-push` and `-c alias.*=…push…`, and passes everything else to the real git.
  Round 3: it also resolves aliases from every config source (see Round 3); before that, a push through an
  alias from git config or `GIT_CONFIG_*` reached the remote unrecorded.
- **`docker/tools.Dockerfile`, `src/build-tools.ts` and `src/tools.ts`: fiks-tools.**
  - The image is built from `git archive --prefix=fiks/ <commit>`. The archive is checked to hold no `.env`,
    `.fiks` or `.work`, and the build re-checks this in the image.
  - The default is `--ref main` with `pnpm install --frozen-lockfile`.
  - `--ref HEAD --apply-fragments` applies `deps-fragments` and installs with `--no-frozen-lockfile`. It is labelled
    `fiks.tools.testOnly=true`, tagged `fiks-tools-test:*` and printed as TEST-ONLY.
  - `toolsMounts(image)` copies `/opt/fiks` once into a `fiks-tools-<digest>` volume. It then mounts each top-level
    entry read-only at `/opt/fiks/<entry>`. By default it refuses test-only images (`purpose: 'run'`).
  - `/opt/fiks` itself stays a directory of the read-only root. So a worktree can be mounted below it where the CLI
    looks (`/opt/fiks/.work/wt/ref-seed-v1`, `shopAt()`), while the tools tree stays read-only and has no
    `.env`/`.fiks`/`.work`. A single read-only mount at `/opt/fiks` cannot take a nested mountpoint (runc
    `mkdirat … read-only file system`). Docker 28 image mounts of one image cannot be repeated ("mount already
    exists with name").
  - `execFiks(container, argv)` runs `/opt/fiks/node_modules/.bin/tsx /opt/fiks/packages/cli/src/main.ts <argv>`
    with env exactly `{PATH, CI=1, HOME=/tmp, FIKS_DIR=/tmp/fiks, FIKS_IN_SANDBOX=1}`.
- **`src/agreement.ts`: the 20-head Actions agreement script.**
  - Without `--push` it is a dry run: local verdicts plus the branches it would push.
  - With `--push` it first checks the base repo with `gh repo view --json owner,isFork,parent`. It refuses an owner
    other than vats98754, and a fork whose parent is owned by anyone else.
  - It pushes only `<sha>:refs/heads/sbx-agree/<sha12>` to an explicit URL and reads `gh run list`. It refuses any
    `gh` call with `pr` in it.
  - It was **not run with `--push` in this round**: the builder rules allow no pushes.
- **`src/lock.ts`.** This is the `with-lock`-compatible mutex (`~/.fiks/locks/<name>`). An ancestor's hold is
  re-entered, so `with-lock docker pnpm tsx build.ts` does not deadlock.
- **`MEMORY.md`** covers the 6 GB plan, the observed 7.65 GiB, the per-container limits and the measured peak.

No deps fragment is needed: no other package imports `@fiks/sandbox` yet. A new workspace package changes
`pnpm-lock.yaml` locally. That change is not committed, per the merge discipline.

## Acceptance evidence (2026-10-21, Docker 28.3.3, linux/aarch64)

**1. SETUP.** All three steps ran clean:

- `node scripts/apply-dep-fragments.mjs` printed "nothing to apply";
- `pnpm install --no-frozen-lockfile` succeeded;
- `node scripts/ensure-shop-mcp.mjs` succeeded (clone at 7bf2e66).

**2. Repo image build.** `pnpm tsx packages/sandbox/src/build.ts --repo .work/shop-mcp` was run three times:
`--ref HEAD`, `--ref HEAD` again, and `--ref seed-v1`. The seed-v1 lockfile is byte-identical. All three builds
printed `lockfile sha256: 18e534c98dc0176c…` and `digest: sha256:b87ba9aec64fb80ffafede9a7ebc55610c488f3a788fbb00be8419151919a9bc`.

- **Caveat:** the digest is stable because BuildKit's layer cache is keyed by content. The context holds only the
  lockfile inputs. A build with `--no-cache` would produce a different digest, because apt and pnpm write
  timestamps. Runs pin the digest they record, so this does not affect them.

**3. fiks-tools (round 7).**

- **`--ref main` FAILED in round 1 (superseded: it passes on main `aa7e28a`, see Round 3).** On main `c144b03`, `pnpm install --frozen-lockfile`
  stops with `ERR_PNPM_OUTDATED_LOCKFILE … not up to date with <ROOT>/packages/interfaces/package.json`. The
  committed `pnpm-lock.yaml` on main has no importers for `packages/interfaces` and `packages/domains` (CORE-SEED).
  The orchestrator's lockfile regeneration at merge is missing. `build-tools.ts --ref main` will succeed once main's
  lockfile has every merged importer.
- **`--ref HEAD --apply-fragments` passes.** The test was a local clone of `ws/SBX` with one committed, unapplied
  fragment, `deps-fragments/SBXTEST.json`, which adds `@fiks/sandbox` to `packages/cli`
  (`apply-dep-fragments.mjs --check` exit 1). The build printed `digest:
  sha256:dff42881427550d3902d5fb79b439e62a284f50ea8f18d91d541d48570bb2d70 (TEST-ONLY: fragments applied,
  --no-frozen-lockfile; never used by a run)`. In that image:
  - `grep @fiks/sandbox /opt/fiks/packages/cli/package.json` matches line 19;
  - `test -e /opt/fiks/.env` gives 1;
  - the labels include `fiks.tools.testOnly=true` and `fiks.tools.commit=9858349…`.

**4. Container probes (`pnpm vitest run packages/sandbox`).** `with-lock suite pnpm vitest run packages/sandbox`
reported 33 passed and 7 skipped. The 7 skipped are the e2e file, which runs only with `FIKS_SANDBOX_E2E=1`.
`test/container.test.ts` (11 tests) shows:

- **Egress:** `curl -sS --max-time 5 https://example.com` exits 6 ("Could not resolve host"), and the egress log
  records it.
- **Env:** `env` is exactly `PATH`, `CI` and `HOME`. The canaries `GH_TOKEN=fiks-canary-…` and `FIKS_CANARY` were
  planted in the host process env and are absent.
- **Writes:** writes to `/opt`, `/etc`, `/usr/local/bin` and `/` fail with EROFS. A write inside the worktree works.
- **Offline install:** `node_modules` was emptied, then `pnpm install --offline --frozen-lockfile` exited 0 with
  `--network none` and restored `.bin/vitest`.
- **node_modules in the container** is a real directory with `@esbuild+linux*` and no darwin package.
- **Canary suite:** all 15 probes pass.
- **Cleanup** removes the container and its volume and restores the host symlink.

**5. ciLocal vs host (`FIKS_SANDBOX_E2E=1 pnpm vitest run packages/sandbox/test/e2e.test.ts`, 7 tests passed).**

| Run | Host `pnpm test` | ciLocal | Local steps (install / typecheck / lint / test) |
|---|---|---|---|
| shop-mcp 7bf2e66 | not compared | green | all pass |
| seed-v1 + D1 | exit 0 | green | all pass |
| seed-v1 + D2 | exit 0 | green | all pass |
| seed-v1 + D3 | exit 1 | red | test fails |
| seed-v1 + D4 | exit 0 | green | all pass |
| seed-v1 + D5 | exit 0 | green | all pass |

- D3 is red on both sides because the fix changes upstream requests and nothing re-recorded the fixtures. That is
  CORE's `rerecord-head`. The verdicts agree in all 5 cases.

**6. Unit tests (`test/unit.test.ts`, 22 tests).**

- `ciLocal` and `runPreGate` (scripted backend) with an extra check that exits 1: `green=false`, and the log
  contains the check's output.
- The same holds in Docker (`container.test.ts`): CI steps all pass, the extra check fails, `green=false`, and the
  log contains its output.

**7. Git shim.**

- **Host:** `push`, `-C <dir> push --force`, `-c alias.p=push p` and `send-pack` each exit 1 and are recorded. The
  bare remote has no refs. `rev-parse` passes through.
- **Container:** `git push https://github.com/vats98754/shop-mcp.git HEAD:refs/heads/x` exits 1, and
  `pushAttempts()` has exactly that argv.

**8. execFiks (round 6).** The test ran with `FIKS_TOOLS_IMAGE=sha256:d5f10c7e…`, a test-only image of `ws/SBX` HEAD
`9fa9ba6`. A test-only image was used because `--ref main` could not build then (item 3; Round 3 uses the main image).

- **Setup:** the container uses the shop-mcp image with `--network none` (checked: `HostConfig.NetworkMode=none`).
  The seed-v1 worktree is mounted at `/opt/fiks/.work/wt/ref-seed-v1` with Linux `node_modules`.
- **Same verdicts as the host:** `execFiks(['scenario','v1-all','--json'])` gives the host run's verdicts call for
  call (`pnpm fiks scenario v1-all --json` with `FIKS_SEED_DIR` set to the same worktree). That is 9 verified, plus
  `get_product {"id":"p-0000"} → unverifiable` on both sides, and none violated.
  - **Wording mismatch:** the acceptance text says "(all verified)". The host's own run reports p-0000 (a missing
    product) as unverifiable, so the test asserts equality and no violations.
- **Inside the container:**
  - `test -e /opt/fiks/.env` gives 1;
  - `env` is exactly the 5 variables;
  - a write to `/opt/fiks/packages` fails;
  - `node -e "require('esbuild')…"` (run in `/opt/fiks/node_modules/tsx`) prints
    `linux 0.28.2 /opt/fiks/node_modules/.pnpm/@esbuild+linux-arm64@0.28.2/…` and transforms TS.

**9. Repo checks.** `pnpm typecheck` gives 0 and `pnpm lint` gives 0 (152 files).

Also run: the dry run of `agreement.ts --heads 7bf2e66,seed-v1` gave local green for both, with "would push … as
sbx-agree/<sha12>". Nothing was pushed.

## Round 2 (2026-10-21, ws/SBX rebased on main `c144b03`; main had not moved, so the rebase was a no-op)

**Changes (`src/ci-local.ts`, commit `6fa5c28`).**

- `run:` steps now execute as `bash --noprofile --norc -eo pipefail -c <script>` (`RUN_SHELL`), GitHub's default
  Linux run shell. Before, `bash -e -c` had no pipefail, so `pnpm test | tee out.txt` was green locally and red on
  Actions. Checked in Docker: `runPreGate(['false | tee /tmp/fiks-pipefail.txt'])` gives `green=false`, exit 1. On
  the host (unit test), `false | tee /dev/null` exits 1 under `RUN_SHELL` and 0 under the old `bash -e -c`.
- `parseWorkflow` now throws `UnmirroredWorkflowError` instead of silently ignoring what it does not mirror:
  - step keys other than `name`, `run`, `uses`, `with`, `id` and `timeout-minutes` (so `if`, `env`,
    `working-directory`, `shell`, `continue-on-error`, ...); `with:` on a `run:` step;
  - job keys other than `name`, `runs-on`, `timeout-minutes`, `needs`, `permissions`, `concurrency`, `outputs` and
    `steps` (so `strategy`/`matrix`, `env`, `defaults`, `if`, `container`, `services`, `continue-on-error`, a
    reusable-workflow `uses`);
  - workflow-level `env:` and `defaults:`;
  - a `${{ }}` expression inside a `run:` script (not evaluated locally).
- `with:` inputs of `uses:` steps are no longer scanned as if they were step keys. A step's `timeout-minutes:` is
  mirrored as that step's timeout.
- The shop-mcp workflow (and the identical `ref-seed-v1` one) still parses unchanged.

**Acceptance re-run.**

1. SETUP: `apply-dep-fragments.mjs` printed "nothing to apply"; `pnpm install --no-frozen-lockfile` exit 0;
   `ensure-shop-mcp.mjs` exit 0 (shop-mcp at `7bf2e66`).
2. `build.ts --repo .work/shop-mcp`, twice: both printed `lockfile sha256: 18e534c98dc0176c…` and
   `digest: sha256:b87ba9aec64fb80ffafede9a7ebc55610c488f3a788fbb00be8419151919a9bc` (same as round 1).
3. fiks-tools.
   - **`build-tools.ts` (default `--ref main`) still FAILED in round 2 (superseded: passes in Round 3)** with `ERR_PNPM_OUTDATED_LOCKFILE` on main `c144b03`
     (`specifiers in the lockfile ({}) don't match specs in package.json ({"@fiks/contracts":"workspace:*"})`).
     The fix (regenerate and commit main's `pnpm-lock.yaml` with the CORE-SEED importers) is an orchestrator
     action on main, outside SBX's paths; it had not landed when this round ran.
   - Code-path check only (not the acceptance item): a scratch clone of main `c144b03` with only
     `pnpm install --lockfile-only` committed (+18 lines, the `interfaces`/`domains` importers) built with
     `--frozen-lockfile` and printed `digest: sha256:6d467bcff4a0155e8f8b812137dda076bcf7cac8bbe864f10825cf54fdef316b`,
     label `fiks.tools.testOnly=false`. The scratch tag was removed afterwards.
   - `--ref HEAD --apply-fragments` PASSES: a scratch clone of `ws/SBX` `6fa5c28` plus one committed, unapplied
     fragment `deps-fragments/SBXTEST.json` (`{"stream":"SBXTEST","add":{"packages/cli":{"@fiks/sandbox":"workspace:*"}}}`,
     `--check` exit 1) printed `digest: sha256:ba7a2f1bd6b64c30352fc55a6d5c8f087a1e0359ca2d0496d6e1ae89d9560aa9
     (TEST-ONLY: …)`. In the image, `/opt/fiks/packages/cli/package.json` line 19 is `"@fiks/sandbox": "workspace:*"`,
     `test -e /opt/fiks/.env` exits 1, and the labels include `fiks.tools.testOnly=true`.
4–8. `FIKS_SANDBOX_E2E=1 with-lock suite pnpm vitest run packages/sandbox`: 3 files, 59 tests passed, exit 0.
   Container probes (curl fails, exact env, writes outside the worktree fail, offline install, push shim) pass.
   ciLocal on 7bf2e66 is green; D1/D2/D4/D5 host exit 0 and ciLocal green, D3 host exit 1 and ciLocal red (test
   step), so verdicts agree 5/5. `execFiks(['scenario','v1-all','--json'])` matches the host call for call
   (9 verified, `get_product p-0000` unverifiable on both sides).
9. `pnpm typecheck` exit 0; `pnpm lint` exit 0 (152 files, no warnings).

## Round 3 (2026-10-22, ws/SBX rebased on main `aa7e28a`)

Rounds 1-2 evidence above ran on main `c144b03`. Main has since merged BENCHX, MON and DOM2; ws/SBX was rebased
onto `39500d1` and then again onto `aa7e28a` (DOM2 landed during the round). Both rebases were clean; no conflicts.
All acceptance items below were re-run on the `aa7e28a` base.

**Change 1: git shim alias bypass (`docker/git-shim.sh`, commit `2fb511c`).**

- **The defect (verifier repro):** with `installGitShim(bin, log)` first on PATH, `git config alias.p push; git p
  origin HEAD:refs/heads/b` and `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.q GIT_CONFIG_VALUE_0=push git q …` both
  exited 0, the remote gained the refs, and nothing was logged. The shim only looked at the literal subcommand.
- **The fix:** when the subcommand is not a builtin (git never consults an alias for a builtin), the shim asks the
  real git `"$real" <same leading global options> config --get alias.<sub>`. That reads repo/global/system config,
  `include.path`, `-c`, `--config-env`, `GIT_CONFIG_COUNT/KEY_n/VALUE_n` and `GIT_CONFIG_PARAMETERS`, and honours
  `-C`. It follows alias chains (up to 10 hops, skipping global options inside an expansion) and blocks any
  expansion that mentions `push`, `send-pack` or `http-push`, including a `!` shell alias. The log `reason` is
  `alias <sub>=<value>` or `alias <sub> via <hop>=<value>`.
- **Host unit test** (`test/unit.test.ts`, "a push through an alias from git config or GIT_CONFIG_* …"): `git p`
  (repo config), `git q` (GIT_CONFIG_*), `git r` (chain r→p→push), `git s` (alias `-c x.y=z p`), `git -C <repo> p`
  and `git t` (alias `!git push …`) each exit 1 with "blocked in this run" and are logged with their argv; the bare
  remote has no refs; a non-push alias (`st = status --short`) still runs and is not logged. With the round-2
  shim restored, this test fails at its first case (`p origin HEAD:refs/heads/b: expected +0 to be 1`).
- **Container test** (`test/container.test.ts`): in the per-attempt container (Debian `/bin/sh` = dash),
  `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.q GIT_CONFIG_VALUE_0=push git q https://github.com/vats98754/shop-mcp.git
  HEAD:refs/heads/y` exits 1 and `pushAttempts()` records it with reason `alias q=push`.
- **What no PATH shim can block (documented in `src/shim.ts` and the shim header):**
  - running the real git by absolute path. Checked on the host: with the shim first on PATH, `/usr/bin/git push
    origin HEAD:refs/heads/e` to a local bare remote exited 0 and created `refs/heads/e`, unlogged;
  - `git` run from a hook or from a script that a `!` shell alias starts: git puts its exec-path first on PATH for
    those children, and it holds the real `git`. Checked: inside `!sh x.sh`, `command -v git` is
    `/opt/homebrew/opt/git/libexec/git-core/git`.
  - So the shim is the audit log (P4 counts its lines); the enforcement in the sandbox is `--network none`.

**Acceptance re-run on `aa7e28a`.**

1. SETUP: `apply-dep-fragments.mjs` printed "nothing to apply"; `pnpm install --no-frozen-lockfile` exit 0 (the
   only lockfile change is the new `packages/sandbox` importer, not committed); `ensure-shop-mcp.mjs` exit 0.
2. `with-lock docker pnpm tsx packages/sandbox/src/build.ts --repo .work/shop-mcp`, twice: both printed
   `lockfile sha256: 18e534c98dc0176c…` and `digest:
   sha256:46f9afe7349f11ed1286f827fc3a6c9a50a2958987e6264f475176ee14f67be1`. The digest differs from rounds 1-2
   (`b87ba9ae…`) because the image bakes in the changed git shim.
3. fiks-tools.
   - **`build-tools.ts` (default `--ref main`) now PASSES.** The round 1-2 failure (`ERR_PNPM_OUTDATED_LOCKFILE`)
     is gone: main's lockfile has every merged importer. `with-lock docker pnpm tsx
     packages/sandbox/src/build-tools.ts` resolved `main = aa7e28a2919e…`, ran `pnpm install --frozen-lockfile`
     in Linux ("Done in 20.3s"), and printed `image: fiks-tools:aa7e28a2919e` and `digest:
     sha256:893f4f5768812a5b06118ac7bb680eb4bb7ac2e55b6eecb94e832e77d76e2ab5`. Labels:
     `fiks.tools.commit=aa7e28a…`, `fiks.tools.testOnly=false`.
   - **`--ref HEAD --apply-fragments` PASSES.** A scratch clone of ws/SBX `8120cb8` plus one committed, unapplied
     fragment `deps-fragments/SBXTEST.json` (`--check` exit 1, "1 unapplied") printed `digest:
     sha256:85650537005116352a9c444b75e67fd250af2083a7161b0b5f95a6bf27d03e5a (TEST-ONLY: fragments applied,
     --no-frozen-lockfile; never used by a run)`. In the image, `/opt/fiks/packages/cli/package.json` line 19 is
     `"@fiks/sandbox": "workspace:*"`, `test -e /opt/fiks/.env` exits 1, and the labels include
     `fiks.tools.testOnly=true`. The scratch tag was removed afterwards.
4-8. `FIKS_SANDBOX_E2E=1 FIKS_TOOLS_IMAGE=sha256:893f4f57… with-lock suite pnpm vitest run packages/sandbox`:
   3 files, 61 tests passed (41 of them in `unit.test.ts`), exit 0. The e2e now uses the run-grade fiks-tools
   image of main `aa7e28a`, not a test-only image.
   - Container probes: curl to example.com fails, `env` is exactly the expected variables (no canary/token), writes
     outside the worktree fail, `pnpm install --offline` succeeds with `--network none`; the push shim blocks and
     records both a plain push and a `GIT_CONFIG_*` alias push.
   - ciLocal on shop-mcp `7bf2e66`: green. D1/D2/D4/D5 oracle patches on seed-v1: host `pnpm test` exit 0, ciLocal
     green. D3: host exit 1, ciLocal red (test step). Verdicts agree 5/5.
   - Unit: ciLocal and runPreGate with an extra check that exits 1 give `green=false` with its output in the log.
   - execFiks (`--network none`, fiks-tools `aa7e28a` mounted at `/opt/fiks`, seed-v1 worktree with Linux
     node_modules): `scenario v1-all --json` gives the host verdicts call for call (9 verified, `get_product
     p-0000` unverifiable on both sides, none violated); `test -e /opt/fiks/.env` fails; env is the 5 variables;
     `require('esbuild')` loads `@esbuild/linux-arm64` 0.28.2.
9. `pnpm typecheck` exit 0; `pnpm lint` exit 0 (219 files, no fixes).

## Open items

- **The 20-head Actions agreement run** needs `--push`. Section 8.0-4 approves the Actions minutes for it, but the
  builder rules for this round allow no pushes. It is left to a run step.
- **The P1 ORCH preflight** (a planted head reading `~/fiks/.env` during re-record) belongs to ORCH and CORE. SBX
  provides `runCanaryProbes`, the egress log and `execFiks`.
