#!/usr/bin/env python3
"""E7: real bugs, wave 1 (PLAN 4 E7; descriptive only, round 4).

Input --attempts: one row per attempt {bug, arm in {FIKS, COMP, ISSUE-TEXT}, attempt, outcome}
plus optional --checks {bug, detectOnPrefix, fpOnFix, fOnPrefixRuns, fOnPrefixFails,
pOnHumanFix, fixDate, modelCutoff}.

Per bug and arm: the rate of each outcome (k/5) with a Wilson CI. No test, no comparative claim,
no pooling across bugs. Rows are stratified by fix date vs model cutoff [swe-bench-illusion].
Refuses to run without the CP2 lock.
"""

from __future__ import annotations

import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from anlib import explore  # noqa: E402
from anlib.io import run_main  # noqa: E402

OUTCOMES = ("correct_pr", "green_incorrect_pr", "red_pr", "no_pr", "infra_error")


def analyse(rows: list[dict], checks: list[dict] | None) -> dict:
    by: dict = defaultdict(lambda: defaultdict(list))
    for r in rows:
        by[r["bug"]][r["arm"]].append(r["outcome"])
    res: dict = {"perBug": {}, "scope": "descriptive only: no test, no comparative claim, no pooling"}
    for bug, arms in sorted(by.items()):
        res["perBug"][bug] = {}
        for arm, outs in sorted(arms.items()):
            c = Counter(outs)
            res["perBug"][bug][arm] = {o: explore.wilson_row(c[o], len(outs)) for o in OUTCOMES}
    if checks:
        for ch in checks:
            b = res["perBug"].setdefault(ch["bug"], {})
            b["checks"] = {k: v for k, v in ch.items() if k != "bug"}
            if ch.get("fixDate") and ch.get("modelCutoff"):
                b["stratum"] = "after-cutoff" if ch["fixDate"] > ch["modelCutoff"] else "before-cutoff"
    return res


def main(argv: list[str]) -> int:
    p = explore.parser(__doc__)
    p.add_argument("--attempts", required=True)
    p.add_argument("--checks")
    a = explore.start(p, argv)
    res = analyse(explore.load(a.attempts), explore.load(a.checks) if a.checks else None)
    for bug, arms in res["perBug"].items():
        for arm, r in arms.items():
            if arm in ("checks", "stratum"):
                continue
            cp = r["correct_pr"]
            print(f"{bug} {arm}: correct_pr {cp['k']}/{cp['n']} Wilson95 [{cp['wilson95'][0]:.3f}, {cp['wilson95'][1]:.3f}]")
    return explore.finish(a, res)


if __name__ == "__main__":
    run_main(main)
