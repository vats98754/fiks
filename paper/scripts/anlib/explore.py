"""Helpers for the exploratory scripts e*_*.py (PLAN 4).

Exploratory results carry raw p-values and 95% BCa CIs and are never called "significant"
[arcuri2014hitchhiker]. Every e*_*.py calls `start()` first, which refuses to run without the
CP2 lock.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from typing import Callable

import numpy as np

from . import stats
from .io import read_records, write_json
from .lock import add_lock_arg, require_lock
from .paired import SEED

NOTE = "exploratory: raw p and 95% BCa CI; never called significant"


def parser(doc: str) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=doc, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_lock_arg(p)
    p.add_argument("--out", help="write the result JSON here")
    p.add_argument("--seed", type=int, default=SEED)
    p.add_argument("--flips", type=int, default=stats.DEFAULT_FLIPS)
    return p


def start(p: argparse.ArgumentParser, argv: list[str]) -> argparse.Namespace:
    a = p.parse_args(argv)
    require_lock(a.lock)
    return a


def finish(a: argparse.Namespace, res: dict) -> int:
    res = {"note": NOTE, **res}
    if a.out:
        write_json(a.out, res)
    return 0


def runkey(r: dict) -> dict:
    rk = r["runKey"]
    if isinstance(rk, str):
        return dict(zip(("experiment", "arm", "model", "domain", "drift", "attempt"), rk.split("/")))
    return rk


def per_drift_rates(rows: list[dict], pred: Callable[[dict], bool], models: set[str] | None = None) -> dict:
    """arm -> drift -> equal-weight-over-models rate of pred(row); infra_error rows skipped."""
    acc: dict = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    for r in rows:
        if r.get("outcome") == "infra_error":
            continue
        rk = runkey(r)
        if models and rk["model"] not in models:
            continue
        acc[rk["arm"]][rk["drift"]][rk["model"]].append(1.0 if pred(r) else 0.0)
    out: dict = {}
    for arm, drifts in acc.items():
        out[arm] = {d: float(np.mean([np.mean(v) for v in ms.values()])) for d, ms in drifts.items()}
    return out


def paired_exploratory(a: dict, b: dict, flips: int, seed: int) -> dict:
    """Paired drift-level difference a - b over shared drifts: sign-flip raw p, 95% BCa."""
    shared = sorted(set(a) & set(b))
    d = np.array([a[k] - b[k] for k in shared])
    if d.size == 0:
        return {"n": 0}
    t = stats.sign_flip_p(d, "two-sided", flips=flips, seed=seed)
    return {
        "n": int(d.size),
        "mean": float(d.mean()),
        "rawP": t["p"],
        "method": t["method"],
        "bca95": stats.bca_ci(d, 0.95, stats.DEFAULT_BOOT, seed),
    }


def wilson_row(k: int, n: int) -> dict:
    return {"k": k, "n": n, "rate": (k / n) if n else None, "wilson95": stats.wilson(k, n, 0.95)}


def load(path: str) -> list[dict]:
    return read_records(path)
