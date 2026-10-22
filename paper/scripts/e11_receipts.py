#!/usr/bin/env python3
"""E11 (optional, last): receipts vs no monitor on agent answers, test drifts (PLAN 4 E11).

Input --trials: {drift, condition in {receipts, none}, trial, wrongAnswer (bool), correct (bool),
declined (bool)} (Sonnet, k = 4 per drift and condition).

Paired test (round 7): per-drift wrong-answer rate difference (none - receipts) over the k trials,
exact paired sign-flip over drifts (enumeration if n <= 20, else 200,000 flips), raw p, 95% BCa.
Correct rate, decline rate and pass^k (unbiased C(c,k)/C(n,k)) [yao2024taubench] are descriptive.
Refuses to run without the CP2 lock.
"""

from __future__ import annotations

import math
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from anlib import explore  # noqa: E402
from anlib.io import run_main  # noqa: E402


def pass_hat_k(n: int, c: int, k: int) -> float | None:
    if n < k:
        return None
    return math.comb(c, k) / math.comb(n, k) if c >= k else 0.0


def analyse(rows: list[dict], flips: int, seed: int) -> dict:
    by: dict = defaultdict(lambda: defaultdict(list))
    for r in rows:
        by[r["condition"]][r["drift"]].append(r)
    wrong = {c: {d: sum(bool(t["wrongAnswer"]) for t in ts) / len(ts) for d, ts in ds.items()} for c, ds in by.items()}
    res: dict = {"wrongAnswer(none - receipts)": explore.paired_exploratory(wrong.get("none", {}), wrong.get("receipts", {}), flips, seed)}
    for cond, ds in sorted(by.items()):
        allt = [t for ts in ds.values() for t in ts]
        kmax = min(len(ts) for ts in ds.values())
        res[cond] = {
            "correct": explore.wilson_row(sum(bool(t["correct"]) for t in allt), len(allt)),
            "declined": explore.wilson_row(sum(bool(t.get("declined")) for t in allt), len(allt)),
            "passHatK": {
                str(k): sum(pass_hat_k(len(ts), sum(bool(t["correct"]) for t in ts), k) for ts in ds.values()) / len(ds)
                for k in range(1, kmax + 1)
            },
        }
    return res


def main(argv: list[str]) -> int:
    p = explore.parser(__doc__)
    p.add_argument("--trials", required=True)
    a = explore.start(p, argv)
    res = analyse(explore.load(a.trials), a.flips, a.seed)
    w = res["wrongAnswer(none - receipts)"]
    print(f"wrong-answer rate none - receipts: mean {w.get('mean')} raw p {w.get('rawP')} (n {w.get('n')})")
    return explore.finish(a, res)


if __name__ == "__main__":
    run_main(main)
