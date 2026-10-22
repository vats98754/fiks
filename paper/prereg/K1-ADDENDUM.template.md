# K1 addendum, `prereg-v1.1` (template)

Copy to `paper/prereg/K1-ADDENDUM.md` and fill in at K1, after R1 and before R2 (PLAN §8.1 row R1, §8.2). Tag `prereg-v1.1` (F8) on the commit that adds it, then record F8 in the freeze ledger with this file's sha256. **Only the choices below may be made, and only from dev data and throughput** (T0, R1, A1 cap events). "Nothing else in PREREG may change" (§8.2); anything else is a deviation (`DEVIATIONS.md`). No test-split data exists or is read when this is written.

## 0. Inputs (dev and throughput only)

| Input | Path | sha256 |
|---|---|---|
| T0 throughput (`paper/results/raw/throughput.json`) | | |
| R1 pilot logs (dev split, 29 instances) | | |
| `eval_stats.py decompose` output (drift × model × attempt) | | |
| A1 / R1 cap events | | |
| R0 SAST/timing pilot (re-estimated R5 hours) | | |
| `TUNING.md` at K1 (all comparator and judge iterations logged) | | |

## 1. Fit (PLAN §8.2 "Projected quantity", "Fit", "Non-Claude wall-clock")

| Quantity | Value |
|---|---|
| W (calendar days; fixed before F5 at 8) | 8 |
| Sustained rate measured in T0/R1 (units/h) | |
| Projected Claude usage over remaining runs incl. 30% reserve (units: Opus 1, Sonnet 0.5, Haiku 0.2) | |
| Non-overlappable R5 hours (re-measured at R0) + R0 + CP2 | |
| `pnpm exp fit --measured paper/results/raw/throughput.json` output (paste; it asserts strict decrease along the walk) | |

## 2. Configuration chosen

| Choice | Value | Rule |
|---|---|---|
| Configuration (S+ if a = 5 fits; else S0 and the §13 walk) | | §8.2 "Configuration" |
| Cut-order position (last §13 step applied: none, 1–11) | | stop at the first prefix that fits |
| Steps applied, with projected units removed by each | | §13 table |
| a (attempts per cell) | | |
| Models | | |
| Workers (largest of {1, 2, 4, 6} with < 2% 429/overload and peak RSS ≤ 16 GB − 6 GB Docker) | | §8.2 "Workers" |
| Judge variant (highest dev BA among {Sonnet, Haiku} × {± upstream}; tie → cheaper; E3 only) | | §8.2 "Judge variant" |
| Ollama share of R9 (cut if T0 projects > 10 h) | | §8.2 wall-clock rule |

## 3. σ_d per endpoint (from dev via `decompose`)

| Endpoint | p (dev) | τ (dev) | σ_d (dev) | Planning σ_d (PLAN §3.3) |
|---|---|---|---|---|
| H2 Δ BA | | | | 0.25 (0.35 sensitivity) |
| H3a / H4a harm | | | | S0 0.177; S2 0.196; S3 0.229 |
| H3b / H4b correct-PR | | | | S0 0.253; S2 0.279; S3 0.325 |

## 4. Restated MDEs and joint IUT power at the chosen configuration

Commands: `paper/.venv/bin/python paper/scripts/power.py …` and `simulate_power.py` with the dev σ_d (paste each command and its output).

| Quantity | n = 61 | n = 40 | n = realised (if known) |
|---|---|---|---|
| H2 MDE (two-sided α 0.0125, power 0.8) | | | |
| H3a/H4a harm MDE | | | |
| H3b/H4b NI power at δ = 0.10 (θ = 0) | | | |
| NI power at θ = −0.03 / −0.05 | | | |
| Harm power at Δ = 0.10 / 0.05 | | | |
| Joint IUT power (product; simulation informational) | | | |

## 5. Unchanged (confirm each)

- [ ] Hypotheses, endpoints, tests, margins, direction guards and readings (PREREG Part II §3) unchanged.
- [ ] Holm family and m as fixed at F4b.
- [ ] Exclusions (§9.4) and infra policy (§9.3) unchanged.
- [ ] Never cut: verifier gates; the F gate and stated-reason check; the green-CI gate; IV in L1 and COMP; held-out grading; the claims audit (§13).
- [ ] H2–H4 floor n = 40 respected.

## Sign-off

- Written by / date (UTC):
- Tag `prereg-v1.1` peeled commit:
- Ledger F8 recorded (`files` includes `paper/prereg/K1-ADDENDUM.md`), `check-ledger.ts` PASS:
