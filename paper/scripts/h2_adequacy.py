#!/usr/bin/env python3
"""H2: test adequacy over the fixed, arm-independent patch pool (PLAN 3.2, 5.6, 9.1).

Inputs
  --matrix  acceptance matrix, one row per (patch, test set) from HOLD's accept():
            {drift, patchId, correct (oracle grade, bool), source (pool source), testSet in
            {fiks, agent, empty}, testId (agent tests), variant in {final, first} (agent tests),
            fOnBase in {pass, fail, error} (agent tests), inlineRecording (bool), accepted (bool)}
  --pool    pool manifest {drifts: [{id, requestChanging (bool, F10, ref A only),
            fiksTestEmitted (bool)}]}

Rules
  - The fiks test counts as it behaves, also when it failed its own F gate. If FIKS emitted
    no test on a drift (fiksTestEmitted = false), T = empty: the `empty` rows are used.
  - BA = 1 - (FAR + FRR) / 2; BA_agent = mean BA over the drift's REPRO-AGENT tests;
    Delta_i = BA_fiks,i - BA_agent,i over drifts with >= 3 patches per class.
  - Two-sided sign-flip (exact if n <= 20, else 200,000 flips); 95/97.5% BCa over drifts.
    Decision p = 1 when mean Delta <= 0 (falsified if mean Delta <= 0).
  - Sensitivity rows: s1 = first, unfiltered agent test; s2 = only F-valid agent tests
    (fOnBase = fail; drifts with none dropped); s3 = primary without request-changing drifts.
  - Inline-recording counts per drift class; FAR/FRR/BA by pool source.
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from anlib import paired  # noqa: E402
from anlib.io import InputError, read_json, read_records, require, run_main, write_json  # noqa: E402

MIN_PER_CLASS = 3


def ba(rows: list[dict], labels: dict[str, bool]) -> dict:
    """BA of one test set over the drift's pool. Every pool patch must have exactly one row."""
    acc = {}
    for r in rows:
        require(r["patchId"] not in acc, f"duplicate row for patch {r['patchId']} in one test set")
        acc[r["patchId"]] = bool(r["accepted"])
    missing = set(labels) - set(acc)
    require(not missing, f"test set lacks rows for patches {sorted(missing)}")
    inc = [p for p, c in labels.items() if not c]
    cor = [p for p, c in labels.items() if c]
    far = sum(acc[p] for p in inc) / len(inc)
    frr = sum(not acc[p] for p in cor) / len(cor)
    return {"FAR": far, "FRR": frr, "BA": 1 - (far + frr) / 2}


def per_drift(matrix: list[dict], pool: dict) -> dict:
    by_drift: dict[str, list[dict]] = defaultdict(list)
    for r in matrix:
        by_drift[r["drift"]].append(r)
    meta = {d["id"]: d for d in pool["drifts"]}
    out = {}
    for drift, rows in sorted(by_drift.items()):
        require(drift in meta, f"drift {drift} is not in the pool manifest")
        labels: dict[str, bool] = {}
        for r in rows:
            c = bool(r["correct"])
            require(labels.get(r["patchId"], c) == c, f"{drift}: patch {r['patchId']} has two class labels")
            labels[r["patchId"]] = c
        n_cor = sum(labels.values())
        n_inc = len(labels) - n_cor
        rec = {
            "requestChanging": bool(meta[drift].get("requestChanging")),
            "nCorrect": n_cor,
            "nIncorrect": n_inc,
            "inUnit": n_cor >= MIN_PER_CLASS and n_inc >= MIN_PER_CLASS,
        }
        if not rec["inUnit"]:
            out[drift] = rec
            continue
        emitted = meta[drift].get("fiksTestEmitted")
        require(isinstance(emitted, bool), f"{drift}: pool manifest needs fiksTestEmitted")
        fiks_rows = [r for r in rows if r["testSet"] == "fiks"]
        if emitted:
            require(fiks_rows, f"{drift}: fiksTestEmitted but no fiks rows")
            rec["fiks"] = ba(fiks_rows, labels)
            rec["fiksSet"] = "fiks"
        else:
            require(not fiks_rows, f"{drift}: fiks rows present although fiksTestEmitted = false")
            rec["fiks"] = ba([r for r in rows if r["testSet"] == "empty"], labels)
            rec["fiksSet"] = "empty"
        agent: dict[tuple[str, str], list[dict]] = defaultdict(list)
        for r in rows:
            if r["testSet"] == "agent":
                agent[(r.get("variant", "final"), r["testId"])].append(r)
        tests = {}
        for (variant, tid), trs in sorted(agent.items()):
            fob = {r.get("fOnBase") for r in trs}
            require(len(fob) == 1, f"{drift} {tid}: inconsistent fOnBase")
            tests[(variant, tid)] = {
                **ba(trs, labels),
                "fOnBase": fob.pop(),
                "inlineRecording": any(r.get("inlineRecording") for r in trs),
            }
        finals = {t: v for (var, t), v in tests.items() if var == "final"}
        firsts = {t: v for (var, t), v in tests.items() if var == "first"}
        require(finals, f"{drift}: no final agent tests")
        rec["agentFinal"] = finals
        rec["agentFirst"] = firsts
        rec["BAagent"] = sum(v["BA"] for v in finals.values()) / len(finals)
        rec["delta"] = rec["fiks"]["BA"] - rec["BAagent"]
        if firsts:
            rec["deltaS1"] = rec["fiks"]["BA"] - sum(v["BA"] for v in firsts.values()) / len(firsts)
        valid = [v["BA"] for v in finals.values() if v["fOnBase"] == "fail"]
        if valid:
            rec["deltaS2"] = rec["fiks"]["BA"] - sum(valid) / len(valid)
        rec["inlineRecordings"] = sum(1 for v in finals.values() if v["inlineRecording"])
        out[drift] = rec
    return out


def by_source(matrix: list[dict], drifts: dict) -> dict:
    """Pooled FAR/FRR/BA by pool source for the fiks test (as used) and the final agent tests."""
    agg: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0, 0, 0])
    for r in matrix:
        d = drifts.get(r["drift"], {})
        if not d.get("inUnit"):
            continue
        ts = r["testSet"]
        if ts == "agent" and r.get("variant", "final") != "final":
            continue
        if ts in ("fiks", "empty") and ts != d.get("fiksSet"):
            continue
        key = ("fiks" if ts in ("fiks", "empty") else "agent", str(r.get("source")))
        a = agg[key]
        if r["correct"]:
            a[2] += 1
            a[3] += 0 if r["accepted"] else 1
        else:
            a[0] += 1
            a[1] += 1 if r["accepted"] else 0
    out = {}
    for (test, src), (ninc, acc_inc, ncor, rej_cor) in sorted(agg.items()):
        far = acc_inc / ninc if ninc else None
        frr = rej_cor / ncor if ncor else None
        out[f"{test}/{src}"] = {
            "FAR": far,
            "FRR": frr,
            "BA": None if far is None or frr is None else 1 - (far + frr) / 2,
            "nIncorrect": ninc,
            "nCorrect": ncor,
        }
    return out


def analyse(matrix: list[dict], pool: dict, flips: int = 200_000, seed: int = paired.SEED) -> dict:
    drifts = per_drift(matrix, pool)
    unit = {k: v for k, v in drifts.items() if v["inUnit"]}

    def row(key: str, keep=lambda v: True) -> dict:
        d = {k: v[key] for k, v in unit.items() if key in v and keep(v)}
        s = paired.superiority(d, flips, seed)
        s["pDecision"] = paired.guarded(s)
        return s

    primary = row("delta")
    inline = defaultdict(int)
    for v in unit.values():
        inline["request-changing" if v["requestChanging"] else "other"] += v["inlineRecordings"]
    return {
        "excludedFewPatches": sorted(k for k, v in drifts.items() if not v["inUnit"]),
        "primary": primary,
        "pH2": primary["pDecision"],
        "s1": row("deltaS1"),
        "s2": row("deltaS2"),
        "s3": row("delta", lambda v: not v["requestChanging"]),
        "perClass": {
            "request-changing": paired.descriptive(
                {k: v["delta"] for k, v in unit.items() if v["requestChanging"]}, seed
            ),
            "other": paired.descriptive({k: v["delta"] for k, v in unit.items() if not v["requestChanging"]}, seed),
        },
        "inlineRecordingByClass": dict(inline),
        "bySource": by_source(matrix, drifts),
        "drifts": drifts,
    }


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--matrix", required=True)
    p.add_argument("--pool", required=True)
    p.add_argument("--flips", type=int, default=200_000)
    p.add_argument("--seed", type=int, default=paired.SEED)
    p.add_argument("--out")
    a = p.parse_args(argv)
    try:
        res = analyse(read_records(a.matrix), read_json(a.pool), a.flips, a.seed)
    except KeyError as e:
        raise InputError(f"matrix row lacks field {e}") from e
    if a.out:
        write_json(a.out, res)
    for name in ("primary", "s1", "s2", "s3"):
        r = res[name]
        print(
            f"{name}: n {r['n']}  mean Delta {paired.fmt(r.get('mean'), 4)}  p {paired.fmt(r.get('p'), 4)}"
            + (f"  p_H2 {res['pH2']:.4g}" if name == "primary" else "")
        )
    print(f"inline recordings by class: {res['inlineRecordingByClass']}")
    return 0


if __name__ == "__main__":
    run_main(main)
