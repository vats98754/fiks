#!/usr/bin/env python3
"""Holm over the confirmatory family and the pre-registered readings (PLAN 3, 3.5, 9.1).

Family: {H1, H2, H3, H4} (m = 4), or {H2, H3, H4} (m = 3) when the F4b N_E rule made H1
descriptive. m is taken from the FrameSpec's neRule.m (--frame-spec), else from h1.json.
Decision values: p_H1 (h1_precision.py), p_H2 (h2_adequacy.py, direction-guarded),
p_H3 and p_H4 = max of the IUT components (h3h4_repair.py, harm direction-guarded).
Only `confirmatory` entries of h3h4.json are read; its per-class rows never enter Holm.

Writes holm.json (--out) and the macro file (--macros, default paper/macros/confirmatory.tex).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from anlib import macros, readings, stats  # noqa: E402
from anlib.io import MACROS_DIR, read_json, require, run_main, write_json, write_text  # noqa: E402

GEN = "paper/scripts/holm.py"
WORDS = {"H1": "HOne", "H2": "HTwo", "H3": "HThree", "H4": "HFour"}


def family_m(h1: dict, frame_spec: dict | None) -> int:
    if frame_spec is not None:
        m = (frame_spec.get("neRule") or {}).get("m")
        require(m in (3, 4), f"FrameSpec.neRule.m must be 3 or 4, got {m}")
        return m
    return 4 if h1.get("entersHolm", True) else 3


def run(h1: dict, h2: dict, h3h4: dict, frame_spec: dict | None = None) -> dict:
    m = family_m(h1, frame_spec)
    conf = h3h4["confirmatory"]
    require("H3" in conf and "H4" in conf, "h3h4.json must hold both H3 and H4")
    pvals = {"H2": h2["pH2"], "H3": conf["H3"]["pH"], "H4": conf["H4"]["pH"]}
    if m == 4:
        pvals["H1"] = h1["pH1"]
    hol = stats.holm(pvals, 0.05)
    out: dict = {"m": m, "alpha": 0.05, "holm": hol, "readings": {}}
    out["readings"]["H1"] = readings.h1({**h1, "entersHolm": m == 4}, hol.get("H1"))
    out["readings"]["H2"] = readings.h2(h2, hol["H2"])
    out["readings"]["H3"] = readings.repair("H3", conf["H3"], hol["H3"])
    out["readings"]["H4"] = readings.repair(
        "H4", conf["H4"], hol["H4"], other={"res": conf["H3"], "holm": hol["H3"]}
    )
    return out


def macro_values(res: dict) -> dict[str, str]:
    mv = {"HolmM": str(res["m"])}
    for h, word in WORDS.items():
        e = res["holm"].get(h)
        if e is None:
            mv[f"{word}Status"] = "descriptive"
            continue
        mv[f"{word}P"] = f"{e['p']:.4g}"
        mv[f"{word}Padj"] = f"{e['adjusted']:.4g}"
        mv[f"{word}Status"] = "rejected" if e["rejected"] else "not rejected"
    for h, word in WORDS.items():
        mv[f"{word}Reading"] = macros.tex_escape(" ".join(r["text"] for r in res["readings"][h]))
    return mv


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--h1", required=True)
    p.add_argument("--h2", required=True)
    p.add_argument("--h3h4", required=True)
    p.add_argument("--frame-spec")
    p.add_argument("--out")
    p.add_argument("--macros", default=str(MACROS_DIR / "confirmatory.tex"))
    a = p.parse_args(argv)
    res = run(
        read_json(a.h1),
        read_json(a.h2),
        read_json(a.h3h4),
        read_json(a.frame_spec) if a.frame_spec else None,
    )
    if a.out:
        write_json(a.out, res)
    write_text(a.macros, macros.render(GEN, macro_values(res)))
    print(f"Holm over m = {res['m']} (FWER 0.05)")
    for h in ("H1", "H2", "H3", "H4"):
        e = res["holm"].get(h)
        head = "descriptive" if e is None else (
            f"p {e['p']:.4g}  adjusted {e['adjusted']:.4g}  {'rejected' if e['rejected'] else 'not rejected'}"
        )
        print(f"{h}: {head}")
        for r in res["readings"][h]:
            print(f"  [{r['code']}] {r['text']}")
    return 0


if __name__ == "__main__":
    run_main(main)
