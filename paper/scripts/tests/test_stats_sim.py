"""anlib.stats primitives, simulate_null / simulate_power smoke runs, paper_check, check_workstreams."""

from __future__ import annotations

import itertools
import json
import shutil

import numpy as np
import pytest
import simulate_null
import simulate_power
from anlib import stats
from conftest import REPO, SCRIPTS, run, run_subprocess


def test_sign_flip_exact_matches_brute_force():
    x = [0.3, -0.1, 0.25, 0.05, -0.2, 0.15, 0.0, 0.4]
    obs = abs(np.mean(x))
    count = sum(abs(np.mean([s * v for s, v in zip(signs, x)])) >= obs - 1e-12 for signs in itertools.product((1, -1), repeat=len(x)))
    r = stats.sign_flip_p(x)
    assert r["method"] == "exact" and r["p"] == pytest.approx(count / 2 ** len(x))
    g = stats.sign_flip_p(x, "greater")
    countg = sum(np.mean([s * v for s, v in zip(signs, x)]) >= np.mean(x) - 1e-12 for signs in itertools.product((1, -1), repeat=len(x)))
    assert g["p"] == pytest.approx(countg / 2 ** len(x))


def test_sign_flip_monte_carlo_is_seeded_and_valid():
    rng = np.random.default_rng(0)
    x = rng.normal(0.3, 1, size=40)
    a = stats.sign_flip_p(x, flips=20000, seed=5)
    b = stats.sign_flip_p(x, flips=20000, seed=5)
    assert a == b and a["method"] == "monte-carlo" and 0 < a["p"] <= 1


def test_shifted_sign_flip_ni():
    d = [-0.02, 0.01, 0.0, -0.05, 0.03] * 6  # mean -0.006, far above -0.10
    assert stats.sign_flip_p(d, "greater", flips=20000, seed=1, shift=0.10)["p"] < 0.001


def test_holm():
    h = stats.holm({"H1": 0.01, "H2": 0.04, "H3": 0.03, "H4": 0.005})
    assert h["H4"]["adjusted"] == pytest.approx(0.02) and h["H4"]["rejected"]
    assert h["H1"]["adjusted"] == pytest.approx(0.03) and h["H1"]["rejected"]
    assert h["H3"]["adjusted"] == pytest.approx(0.06) and not h["H3"]["rejected"]
    assert h["H2"]["level"] is None and not h["H2"]["rejected"]


def test_mcnemar_and_intervals():
    m = stats.mcnemar(10, 2)
    assert m["exact_p"] == pytest.approx(0.0385742, abs=1e-6)
    assert m["midp"] < m["exact_p"]
    lo, hi = stats.clopper_pearson(0, 50)
    assert lo == 0 and hi == pytest.approx(1 - 0.025 ** (1 / 50))
    assert stats.wilson(5, 10)[0] < 0.5 < stats.wilson(5, 10)[1]


def test_bca_contains_mean():
    x = np.random.default_rng(3).normal(0.2, 0.3, 61)
    lo, hi = stats.bca_ci(x, 0.95, 4000, 1)
    assert lo < x.mean() < hi


def test_binomial_helpers():
    assert stats.binom_crit(1500, 0.02, 0.0125) == 18
    assert stats.binom_crit(200, 0.02, 0.0125) == -1
    assert stats.binom_min_n(0.02, 0.0125) == 217


def test_simulate_null_small_run_structure():
    res = simulate_null.run(200, 61, 3, 4, 7)
    assert res["i_h1"]["NE1500"]["crit"] == 18
    assert res["i_h1"]["NE1500"]["analyticSize"] <= 0.0125
    assert set(res["ii_signflip"]) == {"H2", "H3a", "H4a"}
    assert res["iii_ni"]["selected"] in ("sign-flip", "bootstrap-t")
    assert set(res["iv_iut"]) == {"LF-harm", "LF-NI"}


def test_size_gate_is_one_sided_and_reports_realised_size():
    # BA4: a conservative size passes (and is labelled), an anti-conservative one fails.
    d = 2000
    conservative = np.r_[np.zeros(60), np.ones(d - 60)]  # 0.030 at alpha 0.05
    r = simulate_null.size_rows(conservative, d)["0.05"]
    assert r["pass"] and r["rejection"] == 0.03 and r["direction"] == "conservative"
    assert r["bound"] == 0.05 + 3 * r["mcse"]
    liberal = np.r_[np.zeros(140), np.ones(d - 140)]  # 0.070 > 0.05 + 3 MC SE
    r = simulate_null.size_rows(liberal, d)["0.05"]
    assert not r["pass"] and r["direction"] == "anti-conservative"
    on_target = np.r_[np.zeros(100), np.ones(d - 100)]
    r = simulate_null.size_rows(on_target, d)["0.05"]
    assert r["pass"] and "direction" not in r


def test_simulate_null_is_deterministic():
    a = simulate_null.run(100, 30, 3, 4, 11)
    b = simulate_null.run(100, 30, 3, 4, 11)
    assert a == b


def test_bootstrap_t_ni_valid_direction():
    rng = np.random.default_rng(0)
    good = rng.normal(0.0, 0.2, 61)
    bad = rng.normal(-0.2, 0.2, 61)
    assert stats.bootstrap_t_ni_p(good, 0.10, 2000, rng) < 0.05
    assert stats.bootstrap_t_ni_p(bad, 0.10, 2000, rng) > 0.5


def test_simulate_power_writes_only_its_key(tmp_path):
    out = tmp_path / "power.json"
    out.write_text(json.dumps({"check": {"keep": True}}))
    r = run("simulate_power.py", "--configs", "S0", "--n", "61", "--datasets", "200", "--out", out)
    assert r.returncode == 0, r.stderr
    data = json.loads(out.read_text())
    assert data["check"] == {"keep": True}
    s = data["simulatedIut"]["planning"]["results"]["S0"]["n=61"]
    assert 0 <= s["simulated"]["joint"] <= 1
    assert s["analytic"]["sdHarm"] == pytest.approx(0.1768, abs=1e-4)
    assert s["analytic"]["sdCorrect"] == pytest.approx(0.2533, abs=1e-4)
    assert simulate_power.CONFIGS["S2"] == (3, 3)


def _check_root(tmp_path):
    root = tmp_path / "repo"
    for rel in ("paper/PLAN.md", "paper/scripts/power_manifest.json", "paper/results/power.json", "paper/macros/power.tex"):
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / rel, root / rel)
    return root


def test_paper_check_passes_on_committed_outputs():
    r = run("paper_check.py")
    assert r.returncode == 0, r.stdout


def test_paper_check_fails_after_hand_edit_and_passes_after_regeneration(tmp_path):
    root = _check_root(tmp_path)
    assert run("paper_check.py", "--root", root).returncode == 0
    tex = root / "paper/macros/power.tex"
    tex.write_text(tex.read_text().replace("{0.821}", "{0.822}", 1))
    bad = run("paper_check.py", "--root", root)
    assert bad.returncode == 1 and "paper/macros/power.tex: differs from its rebuild" in bad.stdout
    assert run("paper_check.py", "--root", root, "--regenerate").returncode == 0
    assert run("paper_check.py", "--root", root).returncode == 0
    # A hand-written macro file is rejected; so is a confirmatory macro with no CP2 logs.
    (root / "paper/macros/extra.tex").write_text("\\newcommand{\\X}{1}\n")
    (root / "paper/macros/confirmatory.tex").write_text("% hand\n")
    bad = run("paper_check.py", "--root", root)
    assert "extra.tex: not produced by any registered generator" in bad.stdout
    assert "confirmatory.tex: exists but its source logs are absent" in bad.stdout
    # Editing a number in power.json is caught too.
    (root / "paper/macros/extra.tex").unlink()
    (root / "paper/macros/confirmatory.tex").unlink()
    pj = root / "paper/results/power.json"
    pj.write_text(pj.read_text().replace('"passed": 72', '"passed": 71'))
    assert run("paper_check.py", "--root", root).returncode == 1


def test_check_workstreams_passes():
    r = run_subprocess("check_workstreams.py", str(REPO / "paper/WORKSTREAMS.json"))
    assert r.returncode == 0, r.stdout + r.stderr
    assert "est_hours total" in r.stdout
    assert (SCRIPTS / "check_workstreams.py").is_file()
