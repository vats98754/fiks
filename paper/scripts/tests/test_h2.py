"""h2_adequacy.py: BA, the fiks test as it behaves, T = empty, s1-s3 (PLAN 3.2)."""

from __future__ import annotations

import json

import h2_adequacy
import pytest
from anlib.io import InputError
from conftest import FIXTURES, run

H2 = FIXTURES / "h2"


def data():
    rows = [json.loads(line) for line in (H2 / "matrix.jsonl").read_text().splitlines() if line.strip()]
    return rows, json.loads((H2 / "pool.json").read_text())


def res():
    rows, pool = data()
    return h2_adequacy.analyse(rows, pool, flips=2000)


def test_fiks_test_used_as_it_behaves_when_f_gate_failed():
    r = res()
    d = r["drifts"]["H-a"]
    assert d["fiksSet"] == "fiks"
    # fiks accepts c1-c4 and i1, i2 of 4 incorrect: FAR 0.5, FRR 0, BA 0.75 (not dropped, not replaced).
    assert d["fiks"] == {"FAR": 0.5, "FRR": 0.0, "BA": 0.75}
    assert "H-a" in r["primary"]["perDrift"]


def test_t_empty_when_no_fiks_test_emitted():
    r = res()
    d = r["drifts"]["H-b"]
    assert d["fiksSet"] == "empty"
    # empty set accepts c1-c4 and i1-i3: FAR 0.75, FRR 0 -> BA 0.625
    assert d["fiks"]["BA"] == pytest.approx(0.625)


def test_s3_drops_exactly_request_changing_drifts():
    r = res()
    _, pool = data()
    rc = {d["id"] for d in pool["drifts"] if d["requestChanging"]}
    prim = set(r["primary"]["perDrift"])
    assert set(r["s3"]["perDrift"]) == prim - rc
    assert rc & prim  # the fixture has request-changing drifts in the unit


def test_unit_excludes_drifts_with_few_patches_and_s2_uses_f_valid_tests():
    r = res()
    assert r["excludedFewPatches"] == ["H-f"]
    assert r["primary"]["n"] == 5
    # s2 uses only session A's final test (fOnBase = fail)
    d = r["drifts"]["H-c"]
    assert d["deltaS2"] == pytest.approx(d["fiks"]["BA"] - d["agentFinal"]["A"]["BA"])
    assert d["deltaS1"] == pytest.approx(
        d["fiks"]["BA"] - (d["agentFirst"]["A"]["BA"] + d["agentFirst"]["B"]["BA"]) / 2
    )


def test_ba_values_and_direction_guard():
    r = res()
    d = r["drifts"]["H-c"]
    assert d["fiks"]["BA"] == 1.0
    assert d["BAagent"] == pytest.approx((0.75 + 0.75) / 2)
    assert r["pH2"] == r["primary"]["p"]  # mean Delta > 0
    rows, pool = data()
    flipped = [dict(x, accepted=(not x["accepted"]) if x["testSet"] == "fiks" else x["accepted"]) for x in rows]
    r2 = h2_adequacy.analyse(flipped, pool, flips=2000)
    assert r2["primary"]["mean"] <= 0 and r2["pH2"] == 1.0


def test_inline_recordings_counted_per_class():
    assert res()["inlineRecordingByClass"] == {"other": 0, "request-changing": 1}


def test_missing_rows_and_label_conflicts_are_errors():
    rows, pool = data()
    with pytest.raises(InputError, match="lacks rows"):
        h2_adequacy.analyse([x for x in rows if not (x["testSet"] == "fiks" and x["patchId"] == "H-a/c1")], pool, 200)
    pool2 = json.loads(json.dumps(pool))
    pool2["drifts"][0]["fiksTestEmitted"] = False
    with pytest.raises(InputError, match="fiks rows present"):
        h2_adequacy.analyse(rows, pool2, 200)


def test_cli(tmp_path):
    out = run("h2_adequacy.py", "--matrix", str(H2 / "matrix.jsonl"), "--pool", str(H2 / "pool.json"), "--flips", "1000", "--out", str(tmp_path / "h2.json"))
    assert out.returncode == 0, out.stderr
    assert "s3: n 3" in out.stdout
