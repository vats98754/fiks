#!/usr/bin/env python3
"""Validate paper/WORKSTREAMS.json.

Checks (exit 1 on any failure, printing every problem):
  1. The file parses and is a list of stream objects with the required keys.
  2. Stream ids are unique; every depends_on id exists; no self-dependency.
  3. The dependency graph is acyclic (prints a topological order).
  4. Waves respect dependencies: wave(dep) < wave(stream) for every edge.
  5. Ownership is disjoint: no two streams own globs that can match a common
     path (exact glob-intersection test, not sampling), and no two streams own
     the same external repository.
  6. Reserved run-output paths (written only by run steps) are owned by nobody.
  7. est_hours are positive numbers; prints the total and the critical path.

Glob semantics: '/'-separated segments; a segment '**' matches zero or more
whole segments; '*' inside a segment matches any run of non-'/' characters.
Owns entries starting with 'external:' name a GitHub repository; the repository
is the first 'github.com/<owner>/<repo>' token in the entry.

  9. Acceptance hygiene (round 5): no acceptance item diffs against a fixed
     commit sha ('git diff --name-only <hex>'; use '<branch base>' or
     '<wave-N merge base>'); every '[LIVE' item routes through live-lock.ts.
 10. Every PLAN component in REQUIRED_OWNED is named in some stream's
     deliverables (so no run component is unowned).
 11. Round 6: no stream owns a path under .work/ (external clones live there,
     untracked); no item places a clone at realbugs/<id>/repo (a nested .git
     becomes an uncommittable gitlink); no stub or ref A uses the shop-mcp
     fix commits as an "oracle src diff" (88ed791 does not apply to seed-v1;
     use packages/cli/test/oracles/D<n>.patch); a '*.test-d.ts' path in an
     acceptance item must come with '--typecheck' (vitest 5.0.3 collects it
     only under typecheck.include).

 12. Round 7: shop-mcp main is never the target of a stream's push (VOCAB pushes
     a branch + the base-shop tag; main is fast-forwarded at VOCAB's merge); the
     root 'exp' script exists only from INTEG on, so no other stream's acceptance
     invokes 'pnpm exp <run>' (use 'pnpm tsx packages/exp/src/main.ts'); a stream
     whose acceptance uses shop-mcp refs (seed-v1, base-shop, .work/shop-mcp)
     runs 'node scripts/ensure-shop-mcp.mjs' in SETUP or has a 'pnpm test' item
     (whose pretest runs it).

  8. With --builders N: a greedy list-schedule (longest-remaining-path first,
     a stream starts when all its dependencies have finished) giving the
     builder makespan in est_hours, without verifier loops; --until ID stops
     the clock when ID finishes (e.g. INTEG = ready for T0).

Usage: python3 paper/scripts/check_workstreams.py [paper/WORKSTREAMS.json]
       [--builders N] [--until ID]
Standard library only.
"""
from __future__ import annotations

import json
import re
import sys
from functools import lru_cache
from pathlib import Path

REQUIRED = ["id", "title", "goal", "owns", "reads", "depends_on",
            "deliverables", "acceptance", "est_hours", "wave"]
RESERVED = ["paper/results/raw/**", "paper/results/confirmatory.lock"]
FIXED_DIFF_RE = re.compile(r"git diff --name-only [0-9a-f]{7,40}\b")
# PLAN components that runs depend on; each must be a deliverable of some stream.
REQUIRED_OWNED = ["FIKS+CU", "ISSUE-TEXT", "REPRO-AGENT", "fiks-iv", "rerecord-head",
                  "--agent-stub", "--dry", "--domain", "reproEmitter", "allowedEditPaths",
                  "TRK-DEV-1", "DEV-X1", "live-lock.ts", "FIKS_LLM_FORBID",
                  # round 6
                  "capturedAt", "drift-attributable", "ivProperties", "contract-disable.mjs",
                  "ensure-realbugs.mjs", "ensure-tracker-mcp.mjs", "fiks-tools",
                  "--require-sandbox", "rerecord-containment",
                  # round 7
                  "--per-element", "perElement", "--protocol tracker|shop-blind|llm",
                  "D4-plantedfp", "build-tools.ts", "Run R11", "tracker-sync-ref.json"]
SHOP_MAIN_PUSH_RE = re.compile(r"re-vendor commit on (vats98754/)?shop-mcp main|one re-vendor commit on main")
PNPM_EXP_RE = re.compile(r"\bpnpm exp\s+(R\d|T0|A\d|fit\b|CP\d|--)")
SHOP_REF_RE = re.compile(r"\bseed-v1\b|\bbase-shop\b|\.work/shop-mcp")
NESTED_CLONE_RE = re.compile(r"(?<!-e )realbugs/(<id>|[A-Za-z0-9-]+)/repo\b")
STUB_ORACLE_RE = re.compile(r"oracle src diff|ref A = the shop-mcp fix commits")
TEST_D_RE = re.compile(r"\.test-d\.ts")
EXTERNAL_RE = re.compile(r"github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)")


def seg_intersect(p: str, q: str) -> bool:
    """True iff two single-segment globs (only '*' wildcards) share a match."""
    @lru_cache(maxsize=None)
    def go(i: int, j: int) -> bool:
        if i == len(p) and j == len(q):
            return True
        if i < len(p) and p[i] == "*":
            return go(i + 1, j) or (j < len(q) and go(i, j + 1))
        if j < len(q) and q[j] == "*":
            return go(i, j + 1) or (i < len(p) and go(i + 1, j))
        return i < len(p) and j < len(q) and p[i] == q[j] and go(i + 1, j + 1)
    return go(0, 0)


def glob_intersect(a: str, b: str) -> bool:
    """True iff path globs a and b can match at least one common path."""
    pa, pb = a.strip("/").split("/"), b.strip("/").split("/")

    @lru_cache(maxsize=None)
    def go(i: int, j: int) -> bool:
        if i == len(pa) and j == len(pb):
            return True
        if i < len(pa) and pa[i] == "**":
            return go(i + 1, j) or (j < len(pb) and go(i, j + 1))
        if j < len(pb) and pb[j] == "**":
            return go(i, j + 1) or (i < len(pa) and go(i + 1, j))
        return (i < len(pa) and j < len(pb)
                and seg_intersect(pa[i], pb[j]) and go(i + 1, j + 1))
    return go(0, 0)


def selftest() -> None:
    cases = [
        ("a/b/**", "a/b/c.ts", True), ("a/**", "b/**", False),
        ("paper/results/**", "paper/results/raw/x.json", True),
        ("packages/cli/src/commands/*.ts", "packages/cli/src/commands/repair.ts", True),
        ("packages/cli/src/bootstrap/10-*.ts", "packages/cli/src/bootstrap/20-sandbox.ts", False),
        ("x/**/y.ts", "x/a/b/y.ts", True), ("x/*/y.ts", "x/a/b/y.ts", False),
        ("packages/cli/test/core/**", "packages/cli/test/orch/**", False),
        ("realbugs/R10/**", "realbugs/R19/**", False), ("**", "anything/at/all", True),
    ]
    assert NESTED_CLONE_RE.search("run on realbugs/<id>/repo at the prefix")
    assert NESTED_CLONE_RE.search("git -C realbugs/R10/repo remote -v")
    assert not NESTED_CLONE_RE.search("test ! -e realbugs/R10/repo, and")
    assert not NESTED_CLONE_RE.search("git -C .work/realbugs/R10 remote -v")
    assert STUB_ORACLE_RE.search("a stub agent applying the oracle src diff (shop-mcp 7c5f4ea)")
    assert SHOP_MAIN_PUSH_RE.search("one re-vendor commit on main touching evaluate.ts")
    assert not SHOP_MAIN_PUSH_RE.search("one re-vendor commit on branch fiks/revendor-f2")
    assert PNPM_EXP_RE.search("'pnpm exp R1 --dry --dev'") and PNPM_EXP_RE.search("pnpm exp fit --measured x")
    assert not PNPM_EXP_RE.search("'pnpm exp' is used only from INTEG on")
    for a, b, want in cases:
        got = glob_intersect(a, b)
        assert got == want and glob_intersect(b, a) == want, (a, b, got, want)


def schedule(by: dict, order: list, n_builders: int, until: str | None) -> float:
    """Greedy list scheduling on n_builders; returns the finish time of `until`
    (or of the last stream)."""
    tail = {}
    for n in reversed(order):
        kids = [c for c in by if n in by[c]["depends_on"]]
        tail[n] = by[n]["est_hours"] + max((tail[c] for c in kids), default=0)
    finish, running, t, done = {}, [], 0.0, set()
    pending = set(by)
    while pending or running:
        ready = sorted((n for n in pending if all(d in done for d in by[n]["depends_on"])),
                       key=lambda n: (-tail[n], n))
        while ready and len(running) < n_builders:
            n = ready.pop(0)
            pending.discard(n)
            running.append((t + by[n]["est_hours"], n))
        running.sort()  # (finish time, id): deterministic tie-break
        t, n = running.pop(0)
        finish[n] = t
        done.add(n)
    return finish[until] if until else max(finish.values())


def main(path: str, builders: int | None = None, until: str | None = None) -> int:
    selftest()
    errors: list[str] = []
    try:
        streams = json.loads(Path(path).read_text())
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL parse: {exc}")
        return 1
    if not isinstance(streams, list):
        print("FAIL: top level is not a list")
        return 1

    ids = [s.get("id") for s in streams]
    by = {}
    for s in streams:
        missing = [k for k in REQUIRED if k not in s]
        if missing:
            errors.append(f"{s.get('id')}: missing keys {missing}")
        if s.get("id") in by:
            errors.append(f"duplicate id {s.get('id')}")
        by[s.get("id")] = s
        if not isinstance(s.get("est_hours"), (int, float)) or s.get("est_hours", 0) <= 0:
            errors.append(f"{s.get('id')}: est_hours must be a positive number")

    for s in streams:
        for d in s.get("depends_on", []):
            if d not in by:
                errors.append(f"{s['id']}: unknown dependency {d}")
            elif d == s["id"]:
                errors.append(f"{s['id']}: depends on itself")

    # 3. acyclic (Kahn)
    indeg = {i: 0 for i in by}
    for s in streams:
        for d in s.get("depends_on", []):
            if d in by:
                indeg[s["id"]] += 1
    order, ready = [], sorted(i for i, n in indeg.items() if n == 0)
    children = {i: [] for i in by}
    for s in streams:
        for d in s.get("depends_on", []):
            if d in by:
                children[d].append(s["id"])
    while ready:
        n = ready.pop(0)
        order.append(n)
        for c in children[n]:
            indeg[c] -= 1
            if indeg[c] == 0:
                ready.append(c)
                ready.sort()
    if len(order) != len(by):
        errors.append(f"dependency cycle among {sorted(set(by) - set(order))}")

    # 4. waves
    for s in streams:
        for d in s.get("depends_on", []):
            if d in by and not by[d]["wave"] < s["wave"]:
                errors.append(f"wave violation: {s['id']} (wave {s['wave']}) depends on "
                              f"{d} (wave {by[d]['wave']})")

    # 5. ownership
    paths, externals = [], {}
    for s in streams:
        for o in s.get("owns", []):
            if o.startswith("external:"):
                m = EXTERNAL_RE.search(o)
                if not m:
                    errors.append(f"{s['id']}: unparseable external owns entry {o!r}")
                    continue
                repo = f"{m.group(1)}/{m.group(2)}".lower()
                if repo in externals and externals[repo] != s["id"]:
                    errors.append(f"external repo {repo} owned by {externals[repo]} and {s['id']}")
                externals[repo] = s["id"]
                if m.group(1).lower() != "vats98754":
                    errors.append(f"{s['id']}: external repo outside vats98754: {repo}")
            else:
                paths.append((s["id"], o))
    for i in range(len(paths)):
        for j in range(i + 1, len(paths)):
            (sa, ga), (sb, gb) = paths[i], paths[j]
            if sa != sb and glob_intersect(ga, gb):
                errors.append(f"ownership overlap: {sa} {ga!r} vs {sb} {gb!r}")

    # 6. reserved run outputs
    for sid, g in paths:
        for r in RESERVED:
            if glob_intersect(g, r):
                errors.append(f"{sid} owns {g!r}, which overlaps reserved run output {r!r}")

    # 9. acceptance hygiene
    for s in streams:
        for a in s.get("acceptance", []):
            if FIXED_DIFF_RE.search(a):
                errors.append(f"{s['id']}: acceptance diffs against a fixed sha: {a[:80]!r}")
            if "[LIVE" in a and "live-lock.ts" not in a:
                errors.append(f"{s['id']}: [LIVE] item without live-lock.ts: {a[:80]!r}")

    # 11. round 6: clone locations, oracle patches, typecheck-only test files
    for sid, g in paths:
        if g.startswith(".work/") or g == ".work":
            errors.append(f"{sid} owns {g!r}: .work/ holds untracked external clones")
    for s in streams:
        items = [s.get("goal", "")] + s.get("deliverables", []) + s.get("acceptance", [])
        for a in items:
            if NESTED_CLONE_RE.search(a):
                errors.append(f"{s['id']}: clone inside the tracked tree (use .work/realbugs/<id>): {a[:80]!r}")
            if STUB_ORACLE_RE.search(a):
                errors.append(f"{s['id']}: shop-mcp fix commits used as an oracle diff "
                              f"(use packages/cli/test/oracles/D<n>.patch): {a[:80]!r}")
        for a in s.get("acceptance", []):
            if TEST_D_RE.search(a) and "--typecheck" not in a and "round-5 path" not in a:
                errors.append(f"{s['id']}: *.test-d.ts run without --typecheck: {a[:80]!r}")

    # 12. round 7: shop-mcp main untouched by builders; 'pnpm exp' only from INTEG;
    #     shop-mcp-using acceptance runs ensure-shop-mcp
    for s in streams:
        texts = [s.get("goal", "")] + s.get("owns", []) + s.get("deliverables", []) + s.get("acceptance", [])
        for a in texts:
            if SHOP_MAIN_PUSH_RE.search(a):
                errors.append(f"{s['id']}: pushes a re-vendor commit to shop-mcp main "
                              f"(use a branch + base-shop; main moves at the merge): {a[:80]!r}")
        acc = s.get("acceptance", [])
        if s["id"] != "INTEG":
            for a in acc:
                if PNPM_EXP_RE.search(a):
                    errors.append(f"{s['id']}: acceptance invokes 'pnpm exp' before INTEG adds the root "
                                  f"script (use 'pnpm tsx packages/exp/src/main.ts'): {a[:80]!r}")
        if s["id"] != "INTEG" and any(SHOP_REF_RE.search(a) for a in acc if not a.startswith("SETUP")):
            setup = " ".join(a for a in acc if a.startswith("SETUP"))
            runs_pretest = any(re.match(r"pnpm test\b", a) for a in acc)
            if "ensure-shop-mcp.mjs" not in setup and not runs_pretest:
                errors.append(f"{s['id']}: acceptance uses shop-mcp refs but SETUP does not run "
                              f"node scripts/ensure-shop-mcp.mjs (and no 'pnpm test' item runs pretest)")

    # 10. required components owned
    blob = "\n".join(d for s in streams for d in s.get("deliverables", []))
    for tok in REQUIRED_OWNED:
        if tok not in blob:
            errors.append(f"PLAN component {tok!r} is in no stream's deliverables")

    # 7. hours and critical path (longest est_hours chain in the DAG)
    total = sum(s.get("est_hours", 0) for s in streams)
    if len(order) == len(by):
        best, prev = {}, {}
        for n in order:
            deps = [d for d in by[n]["depends_on"] if d in by]
            p = max(deps, key=lambda d: best[d], default=None)
            best[n] = by[n]["est_hours"] + (best[p] if p else 0)
            prev[n] = p
        end = max(best, key=best.get)
        chain, n = [], end
        while n:
            chain.append(n)
            n = prev[n]
        print(f"critical path ({best[end]} h): {' -> '.join(reversed(chain))}")
    waves = {}
    for s in streams:
        waves.setdefault(s["wave"], []).append(s["id"])
    for w in sorted(waves):
        print(f"wave {w} ({len(waves[w])}): {', '.join(waves[w])}")
    print(f"streams: {len(streams)}; est_hours total: {total}")
    if builders and len(order) == len(by):
        print(f"schedule: {builders} concurrent builders -> "
              f"{schedule(by, order, builders, until):g} h until {until or 'last stream'} "
              f"(est_hours only; no verifier loops)")

    if errors:
        for e in errors:
            print("FAIL", e)
        return 1
    print("OK: parse, ids, dependencies, acyclic, waves, disjoint ownership, reserved paths, "
          "acceptance hygiene, required components owned, clone locations, oracle patches, "
          "shop-mcp main untouched, no pre-INTEG 'pnpm exp', ensure-shop-mcp in SETUP")
    return 0


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("path", nargs="?", default="paper/WORKSTREAMS.json")
    ap.add_argument("--builders", type=int)
    ap.add_argument("--until")
    a = ap.parse_args()
    sys.exit(main(a.path, a.builders, a.until))
