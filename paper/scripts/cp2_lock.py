#!/usr/bin/env python3
"""CP2: run the confirmatory analysis once and write the lock (PLAN 8.1 CP2, 9.1).

Runs, in order, on complete data: classify_outcome -> h1_precision -> h2_adequacy ->
h3h4_repair -> holm, writes their outputs to --out-dir (default paper/results/raw/cp2) and the
macros to --macros (default paper/macros/confirmatory.tex), then writes the lock
(default paper/results/confirmatory.lock) with the sha256 of every input, output and script.
It refuses to run if the lock already exists: CP2 runs once. Exploratory scripts refuse to run
without the lock. The run step (not a builder) commits the outputs and the lock; builder tests
pass --lock and --out-dir under $TMPDIR.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import classify_outcome  # noqa: E402
import h1_precision  # noqa: E402
import h2_adequacy  # noqa: E402
import h3h4_repair  # noqa: E402
import holm  # noqa: E402
from anlib import macros  # noqa: E402
from anlib.io import (  # noqa: E402
    DEFAULT_LOCK,
    MACROS_DIR,
    RAW_DIR,
    REPO_ROOT,
    SCRIPTS_DIR,
    read_json,
    read_records,
    run_main,
    sha256_file,
    write_json,
    write_text,
)
from anlib.lock import LOCK_KIND  # noqa: E402

SCRIPTS = ["classify_outcome.py", "h1_precision.py", "h2_adequacy.py", "h3h4_repair.py", "holm.py", "cp2_lock.py"]


def rel(p: str | Path) -> str:
    rp = Path(p).resolve()
    try:
        return str(rp.relative_to(REPO_ROOT))
    except ValueError:
        return str(rp)


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--frame-spec", required=True)
    p.add_argument("--h1-rows", required=True, help="per-element DetectorVerdictRows on F (R2)")
    p.add_argument("--input-strata")
    p.add_argument("--nonattributable")
    p.add_argument("--sdev")
    p.add_argument("--matrix", required=True, help="H2 acceptance matrix (R5)")
    p.add_argument("--h2-pool", required=True, help="H2 pool manifest (F10)")
    p.add_argument("--attempts", required=True, help="R4 AttemptRecords")
    p.add_argument("--grades", required=True, help="R5 GradeRecords")
    p.add_argument("--repair-pool", required=True, help="drift manifest with requestChanging (F10)")
    p.add_argument("--ni-method", choices=["sign-flip", "bootstrap-t"], default="sign-flip")
    p.add_argument("--flips", type=int, default=200_000)
    p.add_argument("--out-dir", default=str(RAW_DIR / "cp2"))
    p.add_argument("--macros", default=str(MACROS_DIR / "confirmatory.tex"))
    p.add_argument("--lock", default=str(DEFAULT_LOCK))
    a = p.parse_args(argv)
    lock = Path(a.lock)
    if lock.exists():
        print(f"refusing: {lock} exists; CP2 runs once (a re-run is a deviation, PLAN 9.5)", file=sys.stderr)
        return 1
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    classified = classify_outcome.classify_all(read_records(a.attempts), read_records(a.grades))
    cls_path = out / "classified.jsonl"
    cls_path.write_text("".join(json.dumps(r, sort_keys=True) + "\n" for r in classified), encoding="utf-8")

    frame = read_json(a.frame_spec)
    h1 = h1_precision.analyse(
        frame,
        read_records(a.h1_rows),
        read_json(a.input_strata) if a.input_strata else None,
        read_records(a.nonattributable) if a.nonattributable else None,
        read_records(a.sdev) if a.sdev else None,
    )
    write_json(out / "h1.json", h1)
    h2 = h2_adequacy.analyse(read_records(a.matrix), read_json(a.h2_pool), a.flips)
    write_json(out / "h2.json", h2)
    h34, _ = h3h4_repair.analyse(classified, read_json(a.repair_pool), flips=a.flips, ni_method=a.ni_method)
    write_json(out / "h3h4.json", h34)
    hol = holm.run(h1, h2, h34, frame)
    write_json(out / "holm.json", hol)
    write_text(a.macros, macros.render(holm.GEN, holm.macro_values(hol)))

    inputs = [a.frame_spec, a.h1_rows, a.matrix, a.h2_pool, a.attempts, a.grades, a.repair_pool]
    inputs += [x for x in (a.input_strata, a.nonattributable, a.sdev) if x]
    outputs = [cls_path, out / "h1.json", out / "h2.json", out / "h3h4.json", out / "holm.json", Path(a.macros)]
    record = {
        "kind": LOCK_KIND,
        "frameSpec": rel(a.frame_spec),
        "niMethod": a.ni_method,
        "flips": a.flips,
        "inputs": {rel(x): sha256_file(x) for x in inputs},
        "outputs": {rel(x): sha256_file(x) for x in outputs},
        "scripts": {s: sha256_file(SCRIPTS_DIR / s) for s in SCRIPTS},
    }
    lock.parent.mkdir(parents=True, exist_ok=True)
    with open(lock, "x", encoding="utf-8") as f:
        f.write(json.dumps(record, indent=2, sort_keys=True) + "\n")
    print(f"CP2 done: m = {hol['m']}; " + ", ".join(
        f"{h} {'rejected' if e['rejected'] else 'not rejected'}" for h, e in sorted(hol["holm"].items())
    ))
    print(f"lock written: {rel(lock)} ({os.path.getsize(lock)} bytes)")
    return 0


if __name__ == "__main__":
    run_main(main)
