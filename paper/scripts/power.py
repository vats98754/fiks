#!/usr/bin/env python3
"""Power numbers of the pre-registration (PLAN 3, 9.1, 9.6).

Subcommands
  mde        wraps paper-forge eval_stats.py mde (MDE at n, or n for a target MDE); the value
             is also recomputed here and the two must agree at eval_stats' 4 printed decimals.
  binom      exact one-sided binomial test of H0: pi >= p0: crit, exact size, power at p1...
  binom-min  smallest N_E at which the exact test can reject at all ((1 - p0)^N <= alpha).
  anyfp      1 - (1 - pi)^n: P(>= 1 FP entity in an n-entity sample) (PLAN 3.0, round 6).
  floor      sampling floor of sigma_d: sqrt(2 * 0.25 / (m * a)) (PLAN 3.3, round 7).
  ni         NI power Phi((delta + theta) sqrt(n) / sd - z_{1-alpha}) at true difference theta <= 0.
  harm       harm power Phi(effect sqrt(n) / sd - z_{1-alpha/2}).
  frame      the N_E rule (PLAN 3.1) on a FrameSpec: top-up flag, crit, power, underpowered, m.
  all        --check PLAN.md: every entry of power_manifest.json (= PLAN 9.6 manifest) against
             its printed value at its printed precision; writes paper/results/power.json
             (`check`) and paper/macros/power.tex (\\pw{<manifest id>}).

Every subcommand takes --json to print its result as JSON.
"""

from __future__ import annotations

import argparse
import functools
import json
import math
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from anlib import macros, stats  # noqa: E402
from anlib.io import (  # noqa: E402
    MACROS_DIR,
    REPO_ROOT,
    RESULTS_DIR,
    SCRIPTS_DIR,
    InputError,
    read_json,
    require,
    run_main,
    write_json,
    write_text,
)

DEFAULT_EVAL_STATS = (
    "/Users/anvayvats/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/"
    "30ec47c0-4bbb-4711-85d7-569760cac2dd/ef7e729b-bc9c-44e1-9b2a-7a42d9a71991/skills/paper-forge/"
    "scripts/eval_stats.py"
)
MANIFEST = SCRIPTS_DIR / "power_manifest.json"
POWER_JSON = RESULTS_DIR / "power.json"
POWER_TEX = MACROS_DIR / "power.tex"
MACRO_GEN = "paper/scripts/power.py all --check paper/PLAN.md"

# PLAN 3.1 N_E rule constants.
NE_TARGET_TOTAL = 1500
NE_TARGET_DOMAIN = 750
NE_CAP_DOMAIN = 1000
BATCH_SIZE = 25
H1_P0 = 0.02
H1_ALPHA = 0.0125


def g(x: float) -> str:
    """Canonical short form of a CLI float, used in result keys (0.10 -> '0.1')."""
    return f"{x:g}"


def eval_stats_path() -> Path:
    return Path(os.environ.get("PAPER_FORGE_EVAL_STATS", DEFAULT_EVAL_STATS))


# ----------------------------------------------------------------------------- subcommands
@functools.lru_cache(maxsize=None)
def _eval_stats(argv: tuple[str, ...]) -> tuple[int, str, str]:
    proc = subprocess.run(list(argv), capture_output=True, text=True, check=False)
    return proc.returncode, proc.stdout, proc.stderr


def cmd_mde(a) -> dict:
    path = eval_stats_path()
    require(path.is_file(), f"eval_stats.py not found at {path} (set PAPER_FORGE_EVAL_STATS)")
    require(a.sd_diff is not None, "mde needs --sd-diff")
    argv = [sys.executable, str(path), "mde", "--sd-diff", repr(a.sd_diff), "--alpha", repr(a.alpha)]
    argv += ["--power", repr(a.power)]
    if a.n is not None:
        argv += ["--n", str(a.n)]
    if a.target is not None:
        argv += ["--target", repr(a.target)]
    code, stdout, stderr = _eval_stats(tuple(argv))
    require(code == 0, f"eval_stats.py mde failed: {stderr.strip()}")
    out: dict = {"eval_stats": str(path), "eval_stats_stdout": stdout.strip().splitlines()}
    za = stats.norm.ppf(1 - a.alpha / 2) + stats.norm.ppf(a.power)
    if a.n is not None:
        m = re.search(r"MDE with n=\d+: ([0-9.]+)", stdout)
        require(m is not None, f"cannot parse eval_stats output: {stdout!r}")
        mde = stats.mde(a.n, a.sd_diff, a.alpha, a.power)
        printed = m.group(1)
        require(
            f"{mde:.4f}" == printed,
            f"eval_stats MDE {printed} != recomputed {mde:.6f} (n={a.n}, sd={a.sd_diff})",
        )
        out.update({"n": a.n, "mde": mde, "mde_eval_stats": printed})
    if a.target is not None:
        m = re.search(r"n >= (\d+)", stdout)
        require(m is not None, f"cannot parse eval_stats output: {stdout!r}")
        n_req = int(m.group(1))
        mine = math.ceil((za * a.sd_diff / a.target) ** 2)
        require(n_req == mine, f"eval_stats n {n_req} != recomputed {mine}")
        out.update({"target": a.target, "n_required": n_req})
    return out


def binom_result(n: int, p0: float, alpha: float, p1s: list[float]) -> dict:
    crit = stats.binom_crit(n, p0, alpha)
    return {
        "n": n,
        "p0": p0,
        "alpha": alpha,
        "crit": crit,
        "size": stats.binom_size(n, p0, crit),
        "power": {g(p): stats.binom_power(n, p, crit) for p in p1s},
    }


def cmd_binom(a) -> dict:
    return binom_result(a.n, a.p0, a.alpha, a.p1 or [])


def cmd_binom_min(a) -> dict:
    n = stats.binom_min_n(a.p0, a.alpha)
    return {"p0": a.p0, "alpha": a.alpha, "min_n": n}


def cmd_anyfp(a) -> dict:
    return {"n": a.n, "anyfp": {g(p): 1 - (1 - p) ** a.n for p in a.pi}}


def cmd_floor(a) -> dict:
    return {"p": a.p, "floor": {str(ma): stats.sd_floor(ma, a.p) for ma in a.ma}}


def cmd_ni(a) -> dict:
    res = {}
    for theta in a.theta:
        require(theta <= 0, f"--theta must be <= 0 (a true difference not favouring FIKS): {theta}")
        for sd in a.sd_diff:
            for n in a.n:
                res[f"sd={g(sd)},n={n},theta={g(theta)}"] = stats.ni_power(n, sd, a.delta, a.alpha, theta)
    return {"delta": a.delta, "alpha": a.alpha, "power": res}


def cmd_harm(a) -> dict:
    res = {}
    for eff in a.effect:
        for sd in a.sd_diff:
            for n in a.n:
                res[f"sd={g(sd)},n={n},effect={g(eff)}"] = stats.harm_power(n, sd, eff, a.alpha)
    return {"alpha": a.alpha, "power": res}


def ne_rule(spec: dict, p0: float = H1_P0, alpha: float = H1_ALPHA) -> dict:
    """PLAN 3.1 N_E rule, applied at F4b on the frame's eligible entities (no verdicts)."""
    ents = spec.get("entities")
    require(isinstance(ents, list), "FrameSpec.entities must be a list")
    domains = list(spec.get("domain") or [])
    require(domains, "FrameSpec.domain must list the domains")
    per_domain = {d: 0 for d in domains}
    for e in ents:
        require(e.get("domain") in per_domain, f"entity {e.get('id')} has unknown domain {e.get('domain')}")
        require("authorBatch" in e, f"entity {e.get('id')} has no authorBatch")
        if e.get("eligible"):
            per_domain[e["domain"]] += 1
    ne = sum(per_domain.values())
    require(spec.get("NE") == ne, f"FrameSpec.NE = {spec.get('NE')} but {ne} entities are eligible")
    deficient = {d: c for d, c in per_domain.items() if c < NE_TARGET_DOMAIN}
    top_up = ne < NE_TARGET_TOTAL or bool(deficient)
    batches = {
        d: math.ceil((min(NE_TARGET_DOMAIN, NE_CAP_DOMAIN) - c) / BATCH_SIZE) for d, c in deficient.items()
    }
    crit = stats.binom_crit(ne, p0, alpha)
    p01 = stats.binom_power(ne, 0.01, crit)
    p005 = stats.binom_power(ne, 0.005, crit)
    m = 3 if ne < stats.binom_min_n(p0, alpha) else 4
    return {
        "NE": ne,
        "perDomain": per_domain,
        "topUpRequired": top_up,
        "topUpBatchesByDomain": batches,
        "topUpBatches": sum(batches.values()),
        "crit": crit,
        "size": stats.binom_size(ne, p0, crit),
        "canReject": crit >= 0,
        "power": {"pi01": p01, "pi005": p005},
        "underpowered": p01 < 0.50,
        "m": m,
        "h1": "descriptive" if m == 3 else "confirmatory",
    }


def cmd_frame(a) -> dict:
    spec = read_json(a.frame_spec)
    res = ne_rule(spec, a.p0, a.alpha)
    mism = []
    rec = spec.get("neRule") or {}
    for k_spec, k_res in (("topUpBatches", "topUpBatches"), ("underpowered", "underpowered"), ("m", "m")):
        if k_spec in rec and rec[k_spec] != res[k_res]:
            mism.append(f"neRule.{k_spec}: spec {rec[k_spec]} != computed {res[k_res]}")
    if "crit" in spec and spec["crit"] != res["crit"]:
        mism.append(f"crit: spec {spec['crit']} != computed {res['crit']}")
    for k in ("pi01", "pi005"):
        v = (spec.get("power") or {}).get(k)
        if v is not None and abs(v - res["power"][k]) > 5e-7:
            mism.append(f"power.{k}: spec {v} != computed {res['power'][k]:.6f}")
    res["specMismatches"] = mism
    return res


# ----------------------------------------------------------------------------- printing
def fmt_power(v: float) -> str:
    return ">= 0.99" if v >= 0.99 else f"{v:.3f}"


def print_human(cmd: str, r: dict) -> None:
    if cmd == "mde":
        for line in r["eval_stats_stdout"]:
            print(f"eval_stats: {line}")
        if "mde" in r:
            print(f"MDE {r['mde_eval_stats']} (unrounded {r['mde']:.6f})")
        if "n_required" in r:
            print(f"n required {r['n_required']}")
    elif cmd == "binom":
        print(f"n {r['n']}  p0 {g(r['p0'])}  alpha {g(r['alpha'])}")
        print(f"crit {r['crit']}" + ("" if r["crit"] >= 0 else " (the test cannot reject at this n)"))
        print(f"exact size {r['size']:.4f} ({r['size']:.6f})")
        for p, v in r["power"].items():
            print(f"power at pi = {p}: {fmt_power(v)} ({v:.6f})")
    elif cmd == "binom-min":
        print(r["min_n"])
    elif cmd == "anyfp":
        print(" ".join(f"{v:.3f}" for v in r["anyfp"].values()))
    elif cmd == "floor":
        for ma, v in r["floor"].items():
            print(f"m*a = {ma}: {v:.3f} ({v:.6f})")
    elif cmd in ("ni", "harm"):
        for k, v in r["power"].items():
            print(f"{k}: {v:.3f} ({v:.6f})")
    elif cmd == "frame":
        print(f"N_E {r['NE']} {r['perDomain']}")
        print(
            f"top-up required: {r['topUpRequired']} (batches of {BATCH_SIZE}: {r['topUpBatchesByDomain']})"
        )
        print(f"crit {r['crit']}  exact size {r['size']:.4f}  canReject {r['canReject']}")
        print(f"power pi=0.01 {r['power']['pi01']:.3f}  pi=0.005 {fmt_power(r['power']['pi005'])}")
        print(f"underpowered {r['underpowered']}  m {r['m']}  H1 {r['h1']}")
        for m in r["specMismatches"]:
            print(f"MISMATCH {m}")


# ----------------------------------------------------------------------------- manifest check
SECTION_RE = re.compile(r"^#{2,3} (\d+(?:\.\d+)*)\.? ")
TAGGED_RE = re.compile(r"([≥≤]\s?)?(\d[\d,]*(?:\.\d+)?)\s?[†‡★]")
PAREN_TAG_RE = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s?\([^()]*\)[†‡★]")


def plan_sections(plan_text: str) -> dict[str, str]:
    """Section number -> its own text (up to the next heading of level 2 or 3)."""
    out: dict[str, list[str]] = {}
    cur = None
    for line in plan_text.splitlines():
        m = SECTION_RE.match(line)
        if m:
            cur = m.group(1)
            out.setdefault(cur, [])
            continue
        if line.startswith("## ") or line.startswith("### "):
            cur = None
            continue
        if cur is not None:
            out[cur].append(line)
    return {k: "\n".join(v) for k, v in out.items()}


def num(s: str) -> float:
    return float(s.replace(",", ""))


def tagged_numbers(text: str) -> list[tuple[str, float]]:
    """(printed, value) of every number carrying a dagger, double dagger or star, including the
    'v (qualifier)★' form, where the tag follows a parenthetical qualifier of v."""
    out = [((m.group(1) or "") + m.group(2), num(m.group(2))) for m in TAGGED_RE.finditer(text)]
    out += [(m.group(1), num(m.group(1))) for m in PAREN_TAG_RE.finditer(text)]
    return out


def contains_number(text: str, printed: str) -> bool:
    core = printed.replace("≥", "").replace("≤", "").strip()
    variants = {core, f"{int(num(core)):,}"} if re.fullmatch(r"[\d,]+", core) else {core}
    return any(re.search(rf"(?<![\d.,]){re.escape(v)}(?![\d])", text) for v in variants)


def manifest_table_rows(sec96: str) -> list[tuple[int, int, str]]:
    rows = []
    for line in sec96.splitlines():
        m = re.match(r"\|\s*(\d+)(?:\s*[–-]\s*(\d+))?\s*\|([^|]*)\|([^|]*)\|", line)
        if m:
            lo = int(m.group(1))
            hi = int(m.group(2) or lo)
            rows.append((lo, hi, m.group(4)))
    return rows


def run_command(cmdline: str, cache: dict) -> dict:
    if cmdline not in cache:
        argv = shlex.split(cmdline)
        a = build_parser().parse_args(argv)
        cache[cmdline] = COMMANDS[a.cmd](a)
    return cache[cmdline]


def get_key(res: dict, key: list) -> float:
    v = res
    for k in key:
        require(isinstance(v, dict) and k in v, f"result has no key {key!r}")
        v = v[k]
    return v


def evaluate_entry(e: dict, cache: dict) -> float:
    if "terms" in e:
        require(e.get("combine") == "product", f"entry {e['id']}: unknown combine {e.get('combine')}")
        val = 1.0
        for t in e["terms"]:
            val *= get_key(run_command(t["command"], cache), t["key"])
        return val
    return get_key(run_command(e["command"], cache), e["key"])


def check_value(e: dict, computed: float) -> tuple[bool, str]:
    kind = e["check"]
    printed = e["printed"]
    if kind == "exact":
        ok = float(computed).is_integer() and int(computed) == int(num(printed))
        return ok, f"{int(computed) if float(computed).is_integer() else computed}"
    if kind == "ge":
        return computed >= e["value"], f"{computed:.6f}"
    if kind == "le":
        return computed <= e["value"], f"{computed:.6f}"
    if kind == "decimals":
        d = len(printed.split(".")[1]) if "." in printed else 0
        ok = abs(computed - num(printed)) <= 0.5 * 10 ** (-d) + 1e-12
        return ok, f"{computed:.{d + 3}f}"
    raise InputError(f"entry {e['id']}: unknown check {kind}")


def check_manifest(plan_path: str | Path, manifest_path: str | Path, root: Path = REPO_ROOT) -> dict:
    """Check every manifest entry against PLAN (presence, 9.6 table row, coverage) and recompute it."""
    plan_text = Path(plan_path).read_text(encoding="utf-8")
    man = read_json(manifest_path)
    entries = man.get("entries", [])
    problems: list[str] = []
    ids = [e.get("id") for e in entries]
    expected = man.get("count")
    if sorted(ids) != list(range(1, len(ids) + 1)) or len(ids) != expected:
        problems.append(f"manifest ids must be exactly 1..{expected}: got {len(ids)} entries")
    secs = plan_sections(plan_text)
    rows = manifest_table_rows(secs.get("9.6", ""))
    if not rows:
        problems.append("PLAN 9.6 has no 'Power check manifest' table")
    elif max(hi for _, hi, _ in rows) != expected:
        problems.append(f"PLAN 9.6 manifest table covers 1..{max(hi for _, hi, _ in rows)}, manifest count is {expected}")
    cache: dict = {}
    results = []
    for e in entries:
        where = secs.get(e["section"])
        if where is None:
            problems.append(f"#{e['id']}: PLAN has no section {e['section']}")
        elif not contains_number(where, e["printed"]):
            problems.append(f"#{e['id']}: printed value {e['printed']!r} not found in PLAN §{e['section']}")
        row = next((r for r in rows if r[0] <= e["id"] <= r[1]), None)
        if row is None:
            problems.append(f"#{e['id']}: no row of the PLAN 9.6 manifest table covers it")
        elif not contains_number(row[2], e["printed"]):
            problems.append(f"#{e['id']}: {e['printed']!r} is not in PLAN 9.6 table row {row[0]}-{row[1]}")
        try:
            computed = evaluate_entry(e, cache)
            ok, shown = check_value(e, computed)
        except InputError as err:
            computed, ok, shown = None, False, f"error: {err}"
        if not ok:
            problems.append(f"#{e['id']} §{e['section']} {e['label']}: printed {e['printed']}, computed {shown}")
        results.append(
            {
                "id": e["id"],
                "section": e["section"],
                "label": e["label"],
                "printed": e["printed"],
                "check": e["check"],
                "computed": computed,
                "pass": ok,
            }
        )
    # Every tagged number in PLAN 3.x and 9.6 must be a manifest entry of that section.
    by_sec: dict[str, set[float]] = {}
    for e in entries:
        by_sec.setdefault(e["section"], set()).add(round(num(e["printed"].lstrip("≥≤ ")), 10))
    missing = []
    for sec, text in secs.items():
        if not (sec == "3" or sec.startswith("3.") or sec == "9.6"):
            continue
        for printed, val in tagged_numbers(text):
            if round(val, 10) not in by_sec.get(sec, set()):
                missing.append(f"§{sec}: tagged number {printed} is not in the manifest")
    problems += sorted(set(missing))

    def relp(x) -> str:
        return os.path.relpath(Path(x).resolve(), root.resolve())

    return {
        "plan": relp(plan_path),
        "manifest": relp(manifest_path),
        "count": len(entries),
        "passed": sum(1 for r in results if r["pass"]),
        "failed": sum(1 for r in results if not r["pass"]),
        "entries": results,
        "problems": problems,
        "ok": not problems,
    }


def shown_value(entry: dict) -> str:
    """The value as the paper prints it, formatted from the computed number."""
    c = entry["computed"]
    if c is None:
        return "??"
    if entry["check"] == "exact":
        return str(int(c))
    if entry["check"] in ("ge", "le"):
        return entry["printed"]
    d = len(entry["printed"].split(".")[1]) if "." in entry["printed"] else 0
    return f"{c:.{d}f}"


def render_power_tex(check: dict) -> str:
    vals = {str(e["id"]): macros.tex_escape(shown_value(e)) for e in check["entries"]}
    return macros.render_keyed(MACRO_GEN, "pw", vals)


def cmd_all(a) -> dict:
    require(a.check is not None, "all needs --check <PLAN.md>")
    out = check_manifest(a.check, a.manifest)
    if not a.no_write:
        prev = read_json(a.out) if Path(a.out).is_file() else {}
        prev["check"] = out
        write_json(a.out, prev)
        write_text(a.macros, render_power_tex(out))
    return out


COMMANDS = {
    "mde": cmd_mde,
    "binom": cmd_binom,
    "binom-min": cmd_binom_min,
    "anyfp": cmd_anyfp,
    "floor": cmd_floor,
    "ni": cmd_ni,
    "harm": cmd_harm,
    "frame": cmd_frame,
    "all": cmd_all,
}


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    def add(name: str) -> argparse.ArgumentParser:
        sp = sub.add_parser(name)
        sp.add_argument("--json", action="store_true", help="print the result as JSON")
        return sp

    s = add("mde")
    s.add_argument("--n", type=int)
    s.add_argument("--target", type=float)
    s.add_argument("--sd-diff", type=float)
    s.add_argument("--alpha", type=float, default=0.05)
    s.add_argument("--power", type=float, default=0.8)
    s = add("binom")
    s.add_argument("--n", type=int, required=True)
    s.add_argument("--p0", type=float, required=True)
    s.add_argument("--alpha", type=float, required=True)
    s.add_argument("--p1", type=float, nargs="*")
    s = add("binom-min")
    s.add_argument("--p0", type=float, required=True)
    s.add_argument("--alpha", type=float, required=True)
    s = add("anyfp")
    s.add_argument("--n", type=int, required=True)
    s.add_argument("--pi", type=float, nargs="+", required=True)
    s = add("floor")
    s.add_argument("--ma", type=int, nargs="+", required=True, help="m * a values")
    s.add_argument("--p", type=float, default=0.5)
    s = add("ni")
    s.add_argument("--n", type=int, nargs="+", required=True)
    s.add_argument("--sd-diff", type=float, nargs="+", required=True)
    s.add_argument("--delta", type=float, required=True)
    s.add_argument("--theta", type=float, nargs="+", default=[0.0])
    s.add_argument("--alpha", type=float, required=True)
    s = add("harm")
    s.add_argument("--n", type=int, nargs="+", required=True)
    s.add_argument("--sd-diff", type=float, nargs="+", required=True)
    s.add_argument("--effect", type=float, nargs="+", required=True)
    s.add_argument("--alpha", type=float, required=True)
    s = add("frame")
    s.add_argument("--frame-spec", required=True)
    s.add_argument("--p0", type=float, default=H1_P0)
    s.add_argument("--alpha", type=float, default=H1_ALPHA)
    s = add("all")
    s.add_argument("--check", metavar="PLAN_MD")
    s.add_argument("--manifest", default=str(MANIFEST))
    s.add_argument("--out", default=str(POWER_JSON))
    s.add_argument("--macros", default=str(POWER_TEX))
    s.add_argument("--no-write", action="store_true", help="write neither power.json nor power.tex")
    return p


def main(argv: list[str]) -> int:
    a = build_parser().parse_args(argv)
    r = COMMANDS[a.cmd](a)
    if a.cmd == "all":
        if a.json:
            print(json.dumps(r, indent=2, ensure_ascii=False))
        else:
            for p in r["problems"]:
                print(f"MISMATCH {p}")
            print(f"power check: {r['passed']}/{r['count']} entries pass; {len(r['problems'])} problems")
        return 0 if r["ok"] else 1
    if a.json:
        print(json.dumps(r, indent=2, ensure_ascii=False))
    else:
        print_human(a.cmd, r)
    if a.cmd == "frame" and r["specMismatches"]:
        return 1
    return 0


if __name__ == "__main__":
    run_main(main)
