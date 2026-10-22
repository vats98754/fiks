#!/usr/bin/env python3
"""Rebuild every generated table and macro from its logs and diff it (PLAN 9.1, 12 row 1).

  paper/.venv/bin/python paper/scripts/paper_check.py [--root REPO] [--regenerate]

Registry (path relative to --root -> how it is rebuilt):
  paper/results/power.json        `check` = power.py all --check paper/PLAN.md (manifest
                                  paper/scripts/power_manifest.json); `simulatedIut` =
                                  simulate_power.py re-run with the settings recorded in it.
  paper/macros/power.tex          from the rebuilt power check (\\pw{<manifest id>}).
  paper/macros/confirmatory.tex   holm.py macros from paper/results/raw/cp2/{h1,h2,h3h4}.json and
                                  the FrameSpec recorded in the CP2 lock (absent until CP2).
Any other file under paper/macros/ is unregistered, i.e. hand-written, and fails the check; so
does a registered macro file whose source logs are absent.

Exit 0 iff every registered output is byte-identical to its rebuild. --regenerate writes the
rebuilt outputs instead of diffing them.
"""

from __future__ import annotations

import argparse
import difflib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import holm  # noqa: E402
import power  # noqa: E402
import simulate_power  # noqa: E402
from anlib import macros  # noqa: E402
from anlib.io import REPO_ROOT, dumps, read_json, run_main  # noqa: E402

POWER_JSON = "paper/results/power.json"
POWER_TEX = "paper/macros/power.tex"
CONF_TEX = "paper/macros/confirmatory.tex"
CP2_DIR = "paper/results/raw/cp2"
LOCK = "paper/results/confirmatory.lock"


def rebuild(root: Path) -> tuple[dict[str, str | None], list[str]]:
    """Path -> expected bytes (None = must not exist), plus problems found while rebuilding."""
    out: dict[str, str | None] = {}
    problems: list[str] = []
    check = power.check_manifest(
        root / "paper/PLAN.md", root / "paper/scripts/power_manifest.json", root
    )
    pj: dict = {"check": check}
    cur = root / POWER_JSON
    stored = read_json(cur) if cur.is_file() else {}
    for label, sim in sorted((stored.get("simulatedIut") or {}).items()):
        need = ("configs", "ns", "datasets", "seed", "params")
        if not all(k in sim for k in need):
            problems.append(f"{POWER_JSON}: simulatedIut.{label} lacks its settings; cannot rebuild")
            continue
        pj.setdefault("simulatedIut", {})[label] = simulate_power.run(
            sim["configs"], sim["ns"], sim["datasets"], sim["seed"], sim["params"], label
        )
    out[POWER_JSON] = dumps(pj)
    out[POWER_TEX] = power.render_power_tex(check)

    cp2 = root / CP2_DIR
    have = all((cp2 / f).is_file() for f in ("h1.json", "h2.json", "h3h4.json"))
    if have:
        lock = root / LOCK
        frame = None
        if lock.is_file():
            fs = json.loads(lock.read_text(encoding="utf-8")).get("frameSpec")
            if fs is None or not (root / fs).is_file():
                problems.append(f"{LOCK}: names no readable frameSpec; cannot rebuild {CONF_TEX}")
            else:
                frame = read_json(root / fs)
        res = holm.run(read_json(cp2 / "h1.json"), read_json(cp2 / "h2.json"), read_json(cp2 / "h3h4.json"), frame)
        out[CONF_TEX] = macros.render(holm.GEN, holm.macro_values(res))
    else:
        out[CONF_TEX] = None
    return out, problems


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--root", default=str(REPO_ROOT))
    p.add_argument("--regenerate", action="store_true")
    a = p.parse_args(argv)
    root = Path(a.root)
    expected, problems = rebuild(root)
    if a.regenerate:
        for rel, text in expected.items():
            if text is not None:
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                (root / rel).write_text(text, encoding="utf-8")
                print(f"wrote {rel}")
        return 0
    for rel, text in expected.items():
        f = root / rel
        if text is None:
            if f.exists():
                problems.append(f"{rel}: exists but its source logs are absent (hand-written?)")
            continue
        if not f.is_file():
            problems.append(f"{rel}: missing (run paper_check.py --regenerate)")
            continue
        cur = f.read_text(encoding="utf-8")
        if cur != text:
            diff = "".join(
                list(difflib.unified_diff(text.splitlines(True), cur.splitlines(True), "rebuilt", "committed"))[:20]
            )
            problems.append(f"{rel}: differs from its rebuild (hand edit or stale output)\n{diff}")
    mdir = root / "paper/macros"
    if mdir.is_dir():
        for f in sorted(mdir.iterdir()):
            rel = f.relative_to(root).as_posix()
            if f.is_file() and rel not in expected:
                problems.append(f"{rel}: not produced by any registered generator (hand-written?)")
    for pr in problems:
        print(f"FAIL {pr}")
    print("paper:check " + ("PASS" if not problems else f"FAIL ({len(problems)} problems)"))
    return 0 if not problems else 1


if __name__ == "__main__":
    run_main(main)
