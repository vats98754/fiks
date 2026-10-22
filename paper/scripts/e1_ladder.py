#!/usr/bin/env python3
"""E1: the repair ladder COMP-plain -> COMP-norep -> COMP -> L1-noIV -> L1 -> FIKS (PLAN 4).

Input: classified attempts (classify_outcome.py). Per rung vs FIKS: H3/H4 endpoints (harm =
green_incorrect_pr, correct = correct_pr) as paired drift-level differences with raw sign-flip
p and 95% BCa. Also: red-CI PRs per arm; held-out correctness of red heads; the IV effect
(L1-noIV vs L1, COMP-norep vs COMP); non-target IV stops per arm (attempts with
`ivNonTargetOnlyStop: true`, PLAN 3.0 asymmetry); L1p vs L1 (evidence-input effect).
Refuses to run without the CP2 lock.
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from anlib import explore  # noqa: E402
from anlib.io import run_main  # noqa: E402

LADDER = ["COMP-plain", "COMP-norep", "COMP", "L1-noIV", "L1", "FIKS"]


def analyse(rows: list[dict], flips: int, seed: int) -> dict:
    harm = explore.per_drift_rates(rows, lambda r: r["outcome"] == "green_incorrect_pr")
    corr = explore.per_drift_rates(rows, lambda r: r["outcome"] == "correct_pr")
    res: dict = {"ladder": {}, "contrasts": {}, "redPrs": {}, "redHeadsCorrect": {}, "nonTargetIvStops": {}}
    for arm in LADDER[:-1] + ["L1p"]:
        if arm in harm and "FIKS" in harm:
            res["ladder"][arm] = {
                "harm(arm - FIKS)": explore.paired_exploratory(harm[arm], harm["FIKS"], flips, seed),
                "correct(FIKS - arm)": explore.paired_exploratory(corr["FIKS"], corr[arm], flips, seed),
            }
    for without, with_ in (("L1-noIV", "L1"), ("COMP-norep", "COMP"), ("L1p", "L1")):
        if without in harm and with_ in harm:
            res["contrasts"][f"{without} vs {with_}"] = {
                "harm": explore.paired_exploratory(harm[without], harm[with_], flips, seed),
                "correct": explore.paired_exploratory(corr[with_], corr[without], flips, seed),
            }
    by_arm: dict = {}
    for r in rows:
        by_arm.setdefault(explore.runkey(r)["arm"], []).append(r)
    for arm, rs in sorted(by_arm.items()):
        c = Counter(r["outcome"] for r in rs)
        res["redPrs"][arm] = explore.wilson_row(c["red_pr"], len(rs))
        red = [r for r in rs if r["outcome"] == "red_pr" and r.get("heldOutCorrect") is not None]
        res["redHeadsCorrect"][arm] = explore.wilson_row(sum(bool(r["heldOutCorrect"]) for r in red), len(red))
        res["nonTargetIvStops"][arm] = sum(1 for r in rs if r.get("ivNonTargetOnlyStop"))
    return res


def main(argv: list[str]) -> int:
    p = explore.parser(__doc__)
    p.add_argument("--attempts", required=True)
    a = explore.start(p, argv)
    res = analyse(explore.load(a.attempts), a.flips, a.seed)
    for arm, r in res["ladder"].items():
        h = r["harm(arm - FIKS)"]
        print(f"{arm} vs FIKS: harm diff {h.get('mean')} raw p {h.get('rawP')} (n {h.get('n')})")
    return explore.finish(a, res)


if __name__ == "__main__":
    run_main(main)
