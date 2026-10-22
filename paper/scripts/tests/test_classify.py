"""classify_outcome.py (PLAN 3.0 "Attempt")."""

from __future__ import annotations

import classify_outcome as co
import pytest
from anlib.io import InputError

RK = {"experiment": "R4", "arm": "COMP", "model": "claude-opus-5-5", "domain": "shop", "drift": "T01", "attempt": 0}


def att(**kw):
    base = {"runKey": dict(RK), "prExposed": True, "ciFinal": "green", "issueValidation": "n/a", "ivPlacement": "none", "headSha": "abc"}
    base.update(kw)
    return base


def grade(correct: bool):
    return {"patchId": "R4/COMP/claude-opus-5-5/shop/T01/0", "drift": "T01", "criteria": {}, "correct": correct, "reasons": []}


def test_red_final_ci_is_red_pr_even_if_held_out_correct():
    a = att(ciFinal="red")
    assert co.classify(a, grade(True)) == "red_pr"


def test_exposed_green_held_out_correct_is_correct_pr():
    assert co.classify(att(), grade(True)) == "correct_pr"
    assert co.classify(att(), grade(False)) == "green_incorrect_pr"


def test_l1_failed_pre_pr_iv_is_no_pr():
    a = att(runKey=dict(RK, arm="L1"), prExposed=False, ciFinal="green", issueValidation="fail", ivPlacement="pre")
    assert co.classify(a, grade(True)) == "no_pr"


def test_comp_post_pr_iv_failure_makes_final_ci_red():
    a = att(issueValidation="fail", ivPlacement="post")
    assert co.classify(a, grade(True)) == "red_pr"
    assert co.classify(att(issueValidation="pass", ivPlacement="post"), grade(True)) == "correct_pr"


def test_infra_and_contract_update():
    assert co.classify(att(infraError=True), None) == "infra_error"
    assert co.classify(att(prExposed=False, contractUpdateProposed=True), None) == "contract_update_proposed"


def test_inconsistent_records_are_errors():
    with pytest.raises(InputError):
        co.classify(att(), None)  # green exposed PR without a grade
    with pytest.raises(InputError):
        co.classify(att(ciFinal="none"), grade(True))
    with pytest.raises(InputError):
        co.classify(att(ivPlacement="pre", issueValidation="fail"), grade(True))


def test_classify_all_joins_by_runkey_or_head_sha():
    a1 = att()
    a2 = att(runKey=dict(RK, attempt=1), headSha="def")
    g2 = {"patchId": "def", "drift": "T01", "criteria": {}, "correct": False, "reasons": []}
    out = co.classify_all([a1, a2], [grade(True), g2])
    assert [o["outcome"] for o in out] == ["correct_pr", "green_incorrect_pr"]
