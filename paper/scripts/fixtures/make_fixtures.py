#!/usr/bin/env python3
"""Regenerate the generated synthetic fixtures (deterministic; no randomness).

  paper/.venv/bin/python paper/scripts/fixtures/make_fixtures.py

h3h4/   classified attempts (24 drifts x 3 models x 4 attempts x FIKS/L1/COMP): FIKS more harmful
        than both comparators with equal correct-PR rates, and FIKS safer; pool.json marks every
        fifth drift request-changing.
h2/     an acceptance matrix over a 6-drift pool (see adequacy_fixtures()).
h1/     hand-written (not generated): the per-element search page and the multi-property entity.

frame-spec.json        N_E = 1,500 (750 shop + 750 tracker eligible; 10 ineligible per domain)
frame-spec-ne1000.json N_E = 1,000 (500 + 500)
frame-spec-ne200.json  N_E = 200   (100 + 100)

Each file records the hand-checked N_E-rule outcome (PLAN 3.1) in neRule, crit and power;
`power.py frame` recomputes it and exits 1 on any mismatch. Hand check:
  1,500: no top-up; crit 18 (P(Bin(1500,.02) <= 18) = 0.01226 <= 0.0125 < P(<= 19));
         power(.01) = 0.820538, power(.005) = 0.999710; not underpowered; m = 4.
  1,000: top-up (each domain 500 < 750: ceil(250 / 25) = 10 batches each, 20 total);
         crit 10; power(.01) = 0.583041 >= 0.50, so not underpowered; m = 4.
    200: top-up (ceil(650 / 25) = 26 batches each, 52 total); 0.98^200 = 0.0176 > 0.0125, so
         no crit exists (-1), power 0, underpowered; 200 < 217, so m = 3 (H1 descriptive).
Files are written one entity per line; then run `pnpm exec biome format --write paper/scripts/fixtures`.
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

CASES = {
    "frame-spec.json": (750, {"topUpBatches": 0, "underpowered": False, "m": 4}, 18, 0.820538, 0.99971),
    "frame-spec-ne1000.json": (500, {"topUpBatches": 20, "underpowered": False, "m": 4}, 10, 0.583041, 0.986531),
    "frame-spec-ne200.json": (100, {"topUpBatches": 52, "underpowered": True, "m": 3}, -1, 0.0, 0.0),
}
INELIGIBLE = 10


def entities(domain: str, n_eligible: int) -> list[dict]:
    out = []
    for i in range(n_eligible + INELIGIBLE):
        out.append(
            {
                "id": f"ext-{domain}-{i + 1:04d}",
                "domain": domain,
                "authorBatch": f"{domain}-b{i // 25 + 1:03d}",
                "eligible": i < n_eligible,
            }
        )
    return out


def render(spec: dict) -> str:
    lines = ["{"]
    keys = list(spec)
    for j, k in enumerate(keys):
        comma = "," if j < len(keys) - 1 else ""
        if k == "entities":
            lines.append('  "entities": [')
            ents = spec[k]
            for i, e in enumerate(ents):
                inner = ", ".join(f"{json.dumps(a)}: {json.dumps(b)}" for a, b in e.items())
                lines.append(f"    {{ {inner} }}" + ("," if i < len(ents) - 1 else ""))
            lines.append("  ]" + comma)
        else:
            body = json.dumps(spec[k], indent=2).replace("\n", "\n  ")
            lines.append(f"  {json.dumps(k)}: {body}{comma}")
    lines.append("}")
    return "\n".join(lines) + "\n"


MODELS = ("claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5")


def jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, sort_keys=True) + "\n" for r in rows), encoding="utf-8")


def attempts_fixture(patterns: dict[str, callable], n_drifts: int) -> list[dict]:
    """Classified attempts: arm -> pattern(i) = 4 outcomes (attempts 0..3), same for every model."""
    rows = []
    for i in range(n_drifts):
        drift = f"T{i + 1:02d}"
        for arm, pat in patterns.items():
            outs = pat(i)
            for model in MODELS:
                for att, out in enumerate(outs):
                    rows.append(
                        {
                            "runKey": {
                                "experiment": "R4",
                                "arm": arm,
                                "model": model,
                                "domain": "shop",
                                "drift": drift,
                                "attempt": att,
                            },
                            "outcome": out,
                        }
                    )
    return rows


def pool(n_drifts: int) -> dict:
    # Request-changing drifts: every fifth (T01, T06, ...), mirroring D3/D4-like drifts.
    return {"drifts": [{"id": f"T{i + 1:02d}", "requestChanging": i % 5 == 0} for i in range(n_drifts)]}


def comparator(i: int) -> list[str]:
    return ["correct_pr", "correct_pr", "no_pr", "green_incorrect_pr" if i % 4 == 0 else "no_pr"]


def repair_fixtures() -> None:
    """h3h4/: FIKS significantly MORE harmful than L1 and COMP (harm d_i < 0 on every drift),
    with equal correct-PR rates (NI holds); and FIKS less harmful (the reference direction)."""
    out = HERE / "h3h4"
    n = 24
    harmful = {
        "FIKS": lambda i: [
            "correct_pr",
            "correct_pr",
            "green_incorrect_pr",
            "green_incorrect_pr" if i % 3 else "red_pr",
        ],
        "L1": comparator,
        "COMP": comparator,
    }
    jsonl(out / "attempts-fiks-more-harmful.jsonl", attempts_fixture(harmful, n))
    safer = {
        "FIKS": lambda i: ["correct_pr", "correct_pr", "no_pr", "green_incorrect_pr" if i % 6 == 0 else "no_pr"],
        "L1": lambda i: ["correct_pr", "correct_pr", "green_incorrect_pr", "green_incorrect_pr" if i % 2 else "no_pr"],
        "COMP": lambda i: ["correct_pr", "correct_pr", "green_incorrect_pr", "red_pr"],
    }
    jsonl(out / "attempts-fiks-safer.jsonl", attempts_fixture(safer, n))
    (out / "pool.json").write_text(json.dumps(pool(n), indent=2) + "\n", encoding="utf-8")


def adequacy_fixtures() -> None:
    """h2/: a pool of 6 drifts. Pool patches: c1..c4 correct, i1..i4 incorrect (H-f: 2 incorrect,
    so excluded). H-a: the fiks test failed its own F gate and is used as it behaves. H-b: FIKS
    emitted no test, so T = empty. H-e is request-changing (s3 drops it). Two REPRO-AGENT
    sessions per drift (final + first test each)."""
    out = HERE / "h2"
    accept = {
        # drift: (fiks accepts, empty accepts, agent final A, agent final B, agent first A, first B)
        "H-a": ("c1 c2 c3 c4 i1 i2", "c1 c2 c3 c4 i1 i2 i3 i4", "c1 c2 c3 i1 i2 i3", "c1 c2 c3 c4 i1 i2 i3", "c1 c2 c3 c4 i1 i2 i3 i4", "c1 c2 c3 c4 i1 i2 i3 i4"),
        "H-b": (None, "c1 c2 c3 c4 i1 i2 i3", "c1 c2 c3 c4 i1 i2", "c1 c2 c3 c4 i1 i2 i3", "c1 c2 c3 c4 i1 i2 i3 i4", "c1 c2 c3 c4 i1 i2 i3"),
        "H-c": ("c1 c2 c3 c4", "c1 c2 c3 c4 i1 i2 i3 i4", "c1 c2 c3 c4 i1 i2", "c1 c2 c3 i1", "c1 c2 c3 c4 i1 i2 i3", "c1 c2 c3 c4 i1 i2 i3 i4"),
        "H-d": ("c1 c2 c3 c4 i1", "c1 c2 c3 c4 i1 i2 i3 i4", "c1 c2 c3 c4 i1 i2 i3", "c1 c2 c3 c4 i1 i2", "c1 c2 c3 c4 i1 i2 i3 i4", "c1 c2 c3 c4 i1 i2 i3"),
        "H-e": ("c1 c2 c3 c4", "c1 c2 c3 c4 i1 i2 i3 i4", "c1 c2 c3 c4 i1 i2 i3 i4", "c1 c2 c3 c4 i1 i2 i3", "c1 c2 c3 c4 i1 i2 i3 i4", "c1 c2 c3 c4 i1 i2 i3 i4"),
        "H-f": ("c1 c2 c3 c4", "c1 c2 c3 c4 i1 i2", "c1 c2 c3 c4 i1", "c1 c2 c3 c4 i1", "c1 c2 c3 c4 i1 i2", "c1 c2 c3 c4 i1 i2"),
    }
    fonbase = {"A": "fail", "B": "pass"}  # session B's final test never passed the F check
    rows = []
    for drift, (fk, em, fa, fb, sa, sb) in accept.items():
        patches = ["c1", "c2", "c3", "c4", "i1", "i2"] + ([] if drift == "H-f" else ["i3", "i4"])
        sources = {"c1": "refA", "c2": "refB", "c3": "sonnet-alt", "c4": "P4", "i1": "P1", "i2": "P2", "i3": "haiku-wrong", "i4": "P8"}

        def add(test_set: str, acc: str | None, **extra) -> None:
            if acc is None:
                return
            ok = set(acc.split())
            for pid in patches:
                rows.append(
                    {
                        "drift": drift,
                        "patchId": f"{drift}/{pid}",
                        "correct": pid.startswith("c"),
                        "source": sources[pid],
                        "testSet": test_set,
                        "accepted": pid in ok,
                        **extra,
                    }
                )

        add("fiks", fk)
        add("empty", em)
        add("agent", fa, testId="A", variant="final", fOnBase=fonbase["A"], inlineRecording=False)
        add("agent", fb, testId="B", variant="final", fOnBase=fonbase["B"], inlineRecording=drift == "H-e")
        add("agent", sa, testId="A", variant="first", fOnBase="pass", inlineRecording=False)
        add("agent", sb, testId="B", variant="first", fOnBase="pass", inlineRecording=False)
    jsonl(out / "matrix.jsonl", rows)
    manifest = {
        "drifts": [
            {"id": "H-a", "requestChanging": False, "fiksTestEmitted": True, "fiksFGate": "failed"},
            {"id": "H-b", "requestChanging": False, "fiksTestEmitted": False, "fiksFGate": "no-test"},
            {"id": "H-c", "requestChanging": False, "fiksTestEmitted": True, "fiksFGate": "passed"},
            {"id": "H-d", "requestChanging": True, "fiksTestEmitted": True, "fiksFGate": "passed"},
            {"id": "H-e", "requestChanging": True, "fiksTestEmitted": True, "fiksFGate": "passed"},
            {"id": "H-f", "requestChanging": False, "fiksTestEmitted": True, "fiksFGate": "passed"},
        ]
    }
    (out / "pool.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    repair_fixtures()
    adequacy_fixtures()
    for name, (per, rule, crit, p01, p005) in CASES.items():
        ents = entities("shop", per) + entities("tracker", per)
        spec = {
            "domain": ["shop", "tracker"],
            "nF": 4 * per,
            "eligibleInputs": [],
            "entities": ents,
            "NE": 2 * per,
            "attribution": {},
            "families": {"shop.get_product/price.range": "price", "shop.search_products/items.price.range": "price"},
            "cells": [],
            "K": 0,
            "entailedProps": ["shop.search_products/total.equalsUpstream"],
            "neRule": rule,
            "crit": crit,
            "power": {"pi01": p01, "pi005": p005},
            "hash": f"synthetic-fixture-{name}",
        }
        (HERE / name).write_text(render(spec), encoding="utf-8")


if __name__ == "__main__":
    main()
