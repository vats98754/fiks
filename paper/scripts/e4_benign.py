#!/usr/bin/env python3
"""E4: benign evolution (PLAN 4 E4).

Inputs
  --benign   one row per attempt: {case, arm in {FIKS-current, FIKS+CU, COMP}, attempt (0-based),
             outcome in {code_pr, contract_update_proposed, no_pr, infra_error}, documented (bool)}
  --routing  FIKS+CU on detected true drifts: {drift, routedToCode (bool)} (misrouting guard)

Y = 1 iff a code PR is exposed on a benign case; per-case rate over the attempts. Contrasts
FIKS-current - FIKS+CU and COMP - FIKS+CU: exact paired sign-flip on per-case differences
(enumeration if n <= 20, else 200,000 flips), raw p; mid-p McNemar on first-attempt outcomes
as sensitivity [fagerland2013mcnemar]; Wilson CI on every rate, overall and by changelog stratum.
Misrouting guard: FIKS+CU routes >= 90% of detected true drifts to code, judged by the exact
(Clopper-Pearson) one-sided 95% lower bound. Refuses to run without the CP2 lock.
"""

from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from anlib import explore, stats  # noqa: E402
from anlib.io import run_main  # noqa: E402

BASE = "FIKS+CU"
ARMS = ("FIKS-current", "FIKS+CU", "COMP")


def analyse(rows: list[dict], routing: list[dict] | None, flips: int, seed: int) -> dict:
    per: dict = defaultdict(lambda: defaultdict(list))
    first: dict = defaultdict(dict)
    documented: dict = {}
    for r in rows:
        if r["outcome"] == "infra_error":
            continue
        y = 1.0 if r["outcome"] == "code_pr" else 0.0
        per[r["arm"]][r["case"]].append(y)
        documented[r["case"]] = bool(r.get("documented"))
        if int(r["attempt"]) == 0:
            first[r["arm"]][r["case"]] = y
    rates = {arm: {c: sum(v) / len(v) for c, v in cases.items()} for arm, cases in per.items()}
    res: dict = {"rates": {}, "contrasts": {}, "firstAttemptMcNemar": {}}
    for arm in ARMS:
        ys = [y for v in per.get(arm, {}).values() for y in v]
        res["rates"][arm] = {"all": explore.wilson_row(int(sum(ys)), len(ys))}
        for doc in (True, False):
            ys2 = [y for c, v in per.get(arm, {}).items() if documented[c] == doc for y in v]
            res["rates"][arm]["documented" if doc else "undocumented"] = explore.wilson_row(int(sum(ys2)), len(ys2))
    for arm in ("FIKS-current", "COMP"):
        if arm in rates and BASE in rates:
            res["contrasts"][f"{arm} - {BASE}"] = explore.paired_exploratory(rates[arm], rates[BASE], flips, seed)
            shared = set(first[arm]) & set(first[BASE])
            b = sum(1 for c in shared if first[arm][c] == 1 and first[BASE][c] == 0)
            cc = sum(1 for c in shared if first[arm][c] == 0 and first[BASE][c] == 1)
            res["firstAttemptMcNemar"][f"{arm} vs {BASE}"] = {**stats.mcnemar(b, cc), "n": len(shared)}
    if routing is not None:
        k = sum(bool(r["routedToCode"]) for r in routing)
        n = len(routing)
        lower = stats.clopper_pearson(k, n, 0.90)[0] if n else float("nan")
        res["misroutingGuard"] = {"k": k, "n": n, "cpLower95OneSided": lower, "holds": bool(n and lower >= 0.90)}
    return res


def main(argv: list[str]) -> int:
    p = explore.parser(__doc__)
    p.add_argument("--benign", required=True)
    p.add_argument("--routing")
    a = explore.start(p, argv)
    res = analyse(explore.load(a.benign), explore.load(a.routing) if a.routing else None, a.flips, a.seed)
    for k, v in res["contrasts"].items():
        print(f"{k}: mean {v.get('mean')} raw p {v.get('rawP')} ({v.get('method')}, n {v.get('n')})")
    return explore.finish(a, res)


if __name__ == "__main__":
    run_main(main)
