"""Drift-level paired summaries shared by H2, H3, H4 and the exploratory sets (PLAN 9.2)."""

from __future__ import annotations

import math
from typing import Mapping

import numpy as np

from . import stats

HOLM_WORST = 0.0125
SEED = 20261021  # PREREG fixes the seed; this is the default until PREREG overrides it.


def superiority(
    d: Mapping[str, float], flips: int = stats.DEFAULT_FLIPS, seed: int = SEED, boot: int = stats.DEFAULT_BOOT
) -> dict:
    """Two-sided sign-flip on d_i plus 95/97.5% BCa over drifts and the realised MDE."""
    drifts = sorted(d)
    v = np.array([d[k] for k in drifts], dtype=np.float64)
    n = v.size
    if n == 0:
        return {"n": 0, "mean": None, "p": 1.0, "method": "none"}
    t = stats.sign_flip_p(v, "two-sided", flips=flips, seed=seed)
    sd = float(v.std(ddof=1)) if n > 1 else 0.0
    return {
        "n": n,
        "mean": float(v.mean()),
        "sd": sd,
        "p": t["p"],
        "method": t["method"],
        "flips": t["flips"],
        "bca95": stats.bca_ci(v, 0.95, boot, seed),
        "bca975": stats.bca_ci(v, 0.975, boot, seed),
        "mde": stats.mde(n, sd, HOLM_WORST) if n > 1 else None,
        "perDrift": {k: float(d[k]) for k in drifts},
    }


def guarded(summary: dict) -> float:
    """Direction guard (PLAN 3.2, 3.3 round 4): the decision p is 1 when mean d_i <= 0."""
    if summary["n"] == 0 or summary["mean"] is None or summary["mean"] <= 0:
        return 1.0
    return summary["p"]


def noninferiority(
    d: Mapping[str, float],
    delta: float,
    flips: int = stats.DEFAULT_FLIPS,
    seed: int = SEED,
    boot: int = stats.DEFAULT_BOOT,
    method: str = "sign-flip",
) -> dict:
    """One-sided shifted sign-flip on d_i + delta (rejects only for mean d > -delta), or the
    pre-declared studentized bootstrap-t fallback (PLAN 9.1 iii)."""
    drifts = sorted(d)
    v = np.array([d[k] for k in drifts], dtype=np.float64)
    n = v.size
    if n == 0:
        return {"n": 0, "mean": None, "p": 1.0, "method": "none", "delta": delta}
    if method == "sign-flip":
        t = stats.sign_flip_p(v, "greater", flips=flips, seed=seed, shift=delta)
        p, used = t["p"], t["method"]
    elif method == "bootstrap-t":
        p = stats.bootstrap_t_ni_p(v, delta, boot, np.random.default_rng(seed))
        used = "bootstrap-t"
    else:
        raise ValueError(method)
    sd = float(v.std(ddof=1)) if n > 1 else 0.0
    return {
        "n": n,
        "mean": float(v.mean()),
        "sd": sd,
        "delta": delta,
        "p": p,
        "method": used,
        "bca95": stats.bca_ci(v, 0.95, boot, seed),
        "bca975": stats.bca_ci(v, 0.975, boot, seed),
        "mde": stats.mde(n, sd, HOLM_WORST) if n > 1 else None,
        "perDrift": {k: float(d[k]) for k in drifts},
    }


def descriptive(d: Mapping[str, float], seed: int = SEED, boot: int = stats.DEFAULT_BOOT) -> dict:
    """Per-class rows: mean and BCa CIs only, never a p-value (PLAN 3.3 per drift class)."""
    drifts = sorted(d)
    v = np.array([d[k] for k in drifts], dtype=np.float64)
    if v.size == 0:
        return {"n": 0, "mean": None}
    return {
        "n": int(v.size),
        "mean": float(v.mean()),
        "bca95": stats.bca_ci(v, 0.95, boot, seed),
        "bca975": stats.bca_ci(v, 0.975, boot, seed),
    }


def fmt(x: float | None, nd: int = 3) -> str:
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "NA"
    return f"{x:.{nd}f}"
