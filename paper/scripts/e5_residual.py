#!/usr/bin/env python3
"""E5: gate residual and collateral regressions (PLAN 4 E5).

Inputs
  --candidates  one row per captured candidate (CandidateRecord + grade): {id, drift, arm,
                passedAllFiksGates (bool), heldOutCorrect (bool), gateRejected (bool),
                collateralRegression (bool)}
  --secondary-matrix/--secondary-pool  optional: H2 on the secondary, arm-derived pool (E5 only),
                in h2_adequacy.py's matrix format, reported by source.

Residual = candidates passing every fiks gate yet held-out-incorrect (Wilson, per arm); collateral
regressions among gate-rejected candidates [tayebati2026selfhealingharness].
Refuses to run without the CP2 lock.
"""

from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import h2_adequacy  # noqa: E402
from anlib import explore  # noqa: E402
from anlib.io import read_json, run_main  # noqa: E402


def analyse(cands: list[dict]) -> dict:
    by_arm: dict = defaultdict(list)
    for c in cands:
        by_arm[c["arm"]].append(c)
    res: dict = {"residual": {}, "collateral": {}}
    for arm, cs in sorted(by_arm.items()):
        passed = [c for c in cs if c.get("passedAllFiksGates")]
        res["residual"][arm] = explore.wilson_row(sum(not c["heldOutCorrect"] for c in passed), len(passed))
        rej = [c for c in cs if c.get("gateRejected")]
        res["collateral"][arm] = explore.wilson_row(sum(bool(c.get("collateralRegression")) for c in rej), len(rej))
    return res


def main(argv: list[str]) -> int:
    p = explore.parser(__doc__)
    p.add_argument("--candidates", required=True)
    p.add_argument("--secondary-matrix")
    p.add_argument("--secondary-pool")
    a = explore.start(p, argv)
    res = analyse(explore.load(a.candidates))
    if a.secondary_matrix and a.secondary_pool:
        h2 = h2_adequacy.analyse(explore.load(a.secondary_matrix), read_json(a.secondary_pool), a.flips, a.seed)
        res["secondaryPoolH2"] = {"primaryRow": h2["primary"], "bySource": h2["bySource"]}
    for arm, r in res["residual"].items():
        print(f"{arm}: residual {r['k']}/{r['n']}")
    return explore.finish(a, res)


if __name__ == "__main__":
    run_main(main)
