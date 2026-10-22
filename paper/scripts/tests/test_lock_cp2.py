"""cp2_lock.py end to end, and the lock rule for every exploratory script (PLAN 8.1 CP2, 9.1).
Locks are created only under tmp_path ($TMPDIR)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import FIXTURES, SCRIPTS, run, run_subprocess, write_jsonl

E_SCRIPTS = sorted(p.name for p in SCRIPTS.glob("e*_*.py"))


def test_there_are_exploratory_scripts():
    assert {"e1_ladder.py", "e4_benign.py", "e6_security.py", "e7_realbugs.py", "e11_receipts.py"} <= set(E_SCRIPTS)


@pytest.mark.parametrize("script", E_SCRIPTS + ["descriptive.py"])
def test_exploratory_scripts_refuse_without_lock(script, tmp_path):
    out = run(script, "--lock", str(tmp_path / "absent.lock"), "--help")
    assert out.returncode == 0  # --help still works
    # Required inputs point at a missing file: the lock check must fire first.
    args = ["--lock", str(tmp_path / "absent.lock")]
    for flag in ("--attempts", "--detections", "--specificity", "--benign", "--candidates", "--attacks",
                 "--repro-tests", "--trials"):
        if flag in out.stdout:
            args += [flag, str(tmp_path / "none.jsonl")]
    res = run(script, *args)
    assert res.returncode == 3, res.stdout + res.stderr
    assert "absent" in res.stderr and "CP2" in res.stderr


def test_default_lock_path_is_absent_and_scripts_refuse():
    # The real lock does not exist during the build, so the default path refuses too.
    res = run_subprocess("e7_realbugs.py", "--attempts", "/nonexistent.jsonl")
    assert res.returncode == 3


def test_invalid_lock_is_refused(tmp_path):
    bad = tmp_path / "bad.lock"
    bad.write_text("{}")
    res = run("e7_realbugs.py", "--lock", bad, "--attempts", tmp_path / "x.jsonl")
    assert res.returncode == 3 and "not a valid CP2 lock" in res.stderr


def _cp2_inputs(tmp_path: Path) -> list[str]:
    """Unclassified AttemptRecords + GradeRecords derived from the h3h4 'safer' fixture."""
    rows = [json.loads(x) for x in (FIXTURES / "h3h4/attempts-fiks-safer.jsonl").read_text().splitlines()]
    atts, grades = [], []
    for r in rows:
        rk, out = r["runKey"], r["outcome"]
        key = "/".join(str(rk[f]) for f in ("experiment", "arm", "model", "domain", "drift", "attempt"))
        iv = "pre" if rk["arm"] == "L1" else ("post" if rk["arm"] == "COMP" else "none")
        a = {
            "runKey": rk,
            "prExposed": out != "no_pr",
            "ciFinal": "red" if out == "red_pr" else "green",
            "issueValidation": "pass" if iv != "none" else "n/a",
            "ivPlacement": iv,
            "headSha": None,
        }
        atts.append(a)
        if out in ("correct_pr", "green_incorrect_pr"):
            grades.append({"patchId": key, "drift": rk["drift"], "criteria": {}, "correct": out == "correct_pr", "reasons": []})
    h1 = FIXTURES / "h1"
    return [
        "--frame-spec", str(h1 / "frame-spec-h1.json"),
        "--h1-rows", str(h1 / "rows-multi.jsonl"),
        "--matrix", str(FIXTURES / "h2/matrix.jsonl"),
        "--h2-pool", str(FIXTURES / "h2/pool.json"),
        "--attempts", str(write_jsonl(tmp_path / "attempts.jsonl", atts)),
        "--grades", str(write_jsonl(tmp_path / "grades.jsonl", grades)),
        "--repair-pool", str(FIXTURES / "h3h4/pool.json"),
        "--flips", "2000",
    ]


def test_cp2_lock_end_to_end_then_exploratory_runs(tmp_path):
    lock = tmp_path / "confirmatory.lock"
    args = _cp2_inputs(tmp_path) + ["--out-dir", str(tmp_path / "cp2"), "--macros", str(tmp_path / "confirmatory.tex"), "--lock", str(lock)]
    out = run_subprocess("cp2_lock.py", *args)
    assert out.returncode == 0, out.stdout + out.stderr
    rec = json.loads(lock.read_text())
    assert rec["kind"] == "fiks-cp2-lock" and len(rec["outputs"]) == 6
    hol = json.loads((tmp_path / "cp2/holm.json").read_text())
    assert hol["m"] == 3  # the H1 fixture's FrameSpec sets m = 3 (N_E < 217)
    assert hol["holm"]["H3"]["rejected"] is True
    # CP2 runs once.
    again = run_subprocess("cp2_lock.py", *args)
    assert again.returncode == 1 and "runs once" in again.stderr
    # With the lock, exploratory scripts run.
    e1 = run("e1_ladder.py", "--lock", lock, "--attempts", tmp_path / "cp2/classified.jsonl", "--flips", "500", "--out", tmp_path / "e1.json")
    assert e1.returncode == 0, e1.stderr
    e1r = json.loads((tmp_path / "e1.json").read_text())
    assert "COMP" in e1r["ladder"] and "never called significant" in e1r["note"]
    e9 = run("e9_cost.py", "--lock", lock, "--attempts", tmp_path / "cp2/classified.jsonl")
    assert e9.returncode == 0, e9.stderr
    d = run("descriptive.py", "--lock", lock, "--raw-dir", tmp_path, "--out", tmp_path / "d.json")
    assert d.returncode == 0, d.stderr
    dres = json.loads((tmp_path / "d.json").read_text())
    assert dres["D12"]["fpInputs"] == 4 and dres["D2"] == {"status": "absent"}


def _lock(tmp_path) -> Path:
    p = tmp_path / "lock"
    p.write_text(json.dumps({"kind": "fiks-cp2-lock", "outputs": {}}))
    return p


def test_e4_paired_sign_flip_and_midp_mcnemar(tmp_path):
    rows = []
    for c in range(30):
        for att in range(3):
            rows.append({"case": f"B{c}", "arm": "FIKS-current", "attempt": att, "outcome": "code_pr" if (c + att) % 2 else "no_pr", "documented": c < 15})
            rows.append({"case": f"B{c}", "arm": "FIKS+CU", "attempt": att, "outcome": "contract_update_proposed" if att else "code_pr" if c % 5 == 0 else "no_pr", "documented": c < 15})
            rows.append({"case": f"B{c}", "arm": "COMP", "attempt": att, "outcome": "code_pr", "documented": c < 15})
    routing = [{"drift": f"T{i}", "routedToCode": i != 0} for i in range(61)]
    out = run("e4_benign.py", "--lock", _lock(tmp_path), "--benign", write_jsonl(tmp_path / "b.jsonl", rows),
              "--routing", write_jsonl(tmp_path / "r.jsonl", routing), "--flips", "5000", "--out", tmp_path / "e4.json")
    assert out.returncode == 0, out.stderr
    r = json.loads((tmp_path / "e4.json").read_text())
    c = r["contrasts"]["COMP - FIKS+CU"]
    assert c["n"] == 30 and c["method"] == "monte-carlo" and c["mean"] > 0
    m = r["firstAttemptMcNemar"]["COMP vs FIKS+CU"]
    assert m["b"] == 24 and m["c"] == 0 and m["midp"] < m["exact_p"]
    assert r["misroutingGuard"]["k"] == 60 and r["misroutingGuard"]["holds"] is True


def test_e7_is_descriptive_only(tmp_path):
    rows = [{"bug": "R10", "arm": arm, "attempt": i, "outcome": "correct_pr" if i < k else "no_pr"}
            for arm, k in (("FIKS", 3), ("COMP", 1), ("ISSUE-TEXT", 0)) for i in range(5)]
    out = run("e7_realbugs.py", "--lock", _lock(tmp_path), "--attempts", write_jsonl(tmp_path / "a.jsonl", rows), "--out", tmp_path / "e7.json")
    assert out.returncode == 0, out.stderr
    text = (tmp_path / "e7.json").read_text()
    r = json.loads(text)
    assert r["perBug"]["R10"]["FIKS"]["correct_pr"]["k"] == 3
    assert '"rawP"' not in text and '"midp"' not in text and '"p"' not in text


def test_e11_exact_sign_flip_small_n(tmp_path):
    rows = []
    for d in range(10):
        for t in range(4):
            rows.append({"drift": f"T{d}", "condition": "none", "trial": t, "wrongAnswer": t < 2, "correct": t >= 2})
            rows.append({"drift": f"T{d}", "condition": "receipts", "trial": t, "wrongAnswer": t < 1 and d < 5, "correct": True})
    out = run("e11_receipts.py", "--lock", _lock(tmp_path), "--trials", write_jsonl(tmp_path / "t.jsonl", rows), "--out", tmp_path / "e11.json")
    assert out.returncode == 0, out.stderr
    r = json.loads((tmp_path / "e11.json").read_text())
    w = r["wrongAnswer(none - receipts)"]
    assert w["method"] == "exact" and w["rawP"] == pytest.approx(2 / 1024)
    assert r["receipts"]["passHatK"]["4"] == 1.0


def test_e6_single_named_test(tmp_path):
    rows = []
    for t in range(12):
        for c in range(10):
            for fmt in ("raw", "strict"):
                hit = fmt == "raw" and (t + c) % 4 == 0
                rows.append({"template": f"t{t}", "carrier": f"c{c}", "format": fmt,
                             "goals": {"egress": False, "attackerBehaviour": hit, "nonSrcEdit": False, "disallowedCommand": False},
                             "containmentViolation": False, "canaryHit": False})
    out = run("e6_security.py", "--lock", _lock(tmp_path), "--attacks", write_jsonl(tmp_path / "a.jsonl", rows), "--out", tmp_path / "e6.json")
    assert out.returncode == 0, out.stderr
    r = json.loads((tmp_path / "e6.json").read_text())
    assert list(r["test"]) == ["rawVsStrict"]
    assert r["test"]["rawVsStrict"]["b"] == 30 and r["test"]["rawVsStrict"]["pairs"] == 120


def test_e2_glmm_runs(tmp_path):
    out = run("e2_models.py", "--lock", _lock(tmp_path), "--attempts", FIXTURES / "h3h4/attempts-fiks-safer.jsonl", "--out", tmp_path / "e2.json")
    assert out.returncode == 0, out.stderr
    r = json.loads((tmp_path / "e2.json").read_text())
    assert r["harm"]["nAttempts"] == 24 * 3 * 3 * 4
    assert any("arm" in k for k in r["harm"]["fixed"])


def test_e3_e5_e8_e10_smoke(tmp_path):
    lock = _lock(tmp_path)
    det = []
    for i in range(20):
        det.append({"detector": "contracts", "unit": f"T{i}", "kind": "drift", "stratum": "realistic" if i % 2 else "evasive",
                    "ideationFamily": "claude", "provenance": "shop-hand", "fired": i % 3 != 0})
        det.append({"detector": "schema", "unit": f"T{i}", "kind": "drift", "stratum": "realistic", "ideationFamily": "claude",
                    "provenance": "shop-hand", "fired": i % 5 == 0, "nonAttributable": 1 if i == 0 else 0})
    det += [{"detector": "contracts", "unit": f"M{i}", "kind": "mutant", "operator": "M1", "fired": i != 0} for i in range(5)]
    spec = [{"detector": "contracts", "input": f"in{i}", "fired": i == 0} for i in range(50)]
    r = run("e3_detection.py", "--lock", lock, "--detections", write_jsonl(tmp_path / "d.jsonl", det),
            "--specificity", write_jsonl(tmp_path / "s.jsonl", spec), "--out", tmp_path / "e3.json")
    assert r.returncode == 0, r.stderr
    e3 = json.loads((tmp_path / "e3.json").read_text())
    assert e3["mcnemar"]["contracts vs schema"]["n"] == 20
    assert "construction-coupled" in e3["mutantFn"]["label"] and e3["mutantFn"]["byOperator"]["M1"]["k"] == 1
    cands = [{"id": f"c{i}", "drift": "T1", "arm": "FIKS", "passedAllFiksGates": i < 6, "heldOutCorrect": i not in (0, 7),
              "gateRejected": i >= 6, "collateralRegression": i == 9} for i in range(10)]
    r = run("e5_residual.py", "--lock", lock, "--candidates", write_jsonl(tmp_path / "c.jsonl", cands), "--out", tmp_path / "e5.json")
    assert r.returncode == 0, r.stderr
    e5 = json.loads((tmp_path / "e5.json").read_text())
    assert e5["residual"]["FIKS"]["k"] == 1 and e5["collateral"]["FIKS"]["k"] == 1
    rows = [json.loads(x) for x in (FIXTURES / "h3h4/attempts-fiks-safer.jsonl").read_text().splitlines()]
    for x in rows:
        if x["runKey"]["arm"] == "COMP":
            x["runKey"]["arm"] = "COMP-plain"
    r = run("e8_compplain.py", "--lock", lock, "--attempts", write_jsonl(tmp_path / "a.jsonl", rows), "--flips", "500", "--out", tmp_path / "e8.json")
    assert r.returncode == 0, r.stderr
    assert json.loads((tmp_path / "e8.json").read_text())["harm(COMP-plain - FIKS)"]["n"] == 24
    tests = [{"runKey": "R3/agent/m/shop/T1/0", "round": 0, "isFirst": True, "isFinal": i == 1, "fOnBase": "fail",
              "plainFP": True, "statedReason": i == 0} for i in range(2)]
    r = run("e10_reason.py", "--lock", lock, "--repro-tests", write_jsonl(tmp_path / "t.jsonl", tests), "--out", tmp_path / "e10.json")
    assert r.returncode == 0, r.stderr
    assert json.loads((tmp_path / "e10.json").read_text())["final"]["plainFPwrongReason"]["k"] == 1
