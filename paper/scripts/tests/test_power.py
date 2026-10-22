"""power.py: the PLAN 3 / 9.6 numbers, the N_E rule and the manifest check."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys

import power
import pytest
from conftest import FIXTURES, REPO, SCRIPTS, run, run_json, run_subprocess


def test_binom_1500_acceptance_output():
    out = run_subprocess("power.py", "binom", "--n", "1500", "--p0", "0.02", "--alpha", "0.0125", "--p1", "0.01", "0.005", check=True)
    assert "crit 18" in out.stdout
    assert "exact size 0.0123" in out.stdout
    assert "power at pi = 0.01: 0.821" in out.stdout
    assert "power at pi = 0.005: >= 0.99" in out.stdout


def test_binom_1000_and_min():
    r = run_json("power.py", "binom", "--n", "1000", "--p0", "0.02", "--alpha", "0.0125", "--p1", "0.01")
    assert r["crit"] == 10
    assert round(r["size"], 4) == 0.0102
    assert round(r["power"]["0.01"], 3) == 0.583
    out = run("power.py", "binom-min", "--p0", "0.02", "--alpha", "0.0125", check=True)
    assert out.stdout.strip() == "217"
    # 217 is the smallest N with 0.98^N <= 0.0125
    assert 0.98**217 <= 0.0125 < 0.98**216


def test_ni_and_harm_reproduce_round4_table():
    r = run_json(
        "power.py", "ni", "--n", "61", "40", "--sd-diff", "0.253", "0.279", "0.325",
        "--delta", "0.10", "--theta", "-0.03", "-0.05", "--alpha", "0.0125",
    )["power"]
    table = {
        "-0.03": {"0.253": ("0.468", "0.312"), "0.279": ("0.389", "0.256"), "0.325": ("0.288", "0.190")},
        "-0.05": {"0.253": ("0.243", "0.161"), "0.279": ("0.200", "0.134"), "0.325": ("0.149", "0.102")},
    }
    for theta, rows in table.items():
        for sd, (v61, v40) in rows.items():
            assert f"{r[f'sd={sd},n=61,theta={theta}']:.3f}" == v61
            assert f"{r[f'sd={sd},n=40,theta={theta}']:.3f}" == v40
    h = run_json(
        "power.py", "harm", "--n", "61", "40", "--sd-diff", "0.177", "0.196", "0.229",
        "--effect", "0.05", "--alpha", "0.0125",
    )["power"]
    for sd, (v61, v40) in {"0.177": ("0.385", "0.239"), "0.196": ("0.307", "0.188"), "0.229": ("0.214", "0.132")}.items():
        assert f"{h[f'sd={sd},n=61,effect=0.05']:.3f}" == v61
        assert f"{h[f'sd={sd},n=40,effect=0.05']:.3f}" == v40


def test_ni_rejects_positive_theta():
    out = run("power.py", "ni", "--n", "61", "--sd-diff", "0.25", "--delta", "0.1", "--theta", "0.02", "--alpha", "0.0125")
    assert out.returncode == 2


def test_anyfp_and_floor():
    out = run("power.py", "anyfp", "--n", "50", "--pi", "0.02", "0.01", check=True)
    assert out.stdout.strip() == "0.636 0.395"
    f = run_json("power.py", "floor", "--ma", "9", "12", "8", "6")["floor"]
    assert [f"{f[k]:.3f}" for k in ("9", "12", "8", "6")] == ["0.236", "0.204", "0.250", "0.289"]


def test_mde_wraps_eval_stats():
    r = run_json("power.py", "mde", "--n", "61", "--sd-diff", "0.177", "--alpha", "0.0125")
    assert r["mde_eval_stats"] == "0.0757"
    assert any("MDE with n=61: 0.0757" in line for line in r["eval_stats_stdout"])
    r = run_json("power.py", "mde", "--target", "0.05", "--sd-diff", "0.253", "--alpha", "0.025")
    assert r["n_required"] == 244


@pytest.mark.parametrize(
    "name,expect",
    [
        ("frame-spec.json", {"NE": 1500, "topUpRequired": False, "crit": 18, "underpowered": False, "m": 4, "p01": "0.821"}),
        ("frame-spec-ne1000.json", {"NE": 1000, "topUpRequired": True, "crit": 10, "underpowered": False, "m": 4, "p01": "0.583"}),
        ("frame-spec-ne200.json", {"NE": 200, "topUpRequired": True, "crit": -1, "underpowered": True, "m": 3, "p01": "0.000"}),
    ],
)
def test_frame_ne_rule_hand_checked(name, expect):
    r = run_json("power.py", "frame", "--frame-spec", str(FIXTURES / name))
    assert r["NE"] == expect["NE"]
    assert r["topUpRequired"] is expect["topUpRequired"]
    assert r["crit"] == expect["crit"]
    assert r["underpowered"] is expect["underpowered"]
    assert r["m"] == expect["m"]
    assert f"{r['power']['pi01']:.3f}" == expect["p01"]
    assert r["specMismatches"] == []
    if expect["NE"] == 1000:
        assert r["topUpBatchesByDomain"] == {"shop": 10, "tracker": 10}
    if expect["NE"] == 200:
        assert r["h1"] == "descriptive" and r["canReject"] is False


def test_frame_detects_spec_mismatch_and_bad_ne(tmp_path):
    spec = json.loads((FIXTURES / "frame-spec.json").read_text())
    spec["crit"] = 17
    p = tmp_path / "bad.json"
    p.write_text(json.dumps(spec))
    out = run("power.py", "frame", "--frame-spec", str(p))
    assert out.returncode == 1 and "MISMATCH crit" in out.stdout
    spec["crit"] = 18
    spec["NE"] = 1499
    p.write_text(json.dumps(spec))
    assert run("power.py", "frame", "--frame-spec", str(p)).returncode == 2


def test_all_check_passes_on_plan(tmp_path):
    out = run(
        "power.py", "all", "--check", str(REPO / "paper/PLAN.md"), "--out", str(tmp_path / "p.json"),
        "--macros", str(tmp_path / "p.tex"),
    )
    assert out.returncode == 0, out.stdout + out.stderr
    assert "72/72 entries pass; 0 problems" in out.stdout
    data = json.loads((tmp_path / "p.json").read_text())
    assert data["check"]["count"] == 72 and data["check"]["ok"] is True


def test_manifest_lists_exactly_the_plan_96_table():
    man = json.loads((SCRIPTS / "power_manifest.json").read_text())
    assert man["count"] == 72
    assert [e["id"] for e in man["entries"]] == list(range(1, 73))
    for e in man["entries"]:
        assert e["check"] in ("decimals", "exact", "ge", "le")
        assert ("command" in e) != ("terms" in e)


def _plan_copy(tmp_path, old: str, new: str):
    text = (REPO / "paper/PLAN.md").read_text()
    assert old in text
    p = tmp_path / "PLAN.md"
    p.write_text(text.replace(old, new, 1))
    return p


def test_all_check_fails_on_erratum(tmp_path):
    p = _plan_copy(tmp_path, "| 1,500 (planned) | 18★ | 0.0123★ | 0.821★ |", "| 1,500 (planned) | 18★ | 0.0123★ | 0.822★ |")
    out = run("power.py", "all", "--check", str(p), "--no-write")
    assert out.returncode == 1
    assert "0.822" in out.stdout and "not in the manifest" in out.stdout


def test_all_check_fails_on_untracked_tagged_number(tmp_path):
    p = _plan_copy(tmp_path, "Reference values for other σ_d:", "Reference values for other σ_d (also 0.777★):")
    out = run("power.py", "all", "--check", str(p), "--no-write")
    assert out.returncode == 1
    assert "§3.3: tagged number 0.777 is not in the manifest" in out.stdout


def test_all_check_fails_on_wrong_manifest_value(tmp_path):
    man = json.loads((SCRIPTS / "power_manifest.json").read_text())
    man["entries"][27]["printed"] = "0.800"  # #28 NI power S0 n = 61 is 0.801
    mp = tmp_path / "m.json"
    mp.write_text(json.dumps(man))
    out = run("power.py", "all", "--check", str(REPO / "paper/PLAN.md"), "--manifest", str(mp), "--no-write")
    assert out.returncode == 1
    assert re.search(r"#28 .*printed 0\.800, computed 0\.801", out.stdout)


def test_all_check_fails_when_manifest_short(tmp_path):
    man = json.loads((SCRIPTS / "power_manifest.json").read_text())
    man["entries"] = man["entries"][:-1]
    mp = tmp_path / "m.json"
    mp.write_text(json.dumps(man))
    out = run("power.py", "all", "--check", str(REPO / "paper/PLAN.md"), "--manifest", str(mp), "--no-write")
    assert out.returncode == 1 and "manifest ids must be exactly 1..72" in out.stdout


def test_tagged_number_parser():
    t = "x ≈ 0.636 (π = 0.02) or 0.395 (π = 0.01)★ and 18★, ≥ 0.99★, n ≥ 244★, 0.250† (m·a = 8)"
    vals = sorted(v for _, v in power.tagged_numbers(t))
    assert vals == [0.25, 0.395, 0.99, 18.0, 244.0]


def test_check_value_precision_rule():
    e = {"id": 0, "check": "decimals", "printed": "0.821"}
    assert power.check_value(e, 0.82054)[0]
    assert not power.check_value(e, 0.8216)[0]
    assert power.check_value({"id": 0, "check": "ge", "printed": "≥ 0.99", "value": 0.99}, 0.9997)[0]
    assert not power.check_value({"id": 0, "check": "exact", "printed": "18"}, 19)[0]


def test_eval_stats_missing_is_an_error(tmp_path):
    env = dict(os.environ, PAPER_FORGE_EVAL_STATS=str(tmp_path / "nope.py"))
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "power.py"), "mde", "--n", "61", "--sd-diff", "0.25", "--alpha", "0.0125"],
        capture_output=True, text=True, env=env, check=False,
    )
    assert proc.returncode == 2 and "eval_stats.py not found" in proc.stderr
