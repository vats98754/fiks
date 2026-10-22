#!/usr/bin/env python3
"""Size checks of the confirmatory tests; the gate for F3 (PLAN 9.1).

  paper/.venv/bin/python paper/scripts/simulate_null.py --check --datasets 2000

(i)   H1 exact entity test: analytic exact size <= alpha, and the simulated rejection rate under
      i.i.d. entities (N_E Bernoulli(0.02) indicators per dataset) within +-3 MC SE of that size.
      Informational: size under a beta-binomial authoring-batch DGP (batches of 25; ICC 0.02, 0.05).
(ii)  Two-sided sign-flip tests for H2, H3a and H4a: rejection within alpha +-3 MC SE at
      alpha 0.05 and 0.0125 under symmetric nulls with drift heterogeneity:
        H2   per-drift BA level ~ U(0.55, 0.95), per-drift noise scale ~ U(0.02, 0.15); one fiks
             test and six agent tests, exchangeable (Delta_i symmetric about 0).
        H3a  green-incorrect rate per drift ~ Beta(1.5, 8.5) (mean 0.15), per-model logit offsets
             (-0.3, 0, 0.3), m models x a attempts per arm, both arms the same rate.
        H4a  as H3a with Beta(2, 8) (mean 0.20).
(iii) Shifted sign-flip NI (H3b, H4b) at the boundary mean d = -0.10, size <= alpha + 3 MC SE:
        symmetric  comparator correct rate ~ U(0.3, 0.7), FIKS = comparator - 0.10 on every drift.
        skewed     (pre-registered) comparator ~ U(0.45, 0.75); FIKS - comparator = -0.025 with
                   probability 0.8 and -0.40 with probability 0.2 (mean exactly -0.10; long left tail).
      If the sign-flip fails either DGP, the studentized bootstrap-t over drifts is selected (the
      only pre-declared alternative) and must itself pass.
(iv)  IUT (both components rejected) under the least-favourable DGPs, rejection <= alpha + 3 MC SE:
        LF-harm  harm difference 0 (both 0.15), correct-PR difference +0.30 (0.65 vs 0.35);
        LF-NI    correct-PR difference exactly -0.10 (0.30 vs 0.40), harm difference 0.40
                 (FIKS 0.10 vs comparator 0.50).
      Per-attempt outcomes are multinomial (correct, green-incorrect, other); a per-drift shift
      U(-0.05, 0.05) common to both arms adds heterogeneity without changing the differences.

Monte Carlo sign-flip p-values use B = 1999 flips per dataset, p = (1 + #{T* >= T}) / (1 + B),
which is a valid test for any B; the real analysis uses 200,000 flips. Exit 0 iff every gated
check passes.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from anlib import stats  # noqa: E402
from anlib.io import run_main, write_json  # noqa: E402

ALPHAS = (0.05, 0.0125)
H1_P0 = 0.02
H1_ALPHA = 0.0125
DELTA = 0.10
FLIPS = 1999
CHUNK = 100
MODEL_OFFSETS = (-0.3, 0.0, 0.3)


def mcse(p: float, d: int) -> float:
    return math.sqrt(p * (1 - p) / d)


def logit(p):
    return np.log(p / (1 - p))


def expit(x):
    return 1 / (1 + np.exp(-x))


# ----------------------------------------------------------------------------- (i) H1
def check_h1(rng, d: int, ne: int) -> dict:
    crit = stats.binom_crit(ne, H1_P0, H1_ALPHA)
    size = stats.binom_size(ne, H1_P0, crit)
    x = np.concatenate(
        [(rng.random((min(200, d - s), ne)) < H1_P0).sum(axis=1) for s in range(0, d, 200)]
    )
    rate = float(np.mean(x <= crit))
    se = mcse(size, d)
    info = {}
    nb = ne // 25
    for icc in (0.02, 0.05):
        a = H1_P0 * (1 - icc) / icc
        b = (1 - H1_P0) * (1 - icc) / icc
        pis = rng.beta(a, b, size=(d, nb))
        xs = rng.binomial(25, pis).sum(axis=1)
        r = float(np.mean(xs <= crit))
        info[f"icc={icc}"] = {"rejection": r, "mcse": mcse(max(r, 1e-9), d)}
    ok = size <= H1_ALPHA and abs(rate - size) <= 3 * se
    return {
        "NE": ne,
        "crit": crit,
        "analyticSize": size,
        "simulatedRejection": rate,
        "mcse": se,
        "pass": ok,
        "betaBinomialInformational": info,
    }


# ----------------------------------------------------------------------------- DGPs
def rates_from_attempts(rng, p: np.ndarray, models: int, attempts: int) -> np.ndarray:
    """p: datasets x drifts x models probabilities -> per-drift equal-weight model mean rate."""
    k = rng.binomial(attempts, p)
    return (k / attempts).mean(axis=2)


def dgp_h2(rng, d: int, n: int) -> np.ndarray:
    level = rng.uniform(0.55, 0.95, size=(d, n))
    scale = rng.uniform(0.02, 0.15, size=(d, n))
    fiks = level + scale * rng.standard_normal((d, n))
    agent = level + scale * rng.standard_normal((d, n, 6)).mean(axis=2)
    return fiks - agent


def dgp_harm_null(rng, d: int, n: int, a: float, b: float, models: int, attempts: int) -> np.ndarray:
    base = rng.beta(a, b, size=(d, n))
    off = np.array(MODEL_OFFSETS[:models]) if models <= 3 else np.linspace(-0.3, 0.3, models)
    p = expit(logit(np.clip(base, 1e-4, 1 - 1e-4))[:, :, None] + off[None, None, :])
    return rates_from_attempts(rng, p, models, attempts) - rates_from_attempts(rng, p, models, attempts)


def dgp_ni_boundary(rng, d: int, n: int, models: int, attempts: int, skewed: bool) -> np.ndarray:
    if skewed:
        comp = rng.uniform(0.45, 0.75, size=(d, n))
        theta = np.where(rng.random((d, n)) < 0.8, -0.025, -0.40)
    else:
        comp = rng.uniform(0.3, 0.7, size=(d, n))
        theta = np.full((d, n), -DELTA)
    pc = np.repeat(comp[:, :, None], models, axis=2)
    pf = np.repeat((comp + theta)[:, :, None], models, axis=2)
    return rates_from_attempts(rng, pf, models, attempts) - rates_from_attempts(rng, pc, models, attempts)


def multinomial_rates(rng, pc: float, ph: float, shift: np.ndarray, models: int, attempts: int):
    """Per-drift (correct, harm) rates from multinomial attempts; shift is added to correct."""
    d, n = shift.shape
    c = np.clip(pc + shift, 0, 1)
    u = rng.random((d, n, models, attempts))
    correct = (u < c[:, :, None, None]).mean(axis=(2, 3))
    harm = ((u >= c[:, :, None, None]) & (u < (c + ph)[:, :, None, None])).mean(axis=(2, 3))
    return correct, harm


# ----------------------------------------------------------------------------- tests
def flip_pvals(rng, X: np.ndarray, alternative: str, shift: float = 0.0) -> np.ndarray:
    out = []
    for s in range(0, X.shape[0], CHUNK):
        out.append(stats.sign_flip_p_batch(X[s : s + CHUNK], alternative, FLIPS, rng, shift))
    return np.concatenate(out)


def boot_t_pvals(rng, X: np.ndarray) -> np.ndarray:
    return np.array([stats.bootstrap_t_ni_p(row, DELTA, FLIPS, rng) for row in X])


def size_rows(p: np.ndarray, d: int, two_sided_band: bool) -> dict:
    rows = {}
    for alpha in ALPHAS:
        r = float(np.mean(p <= alpha))
        se = mcse(alpha, d)
        ok = abs(r - alpha) <= 3 * se if two_sided_band else r <= alpha + 3 * se
        row = {"rejection": r, "mcse": se, "pass": ok}
        if not ok:
            row["direction"] = "conservative" if r < alpha else "anti-conservative"
        rows[str(alpha)] = row
    return rows


def run(d: int, n: int, models: int, attempts: int, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    res: dict = {"datasets": d, "n": n, "models": models, "attempts": attempts, "flips": FLIPS, "seed": seed}
    res["i_h1"] = {"NE1500": check_h1(rng, d, 1500), "NE1000": check_h1(rng, d, 1000)}

    signflip = {}
    for name, X in (
        ("H2", dgp_h2(rng, d, n)),
        ("H3a", dgp_harm_null(rng, d, n, 1.5, 8.5, models, attempts)),
        ("H4a", dgp_harm_null(rng, d, n, 2.0, 8.0, models, attempts)),
    ):
        signflip[name] = size_rows(flip_pvals(rng, X, "two-sided"), d, two_sided_band=True)
    res["ii_signflip"] = signflip

    ni = {}
    data = {
        "symmetric": dgp_ni_boundary(rng, d, n, models, attempts, False),
        "skewed": dgp_ni_boundary(rng, d, n, models, attempts, True),
    }
    for name, X in data.items():
        ni[name] = size_rows(flip_pvals(rng, X, "greater", DELTA), d, two_sided_band=False)
    sf_ok = all(r["pass"] for v in ni.values() for r in v.values())
    res["iii_ni"] = {"signFlip": ni, "selected": "sign-flip" if sf_ok else "bootstrap-t"}
    if not sf_ok:
        bt = {name: size_rows(boot_t_pvals(rng, X), d, two_sided_band=False) for name, X in data.items()}
        res["iii_ni"]["bootstrapT"] = bt
    method = res["iii_ni"]["selected"]

    iut = {}
    for name, (fc, fh, cc, ch) in {"LF-harm": (0.65, 0.15, 0.35, 0.15), "LF-NI": (0.30, 0.10, 0.40, 0.50)}.items():
        shift = rng.uniform(-0.05, 0.05, size=(d, n))
        f_c, f_h = multinomial_rates(rng, fc, fh, shift, models, attempts)
        c_c, c_h = multinomial_rates(rng, cc, ch, shift, models, attempts)
        harm_d = c_h - f_h
        ni_d = f_c - c_c
        p_harm = flip_pvals(rng, harm_d, "two-sided")
        p_harm = np.where(harm_d.mean(axis=1) > 0, p_harm, 1.0)
        p_ni = flip_pvals(rng, ni_d, "greater", DELTA) if method == "sign-flip" else boot_t_pvals(rng, ni_d)
        p_iut = np.maximum(p_harm, p_ni)
        iut[name] = size_rows(p_iut, d, two_sided_band=False)
    res["iv_iut"] = iut

    gated = [res["i_h1"]["NE1500"]["pass"], res["i_h1"]["NE1000"]["pass"]]
    gated += [r["pass"] for v in signflip.values() for r in v.values()]
    if method == "sign-flip":
        gated += [r["pass"] for v in ni.values() for r in v.values()]
    else:
        gated += [r["pass"] for v in res["iii_ni"]["bootstrapT"].values() for r in v.values()]
    gated += [r["pass"] for v in iut.values() for r in v.values()]
    res["pass"] = all(gated)
    return res


def report(res: dict) -> None:
    for k, h in res["i_h1"].items():
        print(
            f"(i) H1 {k}: crit {h['crit']} analytic size {h['analyticSize']:.4f} simulated "
            f"{h['simulatedRejection']:.4f} (3 MC SE {3 * h['mcse']:.4f}) {'PASS' if h['pass'] else 'FAIL'}; "
            + ", ".join(f"beta-binomial {i}: {v['rejection']:.4f}" for i, v in h["betaBinomialInformational"].items())
        )
    for name, rows in res["ii_signflip"].items():
        for a, r in rows.items():
            verdict = "PASS" if r["pass"] else f"FAIL ({r['direction']})"
            print(f"(ii) {name} alpha {a}: rejection {r['rejection']:.4f} (alpha +-{3 * r['mcse']:.4f}) {verdict}")
    for name, rows in res["iii_ni"]["signFlip"].items():
        for a, r in rows.items():
            print(f"(iii) NI sign-flip {name} alpha {a}: rejection {r['rejection']:.4f} (<= alpha + {3 * r['mcse']:.4f}) {'PASS' if r['pass'] else 'FAIL'}")
    for name, rows in res["iii_ni"].get("bootstrapT", {}).items():
        for a, r in rows.items():
            print(f"(iii) NI bootstrap-t {name} alpha {a}: rejection {r['rejection']:.4f} {'PASS' if r['pass'] else 'FAIL'}")
    print(f"(iii) NI method selected: {res['iii_ni']['selected']}")
    for name, rows in res["iv_iut"].items():
        for a, r in rows.items():
            print(f"(iv) IUT {name} alpha {a}: rejection {r['rejection']:.4f} (<= alpha + {3 * r['mcse']:.4f}) {'PASS' if r['pass'] else 'FAIL'}")
    print("simulate_null: " + ("PASS" if res["pass"] else "FAIL"))


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--check", action="store_true", help="exit 1 unless every gated check passes")
    p.add_argument("--datasets", type=int, default=2000)
    p.add_argument("--n", type=int, default=61)
    p.add_argument("--models", type=int, default=3)
    p.add_argument("--attempts", type=int, default=4)
    p.add_argument("--seed", type=int, default=20261021)
    p.add_argument("--out")
    a = p.parse_args(argv)
    res = run(a.datasets, a.n, a.models, a.attempts, a.seed)
    if a.out:
        write_json(a.out, res)
    report(res)
    return 1 if a.check and not res["pass"] else 0


if __name__ == "__main__":
    run_main(main)
