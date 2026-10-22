#!/usr/bin/env python3
"""D1-D12: descriptive sets (PLAN 4; counts and Wilson intervals, no tests).

Reads run outputs under --raw-dir (default paper/results/raw); each set whose input is absent is
reported as {"status": "absent"}. Input files (one JSON object per line unless noted):
  D1  d1/replay-*.jsonl  DetectorVerdictRows of repeated offline replays (>= 2 files; identical
                         verdicts expected); d1/fgate.jsonl {drift, run, verdict}
  D2  d2/silence.jsonl   {drift, http2xx, isError, oasdiffFindings, typecheckUnchanged}
  D3  d3/repro-validity.jsonl {drift, baseFails, baseRuns, refAPasses, refARuns, refBPasses, refBRuns}
  D4  d4/funnel.jsonl    {drift, authored, valid, kept, detected, f, repair, gates, pr, heldOutCorrect}
  D5  d5/attrition.jsonl {run, arm, attempts, infraErrors, droppedCells};
      d5/ci-agreement.jsonl {head, local, actions}
  D6  d6/ratings.jsonl   {drift, rating (1-5), c3Category, rClass} (LLM rater, labelled as such)
  D7  d7/legacy-bench.json (the 2026-10-20 bench summary; appendix only, labelled underpowered)
  D8  d8/detection-by-calls.jsonl {drift, callsEnumerated, detected}
  D9  d9/contract-clean.jsonl {head, contractClean}
  D10 d10/showcase.jsonl {domain, drift, pr, ciGreen} (run R11 only; absent => D10 cut)
  D11, D12  cp2/h1.json (h1_precision.py output)
D11 and D12 are H1 companions, so this script refuses to run without the CP2 lock.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from anlib import stats  # noqa: E402
from anlib.io import RAW_DIR, read_json, read_jsonl, run_main, write_json  # noqa: E402
from anlib.lock import add_lock_arg, require_lock  # noqa: E402

FUNNEL = ("authored", "valid", "kept", "detected", "f", "repair", "gates", "pr", "heldOutCorrect")


def w(k: int, n: int) -> dict:
    return {"k": k, "n": n, "rate": k / n if n else None, "wilson95": stats.wilson(k, n, 0.95)}


def absent() -> dict:
    return {"status": "absent"}


def d1(raw: Path) -> dict:
    files = sorted((raw / "d1").glob("replay-*.jsonl")) if (raw / "d1").is_dir() else []
    if len(files) < 2:
        return absent()

    def key(rows):
        return sorted(
            (r.get("callId"), r.get("detector"), r.get("property"), r.get("at"), r.get("verdict")) for r in rows
        )

    ref = key(read_jsonl(files[0]))
    same = sum(1 for f in files[1:] if key(read_jsonl(f)) == ref)
    out = {"replays": len(files), "identicalToFirst": same + 1, "allIdentical": same == len(files) - 1}
    fg = raw / "d1" / "fgate.jsonl"
    if fg.is_file():
        per: dict = {}
        for r in read_jsonl(fg):
            per.setdefault(r["drift"], set()).add(r["verdict"])
        out["fGateStableDrifts"] = w(sum(1 for v in per.values() if len(v) == 1), len(per))
    return out


def rows_or_none(path: Path) -> list[dict] | None:
    return read_jsonl(path) if path.is_file() else None


def d2(rows):
    silent = [
        r for r in rows if r["http2xx"] and not r["isError"] and r["oasdiffFindings"] == 0 and r["typecheckUnchanged"]
    ]
    return {"silent": w(len(silent), len(rows))}


def d3(rows):
    full = [
        r
        for r in rows
        if r["baseFails"] == r["baseRuns"] and r["refAPasses"] == r["refARuns"] and r["refBPasses"] == r["refBRuns"]
    ]
    return {"allRunsValid": w(len(full), len(rows))}


def d4(rows):
    return {"funnel": {s: sum(bool(r.get(s)) for r in rows) for s in FUNNEL}}


def d5(raw: Path):
    att = rows_or_none(raw / "d5" / "attrition.jsonl")
    ci = rows_or_none(raw / "d5" / "ci-agreement.jsonl")
    if att is None and ci is None:
        return absent()
    out: dict = {}
    if att is not None:
        out["infra"] = {
            f"{r['run']}/{r['arm']}": {**w(r["infraErrors"], r["attempts"]), "droppedCells": r.get("droppedCells", 0)}
            for r in att
        }
    if ci is not None:
        out["ciAgreement"] = w(sum(r["local"] == r["actions"] for r in ci), len(ci))
    return out


def d6(rows):
    ratings = [int(r["rating"]) for r in rows]
    return {
        "rater": "LLM rater (Sonnet); an LLM rating, not a human one",
        "distribution": dict(sorted(Counter(ratings).items())),
        "mean": sum(ratings) / len(ratings) if ratings else None,
        "c3Coverage": dict(sorted(Counter(str(r.get("c3Category")) for r in rows).items())),
        "rClassCoverage": dict(sorted(Counter(str(r.get("rClass")) for r in rows).items())),
    }


def d8(rows):
    by: dict = {}
    for r in rows:
        by.setdefault(int(r["callsEnumerated"]), []).append(bool(r["detected"]))
    return {"byCalls": {str(k): w(sum(v), len(v)) for k, v in sorted(by.items())}}


def analyse(raw: Path) -> dict:
    out: dict = {"D1": d1(raw)}
    for name, path, fn in (
        ("D2", "d2/silence.jsonl", d2),
        ("D3", "d3/repro-validity.jsonl", d3),
        ("D4", "d4/funnel.jsonl", d4),
        ("D6", "d6/ratings.jsonl", d6),
        ("D8", "d8/detection-by-calls.jsonl", d8),
    ):
        rows = rows_or_none(raw / path)
        out[name] = absent() if rows is None else fn(rows)
    out["D5"] = d5(raw)
    leg = raw / "d7" / "legacy-bench.json"
    out["D7"] = (
        {"label": "legacy 2026-10-20 bench, appendix only, underpowered", "summary": read_json(leg)}
        if leg.is_file()
        else absent()
    )
    cc = rows_or_none(raw / "d9" / "contract-clean.jsonl")
    out["D9"] = absent() if cc is None else {"contractClean": w(sum(bool(r["contractClean"]) for r in cc), len(cc))}
    sc = rows_or_none(raw / "d10" / "showcase.jsonl")
    out["D10"] = {"status": "cut (R11 did not run)"} if sc is None else {"showcase": sc}
    h1 = raw / "cp2" / "h1.json"
    if h1.is_file():
        h = read_json(h1)
        out["D11"] = h.get("D11", absent())
        out["D12"] = h.get("D12", absent())
    else:
        out["D11"] = out["D12"] = absent()
    return out


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_lock_arg(p)
    p.add_argument("--raw-dir", default=str(RAW_DIR))
    p.add_argument("--out")
    a = p.parse_args(argv)
    require_lock(a.lock)
    res = analyse(Path(a.raw_dir))
    if a.out:
        write_json(a.out, res)
    for k in sorted(res, key=lambda s: int(s[1:])):
        v = res[k]
        print(f"{k}: {v.get('status', 'computed')}")
    return 0


if __name__ == "__main__":
    run_main(main)
