#!/usr/bin/env python3
"""E3: detection coverage (PLAN 4 E3, 6.1).

Inputs
  --detections  one row per (detector, drift or mutant): {detector, unit, kind in {drift, benign,
                mutant}, stratum, ideationFamily, provenance, operator (mutants), fired}. A fire
                counts only if it is drift-attributable (DET has already applied the v1-control
                rule; non-attributable fires are a separate row: {..., nonAttributable: n}).
  --specificity one row per (detector, input) on F or benign traffic: {detector, input, fired}.

Outputs: per-detector recall on test drifts by stratum / ideation family / provenance (Wilson);
specificity (Wilson); mid-p McNemar (and exact) between `contracts` and every other detector at
drift level [fagerland2013mcnemar]; FN per mutation operator (Wilson), labelled
construction-coupled [jahangirova2016oracle]; non-attributable fires per detector.
Refuses to run without the CP2 lock.
"""

from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from anlib import explore, stats  # noqa: E402
from anlib.io import run_main  # noqa: E402

COUPLED = "construction-coupled: M1/M2 range, M8/M9/M13 freshness, M14 readAfterWrite, M6 countMatchesTotal"


def analyse(det: list[dict], spec: list[dict], reference: str = "contracts") -> dict:
    drifts = [r for r in det if r.get("kind") == "drift"]
    res: dict = {"recall": {}, "specificity": {}, "mcnemar": {}, "mutantFn": {"label": COUPLED}, "nonAttributable": {}}
    by_det: dict = defaultdict(list)
    for r in drifts:
        by_det[r["detector"]].append(r)
    for d, rs in sorted(by_det.items()):
        out = {"all": explore.wilson_row(sum(bool(r["fired"]) for r in rs), len(rs))}
        for key in ("stratum", "ideationFamily", "provenance"):
            groups: dict = defaultdict(list)
            for r in rs:
                groups[str(r.get(key))].append(bool(r["fired"]))
            out[key] = {g: explore.wilson_row(sum(v), len(v)) for g, v in sorted(groups.items())}
        res["recall"][d] = out
        res["nonAttributable"][d] = sum(int(r.get("nonAttributable") or 0) for r in rs)
    sp: dict = defaultdict(list)
    for r in spec:
        sp[r["detector"]].append(not r["fired"])
    res["specificity"] = {d: explore.wilson_row(sum(v), len(v)) for d, v in sorted(sp.items())}
    ref = {r["unit"]: bool(r["fired"]) for r in by_det.get(reference, [])}
    for d, rs in sorted(by_det.items()):
        if d == reference:
            continue
        other = {r["unit"]: bool(r["fired"]) for r in rs}
        shared = set(ref) & set(other)
        b = sum(1 for u in shared if ref[u] and not other[u])
        c = sum(1 for u in shared if other[u] and not ref[u])
        res["mcnemar"][f"{reference} vs {d}"] = {**stats.mcnemar(b, c), "n": len(shared)}
    muts: dict = defaultdict(list)
    for r in det:
        if r.get("kind") == "mutant" and r["detector"] == reference:
            muts[str(r.get("operator"))].append(not r["fired"])
    res["mutantFn"]["byOperator"] = {o: explore.wilson_row(sum(v), len(v)) for o, v in sorted(muts.items())}
    return res


def main(argv: list[str]) -> int:
    p = explore.parser(__doc__)
    p.add_argument("--detections", required=True)
    p.add_argument("--specificity", required=True)
    p.add_argument("--reference", default="contracts")
    a = explore.start(p, argv)
    res = analyse(explore.load(a.detections), explore.load(a.specificity), a.reference)
    for k, v in res["mcnemar"].items():
        print(f"{k}: b {v['b']} c {v['c']} mid-p {v['midp']:.4g} exact {v['exact_p']:.4g} (raw)")
    return explore.finish(a, res)


if __name__ == "__main__":
    run_main(main)
