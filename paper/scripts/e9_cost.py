#!/usr/bin/env python3
"""E9: cost and time (PLAN 4 E9) [kapoor2025hal].

Input: classified attempts (AttemptRecord fields costUsd, tokens{in,out,cacheRead,cacheCreate},
turns, wallMs{phase: ms}). Per arm x model: median and IQR of API-price estimate, tokens, turns
and minutes per attempt; cost per correct PR (total cost / number of correct PRs); red-CI PRs per
arm (SYN H20) with Wilson. `total_cost_usd` under OAuth is an estimate, not a bill.
Refuses to run without the CP2 lock.
"""

from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from anlib import explore  # noqa: E402
from anlib.io import run_main  # noqa: E402


def summary(xs: list[float]) -> dict:
    if not xs:
        return {"n": 0}
    a = np.asarray(xs, dtype=np.float64)
    q1, med, q3 = np.quantile(a, [0.25, 0.5, 0.75])
    return {"n": int(a.size), "median": float(med), "iqr": [float(q1), float(q3)]}


def analyse(rows: list[dict]) -> dict:
    cells: dict = defaultdict(list)
    for r in rows:
        rk = explore.runkey(r)
        cells[(rk["arm"], rk["model"])].append(r)
    res: dict = {"perArmModel": {}, "redPrsPerArm": {}}
    for (arm, model), rs in sorted(cells.items()):
        tok = [sum((r.get("tokens") or {}).get(k, 0) for k in ("in", "out", "cacheRead", "cacheCreate")) for r in rs]
        mins = [sum((r.get("wallMs") or {}).values()) / 60000 for r in rs]
        cost = [float(r.get("costUsd") or 0) for r in rs]
        ncorrect = sum(1 for r in rs if r.get("outcome") == "correct_pr")
        res["perArmModel"][f"{arm}/{model}"] = {
            "costUsd": summary(cost),
            "tokens": summary(tok),
            "turns": summary([float(r.get("turns") or 0) for r in rs]),
            "minutes": summary(mins),
            "costPerCorrectPr": (sum(cost) / ncorrect) if ncorrect else None,
            "minutesPerCorrectPr": (sum(mins) / ncorrect) if ncorrect else None,
        }
    by_arm: dict = defaultdict(list)
    for r in rows:
        by_arm[explore.runkey(r)["arm"]].append(r)
    for arm, rs in sorted(by_arm.items()):
        res["redPrsPerArm"][arm] = explore.wilson_row(sum(r.get("outcome") == "red_pr" for r in rs), len(rs))
    return res


def main(argv: list[str]) -> int:
    p = explore.parser(__doc__)
    p.add_argument("--attempts", required=True)
    a = explore.start(p, argv)
    res = analyse(explore.load(a.attempts))
    for k, v in res["perArmModel"].items():
        print(f"{k}: median cost {v['costUsd'].get('median')} median minutes {v['minutes'].get('median')}")
    return explore.finish(a, res)


if __name__ == "__main__":
    run_main(main)
