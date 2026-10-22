"""The CP2 lock (PLAN 8.1 CP2, 9.1 cp2_lock.py).

`paper/results/confirmatory.lock` is written once by `cp2_lock.py` at CP2 and committed by
the run step. Every exploratory script refuses to run without it. Builder tests create a lock
only under $TMPDIR and pass it with --lock.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .io import DEFAULT_LOCK

LOCK_KIND = "fiks-cp2-lock"


def add_lock_arg(parser) -> None:
    parser.add_argument(
        "--lock",
        default=str(DEFAULT_LOCK),
        help="confirmatory lock written by cp2_lock.py (default: paper/results/confirmatory.lock)",
    )


def require_lock(path: str | Path) -> dict:
    """Exit 3 unless a valid CP2 lock exists at `path`."""
    p = Path(path)
    if not p.is_file():
        print(
            f"refusing to run: {p} is absent. Exploratory scripts run only after CP2 "
            "(cp2_lock.py writes the lock once the confirmatory analysis is done).",
            file=sys.stderr,
        )
        sys.exit(3)
    try:
        lock = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print(f"refusing to run: {p} is not a valid CP2 lock (invalid JSON)", file=sys.stderr)
        sys.exit(3)
    if not isinstance(lock, dict) or lock.get("kind") != LOCK_KIND or "outputs" not in lock:
        print(f"refusing to run: {p} is not a valid CP2 lock (kind != {LOCK_KIND})", file=sys.stderr)
        sys.exit(3)
    return lock
