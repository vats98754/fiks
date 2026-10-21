# fiks paper: PLAN.md (pre-registration, round 7 = fixer round 4, final)

Planner, 2026-10-21; plan fixer (with a shell), 2026-10-21. Base design: `paper/design/design-narrow-rigor.md` (judge totals 23.5 vs 18.5 vs 13). Grafts from `design-reviewer-first.md` and `design-maximal-evidence.md` as recommended in `paper/design/judge-{hostile-reviewer,statistics,feasibility}.md`. The final-round findings (fixer round 4) are resolved in §0.0000; the round-6 findings (fixer round 3) in §0.000; the round-5 findings (fixer round 2) in §0.00; the round-4 critic items (must-fix and selected should-fix) in §0.0; the 10 round-3 critic items in §0.1. Round-2 critic items and round-1 judge must-fixes are kept (§0.2, §0.3). Build workstreams: `paper/WORKSTREAMS.json`, validated by `paper/scripts/check_workstreams.py`.

Notation. `[key]` = `paper/research/bibliography.json` key (VERIFIED or corrected entries only). `[verify: key]` = a source recorded in `paper/research/gap-g5-novelty-surfaces.sources.json` (or another research file) that is **not yet** in `bibliography.json` or `verify/g8-reverify.json` as VERIFIED; it may narrow our own claims but is never cited for a fact until two verifiers pass it (ORCHESTRATION rule 2). `[Cn]` = RESEARCH.md claim. `[SYN §x]` = `paper/research/SYNTHESIS.md`; a pointer to internal reasoning only, **never** support for an external fact (every external fact carries a key or `[verify: …]`). `[estimate]` = planning value, replaced by a measurement at a named checkpoint. `[verify]` = fact a builder confirms before use. `[design]` = a decision made here. No number in this file is a result of the new experiments; none exist yet.

**Python.** Every `python` command below runs in the analysis venv: `python3.12 -m venv paper/.venv && paper/.venv/bin/pip install -r paper/scripts/requirements.txt` (pins exact; stream AN). `PY=paper/.venv/bin/python`. Fixer recomputations in this round used `/Users/anvayvats/opt/miniconda3/bin/python3` (scipy available), written `$P` below.

**Power numbers and the reproduction check.** The round-3 planner had no shell; the round-4 fixer did.
- † = a value the round-2 critic re-ran with scipy or `eval_stats.py` and reported as reproducing.
- ‡ = a planner hand computation (exact binomial pmf recursion in log space, or the normal formulas below).
- ★ = recomputed by the round-4 or round-5 fixer with the shell command printed next to it (or in §9.6).
- §3.3 values are computed from the 3-decimal σ_d printed in the same row.
- Check rule (`power.py all --check`, stream AN; round 7: over exactly the 72 numbers of the §9.6 manifest):
  - A tagged number printed with d decimals passes iff |computed − printed| ≤ 0.5·10^−d.
  - "≥ v" and "≤ v" pass as inequalities.
  - Counts and critical values must match exactly.
  - Any mismatch is a PLAN erratum. The planner corrects PLAN.md before F5, and the PREREG tag stays blocked until the check passes.
- MDE (two-sided α, power 0.8): (z₁₋α/₂ + z₀.₈)·σ_d/√n (`eval_stats.py mde`).
- NI power at a true difference θ ≤ 0 (θ = 0 unless stated), one-sided α: Φ((δ + θ)√n/σ_d − z₁₋α).
- Harm power at effect Δ, two-sided α: Φ(Δ√n/σ_d − z₁₋α/₂).
- z₀.₉₈₇₅ = 2.2414★, z₀.₉₉₃₇₅ = 2.4977★, z₀.₈ = 0.8416 (`$P -c "from scipy.stats import norm;print(norm.ppf(1-.0125),norm.ppf(1-.00625))"`).

`PF="/Users/anvayvats/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/30ec47c0-4bbb-4711-85d7-569760cac2dd/ef7e729b-bc9c-44e1-9b2a-7a42d9a71991/skills/paper-forge"`

---

## 0. Resolution ledgers

### 0.0000 Final-round ledger (fixer round 4, 2026-10-21)

The earlier ledgers (§0.000–§0.3) stay resolved as listed. Where one of their rows is superseded here (the `rb-<id>` repo name in §0.000 Q3; "5 logged runs" in §0.0 S2), this ledger and the cited sections govern.

| # | Finding | Resolution | Where |
|---|---|---|---|
| MF1 | **Statistics.** H1's entity attribution hid FPs. `evaluate.ts` returns only the first failing element per invariant (range `:173-191`, notNull/nonEmpty `:192-213`, unique `:254-263`, freshness `:264-279`; checked this round). A second out-of-range entity on the same page stayed in N_E but never entered X, which biased H1 toward rejection | H1, D12 and the census are defined over **per-element verdicts**. VOCAB adds `EvalOptions.perElement` (default off, so live receipts are byte-identical). MON adds `replay-cli --per-element` (one DetectorVerdictRow per violating element, with `at` and `elementIndex`). DET's `frame-k` attributes by concrete element path. `h1_precision.py` refuses first-element-only rows. §3.1 now says "each violating element is attributed to its own entity". Acceptance (MON, DET with AN, AN): a page with ext-a $9, ext-b $50 and ext-c $5000 gives Z = 1 for ext-a and ext-c and exactly one input-level FP | §3.1, §4 D12, §7 P9/P20, §8.1 R2, §9.1, §10, Appendix; WORKSTREAMS VOCAB, MON, DET (+AN dependency), AN, CORE-SEED |
| MF2 | **Feasibility.** ARMS acceptance used DET outputs (the planted-FP D4 fixture and `.iv.json` sidecars), but ARMS does not depend on DET | ARMS generates its own `packages/arms/test/fixtures/D4-plantedfp.trace.json` (CORE harness + INJ D4 rule + a $9 extended product; committed; regenerated byte-identically). It hand-writes `<trace>.iv.json` sidecars for that trace and for D2, D3, D4 and TRK-DEV-1, derived from v1 control runs recorded in `SIDECARS.md`. INTEG asserts that DET's `record` + `freeze-trace` regenerate the same attributableProperties, ivProperties and ivExcluded, plus the planted trace's violated list and target | WORKSTREAMS ARMS, INTEG |
| MF3 | **Feasibility.** VOCAB's push to shop-mcp main would break `pnpm test` in every other in-flight stream (its pretest clones main; sync compares vendored files) | VOCAB pushes the re-vendor commit only to branch `fiks/revendor-f2` and the tag `base-shop`. The orchestrator fast-forwards shop-mcp main only at VOCAB's merge into fiks main. New global **merge discipline** (§7.1): after every merge, each open stream rebases onto fiks main and re-runs SETUP before verification, and stale PASSes do not count. `ensure-shop-mcp.mjs` (pretest) checks out the pinned ref of `shop-sync-ref.json`; tracker-mcp is pinned the same way (`tracker-sync-ref.json`). The checker rejects any "re-vendor commit on … main" | §5.1, §7 P19, §7.1, §8.0-3, §12 row 6; WORKSTREAMS VOCAB, DOM2, INTEG; `check_workstreams.py` rule 12 |
| MF4 | **Feasibility.** A0(b) (tracker contracts, shop-blind sensitivity, LLM-authored × 3 seeds × 2 domains) had no owning deliverable | BLIND: `pnpm fiks author --kind contract --domain <d> [--protocol tracker\|shop-blind\|llm --seed n] [--out-root]`. The stub-llm acceptance checks: session cwd = the contract-author export; exactly 30 calls (llm: tool descriptions + 20 S-dev records); output validated by VOCAB's schema and evaluator; written to the reserved path with an AUTHORING log; invalid output writes nothing | §8.1 A0; WORKSTREAMS BLIND |
| S1 | Trigger-check asymmetry was misstated ("IV is at least as strict") | Corrected in §3.0. FIKS's P checks all properties except violated ∖ target. IV checks ivProperties. IV is stricter on the frozen call's non-target attributable properties, so H3a/H4a are biased **against** FIKS (conservative) and H3b/H4b are nearly unaffected. Stated in §3.3 and §3.5 (new reading row) and §10. E1 counts the attempts stopped only by a non-target property | §3.0, §3.3, §3.5, §4 E1, §10 |
| S2 | Frozen-trace target | `freeze-trace` keeps the full receipt `violated` list and sets `target` = [first attributable property] (the product's `target`/`outOfScope` semantics). FIKS-parity acceptance on the planted D4 trace: the F reason names countMatchesTotal only, and P passes on the D4.patch head despite the $9 item (DET). INTEG repeats it through the FIKS arm and fiks-iv | §3.0, §7 P20, Appendix; WORKSTREAMS DET, INTEG, CORE-SEED |
| S3 | Prior fiks tuning history was understated (5 runs) | 10 repair PRs: #1–#5 and #7–#11 (#5 closed as a duplicate; #6 is the harness PR; #1–#5 predate commit 8c7daa8 of the prompt files; 5 runs are in the loop log; checked with `gh pr list` and `git log`). Repair comparators now get ≤ 10 logged dev iterations; judges stay at ≤ 5 | §5.2 item 5, §10 |
| S4 | R1 worker set | {1, 2, 4, 6} (6 = machine cap of about 6 agents) | §8.1 R1, §8.2; WORKSTREAMS LLMR |
| S5 | Missing G5 prior art | Lemma (YC F25) and BentoLabs (YC Sp26) added as `[verify]` | §1, §11, §12 row 2 |
| S6 | RBX cloned a non-existent `vats98754/rb-<id>` | `ensure-realbugs.mjs` clones `pins.json` `repo` (the 5 real names). RB-* pins carry it; a missing repo field or a non-vats98754 owner exits 2 | §5.10; WORKSTREAMS RBX, RB-* |
| S7 | RUN acceptance used `pnpm exp`, which INTEG adds | RUN uses `pnpm tsx packages/exp/src/main.ts`. The checker rejects `pnpm exp <run>` in any pre-INTEG acceptance | WORKSTREAMS RUN; checker |
| S8 | SETUP lacked `ensure-shop-mcp` | Added to ORCH, ARMS and HOLD, and (by a new checker rule for every stream that uses shop-mcp refs) to VOCAB, SBX, DET and BLIND | WORKSTREAMS; checker |
| S9 | fiks-tools source commit | Built from the latest merged main and rebuilt after each merge. A stream's own unmerged code uses a test-only `--ref HEAD --apply-fragments` image. Runs use the frozen commit's image | §7 P1, §7.1; WORKSTREAMS SBX, ARMS |
| S10 | HOLD asserted every P1–P8 dev patch is incorrect | The P1–P8 fixture patches are hand-written and committed, with expected GradeRecords. Only P3 → renamed-id and P1 on D1 are asserted incorrect; the other classes come from the grade | WORKSTREAMS HOLD |
| S11 | E6 and E11 named no test | E6: one paired mid-p McNemar (raw vs strict, over template × carrier pairs); everything else descriptive. E11: exact paired sign-flip on per-drift wrong-answer differences; the rest descriptive | §4 |
| S12 | INTEG clean clone needed a GitHub remote | Clones from the local path `/Users/anvayvats/fiks` (also RBA) | §7.1, §12; WORKSTREAMS INTEG, RBA |
| S13 | D10 had no producing run | New post-CP2 product-mode run **R11** (RUN; 2 PRs against `showcase/<driftId>` branches; approval §8.0-3); if it does not run, D10 is cut | §4 D10, §8.0, §8.1, §8.2, §13; WORKSTREAMS RUN |
| S14 | It was unclear which numbers `power.py` checks | §9.6 **power check manifest**: exactly 72 numbers, all re-run with scipy this round, all reproduced. Build/cost/schedule ★ are excluded and named. AN encodes it as `power_manifest.json` and adds `floor` | preamble, §9.1, §9.6; WORKSTREAMS AN |

Build-size effect (★): est_hours 558 → 574 (+16: VOCAB +2, MON +2, SBX +1, AN +1, ARMS +2, DET +1, BLIND +3, HOLD +2, RUN +1, INTEG +1). Critical path to INTEG 99 h, 103 h to RBA. Schedule to INTEG: 162 h with 4 builders, 117 h with 6 (`python3 paper/scripts/check_workstreams.py paper/WORKSTREAMS.json --builders 4 --until INTEG`, and the same with `--builders 6`).

### 0.000 Round-6 findings (fixer round 3)

The round-4 critic items stay resolved as listed in §0.0 (must-fix M1–M10; should-fix S1–S15: NI margin rationale and NI power at θ = −0.03/−0.05, direction guards, tuning asymmetry, construction-coupled mutant labels, keys or `[verify]` instead of SYN pointers, builder OAuth cap and no live-run/swarm overlap, cached R5 base checks, non-Claude wall-clock in the fit, base-owner P5 check with plain clones, the AN venv, the ORCH trace fixture, the CORE-SEED node, run outputs under `paper/results/raw/**` committed only by run steps). Each was re-checked against the current text and WORKSTREAMS in this round. Only the builder-hours and schedule numbers changed (§7.1, ★).

| # | Finding | Resolution | Where |
|---|---|---|---|
| Q1 | Detection and the frozen trace need not be caused by the drift. With a 50-entity extended sample per drift, P(≥ 1 FP entity) ≈ 0.636 at π = 0.02 and 0.395 at π = 0.01★ (`python3 -c "print(round(1-0.98**50,3), round(1-0.99**50,3))"`). An FP on another property of the frozen call made IV unpassable for L1/COMP | **v1 controls + drift attribution.** `record --drift/--benign` replays every EnumRow a second time on a fresh vendor with the same base, frozen clock and no injector rule (for mutants the unmutated record is the control). A violation is **drift-attributable** iff that property verifies on the control. Detected, freeze-trace and the top-up rule use attributable violations only. IV evaluates only **ivProperties** = the triggering tool's properties that verify on the frozen call's control (DET sidecar `<trace>.iv.json`, hash in F9). Non-attributable violations on drift traffic are an E3/D12 row. DET acceptance plants a $9 extended product ahead of the drift-caused call; ARMS shows IV passes the D4 oracle head only with the restriction. The extended sample stays | §3.0, §4 E3/D12, §5.1, §5.7, §6.2, §7 P20/P21, §9.4, Appendix; WORKSTREAMS DET, ARMS, CORE-SEED |
| Q2 | H1 verdicts depend on when R2 runs (freshness uses `input.now`, `packages/contracts/src/evaluate.ts:264-268`; live `now` is the wall clock, `packages/proxy/src/proxy.ts:120,197`) | **`now := capturedAt`.** Each Domain has a constant `frozenClock` committed before F2. Every record run uses it for the vendor *and* the proxy (`ProxyOptions.now`), so the proxy's existing `CallRecord.at` (proxy.ts:216) is the evaluation instant, carried as `capturedAt`. Every offline evaluation (R2 on F, E3, D1, mutants, H1 sensitivity) uses `now := capturedAt`; MON `replay-cli` never reads the system clock and refuses a record without it. MON and DET acceptance: a +400-day system-clock shift gives byte-identical verdicts | §3.1, §4 D1, §5.2 F2, §7 P9/P20, Appendix; WORKSTREAMS CORE, MON, DET, DOM2 |
| Q3 | Clones of external repos inside the tracked tree (`realbugs/<id>/repo` becomes an uncommittable gitlink; biome lints it); no tracker-mcp clone step | All external clones live under the already-ignored `.work/` (`.gitignore` and `biome.json` both exclude it; checked). RBX owns `scripts/ensure-realbugs.mjs` (clones `vats98754/rb-<id>` to `.work/realbugs/<id>`, local tags `prefix`/`fix` from `pins.json`); DOM2 owns `scripts/ensure-tracker-mcp.mjs` (`.work/tracker-mcp`), run by INTEG's pretest. Fresh-worktree acceptance in RB-*, RBA, ORCH, DOM2 and INTEG. `check_workstreams.py` now rejects any `realbugs/<id>/repo` path and any owned `.work/` glob | §5.10, §7 P22; WORKSTREAMS RBX, DOM2, RB-*, RBA, ORCH, INTEG |
| Q4 | A0's registered `disabled: true` response had no evaluator support and no owner | VOCAB adds `disabled` handling before F2 (skipped, listed under `receipt.disabled[]`, `reenable` option passed by MON `replay-cli --reenable`), shipped in the `base-shop` re-vendor commit, and owns `scripts/contract-disable.mjs` (changes only the listed ids; D11 log line). ORCH acceptance re-vendors a disabled property into a tracker-mcp clone through `seed-tag` with green CI | §5.2 F2, §7 P15, §8.1 A0, §9.5; WORKSTREAMS VOCAB, MON, ORCH |
| Q5 | Re-record ran candidate code on the host (harness spawns the head with `getDefaultEnvironment()`, `packages/cli/src/harness.ts:96`; HOME and `.env` reachable; full network) | SBX builds a Linux **fiks-tools** image (`git archive` of the fiks commit, so no `.env`; Linux `node_modules`), mounted read-only at `/opt/fiks`. `rerecord-head` and every replay-based check run inside the per-attempt container (`--network none`, env {PATH, CI=1, HOME=/tmp, FIKS_DIR, FIKS_IN_SANDBOX=1}); CORE's `--require-sandbox` exits 2 on the host. ORCH's `rerecord-containment.test.ts` plants a head that reads `~/fiks/.env` and `$HOME` and tries egress; it must get neither and log the denial (INTEG repeats it through L1, COMP and HOLD). RUN runs it as a preflight: **R1 and R3–R8 (R7 in particular) do not start until it passes** | §7 P1/P23, §8.1, §10; WORKSTREAMS SBX, CORE, ORCH, ARMS, HOLD, RUN, RBA, INTEG |
| Q6 | The D4 stub oracle `88ed791` fails `git apply --check` on `seed-v1` at `src/tools/search_products.ts:38` (verified this round in a detached `seed-v1^{commit}` worktree of `.work/shop-mcp`: `git show <c> -- src > p.diff && git apply --check p.diff` fails for 88ed791, whose parent 0d0d3b5 already carries the D1 conversion, and passes for 7c5f4ea; `git apply --check packages/cli/test/oracles/D<n>.patch` passes for n = 1..5) | ORCH, ARMS, HOLD (ref A of D1–D5) and RUN's dry fixtures use `packages/cli/test/oracles/D<n>.patch` on `seed-v1`. The whole commits stay only in CORE's `rerecord-head` test. `check_workstreams.py` rejects "oracle src diff" / "ref A = the shop-mcp fix commits" | WORKSTREAMS ORCH, ARMS, HOLD, RUN, INTEG |
| Q7 | CORE-SEED's `*.test-d.ts` acceptance cannot run (vitest 5.0.3 includes `*.test-d.ts` only under `typecheck.include`) | Renamed `domain-hooks.test.ts`, which spawns `tsc --noEmit` over a compiling fixture and a fixture whose omissions carry `@ts-expect-error`, plus a stripped negative control. The checker rejects a `*.test-d.ts` run without `--typecheck` | WORKSTREAMS CORE-SEED |
| G5 | Novelty and threat model | Two more `[verify]` trigger-side sources from G5 (Visa TDCommons 10178, TDCommons 12336) narrow component (1); GitInject and LivePI join SWExploit/CapScope in the threat model as `[verify]` background | §1, §10, §12 row 2 |

Build-size effect (★): est_hours 531 → 558 (+27: CORE +2, VOCAB +3, MON +1, SBX +4, DOM2 +1, RBX +2, ORCH +4, ARMS +2, DET +4, HOLD +1, RUN +1, RBA +1, INTEG +1). Critical path to INTEG 96 h, 101 h to RBA; schedule to INTEG 157 h with 4 builders, 113 h with 6 (§7.1 has the commands) (superseded in round 7: 574, 99/103 h, 162/117 h, §0.0000).

### 0.00 Round-5 findings (fixer round 2)

The round-4 must-fix and should-fix items stay resolved as in §0.0. Their numbers were re-run in this round and reproduce: 0.82054, the θ table, n = 244 and the π0 scan (commands in §0.0, §3.1, §3.3).

| # | Finding | Resolution | Where |
|---|---|---|---|
| N1 | Repair arms lack re-record parity (H3/H4 confound on request-changing drifts) | **One rule for every arm.** CORE `rerecord-head` (one `rerecord()` code path, the drift's profile through its injector chain) runs on the candidate head before **every** replay-based check: P, IV, suite fixtures, stored traces and local CI, including every L1 session gate and every COMP revision. The `RerecordLog` is stored per attempt. ORCH, ARMS and INTEG acceptance on the D3/D4 oracle patches: L1 is exposed with IV pass and green CI; COMP's `ciFinal` is green with no `UNMATCHED_REQUEST`; the logs are identical to FIKS's. H3/H4 are also reported per drift class (request-changing vs other) | §3.0, §3.3, §3.4, §6.2, §7 P21/P23, WORKSTREAMS CORE, ORCH, ARMS, INTEG |
| N2 | The H2 re-record rule does not reach the agent test's recording | (a) The REPRO-AGENT task text requires the test to load its recording from `.alerts/<id>.json` through the replay helper. `accept()` re-records an overlay copy of every recording any T file reads, under the fiks profile. Inline recordings count as they behave and are flagged. (b) HOLD acceptance on the D3/D4 oracle patches with an agent-style test that reads `.alerts/<id>.json`. (c) H2 sensitivity row **s3** excludes request-changing drifts | §3.2, §5.5, WORKSTREAMS HOLD, ARMS, AN |
| N3 | RBA cannot be built within its ownership | **Domain hooks** `reproEmitter`, `suite` (command + scope; exactly one failing test inside the scope) and `allowedEditPaths` are declared in CORE-SEED and wired by CORE into repro/gate, with shop defaults byte-identical to ec241bc (unit test against an ec241bc worktree). SAFE takes the edit allow-list as a parameter; ARMS gains `--domain`. RBA implements the hooks from `adapter.json` (testRunner, suiteScope, allowedEditPaths, written by RB-*) and touches no CORE file | §7 P8/P22, Appendix, WORKSTREAMS CORE-SEED, CORE, SAFE, ARMS, RBA, RB-* |
| N4 | Tracker arms have no owner acceptance | ARMS `--domain` (default: the trace's domain; DOM2 dependency added). DOM2 ships TRK-DEV-1 as a full dev DriftPackage on a dev-only tag `dev-tracker-stub` with a dev-only stub contract. Acceptance on TRK-DEV-1: ARMS arms + fiks-iv, ORCH `--arm fiks --domain tracker`, HOLD grade/accept. TRK-DEV-1 is in INTEG's dry run | §5.1, WORKSTREAMS DOM2, ARMS, ORCH, HOLD, INTEG |
| N5 | INTEG's dry run is not executable | RUN delivers and tests `--dry` (stub agents via SAFE's stub runner and `--agent-stub`; `FIKS_LLM_FORBID=1`, so no LLM call is possible; the only mode exempt from the build-swarm guard), `--dev`, `--drifts`, `--models` and `--attempts`. HOLD ships DEV-X1's hidden tests and refs; DOM2 ships TRK-DEV-1's | §7.1, WORKSTREAMS RUN, SAFE, LLMR, HOLD, DOM2, INTEG |
| N6 | FIKS+CU has no deliverable | ORCH `--arm fiks+cu` assembles CU's inputs: the frozen and stored traces, the clean v1 corpus, and MUT variants of the trigger (MUT dependency added). Stub-agent acceptance: an accepted benign delta writes a proposal and emits no `would_open_pr`; a delta that silences D1 is rejected and the attempt falls back to code repair | §6.2, §8.1 R6, WORKSTREAMS ORCH |
| N7 | DET offline = live equality fails for postconditions | The equality is restricted to non-postcondition properties. Under `--monitor none` no read-back probe is recorded (the proxy derives probes from `contract.postconditions`, `packages/proxy/src/proxy.ts:183-194`), so readAfterWrite is `unverifiable` offline (asserted). It is truth-entailed, so H1 is unaffected; §3.1 says it is not evaluated on F | §3.1, WORKSTREAMS DET |
| N8 | CORE-SEED diff check against ec241bc fails by construction | Uses `<branch base>` like every other stream. `check_workstreams.py` now rejects any acceptance item that diffs against a fixed sha, any `[LIVE]` item that bypasses `live-lock.ts`, and any PLAN run component (e.g. `FIKS+CU`, `rerecord-head`, `--dry`) that is in no stream's deliverables | WORKSTREAMS CORE-SEED, `paper/scripts/check_workstreams.py` |

Build-size effect (★): est_hours 496 → 531 (superseded in round 6: 558; paths 96/101 h; schedule 157/113 h, §0.000). Critical path to INTEG is 91 h, and 96 h to RBA. The schedule to INTEG is 152 h with 4 builders and 108 h with 6 (§7.1 has the commands).

### 0.0 Round-4 critic items (fixer round 1)

Must-fix (both critics):

| # | Item | Resolution | Where |
|---|---|---|---|
| M1 | Power erratum: 0.822 at N_E = 1,500 | Exact value 0.82054★ → printed **0.821** in §0.1, §3.1 and §9.6. Command: `$P -c "from scipy.stats import binom as B;print(B.cdf(18,1500,.01))"` → 0.8205381938 | §0.1, §3.1, §9.6 |
| M2 | H3a/H4a lack a direction guard | H3a/H4a falsified if mean d_i ≤ 0 (as H2). AN unit test: a significant opposite-direction result is never "rejected" | §3.3, §3.4, WORKSTREAMS AN |
| M3 | H2 accept rule silent on fixes that change upstream requests (D3/D4-like) | One pre-registered rule: `accept()` re-records through the drift's injector chain **for every test set** (fiks, agent-final, agent-first, ∅) before evaluating the patch. HOLD acceptance on D3/D4 oracle patches | §3.2, WORKSTREAMS HOLD |
| M4 | H1 shop arm: wrong risk text; docs and catalog brief unfrozen before A0 | Risk text corrected (order `total.range` has min 0.5 and no max, so it is vacuous on the upper side; the only live shop FP channel is `price.range` ∈ [20, 2000]). Shop docs and the catalog brief are frozen with hashes at **F2** (before A0), with a mechanical no-bound check; authorship of the shop prose docs is recorded | §3.1, §5.2, WORKSTREAMS CORE, BLIND |
| M5 | E4 and E7 name no paired test | E4: exact paired sign-flip on per-case rates (+ mid-p McNemar on first attempts). E7: descriptive per-bug case comparisons, no comparative claim, Wilson CI on every rate | §4 |
| M6 | R8/E7 components unowned | New wave-3 stream **RBA** (real-bug adapter: Domain per bug, `fiks repair`/`fiks arm` dispatch on `realbugs/<id>/repo` (round 6: moved to the `.work/realbugs/<id>` clone, §0.000 Q3), grading of heads against human-fix tests and `heldout/`). ARMS adds an **ISSUE-TEXT** arm. R8 is gated on RBA PASS | §5.10, §6.2, WORKSTREAMS RBA, ARMS |
| M7 | R7/E6 components unowned | (a) "same 240 on the current loop in a disposable container" is **cut** (it would put the OAuth token in a container running the unhardened loop); (b) the adaptive attacker is owned by SEC; (c) strict-vs-raw utility needs only `--trace-format` pass-through, owned by ORCH and ARMS. R7 recounted | §4 E6, §8.1 R7, §13, WORKSTREAMS SEC, ORCH, ARMS |
| M8 | CORE help snapshot has no reference | `help()` returns that command's line(s) of the ec241bc `USAGE` string, byte-identical; a separate behavioural snapshot checks flags and output of the deterministic legacy commands | WORKSTREAMS CORE |
| M9 | CORE/ARMS D2 trace path points at a repair record | `.fiks/traces/tr_079b90c89e.json` (gitignored; sha256 b6baf03e…4d15★, `shasum -a 256 .fiks/traces/tr_079b90c89e.json`) is committed as `packages/cli/test/core/fixtures/D2-trace.json`; CORE and ARMS use it | WORKSTREAMS CORE, ARMS |
| M10 | H1 frame needs tool outputs at F4b | New pre-F4b step `pnpm fiks record --frame --monitor none` (outputs + `truth()` comparison, no contract evaluation) on server ref `base-shop` / `seed-tracker-v1`; `frame-k` consumes it; R2 computes verdicts by offline replay of exactly these hashed records | §3.1, §5.7, §8.1, WORKSTREAMS DET |

Should-fix taken:

| # | Item | Resolution | Where |
|---|---|---|---|
| S1 | NI margin rationale; power only at favourable truths | δ = 0.10 rationale and relative loss stated; NI power at θ = −0.03/−0.05 and harm power at Δ = 0.05 printed (all ★) | §3.3 |
| S2 | Tuning asymmetry | fiks frozen with 0 further iterations; prior tuning history reported quantitatively; every comparator gets a matched, logged dev budget | §5.2 item 5, §10 |
| S3 | Mutant recall is construction-coupled | Labelled so; Figure 2 leads with blind and evasive strata | §4 E3 |
| S4 | SYN pointers instead of keys | Keys or `[verify: …]` everywhere a fact is cited; G5 sources marked `[verify]` (none is in `bibliography.json`/`g8-reverify.json`) | throughout, §1, §11, §12 |
| S5 | Builder OAuth budget | ≤ 6 concurrent agents (≤ 4 builders + ≤ 2 verifiers); live-LLM acceptance items serial under one lock; no live run overlaps a builder swarm | §7.1, §8.2 |
| S6 | R5 grading under-counted | 13 test sets per pool patch; base checks cached per patch; R5 re-estimated (★) and re-measured at R0 | §8.1 R5 |
| S7 | Non-Claude wall-clock missing | R0/R5 and Docker memory included in the K1 fit; R4 at c = 1 stated as expected to cut | §8.2 |
| S8 | P5 allow-list | Checks the **base** repository owner; real-bug work uses plain clones pushed to new private vats98754 repos, never GitHub forks; reserve repos assigned | §5.10, §7 P5, §8.0, WORKSTREAMS SAFE, RB-* |
| S9 | AN environment | `python3.12 -m venv paper/.venv` + pinned requirements; every script command uses the venv | preamble, §9, WORKSTREAMS AN |
| S10 | ORCH trace fixture | ORCH's test generates the DEV-X1 trace with CORE harness + INJ middleware + the existing trace-store under a frozen clock and commits it; the live D2 repair item requires all final gates green, ≤ 2 retries | WORKSTREAMS ORCH |
| S11 | DAG bookkeeping | `CORE-SEED` node (wave 0); critical path and schedule recomputed (★) | §7.1, WORKSTREAMS |
| S12 | Run outputs vs AN ownership | `paper/results/raw/**` and `paper/results/confirmatory.lock` are written and committed only by run steps; builder tests write to `$TMPDIR` | §7.1, WORKSTREAMS AN, LLMR, DET |
| S13 | Builder-hours total | Recomputed from WORKSTREAMS (★) | §7.1 |
| S14 | Wording; patch-pool labels | "would be exposed"; "false-alarm rate"; LLM rater labelled; pool class labels come from the oracle grade only | §1, §2, §5.6, D6 |
| S15 | G5 novelty findings | Novelty statement narrowed; G5 prior art added (marked `[verify]`); SWExploit and CapScope added to the threat model | §1, §10, §11 |

### 0.1 Round-3 critic items

| # | Item | Resolution | Where |
|---|---|---|---|
| 1 | H1(a) wrong unit; i.i.d. binomial over clustered inputs | **One inferential target.** The random element is the set of extended-catalog entities drawn by the blind catalog author. H1's only test is an exact binomial on the per-entity indicator Z_e ("any FP attributed to entity e on any FP-eligible frame input"). Each entity counts once however many inputs, tools or properties it fires, so the search/get/order correlation is absorbed. The input share (old (a)) becomes a **census condition** (< 1%, no p-value). The cell share (old (b)) becomes descriptive, counted per FP source = (origin unit × property family). Batch-cluster bootstrap by authoring batch is the pre-registered robustness check [field2007clusterboot]. To make the test informative the catalog grows to ≥ 750 eligible entities per domain. Power: N_E = 1,500, π0 = 0.02 ⇒ crit 18, power 0.821★ at π = 0.01 (round-4 erratum; was 0.822). | §3.1 |
| 2 | H1(b) can have power 0; q0 rule incomplete | (b) is no longer inferential, so K needs no minimum and the q0 rule is deleted. An outcome-free rule for **N_E** applies at F4b: (i) top up the catalog before F4b if N_E < 1,500; (ii) else test at the realised N_E with power restated, flagged underpowered if power at π = 0.01 is < 0.50; (iii) if N_E < 217 (the exact test cannot reject), H1 becomes descriptive and Holm runs over m = 3. | §3.1 |
| 3 | L1 lacks the trigger check that FIKS and COMP have | L1 gets **pre-PR issue validation (IV)**: the frozen trace is replayed on the candidate head through the same frozen contracts via SBX `ciLocal` extraChecks. A failure is fed back, as gate failures are. FIKS − L1 now isolates the artifact: the fail-first proof plus a named-property test the agent sees from the start and that is committed. The old L1 becomes exploratory rung **L1-noIV** (E1) and cut step 4. | §3.0, §3.3, §6.2, §13 |
| 4 | H2 baseline weaker than standard practice | The primary REPRO-AGENT gets the **same F check with feedback**: its test must fail on base (assertion failure, no load or compile error, 3/3 runs). Otherwise it receives a fixed feedback message and retries within 1 session / 30 turns / ≤ 3 F rounds. F→P filtering is an established validity filter for repro tests [mundler2024swtbench] (there any thrown error counts as a failure; our F check requires an assertion failure, which is stricter) and is fiks's own gate. The first, unfiltered test is a sensitivity row. **If the fiks repro fails its own F gate on a drift, it counts as it behaves** (if no test was emitted, T = ∅), exactly as agent tests do. | §3.2, §5.5, §6.2 |
| 5 | Tracker Domain registration in the wrong wave | The tracker Domain object moves to `packages/vendor-tracker/src/domain.ts` and its registration to `packages/cli/src/bootstrap/10-tracker.ts`, both owned by **DOM2 (wave 1)**. The registry (`packages/domains/src/registry.ts`) is in CORE's seed commit, merged before wave-1 builders branch. DET and TRAFFIC (wave 2) find `--domain tracker` working once CORE and DOM2 are merged. ORCH keeps only `bootstrap/20-sandbox.ts` and `30-injector.ts`. | WORKSTREAMS CORE, DOM2, ORCH |
| 6 | Workspace dependency seam | **Dependency fragments.** A stream that imports a workspace package from a package it does not own writes `deps-fragments/<ID>.json`, which it owns. Entries are only `@fiks/*: workspace:*` (plus a root tsconfig reference if the workspace uses them [verify]). CORE's seed commit ships `scripts/apply-dep-fragments.mjs` (idempotent, rejects anything else, `--check`). In a stream's worktree the SETUP step applies fragments locally; those package.json and lockfile edits are not committed. At each merge the orchestrator applies the merged fragment to `packages/cli/package.json` / `packages/domains/package.json` and regenerates the lockfile, mechanically, on CORE's and INTEG's behalf. INTEG checks `--check`. | §7.1, WORKSTREAMS |
| 7 | Power-check tolerance cannot pass | Every §3.3 value is restated to 3 decimals (MDEs to 4) from the critic's recomputation and the planner's check. `--check` compares at the stated precision and treats inequalities as inequalities (rule above). The H1 binomial table is replaced by the entity test numbers. | preamble, §3, §9.6 |
| 8 | Cut order not monotone in projected usage | R10 (E11), B-OM and ollama traffic leave the K1 walk. R10 runs only after CP2 if caps remain and is never projected. B-OM is an unconditional cut. Ollama traffic has its own wall-clock rule set at T0. Every remaining step removes positive projected Claude usage, so RUN's monotonicity acceptance holds by construction. | §8.2, §13 |
| 9 | `rev-parse seed-v1` returns the tag object | Every ref check, `shop-sync-ref.json`, the freeze ledger and `createWorktree` use `<ref>^{commit}`. | §5.1, VOCAB, CORE |
| 10 | CORE help snapshot breaks at integration | The snapshot test invokes each `legacy/<name>.ts` adapter's help directly. The CLI-level `pnpm fiks <cmd> --help` snapshot is asserted only for commands with no default-export module in `commands/`, computed at test time. | WORKSTREAMS CORE |

### 0.2 Round-2 critic items (kept; changed rows noted)

1. **Leakage.** F is enumerated on the blind-extended catalog only. S-dev is reported separately (D11). A0 is record-only.
2. **FP capability.** `fpCapability()` (frozen at F2) defines eligible inputs and entities. The cell endpoint is descriptive (round-3 item 1).
3. **Evidence.** Raw traces for every confirmatory arm. Strict format is used only in E6.
4. **COMP.** COMP has post-PR issue validation [langsmith-changelog-2026]. COMP-norep is an exploratory rung.
5. **σ_d model.** a = 4. Joint IUT power is stated per configuration.
6. **Wording.** Non-rejection is never read as evidence of no effect.
7. **`correct_pr`.** Requires an exposed PR, green final CI and held-out correctness.
8. **DET.** Owns record, freeze-trace and frame-k.
9. **Re-vendor.** One VOCAB re-vendor commit, `base-shop`, and a pinned sync ref.
10. **Worktrees.** Created from local refs with no fetch. `DriftPackage.base` is required.
11. **simulate_null.** Exact tests checked against their analytic size.
12. **Cut order.** Superseded by round-3 item 8.
13. **Throughput.** T0 runs before A0/A1. A1 has cap-stop and a ceiling.
14. **CLI loader.** `bootstrap/*.ts` then `commands/*.ts`.
15. **Exports.** Author exports are leak-free.

### 0.3 Round-1 judge must-fixes (kept)

- **Oracle and differential.** Contracts are kept out of the oracle (criterion 5 is `truth()`; static import check). A robust two-reference semantic differential.
- **Patch pool.** Arm-independent, frozen before R3/R4.
- **Containment.** Host-side `realpath` read guard and sandboxed Bash (P1, P2).
- **Reporting and statistics.**
  - Circularity reported per domain and per contract provenance.
  - One NI rule (shifted sign-flip; one pre-declared fallback).
  - K1 discipline.
  - Differential-infra sensitivity.
  - Frozen enumerations.
  - Harm endpoint = green-incorrect PR.
  - Detection-count top-up rule.
- **COMP parameters** attributed or owned.
- **Run infrastructure.**
  - OAuth throughput gate (T0 + R1).
  - Local CI with a zero-push shim; Linux sandbox image.
  - RunKey isolation; candidate capture at every gate.
  - Injector-aware re-record.
  - LLM route via Agent SDK `query`.
  - Memory schedule.
- **Static analysis.** Semgrep CE + eslint-plugin-security + an AST detector (CodeQL dropped).
- **Authoring and code layout.** Physical author exports; split spine.

---

## 1. Thesis and contributions

**Thesis.** The setting: a per-call outcome-contract violation on a *successful* tool result is compiled into a named-property, fail-first reproduction test. The coding agent sees that test from the start. The test gates the pull request together with the contract suite, stored traces, typecheck/lint and local CI. Under that setup, fewer green-but-incorrect fix PRs would be exposed to maintainers, with a correct-PR loss not exceeding 0.10 (absolute; §3.3 states the relative loss and the rationale), than with either comparator:
- (a) **L1**: the same agent with the same raw trace, replay helper and gates, *including a pre-PR replay of the triggering trace through the same contracts*, but no repro test;
- (b) **COMP**: the strongest documented composition, "monitor → alert → coding agent → PR → CI with source-run replay".

Scope stated in the abstract: two mock vendor domains with blind-authored drifts, four TypeScript real-bug case studies, commercial products emulated from their docs (not run), one model family for repair.

Prior art, said so (verified keys):
- The invariant vocabulary [tfdv-2019] [gx-core-expectations].
- Per-call output contracts and receipts [panthi2026outcomemonitors] [C11].
- Alert → coding agent → PR with CI iteration [devin-automations] [cursor-automations] [sentry-seer-issue-fix] [posthog-anatomy-pr].
- CI watching, revision limits and source-run replay against a fix preview, plus post-merge recurrence charts [langsmith-changelog-2026] [cleric-verifying-fixes].
- Statistical silent-drift detection → patch → deploy [awan2026aegisflow].
- Recorded interactions as an oracle [monce2025gilesi] [hoverfly-modes].

Prior art found by the G5 sweep (2026-10-21; `paper/research/gap-g5-novelty-surfaces.md`). None of these is yet in `bibliography.json` or `g8-reverify.json`, so each is `[verify]`: it narrows our claim now and is cited only after two verifiers pass it (§12 row 2).
- Error/incident-triggered LLM repair with a PR that carries a software test is **patented** [verify: msft-us12711009] (US 12,711,009 B2, granted Aug 2026; trigger = detected failure, no fail-first or pre-PR gate claimed). So "auto-PR with a test from a runtime failure" is not new.
- Contract-deviation-triggered regeneration of integration code, tested and auto-deployed without human review, is marketed [verify: d3-morpheus-selfhealing] (no PR, no repro test, mechanics undocumented).
- Baseline-deviation detection of silent regressions → fix PR is claimed by a YC W25 startup [verify: exla-yc-w25] (no gates documented).
- Per-call postcondition verification at the agent–tool boundary is published [verify: mansoor2026verifiedtoolcalls] (arXiv 2608.02645; no tool repair), next to [panthi2026outcomemonitors].
- Validating a new version against mirrored production exchanges and generating tests from captured API exchanges are patented [verify: visa-us9983982] [verify: zoom-us12483491].
- Two YC startups found by G5 (rows 12–13 of `gap-g5-novelty-surfaces.md`; final round) sit on the trigger side and fix the *agent*, not the tool: auditing agent traces against the agent's instructions, including invented ids on tool calls that returned success, and handing the fix to the user's coding agent, with an online eval after the fix [verify: lemma-yc-f25] (Lemma, YC F25); and agent-drift detection against "tool contracts" with a suggested prompt, skill or harness fix [verify: bentolabs-yc-s26] (BentoLabs AI, YC Sp26; method undocumented). Neither documents a fail-first repro or a pre-PR gate on tool code.
- Learned per-endpoint invariants over production exchanges with drift alerts [verify: visa-tdcommons-2026] (body unread, 403), and an inferred data contract whose violating records an LLM repairs before a deterministic validator re-checks them [verify: tdcommons-12336], are defensive publications (round 6). So a contract/invariant trigger on successful traffic is not new on its own either; component (1) below is claimed only for per-call MCP/tool results with read-after-write postconditions, and only in combination with (2).

**Narrowed novelty statement (dated 2026-10-21; patent search partial: WebSearch + 9 USPTO full texts; Google Patents full text, Espacenet and Patentscope not searched; TDCommons defensive publications seen only as snippets or 403; YC scan keyword-based over a third-party mirror, so listed-but-unopened companies are not covered).** We claim only the *combination*: (1) the trigger is a deterministic contract violation in a **successful** tool/MCP result, checked per call against the raw upstream exchange (incl. read-after-write postconditions); and (2) a PR is exposed only after a fail-first, stated-reason, named-property reproduction test compiled from that exchange (no golden patch), the full contract suite, all stored traces, typecheck/lint and CI all pass; it never merges. Every component on its own is prior art. The paper's evidence is H1–H4 for that combination, not for any component. The paper never says "first"; it says "we found no system, paper, patent or defensive publication with both (1) and (2)" with the search limits above. Post-merge recurrence confirmation is also prior art [langsmith-changelog-2026] [cleric-verifying-fixes], so "Confirm" is not part of the claim.

| # | Contribution | Experiment | Evidence |
|---|---|---|---|
| 1 | A per-call trigger whose false-alarm rate on clean traffic is low enough to open PRs from (a specificity-type endpoint, not PR precision). The frame is pre-registered: ≥ 1,500 blind-authored catalog entities over two domains, outside all contract-development data. On it, fewer than 2% of new entities drawn by our catalog-author process give rise to any false positive (entity-level exact test), and < 1% of frame inputs are false positives (census condition). Coverage vs the §6.1 detectors is exploratory. | H1 (R2); D12; E3 | **Table 2**; **Figure 2** |
| 2 | The trace-derived named-property repro is a better test than one an agent writes, fail-first, from the same raw trace and replay helper: higher balanced accuracy over a fixed, arm-independent patch pool | H2 (R3, R5) | **Table 3**, **Figure 3** |
| 3 | A visible fail-first repro in the pre-PR gates gives fewer green-incorrect PRs and non-inferior correct PRs. Comparisons: vs the same gates plus a hidden trigger replay (H3), and vs the strongest composition (H4). Ladder: COMP-plain → COMP-norep → COMP → L1-noIV → L1 → FIKS. | H3, H4, E1 (R4, R5) | **Table 4**, **Figure 4** (paired forest plot), **Figure 1** (pipeline + arms), **Figure 5** (ladder) |
| 4 | DriftBench-blind: the upstream changes and the tool does not. 120 blind drifts (half the ideas from an open-weight model), 30 benign evolutions, predeclared mutation operators, a freeze ledger, sealed hidden tests and two reference fixes per drift | construction; D2, D6; E4, E6, E7 | **Table 1**; **Table 5** (benign); **Table 6** (security); **Table 7** (real bugs) |

---

## 2. Research questions

| RQ | Question | Answered by | SYNTHESIS RQ |
|---|---|---|---|
| RQ1 Trigger | Is the false-alarm rate of a per-call contract violation on a successful result, on clean traffic, low enough to open PRs from? What does it miss relative to schema, snapshot, statistical, trigger and LLM-judge detectors? | H1; D12; E3; E4; D2; D8; D11 | RQ1 |
| RQ2 Artifact | Is the trace-derived, named-property repro a better test than one a coding agent writes (and checks fail-first) from the same alert, raw trace and replay helper? | H2; D3; E10; E5 | RQ2 |
| RQ3 Placement | Does giving the agent a visible repro and gating before the PR reduce green-incorrect PRs without costing correct PRs? | H3; H4; E1; E2; E8; E9 | RQ3 |
| RQ4 Limits | How does the loop behave on legitimate evolution, on real bugs it was not designed for, and with non-hand-written contracts? | E4; E7; E3 (provenance rows) | RQ6 (part) |
| RQ5 Security | Can an adversary who controls upstream bytes get attacker-directed code into a gate-passing candidate or exfiltrate a secret? Does a strict trace format help? | E6 | RQ7 |

Folded or cut:
- SYN RQ4 (persist): covered by oracle criterion 5 plus D9. For a deterministic tool, post-fix recurrence equals held-out generalization [SYN X18].
- SYN RQ5 (agent effect): optional E11.
- SYN RQ8 (adopt): optional human review (H26). The paper does not depend on it.

---

## 3. Confirmatory family (m = 4, Holm, FWER 0.05)

The worst-case Holm level is α = 0.05/4 = 0.0125, and every power number uses it. Each H maps to one part of the novelty (trigger, artifact, placement) and can fail on its own. m becomes 3 only by the outcome-free N_E rule in §3.1, fixed at F4b.

### 3.0 Shared definitions [design]

- **Drift instance.**
  - One blind-authored change to one vendor, applied alone by the injector on that domain's base version.
  - It comes with sealed hidden tests and two independent reference fixes (A, B).
  - `DriftPackage.base` names the server ref, resolved as `<ref>^{commit}`: D1–D5 use `seed-v1` (dev only, never confirmatory); blind shop drifts use `base-shop`; tracker drifts use `seed-tracker-v1`.
- **Enumerated traffic and frozen trace.**
  - Per drift, `pnpm fiks record --drift` replays the frozen enumeration (§5.7) through tool server → injector → MON log-only proxy with the frozen contracts.
  - **Detected** = ≥ 1 `violated` verdict.
  - **v1 control and drift attribution (round 6).** `record --drift` (and `--benign`) also replays every EnumRow on a fresh vendor instance with the same base, the same frozen clock (§3.1 Clock) and **no injector rule**, in the same order (CallRecord `controlOf`). For E3 mutants the unmutated record is the control. A violation of property p on call c is **drift-attributable** iff p's verdict on c's control is `verified`. Why: the per-drift enumeration includes a seeded 50-entity extended sample (§5.7), and at the H1 planning rates P(≥ 1 FP entity in 50) ≈ 0.636 (π = 0.02) or 0.395 (π = 0.01)★ (`python3 -c "print(round(1-0.98**50,3), round(1-0.99**50,3))"`); without the control a v1 false positive could count as "detected" and become the frozen trace.
  - **Detected** = ≥ 1 drift-attributable violation. Non-attributable violations on drift traffic are counted and reported (E3, D12), never used for detection.
  - The **frozen trace** is the first call in enumeration order with ≥ 1 drift-attributable violation, serialized in the fiks trace format (tool, args, raw upstream request/response, contract id). **Round 7:** it keeps the full receipt `violated` list of that call (attributable or not) and sets `target` = [the first drift-attributable entry of that list]. The FIKS repro asserts the target and ignores the call's other violated properties (`outOfScope` = violated ∖ target, shop-mcp `test/fiks/check.ts:36-40`, applied at `:80-87`), as the product does for a trace with an explicit target. Its sha256 enters F9, and every arm on that drift consumes this exact file. A sidecar `<trace>.iv.json` (not shown to any agent; sha256 in F9) records `controlCallId`, the attributable properties, **ivProperties** (the triggering tool's contract properties whose verdict on the control is `verified`) and `ivExcluded` (the rest, with their control verdicts).
  - H2–H4 run on detected **test** drifts only. Every arm shares this conditioning, and it is reported (D4, E3).
- **Evidence (all confirmatory arms).**
  - Raw format. FIKS compiles the frozen trace into its repro.
  - L1, COMP and REPRO-AGENT receive the alert plus the same file, read-only, at `.alerts/<id>.json` (sha256 equal to the frozen trace). They also get one identical sentence naming the repo's replay helper (`test/fiks/replay.ts`, present at every base).
  - Strict mode (P3) is used only in E6.
- **Issue validation (IV).**
  - Command: `fiks-iv --trace .alerts/<id>.json` (ARMS), run as a `ciLocal` extraCheck inside the sandbox image.
  - It replays the frozen trace on a head and evaluates the **ivProperties** of the triggering tool's frozen contract (`--properties <trace>.iv.json`; round 6). Any violation among them fails the check, and its output carries the property id and message. Properties that do not verify on the frozen call's v1 control (e.g. `items.price.range` on a search page that also holds a $9 extended product) are excluded, because no fix of the drift can make them pass and they would make IV unpassable for L1 and COMP by construction.
  - IV is pre-PR in L1 (a gate) and post-PR in COMP (part of its CI). L1-noIV and COMP-norep lack it.
  - **Trigger-check asymmetry (round 7, corrected).** On the replayed frozen call, FIKS's P gate (`expectRecordingHolds`) requires every evaluated property to hold except violated ∖ target, and requires the target to be evaluated. IV requires every ivProperty to hold. The two sets differ in two ways:
    - (a) the frozen call's *other* drift-attributable violated properties are in ivProperties, but FIKS's P ignores them. IV is stricter there;
    - (b) properties that hold on the frozen call but do not verify on its control are checked by P and not by IV. P is stricter there; this is rare.

    **Direction of the bias.** (a) is the main difference. It can only keep from L1/COMP's PRs a head that fixes the target but leaves another attributable property of the triggering call violated. Such a head is almost always held-out-incorrect: the property verifies on the v1 control, so a correct fix restores it. So (a) lowers the comparators' green-incorrect rate relative to FIKS. That biases H3a/H4a **against** FIKS (conservative for the harm claim) and leaves H3b/H4b nearly unaffected. It moves correct PRs only if a held-out-correct head still violates such a property on the frozen call, which the oracle makes unlikely. We keep target = first attributable (product behaviour) rather than widening it. Reported per drift: |attributableProperties| on the frozen call, and per arm the attempts whose only IV failure was a non-target attributable property (E1).
  - If the head makes upstream requests the frozen trace never recorded (a correct lost-write, header, pagination or auth fix), IV evaluates the frozen contract on the re-recorded copy of the trace (re-record parity, below). It never evaluates on a file the agent edited.
- **Re-record parity (round 5; every arm, every replay-based check).**
  - Rule: CORE `rerecord-head` runs on the candidate head before **every** check that replays recordings. That covers P (FIKS), IV (L1, L1p, COMP), the suite's fixtures and the agent's own tests, stored traces, and local CI. It runs in every L1/L1p/L1-noIV session gate and before the CI of every COMP/COMP-norep/COMP-plain/ISSUE-TEXT revision.
  - Mechanism: one `rerecord()` code path with the drift's profile (domain, base, injector rule id, rule hash), i.e. vendor v1 plus the drift's injector rule under the frozen clock.
  - Where it runs (round 6): inside the per-attempt (or grading) container, through SBX `execFiks` with the read-only `fiks-tools` mount, `--network none` and the scrubbed env, with `--require-sandbox` (P1). Re-recording starts the candidate head's server, so it is candidate code and never runs on the host.
  - It does two things:
    - re-records stale suite recordings as `*.rerecorded.json` (product behaviour);
    - for every other recording file a check reads (`.alerts/<id>.json`, recordings loaded by agent tests), writes a per-check overlay copy at the original path, then restores the original.
  - The agent never re-records and never edits recordings, in any arm.
  - Each attempt stores its `RerecordLog` (profile, files, request keys before and after).
  - This is the product's behaviour (FIKS runs `rerecordStale` before its gates; without it D3/D4 fixes fail with `UNMATCHED_REQUEST`, codebase-map §7). It is applied identically to every comparator, so no arm is penalised for a correct fix that changes requests.
- **Request-changing drift (round 5).** A drift is request-changing iff `rerecord-head` on ref A, over the drift's frozen trace and enumeration, re-records at least one exchange. This is mechanical and uses ref A only. It is computed at F10, before R4, and never from arm outputs (HOLD). D3 and D4 are request-changing; D1, D2 and D5 are not. Used only for the s3 row (§3.2) and the per-class report (§3.3, §3.4).
- **Attempt.** One end-to-end run of one arm on one drift with one model, budget-capped (§6.2). Outcomes are mutually exclusive, one of {`correct_pr`, `green_incorrect_pr`, `red_pr`, `no_pr`, `infra_error`}:
  - `correct_pr` = PR exposed ∧ final local CI green ∧ final head held-out-correct;
  - `green_incorrect_pr` = PR exposed ∧ final local CI green ∧ final head held-out-incorrect;
  - `red_pr` = PR exposed ∧ final local CI red. The head's held-out correctness is graded and reported in E1/E9, never used in H3/H4;
  - `no_pr` = no PR exposed;
  - `infra_error` per §9.3.
  - E4 only: `contract_update_proposed` (FIKS+CU, a CU-accepted contract proposal and no PR). It cannot occur in any H2–H4 arm.
- **PR exposed.** A `would_open_pr` event; every run uses `--ci local --no-pr`.
  - FIKS and L1 emit it only after every pre-PR gate (L1: including IV) and local CI are green.
  - COMP emits it on the first non-empty diff. Its graded head is the head after ≤ 3 CI revisions within 90 min.
  - "Final local CI" = the repo's `ci.yml` mirror in the sandbox image, run on the final head. For COMP it also includes IV.
- **Held-out-correct.** Sealed; no arm sees any of it. A head is held-out-correct only if all five criteria hold:
  1. **Hidden tests pass.** At least 3 manifestations per drift: other inputs to the same tool, other tools consuming the drifted field, v1 behaviour preserved.
  2. **Semantic differential.** On 200 fast-check inputs (fixed seed) over v1 and drifted recordings, the patch output ≡ ref A or ≡ ref B on every input. Semantic equality:
     - integers exact; floats |a−b| ≤ 1e-9·max(1,|a|,|b|);
     - `null` ≡ absent; key order ignored;
     - arrays ordered unless the domain schema marks them unordered;
     - strings NFC-exact; timestamps compared as instants;
     - for inputs that `truth()` marks invalid, error ≡ empty.

     Inputs where A ≢ B are "ambiguous": kept, counted and reported.
  3. **Renamed ids.** The renamed-id variant of the hidden tests passes.
  4. **No new SAST finding.** No new finding on the diff relative to base is confirmed by ≥ 2 of {Semgrep CE, eslint-plugin-security, AST detector} [sajadi2025patches].
  5. **Held-out traffic matches `truth()`.** Held-out multi-model traffic (§5.9) is replayed on the patched server under the drifted vendor (injector rule) and under the v1 vendor. Every output ≡ `truth(vendor state, args)`. `truth()` never imports `@fiks/contracts`, `@fiks/proxy` or any monitor (static check).

  Disagreements between (1) and (2) are reported per drift; neither overrides the other.
- **Models.**
  - `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5`, via the Claude Agent SDK on the OAuth token.
  - In H3/H4 the per-drift rate is the equal-weight mean over models (a fixed facet) and attempts.
  - Attempts per cell: a = 4 [design].
  - The model set and a change only by the §13 cut order, applied at K1.

### 3.1 H1. Trigger precision (SYN H5, entity-level form)

- **Inferential target.**
  - What is random: the set of extended-catalog entities that the blind catalog author draws.
  - What is fixed: the contracts, the tool, the query grid, the frame rules and the evaluation clock (below). So given the entities, every verdict is deterministic (a census).
- **Clock (round 6).** Freshness invariants evaluate against `input.now` (`packages/contracts/src/evaluate.ts:264-268`), and live the proxy's `now` is the wall clock (`packages/proxy/src/proxy.ts:120,197`). So without a rule, verdicts on F would depend on the date R2 runs. Pre-registered:
  - each Domain has a constant `frozenClock` (an instant), committed before F2 and recorded in the F2 ledger entry;
  - every record run (frame, S-dev, drift and its v1 control, benign, mutant) uses it for the vendor clock **and** `ProxyOptions.now`, so each CallRecord's evaluation instant (`at`, proxy.ts:216) equals it; it is carried as `CallRecord.capturedAt`;
  - every offline evaluation (R2 on F, E3, D1, mutant replays, the H1 re-enable sensitivity) uses `now := capturedAt`. MON `replay-cli` never reads the system clock and refuses a record without `capturedAt`;
  - acceptance (MON, DET): a replay with the system clock shifted by +400 days gives byte-identical verdicts.
  - The target is π, the per-entity FP-origin rate of the author's entity-generating process, conditional on the author model, brief and vendor docs.
  - Entities are assumed exchangeable. Dependence within authoring batches is checked by a batch-cluster bootstrap [field2007clusterboot].
- **Statement.** On frame F, the frozen primary contracts produce:
  - (i) **inferential:** a per-entity FP-origin rate π < π0 = 0.02 [design: fewer than 1 in 50 legitimate new entities ever trigger a false alarm. Rationale: every FP origin is a potential spurious repair attempt, and §3.0 conditions repair on the first violation, so the per-entity rate bounds how often clean catalog growth would start the loop; 0.02 is also the smallest π0 in {0.015, …, 0.020} at which N_E = 1,500 gives power ≥ 0.80 at π = 0.01 (0.665★ at π0 = 0.019, 0.821★ at 0.020; `$P -c "from scipy.stats import binom as B;n,a=1500,.0125;[print(p0,B.cdf(max(k for k in range(n) if B.cdf(k,n,p0)<=a),n,.01)) for p0 in (.015,.016,.017,.018,.019,.02)]"`) within the A0 authoring budget]. The contracts are shop hand-written at `seed-v1` and tracker agent-authored at A0.
  - (ii) **census condition:** < 1% false positives among the FP-eligible frame inputs.
- **Frame F (primary).**
  - Enumerated on vendor instances loaded with the blind-extended catalog only.
  - The catalog has ≥ 750 FP-eligible entities per domain. It is authored in A0 in independent batches of 25 by a catalog author who sees no contracts. Ids are in a disjoint namespace, and each entity records its `authorBatch`.
  - Strata:
    - S-ext: every extended entity × every read tool taking an entity id.
    - S-grid: ≥ 200 queries per domain (prefixes, filters, page sizes). The shop known-good queries `laptop`, `monitor` and `cable` are excluded.
    - S-write: one single-line order per extended product × quantity ∈ {1, 2}, each a create → get pair. Tracker: one comment and one state transition per extended issue, each followed by its read.
  - Dedupe key: (domain, tool, args, sha256(upstream response)).
  - Frame rules are fixed in PREREG.
  - **Server refs.** Shop: `base-shop^{commit}` (the base of every blind shop drift; contracts are those frozen at `seed-v1`, unchanged in `base-shop`). Tracker: `seed-tracker-v1^{commit}`. Vendor v1, no injector.
  - **Outputs before F4b, verdicts after.** Before F4b, `pnpm fiks record --frame --monitor none` (DET; MON `--monitor none`) records every frame input's CallRecord (tool output, upstream exchange, `truth()` comparison, entity class, origin unit, `capturedAt` = the Domain's `frozenClock`) with **no contract evaluation**. It also records **no read-back probe**: the proxy derives probes from `contract.postconditions` (`packages/proxy/src/proxy.ts:183-194`), and this record never opens the contracts. `frame-k` consumes these records to decide Clean and eligibility. The record set's sha256 enters F4b. At R2, verdicts are computed only by offline replay (MON `replay-cli --per-element`, `now := capturedAt`) of exactly these hashed records; nothing on F is re-executed.
  - The frame instance, its CallRecords, n_F, N_E, the attribution table and the family map are hashed at **F4b, before F5 and before any contract verdict on F exists**.
- **Outside F, reported separately.**
  - S-dev, as D11: the original catalogs; the 30 tracker contract-author calls; shop `knownGoodInputs` and v1 fixtures; all A0 validation traffic.
  - S-agent: held-out multi-model traffic.
  - S-realfix: fixed real-bug versions.
  - Benign evolutions (E4).
- **Clean.** Tool output ≡ `truth()` on v1, decided on the pre-F4b `--monitor none` records. Inputs where the base tool already disagrees with `truth()` are excluded and reported (they would be true positives). An entity all of whose inputs are excluded is not eligible.
- **FP-capable properties.** `fpCapability(invariant, endpointMeta)` (VOCAB, frozen at F2) is a fixed table over invariant kinds:
  - *Truth-entailed:* equalsUpstream; readAfterWrite and every postcondition; unique on a primary id; countMatchesTotal on endpoints that v1 does not paginate.
  - *FP-capable:* range; freshness; notNull; nonEmpty; enum; crossField; pageComplete; countMatchesTotal on paginated endpoints; unique on non-id fields.
  - Properties scoped `onlyKnownGood` apply to no input in F.
  - Entailed properties are evaluated as a sanity check. Any FP there is an evaluator or `truth()` defect: it is logged and investigated, never counted.
  - **Exception (round 5).** The readAfterWrite / postcondition sanity check is **not evaluated on F**. F's records carry no probe (above), so offline replay returns `unverifiable` for postconditions. Postconditions are truth-entailed and never FP-capable, so H1 (Z_e, census share) is unaffected. The explicit create → get pairs of S-write still evaluate every get-tool property. DET's offline-equals-live acceptance is therefore stated over non-postcondition properties only.
  - Shop (`packages/contracts/contracts/shop-mcp.contracts.json`, 12 properties):
    - FP-capable in F (5): `search_products items.price.range`, `get_product price.range`, `create_order total.range`, `get_order created_at.freshness`, `get_order total.range`.
    - Entailed: `countMatchesTotal` (v1 unpaginated), `total.equalsUpstream`, `items.id.unique`, `created_at.equalsUpstream`, `readAfterWrite`.
    - Known-good only: `items.nonEmpty`, `price.notNull`.
- **FP-eligible input.** At least one FP-capable property applies (path resolution only; the enumerator does not import the evaluator; static check).
- **FP-eligible entity.** At least one FP-capable property applies to a value attributed to it on some eligible input. N_E = the number of FP-eligible entities, fixed at F4b.
- **Attribution** (`Domain.originEntity(tool, args, path, value)`, pre-registered, reads no contract). Each property evaluation on an input is attributed to one origin unit:
  - entity-level tools: the entity;
  - item-level properties (`items[*].…`): **each violating element is attributed to its own entity** (round 7; attribution is keyed by the concrete element path, e.g. `items[2].price`);
  - shop order tools: the order's single product (S-write orders are single-line by construction);
  - tracker child tools (comments, labels, assignees, transitions): the parent issue;
  - collection-level properties (pageComplete, countMatchesTotal on paginated endpoints, collection nonEmpty/enum): the S-grid query. These are not entities. They enter the census condition and D12, not the entity test.
- **Per-element verdicts (round 7).** The evaluator returns only the **first** failing element per invariant: range (`packages/contracts/src/evaluate.ts:173-191`), notNull/nonEmpty (`:192-213`), unique (`:254-263`), freshness (`:264-279`). Take a search page with two out-of-range extended items. With receipt-level verdicts the second entity stays in N_E but can never enter X, which biases X down and H1 **toward rejection**. So every H1 quantity (Z_e, X, the census share, D12 cells and sources) is computed from per-element verdicts:
  - MON `replay-cli --per-element` passes VOCAB's `EvalOptions.perElement` and writes one DetectorVerdictRow per violating element (`at`, `elementIndex`).
  - Live receipts and the default replay are unchanged (byte-identical to ec241bc). Per-element mode is offline only.
  - An input is an FP input iff it has ≥ 1 per-element FP row. That is the same set as under the first-element rule, so the census share does not change by construction; the entity count does.
  - `h1_precision.py` refuses first-element-only rows.
  - Acceptance (MON, DET, AN): a search page with two out-of-range extended items and one in-range item gives Z_e = 1 for both offending entities and exactly one input-level FP.
- **Endpoint and test (confirmatory).** Z_e = 1 iff ≥ 1 FP is attributed to entity e on any FP-eligible input, under any FP-capable property, counting every violating element (per-element verdicts, above).
  - X = Σ Z_e over the N_E eligible entities.
  - One-sided exact binomial, H0: π ≥ 0.02; reject iff X ≤ crit(N_E, 0.02, α).
  - p_E = P(Bin(N_E, 0.02) ≤ X).
  - **Decision value entering Holm:** p_H1 = p_E if the census share < 0.01, else p_H1 = 1. Adding a deterministic condition only lowers the rejection rate, so the test stays valid.
- **Power at α = 0.0125.**

  | N_E | crit | exact size | power π = 0.01 | power π = 0.005 |
  |---|---|---|---|---|
  | 1,500 (planned) | 18★ | 0.0123★ | 0.821★ | ≥ 0.99★ |
  | 1,000 | 10★ | 0.0102★ | 0.583★ | — |

  The minimum N_E at which the test can reject at all is 217‡ (0.98^N ≤ 0.0125). Commands:
  ```
  paper/.venv/bin/python paper/scripts/power.py binom --n 1500 --p0 0.02 --alpha 0.0125 --p1 0.01 0.005
  paper/.venv/bin/python paper/scripts/power.py binom --n 1000 --p0 0.02 --alpha 0.0125 --p1 0.01
  paper/.venv/bin/python paper/scripts/power.py binom-min --p0 0.02 --alpha 0.0125
  paper/.venv/bin/python -c "from scipy.stats import binom as B;n,p,a=1500,.02,.0125;c=max(k for k in range(n) if B.cdf(k,n,p)<=a);print(c,B.cdf(c,n,p),B.cdf(c,n,.01),B.cdf(c,n,.005))"
  ```
- **N_E rule (outcome-free, applied at F4b; no verdict on F exists).** Applied in order:
  1. If N_E < 1,500 or any domain has < 750: the catalog author adds batches in the deficient domain, same brief, up to 1,000 per domain, and F4b is recomputed.
  2. If N_E is still < 1,500: test at the realised N_E. PREREG states crit and power. If the power at π = 0.01 is < 0.50, PREREG flags H1 as underpowered; it is still tested.
  3. If N_E < 217: H1 is descriptive only and Holm runs over {H2, H3, H4} (m = 3, level 0.0167). The §3.3 numbers are then conservative.
- **Pre-registered robustness check.**
  - A one-sided 98.75% percentile upper bound on π from a cluster bootstrap that resamples `authorBatch` clusters (10,000 resamples) [field2007clusterboot].
  - Reading rule: if H1 rejects but this bound is ≥ 0.02, the reading is "rejected under entity exchangeability; not robust to authoring-batch dependence".
  - `simulate_null.py` reports the exact test's size under a beta-binomial batch DGP (ICC 0.02, 0.05). This is informational.
- **Falsified if** Holm-adjusted p_H1 ≥ 0.05, which includes the census condition failing.
- **Reported regardless.** Clopper–Pearson and Wilson intervals for π per domain and per contract provenance [brown2001binomial]; entailed-property sanity counts; D11; D12.
- **Pre-registered risk (corrected in round 4).**
  - Shop item `range` invariants (`items.price.range`, `price.range`) are [20, 2000] USD, set from the 15-product original catalog (codebase-map §4), which is now S-dev.
  - Order `total.range` (create_order, get_order) has `min: 0.5` and **no max** (`packages/contracts/contracts/shop-mcp.contracts.json`). It can fire only for a unit price < 0.25 at quantity 1, where `price.range` already fires for the same entity, so it adds no entity-level FP channel. Its upper side is vacuous. `get_order created_at.freshness` passes on a freshly created order.
  - So on shop, π is in practice **the rate at which the catalog author writes a price outside [20, 2000]**. A blind author may legitimately add a $5 or a $2,500 item; either makes that entity an FP origin. This outcome is set by the catalog brief and the shop docs, which are therefore frozen with hashes at F2, before A0 (§5.2 item 2), and pre-registered to state no price or other contract-derived bound.
  - No range is widened after F4b. A widening is a deviation, and both results are reported.

### 3.2 H2. Test adequacy over a fixed, arm-independent patch pool (SYN H11; C19 vs agent-written repros)

- **Statement.** Added to the same existing suite, the fiks repro separates held-out-correct from held-out-incorrect patches better than a fail-first agent-written repro built from the same alert, raw frozen trace and replay helper.
- **Accept rule.** Test set T accepts a patch iff typecheck + lint + existing suite + stored traces at base + T all pass (in the sandbox image). A test that errors at harness level makes T fail for every patch. T = ∅ reduces the rule to the rest.
- **Re-record rule (round 4, identical for every test set).** A correct fix for a lost-write, header or pagination drift changes the upstream requests, so strict replay matching (method + path + query + body + header names) would return `UNMATCHED_REQUEST`. Therefore, for every (patch, T) with T ∈ {fiks, agent-final, agent-first, ∅}, `accept()` first runs CORE `rerecord()` on the patched head through the drift's injector chain (profile = domain, base, injector rule id, rule hash; vendor v1 + rule), regenerating every recorded fixture that any of the four test sets or the stored traces replay (the union, once per patch, so every T sees the same fixtures). **Round 5: this includes the agent tests' recordings.**
  - The REPRO-AGENT task text (§5.5) requires the test to load its recording from `.alerts/<id>.json` through the replay helper.
  - Per patch, `accept()` (CORE `rerecord-head`, same profile as for the fiks fixture) writes an overlay re-recording of every recording file that any T file reads at the original path. The files are found by an fs-read log of each T run on base, and include `.alerts/<id>.json` and the fiks repro JSON. Every T then runs over the same overlay.
  - A recording inlined in a test file cannot be re-recorded. That test counts as it behaves, is flagged `inlineRecording`, and the count is reported per drift class.

  Only then are the checks evaluated. This mirrors the product (FIKS re-records before P) and is applied to all sets alike, never to the fiks test only. Re-record failures count against the patch for every T equally and are reported per drift class. Base checks (typecheck, lint, suite, stored traces) and the re-record are computed once per patch and cached; only each T file runs per test set (§8.1 R5).
- **Tests compared.**
  - **fiks:** the repro FIKS generates from the frozen trace, as it behaves. If it fails its own F gate, it is still used. If none is emitted, T = ∅.
  - **agent (primary):** the final test of each REPRO-AGENT session after the F check with feedback (§5.5), as it behaves. A test that never passes F within budget is still used.
  - **Sensitivity rows:** (s1) the first, unfiltered agent test of each session; (s2) only F-valid agent tests (drifts with none are dropped from s2); (s3, round 5) the primary comparison without request-changing drifts (§3.0). s3 shows whether Δ depends on the re-record overlay.
- **Endpoint per drift.**
  - BA = 1 − (FAR + FRR)/2 over the primary pool (§5.6).
  - FAR = share of held-out-incorrect patches accepted.
  - FRR = share of held-out-correct patches rejected.
  - BA_agent = mean BA over the REPRO-AGENT tests (3 models × 2 samples; 2 × 3 if Haiku is cut).
  - Δ_i = BA_fiks,i − BA_agent,i.
- **Unit, n.** Detected test drifts with ≥ 3 patches per class in the primary pool. Expected n ≈ 61, floor 40 [estimate].
- **Power** (two-sided α 0.0125, power 0.8; σ_d re-estimated at K1). MDE by n and σ_d:
  - n = 61: 0.1069† at σ_d 0.25; 0.1496† at σ_d 0.35.
  - n = 51: 0.1169† at σ_d 0.25.
  - n = 40: 0.1320† at σ_d 0.25.

  The F check may raise BA_agent and with it σ_d. K1 re-estimates σ_d on dev REPRO-AGENT runs that include the F check.
- **Test.** Two-sided sign-flip permutation on Δ_i: exact if n ≤ 20, else 200,000 flips (seed in PREREG). 95% and 97.5% BCa CIs over drifts.
- **Falsified if** mean Δ ≤ 0 or Holm-adjusted p ≥ 0.05. Equivalence margin for readings: ±0.05 BA.
- **Expected loss channel.**
  - A fiks repro asserts only the violated property, so clamp (P1) and constant (P2) patches can pass it (PROGRESS "Known limits").
  - An agent test may assert exact upstream-derived values.
  - Reported: FAR, FRR, BA by pool source, BA per drift class.

### 3.3 H3. The visible repro adds value once the same trigger check gates both: FIKS vs L1 (IUT)

- **What H3 isolates.**
  - Both arms have identical evidence, budget, guard, suite, stored traces, typecheck/lint and local CI, and a pre-PR check that the triggering call no longer violates. Round 7: these checks are not identical property sets. L1's IV also checks the frozen call's non-target attributable properties, which FIKS's P ignores (§3.0 "Trigger-check asymmetry"). That makes L1's gate stricter on harm, so H3a is biased against FIKS (conservative) and H3b is nearly unaffected. The same holds for COMP's post-PR IV in H4.
  - FIKS also has a fail-first proof (F gate) and a named-property test that the agent sees and runs from the start and that is committed with the fix.
  - L1's agent may write its own tests and may run the replay helper.
- **H3a harm (superiority).**
  - Y = 1 iff outcome = `green_incorrect_pr`.
  - Per drift, p = mean(Y) over models × attempts; d_i = p_L1,i − p_FIKS,i.
  - Two-sided sign-flip permutation. Equivalence margin ±0.05.
  - **Direction guard (round 4).** H3a counts as rejected only if mean d_i > 0 (FIKS less harmful) **and** Holm-adjusted p < 0.05. A significant result with mean d_i < 0 is never a rejection; it is reported under the opposite-direction reading (§3.5). `h3h4_repair.py` sets p_3a = 1 when mean d_i ≤ 0; an AN unit test checks this.
- **H3b benefit (non-inferiority).**
  - Y = 1 iff outcome = `correct_pr`.
  - d_i = p_FIKS,i − p_L1,i; margin δ = 0.10.
  - One-sided shifted sign-flip on d_i + δ at α_Holm (one-sided by construction: it rejects only for d̄ > −δ).
  - **Margin rationale [design].** δ = 0.10 absolute. At the planning base rate p = 0.5 this is a 20% relative loss; at p = 0.3 it is 33%. Every report prints the relative loss (d̄ / p̄_comparator) next to the absolute one. δ = 0.05 would need n ≥ 244★ drifts at σ_d 0.253 (`$P "$PF/scripts/eval_stats.py" mde --target 0.05 --sd-diff 0.253 --alpha 0.025`) against ≈ 61 available, so 0.10 is the smallest margin the drift budget supports. The thesis therefore says "a correct-PR loss not exceeding 0.10", not "no material loss".
- **p_H3 = max(p_3a, p_3b)**. Falsified if either component fails at its Holm level, or if mean d_i ≤ 0 on H3a.
- **n.** Detected test drifts (expected ≈ 61, floor 40).
- **σ_d model [design].**
  - σ_d² = Σ_arms p(1−p)/(m·a) + τ², with m models and a attempts.
  - Planning values: correct-PR p = 0.5 (worst case), τ = 0.15; harm p ≈ 0.15 in both arms, τ = 0.10.
  - Sampling floor for correct-PR at p = 0.5: 0.236† (m·a = 9), 0.204† (12), 0.250† (8), 0.289† (6).
  - K1 replaces p and τ with dev estimates (`eval_stats.py decompose`).
  - With IV in L1 the true harm gap is expected to be smaller than in round 2; non-rejection is read by §3.5.
- **Power by configuration.**
  - The configurations are cut steps S0, 8 (= S2) and 9 (= S3) of §13.
  - ‡/† are normal approximations. Joint IUT power ≈ the product of the components at harm Δ = 0.10 and a true correct-PR difference of 0.
  - AN's `simulate_power.py` replaces the product with a simulation (informational).

  | Config | m × a | σ_d harm | σ_d correct | Harm MDE n=61 / n=40 | NI power n=61 / n=40 | Harm power at Δ=0.10, n=61 / 40 | Joint IUT n=61 / n=40 |
  |---|---|---|---|---|---|---|---|
  | S0 (base) | 3 × 4 | 0.177 | 0.253 | 0.0757† / 0.0935† | 0.801‡ / 0.602‡ | 0.972† / 0.859‡ | 0.779‡ / 0.517† |
  | S2 (a = 3) | 3 × 3 | 0.196 | 0.279 | 0.0838† / 0.1035‡ | 0.712† / 0.510‡ | 0.9315‡ / 0.767† | 0.663† / 0.391‡ |
  | S3 (no Haiku) | 2 × 3 | 0.229 | 0.325 | 0.0979† / 0.1209‡ | 0.564† / 0.384† | 0.819‡ / 0.604† | 0.462† / 0.232† |

  Reference values for other σ_d:
  - NI power at σ_d 0.25: 0.811‡ (n = 61), 0.613‡ (n = 40).
  - NI power at σ_d 0.30: 0.641‡ (n = 61), 0.447‡ (n = 40).
  - NI n for power 0.8 at δ = 0.10: 60† (σ_d 0.25), 86† (0.30), 61† (0.253), 74† (0.279).

  **Power at less favourable truths (round 4, all ★).** Stricter pre-PR gates may turn some correct attempts into `no_pr`, and IV in L1 shrinks the harm gap, so the table above is optimistic. NI power at a true correct-PR difference θ < 0, and harm power at Δ = 0.05:

  | Config | NI power θ = −0.03, n = 61 / 40 | NI power θ = −0.05, n = 61 / 40 | Harm power Δ = 0.05, n = 61 / 40 |
  |---|---|---|---|
  | S0 | 0.468★ / 0.312★ | 0.243★ / 0.161★ | 0.385★ / 0.239★ |
  | S2 | 0.389★ / 0.256★ | 0.200★ / 0.134★ | 0.307★ / 0.188★ |
  | S3 | 0.288★ / 0.190★ | 0.149★ / 0.102★ | 0.214★ / 0.132★ |

  Command: `$P -c "from scipy.stats import norm;from math import sqrt;a=.0125;za,zb=norm.ppf(1-a),norm.ppf(1-a/2);[print(sh,sc,n,round(norm.cdf((.10-.03)*sqrt(n)/sc-za),3),round(norm.cdf((.10-.05)*sqrt(n)/sc-za),3),round(norm.cdf(.05*sqrt(n)/sh-zb),3)) for sh,sc in ((.177,.253),(.196,.279),(.229,.325)) for n in (61,40)]"` (`power.py ni --theta`, `power.py harm --effect 0.05` reproduce it). PREREG states plainly: if the true correct-PR cost is 0.03–0.05 or the true harm gap is 0.05, H3/H4 are more likely than not to be "not established" at every configuration.
- **Per drift class (round 5, descriptive).** Every H3/H4 component is reported separately for request-changing drifts and the rest (§3.0), with BCa CIs and no p-values. The rows never enter Holm. A gap that appears only in one class is discussed with the `RerecordLog`s.
- **Pre-declared.** H3 and H4 are underpowered at the floor n = 40 in every configuration, and at S2/S3 for n = 61. Any non-rejection is reported as "not established at this n; MDE = x" (§3.5).

### 3.4 H4. Against the strongest composition: FIKS vs COMP (IUT)

- H4 uses the same two components, n, σ_d model, power table and wording rules as H3, with COMP in place of L1:
  - harm: Y = `green_incorrect_pr`;
  - benefit: Y = `correct_pr`. A COMP head that is held-out-correct but red at the end is `red_pr` and counts as 0;
  - NI δ = 0.10 (rationale as H3b);
  - direction guard as H3a: H4a counts as rejected only if mean d_i > 0 (p_4a = 1 otherwise);
  - p_H4 = max(p_4a, p_4b);
  - per-class report (request-changing vs other) as for H3.
- COMP in its strongest form (§6.2) has:
  - the same detector, frozen raw trace, replay helper, model, budget and guard;
  - a "reproduce the issue first" instruction;
  - a repo CI that already contains fiks's contract suite and stored traces;
  - post-PR IV [langsmith-changelog-2026].
- Red-CI PRs are not in the harm endpoint (that would make H4 partly true by construction). They are reported in E1/E9.

### 3.5 Pre-registered readings

CI = two-sided 97.5% BCa over drifts (TOST at the worst-case Holm level). Margins: BA 0.05; harm 0.05; correct-PR 0.10.

| Outcome | Reading |
|---|---|
| Any H, or any IUT component, not rejected | "Not established at this n; MDE = x (realised n, K1 σ_d)". Never "no effect", "as good as" or "reduces to". |
| Equivalence | Claimed only if the CI lies within ±margin. |
| Opposite direction | Claimed only if the CI excludes the margin on the other side. Example for H3b: an upper bound of d below −0.10 ⇒ "the repro costs correct PRs". |
| H1 rejected | "On F, fewer than 2% of legitimate new entities trigger any false alarm, and < 1% of inputs are FPs." Per-domain and per-provenance intervals are shown. If the batch-cluster bound is ≥ 0.02, append "not robust to authoring-batch dependence". |
| H1 not rejected | State the Clopper–Pearson upper bound on π. "Imprecise" only if the 97.5% lower bound exceeds 0.02, or if the census share is ≥ 1%. Hand-range overfitting is then discussed with E4/CU. |
| H2 rejected | The named-property repro is the more adequate test over the fixed pool, against fail-first agent tests. |
| H2 not rejected | Inconclusive. "Agent repros are as adequate" only by the equivalence rule; "more adequate" only if the upper bound is < −0.05. |
| H3 rejected | Given identical evidence and gates, and a trigger replay that is at least as strict for L1 on the triggering call's attributable properties (§3.0 asymmetry; this biases H3a against FIKS), a visible fail-first repro lowers green-incorrect PRs without a correct-PR loss beyond 0.10. |
| H3a or H4a not rejected | Read with the §3.0 asymmetry. Part of a true harm gap may be absorbed by the comparator's stricter IV on non-target attributable properties. The E1 count of attempts stopped only by such a property is shown next to the reading. It never turns a non-rejection into "no difference". |
| H3 not rejected; E1 shows L1-noIV harm > L1 | The trigger replay, not the visible test, may carry the reduction. Exploratory, effect size only. "The test adds nothing" only by H3a equivalence. |
| H4 rejected, H3 not | FIKS beats the strongest composition; the repro's own share is not established. "Placement, not the repro" only if H3a's CI shows harm equivalence (±0.05). |
| Harm component rejected, NI component not | Fewer harmful PRs; a correct-PR cost beyond 0.10 is not excluded. "Costs real fixes" only by the opposite-direction rule. |
| H4 not rejected | Not established that FIKS is safer than the composition at this n. "As safe as" only by equivalence on both components. |

All readings are publishable as stated. Nothing is reframed after unblinding.

---

## 4. Exploratory and descriptive sets

Exploratory: direction pre-registered, raw p, effect sizes with 95% BCa CIs, never called "significant" [arcuri2014hitchhiker].

| ID | Question | Endpoint / method | Expected |
|---|---|---|---|
| E1 | The ladder COMP-plain → COMP-norep → COMP → L1-noIV → L1 → FIKS. Also: red-CI PRs per arm; held-out correctness of red heads; **IV effect** (L1-noIV vs L1, COMP-norep vs COMP); **non-target IV stops** per arm (attempts whose only IV failure was a non-target attributable property of the frozen call, §3.0 asymmetry; round 7); **L1p** (prose alert, no trace file; Opus) vs L1, the evidence-input effect [yang2026deprepair]; FIKS superiority on correct PRs if H3b/H4b hold | H3/H4 endpoints per rung, paired sign-flip | Placement removes red PRs by construction. IV narrows both gaps. Either gap may be ≈ 0 |
| E2 | Per-model effects, arm × model | GLMM `y ~ arm*model + (1|drift)` at attempt level | Larger gate value for Haiku |
| E3 | Detection coverage (SYN H1, H3, H4, H6, H17) | Per-class recall on test drifts; specificity on F and benign. **Round 6:** for every detector a drift/benign/mutant call counts as a fire only if it is drift-attributable (the detector does not fire the same way on the call's v1 control, §3.0); non-attributable fires on drift traffic are a separate row per detector (property, entity, drift). Mid-p McNemar at drift level [fagerland2013mcnemar]. Per-drift BA(contracts) − BA(judge), judge variant named at K1; judge AUROC by drift-clustered bootstrap. FN per mutation operator (Wilson) [jahangirova2016oracle]. **Contract recall on M1–M14 mutants is labelled construction-coupled** everywhere it appears: M1/M2 ↔ range, M8/M9/M13 ↔ freshness, M14 ↔ readAfterWrite, M6 ↔ countMatchesTotal map one-to-one onto the contract vocabulary. Figure 2 leads with the blind-drift and evasive strata; mutant rows come last, under that label. Calls-to-first-detection vs windowed detectors (w ∈ {20, 50}). Breakdowns: stratum (realistic / evasive / S12), ideation family, contract provenance (shop hand / tracker agent / shop blind re-contract / LLM-authored × 3 seeds) | Contracts ≥ the schema floor. **Expected loss to judge+upstream on evasive and S12.** Snapshot diff fires on benign. Invariant faults are the class least coupled to mutants [just2014mutants] |
| E4 | Benign evolution (X21, SYN H18) | Per case: code PR / contract-update proposal / no PR for FIKS-current, FIKS+CU and COMP (Opus × 3 attempts). Documented vs undocumented changelog stratum. **Paired test (round 4):** Y = 1 iff a code PR is exposed on a benign case; per-case rate over the 3 attempts; contrasts FIKS-current − FIKS+CU and COMP − FIKS+CU by exact paired sign-flip on per-case differences (n = 30 cases; 200,000 flips, seed in PREREG); mid-p McNemar on first-attempt outcomes as sensitivity [fagerland2013mcnemar]; raw p, Wilson CI on every rate. Misrouting guard: FIKS+CU routes ≥ 90% of detected true drifts to code (exact lower bound) | **Expected loss for FIKS-current** |
| E5 | Gate residual, collateral regressions | Patches that pass every fiks gate yet are held-out-incorrect; collateral regressions among gate-rejected candidates [tayebati2026selfhealingharness]; H2 on the secondary arm-derived pool, by source | Non-zero residual |
| E6 | Security (SYN H23–H25), incl. trace format | 4-way attack success: canary egress; attacker-directed behaviour in a gate-passing candidate (by the attack's own oracle); non-`src` edit; disallowed command. Containment violations and canary hits (Wilson upper, template-clustered). **Analysis (round 7, one named test, everything else descriptive):** the only test is raw vs strict attack success (any of the 4 goals) on the hardened loop. It is a paired mid-p McNemar over (template × carrier) pairs, with raw p and an exact p next to it [fagerland2013mcnemar]. Per-goal success, malicious-diff rate raw vs strict, containment violations and canary hits get Wilson intervals only (template-clustered), no test. **Strict-vs-raw utility on dev for FIKS and L1 (Opus)** is descriptive: per-instance paired differences in `correct_pr` rate with a 95% BCa CI over the 29 dev instances. The 0.10 margin is used only to word the reading, never as a test. A small adaptive attacker (SEC). The round-3 "current loop in a disposable container" arm is **cut** (round 4): it needs the unhardened loop plus the OAuth token inside a container, which no stream builds and which would expose the token. The attack goal "attacker-directed behaviour in a gate-passing candidate" is the SWExploit channel [verify: chen2025swexploit] carried in trace/fixture bytes instead of issue text; tool-output injection into a repair workflow is measured by CapScope [verify: bouras2026capscope]. Capability bounds are the only guarantees claimed [nasr2025attackermovessecond] [beurerkellner2025patterns] | Containment 0 with the sandbox; non-zero malicious-diff rate with raw traces |
| E7 | Real bugs, wave 1 (SYN H14, H15) | Per bug: detect on prefix; FP on fix; F on prefix (10 runs); P on the human fix. FIKS vs COMP vs ISSUE-TEXT (Opus × 5 attempts each), run through RBA and graded by human-fix tests plus added held-out manifestations. **Descriptive only (round 4):** per-bug case comparisons with a Wilson CI on every per-arm rate (k/5); no test, no comparative claim, no pooling across bugs. Stratified by fix date vs model cutoff [swe-bench-illusion] | Case studies, n = 4 |
| E8 | COMP-plain vs FIKS, Opus. COMP-plain = repo CI without contract suite, stored traces or IV | H4 endpoints | Larger gap than vs COMP |
| E9 | Cost and time | API-price estimate, tokens, turns, minutes per attempt and per correct PR, per arm × model (median, IQR) [kapoor2025hal]; red-CI PRs per arm (SYN H20) | — |
| E10 | Wrong reason and agent-repro validity | Agent tests that pass plain F→P [mundler2024swtbench] but fail the stated-reason check. F-success rate and F rounds used per agent session. H2 sensitivity rows s1, s2. P-gate rejections inside FIKS of candidates the agent believed fixed | Descriptive-leaning |
| E11 (optional, last) | Receipts vs no monitor on agent answers, test drifts | Wrong-answer and correct rate per drift; Sonnet, k = 4, clustered by drift; dual decline grading; trivial agents [zhu2025abc]; pass^k [yao2024taubench]. **Paired test (round 7):** per-drift wrong-answer rate difference (no monitor − receipts) over the k = 4 trials, exact paired sign-flip over drifts (exact if n ≤ 20, else 200,000 flips, seed in PREREG), raw p, 95% BCa CI; correct rate, decline rates and pass^k are descriptive. Runs only after CP2 and all other runs, if caps remain; never projected at K1 | — |

Descriptive (counts and Wilson intervals; no tests):

| ID | What |
|---|---|
| D1 | Determinism: deterministic detector verdicts identical across 20 offline replays (`now := capturedAt`; one of the 20 under a +400-day system-clock shift, round 6); F-gate verdicts across 10 runs (SYN H21) |
| D2 | Silence of every drift: HTTP 2xx, `isError` false, OpenAPI byte-identical (oasdiff 0 findings [oasdiff-breaking] [C27]), typecheck unchanged |
| D3 | Repro validity: F fails on base for the named property in 10/10 runs and passes on ref A and ref B in 10/10 (near-construction) |
| D4 | Funnel per drift: authored → valid → kept → detected → F → repair → gates → PR → held-out-correct [polyzotis2018lifecycle] |
| D5 | Attrition and infra-error counts per run and arm; local CI vs GitHub Actions agreement (20 heads) |
| D6 | Realism ratings (1–5) per drift by a separate **LLM rater (Sonnet)**, labelled an LLM rating everywhere; coverage of C3 categories [C3] and R1–R25 classes |
| D7 | Legacy 2026-10-20 bench (6 tasks × k = 5), appendix only, labelled underpowered [bowyer2025clt] |
| D8 | Detection as a function of calls enumerated per drift |
| D9 | Contract-clean on held-out replay per final head (not part of correctness) |
| D10 | One showcase PR per domain on vats98754 repos with green CI (timeline figure), produced only by run **R11** (round 7): post-CP2 product mode (no `--arm`, `--run-key` or `--no-pr`; `--ci github`; P5 allow-list) on one seeded-drawn detected test drift per domain, against a branch `showcase/<driftId>` cut at its base; outside the K1 walk; never merged by the run. If R11 does not run, D10 is cut and Appendix J shows the funnel only. Never presented as maintainer acceptance (M18) [minh2026revieweffort] |
| D11 | S-dev: violations of the frozen contracts on contract-development traffic at A0 (realised count, properties disabled by the mechanical rule, any deviation) |
| D12 | H1 census companions, counts only, no p-values, all from per-element verdicts (round 7, §3.1): input-level FP share overall and per stratum; collection-level FPs per S-grid query; (property × entity class) cells with ≥ 1 FP out of K; FP sources = distinct (origin unit × property family). Family = the last non-index segment of the property path (e.g. `price`, `total`, `created_at`), a mechanical rule fixed at F4b. **Round 6:** non-attributable violations on drift traffic (violations whose property does not verify on the call's v1 control; DET `nonattributable.jsonl`), per drift, property and entity, and the number of drifts with ≥ 1 |

---

## 5. Substrates and their construction

### 5.1 DriftBench-blind domains, bases and sizes

- **Shop** (existing).
  - `vendor-api` v1 with a `--catalog original|extended-only|all` option.
  - Server refs on vats98754/shop-mcp. Every check uses `^{commit}`:
    - `seed-v1^{commit}` = bb037cf: pre-fix; the D1–D5 dev base; untouched.
    - `base-shop^{commit}` = main 7bf2e66 plus one VOCAB re-vendor commit (vendored `evaluate.ts`/`types.ts` only; shop contracts unchanged). The peeled commit sha is recorded in the freeze ledger and in `packages/contracts/shop-sync-ref.json`.
    - **Round 7:** VOCAB pushes that commit only to branch `fiks/revendor-f2` and the tag `base-shop`. shop-mcp main is fast-forwarded to it by the orchestrator only when VOCAB merges into fiks main (§7.1 merge discipline). `scripts/ensure-shop-mcp.mjs` (pretest) checks out the pinned ref in `shop-sync-ref.json`, never a moving branch. No in-flight stream's `pnpm test` therefore sees a changed shop-mcp before it rebases onto the merge.
  - Contracts are frozen at `seed-v1` (hand-written; primary).
  - Sensitivity set: shop re-contracted by an isolated agent using the tracker protocol (`shop-blind.contracts.json`).
- **Tracker** (new).
  - An issue-tracker vendor (issues, labels, comments, assignees, paginated search, state transitions) with the same catalog option.
  - `tracker-mcp` (≥ 6 tools) in its own repo under vats98754. Chosen because its classes match R1–R8, R11 and R12 [SYN §7].
  - Contracts are authored in A0 by an isolated agent from docs + 30 v1 calls on the original catalog, and frozen before any drift exists. Base: `seed-tracker-v1`.
  - **Build-phase dev drift (round 5).** TRK-DEV-1 is a full dev DriftPackage (DOM2: injector rule, ref A, ref B, ≥ 3 hidden tests). Its base is the dev-only tag `dev-tracker-stub` on branch `dev/stub`: main plus a dev-only stub contract. The stub is written after the tracker docs are committed, is never exported to any author (`*.contracts.json` is denied) and never reaches main. `seed-tracker-v1` is cut from main at A0. TRK-DEV-1 exercises every arm, IV, the re-record service and the grader on the tracker domain before any run (ARMS, ORCH, HOLD, INTEG). It is never confirmatory.
- All worktrees are created from local refs/tags (peeled), with no fetch and no push.

| Artifact per domain | Count | Author (separate agent sessions) |
|---|---|---|
| Catalog extension entities (A0, before F4b) | ≥ 750 FP-eligible, in independent batches of 25 (top-up ≤ 1,000) | catalog author |
| Realistic silent drifts | 45 (3 authors × 15) | drift authors |
| Monitor-evasive drifts | 15, incl. ≥ 5 plausible-string (S12) | evasive author |
| Benign evolutions | 15 | benign author |
| Hidden tests per drift | ≥ 3 manifestations | drift author |
| Reference fixes per drift | 2 (A by the drift author; B by an independent fixer that never sees A) | — |

- **Totals.** 120 blind drifts, 30 benign, ≥ 1,500 eligible entities. Authors over-produce by 25%. **Keep rule:** first valid in authored (idea-index) order, until each stratum quota is met.
- **Ideation.**
  - Per domain, 50% of drift ideas come from a local open-weight model via ollama (model approved by the user, §8.0) and 50% from Opus, with the same prompt.
  - Ideas are logged and index-ordered (seeded shuffle) before any implementation. Opus authors implement them.
  - Reported as a stratum.
- **Split.** Seeded RNG, stratified by domain × stratum × ideation family: 20% dev (24) plus D1–D5; **test = 96**.
- **Expected detected test drifts** ≈ 0.75 × 72 realistic + 0.30 × 24 evasive ≈ 61 [estimate].
- **Top-up rule.** Decided on detection counts only (Detected = ≥ 1 drift-attributable violation, §3.0), after R2 and before any test-split repair run:
  - If detected test drifts < 50: author 20 more drifts in the domain with the lower detected count.
  - If the projected total (current detection rate × 20) is still < 50: 20 more in the other domain.
  - Same briefs, pipeline, keep rule, split and seal.
  - If still < 40: H2–H4 run at the realised n, with the MDE stated.

### 5.2 Circularity controls and the freeze ledger

`paper/prereg/freeze-ledger.json` records each freeze as (tag, peeled commit, tree hash, timestamp, external refs as peeled commits). The verifier checks tag order and ancestry (`pnpm tsx paper/prereg/check-ledger.ts`).

| Freeze | Content | Must precede |
|---|---|---|
| F1 `freeze-operators` | Response- and patch-mutation operator catalog (§5.4) | F2 |
| F2 `freeze-vocab` | Vocabulary + evaluator (+ `enum`, `crossField`, `pageComplete`, and `disabled` handling with the `reenable` option, round 6) + `fpCapability` table; `scripts/contract-disable.mjs`; each Domain's `frozenClock` constant (round 6); shop-mcp re-vendor commit and `base-shop`; **public docs of both domains (OpenAPI + prose) and every authoring brief (catalog, contract-author, drift, evasive, benign, fixer, rater), with sha256** and the no-bound check result | A0 |
| F3 `freeze-analysis` | `paper/scripts/**`, incl. a passing `simulate_null.py` | F5 |
| F4 `contracts-frozen-v1` | Extended catalogs (both domains, with `authorBatch`); tracker contracts, shop-blind, LLM-authored (3 seeds/domain); `seed-tracker-v1`; A0 S-dev record | F4b |
| F4b `frame-frozen` | Frame instance F, n_F, N_E, attribution, family map, cell list and K; result of the N_E rule; crit and power at N_E; m. No verdict on F computed | F5 |
| F5 `prereg-v1` | PREREG.md (§3, §3.0 oracle, §5.7 rules, §9); REGISTRY.json (blob hashes incl. HOLD, ARMS `FIDELITY.md`, judge candidate prompts) | any blind drift exists |
| F6 `blind-sealed` | `vats98754/driftbench-blind` commit hash (private) | R0 |
| F7 `enum-frozen` | Per-drift enumerations + split file | any verdict on the test split |
| F8 `prereg-v1.1` | K1 addendum (cut-order position, a, models, workers, judge variant, σ_d and MDEs/IUT power) from dev data and throughput only | R2 |
| F9 `eligible` | Detected test drifts (drift-attributable, + top-up), frozen per-drift trace hashes and their IV sidecar hashes (round 6) | pool, R3, R4 |
| F10 `pool-frozen` | Primary patch pool hash; per-drift `requestChanging` flag (§3.0, from ref A only) | R3, R4 |

Other controls:
1. **Third-party injector.**
   - Drifts are response-rewriting rules for `packages/injector`, built by a builder who never reads contracts. A lint rule forbids importing `@fiks/contracts`.
   - The tool server is unchanged, so "the upstream changed, the tool did not" holds by construction (M1).
2. **Blind authoring exports.**
   - Physical directories outside `~/fiks`, built from a manifest.
   - Drift-author exports hold only: vendor v1 source; the domain's public docs (OpenAPI + prose, frozen at **F2**, before A0); the MCP server `src/` and non-fiks config at base; and a generic taxonomy brief (C3 categories [C3] and R1–R25 symptom classes, no fiks vocabulary).
   - Excluded from **every** export, and checked by acceptance: `test/fiks/**`, `*.contracts.json`, `evaluate.ts`, `test/repro/**`, `test/traces/**`, `.git`, and any file containing `fiks_receipt`, `@fiks/` or `outcome contract`.
   - The tracker contract-author export holds only docs + the 30 v1 calls.
   - The catalog-author export holds only the public docs and the brief.
   - **Docs and brief freeze (round 4).** Both are hashed at F2. Pre-registered: neither states a price, a total, a date window or any other contract-derived bound. Mechanical check (BLIND `check-no-bounds`): the catalog brief contains no numeral except the batch size; the docs contain no numeric bound on any field a contract constrains. `packages/vendor-api/openapi.json` at ec241bc has no price example or bound (`grep -n "example\|minimum\|maximum" packages/vendor-api/openapi.json` shows only `minimum: 1` on order quantity). The shop prose docs (`packages/vendor-api/docs/shop.md`) are written by the CORE builder, who has read the contracts; this is recorded in the F2 ledger entry, and the no-bound check is the mitigation. The tracker docs are written by DOM2 before any tracker contract exists, including DOM2's own dev-only stub contract for TRK-DEV-1 (commit order checked).
   - Sessions:
     - `settingSources: []`, cwd = export dir.
     - No WebFetch/WebSearch; Bash runs in a `--network none` container.
     - Every tool call is logged.
     - A forbidden read excludes the drift (recorded).
3. **Taxonomy overlap stated.** Briefs and the vocabulary share the C3 taxonomy. The evasive stratum, the S12 quota and the mutation suite are the counterweights.
4. **Realism review.** A separate LLM rater (Sonnet) scores each drift 1–5. Reported as an LLM rating (D6), never used to filter.
5. **Dev/test separation and tuning (round 4).**
   - Prompt tuning and harness debugging happen on dev only.
   - **fiks is frozen:** 0 further iterations of the repair prompt (`packages/repair/src/prompt.ts`) and repro generator (`packages/repro/src/generate.ts`) after this plan; any change is a deviation.
   - **Prior fiks tuning history, reported quantitatively** (Appendix H; corrected in round 7): both files were added in 2 commits (609c9e8, 8c7daa8; 157 lines) and not modified since. fiks opened **10 repair PRs** on vats98754/shop-mcp from `fiks/*` branches: #1–#5 and #7–#11 (`gh pr list -R vats98754/shop-mcp --state all`). #5 was closed as a duplicate (a second price.notNull fix), and #6 is a harness PR, not a repair. #1–#4 and #7 are merged; #8–#11 are open. #1–#5 were opened on 2026-10-18 between 09:23Z and 10:09Z, before 8c7daa8 committed the prompt files (11:04Z), so they were part of the in-session development of that prompt. #7–#11 were opened on 2026-10-20/21 with the committed prompt. Only 5 runs are in the loop log (`bench/results/loop/events.jsonl`: 5 `repair_started` events, one per D1–D5; `bench/results/loop/repairs/`: 5 traces). Other unlogged in-session iterations during the hackathon are unknown and stated as such.
   - **Comparators get a matched, documented budget:** each of L1, COMP and REPRO-AGENT gets ≤ 10 logged prompt iterations on the dev split (29 instances; round 7: 10, matching fiks's 10 documented repair PRs), and each judge variant ≤ 5 (judges are compared with the contracts, not with fiks's repair prompt), each logged with its prompt hash and dev result in `paper/prereg/TUNING.md` before F8. This is at least fiks's documented exposure (10 repair PRs on D1–D5, 5 of them in the loop log), and it is reported next to fiks's history.
6. **Single-family residual.** Authors, fixers, judges and repairers are Claude. Open-weight ideation and held-out traffic are the only second-family inputs; stated.

### 5.3 Benign evolution

The benign author writes 15 per domain:
- a new optional field;
- a new documented enum value;
- a widened legitimate range (e.g. a premium product above $2,000);
- array reordering;
- a deprecated field with its alias kept;
- a new pagination parameter with an unchanged default;
- a documented unit change *with* a new explicit unit field.

A random half get a vendor changelog entry. Ground truth: hidden tests pass on the unmodified base, and the correct fiks outcome is no violation or a contract-update proposal. Benign cases feed E4 and H1 sensitivity only.

### 5.4 Predeclared operators (frozen at F1)

Response-mutation operators are applied offline to every distinct recorded v1 upstream response of both domains, and the server is re-run on the mutated body (E3):
- M1/M2: numeric ×100 / ÷100;
- M3: rename (fixed synonym table);
- M4: drop field; M5: null field;
- M6: truncate array to 5, keeping `total`;
- M7: number → string;
- M8: ISO-8601 → epoch ms; M9: epoch s ↔ ms;
- M10: unknown enum value;
- M11: string perturbation;
- M12: identity swap;
- M13: stale timestamp (−400 d);
- M14: phantom write.

Benign controls B1–B4: reorder array; add unknown field; JSON whitespace; extra header.

Patch-mutation operators are applied to ref A by Haiku with committed prompts, and every result must typecheck:
- P1: clamp to contract range;
- P2: constant in-range value;
- P3: special-case the recorded id/args;
- P4: partial fix;
- P5: version-unaware fix;
- P6: refuse / return null;
- P7: coerce anything;
- P8: echo the request without persisting.

### 5.5 Repro baseline inputs and F check

- **Inputs.** REPRO-AGENT receives the same alert JSON, frozen raw trace and replay-helper sentence as L1/COMP (§6.2).
- **Task.** Write one new test file under `test/` that reproduces the issue on the current code. A fixed sentence in the task text (round 5) says: "Load the recorded exchange from `.alerts/<id>.json` with the repository's replay helper (`test/fiks/replay.ts`, or `test/fiks/run.ts`/`check.ts`, which wrap it); do not copy it into the test." This lets `accept()` re-record it like the fiks fixture (§3.2). Tests that inline a recording anyway are kept as they behave and flagged.
- **Budget.** 1 session, 30 turns.
- **F check** (harness, sandbox image, 3 runs). The agent's test file must:
  - load without error;
  - report ≥ 1 assertion failure in all 3 runs on base.
- **Feedback.** When the agent ends its turn and F does not hold, the session resumes with one fixed message: "Your test does not fail on the current code because of the reported issue: <first 40 lines of the runner output>. Revise it so it fails on the current code." At most 3 F rounds within the 30 turns.
- **Recorded:** the first test (unfiltered, for s1), the final test (primary), the F verdict per round, and the turns used.
- **Fairness.** The F check uses only base, never ref A, B or any fix. FIKS's own F gate has the same information.

### 5.6 Patch pools (H2)

- **Primary pool.** Arm-independent; built after F9 and frozen at F10, before R3/R4.
  - Candidates: P1–P8 applied to ref A; ≥ 4 "plausible but wrong" patches (Haiku); ref A; ref B; ≥ 2 alternative fixes by Sonnet from the drift description and base source, written without seeing A or B.
  - **Every pool patch's class label comes from the held-out oracle grade (§3.0), never from its generator (round 4).** Some operators (P4 partial fix, P5 version-unaware fix, P7 coerce) can be correct on some drifts; such a patch enters the correct class. Labels by generator vs by grade are cross-tabulated and reported.
  - Dedupe by normalised diff.
  - Drifts with < 3 patches in either class are excluded from H2 (count reported).
- **Secondary pool.** Every candidate captured at any gate or CI invocation in R4, deduped, with a stratified cap of 30 per drift (seeded). Used in E5 only, by source arm.

### 5.7 Frames and enumerated traffic

- **F (H1).**
  - Generated by `pnpm fiks enumerate --frame --catalog extended-only --seed <s>`.
  - Recorded by `pnpm fiks record --frame --monitor none --in <enum.jsonl>` on `base-shop` / `seed-tracker-v1` (outputs, upstream exchanges, `truth()` comparison; no contract evaluation).
  - `pnpm fiks frame-k --records <dir>` then computes n_F, the Clean set, the eligible inputs, N_E, the attribution, the families, the cells and K, using the records, path resolution, `fpCapability` and `originEntity` only.
  - The N_E rule is applied at that point. Everything is frozen at F4b (§3.1).
- **S-dev.** `pnpm fiks enumerate --frame --catalog original` + the A0 author calls + known-good inputs + fixtures. Recorded at A0 (D11).
- **Per-drift enumeration.**
  - Covers tools touching the drifted endpoint × (the original catalog + a seeded 50-entity extended sample) + the query grid; ≈ 20–150 calls per instance.
  - Command: `pnpm fiks enumerate --drift <id>`. Frozen at F7.
  - Recording and trace freezing happen at R2 (`record`, `freeze-trace`); the hashes go into F9.
  - The extended sample is kept (it widens detection beyond the 15 original products). Its FP risk is handled by the v1 control (§3.0, round 6): every per-drift call is also recorded without the injector rule, and only drift-attributable violations count.

### 5.8 Held-out oracle construction

- Hidden tests, refs A and B, renamed-id variants and differential generators live only in `vats98754/driftbench-blind`, mounted read-only into the grading container.
- Drifted behaviour during grading comes from the drift's injector rule (`packages/injector`).
- Before R5, reads of test-split paths are logged and limited to automated validity checks (R0).
- SAST runs on diffs only. CodeQL is dropped.

### 5.9 Held-out multi-model traffic

- Per domain, the catalog author writes 20 task prompts.
- Agents: Opus, Sonnet and Haiku through the Agent SDK, and one ollama model through a minimal MCP-client chat loop [verify ollama route]. 3 trials each.
- Only tool-call args are kept (oracle criterion 5, stratum S-agent).
- The ollama share runs only under the §8.2 wall-clock rule.

### 5.10 Real-bug wave 1 (private vats98754 clones only, E7)

- **Targets:**
  - R10: modelcontextprotocol/servers #4887 [mcp-memory-4887];
  - R19: mongodb-mcp-server #561 [mongodb-561];
  - R20: GLips/Figma-Context-MCP #364, fix PR #367 [verify: no bibliography key yet; listed in `real-bugs-mcp.candidates.json`];
  - R9: cloudflare/mcp-server-cloudflare #468, open fix PR #469 [verify: no bibliography key yet; listed in `real-bugs-mcp.candidates.json`].

  R20 and R9 are not cited in paper text until a verified key exists (added by the Certify-phase citation verifiers, §12 row 2).

  Sources: `paper/research/real-bugs-mcp.candidates.json`.
- **Reserves:** servers #3137 (RB-R10's repo) and #4628 (RB-R19's own reserve repo); R14 only if FSL-1.1 permits copying [verify].
- **Clone location (round 6).** Every clone lives under the gitignored, biome-excluded `.work/`: `.work/realbugs/<id>` (created by RBX `scripts/ensure-realbugs.mjs` from `realbugs/<id>/pins.json`, with local tags `prefix` and `fix`) and `.work/tracker-mcp` (DOM2 `scripts/ensure-tracker-mcp.mjs`, run by the root pretest). `realbugs/<id>/` in the fiks tree holds metadata only (pins, contract, fixtures, harness, heldout, issue, adapter). A nested clone there would be a gitlink without `.gitmodules`, absent from every worktree and clean clone.
- **Repositories (round 4).** Never GitHub forks: `gh pr create` in a fork defaults its base to the upstream parent. Each bug uses a plain `git clone` of upstream pushed to a **new private repo** under vats98754 whose name is recorded in `realbugs/<id>/pins.json` `repo` and resolved by RBX's `ensure-realbugs.mjs` (round 7: there is no `rb-<id>` repo; the names are `rb-r10-servers`, `rb-r19-mongodb-mcp-server`, `rb-r19r-servers` for the #4628 reserve, `rb-r20-figma-context-mcp`, `rb-r9-mcp-server-cloudflare`), with `origin` set to that repo and no `upstream` remote. One repo per stream, so ownership is disjoint. Licences are kept.
- **Protocol** (steps follow SYNTHESIS §7):
  1. Clone (into `.work/realbugs/<id>`) and pin the prefix/fix SHAs; push to the stream's new vats98754 repo.
  2. Write a blind contract from the symptom only.
  3. Replay at process level over MCP stdio with a base-URL override.
  4. Label fixtures as recorded vs synthesized.
  5. F on the prefix and P on the human fix (10 runs each).
  6. FIKS vs COMP vs ISSUE-TEXT (Opus × 5), dispatched and graded by RBA (WORKSTREAMS) after the RB stream's F/P harness passes. Descriptive (E7).
  7. Check for duplicates and already-fixed bugs.
  8. Run everything sandboxed.
  9. Report a contamination stratum.
- Not pooled with H2–H4. The fixed versions feed S-realfix.

### 5.11 τ²-bench

Cut (§13). A drift layer over τ² would repair a wrapper we would write ourselves, for 15–25 h of adapter work [SYN G11].

---

## 6. Implemented baselines and fidelity notes

### 6.1 Detection (E3; offline replay over identical CallRecords; labels from `truth()`)

| ID | Baseline | Implementation | Fidelity |
|---|---|---|---|
| B-SCHEMA | MCP SDK client `outputSchema` validation | Pinned `@modelcontextprotocol/sdk` client validation on recorded results [mcp-ts-sdk-client-validation] | Real code |
| B-AJV | Strict JSON Schema | Ajv 2020-12 strict + ajv-formats; every spec-derivable constraint | Strongest schema-only form (X1) |
| B-JUDGE / B-JUDGE+U | LLM judge without / with the raw upstream body | Agent SDK `query`, `tools: []`; Sonnet and Haiku; JSON `{verdict, property, confidence}`; ≤ 5 prompt iterations on dev; variant chosen on dev BA (tie → cheaper), named at K1 | Emulates LLM-scan products (e.g. [altk-silent-review] [langsmith-engine-docs]) from docs |
| B-SNAP | Snapshot / recorded-response diff | Field set, JSON types, log10 magnitude bucket, array length vs `total` vs the v1 recording | Reimplements Gilesi-style and Hoverfly-Diff behaviour [monce2025gilesi] [hoverfly-modes] |
| B-STAT | Windowed statistics | AegisFlow-style KS on numeric leaves, null-rate jump, history range (w ∈ {20, 50}); Evidently-default emulation | AegisFlow released no code [awan2026aegisflow]; Evidently defaults per pinned docs [evidently-drift-docs] [verify] |
| B-TRIG | Error / spec-diff / compile triggers | `isError`/exception; oasdiff v1 vs drifted spec; `pnpm typecheck` | 0 fires by construction (D2) [oasdiff-breaking] |
| B-LLMC | LLM-authored contracts | Opus writes a contract file from tool descriptions + 20 S-dev samples; 3 seeds/domain; fiks evaluator | Ours |

### 6.2 Repair arms and repro baseline

Shared by every arm:
- The same frozen detector and frozen trace (raw), and the same model.
- The same Agent SDK harness: `settingSources: []`, no MCP servers, CLI fallback disabled.
- The same sandbox image, and the same Bash allow-list: `pnpm typecheck|lint|test`, `pnpm exec vitest run`.
- The same write guard: edits only under `src/`; new test files only where stated; existing tests, fixtures and traces read-only.
- The same re-record service, at the same points and in the same place (inside the per-attempt container, round 6): CORE `rerecord-head` with the drift's profile on the candidate head before every replay-based check (P, IV, suite, stored traces, local CI; every L1 session gate and every COMP revision; §3.0).
- The same IV property set: `fiks-iv --properties <trace>.iv.json` (ivProperties only, §3.0), in L1/L1p pre-PR and in COMP's CI. The `RerecordLog`s are stored and compared across arms on D3/D4 (WORKSTREAMS ORCH, ARMS, INTEG).
- The same `--domain` dispatch: each Domain supplies the edit allow-list (`allowedEditPaths`), the suite and the prompt hints (shop, tracker, and `rb-<id>` via RBA).
- Budget: per session, 30 turns and a $5 cap; ≤ 4 sessions per attempt; a 90-minute wall-clock cap.
- The same hermetic local CI mirroring `ci.yml`.
- Arm order is randomized within each (drift, model, attempt-index) block.

| Arm | Pipeline | Differs from FIKS | Fidelity |
|---|---|---|---|
| **FIKS** | frozen trace → named-property repro → F gate (3 runs) → committed read-only → agent (sees the repro) → P + suite + traces + typecheck/lint → local CI → `would_open_pr` | — | The product at the frozen commit with P1–P21 |
| **L1** | alert + frozen trace + replay-helper sentence → agent (may add new test files) → suite + traces + typecheck/lint + **IV (pre-PR)** → local CI → `would_open_pr` only if all are green. Failures (incl. the IV property id and message) are fed back, ≤ 4 sessions | No fiks repro, no F gate, no visible named-property test; the trigger check is hidden until it fails | Our ablation |
| **COMP** (confirmatory) | alert + frozen trace + replay-helper sentence → agent told "reproduce the issue first, then fix", may add test files → `would_open_pr` on the first non-empty diff → local CI = repo CI (incl. contract suite and stored traces) **+ IV** (violation ⇒ red with property id) → red log fed back, ≤ 3 revisions within 90 min → final head graded | No repro, no pre-PR gates | Alert/webhook-triggered agents [devin-automations] [devin-oncall] [cursor-automations] [copilot-coding-agent]. CI iteration after a PR opens [sentry-seer-issue-fix] [datadog-bits-dev-agent] [posthog-anatomy-pr]. "up to three revisions or 90 minutes per chain" and "replays each source run against its fix preview deployment" are quoted from [langsmith-changelog-2026] (week of Oct 5–12 2026) in `packages/arms/FIDELITY.md`. Both strings appear in the verifier evidence of `verify/observability-1.json` (verdict WRONG_METADATA: location only). ARMS's re-fetch must record both verbatim; if either is missing, that parameter is labelled "our parameter". How Engine judges a replay is not stated in any verified passage [verify]; ours uses the deterministic contracts. Not emulated: proprietary RCA, vendor models, telemetry, their sandboxes |
| L1-noIV (E1, Opus) | L1 without IV (the round-2 L1) | — | Exploratory rung |
| COMP-norep (E1, Opus) | COMP without IV | — | Exploratory rung |
| COMP-plain (E8, Opus) | COMP-norep; repo CI runs only the server's own tests | Typical-repo CI | Exploratory rung |
| L1p (E1, Opus) | As L1 (incl. IV), with the alert in prose only: no trace file, no helper sentence | No raw evidence | Separates input from gating |
| **REPRO-AGENT** (H2) | alert + frozen trace + helper sentence → one test under `test/` → F check with feedback (§5.5) | No fix | Emulates "reproducing the issue" [devin-oncall] and regression-test PRs [posthog-anatomy-pr]; F filtering as in [mundler2024swtbench] |
| FIKS+CU (E4) | `pnpm fiks repair --arm fiks+cu` (ORCH). FIKS, but the agent may end with `{outcome: contract_update, delta}`. CU's `acceptDelta` gets the frozen trace, every stored trace, the clean v1 corpus (A0 S-dev CallRecords) and MUT M1–M14 variants of the trigger. Accepted: contract proposal, outcome `contract_update_proposed`, no PR. Rejected: the reasons are fed back and the attempt continues as code repair within the same budget | — | Ours |
| ISSUE-TEXT (E7, Opus) | The upstream issue's title and body only (no trace, no alert, no helper sentence) → agent → repo CI after the PR as COMP (≤ 3 revisions, 90 min) | No runtime evidence | Ours (ARMS); run on real bugs only, through RBA |

**Alert payload.** The bytes are identical for L1, L1-noIV, COMP, COMP-norep, COMP-plain and REPRO-AGENT; L1p lacks only the trace path and the helper sentence. It is webhook-style JSON rendered to prose with:
- tool, args, violated property id and message;
- receipt text;
- the path `.alerts/<id>.json` (read-only; sha256 = frozen trace);
- the sentence "The repository's `test/fiks/replay.ts` replays a recorded upstream exchange like this one against the server."

---

## 7. Required fiks product changes

All land before F5. The frozen commit is recorded in every `meta.json`, and runners refuse a dirty tree.

| ID | Change | Owner |
|---|---|---|
| P1 | **Sandbox.** `canUseTool` rewrites agent Bash to `docker exec` into a per-attempt container: `--network none`, env = `{PATH, CI=1, HOME=/tmp}`, limits, pinned image digest. Per-repo Linux image with lockfile `node_modules` and an offline pnpm store. F, P, suite, re-record replay, IV and local CI all run in the image. **Round 6:** this includes `rerecord-head`, which starts the vendor, injector, tap, harness and the candidate head's server. They run from a read-only **fiks-tools** mount (`/opt/fiks`: Linux image built from `git archive` of the fiks commit, so no `.env`, `.fiks` or `.work`; Linux esbuild/tsx; round 7: during the build the commit is the latest merged main, rebuilt after each merge, and streams that need their own unmerged code inside build a test-only image with `--ref HEAD --apply-fragments`; runs use the frozen commit's image) via `execFiks`, with `--network none` (loopback only) and env {PATH, CI=1, HOME=/tmp, FIKS_DIR=/tmp/fiks, FIKS_IN_SANDBOX=1}. CORE's `--require-sandbox` exits 2 outside it, and no arm or grader spawns `rerecord-head` on the host. Acceptance (ORCH, repeated by INTEG through L1, COMP and HOLD): a planted head that reads `~/fiks/.env` and `$HOME` and tries egress during re-record gets ENOENT, HOME=/tmp and a logged egress denial. RUN refuses R1 and R3–R8 until this preflight passes. Host agent env = OAuth token + PATH + temp HOME. Canary `GH_TOKEN=fiks-canary-…`. If the SDK cannot rewrite Bash, the whole agent runs in the container (stated) | SAFE, SBX, CORE, ORCH, ARMS, HOLD, RUN |
| P2 | **Read containment.** `mayRead` via `fs.realpathSync` refuses paths/symlinks that resolve outside the worktree. Same rules for CLI Read/Glob. CLI fallback disabled in experiments | SAFE |
| P3 | **Strict-format trace.** `--trace-format raw\|strict`: typed diff, constrained field paths, no vendor free text, hidden Unicode stripped, 64 KB cap, sanitized gate output. Strict `mayRead` denies fixtures, `test/repro/*.json`, `test/traces/**` and raw alert bodies. **Used only in E6** | SAFE |
| P4 | `--ci local\|github\|none`; experiments use `local`. A git shim records any `push`; acceptance = zero pushes | ORCH, SBX |
| P5 | PR owner allow-list (`vats98754`) in `pr.ts`, checked on the **base** repository: `createPr` always passes `--repo vats98754/<name>` explicitly, resolves the base repo with `gh repo view --json owner,isFork,parent`, and refuses if the base owner ≠ vats98754 or if the repo is a fork whose parent owner ≠ vats98754 (where `gh pr create` would default the base upstream). Head owner is checked too. `--no-pr` is the default whenever `--arm` or `--run-key` is set, and experiment mode makes no `gh` call at all. The PR body states the trace is untrusted and carries hashes | SAFE, ORCH |
| P6 | RunKey `experiment/arm/model/domain/drift/attempt`. Results never overwrite. Per-process `FIKS_DIR`. Worktree ops under a file lock or a per-worker clone | CORE, ORCH |
| P7 | Injector-aware profiles: (domain, base version, injector rule id, rule hash). `rerecord()` restarts the injector in the chain | CORE |
| P8 | Domain registry (`--domain shop\|tracker`) threaded through harness, scenario, record, rerecord, repro, repair, bench, summarize, paths and prompt hints. Vendor `--catalog original\|extended-only\|all`. `entityClass` and `originEntity` for every tool. **Domain hooks (round 5):** `reproEmitter` (repro test files in the target repo's layout), `suite` (test command + scope; F requires exactly one failing test inside the scope) and `allowedEditPaths` (repair guard). CORE wires them into `packages/repro` generate/gate; SAFE takes the allow-list as a parameter. Shop defaults are byte-identical to ec241bc (`reproSource`, whole vitest suite, `^src/.+\.ts$`) | CORE-SEED (types), CORE (registry, shop, wiring), DOM2 (tracker), SAFE, ORCH, ARMS, BENCHX |
| P9 | Monitor interface `ProxyOptions.monitor`, `--monitor`, log-only mode, offline replay evaluator over CallRecords. Round 6: every CallRecord keeps its evaluation instant (`at` → `capturedAt`, also under `--monitor none`); `replay-cli` evaluates with `now := capturedAt`, never the system clock; `--reenable <ids>` for disabled properties; round 7: `--per-element` (one row per violating element, via VOCAB `EvalOptions.perElement`; live receipts unchanged) | MON (CORE threads the frozen clock into `ProxyOptions.now`) |
| P10 | Cost/tokens, turns and wall time per phase; 3 retries with backoff; `infra_error` never graded as a model failure | LLMR, SAFE, BENCHX |
| P11 | Arm hook, `would_open_pr` event, candidate capture at every gate and CI invocation; `--trace-format raw\|strict` passed through to SAFE by `fiks repair` and `fiks arm` (E6 utility rows); `--agent-stub <script>` (SAFE stub runner, zero LLM calls) on every arm for tests and `pnpm exp --dry` | ORCH, ARMS, SAFE |
| P22 | **Real-bug adapter.** A Domain per real bug, built from `adapter.json` through the P8 hooks (repro test in the clone's own runner layout plus its RBX-replay check module, emitted into the worktree; suite = the declared offline `suiteScope`; `allowedEditPaths` per repo, e.g. `apps/*/src` for cloudflare). `fiks repair --arm fiks --domain rb-<id>` / `fiks arm --name COMP\|ISSUE-TEXT --domain rb-<id>` on the `.work/realbugs/<id>` clone (RBX `ensure-realbugs.mjs`; round 6), and grading of heads against the human-fix tests and `heldout/`. RBA owns no CORE, ORCH or ARMS file | RBA (adapter), RB-* (`adapter.json` fields) |
| P12 | Contract-update outcome gate: the trigger verifies; stored true-violation traces still violate; the clean v1 corpus verifies; mutation variants are still rejected except on the amended property. Output is a contract-change proposal, never code. ORCH's `--arm fiks+cu` assembles the inputs (frozen and stored traces, clean v1 corpus, MUT variants of the trigger) | CU (gate), ORCH (arm), MUT |
| P13 | F-gate runs parameter (3 in the product; 10 for D3) | CORE |
| P14 | LLM route: every LLM call goes via Agent SDK `query` (`tools: []` where applicable, `systemPrompt` override, `settingSources: []`) | LLMR |
| P15 | Vocabulary: closed-world `enum`, `crossField`, `pageComplete`; receipt text; `fpCapability` table. Round 6: `disabled: true` on a property = not evaluated, listed under `receipt.disabled[]`, re-enabled only by the `reenable` option (MON `replay-cli --reenable`); `scripts/contract-disable.mjs` is the only tool that sets it (listed ids only; D11 log). Shipped in the `base-shop` re-vendor commit; re-vendored into tracker-mcp by ORCH `seed-tag`. Frozen at F2. Shop contracts unchanged | VOCAB (ORCH re-vendor) |
| P16 | Unprivileged CI template (`permissions: contents: read`, no secrets) for `tracker-mcp` | DOM2 |
| P17 | **Local-ref worktrees.** `createWorktree(repo, ref)` resolves `<ref>^{commit}` for local branches and annotated or lightweight tags, with no fetch. `--fetch` is refused with `--run-key`. `DriftPackage.base` | CORE, ORCH |
| P18 | **CLI loader.** `main.ts` glob-loads `bootstrap/*.ts`, then `commands/*.ts`. A default export `{name, describe, run(argv)}` in `commands/` overrides CORE's `legacy/<name>.ts`. No switch in `main.ts` | CORE |
| P19 | **Re-vendor + pinned sync.** The shop-mcp re-vendor commit = `base-shop`, on a branch (round 7; main moves only at VOCAB's merge). `sync-contracts.mjs --check --ref <peeled sha>`. `sync.test.ts` uses the pinned ref. `ensure-shop-mcp.mjs` fetches tags and the pinned ref, then checks it out (round 7) | VOCAB |
| P20 | **Detection pipeline.** `enumerate`, `record --frame\|--drift\|--benign\|--mutant` (incl. `--monitor none` for the pre-F4b frame record), `freeze-trace`, `frame-k --records` (Clean, N_E, attribution, families). Round 6: v1 control per drift/benign call (unmutated record for mutants), drift-attributable detection, freeze-trace on the first attributable violation (round 7: full `violated` list kept, `target` = first attributable property) plus the `<trace>.iv.json` sidecar, `nonattributable.jsonl`, and the Domain's `frozenClock` for vendor and proxy in every record run | DET |
| P21 | **Issue validation.** `fiks-iv --trace <file> --properties <trace>.iv.json` replays a trace on a head through the frozen contracts, restricted to ivProperties (round 6; exit 1 + property id on violation), on the P23 re-recorded copy when the head changes the requests. It runs as a `ciLocal` extraCheck: pre-PR for L1, post-PR for COMP | ARMS (uses SBX `ciLocal`, CORE `rerecord-head`) |
| P23 | **Re-record parity (round 5).** `pnpm fiks rerecord-head --worktree --profile --from --log` is the only re-record entry point. It runs `rerecordStale` plus per-check overlay re-recordings of every other recording a check reads, through the drift's injector chain, and writes a `RerecordLog`. Called by subprocess before every replay-based check in every arm (§3.0) and by `accept()`/grading | CORE (service); ORCH, ARMS, HOLD, RBA (callers) |

### 7.1 Build plan (detail in `paper/WORKSTREAMS.json`)

- **Scale.** 30 streams, 574 builder-hours★ [estimate] (`python3 paper/scripts/check_workstreams.py paper/WORKSTREAMS.json` prints "est_hours total: 574"; round 6 summed to 558, round 5 to 531, round 4 to 496, round 3 to 461; the round-6 additions are listed in §0.000, the round-5 ones in §0.00). Each stream works in its own worktree, needs a verifier PASS before merge, and streams merge one at a time. `paper/scripts/check_workstreams.py` passes on the file. It checks: parse; disjoint ownership globs by exact glob intersection; reserved run-output paths unowned; acyclic DAG; waves respect dependencies; and, since round 5, no acceptance diff against a fixed sha, every `[LIVE]` item behind `live-lock.ts`, and every run component in REQUIRED_OWNED owned by some stream's deliverables. Round 6 adds: no owned `.work/` glob and no `realbugs/<id>/repo` clone path; no "oracle src diff" from the shop-mcp fix commits; no `*.test-d.ts` run without `--typecheck`; REQUIRED_OWNED gains `capturedAt`, `drift-attributable`, `ivProperties`, `contract-disable.mjs`, `ensure-realbugs.mjs`, `ensure-tracker-mcp.mjs`, `fiks-tools`, `--require-sandbox` and `rerecord-containment`. The script fails on the round-5 file with 19 errors★ (`python3 paper/scripts/check_workstreams.py <round-5 copy> | grep -c '^FAIL'` → 19). Round 7 adds: no re-vendor push to shop-mcp main; no `pnpm exp <run>` in any acceptance before INTEG (use `pnpm tsx packages/exp/src/main.ts`); a stream whose acceptance uses shop-mcp refs runs `node scripts/ensure-shop-mcp.mjs` in SETUP (or a `pnpm test` item); REQUIRED_OWNED gains `--per-element`, `perElement`, the contract-author `--protocol`, `D4-plantedfp`, `build-tools.ts`, `Run R11` and `tracker-sync-ref.json`. Each new rule was checked to fail on a mutated copy. The script passes on this file.
- **Merge discipline (round 7; an orchestration rule, binding on the orchestrator and every builder).**
  - Streams merge into fiks main one at a time, each after its verifier PASS.
  - **After every merge, every open stream rebases onto the new fiks main before its next verification.** It then re-runs SETUP (fragments, install, `ensure-*` scripts). A verifier PASS obtained on a base older than the latest merge does not count, and the merge is refused until the stream re-verifies.
  - External side effects that other streams' tests can see take effect only at the owning stream's merge:
    - shop-mcp main is fast-forwarded to `base-shop` by the orchestrator at VOCAB's merge; VOCAB itself pushes only a branch and the tag;
    - tracker-mcp follows the same rule, pinned in `packages/vendor-tracker/tracker-sync-ref.json`;
    - the fiks-tools image is rebuilt from the latest merged main, and its digest is logged in PROGRESS.md.
  - `pretest`/`ensure-shop-mcp.mjs` and `ensure-tracker-mcp.mjs` check out the pinned ref recorded in the fiks repo, never a moving branch.
  - The orchestrator logs each merge, each rebase and each external step in PROGRESS.md.
- **Builder concurrency and the OAuth token (round 4).** The workflow is capped at about 6 concurrent agents on this Mac, and builders, verifiers and runs share one OAuth token.
  - At most **4 builders + 2 verifiers** run at once.
  - Acceptance items tagged `[LIVE]` (LLMR smoke; ORCH live D2 and DEV-X1 repairs; ARMS 7-arm Opus run on D2; TRAFFIC live collection; RBA one-bug run) run one at a time across all streams through LLMR's `live-lock.ts`.
  - The orchestrator creates `$HOME/.fiks/build-swarm.active` for the whole build phase; `pnpm exp` refuses to start any run while it exists, so **no live run (T0, A0, A1, R*) ever overlaps a builder swarm**. The only exemption is `pnpm exp … --dry` (RUN): stub agents through SAFE's stub runner and `--agent-stub`, with `FIKS_LLM_FORBID=1` in every child, so it cannot make a Claude or ollama call (LLMR throws `LlmForbiddenError`). INTEG's end-to-end dry run uses this mode.
  - Weekly subscription caps used during the build reduce what is left for runs. T0 runs after the build and measures the remaining headroom; K1 fits W to that headroom, not to a fresh week.
- **CORE-SEED** (wave 0; its own DAG node, merged before any wave-1 builder branches):
  - `packages/interfaces` (Appendix types);
  - `packages/domains/{package.json, src/index.ts, src/registry.ts}`;
  - `@fiks/domains` and `@fiks/interfaces` added to `packages/cli/package.json`;
  - `packages/cli/src/bootstrap/README.md`;
  - `scripts/apply-dep-fragments.mjs`.

  Wave-1 streams depend on CORE-SEED and may import only the seed. Anything else they need comes in as plain parameters (e.g. an injected `llm` function). Interfaces are frozen at the seed; a change is a seed amendment by the orchestrator, followed by re-verification of every merged dependant.
- **Wave 1** (16 streams, each depending only on CORE-SEED): CORE, VOCAB, MON, SAFE, SBX, BENCHX, LLMR, MUT, INJ, DOM2, CU, SEC, RBX, AN, PREREG, BASE.
- **Wave 2** (11 independent streams): ORCH, ARMS, DET, BLIND, TRAFFIC, HOLD, RUN, RB-R10, RB-R19, RB-R20, RB-R9.
  - New CLI commands are new files or default exports in owned files (P18).
  - Bootstrap files are owned per file: `00-shop.ts` by CORE; `10-tracker.ts` by DOM2; `20-sandbox.ts` and `30-injector.ts` by ORCH; `40-realbugs.ts` by RBA.
  - Arms are dispatched by subprocess, so no wave-2 stream imports another.
- **Wave 3** (2 streams): INTEG and RBA, in parallel. INTEG covers root files, the lockfile, root scripts, an end-to-end dry run, agent-ux-tester on the MON/BENCHX changes, and a clean clone from the local path (`git clone /Users/anvayvats/fiks`; round 7). The dry run is `pnpm exp R1 --dry --dev --drifts D1,D2,D3,DEV-X1,TRK-DEV-1 --models claude-haiku-5-5 --attempts 1`, with stub agents. It grades every head with HOLD's (D1–D3, DEV-X1) and DOM2's (TRK-DEV-1) dev DriftPackages and checks that FIKS, L1 and COMP have identical `RerecordLog`s on D3. RBA (real-bug adapter, P22) is not an INTEG dependency: it is needed only for R8, merges after INTEG, and repeats the clean-clone check itself.
- **External clones (round 6).** shop-mcp, tracker-mcp and the real-bug repos are cloned only under `.work/` by `scripts/ensure-shop-mcp.mjs` (VOCAB), `scripts/ensure-tracker-mcp.mjs` (DOM2) and `scripts/ensure-realbugs.mjs` (RBX). Every acceptance that needs one starts from a fresh `git worktree add` and runs the ensure script first.
- **Run outputs (round 4).** `paper/results/raw/**` and `paper/results/confirmatory.lock` are written and committed **only by run steps** (T0 … CP2), never by a builder; builder tests write to `$TMPDIR`. No stream owns these paths (checked by `check_workstreams.py`); AN owns `paper/scripts/**`, `paper/macros/**` and `paper/results/power.json`.
- **Dependency fragments.**
  - A stream adding an `@fiks/*` import into a package it does not own (in practice `packages/cli`) commits `deps-fragments/<ID>.json`.
  - Its SETUP applies all fragments locally (`node scripts/apply-dep-fragments.mjs && pnpm install --no-frozen-lockfile`) without committing the package.json or lockfile edits. The verifier checks `git diff --name-only` excludes them.
  - At each merge the orchestrator applies the fragments to the consumer package.json files and regenerates `pnpm-lock.yaml`, mechanically only, logged in PROGRESS.md.
  - New packages are picked up by the root `packages/*` workspace and vitest globs [verify at INTEG].
- **Critical path (★, est_hours, no verifier loops).** CORE-SEED (7) → CORE (37) → ARMS (40) → INTEG (15) = 99 builder-hours to T0 (`python3 -c "import json;S={s['id']:s for s in json.load(open('paper/WORKSTREAMS.json'))};print(sum(S[i]['est_hours'] for i in ('CORE-SEED','CORE','ARMS','INTEG')))"` → 99). The longest chain overall ends at RBA: 103 h★ (checker output "critical path (103 h): CORE-SEED -> CORE -> ARMS -> RBA"). With 4 concurrent builders the build is throughput-bound, not path-bound: a deterministic greedy list schedule gives **162 h★ until INTEG** (`python3 paper/scripts/check_workstreams.py paper/WORKSTREAMS.json --builders 4 --until INTEG`; 117 h★ with `--builders 6`). With verifier loops at +25% [estimate] that is 202.5 h★ (`python3 -c "print(162*1.25, 162*1.25/24)"` → 202.5 8.4375), i.e. **≈ 8.5–9 calendar days of continuous building before T0** [estimate], then T0 → A0 → F4/F4b → F5 → A1 → R0 → R1 → K1 → R2 …

---

## 8. Run plan

### 8.0 Decisions the user must make before runs (answered 2026-10-21)

**User decisions (2026-10-21, in chat):** full plan approved; private repos approved (`vats98754/tracker-mcp`, `vats98754/driftbench-blind`, the `rb-*` real-bug clones listed below, and VOCAB's re-vendor branch + tag on `vats98754/shop-mcp` with main fast-forwarded at VOCAB's merge); installs approved (one ollama 7–8B Q4 instruct model, Semgrep CE image pinned by digest, oasdiff binary, eslint-plugin-security, GitHub Actions minutes for the agreement check); the user sets up Docker Desktop at 6 GB themselves; W = 8 days stands; human review (H26) not requested. Nothing else may be created, installed or pushed without a new decision.

Original list:

1. Start Docker Desktop and set its memory to 6 GB.
2. Approve one ollama model download (a 7–8B Q4 instruct model, ≈ 5 GB [verify name]). It is used only for ideation and held-out traffic.
3. Approve:
   - new repos `vats98754/tracker-mcp` and `vats98754/driftbench-blind` (private);
   - new private repos for the real bugs (plain clones of upstream, never GitHub forks): `vats98754/rb-r10-servers`, `rb-r19-mongodb-mcp-server`, `rb-r19r-servers` (reserve), `rb-r20-figma-context-mcp`, `rb-r9-mcp-server-cloudflare`;
   - VOCAB's re-vendor commit on a `vats98754/shop-mcp` branch with tag `base-shop`, and the orchestrator's fast-forward of shop-mcp main to it at VOCAB's merge (round 7);
   - run R11 (D10, post-CP2): one showcase PR on `vats98754/shop-mcp` and one on `vats98754/tracker-mcp`, each against a `showcase/<driftId>` branch, never merged by the run.
4. Approve installs: a Semgrep CE image (digest pinned), the oasdiff binary and eslint-plugin-security. Also approve GitHub Actions minutes for the 20-head agreement check and the two R11 PRs.
5. Confirm the run window W = 8 calendar days after K1. The K1 fit uses it, and it may be changed only before F5.
6. Optional: human review (H26). The paper does not depend on it.

### 8.1 Ordered runs

Prices are API-price estimates: `total_cost_usd` under OAuth is an estimate, not a bill [verify]. The binding constraint is subscription caps. Per-attempt assumptions [estimate]:
- FIKS-Opus: ≈ $0.11–0.21 and ≈ 90 s today (codebase-map §5), plus ≈ 30–60 s for sandbox, IV and local CI.
- COMP ≈ 1.6× FIKS; L1 ≈ 1.3× FIKS.
- Sonnet ≈ 0.5× Opus; Haiku ≈ 0.2×.

| # | Run | Models | Count | API-price $ [estimate] | Wall-clock [estimate] | Checkpoint / gate |
|---|---|---|---|---|---|---|
| T0 | Throughput probe (LLMR): representative authoring and repair-like sessions at 1, 2 and 4 concurrent. Measures attempts/h, 429/overload rate, cap messages, per-call spawn overhead, and ollama tokens/s | Opus, Haiku, ollama | ≈ 30 sessions | 10–20 | 1–2 h | Sets A1 concurrency c = the largest of {1, 2, 4} with < 2% 429/overload and no cap message. Sets the ollama rule (§8.2) |
| A0 | (a) Catalog extension: ≥ 750 eligible entities per domain in independent batches of 25 (catalog author sees no contracts). (b) Contracts: tracker (isolated agent, docs + 30 original-catalog v1 calls), shop-blind sensitivity, LLM-authored × 3 seeds × 2 domains, each by BLIND's `pnpm fiks author --kind contract --domain <d> --protocol tracker\|shop-blind\|llm [--seed n]` (round 7), written to the reserved contract paths with an AUTHORING log. (c) **S-dev record** (no iteration): frozen contracts on S-dev traffic, counts stored. (d) Vendor into `tracker-mcp`; tag `seed-tracker-v1` | Opus | ≈ 70 calls/sessions | 20–45 | 3–4 h | F4. Record-only. Registered response if a primary property fires on S-dev: `node scripts/contract-disable.mjs --ids <ids> --reason S-dev` (VOCAB, frozen at F2) sets `disabled: true` on exactly those properties (ids listed, D11); ORCH `seed-tag` re-vendors the contract and the F2 evaluator (which skips disabled properties and lists them in the receipt) into tracker-mcp, so the tracker base CI is green; H1 sensitivity re-enables them offline with MON `replay-cli --reenable <ids>` (`now := capturedAt`). Any other edit is a deviation |
| — | `pnpm fiks enumerate --frame`; `pnpm fiks record --frame --monitor none` on `base-shop` / `seed-tracker-v1` (outputs + `truth()`, no contract evaluation); `frame-k --records` (no verdicts); N_E rule; catalog top-up batches if required (then re-enumerate and re-record) | Opus (top-up only) | ≤ 20 batches | ≤ 10 | < 3 h | **F4b**: frame CallRecords hash, n_F, N_E, crit, power, m |
| — | **Tag `prereg-v1` (F5)** | — | — | 0 | — | Ledger check PASS; `power.py all --check` PASS |
| A1 | Blind authoring: 150 ideas (half ollama); ≈ 150 implementations (hidden tests + ref A) to keep 120; ref B on every kept drift; ≈ 38 benign to keep 30; 150 realism ratings | Opus (+ ollama; Sonnet rater) | ≈ 470 sessions | 560–960; **ceiling $1,000 and 520 sessions** | 10–16 h at c = 4; up to ≈ 64 h at c = 1 | F6. Concurrency c from T0. **Cap-stop:** see note 1 below. Transcripts audited (forbidden reads; sentinel strings) |
| R0 | Infra validation (no LLM): validity of every drift and benign case; keep rule; split; per-drift enumerations hashed; host-vs-container F/P/IV parity on D1–D5; local CI vs Actions on 20 heads (branches only); SAST timing pilot on 20 patches | — | 150 + 38 + 20 + 20 | 0 | 4–6 h | F7 |
| — | **Containment preflight (round 6)**: `pnpm exp` runs ORCH's `rerecord-containment.test.ts` before R1 and R3–R8 and refuses to start on failure (P1); the result is in each run's `meta.json` | — | — | 0 | < 10 min per run | Gates R1, R3–R8; R7 never runs without it |
| R1 | Pilot, dev only: FIKS/L1/COMP on 29 dev instances (24 blind + D1–D5) × 3 models × 2 attempts; REPRO-AGENT dev with the F check; judge tuning ≤ 5 iterations per variant; repair throughput at 1, 2, 4 and 6 workers (round 7: 6 is the machine cap of about 6 concurrent agents, §7.1); RSS per worker; `eval_stats.py decompose` (drift × model × attempt) | 3 Claude | 522 + 174 + ≤ 800 judge calls | 140–215 | 8–14 h | **K1** → `prereg-v1.1` (F8) |
| R2 | Detection, test split: verdicts on F by offline replay of the F4b-hashed frame CallRecords only (no re-execution; `now := capturedAt`; `--per-element`, round 7); `record` (each drift and benign call with its v1 control, round 6) + all deterministic detectors over test drifts, benign cases and mutants; `freeze-trace` per drift with ≥ 1 drift-attributable violation (+ IV sidecar); judges (the K1 variant and its ± upstream twin) on a stratified 1,500-call sample × Sonnet, Haiku; replay of LLM-authored contracts | Sonnet, Haiku | ≈ 6,000 judge calls | 40–70 | 4–8 h | F9 (eligible list + frozen-trace hashes). Top-up decision (counts only). H1 computed only at CP2 |
| A2 | Top-up authoring, only if triggered (§5.1) | Opus | ≤ 40 drifts | ≤ 160–280 | ≤ 6 h | Sealed; F7/F9 re-hashed before R3 |
| P-pool | Primary pool for detected test drifts | Haiku, Sonnet | ≈ 61 × 14 ≈ 850 | 20–50 | 2–4 h | F10 |
| R9 | Held-out traffic (needed before R5): 2 domains × 20 tasks × 4 agents × 3 | 3 Claude (+ ollama per §8.2) | 480 | 15–25 | 1–2 h Claude; ollama per T0 (never concurrent with R4/R5) | — |
| R3 | REPRO-AGENT on detected test drifts (F check with feedback) | per K1 | ≈ 61 × 6 = 366 | 35–65 | 4–7 h | — |
| R4 | Main repair: FIKS, L1, COMP × 3 models × a = 4 (confirmatory blocks first, breadth-first over attempt index); then COMP-norep, COMP-plain, L1p and L1-noIV (Opus × 3) | per K1 | 61 × 36 = 2,196 + 732 | 450–720 | 30–60 h | **K2**: commit logs every 10% of blocks; status-only output; pause if infra > 10% in a 50-attempt window |
| R5 | Grading: every final head (incl. red heads), primary and secondary pools, the H2 acceptance matrix, SAST. **13 test sets per pool patch** (1 fiks + 6 agent-final + 6 agent-first = 3 models × 2 samples × 2), plus ∅. Re-record and base checks (typecheck, lint, suite, stored traces) run **once per patch and are cached**; only each T file runs per test set (HOLD) | — | ≈ 2,950 heads + ≈ 2,500 pool patches × 13 test sets | 0 | **40–75 h★ wall on 4 containers** [estimate: base 60–90 s/patch, 5–10 s per T file, 90–180 s per head]; uncached it would be 147–226 h★ for the pool alone. Re-estimated from the R0 SAST/timing pilot before K1 | 5% re-graded; must match exactly |
| CP2 | Confirmatory analysis, once, on complete data; outputs and lock committed before any exploratory script | — | — | 0 | < 1 h | Holm table emitted |
| R6 | Benign: FIKS-current, FIKS+CU (`--arm fiks+cu`, ORCH), COMP | Opus × 3 | 270 | 40–60 | 4–8 h | — |
| R7 | Security: 12 payloads × 10 carriers (D1–D5 + 5 dev blind) × {raw, strict} on the hardened loop; an adaptive attacker (SEC; 4 goals × 5 rounds × 2 configs); strict-vs-raw utility on 29 dev × FIKS, L1 × 2 attempts × {raw, strict} (Opus). The round-3 "current loop in a disposable container" arm is cut (§0.0 M7) | Opus | 240 + 40 + 232 = 512★ | 80–130★ (round-3 range × 512/752) | 6–10 h | Any canary hit → stop R7 and report it as a finding |
| R8 | Real bugs: detect, F/P (10 runs), FIKS vs COMP vs ISSUE-TEXT through RBA (4 bugs × 3 arms × 5) on the `.work/realbugs/<id>` clones (`node scripts/ensure-realbugs.mjs --all` first) | Opus × 5 | ≈ 60 | 10–25 | 3–6 h | Gated on RBA PASS and the containment preflight |
| R10 | Optional E11, after CP2 and every other run, only if caps remain. Never projected | Sonnet | ≈ 2,000 | 60–100 | 4–8 h | — |
| R11 | D10 showcase (round 7): post-CP2 product mode, `pnpm fiks repair --trace <frozen> --base showcase/<driftId>` with no `--arm`, `--run-key` or `--no-pr` and `--ci github`, on one seeded-drawn detected test drift per domain; PRs on vats98754/shop-mcp and tracker-mcp (§8.0-3); never merged by the run; outside the K1 walk, never projected | Opus | 2 | ≤ 2 [estimate] | < 1 h | Requires `confirmatory.lock`; skipped ⇒ D10 cut |
| **Total** | | | | **≈ 1,420–2,395★, or ≈ 1,846–3,114★ with a 30% reserve (excl. A2, R10, R11)** | **≈ 5–9 days of Claude-bound running, plus R0 (4–6 h) and the non-overlappable part of R5 (up to 40–75 h), plus checkpoint reviews** | |

Totals★: `python3 -c "low=[10,20,0,560,0,140,40,20,15,35,450,0,40,80,10];high=[20,45,10,960,0,215,70,50,25,65,720,0,60,130,25];print(sum(low),sum(high),sum(low)*1.3,sum(high)*1.3)"` → 1420 2395 1846 3113.5 (rows T0, A0, frame, A1, R0, R1, R2, P-pool, R9, R3, R4, R5, R6, R7, R8). R7★: `python3 -c "print(12*10*2+4*5*2+29*2*2*2, 120*512/752, 190*512/752)"` → 512, 81.7, 129.4. R5★: `python3 -c "p,t,h=2500,13,2950;print([(p*(b+t*x)+h*y)/3600/4 for b,x,y in ((60,5,90),(90,10,180))],[p*t*(b+x)/3600/4 for b,x in ((60,5),(90,10))])"` → [40.1, 75.1] cached, [146.7, 225.7] uncached.

Note 1 (A1 cap-stop):
- On a cap or usage-limit error, all sessions pause.
- In-flight sessions are discarded (artifacts quarantined) and restarted from scratch after the reset.
- The keep rule uses idea-index order, so pauses do not change which drifts are kept.
- At the ceiling, A1 stops, and quota shortfalls are reported per stratum.

### 8.2 K1 rules (pre-declared; the only choices made from dev data and throughput)

- **Projected quantity.**
  - Claude usage units over every remaining Claude run: A1 leftovers if any, R2, A2 at its worst case, P-pool, R9 (Claude share), R3, R4, R6, R7, R8, plus a 30% reserve.
  - Units: Opus attempt or session = 1, Sonnet 0.5, Haiku 0.2; judge and pool calls are converted at measured token cost.
  - R10 and R11 are excluded: they are not K1 steps and run only after CP2 (R10 if caps remain; R11 with approval).
- **Fit.** The projection must fit within W at the sustained rate measured in T0/R1, given the cap events observed in A1/R1. Tool: `pnpm exp fit --measured paper/results/raw/throughput.json`.
- **Non-Claude wall-clock is in the fit (round 4).** W must also hold R0 (4–6 h, already spent by K1 but counted against W's start), CP2 (< 1 h) and the part of R5 that cannot overlap Claude runs. Overlap rule: R5 grading containers may run during R6–R8 only while (Claude repair workers × measured RSS) + (R5 containers × per-container limit) ≤ the 6 GB Docker allocation; otherwise R5 waits. R5 never overlaps R4 (both are Docker-heavy), and ollama phases never overlap R4/R5. `pnpm exp fit` adds the non-overlappable R5 hours (planning value 40–75 h★, re-measured at R0) to the Claude projection.
- **Expected cut.** At T0 concurrency c = 1, R4 alone at S0 is 2,928 attempts × 3–4 min ≈ 146–195 h★ (`python3 -c "print(2928*3/60, 2928*4/60)"`), more than W = 8 days minus R5. The walk is therefore expected to cut at c = 1; this is planned, not a failure.
- **Configuration.**
  - If everything fits with a = 5, set a = 5 (S+).
  - Otherwise start at S0 (a = 4, 3 models, all rungs) and walk the §13 K1 order, stopping at the first prefix that fits.
  - Every step in that order removes a positive amount of projected Claude usage, so the projection decreases strictly along the walk; `pnpm exp fit` asserts this.
  - MDEs and joint IUT power are restated for the chosen step (§3.3 table recomputed with dev σ_d).
- **Wall-clock / CPU rule (separate from the walk).** The ollama share of R9 is cut if T0's ollama throughput projects > 10 h for it. B-OM is cut unconditionally (§13).
- **Workers.** The largest count in {1, 2, 4, 6} (round 7) with < 2% 429/overload and peak RSS ≤ 16 GB − 6 GB Docker.
- **Judge variant.** The highest dev BA among {Sonnet, Haiku} × {± upstream}; tie → cheaper (E3 only).
- **σ_d.** Per endpoint, from dev via `decompose`. Nothing else in PREREG may change.

**Pacing.**
- Blocks = (drift, model, attempt-index), each containing all confirmatory arms.
- Breadth-first over attempt index, so a cap stop leaves a balanced design with fewer attempts, not fewer drifts.
- Incomplete blocks are discarded and re-run whole on resume.
- Cap events during R4 pause and resume exactly as in A1.

**Stop rules.**
- Canary hit → stop that run, preserve logs, run a security review.
- Any GitHub write outside vats98754, or any push in an experiment run (shim/gh audit) → stop all runs.
- Determinism break (D1 mismatch) → stop, fix, re-run the affected cells; deviation logged.
- Infra > 10% in a 50-attempt window → pause, fix, resume (deviation).
- A1 ceiling reached → stop A1 and proceed with the kept set.
- Detected test drifts < 40 after top-up → run H2–H4 anyway, MDE stated.

**Memory schedule.** Docker gets 6 GB. Workers are capped by measured RSS. Ollama phases never run concurrently with R4/R5.

---

## 9. Analysis plan

### 9.1 Scripts

All scripts live in `paper/scripts/`, frozen at F3; Python 3.12 in `paper/.venv` (`python3.12 -m venv paper/.venv && paper/.venv/bin/pip install -r paper/scripts/requirements.txt`; exact pins for numpy, scipy, statsmodels, pytest). The machine's default `python3` is miniconda 3.11 without statsmodels, and Homebrew python3.12 is externally managed, so nothing is installed outside the venv. Inputs come only from `paper/results/raw/**` and `bench/results/**`.

| Script | Computes | Output |
|---|---|---|
| `power.py` | Exactly the 72 numbers of the §9.6 power check manifest (round 7). Subcommands: `mde` wraps `eval_stats.py`; `binom` gives the exact crit, exact size and power; `binom-min`; `anyfp` (1 − (1 − π)^n, round 6); `floor` (sampling floor of σ_d, round 7); `ni` uses the normal formula; `frame` applies the N_E rule at the F4b N_E; `all --check` applies the precision rule (preamble) | `paper/results/power.json`; Appendix F |
| `simulate_power.py` | Joint IUT power for S+, S0, S2, S3 and S4 under the planning and K1 DGPs (drift heterogeneity, model facets, a attempts) | `power.json` (informational, not a gate) |
| `classify_outcome.py` | Attempt outcome from AttemptRecord + GradeRecord. `correct_pr` requires exposed ∧ green final CI (incl. IV where the arm has it) ∧ held-out-correct | used by h3h4 |
| `h1_precision.py` | Z_e per entity from per-element DetectorVerdictRows (round 7; refuses first-element-only rows); X; p_E; census share; p_H1; the batch-cluster bootstrap bound; per-domain and per-provenance CP/Wilson; entailed sanity; D11; D12 | Table 2 |
| `h2_adequacy.py` | BA per drift, Δ, sign-flip p, BCa 95/97.5; FAR/FRR; sensitivity rows s1, s2 and s3 (no request-changing drifts); inline-recording counts; results by pool source | Table 3, Figure 3 |
| `h3h4_repair.py` | Per-drift rates per arm; harm and NI components with the direction guard (p_3a, p_4a = 1 when mean d_i ≤ 0); IUT p; CIs for readings; relative correct-PR loss next to the absolute one; per-class rows (request-changing vs other; descriptive, never passed to `holm.py`) | Table 4, Figure 4 |
| `holm.py` | Holm over {H1..H4} (or {H2..H4} if F4b set m = 3); adjusted p; reading per §3.5 | `paper/macros/confirmatory.tex` |
| `cp2_lock.py` | Runs h1–h4 + holm once and writes `paper/results/confirmatory.lock`. Exploratory scripts refuse to run without it | lock |
| `e1_ladder.py` … `e10_reason.py` | Exploratory sets | Figures 2, 5; Tables 5–8 |
| `descriptive.py` | D1–D12 | Table 1, funnel, appendix tables |
| `simulate_null.py` | Size checks, gate for F3 (detail below) | gate for F3 |
| `paper_check.py` | Rebuilds every table and macro from logs; fails on any hand edit | `pnpm paper:check` |

`simulate_null.py` runs 2,000 null datasets per check:
- **(i) H1 exact entity test.** Analytic exact size ≤ α, and simulated rejection under i.i.d. entities within ±3 MC SE of that size. Informational: size under beta-binomial batch DGPs (ICC 0.02, 0.05).
- **(ii) Sign-flip permutation tests (H2, H3a, H4a).** Rejection within α ± 3 MC SE under symmetric nulls with drift heterogeneity, at α = 0.05 and 0.0125.
- **(iii) Shifted sign-flip NI (H3b, H4b).** Size ≤ α + 3 MC SE under the symmetric and the pre-registered skewed DGPs. Otherwise PREREG switches to the studentized bootstrap-t over drifts, the only pre-declared alternative.
- **(iv) IUT components.** Under the named least-favourable DGPs, rejection must be ≤ α + 3 MC SE:
  - LF-harm: harm difference 0, correct-PR difference +0.30;
  - LF-NI: correct-PR difference exactly −0.10, harm difference 0.40.

### 9.2 Methods

- **Rates.** Wilson [brown2001binomial]; Clopper–Pearson for H1.
- **H1.** Exact one-sided binomial on entity indicators. Batch-cluster percentile bootstrap as robustness [field2007clusterboot].
- **Paired drift-level differences.**
  - Sign-flip permutation: exact if n ≤ 20, else 200,000 flips (seed in PREREG).
  - 10,000-resample BCa over drifts.
  - Unit = drift; models fixed and equal-weighted; attempts nested [miller2024errorbars] [bowyer2025clt].
- **Non-inferiority.** Primary decision = one-sided shifted sign-flip p on d_i + δ. The BCa bound is displayed. Fallback per §9.1 (iii).
- **Readings.** 97.5% BCa CIs and margins per §3.5.
- **Detector comparisons (E3).** Mid-p McNemar at drift level, plus exact [fagerland2013mcnemar]. Judge AUROC by drift-clustered bootstrap.
- **pass^k (E11).** Unbiased estimators [chen2021codex] [yao2024taubench].
- **Multiplicity.** Holm over the confirmatory family only. IUT components are tested at their H's Holm level, with no extra split.
- **Sensitivity.** Reported; it cannot rescue a failed H, and a direction flip is reported prominently.
  - GLMM `y ~ arm + (1|drift) + (1|model)`.
  - Per domain; excluding evasive drifts; clustering by drift author; by ideation family.
  - Oracle without SAST; oracle without the differential.
  - Worst-case infra imputation.
  - H1 with A0-disabled properties re-enabled (`replay-cli --reenable`, `now := capturedAt`); H1 per domain.
  - H2 rows s1, s2 and s3.
  - H3/H4 per drift class (request-changing vs other), descriptive.

### 9.3 Infra-error policy

- **API-call level.** 3 retries with backoff.
- **Attempt level.** `infra_error` covers: SDK/transport failure after retries; 429/5xx; harness crash; container start failure; timeout with no model output; cap stop mid-attempt.
  - It is re-queued ≤ 2 times.
  - If it persists, the (drift, model, attempt-index) cell is dropped **for all arms** and counted.
- **Model outcomes, not infra.** Hitting `maxTurns`, the budget cap or the 90-minute cap.
- **Differential infra.** Infra rate per arm with Wilson CIs. If any pairwise arm gap is > 2 pp, or > 5% of cells are dropped overall, the worst-case imputation (FIKS = green-incorrect, no correct PR; comparator = correct PR) is shown next to the primary.

### 9.4 Exclusions (only these)

1. Drifts and benign cases that fail automated validity before unsealing (F7).
2. Drifts with a forbidden read in the authoring audit.
3. Undetected drifts: excluded from H2–H4 by design; included in D4/E3. "Detected" means ≥ 1 drift-attributable violation (§3.0, defined before F5), so a drift whose only violations also occur on its v1 control is undetected by definition, not by a post-hoc exclusion; it is counted in D12.
4. Drifts with < 3 patches in a class (H2 only).
5. Persistent-infra cells (pairwise).
6. Frame inputs where the base output ≢ `truth()` on v1, and entities left with no eligible input (H1; reported).

F-gate failures are FIKS outcomes (`no_pr`) and are never excluded. In H2, both the fiks and the agent tests count as they behave.

### 9.5 Deviations

- Logged in `paper/prereg/DEVIATIONS.md`: date, item, reason, who decided, affected runs, and the result under both analyses.
- No interim looks. Runners print status counts only, with no correctness or verdict fields; R2 prints completion counts, not FP counts.
- Any post-F5 change to code that affects verdicts requires re-running the affected cells.
- A0 contract edits other than the registered mechanical disable (`scripts/contract-disable.mjs`, frozen at F2 with the evaluator's `disabled` support) are deviations.
- A catalog top-up after F4b is a deviation.

### 9.6 Power reproduction

AN runs these, and PREREG embeds the outputs. Expected values come from §3 and are checked under the precision rule:

```
paper/.venv/bin/python "$PF/scripts/eval_stats.py" mde --n 61 --sd-diff 0.177 --alpha 0.0125   # 0.0757 (S0 harm)
paper/.venv/bin/python "$PF/scripts/eval_stats.py" mde --n 40 --sd-diff 0.177 --alpha 0.0125   # 0.0935
paper/.venv/bin/python "$PF/scripts/eval_stats.py" mde --n 61 --sd-diff 0.196 --alpha 0.0125   # 0.0838 (S2 harm)
paper/.venv/bin/python "$PF/scripts/eval_stats.py" mde --n 40 --sd-diff 0.196 --alpha 0.0125   # 0.1035
paper/.venv/bin/python "$PF/scripts/eval_stats.py" mde --n 61 --sd-diff 0.229 --alpha 0.0125   # 0.0979 (S3 harm)
paper/.venv/bin/python "$PF/scripts/eval_stats.py" mde --n 40 --sd-diff 0.229 --alpha 0.0125   # 0.1209
paper/.venv/bin/python "$PF/scripts/eval_stats.py" mde --n 61 --sd-diff 0.25 --alpha 0.0125    # 0.1069 (H2)
paper/.venv/bin/python "$PF/scripts/eval_stats.py" mde --n 61 --sd-diff 0.35 --alpha 0.0125    # 0.1496
paper/.venv/bin/python "$PF/scripts/eval_stats.py" mde --n 51 --sd-diff 0.25 --alpha 0.0125    # 0.1169
paper/.venv/bin/python "$PF/scripts/eval_stats.py" mde --n 40 --sd-diff 0.25 --alpha 0.0125    # 0.1320 (H2 floor)
paper/.venv/bin/python "$PF/scripts/eval_stats.py" mde --target 0.10 --sd-diff 0.253 --alpha 0.025  # NI n = 61 (S0)
paper/.venv/bin/python "$PF/scripts/eval_stats.py" mde --target 0.10 --sd-diff 0.279 --alpha 0.025  # NI n = 74 (S2)
paper/.venv/bin/python paper/scripts/power.py ni --n 61 40 --sd-diff 0.253 0.279 0.325 --delta 0.10 --alpha 0.0125  # 0.801/0.602, 0.712/0.510, 0.564/0.384
paper/.venv/bin/python paper/scripts/power.py harm --n 61 40 --sd-diff 0.177 0.196 0.229 --effect 0.10 --alpha 0.0125  # 0.972/0.859, 0.9315/0.767, 0.819/0.604
paper/.venv/bin/python paper/scripts/power.py ni --n 61 40 --sd-diff 0.25 0.30 --delta 0.10 --alpha 0.0125  # 0.811/0.613, 0.641/0.447
paper/.venv/bin/python paper/scripts/power.py ni --n 61 40 --sd-diff 0.253 0.279 0.325 --delta 0.10 --theta -0.03 --alpha 0.0125  # 0.468/0.312, 0.389/0.256, 0.288/0.190 (round 4)
paper/.venv/bin/python paper/scripts/power.py ni --n 61 40 --sd-diff 0.253 0.279 0.325 --delta 0.10 --theta -0.05 --alpha 0.0125  # 0.243/0.161, 0.200/0.134, 0.149/0.102 (round 4)
paper/.venv/bin/python paper/scripts/power.py harm --n 61 40 --sd-diff 0.177 0.196 0.229 --effect 0.05 --alpha 0.0125  # 0.385/0.239, 0.307/0.188, 0.214/0.132 (round 4)
paper/.venv/bin/python "$PF/scripts/eval_stats.py" mde --target 0.05 --sd-diff 0.253 --alpha 0.025  # NI n = 244 at delta 0.05 (margin rationale, round 4)
paper/.venv/bin/python paper/scripts/power.py binom --n 1500 --p0 0.02 --alpha 0.0125 --p1 0.01 0.005   # crit 18; size 0.0123; 0.821; >= 0.99
paper/.venv/bin/python paper/scripts/power.py binom --n 1000 --p0 0.02 --alpha 0.0125 --p1 0.01         # crit 10; size 0.0102; 0.583
paper/.venv/bin/python paper/scripts/power.py binom-min --p0 0.02 --alpha 0.0125                         # 217
paper/.venv/bin/python paper/scripts/power.py frame --frame-spec paper/prereg/frame-spec.json           # N_E rule; crit and power at F4b N_E; m
paper/.venv/bin/python paper/scripts/power.py anyfp --n 50 --pi 0.02 0.01                               # 0.636 0.395 (P(>= 1 FP entity in a 50-entity per-drift sample), §3.0, round 6)
paper/.venv/bin/python paper/scripts/simulate_power.py --configs S0 S2 S3 --n 61 40                     # joint IUT (informational; product values in §3.3)
```

**Power check manifest (round 7).** `power.py all --check` checks exactly these 72 tagged numbers. AN encodes them in `paper/scripts/power_manifest.json` with section, printed value, precision or inequality, and generating command. The check also fails if §3 or §9.6 carries a †/‡/★ number that is not listed here. Other ★ numbers in this file are arithmetic checked by the command printed next to them, not by `power.py`: build hours, critical path and schedule (§0.000, §0.0000, §7.1), API-price and wall-clock totals, R5/R7 hours and counts (§8.1), K1 cut counts (§13), and the checker error count.

| # | Where | Numbers (printed precision) | Subcommand |
|---|---|---|---|
| 1–8 | §3.1 power table | N_E 1,500: crit 18 (exact), size 0.0123, power 0.821 at π = 0.01, ≥ 0.99 at π = 0.005; N_E 1,000: crit 10 (exact), size 0.0102, power 0.583; minimum N_E 217 (exact) | `binom`, `binom-min` |
| 9–10 | §3.1 π0 rationale | 0.665 (π0 = 0.019), 0.821 (π0 = 0.020) | `binom`, once at p0 = 0.019 and once at 0.020 |
| 11 | §0.0 M1 | 0.82054 (5 decimals) | `binom` |
| 12–13 | §3.0 attribution rationale (= §0.000 Q1) | 0.636, 0.395 | `anyfp` |
| 14–17 | §3.2 power | 0.1069, 0.1496, 0.1169, 0.1320 | `mde` |
| 18–21 | §3.3 sampling floors | 0.236, 0.204, 0.250, 0.289 | `floor` (√(2·0.25/(m·a)), m·a = 9, 12, 8, 6) |
| 22–27 | §3.3 table, harm MDE | 0.0757, 0.0935, 0.0838, 0.1035, 0.0979, 0.1209 | `mde` |
| 28–33 | §3.3 table, NI power | 0.801, 0.602, 0.712, 0.510, 0.564, 0.384 | `ni` |
| 34–39 | §3.3 table, harm power at Δ = 0.10 | 0.972, 0.859, 0.9315, 0.767, 0.819, 0.604 | `harm` |
| 40–45 | §3.3 table, joint IUT (product of the unrounded components) | 0.779, 0.517, 0.663, 0.391, 0.462, 0.232 | `ni` × `harm` |
| 46–49 | §3.3 reference NI power | 0.811, 0.613 (σ_d 0.25); 0.641, 0.447 (σ_d 0.30) | `ni` |
| 50–54 | §3.3 NI n for power 0.8 | 60, 86, 61, 74 (exact); n = 244 at δ = 0.05 (exact) | `mde --target` |
| 55–72 | §3.3 θ table | θ = −0.03: 0.468, 0.312, 0.389, 0.256, 0.288, 0.190; θ = −0.05: 0.243, 0.161, 0.200, 0.134, 0.149, 0.102; harm at Δ = 0.05: 0.385, 0.239, 0.307, 0.188, 0.214, 0.132 | `ni --theta`, `harm --effect 0.05` |

The final fixer re-ran all 72 with `$P` (scipy) on 2026-10-21; every one reproduces at its printed precision. The commands are in §3 and above.

---

## 10. Threats to validity

- **Construct (oracle).** Hidden tests, a two-reference differential, `truth()` on held-out traffic and SAST still do not prove correctness, and the references are Claude-written.
  - Mitigations: two references on every drift; ambiguous-input counts; ≥ 3 manifestations; the renamed-id variant; sensitivity without SAST and without the differential.
  - No human review unless approved (H26 optional).
- **Construct (green).** "Green" means local CI mirroring `ci.yml`, with agreement against GitHub Actions on 20 heads (D5). For COMP and L1, green also requires IV, so their green-incorrect PRs are at most as frequent as without it.
- **Construct (H1).**
  - The inference is to new entities from one blind author process, conditional on that author and brief. It is not to new vendors, nor to the fixed query grid, which is a census.
  - Entity exchangeability is assumed. Batch dependence is checked by the cluster bootstrap and the beta-binomial size check.
  - Shop ranges and the tracker author's choices were shaped by the same vendor semantics.
- **Construct (H3).** With IV in L1, FIKS − L1 measures the visible fail-first test, not "any trigger check vs none". E1 reports the IV contribution separately. Round 7: IV checks the frozen call's non-target attributable properties, which FIKS's P ignores (§3.0 asymmetry). This biases H3a/H4a against FIKS, and E1 counts the attempts it stops.
- **Construct (H1 counting, round 7).** H1 uses per-element verdicts (§3.1). The live receipt's first-element rule would hide later out-of-range entities on the same page and bias H1 toward rejection.
- **Internal: one family.** Authors, fixers, judges and repairers are Claude. The open-weight ideation stratum and author clustering serve as sensitivity checks.
- **Internal: taxonomy overlap.** Briefs and vocabulary share C3 [C3]. The evasive stratum, the S12 quota and the mutation suite are the counterweights.
- **Internal: tuning asymmetry.** fiks's repair prompt and repro generator were developed on D1–D5 before this plan (2 commits, 157 lines; 10 repair PRs on shop-mcp, #1–#5 and #7–#11, of which #1–#5 predate the commit of the prompt files and 5 are in the loop log; unlogged in-session iterations unknown; round 7). Mitigation: fiks is frozen with 0 further iterations; every repair comparator gets ≤ 10 logged dev iterations (judges ≤ 5) (§5.2 item 5); both histories are reported in Appendix H. Residual: fiks's undocumented hackathon iterations cannot be matched exactly.
- **Internal: re-record parity.** A correct fix that changes upstream requests would fail any strict replay. Every arm and every H2 test set therefore gets the same `rerecord-head` service at the same points (§3.0, §3.2), with logs compared on D3/D4. Residuals: agent tests with inlined recordings (flagged, counted), and drifts where `rerecord()` itself fails (counted against the patch in every arm alike). Both are reported per drift class, with the s3 row and the H3/H4 per-class rows.
- **Internal: evidence parity.** All confirmatory arms see the same raw bytes and the same replay helper. FIKS additionally sees its generated test, which is the treatment. REPRO-AGENT and FIKS both get an F check on base only.
- **Composition fidelity.** COMP is emulated from docs without accounts (our choice; [SYN G19] is internal reasoning). Its replay uses the deterministic contracts; how Engine judges a replay is not stated in any verified passage [verify], so the paper does not characterise it. Parameters are attributed in `FIDELITY.md` [langsmith-changelog-2026].
- **Conditioning on detection.** H2–H4 hold for detected drifts only. E3 shows coverage.
- **Detection attribution (round 6).** Detection, the frozen trace and IV use only drift-attributable violations (the property verifies on the call's v1 control). Residuals: a drift that changes a value which *also* violates on v1 for the same call is not counted as detected through that property (it can still be detected through another call or property); and IV no longer checks properties that already fail on v1 for the frozen call, so a head can pass IV while that pre-existing FP remains. Both are reported (D12 non-attributable row; ivExcluded per drift).
- **Clock (round 6).** All offline verdicts use `now := capturedAt` from a pre-registered `frozenClock`. Freshness results are therefore relative to that instant, not to the date of the run.
- **External.** Two mock domains, TypeScript only, four real-bug case studies and one Agent SDK scaffold. Models are a fixed facet.
- **Statistical.**
  - Drift-effect heterogeneity and per-cell sampling set σ_d.
  - H3 and H4 are underpowered at the floor and in the cut configurations (§3.3), and at every configuration if the true correct-PR cost is 0.03–0.05 or the true harm gap is 0.05 (§3.3 round-4 table).
  - H1's power depends on N_E, which is fixed before F5.
  - Seeded invariant faults are the class least coupled to mutants [just2014mutants].
- **Temporal drift of hosted models.** Arm order is randomized within blocks, and the R4 window is recorded.
- **Security.**
  - Threat: an adversary who controls upstream bytes controls part of the repair agent's input (the frozen trace and recorded fixtures). Closest measured channels: adversarial reproduction/error text in issue statements makes repair agents emit functionally correct but vulnerable patches, so passing tests can launder injected behaviour [verify: chen2025swexploit]; instructions placed in tool output reach a coding agent inside a repair workflow, and per-sub-agent capability scoping cuts their effect sharply [verify: bouras2026capscope]. fiks's version of both (injection via a recorded upstream exchange that then feeds a gated loop) is what E6 measures; the paper must cite both once verified, and claims no novelty for the attack class. Broader background from the same G5 sweep, also `[verify]`: injection through live GitHub workflows succeeds against every tested provider in its default configuration [verify: isbarov2026gitinject], and multi-surface injection into coding agents reaches 10.7–29.6% total attack success on 2026 frontier backbones [verify: zhao2026livepi].
  - **Re-record is candidate code (round 6).** Re-recording starts the candidate head's server, so a malicious head (or one steered by poisoned fixture bytes) runs during `rerecord-head`. It runs only inside the per-attempt container (P1), and the containment preflight gates every run that executes heads.
  - Static attacks plus a small adaptive attacker. Adaptive robustness is not claimed [nasr2025attackermovessecond].
  - The hardened-vs-current-loop comparison is cut (§0.0 M7), so E6 does not quantify the hardening's effect; it reports containment and raw-vs-strict on the hardened loop only.
  - The host agent process holds the OAuth token (or the container does, if P1 falls back).
  - Confirmatory runs use raw traces of benign drifts.
- **Contamination.** Blind artifacts post-date model cutoffs. Real bugs are stratified by fix date [swe-bench-illusion].
- **Prior merges.** shop-mcp PRs #1–#4, #6 and #7 were merged at the owner's request without line-by-line review (README). They are never presented as acceptance (M18). [C21] is cited descriptively only [ehsani2026failedagenticprs].

---

## 11. Paper outline → RQs, tables, figures

| § | Section | RQ | Tables / figures |
|---|---|---|---|
| 1 | Introduction. The gap, as the narrowed statement of §1 only: we found no system with both a deterministic contract trigger on successful results and a PR exposed only after a fail-first named-property repro plus all gates; search limits stated. Each component is credited to its prior art ([panthi2026outcomemonitors], [langsmith-changelog-2026], [awan2026aegisflow], and the G5 sources once verified) | all | Figure 1 |
| 2 | Definitions and prior art, by difference: X27 definitions table; K4, K9, K11, K15; AegisFlow; Outcome Monitors; Engine; G5 rows (Microsoft '009, D3 Morpheus, Exla, Verified Tool Calls, Visa '982, Zoom '491, Visa TDCommons 10178, TDCommons 12336, Lemma, BentoLabs) once verified | — | Definitions table; feature-matrix excerpt (rows built from `bibliography.json` keys only) |
| 3 | fiks: observe, capture, reproduce, repair, ship; hardening P1–P5; the CU outcome | — | Figure 1 |
| 4 | DriftBench-blind: construction, freeze ledger, circularity controls, frames (F vs S-dev), entity attribution | — | Table 1; D2, D6 |
| 5 | Setup: arms (incl. IV placement), baselines, oracle, statistics, pre-registration, compute | — | Appendices A, F, G, H |
| 6 | RQ1 Trigger | RQ1 | Table 2 (H1 + D12); Figure 2 (E3); D8; D11 |
| 7 | RQ2 Artifact | RQ2 | Table 3 (H2, s1, s2); Figure 3; D3; E10 |
| 8 | RQ3 Placement | RQ3 | Table 4 (H3, H4); Figure 4; Figure 5 (E1 incl. IV rungs); Table 8 (E9); E2, E8, E5 |
| 9 | RQ4 Limits | RQ4 | Table 5 (E4); Table 7 (E7); provenance rows of Figure 2 |
| 10 | RQ5 Security | RQ5 | Table 6 (E6) |
| 11 | Related work | — | — |
| 12 | Limitations: seeded vs real; vocabulary limit [C11]; partial-patch risk [C20]; one family; emulated products; conditioning on detection; power at the floor; H1 exchangeability; no human review | — | — |
| 13 | Conclusion | — | — |
| App. | A: PREREG + DEVIATIONS. B: prompts verbatim. C: oracle spec. D: per-drift raw results. E: legacy bench (D7). F: power. G: run commands. H: fidelity notes. I: AI-assistance disclosure. J: funnel (D4) and showcase PR timeline (D10) | | |

---

## 12. Certification checklist (ORCHESTRATION "What certified means")

| # | Requirement | How it is met | Gate artifact |
|---|---|---|---|
| 1 | Numbers from scripts | `paper/scripts/` emits every table and macro; `pnpm paper:check` rebuilds and diffs | `paper_check.py` exit 0 on a clean clone |
| 2 | Citations verified twice | Only VERIFIED or corrected `bibliography.json` keys are used. ARMS corrects and re-fetches the `[langsmith-changelog-2026]` location before use. `[xavier2017apibreak]` and `[mcp-healer]` are VERIFIED in `verify/g8-reverify.json`. **Before any paper text cites them**, two Certify-phase verifiers check the `[verify: …]` sources (msft-us12711009, d3-morpheus-selfhealing, exla-yc-w25, mansoor2026verifiedtoolcalls, visa-us9983982, zoom-us12483491, visa-tdcommons-2026, tdcommons-12336, lemma-yc-f25, bentolabs-yc-s26, chen2025swexploit, bouras2026capscope, isbarov2026gitinject, zhao2026livepi) and the R20/R9 issue keys, and add them to `bibliography.json`; a source that fails is dropped and the narrowed novelty statement stays as written. Every number taken from SYNTHESIS is re-checked against the verified quote of its key; SYN pointers never support a fact. † sources are unused | Citation-verifier JSON per cited key |
| 3 | Statistics | PREREG frozen (F5) before runs; F4b frame spec with N_E; Wilson/BCa on every rate; paired tests for every with-vs-without comparison; Holm stated; power and joint IUT power per H; `power.py all --check` PASS at stated precision | `prereg-v1`, `prereg-v1.1`, `frame-spec.json`, `power.json`, `simulate_null.py` |
| 4 | Hostile review | Mode B panel (SE/APR, agents/evals, statistics, security, novelty). Each concern is fixed, answered by an experiment, or put in Limitations (≤ 2 loops) | Review files + rebuttal-risk list |
| 5 | Claims audit | claims-auditor PASS on the manuscript | Auditor report |
| 6 | Reproducibility | A clean clone from the local path (incl. a fresh shop-mcp clone checked out at the pinned sync ref, never at a moving main; round 7) regenerates every table from committed logs. Run commands are in Appendix G. LaTeX builds with no undefined references | Clean-clone log |
| 7 | Disclosure | AI-assistance statement; limitations cover seeded vs real, [C11], [C20] and one model family | Appendix I, §12 |

---

## 13. What is cut

**Deliberately cut (unconditional).**

| Cut | Why |
|---|---|
| Receipt agent-outcome effects as a claim (SYN H13) | Receipts are prior art [panthi2026outcomemonitors]. Optional E11 only, after CP2, never projected |
| Separate recurrence experiment (SYN H12) | A construction property for a deterministic tool once a correct fix exists [SYN X18]. Covered by oracle criterion 5 and D9 |
| τ²-bench (SYN H19) | §5.11 |
| Contract inference as a claim (SYN H16); B-OM | Off the narrow novelty. B-LLMC stays as an exploratory row; B-OM is not built |
| H1 input-level and cell-level p-values | Census quantities with clustered inputs (round-3 item 1). Reported in D12 without inference |
| Strict trace format in confirmatory runs | Would give FIKS bytes the other arms cannot read. E6 only |
| BBCBench (H28), AIDev re-analysis (H27), MCPMark organic rate, MCP-Atlas | Sources pending re-verification, or off-claim |
| Go/Python real bugs (waves 2–3) | 30–40 h of harness work each [SYN G18] |
| Human review (H26) | Not available without approval; optional |
| CodeQL; SAST as a product gate | Memory/CPU limits on 16 GB. SAST is in the oracle only |
| Repair with a second model family | CPU-only 7B inference is too slow for agentic repair [estimate] |
| Portability/receipt survival (H22), noise/duplicates (H29), a live-integration trigger arm | Off the central claim |
| Direct measurement of Engine, Cleric, Seer, Devin | No accounts or sign-ups. Emulated, and stated [SYN G19] |
| E6 hardened vs current-loop arm (round 4) | Needs the unhardened loop plus the OAuth token inside a container; no stream builds it and it would expose the token |

**Outside the K1 walk.**
- R10 (E11) runs only after CP2 if caps remain.
- R11 (D10 showcase PRs, round 7) runs only after CP2, with approval; if it does not run, D10 is cut.
- The ollama share of R9 is cut by the §8.2 wall-clock rule.

**K1 cut order (pre-registered).** K1 applies it from the top until the §8.2 fit holds. Each step removes positive projected Claude usage. MDE and joint IUT power are restated at each step. Never cut: verifier gates; the F gate and stated-reason check; the green-CI gate; IV in L1 and COMP; held-out grading; the claims audit. H1–H4 never drop below the floor of n = 40 drifts (H1: its N_E rule).

| Step | Cut | Projected Claude usage removed (units: Opus attempt = 1, Sonnet 0.5, Haiku 0.2) |
|---|---|---|
| 1 | COMP-plain (E8) | 183 Opus attempts |
| 2 | L1p | 183 Opus attempts |
| 3 | COMP-norep rung | 183 Opus attempts |
| 4 | L1-noIV rung | 183 Opus attempts |
| 5 | Adaptive attacker | 40 Opus attempts |
| 6 | R7 to 6 payloads (12 → 6 × 10 carriers × {raw, strict}) | 120★ Opus attempts (`python3 -c "print(12*10*2-6*10*2)"`; was 240 when R7 had the cut current-loop arm) |
| 7 | Real bugs beyond 2 | ≈ 30 Opus attempts |
| 8 | **S0 → S2**: a 4 → 3 for FIKS, L1, COMP; REPRO-AGENT unchanged | 20.4 → 15.3 units per drift |
| 9 | **S2 → S3**: drop Haiku from R3/R4 at a = 3 | 15.3 → 13.5 units per drift (+ Haiku REPRO-AGENT sessions) |
| 10 | Top-up wave A2 | ≤ 40 drift authorings (worst case in the projection) |
| 11 | **S4**: confirmatory drifts reduced to a seeded, stratified subset, never below 40 | 13.5 × 61 → 13.5 × 40 units |

If the fit still fails at step 11, R4 runs at S4 breadth-first and stops at the cap. The realised n and MDE are reported.

---

## Appendix: interfaces shared across streams (field lists only)

- `RunKey`: {experiment, arm, model, domain, drift, attempt}; string form `exp/arm/model/domain/drift/attempt`.
- `AttemptRecord`: {runKey, prExposed, ciFinal ∈ {green, red, none}, issueValidation ∈ {pass, fail, n/a}, ivPlacement ∈ {pre, post, none}, headSha, outcome (filled by `classify_outcome.py`), sessions, turns, tokens{in, out, cacheRead, cacheCreate}, costUsd, wallMs per phase, candidateIds[], fiksCommit, imageDigest, traceFormat, frozenTraceSha, rerecordLog (path)}. `outcome` may also be `contract_update_proposed` (FIKS+CU, E4 only).
- `ReproTestRecord`: {runKey, source ∈ {fiks, agent}, round, path, sha, fOnBase ∈ {pass, fail, error}, isFinal, isFirst, recordingsRead[], inlineRecording}.
- `CandidateRecord`: {id, runKey, stage ∈ {gate, iv, ci, revision}, diffSha, diffPath}.
- `CallRecord`: {callId, domain, stratum, catalog, drift|null, mutant|null, tool, args, upstream[{request, response}], output, events[], entityClass per property path, originUnit per property path, **capturedAt** (ISO instant = the proxy's evaluation `now`, = Domain.frozenClock in record runs; round 6), **controlOf** (callId of the drift/benign call this v1 control mirrors, else null; round 6)}.
- `EnumRow`: {domain, stratum, tool, args, dedupeKey}.
- `FrameSpec`: {domain[], nF, eligibleInputs, entities[{id, domain, authorBatch, eligible}], NE, attribution{inputId → {path → originUnit}}, families{property → family}, cells[{contract, property, class, nInputs}], K, entailedProps[], neRule{topUpBatches, underpowered, m}, crit, power{pi01, pi005}, hash}.
- `FrozenTrace`: {driftId, callId, path, sha256, **violated[]** (full receipt list) and **target[]** (= [first drift-attributable entry]; round 7; both in the agent-visible trace, as in the product format), controlCallId, attributableProperties[], ivProperties[], ivExcluded[{property, controlVerdict}], ivSidecarSha256} (round 6 fields live in the `<trace>.iv.json` sidecar, never in the agent-visible trace).
- `DetectorVerdictRow`: {callId, domain, drift|null, stratum, entityClass, originUnit, detector, verdict ∈ {verified, violated, unverifiable}, property|null, **at|null, elementIndex|null** (round 7: set in `replay-cli --per-element` rows, one row per violating element), confidence|null, tokens|null, costUsd|null}.
- `GradeRecord`: {patchId, drift, criteria{hidden, differential, ambiguousInputs, renamedId, sast, truthReplay}, correct, reasons[]}.
- `DriftPackage`: {id, domain, base (git ref, resolved `^{commit}`), stratum, ideationFamily, authorSession, injectorRule{path, hash}, hiddenTests[], refA, refB, renamedIdVariant, generators, changelog?}.
- `InjectorRule`: {id, domain, match{method, pathPattern}, transform (module path), clockFrozen, hash}.
- `Domain`: {id, createVendor(catalog), **frozenClock** (round 6; constant instant, committed before F2), truth, entityClass, originEntity, injectorHook, versionHeader, contractsPath, baseUrlEnv, serverCommand, repo, seedTag, scenarios, fixtureCalls, tasks, promptHints, enumerate, paginatedEndpoints, **reproEmitter**(trace, spec) → {files[{path, bytes}], testPath}, **suite** {run(repoDir, scope) → SuiteRun, scope (globs; default all), oneFailingInScope}, **allowedEditPaths** (regex sources)} (hooks added in round 5; shop values byte-identical to ec241bc). Registry: `registerDomain`, `getDomain`, `listDomains` (`packages/domains/src/registry.ts`, CORE seed).
- `Monitor`: (EvalInput + tool, contract, toolDef, opts{reenable?: string[], perElement?: boolean (round 7; offline H1 only)}) → {verdict, checked[], violations[], disabled[] (round 6), costUsd?, tokens?}. Offline, EvalInput.now = new Date(record.capturedAt).
- Contract property (round 6): optional `disabled: true` and `disabledReason`, set only by `scripts/contract-disable.mjs`.
- `ExecBackend`: {exec(cmd, args, opts) → {code, stdout, stderr}, cleanup()}; `ciLocal(worktree, image, extraChecks?) → {green, log}`.
- `Arm`: {name, prepare, prompt, preGates, ciPolicy, prPolicy}. Invoked as `pnpm fiks repair --arm fiks …` (ORCH) or `pnpm fiks arm --name <ARM> …` (ARMS).
- `DepFragment`: {stream, add{"packages/<consumer>": {"@fiks/<name>": "workspace:*"}}, tsconfigReferences?[]}.
- CLI command module: a default export {name, describe, run(argv)} in `packages/cli/src/commands/*.ts` (overrides `packages/cli/src/legacy/<name>.ts`). Bootstrap module: a side-effect module in `packages/cli/src/bootstrap/NN-*.ts`, loaded in sorted order before dispatch.
- `ConfigStep`: {id ∈ {S+, S0, 1..11}, arms[], models[], a, drifts, projectedUnits}.
- `RerecordLog` (round 5): one JSONL line per `rerecord-head` call: {profile{domain, base, ruleId, ruleHash}, head, fromCommit, check ∈ {P, IV, suite, traces, ci, accept}, files[{path, mode ∈ {stale, overlay}, requestKeysBefore[], requestKeysAfter[], outcome ∈ {rerecorded, unchanged, failed}}]}.
- `RealbugAdapter` (round 4; round 5 adds testRunner, suiteScope[], allowedEditPaths[]): {bugId, repoDir (= `.work/realbugs/<id>`, round 6), prefixSha, fixSha, serverCommand, baseUrlEnv, testCommand, testRunner, suiteScope[], allowedEditPaths[], humanFixTests[], heldoutCommand, issuePath, contractPath, fixtures[{path, label ∈ {recorded, synthesized}}]}; one `realbugs/<id>/adapter.json` per bug (RB streams), consumed by RBA.
