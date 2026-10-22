#!/usr/bin/env python3
"""E8: COMP-plain vs FIKS, Opus (PLAN 4 E8). COMP-plain = repo CI without the contract suite,
stored traces or IV. H4 endpoints (harm, correct) as paired drift-level differences with raw
sign-flip p and 95% BCa, on the model given by --model. Refuses to run without the CP2 lock.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from anlib import explore  # noqa: E402
from anlib.io import require, run_main  # noqa: E402


def analyse(rows: list[dict], model: str, flips: int, seed: int) -> dict:
    harm = explore.per_drift_rates(rows, lambda r: r["outcome"] == "green_incorrect_pr", {model})
    corr = explore.per_drift_rates(rows, lambda r: r["outcome"] == "correct_pr", {model})
    require("COMP-plain" in harm and "FIKS" in harm, f"need COMP-plain and FIKS attempts on {model}")
    return {
        "model": model,
        "harm(COMP-plain - FIKS)": explore.paired_exploratory(harm["COMP-plain"], harm["FIKS"], flips, seed),
        "correct(FIKS - COMP-plain)": explore.paired_exploratory(corr["FIKS"], corr["COMP-plain"], flips, seed),
    }


def main(argv: list[str]) -> int:
    p = explore.parser(__doc__)
    p.add_argument("--attempts", required=True)
    p.add_argument("--model", default="claude-opus-5-5")
    a = explore.start(p, argv)
    res = analyse(explore.load(a.attempts), a.model, a.flips, a.seed)
    h = res["harm(COMP-plain - FIKS)"]
    print(f"COMP-plain - FIKS harm: mean {h.get('mean')} raw p {h.get('rawP')} (n {h.get('n')})")
    return explore.finish(a, res)


if __name__ == "__main__":
    run_main(main)
