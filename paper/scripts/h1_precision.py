#!/usr/bin/env python3
"""H1: trigger precision on frame F, entity-level exact test (PLAN 3.1, 4 D11/D12, 9.1).

Inputs
  --frame-spec  FrameSpec (F4b): entities[{id, domain, authorBatch, eligible}], NE,
                eligibleInputs[], attribution{inputId -> {concrete path -> originUnit}},
                families{property -> family}, cells[], K, entailedProps[], neRule{m}.
  --rows        per-element DetectorVerdictRows (MON `replay-cli --per-element`, JSONL). The
                input id of a row is `inputId` if present, else `callId`. Every `violated` row
                must carry `at` (the concrete element path) and, when `at` indexes an array
                element, the matching `elementIndex`. First-element-only (receipt-level) rows,
                whose `at` is null, are refused: exit 2, "per-element rows required".
  --input-strata  optional {inputId -> stratum} for per-stratum census shares (D12).
  --nonattributable  optional DET nonattributable.jsonl (D12 round-6 row).
  --sdev        optional S-dev DetectorVerdictRows (D11 counts).

Computation
  Each violating element is attributed to its own origin unit: FrameSpec.attribution[input][at],
  else the row's originUnit (both present and different: exit 2). Z_e = 1 iff >= 1 FP is
  attributed to eligible entity e on any FP-eligible input under any FP-capable property;
  X = sum Z_e over the N_E eligible entities. Origin units that are not entities (S-grid
  queries: collection-level properties) enter only the census share and D12. Entailed
  properties are a sanity count, never an FP.
  p_E = P(Bin(N_E, 0.02) <= X); p_H1 = p_E if the census share < 0.01 else 1. If the F4b N_E
  rule set m = 3 (N_E < 217), H1 is descriptive and does not enter Holm (enters_holm = false).
  Robustness: one-sided 98.75% percentile upper bound on pi from a bootstrap that resamples
  authorBatch clusters (10,000 resamples, seeded) [field2007clusterboot].
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from scipy.stats import binom

sys.path.insert(0, str(Path(__file__).resolve().parent))

from anlib import stats  # noqa: E402
from anlib.io import InputError, read_json, read_records, require, run_main, write_json  # noqa: E402

P0 = 0.02
ALPHA = 0.0125
CENSUS_LIMIT = 0.01
ELEM_RE = re.compile(r"\[(\d+)\]")
DEFAULT_PROVENANCE = {"shop": "shop-hand", "tracker": "tracker-agent"}


def input_id(row: dict) -> str:
    return str(row.get("inputId") or row["callId"])


def check_per_element(violated: list[dict]) -> None:
    for r in violated:
        at = r.get("at")
        if at is None:
            raise InputError(
                "per-element rows required: a violated row has no `at` (first-element-only receipt "
                f"rows; run MON replay-cli --per-element). Row: callId={r.get('callId')} "
                f"property={r.get('property')}"
            )
        idx = ELEM_RE.findall(at)
        ei = r.get("elementIndex")
        if idx and ei is None:
            raise InputError(f"per-element rows required: row at {at!r} has no elementIndex")
        if ei is not None and (not idx or int(idx[-1]) != int(ei)):
            raise InputError(f"row at {at!r} has elementIndex {ei}, which is not its element index")


def batch_bootstrap_upper(z_by_batch: dict[str, list[int]], boot: int, seed: int, q: float) -> float:
    batches = sorted(z_by_batch)
    if not batches:
        return float("nan")
    sums = np.array([sum(z_by_batch[b]) for b in batches], dtype=np.float64)
    cnts = np.array([len(z_by_batch[b]) for b in batches], dtype=np.float64)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(batches), size=(boot, len(batches)))
    pis = sums[idx].sum(axis=1) / cnts[idx].sum(axis=1)
    return float(np.quantile(pis, q))


def analyse(
    spec: dict,
    rows: list[dict],
    input_strata: dict | None = None,
    nonattributable: list[dict] | None = None,
    sdev: list[dict] | None = None,
    detector: str | None = None,
    provenance: dict | None = None,
    boot: int = 10_000,
    seed: int = 20261021,
) -> dict:
    provenance = provenance or DEFAULT_PROVENANCE
    ents = {e["id"]: e for e in spec["entities"]}
    eligible = {i for i, e in ents.items() if e.get("eligible")}
    ne = spec["NE"]
    require(ne == len(eligible), f"FrameSpec.NE = {ne} but {len(eligible)} entities are eligible")
    inputs = list(dict.fromkeys(spec.get("eligibleInputs", [])))
    input_set = set(inputs)
    attribution = spec.get("attribution", {})
    families = spec.get("families", {})
    entailed = set(spec.get("entailedProps", []))
    m = (spec.get("neRule") or {}).get("m") or (3 if ne < stats.binom_min_n(P0, ALPHA) else 4)

    if detector:
        rows = [r for r in rows if r.get("detector") == detector]
    violated = [r for r in rows if r.get("verdict") == "violated"]
    check_per_element(violated)

    seen = set()
    z: dict[str, int] = {e: 0 for e in eligible}
    fp_inputs: set[str] = set()
    fp_inputs_by_stratum: dict[str, set[str]] = defaultdict(set)
    collection = Counter()
    sources: set[tuple[str, str]] = set()
    cells_hit: set[tuple[str, str]] = set()
    sanity = Counter()
    outside = 0
    elements = 0
    for r in violated:
        inp = input_id(r)
        key = (inp, r.get("property"), r["at"])
        if key in seen:
            continue
        seen.add(key)
        if inp not in input_set:
            outside += 1
            continue
        prop = r.get("property")
        require(isinstance(prop, str), f"violated row without property on {inp}")
        if prop in entailed:
            sanity[prop] += 1
            continue
        require(prop in families, f"property {prop} is neither FP-capable (families) nor entailed")
        a_unit = (attribution.get(inp) or {}).get(r["at"])
        r_unit = r.get("originUnit")
        if a_unit is not None and r_unit not in (None, "", a_unit):
            raise InputError(f"{inp} {r['at']}: attribution says {a_unit}, row says {r_unit}")
        unit = a_unit or r_unit
        require(unit, f"{inp} {r['at']}: no origin unit")
        elements += 1
        fp_inputs.add(inp)
        fp_inputs_by_stratum[str(r.get("stratum") or (input_strata or {}).get(inp) or "unknown")].add(inp)
        sources.add((unit, families[prop]))
        cells_hit.add((prop, str(r.get("entityClass") or "")))
        if unit in ents:
            require(unit in eligible, f"FP attributed to ineligible entity {unit} on {inp}")
            z[unit] = 1
        else:
            collection[unit] += 1

    x = sum(z.values())
    p_e = float(binom.cdf(x, ne, P0)) if ne > 0 else 1.0
    census = len(fp_inputs) / len(inputs) if inputs else float("nan")
    p_h1 = p_e if census < CENSUS_LIMIT else 1.0
    crit = stats.binom_crit(ne, P0, ALPHA) if ne > 0 else -1

    z_by_batch: dict[str, list[int]] = defaultdict(list)
    for e in sorted(eligible):
        z_by_batch[ents[e]["authorBatch"]].append(z[e])
    upper = batch_bootstrap_upper(z_by_batch, boot, seed, 1 - ALPHA)

    def interval(k: int, n: int) -> dict:
        return {
            "k": k,
            "n": n,
            "rate": k / n if n else None,
            "cp95": stats.clopper_pearson(k, n, 0.95),
            "wilson95": stats.wilson(k, n, 0.95),
        }

    per_domain: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for e in eligible:
        d = ents[e]["domain"]
        per_domain[d][0] += z[e]
        per_domain[d][1] += 1
    per_prov: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for d, (k, n) in per_domain.items():
        pv = provenance.get(d, d)
        per_prov[pv][0] += k
        per_prov[pv][1] += n

    strata_den = Counter((input_strata or {}).get(i, "unknown") for i in inputs) if input_strata else None
    d12 = {
        "inputFpShare": census,
        "fpInputs": len(fp_inputs),
        "eligibleInputs": len(inputs),
        "fpInputsByStratum": {
            s: {"fp": len(v), "inputs": (strata_den or {}).get(s)} for s, v in sorted(fp_inputs_by_stratum.items())
        },
        "collectionLevelFpsByQuery": dict(sorted(collection.items())),
        "cellsWithFp": len(cells_hit),
        "K": spec.get("K"),
        "fpSources": len(sources),
        "fpElements": elements,
    }
    if nonattributable is not None:
        per_drift = Counter(r.get("drift") for r in nonattributable)
        d12["nonAttributable"] = {
            "rows": len(nonattributable),
            "byDrift": dict(sorted((str(k), v) for k, v in per_drift.items())),
            "byProperty": dict(sorted(Counter(str(r.get("property")) for r in nonattributable).items())),
            "byEntity": dict(sorted(Counter(str(r.get("originUnit")) for r in nonattributable).items())),
            "driftsWithAny": len(per_drift),
        }
    out = {
        "NE": ne,
        "X": x,
        "Z": {e: z[e] for e in sorted(eligible)},
        "p0": P0,
        "pE": p_e,
        "crit": crit,
        "censusShare": census,
        "censusOk": census < CENSUS_LIMIT,
        "pH1": p_h1,
        "m": m,
        "entersHolm": m == 4,
        "batchBootstrapUpper9875": upper,
        "robustToBatches": bool(upper < P0),
        "overall": interval(x, ne),
        "cp975Lower": stats.clopper_pearson(x, ne, 0.95)[0],
        "perDomain": {d: interval(k, n) for d, (k, n) in sorted(per_domain.items())},
        "perProvenance": {pv: interval(k, n) for pv, (k, n) in sorted(per_prov.items())},
        "entailedSanity": dict(sorted(sanity.items())),
        "rowsOutsideFrame": outside,
        "D12": d12,
    }
    if sdev is not None:
        sv = [r for r in sdev if r.get("verdict") == "violated"]
        out["D11"] = {"violations": len(sv), "byProperty": dict(sorted(Counter(str(r.get("property")) for r in sv).items()))}
    return out


def parse_provenance(s: str | None) -> dict | None:
    if not s:
        return None
    return dict(kv.split("=", 1) for kv in s.split(","))


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--frame-spec", required=True)
    p.add_argument("--rows", required=True)
    p.add_argument("--input-strata")
    p.add_argument("--nonattributable")
    p.add_argument("--sdev")
    p.add_argument("--detector")
    p.add_argument("--provenance", help="domain=label,... (default shop=shop-hand,tracker=tracker-agent)")
    p.add_argument("--boot", type=int, default=10_000)
    p.add_argument("--seed", type=int, default=20261021)
    p.add_argument("--out")
    a = p.parse_args(argv)
    res = analyse(
        read_json(a.frame_spec),
        read_records(a.rows),
        read_json(a.input_strata) if a.input_strata else None,
        read_records(a.nonattributable) if a.nonattributable else None,
        read_records(a.sdev) if a.sdev else None,
        a.detector,
        parse_provenance(a.provenance),
        a.boot,
        a.seed,
    )
    if a.out:
        write_json(a.out, res)
    print(
        f"N_E {res['NE']}  X {res['X']}  p_E {res['pE']:.4g}  census share {res['censusShare']:.4f}  "
        f"p_H1 {res['pH1']:.4g}  m {res['m']}  batch-bootstrap upper {res['batchBootstrapUpper9875']:.4f}"
    )
    return 0


if __name__ == "__main__":
    run_main(main)
