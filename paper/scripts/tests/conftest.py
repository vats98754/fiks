"""Shared test helpers. Tests write only under pytest's tmp_path ($TMPDIR); a session check
asserts that paper/results/raw and paper/results/confirmatory.lock are untouched."""

from __future__ import annotations

import contextlib
import importlib
import io
import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1]
REPO = SCRIPTS.parents[1]
FIXTURES = SCRIPTS / "fixtures"
sys.path.insert(0, str(SCRIPTS))

RESERVED = [REPO / "paper/results/raw", REPO / "paper/results/confirmatory.lock"]


def _snapshot() -> dict:
    snap = {}
    for p in RESERVED:
        if p.is_file():
            snap[str(p)] = p.stat().st_mtime_ns
        elif p.is_dir():
            snap[str(p)] = sorted((str(f), f.stat().st_mtime_ns) for f in p.rglob("*"))
        else:
            snap[str(p)] = None
    return snap


@pytest.fixture(scope="session", autouse=True)
def reserved_paths_untouched():
    before = _snapshot()
    yield
    assert _snapshot() == before, "the test suite wrote to paper/results/raw or confirmatory.lock"


def run_subprocess(script: str, *args: str, check: bool | None = None) -> subprocess.CompletedProcess:
    """Run a script exactly as the acceptance commands do (a fresh interpreter)."""
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / script), *map(str, args)],
        capture_output=True,
        text=True,
        cwd=REPO,
        check=False,
    )
    if check:
        assert proc.returncode == 0, proc.stdout + proc.stderr
    return proc


def run(script: str, *args: str, check: bool | None = None) -> subprocess.CompletedProcess:
    """Run a script's main() in-process (same exit-code mapping as run_main: InputError -> 2)."""
    from anlib.io import InputError

    mod = importlib.import_module(script.removesuffix(".py"))
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            code = mod.main([str(a) for a in args]) or 0
        except InputError as e:
            print(f"error: {e}", file=sys.stderr)
            code = 2
        except SystemExit as e:
            code = e.code if isinstance(e.code, int) else 1
    proc = subprocess.CompletedProcess([script, *args], code, out.getvalue(), err.getvalue())
    if check:
        assert proc.returncode == 0, proc.stdout + proc.stderr
    return proc


def run_json(script: str, *args: str) -> dict:
    proc = run(script, *args, "--json", check=True)
    return json.loads(proc.stdout)


def write_jsonl(path: Path, rows: list[dict]) -> Path:
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    return path
