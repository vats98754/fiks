"""h1_precision.py: entity test, per-element attribution, census condition (PLAN 3.1)."""

from __future__ import annotations

import json

import h1_precision
import pytest
from anlib.io import InputError
from conftest import FIXTURES, run, run_subprocess, write_jsonl

H1 = FIXTURES / "h1"


def load(name):
    return [json.loads(line) for line in (H1 / name).read_text().splitlines() if line.strip()]


def spec():
    return json.loads((H1 / "frame-spec-h1.json").read_text())


def test_one_entity_three_properties_counts_once():
    r = h1_precision.analyse(spec(), load("rows-multi.jsonl"), boot=500)
    # ext-a fires on search, get and order inputs (three properties): one entity, Z = 1.
    assert r["Z"]["ext-a"] == 1
    assert r["X"] == 2  # ext-a and ext-c
    assert r["Z"] == {"ext-a": 1, "ext-b": 0, "ext-c": 1, "ext-d": 0}


def test_collection_level_fps_only_in_census_and_d12():
    rows = load("rows-multi.jsonl")
    without = [r for r in rows if r["callId"] != "in-grid-q1"]
    a = h1_precision.analyse(spec(), rows, boot=200)
    b = h1_precision.analyse(spec(), without, boot=200)
    assert a["X"] == b["X"] and a["Z"] == b["Z"] and a["pE"] == b["pE"]
    assert a["D12"]["collectionLevelFpsByQuery"] == {"query:q1": 1}
    assert a["D12"]["fpInputs"] == b["D12"]["fpInputs"] + 1
    assert a["censusShare"] > b["censusShare"]
    assert a["D12"]["fpSources"] == b["D12"]["fpSources"] + 1


def test_entailed_properties_are_sanity_counts_only():
    r = h1_precision.analyse(spec(), load("rows-multi.jsonl"), boot=200)
    assert r["entailedSanity"] == {"shop.search_products/total.equalsUpstream": 1}
    assert r["Z"]["ext-d"] == 0


def test_p_h1_is_one_when_census_share_at_least_1pct():
    r = h1_precision.analyse(spec(), load("rows-multi.jsonl"), boot=200)
    assert r["censusShare"] >= 0.01
    assert r["pH1"] == 1.0


def test_p_h1_equals_p_e_when_census_below_1pct():
    s = spec()
    # 200 more eligible inputs with no FP, and 300 more clean eligible entities.
    s["eligibleInputs"] += [f"in-clean-{i}" for i in range(200)]
    s["entities"] += [
        {"id": f"ext-x{i}", "domain": "shop", "authorBatch": f"shop-b{3 + i // 25:03d}", "eligible": True}
        for i in range(300)
    ]
    s["NE"] = 304
    s["neRule"] = {"topUpBatches": 0, "underpowered": True, "m": 4}
    rows = load("rows-search-per-element.jsonl")
    r = h1_precision.analyse(s, rows, boot=500)
    assert r["censusShare"] == pytest.approx(1 / 207)
    assert r["censusShare"] < 0.01
    assert r["pH1"] == r["pE"]
    assert r["X"] == 2 and r["entersHolm"] is True
    from scipy.stats import binom

    assert r["pE"] == pytest.approx(binom.cdf(2, 304, 0.02))


def test_per_element_rows_attribute_each_violating_element():
    r = h1_precision.analyse(spec(), load("rows-search-per-element.jsonl"), boot=200)
    # Page [ext-a $9, ext-b $50, ext-c $5000]: Z = 1 for ext-a and ext-c, 0 for ext-b (eligible
    # through in-get-b), and exactly one input-level FP.
    assert r["Z"]["ext-a"] == 1 and r["Z"]["ext-c"] == 1 and r["Z"]["ext-b"] == 0
    assert r["D12"]["fpInputs"] == 1
    assert r["D12"]["fpElements"] == 2


def test_first_element_only_rows_are_refused_cli():
    out = run_subprocess(
        "h1_precision.py",
        "--frame-spec", str(H1 / "frame-spec-h1.json"),
        "--rows", str(H1 / "rows-search-first-element.jsonl"),
    )
    assert out.returncode == 2
    assert "per-element rows required" in out.stderr


def test_element_index_must_match_path(tmp_path):
    rows = load("rows-search-per-element.jsonl")
    rows[0]["elementIndex"] = None
    with pytest.raises(InputError, match="per-element rows required"):
        h1_precision.analyse(spec(), rows, boot=10)
    rows[0]["elementIndex"] = 1
    with pytest.raises(InputError, match="elementIndex"):
        h1_precision.analyse(spec(), rows, boot=10)


def test_attribution_conflict_and_ineligible_entity():
    rows = load("rows-search-per-element.jsonl")
    rows[0]["originUnit"] = "ext-b"
    with pytest.raises(InputError, match="attribution says ext-a"):
        h1_precision.analyse(spec(), rows, boot=10)
    s = spec()
    s["attribution"]["in-get-a"]["price"] = "ext-e"
    rows = [r for r in load("rows-multi.jsonl") if r["callId"] == "in-get-a"]
    rows[0]["originUnit"] = "ext-e"
    with pytest.raises(InputError, match="ineligible entity ext-e"):
        h1_precision.analyse(s, rows, boot=10)


def test_batch_bootstrap_and_intervals():
    r = h1_precision.analyse(spec(), load("rows-multi.jsonl"), boot=2000, seed=1)
    # Two batches of two entities: b001 {a:1, b:0}, b002 {c:1, d:0}; every resample gives 0.5.
    assert r["batchBootstrapUpper9875"] == pytest.approx(0.5)
    assert r["robustToBatches"] is False
    assert r["perDomain"]["shop"]["k"] == 2 and r["perDomain"]["shop"]["n"] == 4
    assert r["perProvenance"]["shop-hand"]["n"] == 4


def test_cli_writes_out(tmp_path):
    out = run(
        "h1_precision.py",
        "--frame-spec", str(H1 / "frame-spec-h1.json"),
        "--rows", str(H1 / "rows-multi.jsonl"),
        "--nonattributable", str(write_jsonl(tmp_path / "na.jsonl", [{"drift": "T01", "property": "p", "originUnit": "ext-a"}])),
        "--boot", "100",
        "--out", str(tmp_path / "h1.json"),
    )
    assert out.returncode == 0, out.stderr
    res = json.loads((tmp_path / "h1.json").read_text())
    assert res["X"] == 2 and res["D12"]["nonAttributable"]["driftsWithAny"] == 1
