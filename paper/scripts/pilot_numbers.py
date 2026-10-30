#!/usr/bin/env python3
"""Pilot-study numbers for the fiks paper, computed only from committed logs.

Inputs (all committed):
  bench/results/<run>/{meta.json,trials.jsonl}   agent trials (hackathon bench)
  bench/results/summary.json                      loop results per drift (built by `pnpm fiks summarize`)
  bench/results/loop/repairs/*.json               repair records (cost, turns, gates, PR)
  paper/results/pilot/prs.json                    snapshot of the shop-mcp PRs (from `--snapshot-prs`)

Outputs:
  paper/generated/pilot.tex     \\newcommand macros used in the manuscript
  paper/generated/pilot.json    the same values, machine-readable
  paper/generated/tab-*.tex     tables

Usage:
  python3 paper/scripts/pilot_numbers.py                 # write outputs
  python3 paper/scripts/pilot_numbers.py --check         # rebuild in memory, fail if any output differs
  python3 paper/scripts/pilot_numbers.py --snapshot-prs  # refresh prs.json from GitHub (read-only gh calls)
"""
import json
import math
import os
import subprocess
import sys
from math import comb

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RES = os.path.join(ROOT, 'bench', 'results')
OUT = os.path.join(ROOT, 'paper', 'generated')
PRS = os.path.join(ROOT, 'paper', 'results', 'pilot', 'prs.json')
SHOP = 'vats98754/shop-mcp'

# Runs used by the paper. "v2" receipts are the final wording; "v1" the first wording (history).
RUNS = {
    'A': 'A_v1_20261020T223642',
    'B': 'B_v2_20261020T224015',
    'Bd': 'B_v2_direct_20261020T224445',
    'C': 'C_v2_fixed_20261020T224903',
    'Aold': 'A_v1_20261018T093357',
    'Bold': 'B_v2_20261018T093754',
    'Bdold': 'B_v2_direct_20261018T094446',
}
LABEL = {
    'A': 'Before drift (v1), through fiks',
    'Bd': 'After drift (v2), no fiks',
    'B': 'After drift (v2), fiks receipts',
    'C': 'After drift (v2), fiks fixes merged',
}


def load_run(run_id):
    d = os.path.join(RES, run_id)
    meta = json.load(open(os.path.join(d, 'meta.json')))
    trials = [json.loads(line) for line in open(os.path.join(d, 'trials.jsonl')) if line.strip()]
    return meta, trials


def wilson(c, n, z=1.959964):
    if n == 0:
        return (0.0, 1.0)
    p = c / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (max(0.0, centre - half), min(1.0, centre + half))


def pass_hat_k(per_task, k):
    """tau-bench pass^k: mean over tasks of C(c,k)/C(n,k)."""
    vals = [comb(c, k) / comb(n, k) for (c, n) in per_task.values() if n >= k]
    return sum(vals) / len(vals)


def sign_test_two_sided(wins, losses):
    n = wins + losses
    if n == 0:
        return 1.0
    m = min(wins, losses)
    p = sum(comb(n, i) for i in range(m + 1)) / 2 ** n
    return min(1.0, 2 * p)


def run_stats(run_id):
    meta, trials = load_run(run_id)
    per_task = {}
    noans_task = {}
    viol_trials = 0
    outcomes = {'correct': 0, 'wrong': 0, 'declined': 0, 'noAnswer': 0}
    calls = {'verified': 0, 'violated': 0, 'unverifiable': 0}
    props = {}
    for t in trials:
        c, n = per_task.get(t['taskId'], (0, 0))
        per_task[t['taskId']] = (c + (1 if t['pass'] else 0), n + 1)
        # Same rule as packages/cli/src/commands/summarize.ts: an unsubmitted answer is 'noAnswer', not 'wrong'.
        o = 'noAnswer' if t.get('answer') is None and t['outcome'] != 'declined' and not t['pass'] else t['outcome']
        outcomes[o] = outcomes.get(o, 0) + 1
        if o == 'noAnswer':
            noans_task[t['taskId']] = noans_task.get(t['taskId'], 0) + 1
        if any(cl.get('verdict') == 'violated' for cl in t.get('calls', [])):
            viol_trials += 1
        for call in t.get('calls', []):
            v = call.get('verdict', 'none')
            calls[v] = calls.get(v, 0) + 1
            if v == 'violated':
                for p in call.get('propertyIds', []):
                    props[p] = props.get(p, 0) + 1
    n = len(trials)
    c = sum(1 for t in trials if t['pass'])
    lo, hi = wilson(c, n)
    return {
        'run': run_id, 'model': meta['model'], 'fiksSha': meta.get('fiksSha', ''), 'proxy': meta.get('proxy'),
        'fiksDirty': meta.get('fiksDirty'), 'shopRef': meta.get('shopRef'), 'shopMcpSha': meta.get('shopMcpSha', ''),
        'violTrials': viol_trials, 'noAnswerByTask': noans_task,
        'n': n, 'tasks': len(per_task), 'k': max(nn for (_, nn) in per_task.values()),
        'pass1': c / n, 'pass1_lo': lo, 'pass1_hi': hi,
        'passk': [pass_hat_k(per_task, k) for k in range(1, 6)],
        'perTask': {t: {'c': cc, 'n': nn} for t, (cc, nn) in sorted(per_task.items())},
        'outcomes': outcomes, 'calls': calls, 'violatedProps': dict(sorted(props.items())),
        'meanTurns': sum(t.get('turns', 0) for t in trials) / n,
        'medianSeconds': sorted(t.get('durationMs', 0) for t in trials)[n // 2] / 1000,
    }


def snapshot_prs():
    prs = []
    for num in range(1, 12):
        raw = subprocess.check_output(
            ['gh', 'pr', 'view', str(num), '-R', SHOP, '--json',
             'number,state,mergedAt,baseRefName,headRefName,createdAt,statusCheckRollup,title'],
            text=True)
        d = json.loads(raw)
        d['checks'] = sorted({(c.get('conclusion') or c.get('status') or '') for c in d.pop('statusCheckRollup')})
        prs.append(d)
    os.makedirs(os.path.dirname(PRS), exist_ok=True)
    with open(PRS, 'w') as f:
        json.dump(prs, f, indent=1)
        f.write('\n')
    print(f'wrote {PRS}')


def fmt_pct(x, d=1):
    return f'{100 * x:.{d}f}\\%'


def build():
    S = {key: run_stats(rid) for key, rid in RUNS.items()}
    summary = json.load(open(os.path.join(RES, 'summary.json')))
    repairs = []
    for name in sorted(os.listdir(os.path.join(RES, 'loop', 'repairs'))):
        if name.endswith('.json'):
            repairs.append(json.load(open(os.path.join(RES, 'loop', 'repairs', name))))
    repairs.sort(key=lambda r: r['scenario'])
    prs = json.load(open(PRS))
    fruns = {}
    for line in open(os.path.join(RES, 'loop', 'events.jsonl')):
        e = json.loads(line) if line.strip() else {}
        if e.get('type') == 'gate_F' and e.get('ok'):
            reason = (e.get('data') or {}).get('reason', '')
            fruns[e.get('traceId')] = reason.rsplit(' on ', 1)[-1].replace(' runs', '')

    M = {}  # macro name -> string

    # Bench phases
    for key in ('A', 'B', 'Bd', 'C', 'Bold', 'Bdold'):
        s = S[key]
        tag = {'A': 'A', 'B': 'B', 'Bd': 'Bd', 'C': 'C', 'Bold': 'Bold', 'Bdold': 'Bdold'}[key]
        M[f'pOne{tag}'] = fmt_pct(s['pass1'])
        M[f'pFive{tag}'] = fmt_pct(s['passk'][4])
        M[f'ciLo{tag}'] = fmt_pct(s['pass1_lo'])
        M[f'ciHi{tag}'] = fmt_pct(s['pass1_hi'])
        M[f'wrong{tag}'] = str(s['outcomes']['wrong'])
        M[f'declined{tag}'] = str(s['outcomes']['declined'])
        M[f'noAnswer{tag}'] = str(s['outcomes']['noAnswer'])
        M[f'trials{tag}'] = str(s['n'])
    M['fiksSha'] = S['A']['fiksSha'][:7]
    M['shopShaAB'] = S['A']['shopMcpSha'][:7]
    M['shopShaC'] = S['C']['shopMcpSha'][:7]
    M['nDirtyRuns'] = str(sum(1 for k in ('A', 'B', 'Bd', 'C') if S[k]['fiksDirty']))
    M['nTasks'] = str(S['A']['tasks'])
    M['kTrials'] = str(S['A']['k'])
    M['benchModel'] = S['A']['model']

    # False positives on clean v1 traffic (latest A run)
    a = S['A']['calls']
    n_v1 = a['verified'] + a['violated'] + a['unverifiable']
    M['vOneCalls'] = str(n_v1)
    M['vOneViolated'] = str(a['violated'])
    M['vOneFpUpper'] = fmt_pct(wilson(a['violated'], n_v1)[1])
    M['vOneTrialFpUpper'] = fmt_pct(wilson(S['A']['violTrials'], S['A']['n'])[1])
    M['violatedCallsB'] = str(S['B']['calls']['violated'])
    M['callsB'] = str(sum(S['B']['calls'].values()))

    # Paired task-level comparison, receipts vs no fiks (pass^5 per task)
    def task_pass_all(s):
        return {t: v['c'] == v['n'] for t, v in s['perTask'].items()}
    for suffix, (kb, kd) in (('', ('B', 'Bd')), ('Old', ('Bold', 'Bdold'))):
        pb, pd = task_pass_all(S[kb]), task_pass_all(S[kd])
        wins = sum(1 for t in pb if pb[t] and not pd[t])
        losses = sum(1 for t in pb if pd[t] and not pb[t])
        M[f'pairWins{suffix}'] = str(wins)
        M[f'pairLosses{suffix}'] = str(losses)
        # round half up (Python's format rounds half to even: 0.625 -> 0.62)
        M[f'pairP{suffix}'] = f'{math.floor(sign_test_two_sided(wins, losses) * 100 + 0.5) / 100:.2f}'
    wrong_tasks = sorted({t for t, v in S['Bd']['perTask'].items()} & {
        t for t in S['Bd']['perTask'] if any(
            tr['outcome'] == 'wrong' and tr.get('answer') is not None for tr in load_run(RUNS['Bd'])[1] if tr['taskId'] == t)})
    M['wrongTasksBd'] = ', '.join(wrong_tasks)
    M['nWrongTasksBd'] = str(len(wrong_tasks))
    # T1 sensitivity: without the 2 no-answer trials (right price stated, no submit)
    sens = dict((t, (v['c'] + S['Bd']['noAnswerByTask'].get(t, 0), v['n'])) for t, v in S['Bd']['perTask'].items())
    M['pFiveBdSens'] = fmt_pct(pass_hat_k(sens, 5))

    # Statistics restated (task is the unit)
    M['runToRunPts'] = f"{100 * abs(S['Bdold']['passk'][4] - S['Bd']['passk'][4]):.1f}"
    n_t = len(S['B']['perTask'])
    min_split = next((k for k in range(1, n_t + 1) if sign_test_two_sided(k, 0) < 0.05), None)
    M['minSplitForSig'] = str(min_split) if min_split else 'none'
    M['minSplitP'] = f"{sign_test_two_sided(min_split, 0):.3f}" if min_split else 'n/a'

    def t3_declines_correct(key):
        trials = load_run(RUNS[key])[1]
        pt = {}
        for t in trials:
            ok = t['pass'] or (t['taskId'] == 'T3' and t['outcome'] == 'declined')
            c, n = pt.get(t['taskId'], (0, 0))
            pt[t['taskId']] = (c + (1 if ok else 0), n + 1)
        return pass_hat_k(pt, 5)
    M['pFiveBTthree'] = fmt_pct(t3_declines_correct('B'))
    M['pFiveBdTthree'] = fmt_pct(t3_declines_correct('Bd'))

    # Loop (D1-D5)
    costs = [r['costUsd'] for r in repairs]
    turns = sorted(r['turns'] for r in repairs)
    mins = [summary['drifts'][d]['minutesDriftToPr'] for d in sorted(summary['drifts'])]
    M['nDrifts'] = str(len(summary['drifts']))
    M['nDetected'] = str(sum(1 for d in summary['drifts'].values() if d['detected']))
    M['nReproValid'] = str(sum(1 for d in summary['drifts'].values() if d['reproValid']))
    M['nPrGreen'] = str(sum(1 for d in summary['drifts'].values() if d['prGreen']))
    M['nConfirmed'] = str(sum(1 for d in summary['drifts'].values() if d['confirmed']))
    M['nFTwoRuns'] = str(sum(1 for v in fruns.values() if v == '2/2'))
    M['nFThreeRuns'] = str(sum(1 for v in fruns.values() if v == '3/3'))
    M['nOneAttempt'] = str(sum(1 for r in repairs if r['attempts'] == 1))
    M['repairModel'] = repairs[0]['model']
    M['costMin'] = f'{min(costs):.2f}'
    M['costMax'] = f'{max(costs):.2f}'
    M['costTotal'] = f'{sum(costs):.2f}'
    M['turnsMin'] = str(turns[0])
    M['turnsMax'] = str(turns[-1])
    M['turnsMedian'] = str(turns[len(turns) // 2])
    M['minsMin'] = f'{min(mins):.1f}'
    M['minsMax'] = f'{max(mins):.1f}'

    # PR snapshot
    fiks_prs = [p for p in prs if p['headRefName'].startswith('fiks/')]
    M['nPrs'] = str(len(fiks_prs))
    M['nPrsGreen'] = str(sum(1 for p in fiks_prs if p['checks'] == ['SUCCESS']))
    M['nPrsMerged'] = str(sum(1 for p in fiks_prs if p['mergedAt']))
    M['nPrsDemoOpen'] = str(sum(1 for p in fiks_prs if p['state'] == 'OPEN'))
    M['nPrsClosed'] = str(sum(1 for p in fiks_prs if p['state'] == 'CLOSED'))

    files = {}
    files['pilot.tex'] = '% Generated by paper/scripts/pilot_numbers.py from committed logs. Do not edit.\n' + ''.join(
        f'\\newcommand{{\\{k}}}{{{v}}}\n' for k, v in sorted(M.items()))
    files['pilot.json'] = json.dumps({'macros': M, 'runs': S}, indent=1, sort_keys=True) + '\n'

    # Table: bench phases
    rows = []
    for key in ('A', 'Bd', 'B', 'C'):
        s = S[key]
        pk = ' & '.join(f'{100 * x:.1f}' for x in s['passk'])
        rows.append(f"{LABEL[key]} & {pk} & {100 * s['pass1_lo']:.0f}--{100 * s['pass1_hi']:.0f} & "
                    f"{s['outcomes']['correct']} & {s['outcomes']['wrong']} & {s['outcomes']['declined']} & "
                    f"{s['outcomes']['noAnswer']} & {s['calls']['violated']} \\\\")
    files['tab-bench.tex'] = (
        '% Generated by paper/scripts/pilot_numbers.py. Do not edit.\n'
        '\\begin{tabular}{lrrrrrcrrrrr}\n\\toprule\n'
        'Phase & \\multicolumn{5}{c}{pass$^k$ (\\%), $k{=}1..5$} & pass$^1$ 95\\% CI & Corr. & Wrong & Decl. & No ans. & Viol. calls \\\\\n'
        '\\midrule\n' + '\n'.join(rows) + '\n\\bottomrule\n\\end{tabular}\n')

    # Table: per-task successes (out of k)
    tasks = sorted(S['A']['perTask'])
    trow = []
    for key in ('A', 'Bd', 'B', 'C'):
        s = S[key]
        trow.append(LABEL[key] + ' & ' + ' & '.join(f"{s['perTask'][t]['c']}/{s['perTask'][t]['n']}" for t in tasks) + ' \\\\')
    files['tab-tasks.tex'] = (
        '% Generated by paper/scripts/pilot_numbers.py. Do not edit.\n'
        '\\begin{tabular}{l' + 'c' * len(tasks) + '}\n\\toprule\nPhase & ' + ' & '.join(tasks) + ' \\\\\n\\midrule\n'
        + '\n'.join(trow) + '\n\\bottomrule\n\\end{tabular}\n')

    # Table: loop per drift
    pr_by_url = {f"https://github.com/{SHOP}/pull/{p['number']}": p for p in prs}
    lrows = []
    for r in repairs:
        d = summary['drifts'][r['scenario']]
        p = pr_by_url.get(d['prUrl'], {})
        prop = ', '.join(x.split('/', 1)[1] if '/' in x else x for x in r['propertyIds'])
        prop = prop.replace('_', '\\_')
        lrows.append(f"{r['scenario']} & \\texttt{{{prop}}} & {fruns.get(r['traceId'], '?')} & {r['attempts']} & "
                     f"{r['turns']} & {r['costUsd']:.2f} & {d['minutesDriftToPr']:.1f} & "
                     f"\\#{p.get('number', '?')} & {'yes' if d['merged'] else 'no'} & {'yes' if d['confirmed'] else 'no'} \\\\")
    files['tab-loop.tex'] = (
        '% Generated by paper/scripts/pilot_numbers.py. Do not edit.\n'
        '\\begin{tabular}{llcrrrrlcc}\n\\toprule\n'
        'Drift & Violated property & F gate (runs) & Att. & Turns & Cost (\\$) & Min. to PR & PR & Merged & Confirmed \\\\\n'
        '\\midrule\n' + '\n'.join(lrows) + '\n\\bottomrule\n\\end{tabular}\n')

    # Table: receipt wording history (v1 vs v2)
    hrows = []
    for key, lab in (('Bdold', 'No fiks (2026-10-18 run)'), ('Bold', 'fiks receipts, wording v1'),
                     ('Bd', 'No fiks (2026-10-20 run)'), ('B', 'fiks receipts, wording v2')):
        s = S[key]
        hrows.append(f"{lab} & {100 * s['passk'][0]:.1f} & {100 * s['passk'][4]:.1f} & {s['outcomes']['wrong']} & "
                     f"{s['outcomes']['declined']} & {s['outcomes']['noAnswer']} \\\\")
    files['tab-receipts.tex'] = (
        '% Generated by paper/scripts/pilot_numbers.py. Do not edit.\n'
        '\\begin{tabular}{lrrrrr}\n\\toprule\n'
        'Arm (drifted vendor) & pass$^1$ & pass$^5$ & Wrong & Declined & No answer \\\\\n'
        '\\midrule\n' + '\n'.join(hrows) + '\n\\bottomrule\n\\end{tabular}\n')
    return files


def main():
    if '--snapshot-prs' in sys.argv:
        snapshot_prs()
        return
    files = build()
    if '--check' in sys.argv:
        bad = [n for n, txt in files.items()
               if not os.path.exists(os.path.join(OUT, n)) or open(os.path.join(OUT, n)).read() != txt]
        if bad:
            print('pilot_numbers --check: MISMATCH in ' + ', '.join(bad))
            sys.exit(1)
        print(f'pilot_numbers --check: {len(files)} files match the logs')
        return
    os.makedirs(OUT, exist_ok=True)
    for n, txt in files.items():
        with open(os.path.join(OUT, n), 'w') as f:
            f.write(txt)
    print(f'wrote {len(files)} files to {OUT}')


if __name__ == '__main__':
    main()
