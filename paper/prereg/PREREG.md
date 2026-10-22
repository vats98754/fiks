# fiks paper: pre-registration (PREREG)

**Status: DRAFT, not yet registered.** This file becomes the registration when the annotated tag `prereg-v1` (freeze F5, PLAN §5.2) is created on a commit where all of these pass:

- `pnpm tsx paper/prereg/check-prereg.ts --final` (every rule below is verbatim from PLAN.md and no `<<FILL@…>>` slot is left);
- `pnpm tsx paper/prereg/build-registry.ts --final` (REGISTRY.json written from a tree equal to HEAD);
- `pnpm tsx paper/prereg/check-ledger.ts` (F1–F4b recorded in order; F5 is recorded right after the tag);
- `paper/.venv/bin/python paper/scripts/power.py all --check` (PLAN §8.1 row "Tag `prereg-v1` (F5)").

Source: `paper/PLAN.md`, round 7 (fixer round 4, final), 2026-10-21. Its git blob id and sha256 at F5 are in `paper/prereg/REGISTRY.json`. No number in this document is a result of the new experiments; none exist yet.

## How this document is organised

- **Part I** holds what only a registration can hold: what is registered and when, the registered constants (seeds and resample counts that PLAN leaves to "PREREG"), the values fixed at F4b, the power statements PLAN requires PREREG to make, what may still change after F5, and where deviations and tuning are logged.
- **Part II** holds the registered rules, copied verbatim from PLAN.md §3 (incl. §3.0–§3.5), §4, §5.5, §5.7, §8.2, §9 and §13. Headings are demoted one level and keep their PLAN numbers, so a "§x" inside Part II means PLAN §x. Sections not reproduced (e.g. §5.1, §5.2 controls, §6, §7 and the Appendix) are PLAN text, hashed into REGISTRY.json at F5.
- `check-prereg.ts` splits each of those PLAN sections into blocks (heading, table row, code block, list item, paragraph) and fails unless every block appears in Part II verbatim (whitespace runs collapsed, nothing else normalised). It also reports, by name, the rule classes the registration must carry: every H endpoint, test, margin and margin rationale, direction guard, reading, n rule, the N_E rule, the IV definition, the REPRO-AGENT F-check rule, the H2 as-it-behaves rule, the H2 re-record rule (incl. the agent-test overlay and the inline-recording rule), the repair-arm re-record parity rule, the request-changing class rule, the E4/E7 analysis rules, every cut-order step, and the exclusion and infra rules.
- If Part I and Part II ever disagree, Part II governs, and the disagreement is logged as a deviation.

## Part I. Registration record

### I.1 The confirmatory family at a glance

A pointer table only; the binding text is Part II.

| H | Endpoint | Test | Margin | Direction guard | Where |
|---|---|---|---|---|---|
| H1 trigger precision | Z_e per FP-eligible entity; X = Σ Z_e; census share of FP inputs | One-sided exact binomial, H0: π ≥ 0.02; p_H1 = p_E only if the census share < 0.01 | π0 = 0.02 (rationale in §3.1) | — (one-sided) | §3.1 |
| H2 test adequacy | Δ_i = BA_fiks,i − BA_agent,i | Two-sided sign-flip on Δ_i | ±0.05 BA (readings) | Falsified if mean Δ ≤ 0 | §3.2 |
| H3 FIKS vs L1 (IUT) | (a) `green_incorrect_pr` rate; (b) `correct_pr` rate | (a) two-sided sign-flip; (b) one-sided shifted sign-flip on d_i + δ; p_H3 = max(p_3a, p_3b) | (a) ±0.05; (b) δ = 0.10 (rationale in §3.3) | H3a only if mean d_i > 0 | §3.3 |
| H4 FIKS vs COMP (IUT) | as H3, COMP in place of L1 | as H3; p_H4 = max(p_4a, p_4b) | as H3 | H4a only if mean d_i > 0 | §3.4 |

Holm over {H1, H2, H3, H4} at FWER 0.05 (worst-case level 0.0125), or over {H2, H3, H4} if the N_E rule sets m = 3 at F4b (§3.1, I.5). Readings: §3.5.

### I.2 Freeze schedule and ledger

The freezes are those of PLAN §5.2, reproduced here:

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

The ledger is `paper/prereg/freeze-ledger.json` (schema `freeze-ledger.schema.json`). Each freeze is recorded as (tag, peeled commit `<tag>^{commit}`, tree hash, timestamp, external refs as peeled commits, file sha256s). `check-ledger.ts` turns "must precede" into these edges between tags, each requiring a strict git ancestor and an earlier timestamp: F1→F2, F2→F4 (A0 lies between), F3→F5, F4→F4b, F4b→F5, F5→F6, F5→F8, F6→F7 (R0 lies between), F7→F9 and F8→F9 (R2 lies between), F9→F10. A tag that exists without a ledger record, a recorded freeze whose predecessor is unrecorded, or an external ref recorded as a tag object instead of its peeled commit fails the check. F2 carries the sha256 of both domains' docs and of all seven briefs, the no-bound check result (it must pass) and the shop-docs authorship note; F4b carries the frame spec and the hash of the pre-F4b frame CallRecords (`frame-spec.schema.json`).

### I.3 Registered constants

PLAN leaves these to PREREG ("seed in PREREG"; "`--seed <s>`"). They are fixed by this draft, before any frame enumeration, blind drift, dev run or verdict exists. Each seed initialises the random-number generator of the named procedure in the analysis scripts frozen at F3 (or, for the frame, `pnpm fiks enumerate`). Implementation details not stated in Part II (for example the Monte-Carlo p-value convention) are those of the scripts frozen at F3 and hashed in REGISTRY.json.

```prereg-constants
alpha.family = 0.05
holm.m.planned = 4
signflip.flips = 200000
signflip.exact_max_n = 20
bca.resamples = 10000
cluster_bootstrap.resamples = 10000
seed.signflip.H2 = 2026102101
seed.signflip.H3a = 2026102102
seed.signflip.H3b = 2026102103
seed.signflip.H4a = 2026102104
seed.signflip.H4b = 2026102105
seed.signflip.E4.current_vs_cu = 2026102106
seed.signflip.E4.comp_vs_cu = 2026102107
seed.signflip.E11 = 2026102108
seed.bca = 2026102109
seed.cluster_bootstrap.H1 = 2026102110
seed.frame.enumerate = 2026102111
```

- `signflip.*`: H2, H3a, H3b (shifted), H4a, H4b (shifted), and the E4 and E11 paired sign-flips; exact enumeration when n ≤ 20 uses no seed. An exploratory paired sign-flip not listed here (E1, E5, E8) uses the seed of the confirmatory test with the same endpoint form: balanced accuracy → `seed.signflip.H2`, `green_incorrect_pr` → `seed.signflip.H3a`, `correct_pr` → `seed.signflip.H3b`. Exploratory results are never called significant (§4).
- `seed.bca`: every 10,000-resample BCa interval over drifts (§9.2).
- `seed.cluster_bootstrap.H1`: the H1 batch-cluster percentile bootstrap (§3.1 robustness check).
- `seed.frame.enumerate`: the `<s>` of `pnpm fiks enumerate --frame --catalog extended-only --seed <s>` (§5.7).

### I.4 Frame rules

The frame rules are fixed here (§3.1 "Frame rules are fixed in PREREG"). They are the §3.1 bullets **Frame F (primary)** (strata S-ext, S-grid, S-write; dedupe key; server refs; outputs before F4b, verdicts after), **Clock**, **Clean**, **FP-capable properties**, **FP-eligible input**, **FP-eligible entity**, **Attribution** and **Per-element verdicts**, together with §5.7 "F (H1)", all in Part II, plus the enumeration seed `seed.frame.enumerate` (I.3). Nothing about F is decided after F4b except by the deviation rule (§9.5).

### I.5 Values fixed at F4b

Filled from `paper/prereg/frame-spec.json` (written by `pnpm fiks frame-k`, validated against `frame-spec.schema.json`) and `power.py frame --frame-spec paper/prereg/frame-spec.json`, after F4b and before F5. No verdict on F exists when they are filled.

| Quantity | Value |
|---|---|
| sha256 of the pre-F4b frame CallRecords (FrameSpec.hash) | <<FILL@F4b: frame CallRecords sha256>> |
| sha256 of `paper/prereg/frame-spec.json` | <<FILL@F4b: frame-spec.json sha256>> |
| n_F | <<FILL@F4b: nF>> |
| N_E (shop / tracker / total) | <<FILL@F4b: NE per domain and total>> |
| Catalog top-up batches added by the N_E rule | <<FILL@F4b: neRule.topUpBatches>> |
| crit(N_E, 0.02, α) and exact size | <<FILL@F4b: crit and exact size>> |
| Power at π = 0.01 and π = 0.005 | <<FILL@F4b: power pi01, pi005>> |
| H1 underpowered flag (power at π = 0.01 < 0.50) | <<FILL@F4b: neRule.underpowered>> |
| m (4, or 3 if N_E < 217) and the worst-case Holm level | <<FILL@F4b: m and alpha/m>> |
| K (cells) | <<FILL@F4b: K>> |

### I.6 Power statements

- The planned power numbers are those of §3.1, §3.2 and §3.3 (Part II), checked by `power.py all --check` over the 72-number manifest of §9.6.
- **Stated plainly (§3.3):** if the true correct-PR cost is 0.03–0.05 or the true harm gap is 0.05, H3/H4 are more likely than not to be "not established" at every configuration. In the §3.3 round-4 table every NI power at θ = −0.03 or −0.05 and every harm power at Δ = 0.05 is below 0.5 (largest: 0.468, 0.243 and 0.385, all at S0 with n = 61).
- H3 and H4 are underpowered at the floor n = 40 in every configuration, and at S2/S3 for n = 61 (§3.3). Any non-rejection is read by §3.5.
- K1 restates MDEs and joint IUT power for the chosen configuration from dev σ_d (§8.2); they are recorded in the K1 addendum (F8), not here.
- Output of `paper/.venv/bin/python paper/scripts/power.py all --check` at F5:

<<FILL@F5: power.py all --check output (72 numbers, PASS line)>>

### I.7 What may change after F5

- Only the K1 choices of §8.2, recorded in `paper/prereg/K1-ADDENDUM.md` (template `K1-ADDENDUM.template.md`) and tagged `prereg-v1.1` (F8) before R2: cut-order position, a, models, workers, judge variant, and σ_d with the restated MDEs and joint IUT power. "Nothing else in PREREG may change" (§8.2).
- Everything else is a deviation (§9.5), logged in `paper/prereg/DEVIATIONS.md` with date, item, reason, who decided, affected runs and the result under both analyses.
- The A0 record (`paper/prereg/A0-RECORD.md`, template `A0-RECORD.template.md`) is completed before F4 and frozen with it; the only registered A0 contract edit is the mechanical disable by `scripts/contract-disable.mjs` (§8.1 A0, §9.5).

### I.8 Tuning log

`paper/prereg/TUNING.md` logs, before F8, every dev prompt iteration of each comparator (L1, COMP and REPRO-AGENT: at most 10 each) and each judge variant (at most 5), with its prompt hash and dev result. The fiks row is fixed at 0 further iterations of `packages/repair/src/prompt.ts` and `packages/repro/src/generate.ts`; its prior history is reported there (PLAN §5.2 item 5).

### I.9 Verification

```
pnpm tsx paper/prereg/check-prereg.ts            # Part II verbatim from PLAN; constants present
pnpm tsx paper/prereg/check-prereg.ts --final    # also: no <<FILL@...>> slot left (required at F5)
pnpm tsx paper/prereg/check-ledger.ts            # freeze order, ancestry, peeled refs, hashes
pnpm tsx paper/prereg/build-registry.ts --dry-run   # registry blob ids == git ls-tree -r HEAD
```

## Part II. Registered rules (verbatim from PLAN.md)

### 3. Confirmatory family (m = 4, Holm, FWER 0.05)

The worst-case Holm level is α = 0.05/4 = 0.0125, and every power number uses it. Each H maps to one part of the novelty (trigger, artifact, placement) and can fail on its own. m becomes 3 only by the outcome-free N_E rule in §3.1, fixed at F4b.

#### 3.0 Shared definitions [design]

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

#### 3.1 H1. Trigger precision (SYN H5, entity-level form)

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

#### 3.2 H2. Test adequacy over a fixed, arm-independent patch pool (SYN H11; C19 vs agent-written repros)

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

#### 3.3 H3. The visible repro adds value once the same trigger check gates both: FIKS vs L1 (IUT)

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

#### 3.4 H4. Against the strongest composition: FIKS vs COMP (IUT)

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

#### 3.5 Pre-registered readings

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

### 4. Exploratory and descriptive sets

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

#### 5.5 Repro baseline inputs and F check

- **Inputs.** REPRO-AGENT receives the same alert JSON, frozen raw trace and replay-helper sentence as L1/COMP (§6.2).
- **Task.** Write one new test file under `test/` that reproduces the issue on the current code. A fixed sentence in the task text (round 5) says: "Load the recorded exchange from `.alerts/<id>.json` with the repository's replay helper (`test/fiks/replay.ts`, or `test/fiks/run.ts`/`check.ts`, which wrap it); do not copy it into the test." This lets `accept()` re-record it like the fiks fixture (§3.2). Tests that inline a recording anyway are kept as they behave and flagged.
- **Budget.** 1 session, 30 turns.
- **F check** (harness, sandbox image, 3 runs). The agent's test file must:
  - load without error;
  - report ≥ 1 assertion failure in all 3 runs on base.
- **Feedback.** When the agent ends its turn and F does not hold, the session resumes with one fixed message: "Your test does not fail on the current code because of the reported issue: <first 40 lines of the runner output>. Revise it so it fails on the current code." At most 3 F rounds within the 30 turns.
- **Recorded:** the first test (unfiltered, for s1), the final test (primary), the F verdict per round, and the turns used.
- **Fairness.** The F check uses only base, never ref A, B or any fix. FIKS's own F gate has the same information.

#### 5.7 Frames and enumerated traffic

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

#### 8.2 K1 rules (pre-declared; the only choices made from dev data and throughput)

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

### 9. Analysis plan

#### 9.1 Scripts

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

#### 9.2 Methods

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

#### 9.3 Infra-error policy

- **API-call level.** 3 retries with backoff.
- **Attempt level.** `infra_error` covers: SDK/transport failure after retries; 429/5xx; harness crash; container start failure; timeout with no model output; cap stop mid-attempt.
  - It is re-queued ≤ 2 times.
  - If it persists, the (drift, model, attempt-index) cell is dropped **for all arms** and counted.
- **Model outcomes, not infra.** Hitting `maxTurns`, the budget cap or the 90-minute cap.
- **Differential infra.** Infra rate per arm with Wilson CIs. If any pairwise arm gap is > 2 pp, or > 5% of cells are dropped overall, the worst-case imputation (FIKS = green-incorrect, no correct PR; comparator = correct PR) is shown next to the primary.

#### 9.4 Exclusions (only these)

1. Drifts and benign cases that fail automated validity before unsealing (F7).
2. Drifts with a forbidden read in the authoring audit.
3. Undetected drifts: excluded from H2–H4 by design; included in D4/E3. "Detected" means ≥ 1 drift-attributable violation (§3.0, defined before F5), so a drift whose only violations also occur on its v1 control is undetected by definition, not by a post-hoc exclusion; it is counted in D12.
4. Drifts with < 3 patches in a class (H2 only).
5. Persistent-infra cells (pairwise).
6. Frame inputs where the base output ≢ `truth()` on v1, and entities left with no eligible input (H1; reported).

F-gate failures are FIKS outcomes (`no_pr`) and are never excluded. In H2, both the fiks and the agent tests count as they behave.

#### 9.5 Deviations

- Logged in `paper/prereg/DEVIATIONS.md`: date, item, reason, who decided, affected runs, and the result under both analyses.
- No interim looks. Runners print status counts only, with no correctness or verdict fields; R2 prints completion counts, not FP counts.
- Any post-F5 change to code that affects verdicts requires re-running the affected cells.
- A0 contract edits other than the registered mechanical disable (`scripts/contract-disable.mjs`, frozen at F2 with the evaluator's `disabled` support) are deviations.
- A catalog top-up after F4b is a deviation.

#### 9.6 Power reproduction

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

### 13. What is cut

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
