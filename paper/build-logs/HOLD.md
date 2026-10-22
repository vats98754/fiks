# HOLD build log

Branch `ws/HOLD`, based on main `bd19858` (wave 1 complete). Wave 2. Depends on CORE, DOM2, SBX,
MUT, INJ and LLMR, all merged. External actions: the approved Semgrep CE image pull (PLAN 8.0-4,
`semgrep/semgrep:1.179.0@sha256:93963d9295a366f59e4850127b1550400ee7b388f04fe144e4a1f6325d96e01b`,
published 2026-10-02, linux/arm64 in the index) and npm installs of `eslint-plugin-security@4.2.0`
(approved; published 2026-10-01) with `eslint@10.12.0` (2026-10-02; the plugin's host) and
`fast-check@4.10.2` (2026-09-19; named by PLAN 3.0 and the deliverable). Every direct dependency is an
exact version published before the 2026-10-04 pin cutoff. Docker image builds pulled npm packages for
test-only fiks-tools images. Nothing was pushed, no repo was created, no PR was opened and no LLM
call was made.

The machine ran at load averages of 30-95 during the build (other streams' suites and containers),
so the timings below are slow.

## What landed

### `packages/heldout` (`@fiks/heldout`)

- **`src/semantic.ts`: semantic equality (PLAN 3.0).** `semanticDiff/semanticEqual`: integers exact,
  floats within 1e-9 relative (`max(1,|a|,|b|)`), `null` == absent at any depth, key order ignored,
  arrays ordered unless a path is listed in `unorderedPaths` (then a multiset), strings NFC-exact,
  ISO-8601 instants (with an offset) compared as instants. `classifyOutput` (error / empty / data),
  `outputsEquivalent` (two errors are equal; error == empty only when `inputValid === false`) and
  `matchesTruth` (valid input: data equal to `truth().expected`; invalid input: error or empty).
- **`src/sast/`: SAST on the diff only, 2 of 3 (PLAN 3.0 criterion 4, 5.8).**
  - Semgrep CE in its own container (`semgrep.ts`): the image above by digest, `--network none`,
    read-only root, `--metrics=off`, local rules only (`semgrep.yml`: code-eval, Function
    constructor, vm, command-exec through child_process imports/requires/namespaces,
    dynamic-require, fs-nonliteral, regexp-nonliteral; every rule carries a shared `category`).
  - eslint-plugin-security (`eslint.ts`) through ESLint's `Linter` in memory; TypeScript is reduced
    with Node's whitespace-preserving `stripTypeScriptTypes`, so reported lines are the file's lines
    (tsc emit as a fallback). Each rule maps to a category (`ESLINT_CATEGORY`).
  - The AST detector (`ast.ts`): a TypeScript-compiler walk that resolves what a callee is bound to
    (named/aliased/namespace imports, `require` destructuring, `fs.promises`): eval / Function / vm,
    child_process calls with a non-literal command or `shell`, non-literal require/import, fs calls on
    non-literal paths, non-literal RegExp.
  - `sastOnDiff`: the changed JS/TS files at base and at head, one scan per tool over both sides. A
    finding is new when it is on a line the patch adds and the base has no finding of the same tool
    and category on an identical line. `confirm()` keeps new findings reported by >= 2 distinct tools
    (same file and category, within 2 lines). The criterion passes iff nothing is confirmed.
- **`src/inputs.ts`: differential inputs.** 200 inputs (`DIFFERENTIAL_RUNS`) under seed
  `DIFFERENTIAL_SEED = 20261021`, drawn with `fc.sample` from a generator module's
  `arbitrary(fc)`; DOM2's `generate(seed, n)` form is supported too (TRK-DEV-1). An input is a call
  sequence; `{ $ref: { call, field } }` takes a field of an earlier call's output (create, then
  read back).
- **`src/observe.ts`: the in-sandbox half of grading.** Runs only inside the grading container as
  `fiks grade --observe --require-sandbox` (through execFiks), with the CLI harness injected:
  - hidden tests and the renamed-id variant: every file gets fresh upstream chains (vendor v1 behind
    the drift's injector rule; plain vendor v1; renamed files behind the renaming link) under the
    domain's frozen clock, and one vitest process runs all files, each finding its chains in
    `FIKS_HELDOUT_UPSTREAMS`; per-file pass/fail from the JSON report (a file with no result or no
    test is a harness-level failure);
  - the differential and the held-out traffic: one harness per setting (`v1`, `drifted` = v1 + rule),
    vendor reset before every input, each call's trimmed output (`isError`, `structuredContent`)
    and `truth()` on the vendor state after it;
  - the result goes back on stdout after a sentinel line.
- **`src/rename.ts`**: the renaming link (`rename.json` next to the renamed-id tests: regex rules
  forward on responses, inverse on request paths and bodies).
- **`src/grade.ts`: `grade(patch, drift)` -> GradeRecord.** `Grader` prepares a standalone clone of
  the domain's repo at `<base>^{commit}` (local refs only), applies the patch and commits it under a
  fixed identity and date (`head.ts`), opens one grading container per head (repo image + read-only
  fiks-tools + the rule at `/opt/heldout-rule`), runs one `rerecord-head` (execFiks,
  `--require-sandbox`, the drift profile), copies the hidden tests in, observes, restores the
  overlay. SAST runs on the host (parsing only). Ref A and ref B are observed once per drift and
  cached. `judge()` (pure) sets the five criteria and the reason codes, in criterion order:
  `hidden`, `differential` (patch == A or == B on every input in both settings), `renamed-id`,
  `sast`, `truth-replay`; plus `patch-apply` / `observation-error`. `ambiguousInputs` counts inputs
  where A != B in either setting. `gradeRecordHash` is sha256 of canonical JSON.
- **`src/accept.ts`: the H2 accept matrix (PLAN 3.2).** `AcceptMatrix(pkg, env, testSets)`:
  - once per drift, each test set runs on base under SBX's fs-read-log preload
    (`/opt/fiks/packages/repro/src/fs-read-log.cjs`): `recordingsRead` (JSON recordings under the
    worktree), the overlaid subset (T-owned files and `.alerts/<id>.json`; recordings tracked at base
    are left to rerecord-head's stale step, as CORE's rerecord-head does), `inlineRecording` (a
    request/response literal in a test file; never named for re-recording), conflicting bytes at one
    path across sets;
  - per patch, once and cached: typecheck and lint on the clean head, the frozen trace at
    `.alerts/<id>.json` and every overlaid T recording materialised, **one** `rerecord-head` over
    their union (`--check accept`, drift profile, `--require-sandbox`), the existing suite + stored
    traces in one vitest run (split by `test/fiks/traces.test.ts`), then each set's test files run
    once over the same overlay; the overlay is restored at the end;
  - accepted iff typecheck, lint, the re-record (no `failed` file), suite, stored traces and T pass;
    T = empty is the base checks alone; a T file that does not load fails T for every patch.
- **`src/pool.ts`: pools (PLAN 5.6).** `buildPrimaryPool` (dedupe by normalised diff in source order,
  class from the grade only, cross-tab generator intent vs grade, `excluded` when < 3 per class,
  `requestChanging` per drift, seeded order, hash) and `buildSecondaryPool` (dedupe, cap 30 per drift
  stratified by arm: one per non-empty arm, then largest remainder, seeded sample per arm, hash).
  Ordering is code-unit, never locale.
- **`src/candidates.ts`**: primary candidates: ref A, ref B, P1-P8 through MUT's `mutatePatch`
  (Haiku), 4 plausible-wrong (Haiku) and 2 alternative fixes (Sonnet, prompt without A or B) from
  `prompts/`; the model call is injected (`liveCandidateLlm` = LLMR `complete()` for runs; stubs in
  tests); `typecheckCandidates` keeps the ones that apply and typecheck in the container.
- **`src/request-changing.ts`**: `requestChanging(drift)`: ref A head, the frozen trace at
  `.alerts/<id>.json` and the enumeration recordings at `.fiks-enum/`, one rerecord-head naming all
  of them; true iff one of those overlays is `rerecorded` (a stale suite fixture does not count).
- **`src/injector-bridge.ts`**: registers `@fiks/injector`'s `startInjector` (with the rule domain's
  frozen clock) as the vendor-api injector factory unless one is registered. ORCH owns
  `bootstrap/30-injector.ts`, which is not merged yet; bootstrap modules load before command
  modules, so once ORCH's factory exists this is a no-op. Without a factory, `rerecord-head` with an
  injector profile cannot start the chain.
- **`biome.json`** (nested): `noRestrictedImports` for `@fiks/contracts`, `@fiks/proxy` and their
  source paths, scoped to the package.
- **`vitest.config.ts`**: tests under `test/` only (the fixtures are tests for target repos).

### CLI (owned files)

- `packages/cli/src/commands/grade.ts`: `fiks grade --pkg <m> [--patch ...] [--ref A|B|base]
  --tools-image <img> [--repo-image] [--purpose test] [--traffic]`; `fiks grade --accept <spec>`;
  `fiks grade --observe --require-sandbox` (exit 2 outside the container); `fiks grade dev-traces
  [--check]`; `fiks grade dev-grade [--write-expected]`. Loading it calls `ensureInjectorFactory()`.
- `packages/cli/src/commands/pool.ts`: `fiks pool --primary|--secondary --input --seed`,
  `--request-changing`, `--generate --llm stub|live`.
- `deps-fragments/HOLD.json`: `@fiks/heldout` into `packages/cli`.

### Dev DriftPackages (`packages/heldout/fixtures/dev`)

<!-- RESULTS -->
