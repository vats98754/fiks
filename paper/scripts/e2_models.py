#!/usr/bin/env python3
"""E2: per-model effects, arm x model (PLAN 4).

Attempt-level logistic GLMM y ~ arm * model + (1 | drift), fitted by statsmodels'
BinomialBayesMixedGLM (variational Bayes; the drift intercept is the variance component), for
y = green_incorrect_pr and y = correct_pr over the confirmatory arms. Reports posterior means and
SDs of the fixed effects and the drift SD. Exploratory. Refuses to run without the CP2 lock.
"""

from __future__ import annotations

import math
import sys
import warnings
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from anlib import explore  # noqa: E402
from anlib.io import require, run_main  # noqa: E402

ARMS = ("FIKS", "L1", "COMP")


def fit(df: pd.DataFrame, outcome: str) -> dict:
    from statsmodels.genmod.bayes_mixed_glm import BinomialBayesMixedGLM

    d = df.assign(y=(df["outcome"] == outcome).astype(float))
    if d["y"].nunique() < 2:
        return {"skipped": f"no variation in {outcome}"}
    model = BinomialBayesMixedGLM.from_formula(
        "y ~ C(arm, Treatment('FIKS')) * C(model)", {"drift": "0 + C(drift)"}, d
    )
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        r = model.fit_vb()
    names = list(model.exog_names)
    return {
        "fixed": {n: {"mean": float(m), "sd": float(s)} for n, m, s in zip(names, r.fe_mean, r.fe_sd)},
        "driftSd": math.exp(float(r.vcp_mean[0])),  # vcp_mean is the log SD of the drift intercept
        "nAttempts": int(len(d)),
    }


def analyse(rows: list[dict]) -> dict:
    recs = []
    for r in rows:
        rk = explore.runkey(r)
        if rk["arm"] in ARMS and r.get("outcome") != "infra_error":
            recs.append({"arm": rk["arm"], "model": rk["model"], "drift": rk["drift"], "outcome": r["outcome"]})
    require(recs, "no attempts of the confirmatory arms")
    df = pd.DataFrame(recs)
    return {"harm": fit(df, "green_incorrect_pr"), "correct": fit(df, "correct_pr")}


def main(argv: list[str]) -> int:
    p = explore.parser(__doc__)
    p.add_argument("--attempts", required=True)
    a = explore.start(p, argv)
    res = analyse(explore.load(a.attempts))
    for k, v in res.items():
        print(f"{k}: {len(v.get('fixed', {}))} fixed effects" + (f" ({v['skipped']})" if "skipped" in v else ""))
    return explore.finish(a, res)


if __name__ == "__main__":
    run_main(main)
