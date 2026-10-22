# PREREG build log

Branch `ws/PREREG`, based on main `c144b03` (CORE-SEED merged). Wave 1; no external actions
(no push, no repo, no install). Round 1, 2026-10-21.

## What landed (all under `paper/prereg/`)

- `PREREG.md`. Part I is the registration record: freeze schedule (PLAN §5.2 table) and the
  ledger edges, registered constants in a ` ```prereg-constants ` block (sign-flip seeds for H2,
  H3a, H3b, H4a, H4b, E4 ×2, E11; BCa and H1 cluster-bootstrap seeds; the frame enumeration
  `--seed <s>`; flips/resamples as fixed by PLAN), frame rules, `<<FILL@F4b: …>>` slots for the
  F4b values (N_E, crit, power, m, record hash) and a `<<FILL@F5: …>>` slot for the
  `power.py all --check` output, the §3.3 "stated plainly" power sentence, and what may change
  after F5. Part II is PLAN §3 (3.0–3.5), §4, §5.5, §5.7, §8.2, §9 and §13 copied verbatim
  (headings demoted one level, PLAN numbers kept). It was assembled mechanically from PLAN.md at
  `c144b03`.
- `check-prereg.ts` (+ `lib/plan-blocks.ts`, `lib/prereg-rules.ts`, `lib/prereg-check.ts`):
  splits each listed PLAN section into blocks (heading, table row, code block, list item,
  paragraph) and requires each in PREREG.md verbatim and in PLAN order (whitespace runs collapsed,
  nothing else normalised). 140 named rules in 17 classes (the acceptance list) are located by
  anchor and reported per class; an anchor that no longer exists in PLAN fails. Checks the
  constants block (required keys, PLAN-fixed values, distinct seeds) and the required statements.
  `--final` (for the F5 tag) also fails on open FILL slots. `--selftest` runs 9 mutations.
- `freeze-ledger.schema.json` + `freeze-ledger.json` (empty ledger: F1, F2, F3, F4, F4b, F5,
  F6, F7, F8, F9, F10 with canonical tags and "must precede" lists; F2 has slots for the sha256
  of both domains' docs and all seven briefs, the no-bound check result, each Domain's
  frozenClock, and a pre-filled shop-docs authorship note; F4b has the frame-spec path and the
  frame CallRecords hash slot; F9/F10 detail shapes).
- `check-ledger.ts` (+ `lib/ledger.ts`, `lib/git.ts`, `lib/mini-schema.ts`): schema; canonical
  list, order, tags and edges (an edge cannot be weakened); per recorded freeze: tag exists,
  `peeledCommit` is a commit (a tag-object sha fails) equal to `<tag>^{commit}`, tree hash, file
  sha256s read from the tagged commit, external refs verified in their local clone (`cat-file -t`
  must be `commit`, `<ref>^{commit}` must match), per-freeze required externals/files/details
  (F2: no-bound check must pass; F4b: frame spec validated against the schema and its hash
  equals `frameRecordsSha256`). Order: along F1→F2, F2→F4, F3→F5, F4→F4b, F4b→F5, F5→F6, F5→F8,
  F6→F7, F7→F9, F8→F9, F9→F10 the predecessor is recorded, a strict git ancestor and earlier in
  time. A canonical tag that exists without a record fails. `--selftest` builds toy repos
  (`lib/ledger-selftest.ts`, 16 cases).
- `build-registry.ts` + `registry-manifest.json` (+ `lib/registry.ts`, `lib/glob.ts`): git blob
  id (`sha1("blob <n>\0"+bytes)`) and sha256 of every registered path from the working tree,
  compared with `git ls-tree -r HEAD`; untracked/modified/deleted paths fail. Groups: prereg,
  plan, analysis (`paper/scripts/**`), fiks-frozen (repair prompt, repro generator, contracts,
  proxy), heldout (`packages/heldout/**`), arms (`packages/arms/FIDELITY.md`, `src/**`), judges
  (`packages/baselines/prompts/**`), frame, injector. Without `--dry-run` it writes
  `REGISTRY.json` (not committed; it is an F5 artifact); `--final` refuses while a required group
  is empty.
- `frame-spec.schema.json` (+ `lib/frame-spec.ts`): exactly the FrameSpec fields, all required,
  no others; `hash` = sha256 of the pre-F4b frame CallRecords; `crit = -1` when N_E < 217.
  Semantic checks: N_E = eligible entities, K = cells, every eligible input attributed,
  m = 3 iff N_E < 217. DET can validate its `frame-k` output with `checkFrameSpec` from
  `paper/prereg/lib/frame-spec.ts`.
- `DEVIATIONS.md` (empty log, PLAN §9.5 columns), `TUNING.md` (budgets: L1/COMP/REPRO-AGENT ≤ 10,
  four judge variants ≤ 5, fiks 0; fiks row with the current sha256 of `prompt.ts` and
  `generate.ts` at `c144b03` and the prior history), `A0-RECORD.template.md`,
  `K1-ADDENDUM.template.md`.
- Tests: `paper/prereg/test/*.test.ts` (34 tests), config `paper/prereg/vitest.config.ts`,
  types `paper/prereg/tsconfig.json`.

## Notes for the orchestrator and other streams

- Root `pnpm typecheck` and `pnpm test` do not cover `paper/**` (root tsconfig and vitest
  projects list only `packages/*` and `apps/*`). This stream's own commands are
  `pnpm exec tsc -p paper/prereg/tsconfig.json` and
  `pnpm exec vitest run --config paper/prereg/vitest.config.ts`. `pnpm lint` does cover it.
- Registered seeds are fixed now, before any frame enumeration (DET must pass
  `seed.frame.enumerate` = 2026102111 to `pnpm fiks enumerate --frame`) and before any analysis
  run (AN's sign-flip, BCa and cluster-bootstrap code should read these keys from PREREG.md).
- Paths assumed for the F2 entry: tracker docs `packages/vendor-tracker/docs/{openapi.json,
  tracker.md}` (DOM2 deliverable); brief paths are left `null` until BLIND lands them.
- If PLAN.md changes in a listed section, `check-prereg.ts` fails until Part II is re-copied
  (the assembler logic is the same as `lib/plan-blocks.ts` `sectionLines` plus heading demotion).
- `pnpm install` in this worktree rewrites `pnpm-lock.yaml` (main's lockfile predates the
  CORE-SEED packages `@fiks/domains`/`@fiks/interfaces`). Not committed: not an owned path.

## Acceptance evidence (round 1, HEAD after the code commit `ce78219`)

- SETUP: `node scripts/apply-dep-fragments.mjs` → "nothing to apply"; `pnpm install
  --no-frozen-lockfile` exit 0.
- `pnpm tsx paper/prereg/check-ledger.ts --selftest` → 16/16 as expected, "selftest PASS (16
  cases)", exit 0. Fails on: F1 tagged after F2 (not a strict ancestor), F3 on a side branch,
  F4b tagged after F5, F5 recorded while F4b is not, base-shop recorded as its tag object
  ("which is a tag object; record its peeled commit …"), a fiks tag object recorded as the peeled
  commit, F1 timestamp later than F2, a weakened edge, a tag without a record, a tree mismatch, a
  tampered brief hash, a failing no-bound check, an F4b hash mismatch. Passes on the correct order
  (all 11 recorded), the empty ledger and a partial F1–F4 ledger.
- `pnpm tsx paper/prereg/check-ledger.ts` (real empty ledger, this repo) → "check-ledger PASS (0 of
  11 freezes recorded)", exit 0.
- `pnpm tsx paper/prereg/build-registry.ts --dry-run` → "45/45 listed paths: computed blob id ==
  git ls-tree -r HEAD blob id", "build-registry --dry-run PASS (nothing written)", exit 0
  (heldout, arms, judges, frame, injector pending: those streams have not merged). Cross-check:
  the 45 entries of a registry written to the scratchpad equal `git ls-tree -r HEAD` (0
  mismatches); `git hash-object` agrees for `paper/prereg/PREREG.md` (5a1240ec…) and
  `packages/repair/src/prompt.ts` (6e91960e…).
- `pnpm tsx paper/prereg/check-prereg.ts` → "PLAN blocks checked verbatim: 451 (§3: 253, §4: 28,
  §9: 83, §13: 35, §5.5: 10, §5.7: 12, §8.2: 30)", all 17 rule classes ok (140 rules), 17
  constants, "check-prereg PASS", exit 0. `--selftest` → "selftest PASS (10 cases)". `--final` →
  FAIL with 13 open FILL slots, as intended before F4b/F5.
- `pnpm exec vitest run --config paper/prereg/vitest.config.ts` (under `with-lock suite`) → 4
  files, 34 tests passed.
- `pnpm typecheck` exit 0; `pnpm exec tsc -p paper/prereg/tsconfig.json` exit 0; `pnpm lint` exit 0
  ("Checked 159 files", no diagnostics).
- `git diff --name-only c144b03 HEAD`: only `paper/prereg/**` and this file.
