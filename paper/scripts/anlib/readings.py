"""Pre-registered readings (PLAN 3.5). Each function returns a list of {code, text}.

The texts follow the PLAN 3.5 table. Non-rejection is never worded as evidence of no effect.
"""

from __future__ import annotations

P0 = 0.02
HARM_MARGIN = 0.05
NI_MARGIN = 0.10
BA_MARGIN = 0.05


def _r(code: str, text: str) -> dict:
    return {"code": code, "text": text}


def _f(x, nd=3) -> str:
    return "NA" if x is None else f"{x:.{nd}f}"


def h1(res: dict, holm_entry: dict | None) -> list[dict]:
    if not res.get("entersHolm", True):
        return [_r("descriptive", "H1 is descriptive only (N_E < 217 at F4b; Holm runs over H2-H4, m = 3).")]
    out = []
    if holm_entry and holm_entry["rejected"]:
        t = (
            "On F, fewer than 2% of legitimate new entities trigger any false alarm, and < 1% of "
            "inputs are FPs."
        )
        out.append(_r("rejected", t))
        if res.get("batchBootstrapUpper9875") is not None and res["batchBootstrapUpper9875"] >= P0:
            out.append(
                _r(
                    "not_robust_batches",
                    "Rejected under entity exchangeability; not robust to authoring-batch dependence.",
                )
            )
        return out
    cp = (res.get("overall") or {}).get("cp95") or [None, None]
    out.append(
        _r(
            "not_rejected",
            f"Not established at this N_E; Clopper-Pearson upper bound on pi = {_f(cp[1], 4)}.",
        )
    )
    if (res.get("cp975Lower") or 0) > P0 or not res.get("censusOk", True):
        out.append(
            _r(
                "imprecise",
                "Imprecise: the 97.5% lower bound on pi exceeds 0.02 or the census share is >= 1%.",
            )
        )
    return out


def h2(res: dict, holm_entry: dict | None) -> list[dict]:
    prim = res["primary"]
    if holm_entry and holm_entry["rejected"]:
        return [
            _r(
                "rejected",
                "The named-property repro is the more adequate test over the fixed pool, against "
                "fail-first agent tests.",
            )
        ]
    out = [_r("not_established", f"Inconclusive. Not established at this n; MDE = {_f(prim.get('mde'), 4)}.")]
    lo, hi = prim.get("bca975") or (None, None)
    if lo is not None and -BA_MARGIN <= lo and hi <= BA_MARGIN:
        out.append(_r("equivalence", "Agent repros are as adequate (97.5% CI within +-0.05 BA)."))
    if hi is not None and hi < -BA_MARGIN:
        out.append(_r("opposite_direction", "Agent repros are more adequate (97.5% CI upper bound < -0.05 BA)."))
    return out


def _component_rejected(p: float, holm_entry: dict | None) -> bool:
    return bool(holm_entry and holm_entry["level"] is not None and p < holm_entry["level"])


def repair(hyp: str, res: dict, holm_entry: dict | None, other: dict | None = None) -> list[dict]:
    """H3 (comparator L1) or H4 (comparator COMP). `other` = the other hypothesis' result and
    Holm entry, for the 'H4 rejected, H3 not' row."""
    comp = res["comparator"]
    harm, ni = res["harm"], res["ni"]
    out: list[dict] = []
    if holm_entry and holm_entry["rejected"]:
        if hyp == "H3":
            out.append(
                _r(
                    "rejected",
                    "Given identical evidence and gates, and a trigger replay that is at least as "
                    "strict for L1 on the triggering call's attributable properties (this biases H3a "
                    "against FIKS), a visible fail-first repro lowers green-incorrect PRs without a "
                    "correct-PR loss beyond 0.10.",
                )
            )
        else:
            out.append(
                _r(
                    "rejected",
                    "FIKS exposes fewer green-incorrect PRs than the strongest composition (COMP), "
                    "without a correct-PR loss beyond 0.10.",
                )
            )
            if other and not (other.get("holm") or {}).get("rejected"):
                t = "FIKS beats the strongest composition; the repro's own share is not established."
                h3harm = other["res"]["harm"].get("bca975") or (None, None)
                if h3harm[0] is not None and -HARM_MARGIN <= h3harm[0] and h3harm[1] <= HARM_MARGIN:
                    t += " Placement, not the repro (H3a CI shows harm equivalence within +-0.05)."
                out.append(_r("h4_not_h3", t))
        return out
    out.append(
        _r(
            "not_established",
            f"Not established at this n; MDE = {_f(harm.get('mde'), 4)} (harm), "
            f"{_f(ni.get('mde'), 4)} (correct PRs) (realised n = {res['n']}).",
        )
    )
    hlo, hhi = harm.get("bca975") or (None, None)
    nlo, nhi = ni.get("bca975") or (None, None)
    if hhi is not None and hhi < -HARM_MARGIN:
        out.append(
            _r(
                "opposite_direction_harm",
                f"Opposite direction: FIKS exposes more green-incorrect PRs than {comp} (97.5% CI "
                f"of d = {comp} - FIKS is [{_f(hlo)}, {_f(hhi)}], below -0.05).",
            )
        )
    elif hlo is not None and -HARM_MARGIN <= hlo and hhi <= HARM_MARGIN:
        out.append(_r("equivalence_harm", f"Harm equivalent to {comp} within +-0.05 (97.5% CI)."))
    if nhi is not None and nhi < -NI_MARGIN:
        out.append(_r("opposite_direction_correct", "The repro costs correct PRs (97.5% CI upper bound < -0.10)."))
    harm_rej = harm["mean"] is not None and harm["mean"] > 0 and _component_rejected(res["pA"], holm_entry)
    ni_rej = _component_rejected(res["pB"], holm_entry)
    if harm_rej and not ni_rej:
        out.append(
            _r(
                "harm_only",
                "Fewer harmful PRs; a correct-PR cost beyond 0.10 is not excluded.",
            )
        )
    if not harm_rej:
        out.append(
            _r(
                "asymmetry_note",
                f"Read with the PLAN 3.0 trigger-check asymmetry: part of a true harm gap may be "
                f"absorbed by {comp}'s stricter IV on non-target attributable properties (E1 count shown "
                "next to this reading).",
            )
        )
    return out
