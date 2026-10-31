#!/usr/bin/env python3
"""E-A repair input ablation numbers (paper/EXP-PLAN.md), computed only from run logs.

Inputs: <root>/**/record.json (one per `pnpm fiks exp-repair` run) and the eval.json that
`pnpm fiks exp-eval` writes next to it. Default root: bench/results/exp/ablation.

Outputs (default paper/generated/):
  exp-ablation.tex   \\newcommand macros (per-arm totals, Wilson 95% intervals, sign tests)
  tab-ablation.tex   per drift x arm: live-check successes / runs, held-out repro, gates passed,
                     median turns, mean cost, infra errors

Counting rules (EXP-PLAN stop rules):
  - a run whose record has infraError (rate limits, API errors, Docker failures, after 3 retries)
    is excluded from every success count and reported in the infra-error column;
  - an eval whose infraError is set (the sandbox could not start or run commands, after 3
    retries) is excluded the same way and reported as an eval infra error;
  - a head that fails a stage itself (its server crashes, exits or hangs in a scenario, or the
    held-out suite cannot load on it: eval.json headErrors) is a FAILURE of that run: it stays in
    every denominator with the failed outcomes false, and is also counted in the head-error column;
  - an arm whose run + eval infra errors exceed 20% of its attempted runs is marked incomplete;
  - a run with a head but no eval.json yet is reported as not evaluated (exp-eval has not run on
    it; a warning is printed) and is in no count until it is evaluated;
  - paired comparison FIKS vs NOHINT, FIKS vs ALERT and FIKS vs ALERT+: exact two-sided sign test
    over drifts on the per-drift live-check success rates (ties dropped). n is small; all results
    are descriptive;
  - ALERT+ (EXP-PLAN E-A2) runs the ALERT prompt; the script checks that per drift the prompts are
    byte-identical (promptSha256) and also reports ALERT and ALERT+ pooled as samples of that prompt.

Usage:
  python3 paper/scripts/exp/ablation_numbers.py [--root DIR] [--out-dir DIR]
  python3 paper/scripts/exp/ablation_numbers.py --check [--root DIR] [--out-dir DIR]
"""
import json
import math
import os
import statistics
import sys
from math import comb

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
DEFAULT_RESULTS = os.path.join(ROOT, 'bench', 'results', 'exp', 'ablation')
DEFAULT_OUT = os.path.join(ROOT, 'paper', 'generated')
ARMS = ['fiks', 'nohint', 'alert', 'alertplus']
ARM_LABEL = {'fiks': 'FIKS', 'nohint': 'NOHINT', 'alert': 'ALERT', 'alertplus': 'ALERT+'}
ARM_MACRO = {'fiks': 'Fiks', 'nohint': 'Nohint', 'alert': 'Alert', 'alertplus': 'Alertplus'}
DRIFTS = ['D1', 'D2', 'D3', 'D4', 'D5']
RUN_SCHEMA = 'fiks.exp.run/1'
EVAL_SCHEMA = 'fiks.exp.eval/2'
INFRA_STOP = 0.20


def wilson(c, n, z=1.959964):
    if n == 0:
        return (0.0, 1.0)
    p = c / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (max(0.0, centre - half), min(1.0, centre + half))


def sign_test_two_sided(wins, losses):
    n = wins + losses
    if n == 0:
        return 1.0
    m = min(wins, losses)
    p = sum(comb(n, i) for i in range(m + 1)) / 2 ** n
    return min(1.0, 2 * p)


def find_runs(root):
    out = []
    if not os.path.isdir(root):
        return out
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        if 'record.json' in filenames:
            out.append(dirpath)
            dirnames[:] = []
    return sorted(out)


def load(run_dir):
    with open(os.path.join(run_dir, 'record.json')) as f:
        rec = json.load(f)
    if rec.get('schema') != RUN_SCHEMA:
        raise SystemExit(f'{run_dir}/record.json: schema {rec.get("schema")!r}, expected {RUN_SCHEMA}')
    for k in ('runId', 'arm', 'drift', 'gatesPassed', 'turns', 'costUsd', 'infraError', 'experiment'):
        if k not in rec:
            raise SystemExit(f'{run_dir}/record.json: missing {k}')
    if rec['arm'] not in ARMS or rec['drift'] not in DRIFTS:
        raise SystemExit(f'{run_dir}/record.json: unknown arm/drift {rec["arm"]}/{rec["drift"]}')
    ev = None
    p = os.path.join(run_dir, 'eval.json')
    if os.path.exists(p):
        with open(p) as f:
            ev = json.load(f)
        if ev.get('schema') != EVAL_SCHEMA:
            raise SystemExit(
                f'{p}: schema {ev.get("schema")!r}, expected {EVAL_SCHEMA} '
                '(re-run `pnpm fiks exp-eval --force` on this run)'
            )
        if ev.get('runId') != rec['runId']:
            raise SystemExit(f'{p}: not the eval of {rec["runId"]}')
        for k in ('liveCheck', 'heldOutRepro', 'changedLines', 'headErrors', 'infraError'):
            if k not in ev:
                raise SystemExit(f'{p}: missing {k}')
        if ev['infraError'] is None and ev['headErrors'] and ev['liveCheck'] and any(
            e.get('stage', '').startswith('live.') for e in ev['headErrors']
        ):
            raise SystemExit(f'{p}: liveCheck true although the head failed a live stage')
    return rec, ev


def pct(x):
    return f'{100 * x:.0f}\\%'


def fmt_p(p):
    return f'{p:.3f}' if p >= 0.001 else '<0.001'


def compute(root):
    cells = {
        (d, a): {'runs': [], 'infra': 0, 'evalInfra': 0, 'unevaluated': 0, 'headErr': 0}
        for d in DRIFTS
        for a in ARMS
    }
    n_records = 0
    pending = []
    prompts = {}
    for run_dir in find_runs(root):
        rec, ev = load(run_dir)
        if rec['experiment'] != 'E-A':
            continue
        n_records += 1
        c = cells[(rec['drift'], rec['arm'])]
        if rec.get('promptSha256'):
            prompts.setdefault((rec['drift'], rec['arm']), set()).add(rec['promptSha256'])
        if rec['infraError'] is not None:
            c['infra'] += 1
            continue
        if rec.get('head') is None:
            # No infra error and no head: the run produced nothing to evaluate. A failure.
            c['runs'].append({'live': False, 'heldOut': False, 'gates': False,
                              'turns': rec['turns'], 'cost': rec['costUsd'], 'lines': 0})
            continue
        if ev is None:
            c['unevaluated'] += 1
            pending.append(run_dir)
            continue
        if ev['infraError'] is not None:
            c['evalInfra'] += 1
            continue
        if ev['headErrors']:
            c['headErr'] += 1
        c['runs'].append({
            'live': bool(ev['liveCheck']),
            'heldOut': bool(ev['heldOutRepro']['ok']),
            'gates': bool(rec['gatesPassed']),
            'turns': rec['turns'],
            'cost': rec['costUsd'],
            'lines': ev['changedLines']['lines'],
        })
    for d in pending:
        print(f'warning: {d} has no eval.json (run `pnpm fiks exp-eval`); it is in no count', file=sys.stderr)
    return n_records, cells, prompts


def arm_totals(cells, arm):
    runs = [r for d in DRIFTS for r in cells[(d, arm)]['runs']]
    infra = sum(cells[(d, arm)]['infra'] for d in DRIFTS)
    ev_infra = sum(cells[(d, arm)]['evalInfra'] for d in DRIFTS)
    unev = sum(cells[(d, arm)]['unevaluated'] for d in DRIFTS)
    head_err = sum(cells[(d, arm)]['headErr'] for d in DRIFTS)
    attempted = len(runs) + infra + ev_infra + unev
    return runs, infra, ev_infra, unev, head_err, attempted


def infra_cell(infra, ev_infra, unev):
    s = str(infra + ev_infra)
    if ev_infra:
        s += f' ({ev_infra} eval)'
    if unev:
        s += f' (+{unev} not eval.)'
    return s


def build(root):
    n_records, cells, prompts = compute(root)
    M = {}
    M['expAblRecords'] = str(n_records)
    lines = [
        '% Generated by paper/scripts/exp/ablation_numbers.py from bench/results/exp/ablation. Do not edit.',
        '\\begin{tabular}{llrrrrrrr}',
        '\\toprule',
        'Drift & Arm & Live check & Repro test & Gates pass & Head err. & Median turns & Mean cost (\\$) & Infra err. \\\\',
        '\\midrule',
    ]
    if n_records == 0:
        lines.append('\\multicolumn{9}{c}{no runs} \\\\')
    for d in DRIFTS:
        if n_records == 0:
            break
        for a in ARMS:
            c = cells[(d, a)]
            rs = c['runs']
            n = len(rs)
            if n == 0 and c['infra'] == 0 and c['evalInfra'] == 0 and c['unevaluated'] == 0:
                continue
            turns = f'{statistics.median([r["turns"] for r in rs]):g}' if rs else '--'
            cost = f'{sum(r["cost"] for r in rs) / n:.2f}' if rs else '--'
            infra = infra_cell(c['infra'], c['evalInfra'], c['unevaluated'])
            lines.append(
                f'{d} & {ARM_LABEL[a]} & {sum(r["live"] for r in rs)}/{n} & {sum(r["heldOut"] for r in rs)}/{n} & '
                f'{sum(r["gates"] for r in rs)}/{n} & {c["headErr"]} & {turns} & {cost} & {infra} \\\\'
            )
    if n_records:
        lines.append('\\midrule')
    total_runs = 0
    total_infra = 0
    for a in ARMS:
        runs, infra, ev_infra, unev, head_err, attempted = arm_totals(cells, a)
        k = sum(r['live'] for r in runs)
        n = len(runs)
        lo, hi = wilson(k, n)
        mac = ARM_MACRO[a]
        total_runs += n
        total_infra += infra + ev_infra
        incomplete = attempted > 0 and (infra + ev_infra) / attempted > INFRA_STOP
        M[f'expRuns{mac}'] = str(n)
        M[f'expLive{mac}'] = f'{k}/{n}'
        M[f'expLiveRate{mac}'] = pct(k / n) if n else 'n/a'
        M[f'expLiveLo{mac}'] = pct(lo) if n else 'n/a'
        M[f'expLiveHi{mac}'] = pct(hi) if n else 'n/a'
        h = sum(r['heldOut'] for r in runs)
        hlo, hhi = wilson(h, n)
        M[f'expHeldOut{mac}'] = f'{h}/{n}'
        M[f'expHeldOutLo{mac}'] = pct(hlo) if n else 'n/a'
        M[f'expHeldOutHi{mac}'] = pct(hhi) if n else 'n/a'
        M[f'expGates{mac}'] = f'{sum(r["gates"] for r in runs)}/{n}'
        # Disagreements between the arm's own gates / the repro and the live check.
        M[f'expGatesPassLiveFail{mac}'] = str(sum(r['gates'] and not r['live'] for r in runs))
        M[f'expGatesFailLiveFail{mac}'] = str(sum(not r['gates'] and not r['live'] for r in runs))
        M[f'expHeldPassLiveFail{mac}'] = str(sum(r['heldOut'] and not r['live'] for r in runs))
        M[f'expGatesFailLivePass{mac}'] = str(sum(not r['gates'] and r['live'] for r in runs))
        M[f'expTurnsMedian{mac}'] = f'{statistics.median([r["turns"] for r in runs]):g}' if runs else 'n/a'
        M[f'expCostTotal{mac}'] = f'{sum(r["cost"] for r in runs):.2f}'
        M[f'expInfra{mac}'] = str(infra + ev_infra)
        M[f'expRunInfra{mac}'] = str(infra)
        M[f'expEvalInfra{mac}'] = str(ev_infra)
        M[f'expHeadErrors{mac}'] = str(head_err)
        M[f'expUnevaluated{mac}'] = str(unev)
        M[f'expIncomplete{mac}'] = 'yes' if incomplete else 'no'
        if n_records and attempted:
            note = ' (incomplete)' if incomplete else ''
            live = f'{k}/{n} [{M[f"expLiveLo{mac}"]}--{M[f"expLiveHi{mac}"]}]' if n else '0/0'
            mean_cost = f'{sum(r["cost"] for r in runs) / n:.2f}' if n else '--'
            turns = M[f'expTurnsMedian{mac}'] if n else '--'
            lines.append(
                f'All & {ARM_LABEL[a]}{note} & {live} & {h}/{n} & {M[f"expGates{mac}"]} & {head_err} & {turns} & '
                f'{mean_cost} & {infra_cell(infra, ev_infra, unev)} \\\\'
            )
    M['expRunsTotal'] = str(total_runs)
    M['expInfraTotal'] = str(total_infra)
    # Paired sign tests over drifts on per-drift live-check success rates.
    for other in ('nohint', 'alert', 'alertplus'):
        wins = losses = ties = 0
        for d in DRIFTS:
            a, b = cells[(d, 'fiks')]['runs'], cells[(d, other)]['runs']
            if not a or not b:
                continue
            ra = sum(r['live'] for r in a) / len(a)
            rb = sum(r['live'] for r in b) / len(b)
            if ra > rb:
                wins += 1
            elif ra < rb:
                losses += 1
            else:
                ties += 1
        mac = f'expSignFiksVs{ARM_MACRO[other]}'
        M[f'{mac}Wins'] = str(wins)
        M[f'{mac}Losses'] = str(losses)
        M[f'{mac}Ties'] = str(ties)
        M[f'{mac}P'] = fmt_p(sign_test_two_sided(wins, losses))
    # ALERT and ALERT+ share the prompt: per drift, every run of both arms has the same prompt hash.
    shared = [d for d in DRIFTS if (d, 'alert') in prompts and (d, 'alertplus') in prompts]
    same = all(len(prompts[(d, 'alert')] | prompts[(d, 'alertplus')]) == 1 for d in shared)
    M['expAlertPromptDrifts'] = str(len(shared))
    M['expAlertPromptSame'] = 'yes' if shared and same else 'no'
    pooled = [r for a in ('alert', 'alertplus') for d in DRIFTS for r in cells[(d, a)]['runs']]
    k, n = sum(r['live'] for r in pooled), len(pooled)
    lo, hi = wilson(k, n)
    M['expLiveAlertPooled'] = f'{k}/{n}'
    M['expLiveRateAlertPooled'] = pct(k / n) if n else 'n/a'
    M['expLiveLoAlertPooled'] = pct(lo) if n else 'n/a'
    M['expLiveHiAlertPooled'] = pct(hi) if n else 'n/a'
    lines += ['\\bottomrule', '\\end{tabular}', '']
    macros = '% Generated by paper/scripts/exp/ablation_numbers.py from bench/results/exp/ablation. Do not edit.\n' + ''.join(
        f'\\newcommand{{\\{k}}}{{{v}}}\n' for k, v in sorted(M.items())
    )
    return n_records, {'exp-ablation.tex': macros, 'tab-ablation.tex': '\n'.join(lines)}


def main(argv):
    root = DEFAULT_RESULTS
    out = DEFAULT_OUT
    check = False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--check':
            check = True
        elif a == '--root' and i + 1 < len(argv):
            root = os.path.abspath(argv[i + 1])
            i += 1
        elif a == '--out-dir' and i + 1 < len(argv):
            out = os.path.abspath(argv[i + 1])
            i += 1
        else:
            print(__doc__)
            return 2
        i += 1
    n, files = build(root)
    if n == 0:
        print('no runs')
    if check:
        bad = []
        for name, text in files.items():
            p = os.path.join(out, name)
            if not os.path.exists(p) or open(p).read() != text:
                bad.append(name)
        if bad:
            print('ablation_numbers --check: MISMATCH in ' + ', '.join(bad))
            return 1
        print(f'ablation_numbers --check: {len(files)} files match the logs ({n} records)')
        return 0
    os.makedirs(out, exist_ok=True)
    for name, text in files.items():
        with open(os.path.join(out, name), 'w') as f:
            f.write(text)
    print(f'ablation_numbers: {n} records -> {", ".join(os.path.join(out, k) for k in files)}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
