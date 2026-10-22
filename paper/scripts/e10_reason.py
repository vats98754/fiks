#!/usr/bin/env python3
"""E10: wrong reason and agent-repro validity (PLAN 4 E10).

Inputs
  --repro-tests  REPRO-AGENT tests (ReproTestRecord + checks): {runKey, round, isFirst, isFinal,
                 fOnBase, plainFP (bool: fails on base and passes on ref A, plain F->P
                 [mundler2024swtbench]), statedReason (bool: fails for the reported property)}
  --sessions     optional {session, fRounds, fSuccess (bool)} per REPRO-AGENT session
  --pgate        optional P-gate rejections inside FIKS: {attempt, agentBelievedFixed (bool),
                 pGateRejected (bool)}

Counts: agent tests passing plain F->P but failing the stated-reason check; F-success rate and F
rounds used per session; P-gate rejections of candidates the agent believed fixed. The H2
sensitivity rows s1 and s2 are in h2_adequacy.py. Wilson on every rate.
Refuses to run without the CP2 lock.
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from anlib import explore  # noqa: E402
from anlib.io import run_main  # noqa: E402


def analyse(tests: list[dict], sessions: list[dict] | None, pgate: list[dict] | None) -> dict:
    res: dict = {}
    for label, sel in (("final", lambda t: t.get("isFinal")), ("first", lambda t: t.get("isFirst"))):
        ts = [t for t in tests if sel(t)]
        fp = [t for t in ts if t.get("plainFP")]
        res[label] = {
            "plainFP": explore.wilson_row(len(fp), len(ts)),
            "plainFPwrongReason": explore.wilson_row(sum(1 for t in fp if not t.get("statedReason")), len(fp)),
            "fOnBase": dict(sorted(Counter(str(t.get("fOnBase")) for t in ts).items())),
        }
    if sessions:
        res["fSuccess"] = explore.wilson_row(sum(bool(s["fSuccess"]) for s in sessions), len(sessions))
        res["fRoundsUsed"] = dict(sorted(Counter(int(s["fRounds"]) for s in sessions).items()))
    if pgate:
        believed = [g for g in pgate if g.get("agentBelievedFixed")]
        res["pGateRejectedBelievedFixed"] = explore.wilson_row(sum(bool(g["pGateRejected"]) for g in believed), len(believed))
    return res


def main(argv: list[str]) -> int:
    p = explore.parser(__doc__)
    p.add_argument("--repro-tests", required=True)
    p.add_argument("--sessions")
    p.add_argument("--pgate")
    a = explore.start(p, argv)
    res = analyse(
        explore.load(a.repro_tests),
        explore.load(a.sessions) if a.sessions else None,
        explore.load(a.pgate) if a.pgate else None,
    )
    w = res["final"]["plainFPwrongReason"]
    print(f"final agent tests passing plain F->P but failing the stated reason: {w['k']}/{w['n']}")
    return explore.finish(a, res)


if __name__ == "__main__":
    run_main(main)
