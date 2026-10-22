"""JSON / JSONL input and deterministic output."""

from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any, Iterable

# paper/scripts/anlib/io.py -> repo root is three levels above paper/scripts.
SCRIPTS_DIR = Path(__file__).resolve().parents[1]
PAPER_DIR = SCRIPTS_DIR.parent
REPO_ROOT = PAPER_DIR.parent
RESULTS_DIR = PAPER_DIR / "results"
RAW_DIR = RESULTS_DIR / "raw"
MACROS_DIR = PAPER_DIR / "macros"
DEFAULT_LOCK = RESULTS_DIR / "confirmatory.lock"


class InputError(Exception):
    """Malformed or inconsistent input. Scripts turn it into exit code 2."""


def read_json(path: str | Path) -> Any:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError as e:
        raise InputError(f"missing input file: {path}") from e
    except json.JSONDecodeError as e:
        raise InputError(f"{path}: invalid JSON: {e}") from e


def read_jsonl(path: str | Path) -> list[dict]:
    rows: list[dict] = []
    try:
        with open(path, encoding="utf-8") as f:
            for i, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError as e:
                    raise InputError(f"{path}:{i}: invalid JSON: {e}") from e
    except FileNotFoundError as e:
        raise InputError(f"missing input file: {path}") from e
    return rows


def read_records(path: str | Path) -> list[dict]:
    """A .jsonl file, or a .json file holding a list."""
    p = Path(path)
    if p.suffix == ".jsonl":
        return read_jsonl(p)
    data = read_json(p)
    if not isinstance(data, list):
        raise InputError(f"{path}: expected a JSON list")
    return data


def _clean(x: Any) -> Any:
    """Round floats to 12 significant digits so outputs do not depend on the last ulp."""
    if type(x).__module__ == "numpy" and hasattr(x, "item"):
        x = x.item()  # numpy scalar -> Python bool / int / float
    if isinstance(x, bool):
        return x
    if isinstance(x, float):
        if math.isnan(x) or math.isinf(x):
            return None
        return float(f"{x:.12g}")
    if isinstance(x, dict):
        return {str(k): _clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_clean(v) for v in x]
    return x


LINE_WIDTH = 110  # biome.json formatter.lineWidth: committed JSON outputs must pass `pnpm lint`


def _ser(x: Any, indent: int, col: int) -> str:
    """JSON in the layout biome's formatter produces: objects expanded, scalar arrays on one line
    when they fit in LINE_WIDTH, keys sorted."""
    pad = " " * (indent + 2)
    if isinstance(x, dict):
        if not x:
            return "{}"
        items = []
        for k in sorted(x):
            head = f"{pad}{json.dumps(k, ensure_ascii=False)}: "
            items.append(head + _ser(x[k], indent + 2, len(head)))
        return "{\n" + ",\n".join(items) + "\n" + " " * indent + "}"
    if isinstance(x, list):
        if not x:
            return "[]"
        if all(not isinstance(v, (dict, list)) for v in x):
            one = "[" + ", ".join(json.dumps(v, ensure_ascii=False) for v in x) + "]"
            if col + len(one) + 1 <= LINE_WIDTH:
                return one
        items = [pad + _ser(v, indent + 2, len(pad)) for v in x]
        return "[\n" + ",\n".join(items) + "\n" + " " * indent + "]"
    return json.dumps(x, ensure_ascii=False)


def dumps(obj: Any) -> str:
    return _ser(_clean(obj), 0, 0) + "\n"


def write_json(path: str | Path, obj: Any) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(dumps(obj), encoding="utf-8")


def write_text(path: str | Path, text: str) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def require(cond: bool, msg: str) -> None:
    if not cond:
        raise InputError(msg)


def run_main(main, argv: Iterable[str] | None = None) -> None:
    """Run a script's main(argv) -> int, mapping InputError to exit 2."""
    try:
        code = main(list(argv) if argv is not None else sys.argv[1:])
    except InputError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(2)
    sys.exit(code or 0)
