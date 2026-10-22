"""h3h4_repair.py + holm.py: direction guard, opposite-direction reading, per-class rows,
and the eval_stats.py paired cross-check (PLAN 3.3-3.5)."""

from __future__ import annotations

import json
import re
import subprocess
import sys

import h3h4_repair
import holm
import power
import pytest
from conftest import FIXTURES, run

H34 = FIXTURES / "h3h4"
FORBIDDEN = "lowers green-incorrect PRs"


def attempts(name):
    return [json.loads(line) for line in (H34 / name).read_text().splitlines() if line.strip()]


def pool():
    return json.loads((H34 / "pool.json").read_text())


H1_OK = {"pH1": 0.001, "entersHolm": True, "overall": {"cp95": [0.001, 0.01]}, "cp975Lower": 0.001,
         "censusOk": True, "batchBootstrapUpper9875": 0.012}
H2_OK = {"pH2": 0.002, "primary": {"n": 61, "mean": 0.1, "mde": 0.1, "bca975": [0.05, 0.15]}}


def test_fiks_more_harmful_is_never_a_rejection(tmp_path):
    res, _ = h3h4_repair.analyse(attempts("attempts-fiks-more-harmful.jsonl"), pool(), flips=20_000)
    h3 = res["confirmatory"]["H3"]
    assert h3["harm"]["mean"] < 0
    assert h3["harm"]["p"] < 0.001  # significant, in the wrong direction
    assert h3["pA"] == 1.0  # direction guard
    assert h3["ni"]["p"] < 0.0125  # NI holds
    assert h3["pH"] == 1.0
    (tmp_path / "h1.json").write_text(json.dumps(H1_OK))
    (tmp_path / "h2.json").write_text(json.dumps(H2_OK))
    (tmp_path / "h3h4.json").write_text(json.dumps(res))
    out = run(
        "holm.py", "--h1", tmp_path / "h1.json", "--h2", tmp_path / "h2.json", "--h3h4", tmp_path / "h3h4.json",
        "--out", tmp_path / "holm.json", "--macros", tmp_path / "c.tex",
    )
    assert out.returncode == 0, out.stderr
    hol = json.loads((tmp_path / "holm.json").read_text())
    assert hol["m"] == 4
    assert hol["holm"]["H3"]["rejected"] is False
    codes = [r["code"] for r in hol["readings"]["H3"]]
    assert "opposite_direction_harm" in codes and "rejected" not in codes
    text = " ".join(r["text"] for r in hol["readings"]["H3"])
    assert FORBIDDEN not in text and "FIKS exposes more green-incorrect PRs than L1" in text
    assert FORBIDDEN not in (tmp_path / "c.tex").read_text()
    assert hol["holm"]["H1"]["rejected"] and hol["holm"]["H2"]["rejected"]


def test_fiks_safer_is_rejected_with_the_h3_reading():
    res, _ = h3h4_repair.analyse(attempts("attempts-fiks-safer.jsonl"), pool(), flips=20_000)
    hol = holm.run(H1_OK, H2_OK, res)
    assert res["confirmatory"]["H3"]["harm"]["mean"] > 0
    assert hol["holm"]["H3"]["rejected"] and hol["holm"]["H4"]["rejected"]
    assert FORBIDDEN in hol["readings"]["H3"][0]["text"]


def test_per_class_rows_are_printed_and_never_reach_holm(tmp_path):
    out = run("h3h4_repair.py", "--attempts", H34 / "attempts-fiks-more-harmful.jsonl", "--pool", H34 / "pool.json",
              "--flips", "2000", "--out", tmp_path / "h.json")
    assert out.returncode == 0, out.stderr
    assert re.search(r"H3 per-class \(descriptive, not in Holm\) request-changing: harm n 5", out.stdout)
    assert re.search(r"H3 per-class \(descriptive, not in Holm\) other: harm n 19", out.stdout)
    res = json.loads((tmp_path / "h.json").read_text())
    assert "perClass" not in res["confirmatory"]["H3"]
    for cls in res["descriptive"]["perClass"]["H3"].values():
        assert "p" not in cls["harm"] and "p" not in cls["ni"]
    # holm sees exactly the family's decision values, no per-class entry.
    hol = holm.run(H1_OK, H2_OK, res)
    assert set(hol["holm"]) == {"H1", "H2", "H3", "H4"}


def test_paired_differences_match_eval_stats(tmp_path):
    rows = attempts("attempts-fiks-safer.jsonl")
    res, cells = h3h4_repair.analyse(rows, pool(), flips=2000)
    paths = h3h4_repair.export_eval_stats(cells, "FIKS", "L1", tmp_path)
    harm_csv = [p for p in paths if p.name == "L1-harm.csv"][0]
    proc = subprocess.run(
        [sys.executable, str(power.eval_stats_path()), "paired", str(harm_csv), "--a", "L1", "--b", "FIKS"],
        capture_output=True, text=True, check=True,
    )
    m = re.search(r"mean diff = ([+-][0-9.]+)", proc.stdout)
    sd = re.search(r"sd of per-item differences = ([0-9.]+)", proc.stdout)
    shared = re.search(r"shared items=(\d+)", proc.stdout)
    h = res["confirmatory"]["H3"]["harm"]
    assert int(shared.group(1)) == h["n"] == 24
    assert float(m.group(1)) == pytest.approx(h["mean"], abs=5e-5)
    assert float(sd.group(1)) == pytest.approx(h["sd"], abs=5e-5)
    corr_csv = [p for p in paths if p.name == "L1-correct.csv"][0]
    proc = subprocess.run(
        [sys.executable, str(power.eval_stats_path()), "paired", str(corr_csv), "--a", "FIKS", "--b", "L1"],
        capture_output=True, text=True, check=True,
    )
    m = re.search(r"mean diff = ([+-][0-9.]+)", proc.stdout)
    assert float(m.group(1)) == pytest.approx(res["confirmatory"]["H3"]["ni"]["mean"], abs=5e-5)


def test_infra_cells_dropped_for_all_arms():
    rows = attempts("attempts-fiks-safer.jsonl")
    for r in rows:
        rk = r["runKey"]
        if rk["drift"] == "T01" and rk["model"] == "claude-opus-5-5" and rk["attempt"] == 0 and rk["arm"] == "L1":
            r["outcome"] = "infra_error"
    res, cells = h3h4_repair.analyse(rows, pool(), flips=500)
    assert res["confirmatory"]["droppedInfraCells"] == 1
    for arm in ("FIKS", "L1", "COMP"):
        assert "0" not in cells[arm]["T01"]["claude-opus-5-5"]
        assert len(cells[arm]["T01"]["claude-opus-5-5"]) == 3


def test_m3_family_excludes_h1():
    res, _ = h3h4_repair.analyse(attempts("attempts-fiks-safer.jsonl"), pool(), flips=500)
    hol = holm.run(dict(H1_OK, entersHolm=False), H2_OK, res, {"neRule": {"m": 3}})
    assert hol["m"] == 3 and "H1" not in hol["holm"]
    assert hol["readings"]["H1"][0]["code"] == "descriptive"
