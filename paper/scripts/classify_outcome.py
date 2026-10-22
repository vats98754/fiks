#!/usr/bin/env python3
"""Attempt outcome from AttemptRecord + GradeRecord (PLAN 3.0 "Attempt", 9.1).

Outcomes (mutually exclusive):
  correct_pr          PR exposed AND final local CI green AND final head held-out-correct
  green_incorrect_pr  PR exposed AND final local CI green AND final head held-out-incorrect
  red_pr              PR exposed AND final local CI red (held-out correctness is graded and
                      reported in E1/E9, never used in H3/H4)
  no_pr               no PR exposed (e.g. an L1 head that failed pre-PR issue validation)
  infra_error         PLAN 9.3; set by the harness in the AttemptRecord's own `outcome` field
  contract_update_proposed  FIKS+CU only (E4); set by the harness in `outcome`, and no PR

The frozen AttemptRecord (packages/interfaces/src/run.ts, PLAN Appendix) has no separate flags for
the two harness-decided outcomes: the harness pre-fills `outcome` with one of them, and this script
keeps that value (an infra error is never re-graded as a model outcome, PLAN 9.3). Any other
pre-filled `outcome` must be null or equal to the derived outcome; anything else is an input error.

"Green" includes issue validation where the arm has it: for post-PR IV (COMP) the final CI is
green only if `issueValidation == 'pass'`. A pre-PR IV failure means the PR was never exposed.

Grades are joined by `GradeRecord.patchId` == the attempt's RunKey string
(`exp/arm/model/domain/drift/attempt`) or == its `headSha`.

Usage: classify_outcome.py --attempts attempts.jsonl --grades grades.jsonl --out classified.jsonl
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from anlib.io import InputError, read_records, require, run_main  # noqa: E402

OUTCOMES = (
    "correct_pr",
    "green_incorrect_pr",
    "red_pr",
    "no_pr",
    "infra_error",
    "contract_update_proposed",
)
RUNKEY_FIELDS = ("experiment", "arm", "model", "domain", "drift", "attempt")


def runkey_str(rk: dict | str) -> str:
    if isinstance(rk, str):
        return rk
    require(all(f in rk for f in RUNKEY_FIELDS), f"RunKey missing fields: {rk}")
    return "/".join(str(rk[f]) for f in RUNKEY_FIELDS)


def final_ci_green(att: dict) -> bool:
    ci = att.get("ciFinal")
    require(ci in ("green", "red", "none"), f"{runkey_str(att['runKey'])}: ciFinal must be green|red|none")
    placement = att.get("ivPlacement", "none")
    iv = att.get("issueValidation", "n/a")
    require(placement in ("pre", "post", "none"), f"{runkey_str(att['runKey'])}: bad ivPlacement {placement}")
    if ci == "none":
        raise InputError(f"{runkey_str(att['runKey'])}: PR exposed but final CI never ran (ciFinal = none)")
    if placement == "none":
        return ci == "green"
    require(
        iv in ("pass", "fail"),
        f"{runkey_str(att['runKey'])}: ivPlacement {placement} needs issueValidation pass|fail, got {iv}",
    )
    if placement == "pre":
        # Pre-PR IV gates exposure; an exposed PR with a failed pre-PR IV is inconsistent.
        require(iv == "pass", f"{runkey_str(att['runKey'])}: PR exposed although pre-PR IV failed")
    return ci == "green" and iv == "pass"


# Outcomes decided by the harness, not derivable from CI and grades (PLAN 3.0, 9.3, E4).
HARNESS_OUTCOMES = ("infra_error", "contract_update_proposed")


def classify(att: dict, grade: dict | None) -> str:
    pre = att.get("outcome")
    rk = runkey_str(att["runKey"])
    require(pre is None or pre in OUTCOMES, f"{rk}: unknown pre-filled outcome {pre!r}")
    if pre == "infra_error":
        return pre
    if pre == "contract_update_proposed":
        require(not att.get("prExposed"), f"{rk}: contract_update_proposed but a PR was exposed")
        return pre
    derived = derive(att, grade)
    require(pre is None or pre == derived, f"{rk}: pre-filled outcome {pre} contradicts derived {derived}")
    return derived


def derive(att: dict, grade: dict | None) -> str:
    if not att.get("prExposed"):
        return "no_pr"
    if not final_ci_green(att):
        return "red_pr"
    require(grade is not None, f"{runkey_str(att['runKey'])}: green exposed PR has no GradeRecord")
    require(isinstance(grade.get("correct"), bool), f"grade {grade.get('patchId')}: correct must be boolean")
    return "correct_pr" if grade["correct"] else "green_incorrect_pr"


def index_grades(grades: list[dict]) -> dict[str, dict]:
    idx: dict[str, dict] = {}
    for g in grades:
        pid = g.get("patchId")
        require(isinstance(pid, str), f"GradeRecord without patchId: {g}")
        require(pid not in idx, f"duplicate GradeRecord for {pid}")
        idx[pid] = g
    return idx


def classify_all(attempts: list[dict], grades: list[dict]) -> list[dict]:
    idx = index_grades(grades)
    out = []
    for att in attempts:
        rk = runkey_str(att["runKey"])
        grade = idx.get(rk) or (idx.get(att["headSha"]) if att.get("headSha") else None)
        row = dict(att)
        row["outcome"] = classify(att, grade)
        row["heldOutCorrect"] = None if grade is None else grade.get("correct")
        out.append(row)
    return out


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--attempts", required=True)
    p.add_argument("--grades", required=True)
    p.add_argument("--out", required=True)
    a = p.parse_args(argv)
    rows = classify_all(read_records(a.attempts), read_records(a.grades))
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, sort_keys=True) + "\n")
    counts = Counter(r["outcome"] for r in rows)
    print(" ".join(f"{k}={counts.get(k, 0)}" for k in OUTCOMES))
    return 0


if __name__ == "__main__":
    run_main(main)
