#!/usr/bin/env python3
"""H3 (FIKS vs L1) and H4 (FIKS vs COMP): harm and non-inferiority components (PLAN 3.3, 3.4).

Input: classified attempts (classify_outcome.py output; one row per attempt with runKey and
outcome) and the pool manifest {drifts: [{id, requestChanging}]}.

Per drift and arm, the rate is the equal-weight mean over models of the per-model mean over
attempts. A (drift, model, attempt-index) cell with an infra_error in any confirmatory arm is
dropped for all arms (PLAN 9.3).

  harm (a):  Y = green_incorrect_pr; d_i = p_comp,i - p_FIKS,i; two-sided sign-flip;
             direction guard: p_a = 1 when mean d_i <= 0.
  NI (b):    Y = correct_pr; d_i = p_FIKS,i - p_comp,i; one-sided shifted sign-flip on
             d_i + 0.10 (or the pre-declared bootstrap-t fallback, --ni-method).
  p_H = max(p_a, p_b) (IUT). Relative correct-PR loss = mean d / mean p_comp.
  Per drift class (request-changing vs other): descriptive rows (means, BCa), printed and
  written under `descriptive`, never passed to holm.py.

--export-eval-stats DIR writes eval_stats.py-format CSVs (config,seed,item,sample,correct)
for the paired cross-check (`eval_stats.py paired <csv> --a <comp> --b FIKS`).
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from anlib import paired  # noqa: E402
from anlib.io import InputError, read_json, read_records, require, run_main, write_json  # noqa: E402

DELTA = 0.10
HARM_MARGIN = 0.05
OUTCOMES = {"correct_pr", "green_incorrect_pr", "red_pr", "no_pr", "infra_error"}
HYPS = {"H3": "L1", "H4": "COMP"}


def runkey(r: dict) -> dict:
    rk = r["runKey"]
    if isinstance(rk, str):
        parts = rk.split("/")
        require(len(parts) == 6, f"bad RunKey {rk}")
        return dict(zip(("experiment", "arm", "model", "domain", "drift", "attempt"), parts))
    return rk


def collect(attempts: list[dict], arms: list[str]) -> tuple[dict, int]:
    """arm -> drift -> model -> attempt -> outcome, with infra cells dropped for all arms."""
    cells: dict = defaultdict(lambda: defaultdict(lambda: defaultdict(dict)))
    for r in attempts:
        rk = runkey(r)
        arm = rk["arm"]
        if arm not in arms:
            continue
        out = r.get("outcome")
        require(out in OUTCOMES, f"{rk}: outcome {out!r} cannot occur in an H3/H4 arm")
        att = str(rk["attempt"])
        require(att not in cells[arm][rk["drift"]][rk["model"]], f"duplicate attempt {rk}")
        cells[arm][rk["drift"]][rk["model"]][att] = out
    infra = set()
    for arm in arms:
        for drift, models in cells[arm].items():
            for model, atts in models.items():
                for att, out in atts.items():
                    if out == "infra_error":
                        infra.add((drift, model, att))
    for arm in arms:
        for drift, model, att in infra:
            if arm in cells and drift in cells[arm] and model in cells[arm][drift]:
                cells[arm][drift][model].pop(att, None)
    return cells, len(infra)


def rate(models: dict, outcome: str) -> float:
    per_model = [sum(o == outcome for o in atts.values()) / len(atts) for atts in models.values() if atts]
    require(per_model, "a drift has no gradable attempts in some arm")
    return sum(per_model) / len(per_model)


def comparison(cells: dict, comp: str, fiks: str, pool: dict, flips: int, seed: int, ni_method: str) -> dict:
    meta = {d["id"]: d for d in pool["drifts"]}
    drifts = sorted(set(cells[fiks]) & set(cells[comp]))
    only = sorted(set(cells[fiks]) ^ set(cells[comp]))
    require(not only, f"drifts present in only one of {fiks}/{comp}: {only}")
    for d in drifts:
        require(d in meta, f"drift {d} is not in the pool manifest")
        require(
            set(cells[fiks][d]) == set(cells[comp][d]), f"{d}: {fiks} and {comp} have different model sets"
        )
    harm_d, ni_d, p_comp_correct, rates = {}, {}, {}, {}
    for d in drifts:
        pf_h, pc_h = rate(cells[fiks][d], "green_incorrect_pr"), rate(cells[comp][d], "green_incorrect_pr")
        pf_c, pc_c = rate(cells[fiks][d], "correct_pr"), rate(cells[comp][d], "correct_pr")
        harm_d[d] = pc_h - pf_h
        ni_d[d] = pf_c - pc_c
        p_comp_correct[d] = pc_c
        rates[d] = {"fiksHarm": pf_h, "compHarm": pc_h, "fiksCorrect": pf_c, "compCorrect": pc_c}
    harm = paired.superiority(harm_d, flips, seed)
    harm["pDecision"] = paired.guarded(harm)
    ni = paired.noninferiority(ni_d, DELTA, flips, seed, method=ni_method)
    mean_comp = sum(p_comp_correct.values()) / len(p_comp_correct) if p_comp_correct else None
    rel = None if not mean_comp or ni["mean"] is None else ni["mean"] / mean_comp

    def by_class(d: dict, rc: bool) -> dict:
        return paired.descriptive({k: v for k, v in d.items() if bool(meta[k].get("requestChanging")) == rc}, seed)

    return {
        "comparator": comp,
        "n": len(drifts),
        "harm": harm,
        "ni": ni,
        "pA": harm["pDecision"],
        "pB": ni["p"],
        "pH": max(harm["pDecision"], ni["p"]),
        "meanCompCorrect": mean_comp,
        "relativeCorrectLoss": rel,
        "rates": rates,
        "perClass": {
            "request-changing": {"harm": by_class(harm_d, True), "ni": by_class(ni_d, True)},
            "other": {"harm": by_class(harm_d, False), "ni": by_class(ni_d, False)},
        },
    }


def export_eval_stats(cells: dict, fiks: str, comp: str, outdir: Path) -> list[Path]:
    """CSV per endpoint in eval_stats.py long format; item = drift, seed = model."""
    outdir.mkdir(parents=True, exist_ok=True)
    paths = []
    for name, outcome in (("harm", "green_incorrect_pr"), ("correct", "correct_pr")):
        p = outdir / f"{comp}-{name}.csv"
        with open(p, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["config", "seed", "item", "sample", "correct"])
            for arm in (comp, fiks):
                for drift in sorted(cells[arm]):
                    for model in sorted(cells[arm][drift]):
                        for att, out in sorted(cells[arm][drift][model].items()):
                            w.writerow([arm, model, drift, att, 1 if out == outcome else 0])
        paths.append(p)
    return paths


def analyse(
    attempts: list[dict],
    pool: dict,
    fiks: str = "FIKS",
    l1: str = "L1",
    comp: str = "COMP",
    flips: int = 200_000,
    seed: int = paired.SEED,
    ni_method: str = "sign-flip",
) -> tuple[dict, dict]:
    arms = [fiks, l1, comp]
    cells, dropped = collect(attempts, arms)
    out: dict = {"droppedInfraCells": dropped, "niMethod": ni_method}
    for hyp, comp_arm in (("H3", l1), ("H4", comp)):
        if cells.get(comp_arm):
            out[hyp] = comparison(cells, comp_arm, fiks, pool, flips, seed, ni_method)
    descriptive = {hyp: out[hyp].pop("perClass") for hyp in ("H3", "H4") if hyp in out}
    return {"confirmatory": out, "descriptive": {"perClass": descriptive}}, cells


def ci(r: dict) -> str:
    b = r.get("bca975")
    return "NA" if not b else f"[{paired.fmt(b[0])}, {paired.fmt(b[1])}]"


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--attempts", required=True, help="classified attempts (classify_outcome.py)")
    p.add_argument("--pool", required=True)
    p.add_argument("--fiks", default="FIKS")
    p.add_argument("--l1", default="L1")
    p.add_argument("--comp", default="COMP")
    p.add_argument("--flips", type=int, default=200_000)
    p.add_argument("--seed", type=int, default=paired.SEED)
    p.add_argument("--ni-method", choices=["sign-flip", "bootstrap-t"], default="sign-flip")
    p.add_argument("--export-eval-stats", metavar="DIR")
    p.add_argument("--out")
    a = p.parse_args(argv)
    try:
        res, cells = analyse(
            read_records(a.attempts), read_json(a.pool), a.fiks, a.l1, a.comp, a.flips, a.seed, a.ni_method
        )
    except KeyError as e:
        raise InputError(f"attempt row lacks field {e}") from e
    if a.out:
        write_json(a.out, res)
    if a.export_eval_stats:
        for hyp, comp_arm in (("H3", a.l1), ("H4", a.comp)):
            if hyp in res["confirmatory"]:
                export_eval_stats(cells, a.fiks, comp_arm, Path(a.export_eval_stats))
    for hyp, r in res["confirmatory"].items():
        if not isinstance(r, dict):
            continue
        h, n = r["harm"], r["ni"]
        print(
            f"{hyp} (FIKS vs {r['comparator']}, n {r['n']}): harm mean d {paired.fmt(h['mean'])} "
            f"p {paired.fmt(h['p'], 4)} p_a {paired.fmt(r['pA'], 4)} | NI mean d {paired.fmt(n['mean'])} "
            f"p_b {paired.fmt(r['pB'], 4)} | p_{hyp} {paired.fmt(r['pH'], 4)} | relative correct-PR loss "
            f"{paired.fmt(r['relativeCorrectLoss'])}"
        )
    for hyp, classes in res["descriptive"]["perClass"].items():
        for cls, comps in classes.items():
            print(
                f"{hyp} per-class (descriptive, not in Holm) {cls}: harm n {comps['harm']['n']} mean "
                f"{paired.fmt(comps['harm'].get('mean'))} BCa97.5 {ci(comps['harm'])} | NI mean "
                f"{paired.fmt(comps['ni'].get('mean'))} BCa97.5 {ci(comps['ni'])}"
            )
    return 0


if __name__ == "__main__":
    run_main(main)
