#!/usr/bin/env python3
"""Joint IUT power by simulation (PLAN 3.3, 9.1; informational, not a gate).

  paper/.venv/bin/python paper/scripts/simulate_power.py --configs S0 S2 S3 --n 61 40

Configurations (PLAN 13): S+ (3 models x a = 5), S0 (3 x 4), S2 (3 x 3), S3 (2 x 3),
S4 (= S3; its n is the reduced drift count, pass --n 40).

Planning DGP (PLAN 3.3 sigma_d model): per drift, the true harm difference
Delta_i ~ N(0.10, 0.10^2) around a mean green-incorrect rate of 0.15 (comparator 0.15 + Delta_i/2,
FIKS 0.15 - Delta_i/2) and the true correct-PR difference theta_i ~ N(0, 0.15^2) around 0.5.
Per attempt the outcome is multinomial (correct, green-incorrect, other); per-drift rates are the
equal-weight mean over models of the per-model attempt means. Each dataset runs the pre-registered
components at the worst-case Holm level 0.0125: the harm two-sided sign-flip with the direction
guard and the NI shifted sign-flip (delta 0.10); joint power = both reject.
A K1 DGP replaces the planning values via --k1 FILE ({"harm": {"p", "tau", "effect"},
"correct": {"p", "tau", "theta"}}); none exists before K1.

Writes `simulatedIut` into paper/results/power.json (other keys kept), next to the analytic
product of the normal-approximation components for comparison.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from anlib import stats  # noqa: E402
from anlib.io import RESULTS_DIR, read_json, run_main, write_json  # noqa: E402

CONFIGS = {"S+": (3, 5), "S0": (3, 4), "S2": (3, 3), "S3": (2, 3), "S4": (2, 3)}
ALPHA = 0.0125
DELTA = 0.10
FLIPS = 1999
CHUNK = 100
PLANNING = {"harm": {"p": 0.15, "tau": 0.10, "effect": 0.10}, "correct": {"p": 0.5, "tau": 0.15, "theta": 0.0}}


def simulate(rng, d: int, n: int, models: int, attempts: int, dgp: dict) -> dict:
    h, c = dgp["harm"], dgp["correct"]
    delta_i = rng.normal(h["effect"], h["tau"], size=(d, n))
    theta_i = rng.normal(c["theta"], c["tau"], size=(d, n))
    hc = np.clip(h["p"] + delta_i / 2, 0, 1)
    hf = np.clip(h["p"] - delta_i / 2, 0, 1)
    cc = np.clip(c["p"] - theta_i / 2, 0, 1 - hc)
    cf = np.clip(c["p"] + theta_i / 2, 0, 1 - hf)

    def arm(pc, ph):
        u = rng.random((d, n, models, attempts))
        corr = (u < pc[:, :, None, None]).mean(axis=(2, 3))
        harm = ((u >= pc[:, :, None, None]) & (u < (pc + ph)[:, :, None, None])).mean(axis=(2, 3))
        return corr, harm

    f_c, f_h = arm(cf, hf)
    c_c, c_h = arm(cc, hc)
    harm_d = c_h - f_h
    ni_d = f_c - c_c
    ph, pn = [], []
    for s in range(0, d, CHUNK):
        ph.append(stats.sign_flip_p_batch(harm_d[s : s + CHUNK], "two-sided", FLIPS, rng))
        pn.append(stats.sign_flip_p_batch(ni_d[s : s + CHUNK], "greater", FLIPS, rng, DELTA))
    p_h = np.where(harm_d.mean(axis=1) > 0, np.concatenate(ph), 1.0)
    p_n = np.concatenate(pn)
    rh, rn = p_h <= ALPHA, p_n <= ALPHA
    return {
        "joint": float(np.mean(rh & rn)),
        "harm": float(np.mean(rh)),
        "ni": float(np.mean(rn)),
        "mcseJoint": math.sqrt(max(np.mean(rh & rn) * (1 - np.mean(rh & rn)), 1e-12) / d),
    }


def analytic(n: int, models: int, attempts: int, dgp: dict) -> dict:
    h, c = dgp["harm"], dgp["correct"]
    ma = models * attempts
    sd_h = math.sqrt(2 * h["p"] * (1 - h["p"]) / ma + h["tau"] ** 2)
    sd_c = math.sqrt(2 * c["p"] * (1 - c["p"]) / ma + c["tau"] ** 2)
    hp = stats.harm_power(n, sd_h, h["effect"], ALPHA)
    nip = stats.ni_power(n, sd_c, DELTA, ALPHA, c["theta"])
    return {"sdHarm": sd_h, "sdCorrect": sd_c, "harm": hp, "ni": nip, "product": hp * nip}


def run(configs: list[str], ns: list[int], datasets: int, seed: int, dgp: dict, label: str) -> dict:
    rng = np.random.default_rng(seed)
    out: dict = {}
    for cfg in configs:
        models, attempts = CONFIGS[cfg]
        out[cfg] = {"models": models, "attempts": attempts}
        for n in ns:
            out[cfg][f"n={n}"] = {
                "simulated": simulate(rng, datasets, n, models, attempts, dgp),
                "analytic": analytic(n, models, attempts, dgp),
            }
    return {
        "dgp": label,
        "params": dgp,
        "configs": list(configs),
        "ns": list(ns),
        "datasets": datasets,
        "flips": FLIPS,
        "seed": seed,
        "alpha": ALPHA,
        "results": out,
    }


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--configs", nargs="+", default=["S0", "S2", "S3"], choices=list(CONFIGS))
    p.add_argument("--n", type=int, nargs="+", default=[61, 40])
    p.add_argument("--datasets", type=int, default=2000)
    p.add_argument("--seed", type=int, default=20261021)
    p.add_argument("--k1", help="K1 DGP parameters (JSON); default: the planning DGP")
    p.add_argument("--out", default=str(RESULTS_DIR / "power.json"))
    a = p.parse_args(argv)
    dgp, label = (read_json(a.k1), "K1") if a.k1 else (PLANNING, "planning")
    res = run(a.configs, a.n, a.datasets, a.seed, dgp, label)
    prev = read_json(a.out) if Path(a.out).is_file() else {}
    prev.setdefault("simulatedIut", {})[label] = res
    write_json(a.out, prev)
    for cfg, r in res["results"].items():
        for k, v in r.items():
            if not k.startswith("n="):
                continue
            s, an = v["simulated"], v["analytic"]
            print(
                f"{cfg} {k}: joint IUT power {s['joint']:.3f} (harm {s['harm']:.3f}, NI {s['ni']:.3f}); "
                f"analytic product {an['product']:.3f} (sd_d harm {an['sdHarm']:.3f}, correct {an['sdCorrect']:.3f})"
            )
    print(f"wrote simulatedIut.{label} to {a.out} (informational)")
    return 0


if __name__ == "__main__":
    run_main(main)
